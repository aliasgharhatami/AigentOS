require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { AgentRuntime } = require("./agentRuntime");
const { defaultDataDir } = require("./packageManager");
const { Registry } = require("./catalog/registry");
const { AiProvider } = require("./aiProvider");
const { Orchestrator } = require("./orchestrator");
const { SettingsStore } = require("./settingsStore");

const PORT = process.env.AIGENTOS_CORE_PORT || 4590;

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const runtime = new AgentRuntime();
const registry = new Registry();
const settings = new SettingsStore(defaultDataDir(), runtime.vault);
const ai = new AiProvider(settings.readWithSecrets());
const orchestrator = new Orchestrator(runtime, registry, ai);

function fail(res, err) {
  res.status(400).json({ error: String(err.message || err) });
}

app.get("/health", (_req, res) =>
  res.json({ ok: true, dataDir: defaultDataDir() })
);

// ---- Library ----

app.get("/agents", (_req, res) => res.json(runtime.listAgents()));

app.get("/agents/errors", (_req, res) => res.json(runtime.loadErrors));

app.post("/agents/install", upload.single("package"), async (req, res) => {
  try {
    if (!req.file) throw new Error("No .agent file was uploaded.");
    res.json(await runtime.install(req.file.buffer));
  } catch (err) {
    fail(res, err);
  }
});

app.delete("/agents/:id", async (req, res) => {
  try {
    await runtime.uninstall(req.params.id);
    res.json({ uninstalled: req.params.id });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Setup wizard ----

app.get("/agents/:id/setup", (req, res) => {
  try {
    res.json(runtime.getSetupStatus(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

app.post("/agents/:id/setup", (req, res) => {
  try {
    res.json(runtime.saveSetup(req.params.id, req.body || {}));
  } catch (err) {
    fail(res, err);
  }
});

app.get("/agents/:id/dependencies", async (req, res) => {
  try {
    res.json(await runtime.checkDependencies(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

// ---- Permissions ----

app.post("/agents/:id/permissions/:permission/grant", (req, res) => {
  try {
    runtime.grantPermission(req.params.id, req.params.permission);
    res.json(runtime.permissions.getStatus(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

app.post("/agents/:id/permissions/:permission/revoke", (req, res) => {
  runtime.revokePermission(req.params.id, req.params.permission);
  res.json(runtime.permissions.getStatus(req.params.id));
});

// ---- Lifecycle and use ----

app.post("/agents/:id/start", async (req, res) => {
  try {
    res.json(await runtime.startAgent(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

app.post("/agents/:id/stop", async (req, res) => {
  await runtime.stopAgent(req.params.id);
  res.json({ stopped: req.params.id });
});

app.get("/agents/:id/tools", async (req, res) => {
  try {
    res.json(await runtime.listTools(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

app.post("/agents/:id/tools/:tool", async (req, res) => {
  try {
    res.json(await runtime.callTool(req.params.id, req.params.tool, req.body || {}));
  } catch (err) {
    fail(res, err);
  }
});

// ---- Model settings ----

app.get("/settings/ai", (_req, res) => res.json(ai.status()));

app.post("/settings/ai", (req, res) => {
  try {
    settings.save(req.body || {});
    ai.update(settings.readWithSecrets());
    res.json(ai.status());
  } catch (err) {
    fail(res, err);
  }
});

// ---- Catalogue ----

app.get("/catalog", (_req, res) => res.json(registry.list()));

app.get("/catalog/search", async (req, res) => {
  try {
    const query = req.query.q || "";
    if (req.query.online === "true") {
      res.json(await registry.searchAll(query, 15));
    } else {
      res.json({ results: registry.search(query, 15), notes: [] });
    }
  } catch (err) {
    fail(res, err);
  }
});

app.post("/catalog/:id/install", async (req, res) => {
  try {
    const entry = registry.get(req.params.id);
    if (!entry) throw new Error("That agent is not in the catalogue.");
    res.json(await runtime.installManifest(registry.toManifest(entry)));
  } catch (err) {
    fail(res, err);
  }
});

// ---- Chat orchestration ----

app.post("/chat/plan", async (req, res) => {
  try {
    if (!req.body?.goal) throw new Error("Tell me what you would like to do.");
    res.json(await orchestrator.plan(req.body.goal));
  } catch (err) {
    fail(res, err);
  }
});

app.post("/chat/install", async (req, res) => {
  try {
    const ids = req.body?.agentIds || [];
    if (!ids.length) throw new Error("No agents were selected.");
    res.json({ outcomes: await orchestrator.installPlan(ids) });
  } catch (err) {
    fail(res, err);
  }
});

app.post("/chat/message", async (req, res) => {
  try {
    const messages = req.body?.messages || [];
    if (!messages.length) throw new Error("No message was sent.");
    res.json({ reply: await orchestrator.chat(messages) });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Tasks ----

app.get("/tasks", (_req, res) => res.json(runtime.listTasks()));

app.get("/tasks/:id", (req, res) => {
  const task = runtime.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "not found" });
  res.json(task);
});

const server = app.listen(PORT, () => {
  console.log(`AigentOS core runtime listening on http://127.0.0.1:${PORT}`);
  console.log(`Data directory: ${defaultDataDir()}`);
});

// Child processes must not outlive the core.
function shutdown() {
  for (const id of runtime.sessions.keys()) runtime.stopAgent(id);
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
