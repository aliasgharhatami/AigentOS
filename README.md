# AigentOS

**The execution layer for AI-native computing.**

Hundreds of capable AI agents already exist. Almost none of them are usable by
an ordinary person: they require a terminal, a Python environment, a manually
created `.env` file, an API key pasted into a config, an OAuth flow wired by
hand. The agent is not the hard part any more — *setting it up* is.

AigentOS is the layer that removes that friction. It installs, configures,
secures and runs agents that already exist, so using one is a few clicks:
Install, Connect, Allow, Use.

**We do not build agents. We make the world's agents installable.**

## How it works

An agent package (`.agent`) is not code — it is a recipe describing how to
fetch, configure and launch an agent that lives somewhere else: an MCP server,
a GitHub project, a hosted API. The manifest declares what the agent needs
(a folder, an API key, an account login) and AigentOS turns that declaration
into a setup wizard.

```
Install .agent  ->  Answer setup questions  ->  Grant permissions  ->  Use it
```

## Architecture

```
aigentos/
├── core/                     Portable runtime kernel, independent of any UI.
│   ├── adapters/             One per agent kind — this is what makes
│   │   ├── mcpStdioAdapter   existing agents runnable:
│   │   ├── processAdapter      MCP servers, GitHub scripts, hosted APIs.
│   │   └── httpApiAdapter
│   ├── packageManager        Installs .agent recipes, stores user config.
│   ├── credentialVault       Encrypts API keys and tokens at rest.
│   ├── permissionManager     Nothing is granted that wasn't approved.
│   ├── dependencyChecker     "You need Node.js" instead of a stack trace.
│   └── agentRuntime          Setup state, live sessions, task history.
│
└── desktop/                  Windows/Mac shell. Renders what core reports;
                              all logic and security stay in core.
```

The core never depends on the UI, so the same kernel can later run inside a
dedicated Linux distribution without a rewrite.

## Supported agent types

| Runtime | What it runs |
|---|---|
| `mcp-stdio` | A local MCP server (the dominant standard — hundreds exist) |
| `mcp-http` | A remote MCP server |
| `process` | Any Python/Node program, e.g. a GitHub project |
| `http-api` | A hosted commercial agent behind REST |

See `docs/AGENT_PACKAGE_FORMAT.md` for the manifest specification.

## Running locally

```
# Terminal 1 — the kernel
cd core
npm install
npm start

# Terminal 2 — the UI
cd desktop
npm install
npm start
```

Then install one of the bundled recipes in `dist/`:

- `filesystem.agent` — read and organise files in a folder you choose
- `memory.agent` — long-term memory for agents
- `fetch.agent` — read web pages

## Building agent packages

```
node tools/pack.js example-agents/filesystem
-> dist/filesystem.agent
```

## Security model

- Secrets are encrypted at rest and never returned over the API or written to
  config files.
- Every permission an agent declares must be explicitly granted by the user.
- An agent cannot launch until its setup is complete and its permissions are
  approved.
- Agents run as separate processes and are stopped when the core shuts down.

## Status

Working today: installing `.agent` recipes, the setup wizard, the encrypted
vault, dependency checking, launching real MCP servers, discovering their
capabilities, and invoking them with a generated form.

Next: a chat layer that takes a goal in plain language, works out which agents
are needed, installs them, and walks the user through connecting them.

## The Ask tab

Describe a goal in plain language. AigentOS searches the catalogue, proposes a
set of agents with an explanation for each, and — only after you approve —
installs them and shows exactly what is still needed: a folder to point at, an
API key, a permission to grant, a missing prerequisite to download.

Nothing is installed without an explicit yes, and the chat layer has no path to
grant permissions or read credentials that a person clicking buttons would not
have.

## Choosing a model

AigentOS ships with no API key. Each user chooses in Settings:

| Option | Cost | Notes |
|---|---|---|
| Your own OpenAI or Anthropic key | You pay your provider | Best quality; key encrypted locally |
| A local model via Ollama | Free | Private and offline; needs a capable machine |

Shipping a shared publisher key would put every user's usage on one bill and
one credential — so the product does not do it.

## Agent sources

The bundled catalogue contains verified agents that are known to launch. The
catalogue search also queries public MCP registries (tens of thousands of
community servers). Results from those are labelled `community` rather than
`verified`, because nobody has checked that they work.
