# Discord Verification Bot

This bot verifies new members through a Discord button, an 8-character hexadecimal code, Google Forms, Google Sheets, moderator slash commands, and a small Discord-authenticated dashboard.

## What It Does

1. A user joins and receives your existing `Unverified` role.
2. The user clicks a verification button in Discord.
3. The bot DMs them your Google Form link, a random 8-character hexadecimal code, and their Discord user ID.
4. The user enters the code and Discord user ID in the Google Form within 5 minutes.
5. Google Forms writes the response to Google Sheets, including the collected email address.
6. The bot checks the sheet, confirms the email domain is allowed, removes `Unverified`, adds `Verified`, and DMs the user.
7. Moderators can manually verify or reject users through slash commands or the web dashboard.

## Setup

### 1. Install Node Dependencies

Use Node.js 20 or newer.

```bash
npm install
```

### 2. Create Your Discord Application

In the Discord Developer Portal:

1. Create an application and bot.
2. Enable the `SERVER MEMBERS INTENT`.
3. Copy the bot token, client ID, and client secret into `.env`.
4. Add this OAuth2 redirect URL:

```text
http://localhost:3000/auth/discord/callback
```

Use your deployed URL later if you host the dashboard publicly.

### 3. Invite the Bot

Invite it with these scopes:

```text
bot
applications.commands
```

Recommended permissions:

```text
Manage Roles
Send Messages
Read Message History
Use Slash Commands
```

The bot role must be above the `Unverified` and `Verified` roles in Discord's role list.

### 4. Configure Google Forms and Sheets

Create a Google Form with:

- A short-answer field for the verification code.
- A short-answer field for the Discord user ID.
- Any record-only fields you need, such as name and DOB.
- Email collection enabled.

Link the form to a Google Sheet.

Create a Google Cloud service account, enable the Google Sheets API, and share the response sheet with the service account email as a viewer. Put the service account email and private key in `.env`.

The bot expects these sheet headers by default:

```text
Verification Code
Email Address
Discord User ID
```

You can change those names with `SHEETS_CODE_HEADER`, `SHEETS_EMAIL_HEADER`, and `SHEETS_DISCORD_ID_HEADER`.

### 5. Configure Environment

Copy the example file:

```bash
cp .env.example .env
```

Fill every value in `.env`. Keep `.env` private.

### 6. Register Slash Commands

```bash
npm run register:commands
```

### 7. Start the Bot and Dashboard

```bash
npm start
```

The dashboard will run at:

```text
http://localhost:3000
```

## Discord Commands

- `/verification-panel` posts the public button users click to start verification.
- `/verify-user user:<member> reason:<optional>` manually verifies a member.
- `/reject-verification user:<member> reason:<optional>` rejects a member.
- `/verification-status user:<member>` shows the stored verification status.

Commands are moderator-only by Discord permission and by role checks inside the bot.

## Dashboard

Open the dashboard URL, sign in with Discord, and use the action panel to:

- Manually verify a Discord user ID.
- Reject a Discord user ID.
- Re-check pending users against Google Sheets.

Access requires either:

- A role listed in `MODERATOR_ROLE_IDS`, or
- A Discord user ID listed in `DASHBOARD_ALLOWED_USER_IDS`.

## Notes

- Verification codes expire after 5 minutes by default.
- Local state stores Discord IDs, generated codes, status, timestamps, and sheet row references. It does not store form names, DOBs, or full email addresses.
- The Google Sheet remains the source of truth for submitted form data.
- If a user has DMs disabled, they will see a Discord message asking them to enable DMs and try again.
