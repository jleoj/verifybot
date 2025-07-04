import discord
from discord.ext import commands, tasks
import sqlite3
import random
import string
import datetime
from google.oauth2 import service_account
from googleapiclient.discovery import build
import os
from dotenv import load_dotenv
import difflib

# === LOAD ENVIRONMENT ===
load_dotenv()
DISCORD_TOKEN = os.getenv('DISCORD_TOKEN')
GUILD_ID = int(os.getenv('GUILD_ID'))
VERIFIED_ROLE_NAME = 'Verified'
LOG_CHANNEL_ID = int(os.getenv('LOG_CHANNEL_ID'))
GOOGLE_FORM_LINK = os.getenv('GOOGLE_FORM_LINK')
GOOGLE_SHEET_ID = os.getenv('GOOGLE_SHEET_ID')
SHEET_RANGE = 'Form Responses 1!A2:B'
SERVICE_ACCOUNT_FILE = os.getenv('SERVICE_ACCOUNT_FILE')
COMMAND_CHANNEL_ID = int(os.getenv('COMMAND_CHANNEL_ID'))

# === DATABASE SETUP ===
conn = sqlite3.connect('verification.db')
cursor = conn.cursor()
cursor.execute('''
CREATE TABLE IF NOT EXISTS codes (
    user_id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    verified INTEGER DEFAULT 0
)
''')
conn.commit()

# === DISCORD SETUP ===
intents = discord.Intents.default()
intents.members = True
intents.message_content = True
bot = commands.Bot(command_prefix='$', intents=intents)

def is_valid_channel():
    async def predicate(ctx):
        if isinstance(ctx.channel, discord.DMChannel):
            await ctx.send("❌ This command cannot be run in DMs.")
            return False
        if ctx.channel.id != COMMAND_CHANNEL_ID:
            await ctx.send("❌ Please use this command in the designated verification channel.")
            return False
        return True
    return commands.check(predicate)


# === Set Bot Activity ===
@bot.event
async def on_ready():
    cleanup_expired_codes.start()
    activity = discord.Activity(type=discord.ActivityType.watching, name="the verification form")
    await bot.change_presence(activity=activity)
    print(f"Bot is ready as {bot.user}")

# === GOOGLE SHEETS SETUP ===
SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
creds = service_account.Credentials.from_service_account_file(
    SERVICE_ACCOUNT_FILE, scopes=SCOPES)
sheets_service = build('sheets', 'v4', credentials=creds)

# === UTILITY FUNCTIONS ===
def generate_code(length=8):
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))

def store_code(user_id, code, expires_at):
    cursor.execute('''
    INSERT OR REPLACE INTO codes (user_id, code, expires_at)
    VALUES (?, ?, ?)
    ''', (str(user_id), code, expires_at.isoformat()))
    conn.commit()

def get_user_code_record(user_id):
    cursor.execute("SELECT code, expires_at, verified FROM codes WHERE user_id = ?", (str(user_id),))
    return cursor.fetchone()

def is_user_verified(user_id):
    cursor.execute("SELECT verified FROM codes WHERE user_id = ?", (str(user_id),))
    row = cursor.fetchone()
    return row and row[0] == 1

def mark_verified(user_id):
    cursor.execute("UPDATE codes SET verified = 1 WHERE user_id = ?", (str(user_id),))
    conn.commit()

def fuzzy_match(a, b):
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio() >= 0.85


# === BOT COMMANDS ===
@bot.command()
@is_valid_channel()
async def verify(ctx):
    user = ctx.author
    record = get_user_code_record(user.id)

    if record:
        code, expires_at_str, verified = record
        if verified:
            await ctx.send("✅ You are already verified.")
            return
        else:
            expires_at = datetime.datetime.fromisoformat(expires_at_str)
            remaining = int((expires_at - datetime.datetime.utcnow()).total_seconds() / 60)
            await user.send(f"⏳ You already have a code: `{code}` (expires in {remaining} min)\nPlease fill the form: {GOOGLE_FORM_LINK}")
            await ctx.send("✅ Check your DMs.")
            return

    code = generate_code()
    expires_at = datetime.datetime.utcnow() + datetime.timedelta(minutes=5)
    store_code(user.id, code, expires_at)

    await user.send(f"🔐 Your code: `{code}`\n⏳ Expires in 5 minutes.\n📋 Form: {GOOGLE_FORM_LINK}\n👉 Please enter your Discord username as it appears: {user}")
    await ctx.send("✅ Check your DMs.")
    check_sheet.start(user)
    remind_pending.start(user)

@bot.command()
@is_valid_channel()
async def retry(ctx):
    user = ctx.author
    cursor.execute("DELETE FROM codes WHERE user_id = ? AND verified = 0", (str(user.id),))
    conn.commit()
    await ctx.send("🔁 Your previous code was removed. Run `$verify` again.")

