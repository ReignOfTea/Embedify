import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Bot } from "grammy";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppConfig } from "../config.js";
import type { BotContext } from "../bot/context.js";
import type { Rule, RuleDraft, RulesExport, Store } from "../db.js";
import { log } from "../logger.js";
import { compilePattern, parseHostList, parseStringList } from "../rewrite.js";
import { verifyInitData, type TelegramUser } from "./initData.js";

type Env = {
  Variables: {
    user: TelegramUser;
    owner: boolean;
  };
};

export type HttpServer = {
  close: () => Promise<void>;
};

export async function startWebApp(
  config: AppConfig,
  store: Store,
  bot: Bot<BotContext>,
): Promise<HttpServer> {
  const app = new Hono();
  const api = new Hono<Env>();

  api.use("*", async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const initData = header.startsWith("tma ") ? header.slice(4) : "";
    const user = verifyInitData(initData, config.token);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("user", user);
    c.set("owner", config.adminIds.includes(user.id));
    await next();
  });

  api.get("/session", async (c) => {
    const user = c.get("user");
    const owner = c.get("owner");
    return c.json({
      user,
      owner,
      stats: store.stats(),
    });
  });

  api.get("/stats", async (c) => {
    requireOwner(c.get("owner"));
    return c.json(store.dashboardStats());
  });

  api.get("/export", async (c) => {
    requireOwner(c.get("owner"));
    return c.json(store.exportRules());
  });

  api.post("/import", async (c) => {
    requireOwner(c.get("owner"));
    const bundle = parseExport(await c.req.json());
    const result = store.importRules(bundle);
    return c.json(result);
  });

  api.get("/rules", async (c) => {
    requireOwner(c.get("owner"));
    return c.json({ rules: store.listGlobalRules().map(serializeRule) });
  });

  api.post("/rules", async (c) => {
    requireOwner(c.get("owner"));
    const draft = await parseRuleDraft(await c.req.json(), null);
    const rule = store.createRule(draft);
    return c.json({ rule: serializeRule(rule) }, 201);
  });

  api.patch("/rules/:id", async (c) => {
    requireOwner(c.get("owner"));
    const current = store.getRule(c.req.param("id"));
    if (!current || current.chatId != null) throw new HTTPException(404, { message: "Rule not found" });
    const patch = await parseRulePatch(await c.req.json(), current);
    const rule = store.updateRule(current.id, patch);
    return c.json({ rule: serializeRule(rule!) });
  });

  api.post("/rules/:id/toggle", async (c) => {
    requireOwner(c.get("owner"));
    const current = store.getRule(c.req.param("id"));
    if (!current || current.chatId != null) throw new HTTPException(404, { message: "Rule not found" });
    const rule = store.toggleRule(current.id);
    return c.json({ rule: serializeRule(rule!) });
  });

  api.post("/rules/:id/reset", async (c) => {
    requireOwner(c.get("owner"));
    const rule = store.resetBuiltin(c.req.param("id"));
    if (!rule) throw new HTTPException(400, { message: "Only built-in rules can be reset" });
    return c.json({ rule: serializeRule(rule) });
  });

  api.delete("/rules/:id", async (c) => {
    requireOwner(c.get("owner"));
    const current = store.getRule(c.req.param("id"));
    if (!current || current.chatId != null || current.builtin) {
      throw new HTTPException(400, { message: "That rule cannot be deleted" });
    }
    store.deleteRule(current.id);
    return c.json({ ok: true });
  });

  api.get("/chats", async (c) => {
    requireOwner(c.get("owner"));
    return c.json({ chats: store.listGroups() });
  });

  api.get("/chats/:id/export", async (c) => {
    const chatId = Number(c.req.param("id"));
    await requireChatAdmin(bot, config, c.get("user").id, c.get("owner"), chatId);
    return c.json(store.exportRules(chatId));
  });

  api.post("/chats/:id/import", async (c) => {
    const chatId = Number(c.req.param("id"));
    await requireChatAdmin(bot, config, c.get("user").id, c.get("owner"), chatId);
    const bundle = parseExport(await c.req.json());
    const result = store.importRules(bundle, chatId);
    return c.json(result);
  });

  api.patch("/chats/:id", async (c) => {
    const chatId = Number(c.req.param("id"));
    await requireChatAdmin(bot, config, c.get("user").id, c.get("owner"), chatId);
    const body = await c.req.json().catch(() => ({})) as {
      approved?: boolean;
      enabled?: boolean;
      previewAll?: boolean;
    };
    if (typeof body.approved === "boolean") {
      store.setGroupApproval(chatId, body.approved, c.get("user").id);
    }
    if (typeof body.enabled === "boolean") {
      store.setGroupEnabled(chatId, body.enabled);
    }
    if (typeof body.previewAll === "boolean") {
      store.setGroupPreviewAll(chatId, body.previewAll);
    }
    const chat = store.getGroup(chatId);
    if (!chat) throw new HTTPException(404, { message: "Chat not found" });
    return c.json({ chat });
  });

  api.get("/chats/:id/rules", async (c) => {
    const chatId = Number(c.req.param("id"));
    await requireChatAdmin(bot, config, c.get("user").id, c.get("owner"), chatId);
    const chat = store.getGroup(chatId);
    return c.json({
      chat: chat ?? null,
      rules: store.listChatRuleViews(chatId).map((view) => ({
        ...serializeRule(view.rule),
        scope: view.scope,
        globallyEnabled: view.globallyEnabled,
        locallyOn: view.locallyOn,
        effective: view.effective,
      })),
    });
  });

  api.post("/chats/:id/rules", async (c) => {
    const chatId = Number(c.req.param("id"));
    await requireChatAdmin(bot, config, c.get("user").id, c.get("owner"), chatId);
    store.upsertGroup({
      chatId,
      title: store.getGroup(chatId)?.title ?? String(chatId),
      type: store.getGroup(chatId)?.type ?? "supergroup",
    });
    const draft = await parseRuleDraft(await c.req.json(), chatId);
    const rule = store.createRule(draft);
    return c.json({ rule: serializeRule(rule) }, 201);
  });

  api.post("/chats/:id/rules/:ruleId/toggle", async (c) => {
    const chatId = Number(c.req.param("id"));
    await requireChatAdmin(bot, config, c.get("user").id, c.get("owner"), chatId);
    const view = store.toggleChatRule(chatId, c.req.param("ruleId"));
    if (!view) throw new HTTPException(404, { message: "Rule not found" });
    return c.json({
      rule: {
        ...serializeRule(view.rule),
        scope: view.scope,
        globallyEnabled: view.globallyEnabled,
        locallyOn: view.locallyOn,
        effective: view.effective,
      },
    });
  });

  api.patch("/chats/:id/rules/:ruleId", async (c) => {
    const chatId = Number(c.req.param("id"));
    await requireChatAdmin(bot, config, c.get("user").id, c.get("owner"), chatId);
    const current = store.getRule(c.req.param("ruleId"));
    if (!current || current.chatId !== chatId) {
      throw new HTTPException(404, { message: "Local rule not found" });
    }
    const patch = await parseRulePatch(await c.req.json(), current);
    const rule = store.updateRule(current.id, patch);
    return c.json({ rule: serializeRule(rule!) });
  });

  api.delete("/chats/:id/rules/:ruleId", async (c) => {
    const chatId = Number(c.req.param("id"));
    await requireChatAdmin(bot, config, c.get("user").id, c.get("owner"), chatId);
    const current = store.getRule(c.req.param("ruleId"));
    if (!current || current.chatId !== chatId || current.builtin) {
      throw new HTTPException(400, { message: "Only local custom rules can be deleted" });
    }
    store.deleteRule(current.id);
    return c.json({ ok: true });
  });

  api.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    log.error("Mini App API error", err);
    return c.json({ error: "Internal error" }, 500);
  });

  app.route("/api", api);
  app.use("/*", serveStatic({ root: "./public" }));

  const hostname = config.webAppHost;
  const port = config.webAppPort;
  const listening = serve({ fetch: app.fetch, hostname, port });
  await new Promise<void>((resolve, reject) => {
    if ("listening" in listening && listening.listening) {
      resolve();
      return;
    }
    listening.once("listening", () => resolve());
    listening.once("error", reject);
  });
  log.info(`Mini App listening on http://${hostname}:${port}`);

  return {
    close: () =>
      new Promise((resolveClose) => {
        listening.close(() => resolveClose());
      }),
  };
}

