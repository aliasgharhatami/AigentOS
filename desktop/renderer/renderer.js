const CORE_URL =
  (window.aigentos && window.aigentos.coreUrl) || "http://127.0.0.1:4590";

const $ = (id) => document.getElementById(id);
const expanded = new Set();
const toolCache = new Map();
let chatHistory = [];

async function api(path, options) {
  const res = await fetch(CORE_URL + path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------- Tabs ----------

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    $(`view-${tab.dataset.view}`).classList.add("active");
    if (tab.dataset.view === "catalog") searchCatalog();
    if (tab.dataset.view === "settings") renderSettings();
    if (tab.dataset.view === "agents") refreshAgents();
  });
});

// ---------- Chat: goal -> plan -> install -> setup ----------

function addMessage(kind, html) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.innerHTML = html;
  $("chat-log").appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return div;
}

async function sendGoal() {
  const input = $("chat-input");
  const goal = input.value.trim();
  if (!goal) return;
  input.value = "";
  addMessage("user", esc(goal));

  const thinking = addMessage("bot", "Looking for agents that can do this...");

  try {
    const plan = await api("/chat/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal }),
    });

    if (!plan.agents.length) {
      thinking.innerHTML = esc(
        plan.missing || "I couldn't find an agent for that yet."
      );
      return;
    }

    // Show the plan and let the person approve it. Installing software
    // without an explicit yes would be the wrong default, however convenient.
    thinking.innerHTML = `
      <div>${esc(plan.understood)}</div>
      <div class="help" style="margin-top:8px">These agents would handle it:</div>
      ${plan.agents
        .map(
          (a, i) => `
        <div class="plan-agent">
          <div class="checkline">
            <input type="checkbox" id="plan-${i}" data-agent-id="${esc(a.id)}" checked />
            <div style="flex:1">
              <div><strong>${esc(a.name)}</strong>
                ${a.verified ? '<span class="badge ok">verified</span>' : '<span class="badge warn">community</span>'}
                ${a.alreadyInstalled ? '<span class="badge">already installed</span>' : ""}
              </div>
              <div class="why">${esc(a.why || a.description)}</div>
              ${
                a.willNeed.length
                  ? `<div class="help">You'll be asked for: ${a.willNeed
                      .map((n) => esc(n.label))
                      .join(", ")}</div>`
                  : ""
              }
            </div>
          </div>
        </div>`
        )
        .join("")}
      <div style="margin-top:12px">
        <button onclick="approvePlan(this)">Install these</button>
      </div>
      ${
        plan.fallback
          ? '<div class="help" style="margin-top:10px">Chosen by keyword match — set up an AI model in Settings for better understanding.</div>'
          : ""
      }`;
  } catch (err) {
    thinking.innerHTML = esc(err.message);
  }
}

async function approvePlan(button) {
  const container = button.closest(".msg");
  const ids = [...container.querySelectorAll("input[data-agent-id]:checked")].map(
    (el) => el.dataset.agentId
  );
  if (!ids.length) return;

  button.disabled = true;
  button.textContent = "Installing...";

  try {
    const { outcomes } = await api("/chat/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentIds: ids }),
    });

    addMessage("bot", renderOutcomes(outcomes));
    await refreshAgents();
  } catch (err) {
    addMessage("system", esc(err.message));
  }
  button.textContent = "Installed";
}

/** Turn install results into the "here's what's left" checklist. */
function renderOutcomes(outcomes) {
  return outcomes
    .map((o) => {
      if (!o.ok) {
        return `<div><strong>${esc(o.id)}</strong> — couldn't install: ${esc(o.error)}</div>`;
      }
      if (o.ready) {
        return `<div><strong>${esc(o.name)}</strong> is installed and ready to use.
          <button class="secondary" onclick="goToAgents()">Open it</button></div>`;
      }

      const steps = [];
      if (o.missingDependencies.length) {
        steps.push(
          `<li>${o.missingDependencies
            .map((d) => `${esc(d.message)} <a href="${esc(d.downloadUrl)}" target="_blank" style="color:var(--cyan)">Download</a>`)
            .join("<br>")}</li>`
        );
      }
      if (o.needsSetup.length) {
        steps.push(
          `<li>Provide: ${o.needsSetup.map((s) => esc(s.label)).join(", ")}</li>`
        );
      }
      if (o.needsPermissions.length) {
        steps.push(
          `<li>Allow access to: ${o.needsPermissions.map(esc).join(", ")}</li>`
        );
      }

      return `<div style="margin-bottom:10px">
        <strong>${esc(o.name)}</strong> is installed. Two more things:
        <ul style="margin:6px 0 8px; padding-left:20px; color:var(--muted); font-size:13px">${steps.join("")}</ul>
        <button class="secondary" onclick="goToAgents('${esc(o.id)}')">Finish setup</button>
      </div>`;
    })
    .join("");
}

