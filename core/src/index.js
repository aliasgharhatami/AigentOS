require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { AgentRuntime } = require("./agentRuntime");

const PORT = process.env.AIGENTOS_CORE_PORT || 4590;

const app = express();
app.use(cors());
app.use(express.json());

const runtime = new AgentRuntime();

// Register built-in example agent(s). Later this becomes "load every
// .agent package found in the local agents/ install directory".
runtime.installAgent(require("./agents/summarizerAgent"));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/agents", (_req, res) => {
  res.json(runtime.listAgents());
});

app.post("/agents/:id/permissions/:permission/grant", (req, res) => {
  try {
    runtime.grantPermission(req.params.id, req.params.permission);
    res.json(runtime.permissions.getStatus(req.params.id));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.post("/agents/:id/run", async (req, res) => {
  try {
    const task = await runtime.runAgent(req.params.id, req.body || {});
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.get("/tasks", (_req, res) => {
  res.json(runtime.listTasks());
});

app.get("/tasks/:id", (req, res) => {
  const task = runtime.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "not found" });
  res.json(task);
});

app.listen(PORT, () => {
  console.log(`AigentOS core runtime listening on http://127.0.0.1:${PORT}`);
});