function requireOwner(owner: boolean): void {
  if (!owner) throw new HTTPException(403, { message: "Owners only" });
}

async function requireChatAdmin(
  bot: Bot<BotContext>,
  config: AppConfig,
  userId: number,
  owner: boolean,
  chatId: number,
): Promise<void> {
  if (!Number.isSafeInteger(chatId)) throw new HTTPException(400, { message: "Invalid chat" });
  if (owner) return;
  try {
    const member = await bot.api.getChatMember(chatId, userId);
    if (member.status === "creator" || member.status === "administrator") return;
  } catch {
    // not an admin or bot cannot see the chat
  }
  throw new HTTPException(403, { message: "Chat admins only" });
}

function serializeRule(rule: Rule) {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    mode: rule.mode,
    match: rule.match,
    replaces: rule.replaces,
    fromHosts: rule.match,
    toHost: rule.replaces[0] ?? null,
    stripQuery: rule.stripQuery,
    pattern: rule.mode === "regex" ? (rule.match[0] ?? null) : null,
    replacement: rule.mode === "regex" ? (rule.replaces[0] ?? null) : null,
    enabled: rule.enabled,
    builtin: rule.builtin,
    userModified: rule.userModified,
    hits: rule.hits,
    chatId: rule.chatId,
  };
}

