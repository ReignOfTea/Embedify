import { InlineKeyboard } from "grammy";
import type { ChatRuleView, GroupRecord, Rule } from "../db.js";
import { escapeHtml } from "./format.js";

export const PAGE_SIZE = 6;

export function homeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Global rules", "d:rules:0")
    .row()
    .text("Groups & channels", "d:groups:0")
    .row()
    .text("New global rule", "d:new")
    .text("Help", "d:help");
}

export function rulesKeyboard(rules: Rule[], page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const slice = paginate(rules, page);
  for (const rule of slice.items) {
    keyboard.text(`${rule.enabled ? "✅" : "❌"} ${rule.name}`, `r:v:${rule.id}`).row();
  }
  addPager(keyboard, "d:rules", slice);
  keyboard.text("New global rule", "d:new").text("Home", "d:home");
  return keyboard;
}

export function ruleKeyboard(rule: Rule): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text(rule.enabled ? "Disable globally" : "Enable globally", `r:t:${rule.id}`)
    .row()
    .text("Rename", `r:e:${rule.id}:name`);

  if (rule.mode === "host") {
    keyboard.row().text("Edit match hosts", `r:e:${rule.id}:match`);
    keyboard.row().text("Edit replaces", `r:e:${rule.id}:replaces`);
    keyboard.row().text(rule.stripQuery ? "Keep query params" : "Strip query params", `r:q:${rule.id}`);
  } else {
    keyboard.row().text("Edit regex", `r:e:${rule.id}:pattern`);
    keyboard.row().text("Edit replacements", `r:e:${rule.id}:replaces`);
  }

  if (rule.builtin) {
    keyboard.row().text("Reset to default", `r:z:${rule.id}`);
  } else {
    keyboard.row().text("Delete", `r:d:${rule.id}`);
  }

  keyboard.row().text("Back", "d:rules:0");
  return keyboard;
}

export function chatRulesKeyboard(
  views: ChatRuleView[],
  chatId: number,
  page: number,
  back: "group" | "close",
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const slice = paginate(views, page);
  for (const view of slice.items) {
    const tag = view.scope === "local" ? " · local" : "";
    keyboard.text(`${view.effective ? "✅" : "❌"} ${view.rule.name}${tag}`, `cv:${chatId}:${view.rule.id}`).row();
  }
  addPager(keyboard, `cr:${chatId}`, slice);
  keyboard.text("New local rule", `cn:${chatId}`).row();
  if (back === "group") {
    keyboard.text("Back", `g:v:${chatId}`);
  } else {
    keyboard.text("Close", `cc:${chatId}`);
  }
  return keyboard;
}

export function chatRuleKeyboard(view: ChatRuleView, chatId: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const rule = view.rule;

  if (view.scope === "global") {
    if (!view.globallyEnabled) {
      keyboard.text("Off globally", `cv:${chatId}:${rule.id}`);
    } else {
      keyboard.text(view.locallyOn ? "Disable here" : "Enable here", `ct:${chatId}:${rule.id}`);
    }
    keyboard.row().text("Back", `cr:${chatId}:0`);
    return keyboard;
  }

  keyboard.text(rule.enabled ? "Disable here" : "Enable here", `ct:${chatId}:${rule.id}`).row();
  keyboard.text("Rename", `ce:${chatId}:${rule.id}:name`);
  if (rule.mode === "host") {
    keyboard.row().text("Edit match hosts", `ce:${chatId}:${rule.id}:match`);
    keyboard.row().text("Edit replaces", `ce:${chatId}:${rule.id}:replaces`);
    keyboard.row().text(rule.stripQuery ? "Keep query params" : "Strip query params", `cq:${chatId}:${rule.id}`);
  } else {
    keyboard.row().text("Edit regex", `ce:${chatId}:${rule.id}:pattern`);
    keyboard.row().text("Edit replacements", `ce:${chatId}:${rule.id}:replaces`);
  }
  keyboard.row().text("Delete", `cd:${chatId}:${rule.id}`);
  keyboard.row().text("Back", `cr:${chatId}:0`);
  return keyboard;
}

export function deleteConfirmKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes, delete", `r:x:${id}`)
    .text("Cancel", `r:v:${id}`);
}

export function chatDeleteConfirmKeyboard(chatId: number, id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes, delete", `cx:${chatId}:${id}`)
    .text("Cancel", `cv:${chatId}:${id}`);
}

export function groupsKeyboard(groups: GroupRecord[], page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const slice = paginate(groups, page);
  for (const group of slice.items) {
    keyboard.text(`${groupBadge(group)} ${group.title}`, `g:v:${group.chatId}`).row();
  }
  addPager(keyboard, "d:groups", slice);
  keyboard.text("Home", "d:home");
  return keyboard;
}