@bot.command()
@is_valid_channel()
async def status(ctx):
    user = ctx.author
    record = get_user_code_record(user.id)
    if record:
        code, expires_at_str, verified = record
        status = "✅ Verified" if verified else "⏳ Pending"
        await ctx.send(f"🔎 Status: {status}\n🔐 Code: `{code}`\n📅 Expires at: `{expires_at_str}`")
    else:
        await ctx.send("ℹ️ No verification record found. Run `$verify` to start.")

@bot.command()
@is_valid_channel()
@commands.has_permissions(manage_roles=True)
async def checkuser(ctx, member: discord.Member):
    record = get_user_code_record(member.id)
    if record:
        code, expires_at_str, verified = record
        status = "✅ Verified" if verified else "⏳ Pending"
        await ctx.send(f"👤 {member} - {status}\nCode: `{code}`\nExpires at: `{expires_at_str}`")
    else:
        await ctx.send(f"❌ No verification record found for {member}.")

@bot.command()
@is_valid_channel()
@commands.has_permissions(manage_roles=True)
async def resetuser(ctx, member: discord.Member):
    cursor.execute("DELETE FROM codes WHERE user_id = ?", (str(member.id),))
    conn.commit()
    await ctx.send(f"🔁 Verification record for {member} has been reset.")

@bot.command()
@is_valid_channel()
@commands.has_permissions(manage_roles=True)
async def listunverified(ctx):
    cursor.execute("SELECT user_id FROM codes WHERE verified = 0")
    rows = cursor.fetchall()
    if rows:
        mentions = []
        for row in rows:
            user = await bot.fetch_user(int(row[0]))
            mentions.append(f"- {user} ({user.mention})")
        message = "📝 Unverified Users:\n" + "\n".join(mentions)
        await ctx.send(message)
    else:
        await ctx.send("✅ No unverified users found.")

# === BACKGROUND TASKS ===
@tasks.loop(seconds=10.0, count=30)
async def check_sheet(user):
    guild = bot.get_guild(GUILD_ID)
    log_channel = guild.get_channel(LOG_CHANNEL_ID)

    print(f"[DEBUG] Running check_sheet for user {user} ({user.id})")

    record = get_user_code_record(user.id)
    if not record:
        print("[DEBUG] No verification record found.")
        check_sheet.stop()
        return

    code, expires_at_str, verified = record
    print(f"[DEBUG] Fetched code: {code}, Verified: {verified}, Expires at: {expires_at_str}")

    expires_at = datetime.datetime.fromisoformat(expires_at_str)

    if verified:
        await log_channel.send(f"✅ {user} is already verified.")
        check_sheet.stop()
        remind_pending.stop()
        return

    if datetime.datetime.utcnow() > expires_at:
        await user.send("❌ Your verification code has expired. Please run `!verify` again.")
        await log_channel.send(f"⏱️ Code expired for {user}.")
        check_sheet.stop()
        remind_pending.stop()
        return

    try:
        result = sheets_service.spreadsheets().values().get(
            spreadsheetId=GOOGLE_SHEET_ID,
            range=SHEET_RANGE
        ).execute()
        values = result.get('values', [])
        print(f"[DEBUG] Retrieved values from sheet: {values}")
    except Exception as e:
        print(f"[ERROR] Google Sheets API error: {e}")
        return

    for row in values:
        if len(row) >= 2:
            submitted_code = row[0].strip().upper()
            submitted_username = row[1].strip()
            print(f"[DEBUG] Checking row: code={submitted_code}, username={submitted_username}")
            if submitted_code == code:
                if fuzzy_match(submitted_username, str(user)):
                    role = discord.utils.get(guild.roles, name=VERIFIED_ROLE_NAME)
                    if role is None:
                        await log_channel.send("❌ Could not find 'Verified' role in the server.")
                        check_sheet.stop()
                        remind_pending.stop()
                        return
                    
                    unverified_role = discord.utils.get(guild.roles, name='Unverified')
                    
                    if member is None:
                        await log_channel.send(f"❌ Could not fetch member object for {user}.")
                        check_sheet.stop()
                        remind_pending.stop()
                        return
                    
                    try:
                        await member.add_roles(role)
                        if unverified_role in member.roles:
                            await member.remove_roles(unverified_role)
                    except Exception as e:
                        await log_channel.send(f\"⚠️ Error assigning roles to {user}: {e}\")
                        check_sheet.stop()
                        remind_pending.stop()
                        return
                    
                    if unverified_role in member.roles:
                        await member.remove_roles(unverified_role)
                    await user.send("🎉 You have been verified!")
                    await log_channel.send(f"✅ {user} verified successfully with code `{code}`.")
                    mark_verified(user.id)
                    check_sheet.stop()
                    remind_pending.stop()
                    return

# [Remind and cleanup tasks unchanged]

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import socket

class KeepAliveHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'Bot is running')

def run_keep_alive():
    port = int(os.environ.get("PORT", 8080))
    server = HTTPServer(("0.0.0.0", port), KeepAliveHandler)
    print(f"Starting keep-alive HTTP server on port {port}...")
    server.serve_forever()

threading.Thread(target=run_keep_alive, daemon=True).start()

bot.run(DISCORD_TOKEN)
