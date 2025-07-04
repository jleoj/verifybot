import discord
from discord.ext import commands, tasks
import random
import string
import datetime
from google.oauth2 import service_account
from googleapiclient.discovery import build
import os
from dotenv import load_dotenv
import difflib

# === LOAD ENVIRONMENT ===
ALLOWED_DOMAINS = os.getenv('ALLOWED_DOMAINS', '').split(',')
load_dotenv()
DISCORD_TOKEN = os.getenv('DISCORD_TOKEN')
GUILD_ID = int(os.getenv('GUILD_ID'))
VERIFIED_ROLE_NAME = 'Verified'
LOG_CHANNEL_ID = int(os.getenv('LOG_CHANNEL_ID'))
COMMAND_CHANNEL_ID = int(os.getenv('COMMAND_CHANNEL_ID'))
GOOGLE_FORM_LINK = os.getenv('GOOGLE_FORM_LINK')
GOOGLE_SHEET_ID = os.getenv('GOOGLE_SHEET_ID')
SHEET_RANGE = 'Bot Records!A2:E'
SERVICE_ACCOUNT_FILE = os.getenv('SERVICE_ACCOUNT_FILE')

# === DISCORD SETUP ===
intents = discord.Intents.default()
intents.members = True
intents.message_content = True
bot = commands.Bot(command_prefix='!', intents=intents)

# === CHANNEL CHECK DECORATOR ===
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

# === GOOGLE SHEETS SETUP ===
SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
creds = service_account.Credentials.from_service_account_file(
    SERVICE_ACCOUNT_FILE, scopes=SCOPES)
sheets_service = build('sheets', 'v4', credentials=creds)

# === UTILITY FUNCTIONS ===
def generate_code(length=8):
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))

def get_rows():
    result = sheets_service.spreadsheets().values().get(
        spreadsheetId=GOOGLE_SHEET_ID,
        range=SHEET_RANGE
    ).execute()
    return result.get('values', [])

def append_row(row):
    sheets_service.spreadsheets().values().append(
        spreadsheetId=GOOGLE_SHEET_ID,
        range='Bot Records!A2',
        valueInputOption='RAW',
        body={'values': [row]}
    ).execute()

def update_verified(user_id):
    rows = get_rows()
    for i, row in enumerate(rows):
        if len(row) > 3 and row[3] == str(user_id):
            sheets_service.spreadsheets().values().update(
                spreadsheetId=GOOGLE_SHEET_ID,
                range=f'Bot Records!E{i+2}',
                valueInputOption='RAW',
                body={'values': [['1']]}
            ).execute()
            break

def is_user_verified(user_id):
    rows = get_rows()
    for row in rows:
        if len(row) > 3 and row[3] == str(user_id) and len(row) > 4 and row[4] == '1':
            return True
    return False

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

    try:
        rows = get_rows()
        for row in rows:
            if len(row) >= 5:
                code, submitted_username, expires_at_str, user_id_str, verified_flag = row
                if user_id_str == str(user.id) and verified_flag == '0':
                    if datetime.datetime.utcnow() > datetime.datetime.fromisoformat(expires_at_str):
                        await user.send("❌ Your verification code has expired. Please run `!verify` again.")
                        await log_channel.send(f"⏱️ Code expired for {user}.")
                        check_sheet.stop()
                        return
                    if fuzzy_match(submitted_username, str(user)):
                    email = row[3].strip().lower()
                        if not any(email.endswith(f"@{domain.strip().lower()}") for domain in ALLOWED_DOMAINS if domain):
                            await user.send("❌ Your email domain is not allowed. Verification denied.")
                            await log_channel.send(f"❌ {user} used disallowed email domain: {email}")
                            check_sheet.stop()
                            return
                        try:
                            member = await guild.fetch_member(user.id)
                            role = discord.utils.get(guild.roles, name=VERIFIED_ROLE_NAME)
                            unverified_role = discord.utils.get(guild.roles, name='Unverified')
                            if role:
                                await member.add_roles(role)
                            if unverified_role and unverified_role in member.roles:
                                await member.remove_roles(unverified_role)
                            await user.send("🎉 You have been verified!")
                            await log_channel.send(f"✅ {user} verified successfully with code `{code}`.")
                            update_verified(user.id)
                            check_sheet.stop()
                            return
                        except discord.NotFound:
                            await log_channel.send(f"❌ Could not find member {user} in guild.")
                            check_sheet.stop()
                            return
    except Exception as e:
        await log_channel.send(f"⚠️ Error during verification check: {e}")
        check_sheet.stop()

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

