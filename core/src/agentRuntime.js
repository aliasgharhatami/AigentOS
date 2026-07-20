const { v4: uuid } = require("uuid");
const { PackageManager, defaultDataDir } = require("./packageManager");
const { CredentialVault } = require("./credentialVault");
const { PermissionManager } = require("./permissionManager");
const { createAdapter } = require("./adapters");
const { checkRequirements } = require("./dependencyChecker");

/**
 * AgentRuntime
 * ------------
 * The kernel. Holds installed agents, their setup state, their live processes,
 * and the task history.
 *
 * The central idea: an agent is ready to use only when every required setup
 * step has an answer. Until then the runtime refuses to launch it and reports
 * exactly what is missing, so the UI can walk the user through a wizard rather
 * than showing them a failure.
 */
class AgentRuntime {
  constructor(dataDir = defaultDataDir()) {
    this.packages = new PackageManager(dataDir);
    this.vault = new CredentialVault(dataDir);
    this.permissions = new PermissionManager();
    this.agents = new Map(); // id -> { manifest, dir, config }
    this.sessions = new Map(); // id -> live adapter
    this.tasks = new Map();
    this.loadErrors = [];
    this.reload();
  }

  reload() {
    const { loaded, failed } = this.packages.loadInstalled();
    this.agents.clear();
    for (const agent of loaded) {
      this.agents.set(agent.manifest.id, agent);
      const previouslyGranted = [
        ...(this.permissions.grants.get(agent.manifest.id) || []),
      ];
      this.permissions.declare(agent.manifest.id, agent.manifest.permissions || []);
      for (const p of previouslyGranted) {
        if ((agent.manifest.permissions || []).includes(p)) {
          this.permissions.grant(agent.manifest.id, p);
        }
      }
    }
    this.loadErrors = failed;
    return { installed: loaded.length, failed };
  }

  async install(buffer) {
    const manifest = this.packages.installFromBuffer(buffer);
    this.reload();
    // Report missing dependencies immediately so the UI can offer to fix them
    // during setup rather than at first failed launch.
    const dependencies = await checkRequirements(manifest.runtime.requires || []);
    return { manifest, dependencies, setupStatus: this.getSetupStatus(manifest.id) };
  }

  /**
   * Install directly from a manifest object rather than a .agent file — used by
   * the chat layer when it installs something from the catalogue on the user's
   * behalf. Deliberately goes through the same PackageManager path as a file
   * install so validation and config preservation behave identically.
   */
  async installManifest(manifest) {
    const AdmZip = require("adm-zip");
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
    return this.install(zip.toBuffer());
  }

  async uninstall(agentId) {
    await this.stopAgent(agentId);
    this.packages.uninstall(agentId);
    this.vault.forget(agentId);
    this.permissions.forget(agentId);
    this.reload();
  }

  /**
   * What still stands between this agent and being usable. This drives the
   * setup wizard — it is the difference between "it doesn't work" and
   * "click Connect to finish".
   */
  getSetupStatus(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);

    const steps = (agent.manifest.setup || []).map((step) => {
      const isSecret = step.type === "secret" || step.type === "oauth";
      const answered = isSecret
        ? this.vault.has(agentId, step.name)
        : agent.config[step.name] !== undefined && agent.config[step.name] !== "";
      return {
        ...step,
        type: step.type || "text",
        answered,
        // Never send stored secrets back out; only whether they are set.
        value: isSecret ? undefined : agent.config[step.name],
      };
    });

    const missing = steps.filter((s) => s.required && !s.answered);
    return { agentId, steps, missing, ready: missing.length === 0 };
  }

  /** Save the user's answers from the setup wizard. */
  saveSetup(agentId, answers) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);

    const declared = new Map(
      (agent.manifest.setup || []).map((s) => [s.name, s])
    );
    const config = { ...agent.config };

    for (const [name, value] of Object.entries(answers)) {
      const step = declared.get(name);
      if (!step) continue; // ignore anything the manifest didn't ask for
      if (step.type === "secret" || step.type === "oauth") {
        this.vault.set(agentId, name, value);
      } else {
        config[name] = value;
      }
    }

    this.packages.writeConfig(agentId, config);
    agent.config = config;
    return this.getSetupStatus(agentId);
  }

  async checkDependencies(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    return checkRequirements(agent.manifest.runtime.requires || []);
  }

  /** Launch the agent and discover what it can do. */
  async startAgent(agentId) {
    const existing = this.sessions.get(agentId);
    if (existing && existing.running) {
      return { alreadyRunning: true, tools: existing.listTools() };
    }

    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);

    const setup = this.getSetupStatus(agentId);
    if (!setup.ready) {
      throw new Error(
        `Finish setup first — still needed: ${setup.missing.map((s) => s.label || s.name).join(", ")}`
      );
    }

    const pendingPermissions = this.permissions.getStatus(agentId).pending;
    if (pendingPermissions.length > 0) {
      throw new Error(
        `Grant permissions first: ${pendingPermissions.join(", ")}`
      );
    }

    const deps = await this.checkDependencies(agentId);
    if (!deps.satisfied) {
      throw new Error(
        deps.missing.map((d) => d.message).join(" ")
      );
    }

    const values = { ...agent.config, ...this.vault.getAll(agentId) };
    const adapter = createAdapter(agent.manifest.runtime, values, agent.dir);
    const info = await adapter.start();
    this.sessions.set(agentId, adapter);
    return { serverInfo: info.serverInfo, tools: adapter.listTools() };
  }

  async stopAgent(agentId) {
    const adapter = this.sessions.get(agentId);
    if (adapter) {
      adapter.stop();
      this.sessions.delete(agentId);
    }
  }

  /** The capabilities an agent exposes, starting it if needed. */
  async listTools(agentId) {
    if (!this.sessions.has(agentId)) await this.startAgent(agentId);
    return this.sessions.get(agentId).listTools();
  }

  /** Invoke one capability of an agent, recording it as a task. */
  async callTool(agentId, toolName, args) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);

    if (!this.sessions.has(agentId)) await this.startAgent(agentId);
    const adapter = this.sessions.get(agentId);

    const task = {
      id: uuid(),
      agentId,
      agentName: agent.manifest.name,
      tool: toolName,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
      error: null,
    };
    this.tasks.set(task.id, task);

    try {
      task.result = await adapter.callTool(toolName, args);
      task.status = "completed";
    } catch (err) {
      task.status = "failed";
      task.error = String(err.message || err);
    } finally {
      task.finishedAt = new Date().toISOString();
    }

    return task;
  }

  listAgents() {
    return [...this.agents.values()].map((a) => {
      const setup = this.getSetupStatus(a.manifest.id);
      const session = this.sessions.get(a.manifest.id);
      return {
        id: a.manifest.id,
        name: a.manifest.name,
        version: a.manifest.version,
        description: a.manifest.description,
        author: a.manifest.author,
        homepage: a.manifest.homepage,
        runtimeType: a.manifest.runtime.type,
        permissionStatus: this.permissions.getStatus(a.manifest.id),
        setupReady: setup.ready,
        missingSetup: setup.missing.map((s) => s.label || s.name),
        running: Boolean(session && session.running),
      };
    });
  }

  grantPermission(agentId, permission) {
    this.permissions.grant(agentId, permission);
  }

  revokePermission(agentId, permission) {
    this.permissions.revoke(agentId, permission);
  }

  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  listTasks() {
    return [...this.tasks.values()].sort((a, b) =>
      a.startedAt < b.startedAt ? 1 : -1
    );
  }
}

module.exports = { AgentRuntime };
