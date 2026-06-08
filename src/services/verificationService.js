const crypto = require("crypto");
const { PermissionFlagsBits } = require("discord.js");

function makeCode(store) {
  for (let index = 0; index < 100; index += 1) {
    const code = crypto.randomBytes(4).toString("hex");
    if (!store.hasCode(code)) return code;
  }
  throw new Error("Unable to generate an unused verification code.");
}

function isDiscordPermissionError(error) {
  return error?.code === 50013 || error?.code === "ROLE_PERMISSION_CHECK_FAILED" || /missing permissions/i.test(error?.message || "");
}

function rolePermissionError(message) {
  const error = new Error(message);
  error.code = "ROLE_PERMISSION_CHECK_FAILED";
  return error;
}

class VerificationService {
  constructor({ client, config, store, sheets }) {
    this.client = client;
    this.config = config;
    this.store = store;
    this.sheets = sheets;
  }

  async getGuild() {
    return this.client.guilds.fetch(this.config.discord.guildId);
  }

  async getMember(discordUserId) {
    const guild = await this.getGuild();
    return guild.members.fetch(discordUserId);
  }

  async assertCanManageRole(guild, roleId, action) {
    if (!roleId) return;

    const role = await guild.roles.fetch(roleId);
    if (!role) {
      throw rolePermissionError(`Configured role for ${action} was not found in this server: ${roleId}`);
    }

    const botMember = guild.members.me || await guild.members.fetch(this.client.user.id);
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw rolePermissionError("The bot's server role does not have the Manage Roles permission.");
    }