function goToAgents(agentId) {
  if (agentId) expanded.add(agentId);
  document.querySelector('.tab[data-view="agents"]').click();
}

$("chat-send").addEventListener("click", sendGoal);
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendGoal();
});

// ---------- Catalogue ----------

async function searchCatalog() {
  const query = $("catalog-search").value.trim();
  const listEl = $("catalog-list");
  listEl.className = "empty";
  listEl.textContent = "Searching...";

  try {
    const data = await api(
      `/catalog/search?q=${encodeURIComponent(query)}&online=true`
    );

    $("catalog-notes").innerHTML = (data.notes || [])
      .map((n) => `<div class="banner">${esc(n)}</div>`)
      .join("");

    if (!data.results.length) {
      listEl.textContent = "Nothing matched that.";
      return;
    }

    listEl.className = "";
    listEl.innerHTML = data.results
      .map(
        (a) => `
      <div class="catalog-item">
        <div style="flex:1">
          <div><strong>${esc(a.name)}</strong>
            ${a.verified ? '<span class="badge ok">verified</span>' : '<span class="badge warn">community</span>'}
            ${a.category ? `<span class="badge">${esc(a.category)}</span>` : ""}
          </div>
          <div class="agent-desc" style="margin-bottom:0">${esc(a.description)}</div>
          ${a.homepage ? `<a href="${esc(a.homepage)}" target="_blank" class="help" style="color:var(--cyan)">Source</a>` : ""}
        </div>
        <button class="secondary" onclick="installFromCatalog('${esc(a.id)}')">Install</button>
      </div>`
      )
      .join("");
  } catch (err) {
    listEl.textContent = err.message;
  }
}

