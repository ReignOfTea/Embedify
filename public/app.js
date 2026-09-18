const tg = window.Telegram?.WebApp;
const root = document.getElementById("app");
const importFile = document.getElementById("import-file");
const params = new URLSearchParams(location.search);
const startChat = params.get("chat");

const state = {
  session: null,
  rules: [],
  chats: [],
  chat: null,
  chatRules: [],
  stats: null,
  view: "boot",
  editing: null,
  error: "",
  importPath: "",
};

if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor("secondary_bg_color");
  tg.BackButton.onClick(() => history.back());
}

window.addEventListener("hashchange", () => {
  route();
  render();
});

importFile?.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file || !state.importPath) return;
  try {
    const bundle = JSON.parse(await file.text());
    const result = await api(state.importPath, { method: "POST", body: bundle });
    toast(`Imported ${result.rules ?? 0} rules`);
    if (state.importPath.includes("/chats/")) await loadChat(chatId());
    else await loadRules();
    state.session = await api("/api/session");
    haptic();
    render();
  } catch (error) {
    toast(error.message || "Import failed");
  }
});

boot();

async function boot() {
  if (!tg?.initData) {
    state.view = "gate";
    render();
    return;
  }
  try {
    state.session = await api("/api/session");
    if (startChat) {
      location.replace(`#/chats/${startChat}`);
    } else {
      location.replace(state.session.owner ? "#/rules" : "#/chats");
    }
    await route();
  } catch (error) {
    state.error = error.message;
    state.view = "gate";
  }
  render();
}