    if (botMember.roles.highest.position <= role.position) {
      throw rolePermissionError(
        `The bot cannot ${action} the role "${role.name}" because that role is at or above the bot's highest role. Move the bot's role above "${role.name}" in Server Settings -> Roles.`
      );
    }
  }

  async assertCanRunVerificationRoles() {
    const guild = await this.getGuild();
    await this.assertCanManageRole(guild, this.config.discord.verifiedRoleId, "assign/remove");
    await this.assertCanManageRole(guild, this.config.discord.unverifiedRoleId, "assign/remove");
    return guild;
  }

  async isModerator(discordUserId) {
    if (this.config.discord.dashboardAllowedUserIds.includes(discordUserId)) return true;
    const member = await this.getMember(discordUserId).catch(() => null);
    if (!member) return false;
    return this.config.discord.moderatorRoleIds.some((roleId) => member.roles.cache.has(roleId));
  }

  activePendingFor(discordUserId) {
    const existing = this.store.get(discordUserId);
    if (!existing || existing.status !== "pending") return null;
    const age = Date.now() - new Date(existing.createdAt).getTime();
    if (age > this.config.verification.codeTtlMinutes * 60 * 1000) return null;
    return existing;
  }

  async requestVerification(discordUserId) {
    const existing = this.activePendingFor(discordUserId);
    const record = existing || this.store.upsertPending(discordUserId, makeCode(this.store));
    const user = await this.client.users.fetch(discordUserId);

    const message = [
      "Welcome to the server! Complete server verification with this form:",
      this.config.verification.googleFormUrl,
      "",
      `Your verification code is: ${record.code}`,
      `Your Discord User ID is: ${discordUserId}`,
      "",
      "Enter that exact 8-character code and Discord User ID in the form within 5 minutes. Once your response appears in our records, I will finish verification automatically."
    ].join("\n");

    await user.send(message);
    console.log(`Sent verification DM to ${discordUserId} with code ${record.code}`);
    return record;
  }

  async verifyUser(discordUserId, details = {}) {
    const guild = await this.assertCanRunVerificationRoles();
    const member = await guild.members.fetch(discordUserId);
    await member.roles.add(this.config.discord.verifiedRoleId, details.reason || "Verification approved");
    if (this.config.discord.unverifiedRoleId) {
      await member.roles.remove(this.config.discord.unverifiedRoleId, "Verification approved").catch(() => null);
    }

    await member.send("Verification was successful. You now have access to the server.").catch(() => null);

    console.log(`Verified Discord user ${discordUserId}`);
    return this.store.markVerified(discordUserId, {
      ...details,
      verifiedAt: new Date().toISOString()
    });
  }

  async rejectUser(discordUserId, details = {}) {
    const guild = await this.assertCanRunVerificationRoles();
    const member = await guild.members.fetch(discordUserId).catch(() => null);
    if (member) {
      await member.roles.remove(this.config.discord.verifiedRoleId, details.reason || "Verification rejected").catch(() => null);
      if (this.config.discord.unverifiedRoleId) {
        await member.roles.add(this.config.discord.unverifiedRoleId, "Verification rejected").catch(() => null);
      }
      const reasonText = details.reason ? ` Reason: ${details.reason}` : "";
      await member.send(`Sorry, but your verification was rejected.${reasonText}`).catch(() => null);
    }

    return this.store.markRejected(discordUserId, {
      ...details,
      rejectedAt: new Date().toISOString()
    });
  }

  async checkOne(record) {
    this.store.touchCheck(record.discordUserId);
    console.log(`Checking verification for ${record.discordUserId} with code ${record.code}`);
    const submission = await this.sheets.findSubmissionByCode(
      record.code,
      record.discordUserId,
      this.config.verification.allowedEmailDomains
    );

    if (!submission.found) {
      console.log(`No Google Sheet submission found yet for ${record.discordUserId}`);
      return { action: "waiting", record };
    }

    if (!submission.discordIdMatches) {
      console.log(`Rejecting ${record.discordUserId}: submitted Discord ID ${submission.submittedDiscordUserId || "blank"} did not match`);
      try {
        await this.rejectUser(record.discordUserId, {
          source: "google-sheets",
          reason: "Discord User ID did not match the verification request",
          sheetRow: submission.rowNumber,
          submittedDiscordUserId: submission.submittedDiscordUserId
        });
      } catch (error) {
        if (!isDiscordPermissionError(error)) throw error;
        this.store.mark(record.discordUserId, "needs_review", {
          source: "google-sheets",
          reason: "Bot lacks Discord permissions to reject this member",
          error: error.message,
          sheetRow: submission.rowNumber,
          submittedDiscordUserId: submission.submittedDiscordUserId
        });
      }
      return { action: "rejected", record, submission };
    }

    if (!submission.allowed) {
      console.log(`Rejecting ${record.discordUserId}: email domain ${submission.domain || "unknown"} is not allowed`);
      try {
        await this.rejectUser(record.discordUserId, {
          source: "google-sheets",
          reason: `Your email domain is not whitelisted: ${submission.domain || "unknown"}`,
          sheetRow: submission.rowNumber,
          emailDomain: submission.domain
        });
      } catch (error) {
        if (!isDiscordPermissionError(error)) throw error;
        this.store.mark(record.discordUserId, "needs_review", {
          source: "google-sheets",
          reason: "Bot lacks Discord permissions to reject this member",
          error: error.message,
          sheetRow: submission.rowNumber,
          emailDomain: submission.domain
        });
      }
      return { action: "rejected", record, submission };
    }

    try {
      await this.verifyUser(record.discordUserId, {
        source: "google-sheets",
        reason: "Google Form response matched an allowed email domain",
        sheetRow: submission.rowNumber,
        emailDomain: submission.domain
      });
    } catch (error) {
      if (!isDiscordPermissionError(error)) throw error;
      this.store.mark(record.discordUserId, "needs_review", {
        source: "google-sheets",
        reason: "Bot lacks Discord permissions to verify this member",
        error: error.message,
        sheetRow: submission.rowNumber,
        emailDomain: submission.domain
      });
      console.log(`Needs review for ${record.discordUserId}: missing Discord permissions to verify`);
      return { action: "needs_review", record, submission };
    }

    return { action: "verified", record, submission };
  }

  async expireOldPending() {
    const now = Date.now();
    const expired = [];
    for (const record of this.store.listPending()) {
      const createdAt = new Date(record.createdAt).getTime();
      if (!Number.isFinite(createdAt)) continue;
      if (now - createdAt <= this.config.verification.codeTtlMinutes * 60 * 1000) continue;

      this.store.markRejected(record.discordUserId, {
        reason: "Verification code expired",
        source: "system"
      });

      const user = await this.client.users.fetch(record.discordUserId).catch(() => null);
      if (user) {
        await user.send("Your verification code expired. Please click the verification button again to get a new code.").catch(() => null);
      }

      console.log(`Expired verification code for ${record.discordUserId}`);
      expired.push(record.discordUserId);
    }
    return expired;
  }

  async checkPending() {
    await this.expireOldPending();
    const results = [];
    for (const record of this.store.listCheckable()) {
      results.push(await this.checkOne(record));
    }
    return results;
  }
}

module.exports = {
  VerificationService
};