async function installFromCatalog(id) {
  try {
    await api(`/catalog/${id}/install`, { method: "POST" });
    expanded.add(id);
    goToAgents(id);
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Settings ----------

async function renderSettings() {
  const status = await api("/settings/ai");
  $("settings-form").innerHTML = `
    <label>Provider</label>
    <select id="ai-provider">
      <option value="">— choose —</option>
      ${status.available
        .map(
          (p) =>
            `<option value="${p.id}" ${p.id === status.provider ? "selected" : ""}>${esc(p.label)}</option>`
        )
        .join("")}
    </select>

    <label>Model</label>
    <input type="text" id="ai-model" value="${esc(status.model || "")}"
      placeholder="Leave blank for the default" />

    <label>API key ${status.keySet ? '<span class="badge ok">saved</span>' : ""}</label>
    <input type="password" id="ai-key"
      placeholder="${status.keySet ? "\u2022\u2022\u2022\u2022\u2022 (leave blank to keep)" : "Not needed for a local model"}" />
    <div class="help">
      Stored encrypted on this computer only. It is never sent anywhere except
      to the provider you choose.
    </div>

    <div style="margin-top:16px">
      <button onclick="saveSettings()">Save</button>
    </div>`;
}

async function saveSettings() {
  const provider = $("ai-provider").value;
  const model = $("ai-model").value.trim();
  const apiKey = $("ai-key").value;

  try {
    await api("/settings/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, model, apiKey }),
    });
    await renderSettings();
    await refreshAiStatus();
  } catch (err) {
    alert(err.message);
  }
}

async function refreshAiStatus() {
  try {
    const status = await api("/settings/ai");
    const el = $("ai-status");
    if (status.configured) {
      el.className = "badge live";
      el.textContent = `${status.label} · ${status.model}`;
    } else {
      el.className = "badge warn";
      el.textContent = "No model — open Settings";
    }
  } catch {}
}

// ---------- Agents ----------

function renderSetupField(agentId, step) {
  const id = `setup-${agentId}-${step.name}`;
  const done = step.answered ? '<span class="badge ok">set</span>' : "";
  const help = step.help ? `<div class="help">${esc(step.help)}</div>` : "";
  let field;

  if (step.type === "select") {
    field = `<select id="${id}">${(step.options || [])
      .map((o) => `<option ${o === step.value ? "selected" : ""}>${esc(o)}</option>`)
      .join("")}</select>`;
  } else if (step.type === "secret") {
    field = `<input type="password" id="${id}" placeholder="${
      step.answered ? "\u2022\u2022\u2022\u2022\u2022 (leave blank to keep)" : "Enter value"
    }" />`;
  } else if (step.type === "oauth") {
    field = `<button class="secondary" onclick="alert('Account sign-in is not wired up yet.')">Connect ${esc(step.provider || "account")}</button>`;
  } else {
    field = `<input type="text" id="${id}" value="${esc(step.value || "")}" placeholder="${
      step.type === "folder" ? "e.g. C:\\Users\\you\\Documents" : ""
    }" />`;
  }

  return `<label>${esc(step.label || step.name)}${step.required ? " *" : ""} ${done}</label>${field}${help}`;
}

async function renderSetup(agentId) {
  const setup = await api(`/agents/${agentId}/setup`);
  if (!setup.steps.length) {
    return `<div class="setup-box"><div class="help">This agent needs no setup.</div></div>`;
  }
  return `
    <div class="setup-box">
      <h4>Setup</h4>
      ${setup.steps.map((s) => renderSetupField(agentId, s)).join("")}
      <div style="margin-top:13px"><button onclick="saveSetup('${agentId}')">Save setup</button></div>
    </div>`;
}

async function saveSetup(agentId) {
  const setup = await api(`/agents/${agentId}/setup`);
  const answers = {};
  for (const step of setup.steps) {
    const el = $(`setup-${agentId}-${step.name}`);
    if (!el) continue;
    if (step.type === "secret" && el.value === "") continue;
    answers[step.name] = el.value;
  }
  try {
    await api(`/agents/${agentId}/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(answers),
    });
    await refreshAgents();
  } catch (err) {
    alert(err.message);
  }
}

async function toggleAgent(agentId) {
  expanded.has(agentId) ? expanded.delete(agentId) : expanded.add(agentId);
  await refreshAgents();
}

async function connectAgent(agentId) {
  try {
    const info = await api(`/agents/${agentId}/start`, { method: "POST" });
    toolCache.set(agentId, info.tools || []);
    expanded.add(agentId);
    await refreshAgents();
  } catch (err) {
    alert(err.message);
  }
}

async function stopAgent(agentId) {
  await api(`/agents/${agentId}/stop`, { method: "POST" });
  toolCache.delete(agentId);
  await refreshAgents();
}

async function uninstallAgent(agentId) {
  if (!confirm(`Remove "${agentId}"? Its saved settings will be deleted.`)) return;
  await api(`/agents/${agentId}`, { method: "DELETE" });
  expanded.delete(agentId);
  toolCache.delete(agentId);
  await refreshAgents();
}

async function grantPermission(agentId, permission) {
  await api(`/agents/${agentId}/permissions/${permission}/grant`, { method: "POST" });
  await refreshAgents();
}

function openTool(agentId, toolName) {
  const tool = (toolCache.get(agentId) || []).find((t) => t.name === toolName);
  if (!tool) return;

  const props = tool.inputSchema?.properties || {};
  const required = tool.inputSchema?.required || [];

  $("tool-dialog-title").textContent = tool.title || tool.name;
  $("tool-dialog-fields").innerHTML = Object.keys(props).length
    ? Object.entries(props)
        .map(([name, schema]) => {
          const label = esc(schema.title || name) + (required.includes(name) ? " *" : "");
          const help = schema.description ? `<div class="help">${esc(schema.description)}</div>` : "";
          const type = schema.type === "number" ? "number" : "text";
          return `<label>${label}</label><input type="${type}" data-arg="${esc(name)}" />${help}`;
        })
        .join("")
    : '<div class="help">This action takes no input.</div>';

  $("tool-dialog-run").onclick = async () => {
    const args = {};
    document.querySelectorAll("#tool-dialog-fields [data-arg]").forEach((el) => {
      if (el.value === "") return;
      args[el.dataset.arg] = el.type === "number" ? Number(el.value) : el.value;
    });
    $("tool-dialog").close();
    try {
      await api(`/agents/${agentId}/tools/${toolName}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
    } catch (err) {
      alert(err.message);
    }
    await refreshTasks();
  };

  $("tool-dialog").showModal();
}

async function renderTools(agentId) {
  let tools = toolCache.get(agentId);
  if (!tools) {
    try {
      tools = await api(`/agents/${agentId}/tools`);
      toolCache.set(agentId, tools);
    } catch {
      return "";
    }
  }
  if (!tools.length) return "";

  return `<div class="tools">
    <div class="help" style="margin-bottom:7px">What this agent can do</div>
    ${tools
      .map(
        (t) => `
      <div class="tool">
        <div>
          <div>${esc(t.title || t.name)}</div>
          <div class="tool-desc">${esc((t.description || "").slice(0, 95))}</div>
        </div>
        <button class="secondary" onclick="openTool('${agentId}','${esc(t.name)}')">Use</button>
      </div>`
      )
      .join("")}
  </div>`;
}

async function refreshAgents() {
  const listEl = $("agent-list");
  const agents = await api("/agents");

  if (!agents.length) {
    listEl.className = "empty";
    listEl.innerHTML =
      'No agents yet. Try the <strong>Ask</strong> tab and describe what you want to do.';
    return;
  }

  listEl.className = "";
  const cards = [];

  for (const agent of agents) {
    const perms = agent.permissionStatus;
    const isOpen = expanded.has(agent.id);

    const badges = [
      agent.running ? '<span class="badge live">running</span>' : "",
      agent.setupReady
        ? '<span class="badge ok">ready</span>'
        : '<span class="badge warn">needs setup</span>',
      `<span class="badge">${esc(agent.runtimeType)}</span>`,
      ...perms.pending.map((p) => `<span class="badge warn">needs: ${esc(p)}</span>`),
    ].join("");

    const grantButtons = perms.pending
      .map(
        (p) =>
          `<button class="secondary" onclick="grantPermission('${agent.id}','${p}')">Allow ${esc(p)}</button>`
      )
      .join("");

    const canConnect = agent.setupReady && perms.pending.length === 0;
    const body = isOpen
      ? (await renderSetup(agent.id)) + (agent.running ? await renderTools(agent.id) : "")
      : "";

    cards.push(`
      <div class="agent">
        <div class="agent-head">
          <div style="flex:1">
            <div class="agent-name">${esc(agent.name)}
              <span style="color:var(--muted);font-weight:400">v${esc(agent.version)}</span>
            </div>
            <div class="agent-desc">${esc(agent.description)}</div>
            <div>${badges}</div>
          </div>
          <button class="danger" onclick="uninstallAgent('${agent.id}')">Remove</button>
        </div>
        <div style="margin-top:11px">
          ${grantButtons}
          ${
            agent.running
              ? `<button class="ghost" onclick="stopAgent('${agent.id}')">Stop</button>`
              : canConnect
              ? `<button onclick="connectAgent('${agent.id}')">Connect</button>`
              : ""
          }
          <button class="ghost" onclick="toggleAgent('${agent.id}')">${isOpen ? "Hide" : "Settings"}</button>
        </div>
        ${body}
      </div>`);
  }

  listEl.innerHTML = cards.join("");
  refreshLoadErrors();
}

async function refreshLoadErrors() {
  try {
    const errors = await api("/agents/errors");
    $("load-errors").innerHTML = errors
      .map((e) => `<div class="banner">Couldn't load "${esc(e.id)}": ${esc(e.error)}</div>`)
      .join("");
  } catch {}
}

$("package-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("package", file);

  try {
    const result = await api("/agents/install", { method: "POST", body: form });
    expanded.add(result.manifest.id);
    if (!result.dependencies.satisfied) {
      alert(
        `${result.manifest.name} was installed, but needs something first:\n\n` +
          result.dependencies.missing.map((d) => `${d.message}\n${d.downloadUrl}`).join("\n\n")
      );
    }
    await refreshAgents();
  } catch (err) {
    alert(`Install failed: ${err.message}`);
  }
  event.target.value = "";
});

