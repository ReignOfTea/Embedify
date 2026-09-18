import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { builtinRules, type RuleMode } from "./rules.js";

export type Rule = {
  id: string;
  name: string;
  description: string | null;
  mode: RuleMode;
  match: string[];
  replaces: string[];
  stripQuery: boolean;
  enabled: boolean;
  builtin: boolean;
  userModified: boolean;
  hits: number;
  chatId: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ChatRuleView = {
  rule: Rule;
  scope: "global" | "local";
  globallyEnabled: boolean;
  locallyOn: boolean;
  effective: boolean;
};

export type GroupRecord = {
  chatId: number;
  title: string;
  username: string | null;
  type: string;
  approved: boolean;
  enabled: boolean;
  previewAll: boolean;
  left: boolean;
  approvedBy: number | null;
  createdAt: number;
  updatedAt: number;
};

export type RuleDraft = {
  name: string;
  description?: string | null;
  mode: RuleMode;
  match?: string[];
  replaces?: string[];
  stripQuery?: boolean;
  enabled?: boolean;
  chatId?: number | null;
};

export type ExportedRule = {
  id: string;
  name: string;
  description: string | null;
  mode: RuleMode;
  match: string[];
  replaces: string[];
  stripQuery: boolean;
  enabled: boolean;
  builtin: boolean;
};

export type RulesExport = {
  version: 1;
  exportedAt: number;
  globalRules: ExportedRule[];
  chats: {
    chatId: number;
    title: string;
    type: string;
    username: string | null;
    approved: boolean;
    enabled: boolean;
    previewAll: boolean;
    overrides: Record<string, boolean>;
    localRules: ExportedRule[];
  }[];
};

export type DashboardStats = {
  rulesEnabled: number;
  rulesTotal: number;
  groupsApproved: number;
  groupsPending: number;
  hits: number;
  rewritesTotal: number;
  rewritesToday: number;
  failuresTotal: number;
  byChat: { chatId: number; title: string; rewrites: number; failures: number }[];
  topRules: { id: string; name: string; rewrites: number }[];
  recentFailures: {
    chatId: number;
    title: string;
    ruleId: string | null;
    reason: string;
    detail: string;
    createdAt: number;
  }[];
};

type RuleRow = {
  id: string;
  name: string;
  description: string | null;
  mode: string;
  from_hosts: string;
  to_host: string | null;
  replaces: string | null;
  strip_query: number;
  pattern: string | null;
  replacement: string | null;
  enabled: number;
  builtin: number;
  user_modified: number;
  hits: number;
  chat_id: number | null;
  created_at: number;
  updated_at: number;
};

type GroupRow = {
  chat_id: number;
  title: string;
  username: string | null;
  type: string;
  approved: number;
  enabled: number;
  preview_all: number | null;
  left_chat: number;
  approved_by: number | null;
  created_at: number;
  updated_at: number;
};

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
    this.seedBuiltins();
  }

  close(): void {
    this.db.close();
  }

  listRules(): Rule[] {
    return this.listGlobalRules();
  }

  listGlobalRules(): Rule[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM rules
         WHERE chat_id IS NULL
         ORDER BY builtin DESC, name COLLATE NOCASE ASC`,
      )
      .all() as RuleRow[];
    return rows.map(mapRule);
  }

  listLocalRules(chatId: number): Rule[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM rules
         WHERE chat_id = ?
         ORDER BY name COLLATE NOCASE ASC`,
      )
      .all(chatId) as RuleRow[];
    return rows.map(mapRule);
  }

  listChatRuleViews(chatId: number): ChatRuleView[] {
    const overrides = this.overrideMap(chatId);
    const locals = this.listLocalRules(chatId).map((rule) => ({
      rule,
      scope: "local" as const,
      globallyEnabled: true,
      locallyOn: rule.enabled,
      effective: rule.enabled,
    }));
    const inherited = this.listGlobalRules().map((rule) => {
      const locallyOn = overrides.get(rule.id) ?? true;
      return {
        rule,
        scope: "global" as const,
        globallyEnabled: rule.enabled,
        locallyOn,
        effective: rule.enabled && locallyOn,
      };
    });
    return [...locals, ...inherited];
  }

  effectiveRules(chatId: number | null): Rule[] {
    if (chatId === null) {
      return this.listGlobalRules().filter((rule) => rule.enabled);
    }
    return this.listChatRuleViews(chatId)
      .filter((view) => view.effective)
      .map((view) => view.rule);
  }

  getRule(id: string): Rule | undefined {
    const row = this.db.prepare("SELECT * FROM rules WHERE id = ?").get(id) as
      | RuleRow
      | undefined;
    return row ? mapRule(row) : undefined;
  }

  toggleRule(id: string): Rule | undefined {
    this.db
      .prepare(
        `UPDATE rules
         SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(now(), id);
    return this.getRule(id);
  }

  createRule(draft: RuleDraft): Rule {
    const id = this.freshId();
    const createdAt = now();
    const match = draft.match ?? [];
    const replaces = draft.replaces ?? [];
    this.db
      .prepare(
        `INSERT INTO rules (
           id, name, description, mode, from_hosts, to_host, replaces, strip_query,
           pattern, replacement, enabled, builtin, user_modified, hits,
           chat_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`,
      )
      .run(
        id,
        draft.name,
        draft.description ?? null,
        draft.mode,
        JSON.stringify(draft.mode === "host" ? match : []),
        draft.mode === "host" ? (replaces[0] ?? null) : null,
        JSON.stringify(replaces),
        draft.stripQuery === false ? 0 : 1,
        draft.mode === "regex" ? (match[0] ?? null) : null,
        draft.mode === "regex" ? (replaces[0] ?? null) : null,
        draft.enabled === false ? 0 : 1,
        draft.chatId ?? null,
        createdAt,
        createdAt,
      );
    return this.getRule(id)!;
  }

  updateRule(id: string, patch: Partial<RuleDraft> & { userModified?: boolean }): Rule | undefined {
    const current = this.getRule(id);
    if (!current) return undefined;
    const next = {
      name: patch.name ?? current.name,
      description: patch.description === undefined ? current.description : patch.description,
      mode: patch.mode ?? current.mode,
      match: patch.match ?? current.match,
      replaces: patch.replaces ?? current.replaces,
      stripQuery: patch.stripQuery ?? current.stripQuery,
      enabled: patch.enabled ?? current.enabled,
    };
    this.db
      .prepare(
        `UPDATE rules
         SET name = ?, description = ?, mode = ?, from_hosts = ?, to_host = ?,
             replaces = ?, strip_query = ?, pattern = ?, replacement = ?, enabled = ?,
             user_modified = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.name,
        next.description,
        next.mode,
        JSON.stringify(next.mode === "host" ? next.match : []),
        next.mode === "host" ? (next.replaces[0] ?? null) : null,
        JSON.stringify(next.replaces),
        next.stripQuery ? 1 : 0,
        next.mode === "regex" ? (next.match[0] ?? null) : null,
        next.mode === "regex" ? (next.replaces[0] ?? null) : null,
        next.enabled ? 1 : 0,
        patch.userModified === false ? 0 : 1,
        now(),
        id,
      );
    return this.getRule(id);
  }

  resetBuiltin(id: string): Rule | undefined {
    const builtin = builtinRules.find((rule) => rule.id === id);
    if (!builtin) return undefined;
    this.db
      .prepare(
        `UPDATE rules
         SET name = ?, description = ?, mode = ?, from_hosts = ?, to_host = ?,
             replaces = ?, strip_query = ?, pattern = ?, replacement = ?, user_modified = 0,
             updated_at = ?
         WHERE id = ? AND builtin = 1`,
      )
      .run(
        builtin.name,
        builtin.description,
        builtin.mode,
        JSON.stringify(builtin.match),
        builtin.replaces[0] ?? null,
        JSON.stringify(builtin.replaces),
        builtin.stripQuery ? 1 : 0,
        null,
        null,
        now(),
        id,
      );
    return this.getRule(id);
  }

  deleteRule(id: string): boolean {
    this.db.prepare("DELETE FROM chat_rule_overrides WHERE rule_id = ?").run(id);
    const result = this.db
      .prepare("DELETE FROM rules WHERE id = ? AND builtin = 0")
      .run(id);
    return Number(result.changes) > 0;
  }

  toggleChatRule(chatId: number, ruleId: string): ChatRuleView | undefined {
    const rule = this.getRule(ruleId);
    if (!rule) return undefined;
    if (rule.chatId === chatId) {
      this.toggleRule(ruleId);
      return this.listChatRuleViews(chatId).find((view) => view.rule.id === ruleId);
    }
    if (rule.chatId !== null) return undefined;
    const locallyOn = this.overrideMap(chatId).get(ruleId) ?? true;
    this.setOverride(chatId, ruleId, !locallyOn);
    return this.listChatRuleViews(chatId).find((view) => view.rule.id === ruleId);
  }

  bumpHits(ids: string[]): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare(
      "UPDATE rules SET hits = hits + 1, updated_at = updated_at WHERE id = ?",
    );
    for (const id of ids) stmt.run(id);
  }

  recordRewrites(
    events: { chatId: number; ruleId: string; destHost: string }[],
  ): void {
    if (events.length === 0) return;
    const day = dayKey(now());
    const stmt = this.db.prepare(
      `INSERT INTO rewrite_stats (day, chat_id, rule_id, dest_host, rewrites, failures)
       VALUES (?, ?, ?, ?, 1, 0)
       ON CONFLICT(day, chat_id, rule_id, dest_host)
       DO UPDATE SET rewrites = rewrites + 1`,
    );
    for (const event of events) {
      stmt.run(day, event.chatId, event.ruleId, event.destHost);
    }
    this.bumpHits(events.map((event) => event.ruleId));
  }

  recordFailures(
    events: { chatId: number; ruleId: string | null; reason: string; detail: string }[],
  ): void {
    if (events.length === 0) return;
    const day = dayKey(now());
    const ts = now();
    const failStmt = this.db.prepare(
      `INSERT INTO rewrite_failures (chat_id, rule_id, reason, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const statStmt = this.db.prepare(
      `INSERT INTO rewrite_stats (day, chat_id, rule_id, dest_host, rewrites, failures)
       VALUES (?, ?, ?, '', 0, 1)
       ON CONFLICT(day, chat_id, rule_id, dest_host)
       DO UPDATE SET failures = failures + 1`,
    );
    for (const event of events) {
      failStmt.run(event.chatId, event.ruleId, event.reason, event.detail.slice(0, 400), ts);
      statStmt.run(day, event.chatId, event.ruleId ?? "_", "");
    }
    const oldestKeep = this.db
      .prepare("SELECT id FROM rewrite_failures ORDER BY id DESC LIMIT 1 OFFSET 199")
      .get() as { id: number } | undefined;
    if (oldestKeep) {
      this.db.prepare("DELETE FROM rewrite_failures WHERE id < ?").run(oldestKeep.id);
    }
  }

  listGroups(): GroupRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM groups
         ORDER BY left_chat ASC, approved DESC, title COLLATE NOCASE ASC`,
      )
      .all() as GroupRow[];
    return rows.map(mapGroup);
  }

  getGroup(chatId: number): GroupRecord | undefined {
    const row = this.db.prepare("SELECT * FROM groups WHERE chat_id = ?").get(chatId) as
      | GroupRow
      | undefined;
    return row ? mapGroup(row) : undefined;
  }

  upsertGroup(input: {
    chatId: number;
    title: string;
    username?: string | null;
    type: string;
    left?: boolean;
  }): GroupRecord {
    const existing = this.getGroup(input.chatId);
    const ts = now();
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO groups (
             chat_id, title, username, type, approved, enabled, preview_all, left_chat,
             approved_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 0, 1, 1, ?, NULL, ?, ?)`,
        )
        .run(
          input.chatId,
          input.title,
          input.username ?? null,
          input.type,
          input.left ? 1 : 0,
          ts,
          ts,
        );
      return this.getGroup(input.chatId)!;
    }

    this.db
      .prepare(
        `UPDATE groups
         SET title = ?, username = ?, type = ?, left_chat = ?, updated_at = ?
         WHERE chat_id = ?`,
      )
      .run(
        input.title,
        input.username ?? null,
        input.type,
        input.left ? 1 : existing.left ? 1 : 0,
        ts,
        input.chatId,
      );
    return this.getGroup(input.chatId)!;
  }

  setGroupApproval(chatId: number, approved: boolean, approvedBy: number | null): GroupRecord | undefined {
    this.db
      .prepare(
        `UPDATE groups
         SET approved = ?, approved_by = ?, enabled = CASE WHEN ? = 1 THEN 1 ELSE enabled END,
             updated_at = ?
         WHERE chat_id = ?`,
      )
      .run(approved ? 1 : 0, approved ? approvedBy : null, approved ? 1 : 0, now(), chatId);
    return this.getGroup(chatId);
  }

  setGroupEnabled(chatId: number, enabled: boolean): GroupRecord | undefined {
    this.db
      .prepare("UPDATE groups SET enabled = ?, updated_at = ? WHERE chat_id = ?")
      .run(enabled ? 1 : 0, now(), chatId);
    return this.getGroup(chatId);
  }

  setGroupPreviewAll(chatId: number, previewAll: boolean): GroupRecord | undefined {
    this.db
      .prepare("UPDATE groups SET preview_all = ?, updated_at = ? WHERE chat_id = ?")
      .run(previewAll ? 1 : 0, now(), chatId);
    return this.getGroup(chatId);
  }

  markGroupLeft(chatId: number, left: boolean): void {
    this.db
      .prepare("UPDATE groups SET left_chat = ?, updated_at = ? WHERE chat_id = ?")
      .run(left ? 1 : 0, now(), chatId);
  }

  exportRules(chatId?: number): RulesExport {
    if (chatId != null) {
      const group = this.getGroup(chatId);
      return {
        version: 1,
        exportedAt: now(),
        globalRules: [],
        chats: [
          {
            chatId,
            title: group?.title ?? String(chatId),
            type: group?.type ?? "supergroup",
            username: group?.username ?? null,
            approved: group?.approved ?? false,
            enabled: group?.enabled ?? true,
            previewAll: group?.previewAll ?? true,
            overrides: Object.fromEntries(this.overrideMap(chatId)),
            localRules: this.listLocalRules(chatId).map(toExportedRule),
          },
        ],
      };
    }

    return {
      version: 1,
      exportedAt: now(),
      globalRules: this.listGlobalRules().map(toExportedRule),
      chats: this.listGroups().map((group) => ({
        chatId: group.chatId,
        title: group.title,
        type: group.type,
        username: group.username,
        approved: group.approved,
        enabled: group.enabled,
        previewAll: group.previewAll,
        overrides: Object.fromEntries(this.overrideMap(group.chatId)),
        localRules: this.listLocalRules(group.chatId).map(toExportedRule),
      })),
    };
  }

  importRules(bundle: RulesExport, chatId?: number): { rules: number; chats: number } {
    let rules = 0;
    let chats = 0;

    if (chatId == null) {
      for (const item of bundle.globalRules) {
        if (this.applyExportedRule(item, null)) rules += 1;
      }
    }

    const targets =
      chatId != null
        ? bundle.chats.filter((chat) => chat.chatId === chatId).length > 0
          ? bundle.chats.filter((chat) => chat.chatId === chatId)
          : bundle.chats.slice(0, 1).map((chat) => ({ ...chat, chatId }))
        : bundle.chats;

    for (const chat of targets) {
      const existing = this.getGroup(chat.chatId);
      if (!existing) continue;
      chats += 1;
      this.setGroupPreviewAll(chat.chatId, chat.previewAll !== false);
      for (const [ruleId, enabled] of Object.entries(chat.overrides ?? {})) {
        if (!this.getRule(ruleId) || this.getRule(ruleId)?.chatId != null) continue;
        this.setOverride(chat.chatId, ruleId, enabled);
      }
      for (const item of chat.localRules ?? []) {
        if (this.applyExportedRule({ ...item, builtin: false }, chat.chatId)) rules += 1;
      }
    }

    return { rules, chats };
  }

  stats(): {
    rulesEnabled: number;
    rulesTotal: number;
    groupsApproved: number;
    groupsPending: number;
    hits: number;
  } {
    return this.dashboardStats();
  }

  dashboardStats(): DashboardStats {
    const ruleStats = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled,
           SUM(hits) AS hits
         FROM rules
         WHERE chat_id IS NULL`,
      )
      .get() as { total: number; enabled: number | null; hits: number | null };
    const groupStats = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN approved = 1 AND left_chat = 0 THEN 1 ELSE 0 END) AS approved,
           SUM(CASE WHEN approved = 0 AND left_chat = 0 THEN 1 ELSE 0 END) AS pending
         FROM groups`,
      )
      .get() as { approved: number | null; pending: number | null };
    const totals = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(rewrites), 0) AS rewrites,
           COALESCE(SUM(failures), 0) AS failures
         FROM rewrite_stats`,
      )
      .get() as { rewrites: number | bigint; failures: number | bigint };
    const today = this.db
      .prepare(
        `SELECT COALESCE(SUM(rewrites), 0) AS rewrites
         FROM rewrite_stats WHERE day = ?`,
      )
      .get(dayKey(now())) as { rewrites: number | bigint };
    const byChatRows = this.db
      .prepare(
        `SELECT s.chat_id AS chatId,
                COALESCE(g.title, CASE WHEN s.chat_id = 0 THEN 'Private chats' ELSE CAST(s.chat_id AS TEXT) END) AS title,
                SUM(s.rewrites) AS rewrites,
                SUM(s.failures) AS failures
         FROM rewrite_stats s
         LEFT JOIN groups g ON g.chat_id = s.chat_id
         GROUP BY s.chat_id
         ORDER BY rewrites DESC
         LIMIT 20`,
      )
      .all() as { chatId: number; title: string; rewrites: number | bigint; failures: number | bigint }[];
    const topRuleRows = this.db
      .prepare(
        `SELECT r.id AS id, r.name AS name, COALESCE(SUM(s.rewrites), r.hits) AS rewrites
         FROM rules r
         LEFT JOIN rewrite_stats s ON s.rule_id = r.id
         GROUP BY r.id
         HAVING rewrites > 0
         ORDER BY rewrites DESC
         LIMIT 10`,
      )
      .all() as { id: string; name: string; rewrites: number | bigint }[];
    const failureRows = this.db
      .prepare(
        `SELECT f.chat_id AS chatId,
                COALESCE(g.title, CASE WHEN f.chat_id = 0 THEN 'Private chats' ELSE CAST(f.chat_id AS TEXT) END) AS title,
                f.rule_id AS ruleId,
                f.reason AS reason,
                f.detail AS detail,
                f.created_at AS createdAt
         FROM rewrite_failures f
         LEFT JOIN groups g ON g.chat_id = f.chat_id
         ORDER BY f.id DESC
         LIMIT 15`,
      )
      .all() as {
        chatId: number;
        title: string;
        ruleId: string | null;
        reason: string;
        detail: string;
        createdAt: number;
      }[];

    return {
      rulesTotal: Number(ruleStats.total ?? 0),
      rulesEnabled: Number(ruleStats.enabled ?? 0),
      groupsApproved: Number(groupStats.approved ?? 0),
      groupsPending: Number(groupStats.pending ?? 0),
      hits: Number(ruleStats.hits ?? 0),
      rewritesTotal: Number(totals.rewrites ?? 0),
      rewritesToday: Number(today.rewrites ?? 0),
      failuresTotal: Number(totals.failures ?? 0),
      byChat: byChatRows.map((row) => ({
        chatId: Number(row.chatId),
        title: row.title,
        rewrites: Number(row.rewrites),
        failures: Number(row.failures),
      })),
      topRules: topRuleRows.map((row) => ({
        id: row.id,
        name: row.name,
        rewrites: Number(row.rewrites),
      })),
      recentFailures: failureRows.map((row) => ({
        ...row,
        chatId: Number(row.chatId),
        createdAt: Number(row.createdAt),
      })),
    };
  }

  private applyExportedRule(item: ExportedRule, chatId: number | null): boolean {
    const match = Array.isArray(item.match) ? item.match.map(String) : [];
    const replaces = Array.isArray(item.replaces) ? item.replaces.map(String) : [];
    if (match.length === 0 || replaces.length === 0) return false;
    const mode: RuleMode = item.mode === "regex" ? "regex" : "host";
    const existing = item.id ? this.getRule(item.id) : undefined;

    if (chatId == null) {
      if (existing?.builtin && item.builtin) {
        this.updateRule(existing.id, {
          name: String(item.name ?? existing.name).slice(0, 64),
          description: item.description ?? existing.description,
          mode,
          match,
          replaces,
          stripQuery: item.stripQuery !== false,
          enabled: item.enabled !== false,
          userModified: true,
        });
        return true;
      }
      if (existing && !existing.builtin && existing.chatId == null && !item.builtin) {
        this.updateRule(existing.id, {
          name: String(item.name ?? existing.name).slice(0, 64),
          mode,
          match,
          replaces,
          stripQuery: item.stripQuery !== false,
          enabled: item.enabled !== false,
        });
        return true;
      }
      this.createRule({
        name: String(item.name ?? "Imported rule").slice(0, 64),
        description: item.description ?? null,
        mode,
        match,
        replaces,
        stripQuery: item.stripQuery !== false,
        enabled: item.enabled !== false,
        chatId: null,
      });
      return true;
    }

    this.createRule({
      name: String(item.name ?? "Imported rule").slice(0, 64),
      description: item.description ?? null,
      mode,
      match,
      replaces,
      stripQuery: item.stripQuery !== false,
      enabled: item.enabled !== false,
      chatId,
    });
    return true;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        mode TEXT NOT NULL,
        from_hosts TEXT NOT NULL DEFAULT '[]',
        to_host TEXT,
        strip_query INTEGER NOT NULL DEFAULT 1,
        pattern TEXT,
        replacement TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        builtin INTEGER NOT NULL DEFAULT 0,
        user_modified INTEGER NOT NULL DEFAULT 0,
        hits INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS groups (
        chat_id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        username TEXT,
        type TEXT NOT NULL,
        approved INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        left_chat INTEGER NOT NULL DEFAULT 0,
        approved_by INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_rule_overrides (
        chat_id INTEGER NOT NULL,
        rule_id TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        PRIMARY KEY (chat_id, rule_id)
      );
      CREATE TABLE IF NOT EXISTS rewrite_stats (
        day TEXT NOT NULL,
        chat_id INTEGER NOT NULL,
        rule_id TEXT NOT NULL,
        dest_host TEXT NOT NULL DEFAULT '',
        rewrites INTEGER NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, chat_id, rule_id, dest_host)
      );
      CREATE TABLE IF NOT EXISTS rewrite_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        rule_id TEXT,
        reason TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.ensureColumn("rules", "chat_id", "INTEGER");
    this.ensureColumn("rules", "replaces", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("groups", "preview_all", "INTEGER NOT NULL DEFAULT 1");
    this.backfillReplaces();
  }

  private backfillReplaces(): void {
    const rows = this.db.prepare("SELECT id, mode, to_host, replacement, replaces FROM rules").all() as {
      id: string;
      mode: string;
      to_host: string | null;
      replacement: string | null;
      replaces: string | null;
    }[];
    const update = this.db.prepare("UPDATE rules SET replaces = ? WHERE id = ?");
    for (const row of rows) {
      const existing = parseJsonArray(row.replaces);
      if (existing.length > 0) continue;
      const fallback = row.mode === "regex" ? row.replacement : row.to_host;
      if (!fallback) continue;
      update.run(JSON.stringify([fallback]), row.id);
    }
  }

  private overrideMap(chatId: number): Map<string, boolean> {
    const rows = this.db
      .prepare("SELECT rule_id, enabled FROM chat_rule_overrides WHERE chat_id = ?")
      .all(chatId) as { rule_id: string; enabled: number }[];
    return new Map(rows.map((row) => [row.rule_id, row.enabled === 1]));
  }

  private setOverride(chatId: number, ruleId: string, enabled: boolean): void {
    this.db
      .prepare(
        `INSERT INTO chat_rule_overrides (chat_id, rule_id, enabled)
         VALUES (?, ?, ?)
         ON CONFLICT(chat_id, rule_id) DO UPDATE SET enabled = excluded.enabled`,
      )
      .run(chatId, ruleId, enabled ? 1 : 0);
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.some((entry) => entry.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private seedBuiltins(): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO rules (
         id, name, description, mode, from_hosts, to_host, replaces, strip_query,
         pattern, replacement, enabled, builtin, user_modified, hits,
         chat_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, NULL, ?, ?)`,
    );
    const sync = this.db.prepare(
      `UPDATE rules
       SET name = ?, description = ?, mode = ?, from_hosts = ?, to_host = ?,
           replaces = ?, strip_query = ?, pattern = NULL, replacement = NULL, updated_at = ?
       WHERE id = ? AND builtin = 1 AND user_modified = 0`,
    );
    const ts = now();
    for (const rule of builtinRules) {
      insert.run(
        rule.id,
        rule.name,
        rule.description,
        rule.mode,
        JSON.stringify(rule.match),
        rule.replaces[0] ?? null,
        JSON.stringify(rule.replaces),
        rule.stripQuery ? 1 : 0,
        null,
        null,
        rule.enabled ? 1 : 0,
        ts,
        ts,
      );
      sync.run(
        rule.name,
        rule.description,
        rule.mode,
        JSON.stringify(rule.match),
        rule.replaces[0] ?? null,
        JSON.stringify(rule.replaces),
        rule.stripQuery ? 1 : 0,
        ts,
        rule.id,
      );
    }
  }

  private freshId(): string {
    for (;;) {
      const id = `c${randomBytes(4).toString("hex")}`;
      if (!this.getRule(id)) return id;
    }
  }
}

function now(): number {
  return Date.now();
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    return [];
  }
}

function mapRule(row: RuleRow): Rule {
  const fromHosts = parseJsonArray(row.from_hosts);
  const storedReplaces = parseJsonArray(row.replaces);
  const regex = row.mode === "regex";
  const match = regex ? (row.pattern ? [row.pattern] : []) : fromHosts;
  const replaces = storedReplaces.length
    ? storedReplaces
    : regex
      ? row.replacement
        ? [row.replacement]
        : []
      : row.to_host
        ? [row.to_host]
        : [];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    mode: regex ? "regex" : "host",
    match,
    replaces,
    stripQuery: row.strip_query === 1,
    enabled: row.enabled === 1,
    builtin: row.builtin === 1,
    userModified: row.user_modified === 1,
    hits: row.hits,
    chatId: row.chat_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toExportedRule(rule: Rule): ExportedRule {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    mode: rule.mode,
    match: rule.match,
    replaces: rule.replaces,
    stripQuery: rule.stripQuery,
    enabled: rule.enabled,
    builtin: rule.builtin,
  };
}

function mapGroup(row: GroupRow): GroupRecord {
  return {
    chatId: row.chat_id,
    title: row.title,
    username: row.username,
    type: row.type,
    approved: row.approved === 1,
    enabled: row.enabled === 1,
    previewAll: row.preview_all !== 0,
    left: row.left_chat === 1,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
