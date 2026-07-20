const { v4: uuid } = require("uuid");
const { PermissionManager } = require("./permissionManager");

/**
 * AgentRuntime
 * ------------
 * The kernel's core loop: keeps a registry of installed agents, and a log
 * of every run (task) so the shell can render something like a Task Manager
 * (status, duration, errors) — the same data model works whether the shell
 * is today's Electron app or tomorrow's native Linux desktop.
 */
class AgentRuntime {
  constructor() {
    this.agents = new Map(); // agentId -> agent module
    this.tasks = new Map(); // taskId -> task record
    this.permissions = new PermissionManager();
  }

  installAgent(agentModule) {
    const { manifest } = agentModule;
    this.agents.set(manifest.id, agentModule);
    this.permissions.declare(manifest.id, manifest.permissions || []);
    return manifest;
  }

  listAgents() {
    return [...this.agents.values()].map((a) => ({
      ...a.manifest,
      permissionStatus: this.permissions.getStatus(a.manifest.id),
    }));
  }

  grantPermission(agentId, permission) {
    this.permissions.grant(agentId, permission);
  }

  async runAgent(agentId, input) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);

    const pending = this.permissions.getStatus(agentId).pending;
    if (pending.length > 0) {
      throw new Error(
        `Agent "${agentId}" is missing permissions: ${pending.join(", ")}. ` +
        `Grant them before running.`
      );
    }

    const taskId = uuid();
    const task = {
      id: taskId,
      agentId,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      logs: [],
      result: null,
      error: null,
    };
    this.tasks.set(taskId, task);

    const ctx = {
      log: (msg) => task.logs.push({ at: new Date().toISOString(), msg }),
      hasPermission: (p) => this.permissions.has(agentId, p),
    };

    try {
      const result = await agent.run(input, ctx);
      task.status = "completed";
      task.result = result;
    } catch (err) {
      task.status = "failed";
      task.error = String(err.message || err);
    } finally {
      task.finishedAt = new Date().toISOString();
    }

    return task;
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
