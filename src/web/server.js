const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const { dashboardPage, loginPage } = require("./html");

const pendingOAuthStates = new Map();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function discordAvatarUrl(user) {
  if (!user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
}

async function exchangeCodeForUser({ code, config }) {
  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.discord.clientId,
      client_secret: config.discord.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.dashboard.callbackUrl
    })
  });

  if (!tokenResponse.ok) {
    throw new Error("Discord OAuth token exchange failed.");
  }

  const tokenData = await tokenResponse.json();
  const userResponse = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });

  if (!userResponse.ok) {
    throw new Error("Discord user lookup failed.");
  }

  const user = await userResponse.json();
  return {
    id: user.id,
    username: user.global_name || user.username,
    avatar: discordAvatarUrl(user)
  };
}

function createWebServer({ config, verificationService }) {
  const app = express();
  app.set("trust proxy", 1);

  app.use(express.static("public"));
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      name: "discord_verify_sid",
      secret: config.dashboard.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.dashboard.callbackUrl.startsWith("https://")
      }
    })
  );

  function requireAuth(req, res, next) {
    if (!req.session.user) {
      res.redirect("/");
      return;
    }
    next();
  }

  async function requireModerator(req, res, next) {
    const ok = await verificationService.isModerator(req.session.user.id).catch(() => false);
    if (!ok) {
      res.status(403).send("You are signed in, but this dashboard is moderator-only.");
      return;
    }
    next();
  }

  app.get("/", async (req, res) => {
    if (!req.session.user) {
      res.send(loginPage());
      return;
    }
    const ok = await verificationService.isModerator(req.session.user.id).catch(() => false);
    if (!ok) {
      res.status(403).send("You are signed in, but this dashboard is moderator-only.");
      return;
    }
    res.send(dashboardPage({
      user: req.session.user,
      records: verificationService.store.list(),
      message: req.session.flash
    }));
    req.session.flash = null;
  });

  app.get("/auth/discord", (req, res) => {
    const state = crypto.randomBytes(16).toString("hex");
    req.session.oauthState = state;
    pendingOAuthStates.set(state, Date.now() + OAUTH_STATE_TTL_MS);
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", config.discord.clientId);
    url.searchParams.set("redirect_uri", config.dashboard.callbackUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify");
    url.searchParams.set("state", state);
    req.session.save(() => res.redirect(url.toString()));
  });

  app.get("/auth/discord/callback", async (req, res, next) => {
    try {
      const state = String(req.query.state || "");
      const savedStateExpiresAt = pendingOAuthStates.get(state);
      const sessionStateMatches = state && state === req.session.oauthState;
      const fallbackStateMatches = savedStateExpiresAt && savedStateExpiresAt > Date.now();
      pendingOAuthStates.delete(state);

      if (!req.query.code || (!sessionStateMatches && !fallbackStateMatches)) {
        res.status(400).send("Invalid Discord OAuth response.");
        return;
      }
      req.session.user = await exchangeCodeForUser({ code: req.query.code, config });
      req.session.oauthState = null;
      req.session.save(() => res.redirect("/"));
    } catch (error) {
      next(error);
    }
  });

  app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/"));
  });

  app.post("/actions/verify", requireAuth, requireModerator, async (req, res, next) => {
    try {
      await verificationService.verifyUser(String(req.body.discordUserId || "").trim(), {
        source: "dashboard",
        moderatorId: req.session.user.id,
        reason: req.body.reason || "Manual dashboard approval"
      });
      req.session.flash = "User verified.";
      res.redirect("/");
    } catch (error) {
      next(error);
    }
  });

  app.post("/actions/reject", requireAuth, requireModerator, async (req, res, next) => {
    try {
      await verificationService.rejectUser(String(req.body.discordUserId || "").trim(), {
        source: "dashboard",
        moderatorId: req.session.user.id,
        reason: req.body.reason || "Manual dashboard rejection"
      });
      req.session.flash = "User rejected.";
      res.redirect("/");
    } catch (error) {
      next(error);
    }
  });

  app.post("/actions/recheck", requireAuth, requireModerator, async (req, res, next) => {
    try {
      const results = await verificationService.checkPending();
      const verified = results.filter((item) => item.action === "verified").length;
      const rejected = results.filter((item) => item.action === "rejected").length;
      req.session.flash = `Sheets check complete. Verified ${verified}, rejected ${rejected}.`;
      res.redirect("/");
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).send(`Dashboard error: ${error.message}`);
  });

  return app;
}

module.exports = {
  createWebServer
};
