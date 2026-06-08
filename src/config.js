require("dotenv").config();

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDomains(value) {
  return splitList(value).map((domain) => domain.toLowerCase().replace(/^@/, ""));
}

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function privateKeyFromEnv(value) {
  return String(value || "").replace(/\\n/g, "\n");
}

const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    guildId: process.env.DISCORD_GUILD_ID,
    unverifiedRoleId: process.env.UNVERIFIED_ROLE_ID,
    verifiedRoleId: process.env.VERIFIED_ROLE_ID,
    moderatorRoleIds: splitList(process.env.MODERATOR_ROLE_IDS),
    dashboardAllowedUserIds: splitList(process.env.DASHBOARD_ALLOWED_USER_IDS)
  },
  dashboard: {
    port: numberFromEnv("DASHBOARD_PORT", 3000),
    sessionSecret: process.env.SESSION_SECRET || "replace-this-session-secret",
    callbackUrl:
      process.env.DISCORD_OAUTH_CALLBACK_URL ||
      "http://localhost:3000/auth/discord/callback"
  },
  verification: {
    googleFormUrl: process.env.GOOGLE_FORM_URL,
    allowedEmailDomains: normalizeDomains(process.env.ALLOWED_EMAIL_DOMAINS),
    codeTtlMinutes: numberFromEnv("CODE_TTL_MINUTES", 5),
    pollIntervalSeconds: numberFromEnv("POLL_INTERVAL_SECONDS", 30),
    stateFile: process.env.STATE_FILE || "data/verification-state.json"
  },
  google: {
    sheetId: process.env.GOOGLE_SHEET_ID,
    range: process.env.GOOGLE_SHEET_RANGE || "Form Responses 1!A:Z",
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: privateKeyFromEnv(process.env.GOOGLE_PRIVATE_KEY),
    codeHeader: process.env.SHEETS_CODE_HEADER || "Verification Code",
    emailHeader: process.env.SHEETS_EMAIL_HEADER || "Email Address",
    discordIdHeader: process.env.SHEETS_DISCORD_ID_HEADER || "Discord User ID"
  }
};

function requiredPaths() {
  return [
    ["DISCORD_TOKEN", config.discord.token],
    ["DISCORD_CLIENT_ID", config.discord.clientId],
    ["DISCORD_CLIENT_SECRET", config.discord.clientSecret],
    ["DISCORD_GUILD_ID", config.discord.guildId],
    ["UNVERIFIED_ROLE_ID", config.discord.unverifiedRoleId],
    ["VERIFIED_ROLE_ID", config.discord.verifiedRoleId],
    ["MODERATOR_ROLE_IDS", config.discord.moderatorRoleIds.length],
    ["SESSION_SECRET", config.dashboard.sessionSecret],
    ["GOOGLE_FORM_URL", config.verification.googleFormUrl],
    ["ALLOWED_EMAIL_DOMAINS", config.verification.allowedEmailDomains.length],
    ["GOOGLE_SHEET_ID", config.google.sheetId],
    ["GOOGLE_SERVICE_ACCOUNT_EMAIL", config.google.serviceAccountEmail],
    ["GOOGLE_PRIVATE_KEY", config.google.privateKey]
  ];
}

function validateConfig() {
  const missing = requiredPaths()
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(`Missing required .env values: ${missing.join(", ")}`);
  }
}

module.exports = {
  config,
  splitList,
  validateConfig
};
