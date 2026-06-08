const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials
} = require("discord.js");

const VERIFY_BUTTON_ID = "start_verification";

function createDiscordClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
  });
}

function verificationPanel() {
  const embed = new EmbedBuilder()
    .setTitle("Server Verification")
    .setDescription("Click below to receive your verification code and form link.")
    .setColor(0x5f7cff);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(VERIFY_BUTTON_ID)
      .setLabel("Start Verification")
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

async function assertModerator(interaction, verificationService) {
  const allowed = await verificationService.isModerator(interaction.user.id);
  if (!allowed) {
    await interaction.reply({ content: "Only moderators can use that.", ephemeral: true });
    return false;
  }
  return true;
}

function registerDiscordHandlers(client, verificationService) {
  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === VERIFY_BUTTON_ID) {
        console.log(`Verification button clicked by ${interaction.user.tag} (${interaction.user.id})`);
        await interaction.deferReply({ ephemeral: true });
        await verificationService.requestVerification(interaction.user.id);
        await interaction.editReply("Your verification code and form was sent, please check your DMs.");
        return;
      }

      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === "verification-panel") {
        console.log(`Verification panel requested by ${interaction.user.tag} (${interaction.user.id})`);
        if (!(await assertModerator(interaction, verificationService))) return;
        await interaction.channel.send(verificationPanel());
        await interaction.reply({ content: "Verification panel posted.", ephemeral: true });
        return;
      }

      if (interaction.commandName === "verify-user") {
        console.log(`Manual verify command used by ${interaction.user.tag} (${interaction.user.id})`);
        if (!(await assertModerator(interaction, verificationService))) return;
        await interaction.deferReply({ ephemeral: true });
        const user = interaction.options.getUser("user", true);
        const reason = interaction.options.getString("reason") || "Manual moderator approval";
        await verificationService.verifyUser(user.id, {
          source: "slash-command",
          moderatorId: interaction.user.id,
          reason
        });
        await interaction.editReply(`Verified ${user.tag}.`);
        return;
      }

      if (interaction.commandName === "reject-verification") {
        console.log(`Manual reject command used by ${interaction.user.tag} (${interaction.user.id})`);
        if (!(await assertModerator(interaction, verificationService))) return;
        await interaction.deferReply({ ephemeral: true });
        const user = interaction.options.getUser("user", true);
        const reason = interaction.options.getString("reason") || "Manual moderator rejection";
        await verificationService.rejectUser(user.id, {
          source: "slash-command",
          moderatorId: interaction.user.id,
          reason
        });
        await interaction.editReply(`Rejected ${user.tag}.`);
        return;
      }

      if (interaction.commandName === "verification-status") {
        if (!(await assertModerator(interaction, verificationService))) return;
        const user = interaction.options.getUser("user", true);
        const record = verificationService.store.get(user.id);
        if (!record) {
          await interaction.reply({ content: `No verification record for ${user.tag}.`, ephemeral: true });
          return;
        }
        await interaction.reply({
          content: [
            `Status for ${user.tag}: ${record.status}`,
            `Code: ${record.code || "n/a"}`,
            `Updated: ${record.updatedAt || "n/a"}`,
            record.reason ? `Reason: ${record.reason}` : null
          ].filter(Boolean).join("\n"),
          ephemeral: true
        });
      }
    } catch (error) {
      console.error(error);
      const content = error.message.includes("Cannot send messages")
        ? "The API could not DM you. Please enable DMs from server members, then try again."
        : `Something went wrong: ${error.message}`;

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(content).catch(() => null);
      } else {
        await interaction.reply({ content, ephemeral: true }).catch(() => null);
      }
    }
  });
}

module.exports = {
  VERIFY_BUTTON_ID,
  createDiscordClient,
  registerDiscordHandlers,
  verificationPanel
};
