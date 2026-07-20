# The `.agent` Package Format v0.2

**What changed from v0.1:** an agent package no longer contains agent code. It
is a *recipe* describing how to install, configure, and launch an agent that
already exists in the world — an MCP server, a GitHub project, a hosted API.

AigentOS does not build agents. It makes existing agents installable and usable
by an ordinary person who will never open a terminal.

## Layout

```
gmail-assistant.agent          (a ZIP archive)
├── manifest.json              (required)
└── icon.png                   (optional)
```

No `index.js`. The agent's actual code lives wherever its author published it.

## manifest.json

```json
{
  "id": "filesystem",
  "name": "File Manager",
  "version": "0.1.0",
  "description": "Lets agents read and organise files in a folder you choose.",
  "author": "Anthropic",
  "homepage": "https://github.com/modelcontextprotocol/servers",

  "runtime": {
    "type": "mcp-stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "{{folder}}"],
    "requires": ["node"]
  },

  "setup": [
    {
      "name": "folder",
      "label": "Which folder should this agent be allowed to access?",
      "type": "folder",
      "required": true,
      "help": "The agent can only see files inside this folder."
    }
  ],

  "permissions": ["filesystem"]
}
```

## Runtime types

The `runtime.type` field tells the core *how* to start this agent. Each type is
handled by a separate adapter, so adding support for a new kind of agent never
touches the rest of the system.

### `mcp-stdio`
An MCP server launched as a local process, speaking JSON-RPC over stdin/stdout.
This is the dominant standard — hundreds of ready-made servers exist.

```json
"runtime": {
  "type": "mcp-stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "{{folder}}"],
  "requires": ["node"]
}
```

### `mcp-http`
A remote MCP server reached over HTTP. Nothing to install locally.

```json
"runtime": {
  "type": "mcp-http",
  "url": "https://mcp.example.com/sse",
  "headers": { "Authorization": "Bearer {{api_key}}" }
}
```

### `process`
A plain program or script — a Python or Node project from GitHub. Used for
agents that predate MCP or expose their own CLI.

```json
"runtime": {
  "type": "process",
  "install": {
    "source": "git",
    "url": "https://github.com/example/some-agent",
    "setup": ["pip install -r requirements.txt"]
  },
  "command": "python",
  "args": ["main.py", "--input", "{{input}}"],
  "requires": ["python3"]
}
```

### `http-api`
A hosted commercial agent behind a REST endpoint.

```json
"runtime": {
  "type": "http-api",
  "method": "POST",
  "url": "https://api.example.com/v1/run",
  "headers": { "Authorization": "Bearer {{api_key}}" }
}
```

## The `setup` block — the heart of the product

This is what turns a developer-only tool into something an ordinary person can
use. Each entry becomes one step in a setup wizard. The user clicks through;
they never edit a config file.

| Type | Rendered as | Stored |
|---|---|---|
| `text` | A text box | Plain, in agent config |
| `secret` | A masked field | Encrypted in the credential vault |
| `folder` | A folder picker | Plain |
| `file` | A file picker | Plain |
| `select` | A dropdown (needs `options`) | Plain |
| `oauth` | A "Connect" button opening the provider's login | Token, encrypted in the vault |

Example of an OAuth step:

```json
{
  "name": "google_account",
  "label": "Connect your Google account",
  "type": "oauth",
  "provider": "google",
  "scopes": ["https://www.googleapis.com/auth/gmail.readonly"],
  "required": true
}
```

Any `{{placeholder}}` appearing in `runtime.command`, `args`, `url`, or
`headers` is substituted with the value the user supplied during setup.
Secrets are injected at launch time and never written to disk in plain text.

## Dependencies

`runtime.requires` lists what must be present on the machine — `node`,
`python3`, `docker`. The core checks for these *before* installing and, if
something is missing, tells the user in plain language and offers to install it
rather than failing with a stack trace.

## Installation

```
<userData>/agents/<agent-id>/
├── manifest.json
├── config.json        (non-secret setup answers)
└── icon.png
```

Secrets live separately in the encrypted vault, keyed by agent id — never in
`config.json`.
