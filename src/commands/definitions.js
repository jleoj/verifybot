const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

function commandDefinitions() {
  return [
    new SlashCommandBuilder()
      .setName("verification-panel")
      .setDescription("Post the verification button panel.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder()
      .setName("verify-user")
      .setDescription("Manually verify a member.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((option) =>
        option.setName("user").setDescription("Member to verify").setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("reason").setDescription("Optional reason").setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName("reject-verification")
      .setDescription("Reject a member verification.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((option) =>
        option.setName("user").setDescription("Member to reject").setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("reason").setDescription("Optional reason").setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName("verification-status")
      .setDescription("Show a member's verification status.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((option) =>
        option.setName("user").setDescription("Member to check").setRequired(true)
      )
  ].map((command) => command.toJSON());
}

module.exports = {
  commandDefinitions
};
