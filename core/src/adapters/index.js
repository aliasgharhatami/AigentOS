const { McpStdioAdapter } = require("./mcpStdioAdapter");
const { ProcessAdapter } = require("./processAdapter");
const { HttpApiAdapter } = require("./httpApiAdapter");

/**
 * createAdapter
 * -------------
 * Turns a manifest's `runtime` block plus the user's setup answers into a live
 * adapter, ready to start.
 *
 * The `{{placeholder}}` substitution is where the product promise is kept: the
 * manifest author writes `{{api_key}}`, the user typed it into a labelled box
 * once, and neither of them ever touched a config file or an environment
 * variable.
 */

function substitute(value, values) {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (match, name) => {
      const replacement = values[name];
      if (replacement === undefined) {
        throw new Error(
          `This agent needs a value for "${name}" that hasn't been set up yet.`
        );
      }
      return replacement;
    });
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, values));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v, values);
    return out;
  }
  return value;
}

/**
 * @param runtime  the manifest's runtime block
 * @param values   merged setup answers (config + decrypted secrets)
 * @param cwd      where the agent's files were installed, if any
 */
function createAdapter(runtime, values = {}, cwd) {
  if (!runtime || !runtime.type) {
    throw new Error("This agent's manifest has no runtime type.");
  }

  const resolved = substitute(runtime, values);

  switch (runtime.type) {
    case "mcp-stdio":
      return new McpStdioAdapter({
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
        cwd,
      });

    case "mcp-http":
      // A remote MCP server is reached over HTTP; treated as an API surface
      // until full SSE transport lands.
      return new HttpApiAdapter({
        url: resolved.url,
        headers: resolved.headers,
      });

    case "process":
      return new ProcessAdapter({
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
        cwd,
      });

    case "http-api":
      return new HttpApiAdapter({
        url: resolved.url,
        method: resolved.method,
        headers: resolved.headers,
      });

    default:
      throw new Error(`Unsupported agent runtime type: "${runtime.type}".`);
  }
}

module.exports = { createAdapter, substitute };