async function route() {
  const hash = location.hash.replace(/^#/, "") || "/rules";
  const parts = hash.split("/").filter(Boolean);
  hideMain();
  tg?.BackButton.hide();

  if (parts[0] === "stats") {
    if (!requireOwner()) return;
    state.stats = await api("/api/stats");
    state.view = "stats";
    return;
  }
  if (parts[0] === "rules" && parts[1] === "new") {
    if (!requireOwner()) return;
    state.view = "rule-form";
    state.editing = emptyRule(null);
    tg?.BackButton.show();
    return;
  }
  if (parts[0] === "rules" && parts[1] && parts[2] === "edit") {
    if (!requireOwner()) return;
    const rule = state.rules.find((item) => item.id === parts[1]) ?? (await loadRules(), state.rules.find((item) => item.id === parts[1]));
    if (!rule) {
      state.view = "rules";
      return;
    }
    state.view = "rule-form";
    state.editing = formRule(rule);
    tg?.BackButton.show();
    return;
  }
  if (parts[0] === "rules" && parts[1]) {
    if (!requireOwner()) return;
    await loadRules();
    state.editing = state.rules.find((item) => item.id === parts[1]) ?? null;
    state.view = "rule-detail";
    tg?.BackButton.show();
    return;
  }
  if (parts[0] === "chats" && parts[1] && parts[2] === "new") {
    await loadChat(parts[1]);
    state.view = "rule-form";
    state.editing = emptyRule(Number(parts[1]));
    tg?.BackButton.show();
    return;
  }
  if (parts[0] === "chats" && parts[1] && parts[2] && parts[3] === "edit") {
    await loadChat(parts[1]);
    const rule = state.chatRules.find((item) => item.id === parts[2]);
    state.view = "rule-form";
    state.editing = formRule(rule);
    tg?.BackButton.show();
    return;
  }
  if (parts[0] === "chats" && parts[1] && parts[2]) {
    await loadChat(parts[1]);
    state.editing = state.chatRules.find((item) => item.id === parts[2]) ?? null;
    state.view = "chat-rule-detail";
    tg?.BackButton.show();
    return;
  }
  if (parts[0] === "chats" && parts[1]) {
    await loadChat(parts[1]);
    state.view = "chat";
    if (state.session?.owner) tg?.BackButton.show();
    return;
  }
  if (parts[0] === "chats") {
    if (state.session?.owner) {
      await loadChats();
      state.view = "chats";
    } else {
      state.view = "gate";
    }
    return;
  }
  if (!requireOwner()) return;
  await loadRules();
  state.view = "rules";
}

function requireOwner() {
  if (state.session?.owner) return true;
  state.view = "gate";
  state.error = "This screen is for bot owners. Chat admins can open a chat from /rules.";
  return false;
}

async function loadRules() {
  const data = await api("/api/rules");
  state.rules = data.rules;
}

async function loadChats() {
  const data = await api("/api/chats");
  state.chats = data.chats;
}

async function loadChat(id) {
  const data = await api(`/api/chats/${id}/rules`);
  state.chat = data.chat;
  state.chatRules = data.rules;
}

function render() {
  if (state.view === "gate") {
    root.innerHTML = `<div class="gate">${escapeHtml(state.error || "Open this dashboard from Telegram.")}</div>`;
    return;
  }
  if (state.view === "boot") {
    root.innerHTML = `<div class="boot">Loading…</div>`;
    return;
  }
  if (state.view === "rules") root.innerHTML = rulesView();
  else if (state.view === "rule-detail") root.innerHTML = ruleDetailView(state.editing, false);
  else if (state.view === "rule-form") root.innerHTML = ruleFormView();
  else if (state.view === "chats") root.innerHTML = chatsView();
  else if (state.view === "chat") root.innerHTML = chatView();
  else if (state.view === "chat-rule-detail") root.innerHTML = ruleDetailView(state.editing, true);
  else if (state.view === "stats") root.innerHTML = statsView();
  bind();
}

function rulesView() {
  return `
    ${header("Embedify", `${state.session.stats.rulesEnabled}/${state.session.stats.rulesTotal} global rules enabled`)}
    <div class="section-title">Global rules</div>
    <div class="card">${state.rules.map(ruleCell).join("") || empty("No rules yet")}</div>
    <div class="row-actions"><button class="btn" data-go="#/rules/new">New global rule</button></div>
    <div class="row-actions">
      <button class="btn secondary" data-export="/api/export" data-filename="embedify-rules.json">Export JSON</button>
      <button class="btn secondary" data-import="/api/import">Import JSON</button>
    </div>
    ${tabs("rules")}
  `;
}

function chatsView() {
  return `
    ${header("Chats", `${state.session.stats.groupsApproved} approved`)}
    <div class="card">${state.chats.map(chatCell).join("") || empty("No groups or channels yet")}</div>
    ${tabs("chats")}
  `;
}

function chatView() {
  const chat = state.chat;
  const title = chat?.title ?? "This chat";
  const locals = state.chatRules.filter((rule) => rule.scope === "local");
  const globals = state.chatRules.filter((rule) => rule.scope === "global");
  return `
    ${header(title, chatStatus(chat))}
    ${chat ? `
      <div class="row-actions">
        ${state.session.owner ? `
        <button class="btn secondary" data-chat-approved="${chat.approved ? "0" : "1"}">${chat.approved ? "Revoke" : "Approve"}</button>
        <button class="btn secondary" data-chat-enabled="${chat.enabled ? "0" : "1"}">${chat.enabled ? "Pause" : "Resume"}</button>` : ""}
        <button class="btn secondary" data-preview="${chat.previewAll === false ? "1" : "0"}">${chat.previewAll === false ? "Preview: first only" : "Preview: each link"}</button>
      </div>` : ""}
    <div class="section-title">Local rules</div>
    <div class="card">${locals.map(ruleCell).join("") || empty("None yet — they only apply here")}</div>
    <div class="row-actions"><button class="btn" data-go="#/chats/${chatId()}/new">New local rule</button></div>
    <div class="row-actions">
      <button class="btn secondary" data-export="/api/chats/${chatId()}/export" data-filename="embedify-chat-${chatId()}.json">Export JSON</button>
      <button class="btn secondary" data-import="/api/chats/${chatId()}/import">Import JSON</button>
    </div>
    <div class="section-title">Global rules in this chat</div>
    <div class="card">${globals.map(ruleCell).join("")}</div>
    ${state.session.owner ? tabs("chats") : ""}
  `;
}

function statsView() {
  const stats = state.stats ?? {};
  return `
    ${header("Stats", `${stats.rewritesToday ?? 0} rewrites today`)}
    <div class="stat-grid">
      ${statCard("Rewrites", stats.rewritesTotal ?? stats.hits ?? 0)}
      ${statCard("Today", stats.rewritesToday ?? 0)}
      ${statCard("Failures", stats.failuresTotal ?? 0)}
      ${statCard("Chats", stats.groupsApproved ?? 0)}
    </div>
    <div class="section-title">Per chat</div>
    <div class="card">${(stats.byChat || []).map((row) => `
      <div class="cell">
        <div class="cell-text">
          <div class="title">${escapeHtml(row.title)}</div>
          <div class="sub">${row.rewrites} rewrites · ${row.failures} failures</div>
        </div>
      </div>`).join("") || empty("No rewrites yet")}</div>
    <div class="section-title">Top rules</div>
    <div class="card">${(stats.topRules || []).map((row) => `
      <div class="cell">
        <div class="cell-text">
          <div class="title">${escapeHtml(row.name)}</div>
          <div class="sub">${row.rewrites} rewrites</div>
        </div>
      </div>`).join("") || empty("No rule hits yet")}</div>
    <div class="section-title">Recent failures</div>
    <div class="card">${(stats.recentFailures || []).map((row) => `
      <div class="cell">
        <div class="cell-text">
          <div class="title">${escapeHtml(row.reason)} · ${escapeHtml(row.title)}</div>
          <div class="sub">${escapeHtml(row.detail)}</div>
        </div>
      </div>`).join("") || empty("No failures recorded")}</div>
    ${tabs("stats")}
  `;
}

function ruleDetailView(rule, inChat) {
  if (!rule) return empty("Rule not found");
  const match = rule.match || rule.fromHosts || [];
  const replaces = rule.replaces || (rule.toHost ? [rule.toHost] : rule.replacement ? [rule.replacement] : []);
  const lines = [
    `<p>${escapeHtml(rule.description || "")}</p>`,
    `<p>${rule.scope === "local" || rule.chatId ? "Local to this chat" : "Global"}${rule.builtin ? " · Built-in" : " · Custom"} · used ${rule.hits}×</p>`,
    rule.mode === "host"
      ? `<p>Match <code>${escapeHtml(match.join(", "))}</code><br>Replaces <code>${escapeHtml(replaces.join(" → "))}</code></p>`
      : `<p>Regex <code>${escapeHtml(match[0] || rule.pattern || "")}</code><br>Replaces <code>${escapeHtml(replaces.join(" → "))}</code></p>`,
  ];
  const actions = [];
  if (inChat && rule.scope === "global") {
    lines.push(rule.globallyEnabled
      ? `<p>This rule is ${rule.locallyOn ? "on" : "off"} in this chat.</p>`
      : `<p>Disabled globally by a bot owner, so it cannot run here.</p>`);
  } else {
    actions.push(`<button class="btn secondary" data-go="${editHref(rule, inChat)}">Edit</button>`);
    if (rule.builtin && !inChat) actions.push(`<button class="btn secondary" data-reset="${rule.id}">Reset</button>`);
    if (!rule.builtin) actions.push(`<button class="btn danger" data-delete="${rule.id}">Delete</button>`);
  }
  return `
    ${header(rule.name, inChat ? (rule.effective ? "Active here" : "Off here") : (rule.enabled ? "Enabled globally" : "Disabled globally"))}
    <div class="detail">${lines.join("")}</div>
    ${actions.length ? `<div class="row-actions">${actions.join("")}</div>` : ""}
    ${state.session.owner && !inChat ? tabs("rules") : ""}
  `;
}

function ruleFormView() {
  const rule = state.editing ?? emptyRule(null);
  const host = rule.mode !== "regex";
  return `
    ${header(rule.id ? "Edit rule" : "New rule", rule.chatId ? "Local to this chat" : "Applies globally")}
    <form class="form" id="rule-form">
      <label>Name<input name="name" required maxlength="64" value="${escapeAttr(rule.name || "")}" /></label>
      <label>Type
        <select name="mode">
          <option value="host" ${host ? "selected" : ""}>Host swap</option>
          <option value="regex" ${host ? "" : "selected"}>Regex</option>
        </select>
      </label>
      <div data-host ${host ? "" : "hidden"}>
        <label>Match hosts<input name="match" placeholder="x.com, twitter.com" value="${escapeAttr(rule.match || "")}" /></label>
        <label>Replaces (priority order)<textarea name="replacesHost" placeholder="fixupx.com&#10;fxtwitter.com&#10;vxtwitter.com">${escapeHtml(rule.replacesHost || "")}</textarea></label>
        <label class="check"><input type="checkbox" name="stripQuery" ${rule.stripQuery === false ? "" : "checked"} /> Strip tracking query params</label>
      </div>
      <div data-regex ${host ? "hidden" : ""}>
        <label>Regex<textarea name="pattern" placeholder="https?://(?:www\\.)?x\\.com/(\\S+)">${escapeHtml(rule.pattern || "")}</textarea></label>
        <label>Replacements (priority order)<textarea name="replacesRegex" placeholder="https://fixupx.com/$1">${escapeHtml(rule.replacesRegex || "")}</textarea></label>
      </div>
      <button class="btn" type="submit">${rule.id ? "Save" : "Create"}</button>
    </form>
  `;
}

function header(title, subtitle) {
  return `<div class="header"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle || "")}</p></div>`;
}

function tabs(active) {
  if (!state.session?.owner) return "";
  return `
    <nav class="tabs">
      <button data-go="#/rules" class="${active === "rules" ? "active" : ""}">Rules</button>
      <button data-go="#/chats" class="${active === "chats" ? "active" : ""}">Chats</button>
      <button data-go="#/stats" class="${active === "stats" ? "active" : ""}">Stats</button>
    </nav>`;
}

function statCard(label, value) {
  return `<div class="stat-card"><div class="value">${escapeHtml(value)}</div><div class="label">${escapeHtml(label)}</div></div>`;
}

function ruleCell(rule) {
  const href = rule.chatId || rule.scope
    ? `#/chats/${rule.chatId || chatId()}/${rule.id}`
    : `#/rules/${rule.id}`;
  const on = rule.scope ? rule.effective : rule.enabled;
  const disabled = rule.scope === "global" && rule.globallyEnabled === false;
  const replaces = rule.replaces || [];
  return `
    <div class="cell">
      <button class="cell-text" data-go="${href}">
        <div class="title">${escapeHtml(rule.name)}</div>
        <div class="sub">${escapeHtml(rule.scope === "local" ? "Local" : (replaces.join(" → ") || "Regex"))}</div>
      </button>
      ${rule.scope === "local" ? `<span class="badge">local</span>` : ""}
      <label class="switch">
        <input type="checkbox" ${on ? "checked" : ""} ${disabled ? "disabled" : ""} data-toggle="${rule.id}" />
        <span></span>
      </label>
    </div>`;
}

function chatCell(chat) {
  const badge = chat.left ? "left" : !chat.approved ? "pending" : !chat.enabled ? "paused" : "active";
  return `
    <button class="cell" data-go="#/chats/${chat.chatId}">
      <div class="cell-text">
        <div class="title">${escapeHtml(chat.title)}</div>
        <div class="sub">${escapeHtml(chat.type)} · ${badge}</div>
      </div>
    </button>`;
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function bind() {
  root.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", () => {
      location.hash = el.getAttribute("data-go");
    });
  });
  root.querySelectorAll("[data-toggle]").forEach((el) => {
    el.addEventListener("change", async () => {
      const id = el.getAttribute("data-toggle");
      try {
        if (state.view === "chat" || state.view === "chat-rule-detail") {
          await api(`/api/chats/${chatId()}/rules/${id}/toggle`, { method: "POST" });
          await loadChat(chatId());
        } else {
          await api(`/api/rules/${id}/toggle`, { method: "POST" });
          await loadRules();
          state.session = await api("/api/session");
        }
        haptic();
        render();
      } catch (error) {
        toast(error.message);
        el.checked = !el.checked;
      }
    });
  });
  root.querySelectorAll("[data-chat-approved]").forEach((el) => {
    el.addEventListener("click", () => patchChat({ approved: el.getAttribute("data-chat-approved") === "1" }));
  });
  root.querySelectorAll("[data-chat-enabled]").forEach((el) => {
    el.addEventListener("click", () => patchChat({ enabled: el.getAttribute("data-chat-enabled") === "1" }));
  });
  root.querySelectorAll("[data-preview]").forEach((el) => {
    el.addEventListener("click", () => patchChat({ previewAll: el.getAttribute("data-preview") === "1" }));
  });
  root.querySelectorAll("[data-export]").forEach((el) => {
    el.addEventListener("click", () => exportJson(el.getAttribute("data-export"), el.getAttribute("data-filename")));
  });
  root.querySelectorAll("[data-import]").forEach((el) => {
    el.addEventListener("click", () => {
      state.importPath = el.getAttribute("data-import");
      importFile?.click();
    });
  });
  root.querySelectorAll("[data-reset]").forEach((el) => {
    el.addEventListener("click", async () => {
      await api(`/api/rules/${el.getAttribute("data-reset")}/reset`, { method: "POST" });
      await loadRules();
      location.hash = `#/rules/${el.getAttribute("data-reset")}`;
    });
  });
  root.querySelectorAll("[data-delete]").forEach((el) => {
    el.addEventListener("click", async () => {
      if (!confirm("Delete this rule?")) return;
      const id = el.getAttribute("data-delete");
      if (state.view === "chat-rule-detail") {
        await api(`/api/chats/${chatId()}/rules/${id}`, { method: "DELETE" });
        location.hash = `#/chats/${chatId()}`;
      } else {
        await api(`/api/rules/${id}`, { method: "DELETE" });
        location.hash = "#/rules";
      }
    });
  });
  const form = document.getElementById("rule-form");
  if (form) {
    form.mode.addEventListener("change", () => {
      form.querySelector("[data-host]").hidden = form.mode.value !== "host";
      form.querySelector("[data-regex]").hidden = form.mode.value !== "regex";
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const payload = {
        name: data.name,
        mode: data.mode,
        stripQuery: form.stripQuery?.checked ?? true,
        match: data.mode === "regex" ? data.pattern : data.match,
        replaces: data.mode === "regex" ? data.replacesRegex : data.replacesHost,
        pattern: data.pattern,
      };
      try {
        if (state.editing?.chatId) {
          const path = state.editing.id
            ? `/api/chats/${state.editing.chatId}/rules/${state.editing.id}`
            : `/api/chats/${state.editing.chatId}/rules`;
          await api(path, { method: state.editing.id ? "PATCH" : "POST", body: payload });
          location.hash = `#/chats/${state.editing.chatId}`;
        } else {
          const path = state.editing?.id ? `/api/rules/${state.editing.id}` : "/api/rules";
          await api(path, { method: state.editing?.id ? "PATCH" : "POST", body: payload });
          location.hash = "#/rules";
        }
      } catch (error) {
        toast(error.message);
      }
    });
  }
}

