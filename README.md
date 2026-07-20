# AigentOS

An operating system for running AI agents — install and use with a few clicks, built for everyday users, not just developers.

## Architecture (why this structure?)

From day one the project is split into two fully independent pieces, so the core can later be embedded in a dedicated Linux distribution without any rewrite — making it a true Windows/Mac replacement down the road:aigentos/
├── core/ <- Portable runtime kernel (independent of any UI)
│ Today it's a local service running on http://127.0.0.1:4590.
│ Responsible for: installing/running agents, the Permission System,
│ and the Task Manager (run history).
│ Any shell (Electron today, a native Linux desktop tomorrow) talks
│ to it only through this API.
│
└── desktop/ <- Windows/Mac presentation layer (Electron)
Intentionally "dumb" -- it only renders what core reports and
forwards user actions (run, grant permission) back to core.Key principle: all logic and security live inside core, not the UI. A broken or malicious shell can never grant itself a permission the user didn't approve.

## Running locally (for testing)

### 1. Start the core runtimecd core
npm install
npm startWorks with zero setup -- no API key required (mock mode). To use a real model, copy core/.env.example to core/.env and fill in AIGENTOS_LLM_API_KEY.

### 2. Launch the desktop app (in a new terminal)cd desktop
npm install
npm startA window opens showing installed agents (currently one example "Summarizer Agent"), their required permissions, and a simple Task Manager that logs every run with its result or error.

## First agent: Summarizer

core/src/agents/summarizerAgent.js is an example of what an "agent package" looks like in code -- a manifest (metadata + required permissions) plus a run function. This pattern is the basis for the future .agent package format.

## Suggested next steps

- [ ] Formal .agent package format (a zip containing manifest.json + code)
- [ ] Install/uninstall agents from a local folder instead of hardcoding them in index.js
- [ ] A few more example agents (research, legal) to demonstrate the Workflow Engine
- [ ] Windows/Mac installer packaging with electron-builder
