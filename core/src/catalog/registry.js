const bundled = require("./bundled.json");

/**
 * Registry
 * --------
 * The catalogue of agents a user can install. Two sources:
 *
 *   1. A bundled list of verified, working agents. Ships with the app, needs no
 *      network, and is what the chat layer picks from by default. Every entry
 *      here has been checked to actually launch.
 *
 *   2. Live public MCP directories (tens of thousands of servers). Far broader,
 *      but community-submitted and unverified — so results are marked as such
 *      and never auto-installed without the user seeing where they came from.
 *
 * This split matters: the promise of AigentOS is "it just works". An
 * unreviewed registry entry that fails on launch breaks that promise, so
 * curated results always rank above discovered ones.
 */

const REGISTRY_SOURCES = [
  {
    name: "Official MCP Registry",
    url: "https://registry.modelcontextprotocol.io/v0/servers",
    parse: parseOfficialRegistry,
  },
];

function parseOfficialRegistry(data) {
  const servers = data.servers || data || [];
  return servers.map((s) => {
    const pkg = (s.packages || [])[0] || {};
    return {
      id: slugify(s.name || pkg.name || "unknown"),
      name: prettyName(s.name || pkg.name),
      description: s.description || "",
      author: (s.name || "").split("/")[0]?.replace(/^io\.github\./, "") || "",
      homepage: s.repository?.url || s.websiteUrl,
      source: "Official MCP Registry",
      verified: false,
      // A recipe we can attempt, derived from the registry's package info.
      runtime: buildRuntimeFromPackage(pkg),
      setup: [],
      permissions: [],
    };
  });
}

function buildRuntimeFromPackage(pkg) {
  const registry = pkg.registryType || pkg.registry_name;
  const name = pkg.identifier || pkg.name;
  if (!name) return null;

  if (registry === "npm") {
    return {
      type: "mcp-stdio",
      command: "npx",
      args: ["-y", name],
      requires: ["node"],
    };
  }
  if (registry === "pypi") {
    return {
      type: "mcp-stdio",
      command: "uvx",
      args: [name],
      requires: ["python3"],
    };
  }
  return null;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/^io\.github\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "agent";
}

function prettyName(text) {
  const last = String(text || "").split("/").pop() || "";
  return last
    .replace(/^mcp-server-|-mcp-server$|^server-/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "Agent";
}

/** Score how well an agent matches a plain-language query. */
function score(agent, terms) {
  const haystack = [
    agent.name,
    agent.description,
    agent.category,
    ...(agent.keywords || []),
  ]
    .join(" ")
    .toLowerCase();

  let total = 0;
  for (const term of terms) {
    if (!term) continue;
    if ((agent.keywords || []).some((k) => k.toLowerCase() === term)) total += 5;
    else if (agent.name.toLowerCase().includes(term)) total += 4;
    else if (haystack.includes(term)) total += 2;
  }
  return total;
}

class Registry {
  constructor() {
    this.bundled = bundled.agents;
    this.discoveredCache = null;
    this.cacheTime = 0;
  }

  list() {
    return this.bundled.map((a) => ({ ...a, verified: true, source: "Bundled" }));
  }

  get(id) {
    return this.bundled.find((a) => a.id === id);
  }

  /**
   * Search the bundled catalogue. Fast, offline, and every hit is known good.
   */
  search(query, limit = 10) {
    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return this.list().slice(0, limit);

    return this.bundled
      .map((a) => ({ agent: a, score: score(a, terms) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => ({ ...r.agent, verified: true, source: "Bundled", score: r.score }));
  }

  /**
   * Search the wider public registries. Requires network; results are
   * unverified. Failures are returned as a note rather than thrown, because a
   * directory being down should never block the bundled catalogue.
   */
  async searchOnline(query, limit = 10) {
    const results = [];
    const notes = [];

    // Fetched in parallel with a hard ceiling — a slow or unreachable
    // directory must never hold up the user's request.
    const fetches = REGISTRY_SOURCES.map(async (source) => {
      try {
        const url = `${source.url}?limit=100${query ? `&search=${encodeURIComponent(query)}` : ""}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) throw new Error(`${res.status}`);
        const parsed = source.parse(await res.json());
        results.push(...parsed.filter((a) => a.runtime));
      } catch (err) {
        notes.push(`${source.name} unavailable (${err.message || "timed out"}).`);
      }
    });

    await Promise.race([
      Promise.allSettled(fetches),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);

    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    const ranked = terms.length
      ? results
          .map((a) => ({ agent: a, score: score(a, terms) }))
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((r) => r.agent)
      : results;

    return { results: ranked.slice(0, limit), notes };
  }

  /**
   * Combined search: verified entries first, then discovered ones to fill out
   * the list. The chat layer uses this so it can always answer, while being
   * honest about which suggestions are vetted.
   */
  async searchAll(query, limit = 10) {
    const curated = this.search(query, limit);
    if (curated.length >= limit) return { results: curated, notes: [] };

    const { results: online, notes } = await this.searchOnline(
      query,
      limit - curated.length
    );
    const seen = new Set(curated.map((a) => a.id));
    return {
      results: [...curated, ...online.filter((a) => !seen.has(a.id))],
      notes,
    };
  }

  /** Turn a catalogue entry into the manifest the package manager installs. */
  toManifest(entry) {
    if (!entry.runtime) {
      throw new Error(
        `"${entry.name}" doesn't publish enough information to install automatically.`
      );
    }
    return {
      id: entry.id,
      name: entry.name,
      version: entry.version || "1.0.0",
      description: entry.description || entry.name,
      author: entry.author,
      homepage: entry.homepage,
      runtime: entry.runtime,
      setup: entry.setup || [],
      permissions: entry.permissions || [],
    };
  }
}

module.exports = { Registry };
