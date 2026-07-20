/**
 * HttpApiAdapter
 * --------------
 * Wraps a hosted agent that exposes a plain REST endpoint — a commercial
 * service rather than something running on the user's machine.
 *
 * Included because a meaningful share of the agents an ordinary user would
 * actually want are SaaS products, not local processes. From the user's point
 * of view inside AigentOS they should look identical: install, connect, use.
 */
class HttpApiAdapter {
  constructor({ url, method = "POST", headers = {}, timeoutMs = 120000 }) {
    this.url = url;
    this.method = method;
    this.headers = headers;
    this.timeoutMs = timeoutMs;
  }

  async start() {
    return { serverInfo: { name: this.url }, tools: [] };
  }

  listTools() {
    return [
      {
        name: "run",
        description: "Send a request to this agent.",
        inputSchema: { type: "object", properties: {} },
      },
    ];
  }

  async callTool(_name, args) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.url, {
        method: this.method,
        headers: { "content-type": "application/json", ...this.headers },
        body: this.method === "GET" ? undefined : JSON.stringify(args || {}),
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(
          `The agent's service returned an error (${res.status}). ${text.slice(0, 300)}`
        );
      }
      return { content: [{ type: "text", text }] };
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error("The agent's service did not respond in time.");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  get running() {
    return false;
  }

  stop() {}
}

module.exports = { HttpApiAdapter };
