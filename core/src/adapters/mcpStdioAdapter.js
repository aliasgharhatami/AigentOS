const { spawn } = require("child_process");

/**
 * McpStdioAdapter
 * ---------------
 * Launches an MCP server as a child process and speaks JSON-RPC 2.0 to it over
 * stdin/stdout, per the Model Context Protocol.
 *
 * This adapter is the reason AigentOS can be useful on day one: hundreds of MCP
 * servers already exist (filesystem, GitHub, Slack, databases, browsers). We do
 * not write those agents — we install, configure, and run them on the user's
 * behalf.
 */
class McpStdioAdapter {
  constructor({ command, args = [], env = {}, cwd }) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
    this.proc = null;
    this.buffer = "";
    this.pending = new Map(); // request id -> {resolve, reject}
    this.nextId = 1;
    this.tools = [];
    this.serverInfo = null;
    this.stderrLog = [];
  }

  async start() {
    this.proc = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // On Windows, npx and similar are shell scripts rather than executables.
      shell: process.platform === "win32",
    });

    this.proc.stdout.on("data", (chunk) => this._onData(chunk));

    // MCP servers use stderr for diagnostics. Keep a bounded tail so a failure
    // can be explained to the user instead of just "it didn't start".
    this.proc.stderr.on("data", (chunk) => {
      this.stderrLog.push(String(chunk));
      if (this.stderrLog.length > 50) this.stderrLog.shift();
    });

    this.proc.on("exit", (code) => {
      const reason = new Error(
        `Agent process exited (code ${code}).` +
          (this.stderrLog.length ? ` Details: ${this.stderrLog.join("").trim().slice(-500)}` : "")
      );
      for (const { reject } of this.pending.values()) reject(reason);
      this.pending.clear();
      this.proc = null;
    });

    this.proc.on("error", (err) => {
      const reason = new Error(`Could not start agent: ${err.message}`);
      for (const { reject } of this.pending.values()) reject(reason);
      this.pending.clear();
    });

    // MCP handshake.
    const init = await this._request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "AigentOS", version: "0.1.0" },
    });
    this.serverInfo = init.serverInfo;
    this._notify("notifications/initialized", {});

    const toolList = await this._request("tools/list", {});
    this.tools = toolList.tools || [];

    return { serverInfo: this.serverInfo, tools: this.tools };
  }

  _onData(chunk) {
    this.buffer += chunk.toString();
    // Messages are newline-delimited JSON.
    let index;
    while ((index = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      try {
        this._onMessage(JSON.parse(line));
      } catch {
        // Not JSON — some servers print banners to stdout. Ignore.
      }
    }
  }

  _onMessage(msg) {
    if (msg.id === undefined) return; // a notification from the server
    const waiter = this.pending.get(msg.id);
    if (!waiter) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      waiter.reject(new Error(msg.error.message || "Agent returned an error."));
    } else {
      waiter.resolve(msg.result);
    }
  }

  _send(payload) {
    if (!this.proc) throw new Error("Agent is not running.");
    this.proc.stdin.write(JSON.stringify(payload) + "\n");
  }

  _notify(method, params) {
    this._send({ jsonrpc: "2.0", method, params });
  }

  _request(method, params, timeoutMs = 60000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Agent did not respond in time (${method}).`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      try {
        this._send({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /** The capabilities this agent exposes — what it can actually do. */
  listTools() {
    return this.tools;
  }

  callTool(name, args) {
    return this._request("tools/call", { name, arguments: args || {} });
  }

  get running() {
    return this.proc !== null;
  }

  stop() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

module.exports = { McpStdioAdapter };
