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
  fromHosts: string[];
  toHost: string | null;
  stripQuery: boolean;
  pattern: string | null;
  replacement: string | null;
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
  left: boolean;
  approvedBy: number | null;
  createdAt: number;
  updatedAt: number;
};

export type RuleDraft = {
  name: string;
  description?: string | null;
  mode: RuleMode;
  fromHosts?: string[];
  toHost?: string | null;
  stripQuery?: boolean;
  pattern?: string | null;
  replacement?: string | null;
  enabled?: boolean;
  chatId?: number | null;
};

type RuleRow = {
  id: string;
  name: string;
  description: string | null;
  mode: string;
  from_hosts: string;
  to_host: string | null;
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
    this.db
      .prepare(
        `INSERT INTO rules (
           id, name, description, mode, from_hosts, to_host, strip_query,
           pattern, replacement, enabled, builtin, user_modified, hits,
           chat_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`,
      )
      .run(
        id,
        draft.name,
        draft.description ?? null,
        draft.mode,
        JSON.stringify(draft.fromHosts ?? []),
        draft.toHost ?? null,
        draft.stripQuery === false ? 0 : 1,
        draft.pattern ?? null,
        draft.replacement ?? null,
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
      fromHosts: patch.fromHosts ?? current.fromHosts,
      toHost: patch.toHost === undefined ? current.toHost : patch.toHost,
      stripQuery: patch.stripQuery ?? current.stripQuery,
      pattern: patch.pattern === undefined ? current.pattern : patch.pattern,
      replacement: patch.replacement === undefined ? current.replacement : patch.replacement,
      enabled: patch.enabled ?? current.enabled,
    };
    this.db
      .prepare(
        `UPDATE rules
         SET name = ?, description = ?, mode = ?, from_hosts = ?, to_host = ?,
             strip_query = ?, pattern = ?, replacement = ?, enabled = ?,
             user_modified = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.name,
        next.description,
        next.mode,
        JSON.stringify(next.fromHosts),
        next.toHost,
        next.stripQuery ? 1 : 0,
        next.pattern,
        next.replacement,
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
             strip_query = ?, pattern = ?, replacement = ?, user_modified = 0,
             updated_at = ?
         WHERE id = ? AND builtin = 1`,
      )
      .run(
        builtin.name,
        builtin.description,
        builtin.mode,
        JSON.stringify(builtin.fromHosts),
        builtin.toHost,
        builtin.stripQuery ? 1 : 0,
        builtin.pattern,
        builtin.replacement,
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
             chat_id, title, username, type, approved, enabled, left_chat,
             approved_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 0, 1, ?, NULL, ?, ?)`,
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

  markGroupLeft(chatId: number, left: boolean): void {
    this.db
      .prepare("UPDATE groups SET left_chat = ?, updated_at = ? WHERE chat_id = ?")
      .run(left ? 1 : 0, now(), chatId);
  }

  stats(): { rulesEnabled: number; rulesTotal: number; groupsApproved: number; groupsPending: number; hits: number } {
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

    return {
      rulesTotal: Number(ruleStats.total ?? 0),
      rulesEnabled: Number(ruleStats.enabled ?? 0),
      groupsApproved: Number(groupStats.approved ?? 0),
      groupsPending: Number(groupStats.pending ?? 0),
      hits: Number(ruleStats.hits ?? 0),
    };
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
    `);
    this.ensureColumn("rules", "chat_id", "INTEGER");
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
         id, name, description, mode, from_hosts, to_host, strip_query,
         pattern, replacement, enabled, builtin, user_modified, hits,
         chat_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, NULL, ?, ?)`,
    );
    const ts = now();
    for (const rule of builtinRules) {
      insert.run(
        rule.id,
        rule.name,
        rule.description,
        rule.mode,
        JSON.stringify(rule.fromHosts),
        rule.toHost,
        rule.stripQuery ? 1 : 0,
        rule.pattern,
        rule.replacement,
        rule.enabled ? 1 : 0,
        ts,
        ts,
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

function mapRule(row: RuleRow): Rule {
  let fromHosts: string[] = [];
  try {
    fromHosts = JSON.parse(row.from_hosts) as string[];
  } catch {
    fromHosts = [];
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    mode: row.mode === "regex" ? "regex" : "host",
    fromHosts,
    toHost: row.to_host,
    stripQuery: row.strip_query === 1,
    pattern: row.pattern,
    replacement: row.replacement,
    enabled: row.enabled === 1,
    builtin: row.builtin === 1,
    userModified: row.user_modified === 1,
    hits: row.hits,
    chatId: row.chat_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    left: row.left_chat === 1,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
