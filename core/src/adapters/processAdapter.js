const { execFile } = require("child_process");

/**
 * ProcessAdapter
 * --------------
 * Runs an agent that is just a program: a Python script, a Node CLI, anything
 * published on GitHub before MCP existed. It is invoked once per task, given
 * arguments, and its stdout is the result.
 *
 * This is deliberately simpler than the MCP adapter — there is no handshake and
 * no tool discovery, because these agents do not describe themselves. The
 * manifest has to say what they accept. It exists so that the large body of
 * pre-MCP agents on GitHub is not locked out of AigentOS.
 */
class ProcessAdapter {
  constructor({ command, args = [], env = {}, cwd, timeoutMs = 120000 }) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
  }

  async start() {
    // Nothing to hold open — this agent type is invoked per task.
    return { serverInfo: { name: this.command }, tools: [] };
  }

  listTools() {
    return [
      {
        name: "run",
        description: "Run this agent.",
        inputSchema: { type: "object", properties: {} },
      },
    ];
  }

  callTool(_name, _args) {
    return new Promise((resolve, reject) => {
      execFile(
        this.command,
        this.args,
        {
          cwd: this.cwd,
          env: { ...process.env, ...this.env },
          timeout: this.timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
          shell: process.platform === "win32",
        },
        (err, stdout, stderr) => {
          if (err) {
            return reject(
              new Error(
                err.killed
                  ? "The agent took too long and was stopped."
                  : `The agent failed: ${String(stderr || err.message).trim().slice(0, 500)}`
              )
            );
          }
          resolve({ content: [{ type: "text", text: String(stdout).trim() }] });
        }
      );
    });
  }

  get running() {
    return false; // Started per call, not held open.
  }

  stop() {}
}

module.exports = { ProcessAdapter };
