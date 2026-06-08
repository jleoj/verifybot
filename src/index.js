const { config, validateConfig } = require("./config");
const { createDiscordClient, registerDiscordHandlers } = require("./discord");
const { StateStore } = require("./services/stateStore");
const { SheetsService } = require("./services/sheetsService");
const { VerificationService } = require("./services/verificationService");
const { createWebServer } = require("./web/server");

async function main() {
  validateConfig();

  const client = createDiscordClient();
  const store = new StateStore(config.verification.stateFile);
  const sheets = new SheetsService(config.google);
  const verificationService = new VerificationService({ client, config, store, sheets });

  registerDiscordHandlers(client, verificationService);

  await client.login(config.discord.token);

  const app = createWebServer({ config, verificationService });
  app.listen(config.dashboard.port, () => {
    console.log(`Dashboard listening on http://localhost:${config.dashboard.port}`);
  });

  const pollMs = config.verification.pollIntervalSeconds * 1000;
  setInterval(async () => {
    try {
      await verificationService.checkPending();
    } catch (error) {
      console.error(`Verification poll failed: ${error.message}`);
    }
  }, pollMs);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
