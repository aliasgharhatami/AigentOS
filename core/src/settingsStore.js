const fs = require("fs");
const path = require("path");

/**
 * SettingsStore
 * -------------
 * Non-secret preferences live in settings.json; the API key does not. It goes
 * to the encrypted vault under a reserved id, so the same protection that
 * covers agent credentials covers the user's model key.
 */

const VAULT_OWNER = "__aigentos_settings__";

class SettingsStore {
  constructor(dataDir, vault) {
    this.file = path.join(dataDir, "settings.json");
    this.vault = vault;
    fs.mkdirSync(dataDir, { recursive: true });
  }

  read() {
    if (!fs.existsSync(this.file)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return {};
    }
  }

  write(settings) {
    fs.writeFileSync(this.file, JSON.stringify(settings, null, 2));
  }

  /** Settings plus the key, for internal use only — never sent to the UI. */
  readWithSecrets() {
    return { ...this.read(), apiKey: this.vault.get(VAULT_OWNER, "apiKey") };
  }

  save(update) {
    const current = this.read();
    const { apiKey, ...rest } = update;

    // An empty key means "keep what's stored", not "erase it" — the UI sends
    // blank when the user didn't retype their key.
    if (apiKey) this.vault.set(VAULT_OWNER, "apiKey", apiKey);

    const merged = { ...current, ...rest };
    this.write(merged);
    return merged;
  }

  clearKey() {
    this.vault.forget(VAULT_OWNER);
  }
}

module.exports = { SettingsStore, VAULT_OWNER };
