const fs = require("fs");
const path = require("path");

class StateStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.state = {
      verifications: {}
    };
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    const raw = fs.readFileSync(this.filePath, "utf8");
    if (!raw.trim()) return;
    this.state = JSON.parse(raw);
    this.state.verifications ||= {};
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  list() {
    return Object.values(this.state.verifications).sort((a, b) => {
      return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
    });
  }

  listPending() {
    return this.list().filter((item) => item.status === "pending");
  }

  listCheckable() {
    return this.list().filter((item) => item.status === "pending" || item.status === "needs_review");
  }

  get(discordUserId) {
    return this.state.verifications[discordUserId] || null;
  }

  findByCode(code) {
    return this.list().find((item) => item.code === String(code) && item.status === "pending") || null;
  }

  hasCode(code) {
    return Boolean(this.list().find((item) => item.code === String(code)));
  }

  upsertPending(discordUserId, code) {
    const now = new Date().toISOString();
    const existing = this.get(discordUserId);
    const continuingPending = existing?.status === "pending";
    const record = {
      discordUserId,
      code,
      status: "pending",
      createdAt: continuingPending ? existing.createdAt : now,
      updatedAt: now,
      attempts: continuingPending ? existing.attempts || 0 : 0
    };
    this.state.verifications[discordUserId] = record;
    this.save();
    return record;
  }

  touchCheck(discordUserId) {
    const record = this.get(discordUserId);
    if (!record) return null;
    record.attempts = (record.attempts || 0) + 1;
    record.lastCheckedAt = new Date().toISOString();
    record.updatedAt = record.lastCheckedAt;
    this.save();
    return record;
  }

  markVerified(discordUserId, details = {}) {
    return this.mark(discordUserId, "verified", details);
  }

  markRejected(discordUserId, details = {}) {
    return this.mark(discordUserId, "rejected", details);
  }

  mark(discordUserId, status, details = {}) {
    const now = new Date().toISOString();
    const existing = this.get(discordUserId) || {
      discordUserId,
      code: details.code || null,
      createdAt: now
    };
    this.state.verifications[discordUserId] = {
      ...existing,
      ...details,
      status,
      updatedAt: now
    };
    this.save();
    return this.state.verifications[discordUserId];
  }

  expireOldPending(ttlMinutes) {
    const now = Date.now();
    const expired = [];
    for (const record of this.listPending()) {
      const createdAt = new Date(record.createdAt).getTime();
      if (Number.isFinite(createdAt) && now - createdAt > ttlMinutes * 60 * 1000) {
        this.markRejected(record.discordUserId, {
          reason: "Verification code expired",
          source: "system"
        });
        expired.push(record.discordUserId);
      }
    }
    return expired;
  }
}

module.exports = {
  StateStore
};
