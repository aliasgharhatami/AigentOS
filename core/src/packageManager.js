const fs = require("fs");
const path = require("path");
const os = require("os");
const AdmZip = require("adm-zip");

/**
 * PackageManager
 * --------------
 * Owns the on-disk agent library. An agent is a `.agent` file: a zip holding a
 * manifest that describes how to install, configure and launch an agent that
 * exists elsewhere in the world.
 *
 * Separate from AgentRuntime on purpose — this cares about where agents come
 * from and what the user configured; the runtime cares about running them.
 * When the Agent Store arrives it only needs to hand a .agent file to
 * install(), and nothing about execution changes.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const VALID_SETUP_TYPES = ["text", "secret", "folder", "file", "select", "oauth"];
const VALID_RUNTIME_TYPES = ["mcp-stdio", "mcp-http", "process", "http-api"];

function defaultDataDir() {
  return (
    process.env.AIGENTOS_DATA_DIR ||
    (process.platform === "win32"
      ? path.join(os.homedir(), "AppData", "Roaming", "AigentOS")
      : process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support", "AigentOS")
      : path.join(os.homedir(), ".local", "share", "aigentos"))
  );
}

class PackageManager {
  constructor(dataDir = defaultDataDir()) {
    this.dataDir = dataDir;
    this.agentsDir = path.join(dataDir, "agents");
    fs.mkdirSync(this.agentsDir, { recursive: true });
  }

  /**
   * Validate a manifest before trusting it. Error messages are written to be
   * shown to a person, not a developer.
   */
  validateManifest(raw) {
    let manifest;
    try {
      manifest = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      throw new Error("manifest.json is not valid JSON.");
    }

    for (const field of ["id", "name", "version", "description"]) {
      if (!manifest[field] || typeof manifest[field] !== "string") {
        throw new Error(`manifest.json is missing required field: ${field}`);
      }
    }

    if (!ID_PATTERN.test(manifest.id)) {
      throw new Error(
        `Invalid agent id "${manifest.id}". Use lowercase letters, digits and hyphens only.`
      );
    }

    if (!manifest.runtime || !manifest.runtime.type) {
      throw new Error("manifest.json must declare a runtime with a type.");
    }
    if (!VALID_RUNTIME_TYPES.includes(manifest.runtime.type)) {
      throw new Error(
        `Unknown runtime type "${manifest.runtime.type}". Supported: ${VALID_RUNTIME_TYPES.join(", ")}`
      );
    }

    for (const step of manifest.setup || []) {
      if (!step.name) throw new Error("Every setup step needs a name.");
      if (step.type && !VALID_SETUP_TYPES.includes(step.type)) {
        throw new Error(
          `Unknown setup field type "${step.type}". Supported: ${VALID_SETUP_TYPES.join(", ")}`
        );
      }
      if (step.type === "select" && !Array.isArray(step.options)) {
        throw new Error(`Setup step "${step.name}" is a select but has no options.`);
      }
    }

    return manifest;
  }

  installFromFile(filePath) {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    return this.installFromBuffer(fs.readFileSync(filePath));
  }

  installFromBuffer(buffer) {
    let zip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new Error("This is not a valid .agent package (unreadable archive).");
    }

    const entry = zip.getEntry("manifest.json");
    if (!entry) throw new Error("This package has no manifest.json.");

    const manifest = this.validateManifest(zip.readAsText(entry));

    const target = path.join(this.agentsDir, manifest.id);
    // Keep the user's existing setup answers across a reinstall or upgrade —
    // making someone re-enter credentials to update an agent is exactly the
    // friction this product exists to remove.
    const previousConfig = this.readConfig(manifest.id);

    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    zip.extractAllTo(target, true);

    if (Object.keys(previousConfig).length) {
      this.writeConfig(manifest.id, previousConfig);
    }

    return manifest;
  }

  uninstall(agentId) {
    const target = path.join(this.agentsDir, agentId);
    if (!fs.existsSync(target)) {
      throw new Error(`Agent "${agentId}" is not installed.`);
    }
    fs.rmSync(target, { recursive: true, force: true });
  }

  /** Non-secret setup answers. Secrets live in the vault, never here. */
  readConfig(agentId) {
    const file = path.join(this.agentsDir, agentId, "config.json");
    if (!fs.existsSync(file)) return {};
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }

  writeConfig(agentId, config) {
    const dir = path.join(this.agentsDir, agentId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify(config, null, 2)
    );
  }

  agentDir(agentId) {
    return path.join(this.agentsDir, agentId);
  }

  /**
   * Read every installed manifest. A broken package is reported rather than
   * allowed to break the user's other agents.
   */
  loadInstalled() {
    const loaded = [];
    const failed = [];

    for (const entry of fs.readdirSync(this.agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(this.agentsDir, entry.name);
      try {
        const manifest = this.validateManifest(
          fs.readFileSync(path.join(dir, "manifest.json"), "utf8")
        );
        loaded.push({ manifest, dir, config: this.readConfig(manifest.id) });
      } catch (err) {
        failed.push({ id: entry.name, error: String(err.message || err) });
      }
    }

    return { loaded, failed };
  }
}

module.exports = { PackageManager, defaultDataDir };