async function refreshTasks() {
  const el = $("task-list");
  const tasks = await api("/tasks");
  if (!tasks.length) {
    el.className = "empty";
    el.innerHTML = "Nothing has run yet.";
    return;
  }
  el.className = "";
  el.innerHTML = tasks
    .map((t) => {
      const text = t.result?.content?.map((c) => c.text || "").join("\n").trim();
      return `<div class="task">
        <div><span class="task-status ${t.status}">${t.status}</span>
          &mdash; ${esc(t.agentName || t.agentId)}
          <span style="color:var(--muted)">/ ${esc(t.tool || "")}</span></div>
        <div style="color:var(--muted)">${new Date(t.startedAt).toLocaleTimeString()}</div>
        ${text ? `<pre>${esc(text)}</pre>` : ""}
        ${t.error ? `<pre style="color:var(--danger)">${esc(t.error)}</pre>` : ""}
      </div>`;
    })
    .join("");
}

async function checkCore() {
  try {
    await api("/health");
    $("core-status").innerHTML = '<span class="status-dot status-ok"></span>Core connected';
    return true;
  } catch {
    $("core-status").innerHTML =
      '<span class="status-dot status-bad"></span>Core unavailable';
    return false;
  }
}

async function boot() {
  if (await checkCore()) {
    await refreshAiStatus();
    await refreshAgents();
    await refreshTasks();
    setInterval(refreshTasks, 3000);
  } else {
    setTimeout(boot, 2000);
  }
}

boot();