async function patchChat(body) {
  await api(`/api/chats/${chatId()}`, { method: "PATCH", body });
  await loadChat(chatId());
  haptic();
  render();
}

async function exportJson(path, filename) {
  const data = await api(path);
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "embedify-export.json";
  link.click();
  URL.revokeObjectURL(url);
  try {
    await navigator.clipboard.writeText(text);
    toast("Exported and copied JSON");
  } catch {
    toast("Exported JSON");
  }
}

function emptyRule(chatId) {
  return {
    name: "",
    mode: "host",
    match: "",
    replacesHost: "",
    replacesRegex: "",
    stripQuery: true,
    pattern: "",
    chatId,
  };
}

function formRule(rule) {
  const match = rule.match || rule.fromHosts || [];
  const replaces = rule.replaces || [];
  return {
    ...rule,
    match: match.join(", "),
    replacesHost: replaces.join("\n"),
    replacesRegex: replaces.join("\n"),
    pattern: rule.pattern || (rule.mode === "regex" ? match[0] : "") || "",
  };
}

function chatId() {
  return state.chat?.chatId ?? state.editing?.chatId ?? startChat;
}

function editHref(rule, inChat) {
  return inChat ? `#/chats/${chatId()}/${rule.id}/edit` : `#/rules/${rule.id}/edit`;
}

function chatStatus(chat) {
  if (!chat) return "Unknown chat";
  if (chat.left) return "Bot is no longer in this chat";
  if (!chat.approved) return "Waiting for approval";
  if (!chat.enabled) return "Approved, currently paused";
  return chat.previewAll === false ? "Active · first link only" : "Active · one reply per link";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `tma ${tg.initData}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function haptic() {
  tg?.HapticFeedback?.impactOccurred("light");
}

function hideMain() {
  tg?.MainButton?.hide();
}

function toast(message) {
  if (tg?.showAlert) tg.showAlert(message);
  else alert(message);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