async function parseRuleDraft(body: unknown, chatId: number | null): Promise<RuleDraft> {
  const data = asRecord(body);
  const name = String(data.name ?? "").trim().slice(0, 64);
  if (!name) throw new HTTPException(400, { message: "Name is required" });
  const mode = data.mode === "regex" ? "regex" : "host";
  if (mode === "host") {
    const match = parseHostList(String(data.match ?? data.fromHosts ?? ""));
    const replaces = parseHostList(String(data.replaces ?? data.toHost ?? ""));
    if (match.length === 0 || replaces.length === 0) {
      throw new HTTPException(400, { message: "Host rules need match hosts and at least one replace host" });
    }
    return {
      name,
      mode,
      match,
      replaces,
      stripQuery: data.stripQuery !== false,
      chatId,
    };
  }
  const pattern = String(data.pattern ?? (Array.isArray(data.match) ? data.match[0] : data.match) ?? "");
  const replaces = parseStringList(String(data.replaces ?? data.replacement ?? ""));
  try {
    compilePattern(pattern);
  } catch {
    throw new HTTPException(400, { message: "Invalid regex" });
  }
  if (replaces.length === 0) throw new HTTPException(400, { message: "At least one replacement is required" });
  return { name, mode, match: [pattern], replaces, chatId };
}

async function parseRulePatch(body: unknown, current: Rule): Promise<Partial<RuleDraft>> {
  const data = asRecord(body);
  const patch: Partial<RuleDraft> = {};
  if (data.name != null) {
    const name = String(data.name).trim().slice(0, 64);
    if (!name) throw new HTTPException(400, { message: "Name is required" });
    patch.name = name;
  }
  if (data.match != null || data.fromHosts != null) {
    if (current.mode === "regex") {
      const pattern = String(data.match ?? data.fromHosts ?? "");
      try {
        compilePattern(pattern);
      } catch {
        throw new HTTPException(400, { message: "Invalid regex" });
      }
      patch.match = [pattern];
    } else {
      const match = parseHostList(String(data.match ?? data.fromHosts));
      if (match.length === 0) throw new HTTPException(400, { message: "No hosts parsed" });
      patch.match = match;
    }
  }
  if (data.replaces != null || data.toHost != null || data.replacement != null) {
    const raw = String(data.replaces ?? data.toHost ?? data.replacement ?? "");
    const replaces = current.mode === "regex" ? parseStringList(raw) : parseHostList(raw);
    if (replaces.length === 0) throw new HTTPException(400, { message: "No replacements parsed" });
    patch.replaces = replaces;
  }
  if (data.stripQuery != null) patch.stripQuery = Boolean(data.stripQuery);
  if (data.pattern != null) {
    try {
      compilePattern(String(data.pattern));
    } catch {
      throw new HTTPException(400, { message: "Invalid regex" });
    }
    patch.match = [String(data.pattern)];
  }
  if (data.enabled != null) patch.enabled = Boolean(data.enabled);
  if (Object.keys(patch).length === 0) {
    return { name: current.name };
  }
  return patch;
}

function parseExport(body: unknown): RulesExport {
  const data = asRecord(body);
  if (data.version !== 1 && data.version != null) {
    throw new HTTPException(400, { message: "Unsupported export version" });
  }
  return {
    version: 1,
    exportedAt: Number(data.exportedAt ?? Date.now()),
    globalRules: Array.isArray(data.globalRules) ? (data.globalRules as RulesExport["globalRules"]) : [],
    chats: Array.isArray(data.chats) ? (data.chats as RulesExport["chats"]) : [],
  };
}

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") throw new HTTPException(400, { message: "Invalid JSON" });
  return body as Record<string, unknown>;
}
