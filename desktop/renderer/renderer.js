const CORE_URL = window.aigentos.coreUrl;

const agentListEl = document.getElementById("agent-list");
const taskListEl = document.getElementById("task-list");
const coreStatusEl = document.getElementById("core-status");

async function api(path, options) {
  const res = await fetch(CORE_URL + path, options);
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

async function refreshAgents() {
  const agents = await api("/agents");
  agentListEl.innerHTML = agents
    .map((agent) => {
      const perms = agent.permissionStatus;
      const permBadges =
        perms.declared.length === 0
          ? '<span class="perm">بدون نیاز به مجوز خاص</span>'
          : perms.declared
              .map((p) => {
                const pending = perms.pending.includes(p);
                return `<span class="perm ${pending ? "pending" : ""}">${p}${
                  pending ? " (نیاز به تایید)" : " ✓"
                }</span>`;
              })
              .join("");

      const grantButtons = perms.pending
        .map(
          (p) =>
            `<button class="secondary" onclick="grantPermission('${agent.id}','${p}')">اجازه بده: ${p}</button>`
        )
        .join("");

      return `
        <div class="agent">
          <div class="agent-name">${agent.name} <span style="color:#9aa1ad;font-weight:400">v${agent.version}</span></div>
          <div class="agent-desc">${agent.description}</div>
          <div>${permBadges}</div>
          ${grantButtons ? `<div style="margin-top:8px">${grantButtons}</div>` : ""}
          <div style="margin-top:10px">
            <textarea id="input-${agent.id}" placeholder="ورودی برای این ایجنت (مثلاً متنی برای خلاصه‌سازی)"></textarea>
            <div style="margin-top:6px">
              <button onclick="runAgent('${agent.id}')">اجرا</button>
            </div>
          </div>
        </div>`;
    })
    .join("");
}

async function grantPermission(agentId, permission) {
  await api(`/agents/${agentId}/permissions/${permission}/grant`, { method: "POST" });
  await refreshAgents();
}

async function runAgent(agentId) {
  const text = document.getElementById(`input-${agentId}`).value;
  await api(`/agents/${agentId}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  await refreshTasks();
}

async function refreshTasks() {
  const tasks = await api("/tasks");
  if (tasks.length === 0) {
    taskListEl.innerHTML = "هنوز وظیفه‌ای اجرا نشده.";
    return;
  }
  taskListEl.innerHTML = tasks
    .map(
      (t) => `
      <div class="task">
        <div><span class="task-status ${t.status}">${t.status}</span> — ${t.agentId}</div>
        <div style="color:#9aa1ad">${new Date(t.startedAt).toLocaleTimeString()}</div>
        ${t.result ? `<pre>${escapeHtml(JSON.stringify(t.result, null, 2))}</pre>` : ""}
        ${t.error ? `<pre style="color:#ff5c5c">${escapeHtml(t.error)}</pre>` : ""}
      </div>`
    )
    .join("");
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function checkCore() {
  try {
    await api("/health");
    coreStatusEl.innerHTML = '<span class="status-dot status-ok"></span>هسته متصل است';
    return true;
  } catch {
    coreStatusEl.innerHTML = '<span class="status-dot status-bad"></span>هسته در دسترس نیست — اجرا کنید: npm start در پوشه core';
    return false;
  }
}

async function boot() {
  const ok = await checkCore();
  if (ok) {
    await refreshAgents();
    await refreshTasks();
    setInterval(refreshTasks, 3000);
  } else {
    setTimeout(boot, 2000);
  }
}

boot();