export function groupKeyboard(group: GroupRecord): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (group.approved) {
    keyboard.text("Revoke approval", `g:r:${group.chatId}`);
  } else {
    keyboard.text("Approve", `g:a:${group.chatId}`);
  }
  keyboard.row();
  if (group.enabled) {
    keyboard.text("Pause", `g:p:${group.chatId}`);
  } else {
    keyboard.text("Resume", `g:u:${group.chatId}`);
  }
  keyboard.row();
  keyboard.text(group.previewAll ? "Preview: each link" : "Preview: first only", `g:prev:${group.chatId}`);
  keyboard.row();
  keyboard.text("Chat rules", `cr:${group.chatId}:0`);
  keyboard.row().text("Back", "d:groups:0");
  return keyboard;
}

export function groupGateKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Approve bot", "g:ok")
    .text("Not now", "g:no");
}

export function createModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Host swap", "w:mode:host")
    .text("Regex", "w:mode:regex")
    .row()
    .text("Cancel", "w:cancel");
}

export function yesNoKeyboard(prefix: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", `${prefix}:yes`)
    .text("No", `${prefix}:no`)
    .row()
    .text("Cancel", "w:cancel");
}

export function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Cancel", "w:cancel");
}

export function groupBadge(group: GroupRecord): string {
  if (group.left) return "🚪";
  if (!group.approved) return "⏳";
  if (!group.enabled) return "⏸";
  return "✅";
}

export function groupStatus(group: GroupRecord): string {
  if (group.left) return "Bot is no longer in this chat";
  if (!group.approved) return "Waiting for approval";
  if (!group.enabled) return "Approved, currently paused";
  return "Active";
}

export function ruleSummary(rule: Rule, view?: ChatRuleView): string {
  const scope = rule.chatId == null ? "Global" : "Local to this chat";
  const status = view
    ? view.effective
      ? "Active here"
      : view.scope === "global" && !view.globallyEnabled
        ? "Disabled globally"
        : "Disabled here"
    : rule.enabled
      ? "Enabled"
      : "Disabled";
  const kind = rule.builtin ? "Built-in" : "Custom";
  const lines = [
    `<b>${escapeHtml(rule.name)}</b>`,
    "",
    `${status} · ${scope} · ${kind}${rule.userModified ? " · edited" : ""}`,
    `Used ${rule.hits} time${rule.hits === 1 ? "" : "s"}`,
  ];
  if (rule.description) {
    lines.splice(1, 0, escapeHtml(rule.description));
  }
  if (view?.scope === "global" && view.globallyEnabled && !view.locallyOn) {
    lines.push("This global rule is turned off only in this chat.");
  }
  lines.push("");
  if (rule.mode === "host") {
    lines.push(`Match: <code>${escapeHtml(rule.match.join(", ") || "—")}</code>`);
    lines.push(`Replaces: <code>${escapeHtml(rule.replaces.join(" → ") || "—")}</code>`);
    lines.push(`Strip query: ${rule.stripQuery ? "yes" : "no"}`);
  } else {
    lines.push(`Regex: <code>${escapeHtml(rule.match[0] ?? "—")}</code>`);
    lines.push(`Replaces: <code>${escapeHtml(rule.replaces.join(" → ") || "—")}</code>`);
  }
  return lines.join("\n");
}

type PageSlice<T> = {
  items: T[];
  page: number;
  pages: number;
};

function paginate<T>(items: T[], page: number): PageSlice<T> {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const start = current * PAGE_SIZE;
  return {
    items: items.slice(start, start + PAGE_SIZE),
    page: current,
    pages,
  };
}

function addPager(keyboard: InlineKeyboard, prefix: string, slice: PageSlice<unknown>): void {
  if (slice.pages <= 1) return;
  const buttons = [];
  if (slice.page > 0) buttons.push({ text: "◀", data: `${prefix}:${slice.page - 1}` });
  buttons.push({ text: `${slice.page + 1}/${slice.pages}`, data: `${prefix}:${slice.page}` });
  if (slice.page < slice.pages - 1) buttons.push({ text: "▶", data: `${prefix}:${slice.page + 1}` });
  if (buttons[0]) keyboard.text(buttons[0].text, buttons[0].data);
  if (buttons[1]) keyboard.text(buttons[1].text, buttons[1].data);
  if (buttons[2]) keyboard.text(buttons[2].text, buttons[2].data);
  keyboard.row();
}
