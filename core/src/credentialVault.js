const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * CredentialVault
 * ---------------
 * Stores the secrets a user supplies during agent setup — API keys, OAuth
 * tokens, passwords — encrypted at rest.
 *
 * The whole point of AigentOS is that a person enters a credential once,
 * clicking a field, and never thinks about it again. That only works if we
 * hold those secrets responsibly: they are never written to config.json,
 * never returned over the API, and never logged.
 *
 * The master key is generated on first run and stored with owner-only
 * permissions. This protects against casual exposure — a synced folder, a
 * backup, another user account on the machine. It is not protection against
 * an attacker who already has full control of the user's account; that
 * requires an OS keychain, which is a planned improvement.
 */

const ALGORITHM = "aes-256-gcm";

class CredentialVault {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.vaultPath = path.join(dataDir, "vault.enc");
    this.keyPath = path.join(dataDir, "vault.key");
    fs.mkdirSync(dataDir, { recursive: true });
    this.key = this._loadOrCreateKey();
  }

  _loadOrCreateKey() {
    if (fs.existsSync(this.keyPath)) {
      return Buffer.from(fs.readFileSync(this.keyPath, "utf8"), "hex");
    }
    const key = crypto.randomBytes(32);
    fs.writeFileSync(this.keyPath, key.toString("hex"), { mode: 0o600 });
    return key;
  }

  _readAll() {
    if (!fs.existsSync(this.vaultPath)) return {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.vaultPath, "utf8"));
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        this.key,
        Buffer.from(raw.iv, "hex")
      );
      decipher.setAuthTag(Buffer.from(raw.tag, "hex"));
      const plain =
        decipher.update(Buffer.from(raw.data, "hex"), undefined, "utf8") +
        decipher.final("utf8");
      return JSON.parse(plain);
    } catch {
      // A corrupt or unreadable vault must not take the whole runtime down.
      return {};
    }
  }

  _writeAll(store) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(store), "utf8"),
      cipher.final(),
    ]);
    fs.writeFileSync(
      this.vaultPath,
      JSON.stringify({
        iv: iv.toString("hex"),
        tag: cipher.getAuthTag().toString("hex"),
        data: data.toString("hex"),
      }),
      { mode: 0o600 }
    );
  }

  set(agentId, name, value) {
    const store = this._readAll();
    store[agentId] = store[agentId] || {};
    store[agentId][name] = value;
    this._writeAll(store);
  }

  get(agentId, name) {
    return this._readAll()[agentId]?.[name];
  }

  /** All secrets for one agent — used only when launching it. */
  getAll(agentId) {
    return this._readAll()[agentId] || {};
  }

  /** Which secret names are set, without revealing the values. Safe for the UI. */
  listNames(agentId) {
    return Object.keys(this._readAll()[agentId] || {});
  }

  has(agentId, name) {
    return this.get(agentId, name) !== undefined;
  }

  forget(agentId) {
    const store = this._readAll();
    delete store[agentId];
    this._writeAll(store);
  }
}

module.exports = { CredentialVault };
