const { REST, Routes } = require("discord.js");
const { config, validateConfig } = require("../src/config");
const { commandDefinitions } = require("../src/commands/definitions");

async function main() {
  validateConfig();

  const rest = new REST({ version: "10" }).setToken(config.discord.token);
  await rest.put(
    Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
    { body: commandDefinitions() }
  );

  console.log("Registered verification slash commands.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
