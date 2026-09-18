import { GrammyError, type Composer } from "grammy";
import type { AppConfig } from "../config.js";
import type { Store } from "../db.js";
import { escapeHtml } from "./format.js";
import type { BotContext } from "./context.js";
import { canManageChat, isBotOwner } from "./auth.js";
import { webAppKeyboard } from "./webapp.js";
import {
  cancelKeyboard,
  chatDeleteConfirmKeyboard,
  chatRuleKeyboard,
  chatRulesKeyboard,
  deleteConfirmKeyboard,
  groupKeyboard,
  groupsKeyboard,
  groupStatus,
  homeKeyboard,
  ruleKeyboard,
  rulesKeyboard,
  ruleSummary,
} from "./ui.js";

export function registerDashboard(
  bot: Composer<BotContext>,
  store: Store,
  config: AppConfig,
): void {
  bot.use(async (ctx, next) => {
    const data = ctx.callbackQuery?.data;
    if (data && !data.startsWith("w:") && data !== "d:new" && !data.startsWith("r:e:") && !data.startsWith("cn:") && !data.startsWith("ce:")) {
      ctx.session.wizard = null;
    }
    await next();
  });

  bot.command(["start", "dashboard"], async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Open a private chat with me to use the dashboard.");
      return;
    }
    ctx.session.wizard = null;
    if (config.webAppUrl) {
      const payload = typeof ctx.match === "string" ? ctx.match.trim() : "";
      const chatId = payload.startsWith("c") ? payload.slice(1) : undefined;
      if (!isBotOwner(ctx, config) && !chatId) {
        await ctx.reply(
          [
            "<b>Embedify</b>",
            "",
            "I rewrite social links in approved groups and channels so Telegram can show proper embeds.",
            "Ask a bot owner to add and approve me, then use /rules in the chat.",
          ].join("\n"),
          { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
        );
        return;
      }
      await ctx.reply(
        isBotOwner(ctx, config)
          ? "Open the dashboard to manage global rules and chats."
          : "Open the dashboard to manage rules for that chat.",
        {
          reply_markup: webAppKeyboard(config, chatId),
          link_preview_options: { is_disabled: true },
        },
      );
      return;
    }
    if (!isBotOwner(ctx, config)) {
      await ctx.reply(
        [
          "<b>Embedify</b>",
          "",
          "I rewrite social links in approved groups and channels so Telegram can show proper embeds.",
          "Ask a bot owner to add and approve me, then use /rules in the chat.",
        ].join("\n"),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
      );
      return;
    }
    await showHome(ctx, store);
  });

  bot.callbackQuery("d:home", async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    ctx.session.wizard = null;
    await showHome(ctx, store);
  });

  bot.callbackQuery(/^d:rules:(\d+)$/, async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    const page = Number(ctx.match[1]);
    await showRules(ctx, store, page);
  });

  bot.callbackQuery(/^d:groups:(\d+)$/, async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    const page = Number(ctx.match[1]);
    await showGroups(ctx, store, page);
  });

  bot.callbackQuery("d:help", async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    await render(
      ctx,
      [
        "<b>How Embedify works</b>",
        "",
        "1. Disable privacy mode in @BotFather so I can see group messages: <code>/setprivacy</code> → Disable.",
        "2. Add me to a group or channel. An admin must approve me.",
        "3. I reply to matching links with embed-friendly URLs.",
        "",
        "<b>Global rules</b> apply everywhere unless a chat turns them off.",
        "<b>Local rules</b> are created in a chat and only exist there.",
        "Use /rules in a group or channel to manage that chat.",
      ].join("\n"),
      homeKeyboard(),
    );
  });

  bot.callbackQuery(/^r:v:(.+)$/, async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    await showRule(ctx, store, ctx.match[1]!);
  });

  bot.callbackQuery(/^r:t:(.+)$/, async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    const rule = store.toggleRule(ctx.match[1]!);
    if (!rule) {
      await ctx.answerCallbackQuery({ text: "Rule not found", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: rule.enabled ? "Enabled" : "Disabled" });
    await showRule(ctx, store, rule.id, false);
  });

  bot.callbackQuery(/^r:q:(.+)$/, async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    const current = store.getRule(ctx.match[1]!);
    if (!current) {
      await ctx.answerCallbackQuery({ text: "Rule not found", show_alert: true });
      return;
    }
    store.updateRule(current.id, { stripQuery: !current.stripQuery });
    await ctx.answerCallbackQuery({ text: "Updated query handling" });
    await showRule(ctx, store, current.id, false);
  });

  bot.callbackQuery(/^r:z:(.+)$/, async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    const rule = store.resetBuiltin(ctx.match[1]!);
    if (!rule) {
      await ctx.answerCallbackQuery({ text: "Only built-in rules can be reset", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Reset to default" });
    await showRule(ctx, store, rule.id, false);
  });

  bot.callbackQuery(/^r:d:(.+)$/, async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    const rule = store.getRule(ctx.match[1]!);
    if (!rule || rule.builtin) {
      await ctx.answerCallbackQuery({ text: "That rule cannot be deleted", show_alert: true });
      return;
    }
    await render(
      ctx,
      `Delete <b>${escapeHtml(rule.name)}</b>? This cannot be undone.`,
      deleteConfirmKeyboard(rule.id),
    );
  });

  bot.callbackQuery(/^r:x:(.+)$/, async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    const ok = store.deleteRule(ctx.match[1]!);
    await ctx.answerCallbackQuery({ text: ok ? "Deleted" : "Could not delete" });
    await showRules(ctx, store, 0, false);
  });

  bot.callbackQuery(/^g:v:(-?\d+)$/, async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    await showGroup(ctx, store, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^g:a:(-?\d+)$/, async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    const group = store.setGroupApproval(Number(ctx.match[1]), true, ctx.from.id);
    await ctx.answerCallbackQuery({ text: group ? "Approved" : "Unknown group" });
    if (group) await showGroup(ctx, store, group.chatId, false);
  });

  bot.callbackQuery(/^g:r:(-?\d+)$/, async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    const group = store.setGroupApproval(Number(ctx.match[1]), false, ctx.from.id);
    await ctx.answerCallbackQuery({ text: "Approval revoked" });
    if (group) await showGroup(ctx, store, group.chatId, false);
  });

  bot.callbackQuery(/^g:p:(-?\d+)$/, async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    const group = store.setGroupEnabled(Number(ctx.match[1]), false);
    await ctx.answerCallbackQuery({ text: "Paused" });
    if (group) await showGroup(ctx, store, group.chatId, false);
  });

  bot.callbackQuery(/^g:u:(-?\d+)$/, async (ctx) => {
    if (!(await guardOwner(ctx, config))) return;
    const group = store.setGroupEnabled(Number(ctx.match[1]), true);
    await ctx.answerCallbackQuery({ text: "Resumed" });
    if (group) await showGroup(ctx, store, group.chatId, false);
  });

  bot.callbackQuery(/^cr:(-?\d+):(\d+)$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    if (!(await guardChatAdmin(ctx, config, chatId))) return;
    await showChatRules(ctx, store, config, chatId, Number(ctx.match[2]));
  });

  bot.callbackQuery(/^cv:(-?\d+):(.+)$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    if (!(await guardChatAdmin(ctx, config, chatId))) return;
    await showChatRule(ctx, store, chatId, ctx.match[2]!);
  });

  bot.callbackQuery(/^ct:(-?\d+):(.+)$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    if (!(await guardChatAdmin(ctx, config, chatId))) return;
    const view = store.toggleChatRule(chatId, ctx.match[2]!);
    if (!view) {
      await ctx.answerCallbackQuery({ text: "Rule not found", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: view.effective ? "Enabled here" : "Disabled here" });
    await showChatRule(ctx, store, chatId, view.rule.id, false);
  });

  bot.callbackQuery(/^cq:(-?\d+):(.+)$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    if (!(await guardChatAdmin(ctx, config, chatId))) return;
    const current = store.getRule(ctx.match[2]!);
    if (!current || current.chatId !== chatId) {
      await ctx.answerCallbackQuery({ text: "Only local rules can be edited here", show_alert: true });
      return;
    }
    store.updateRule(current.id, { stripQuery: !current.stripQuery });
    await ctx.answerCallbackQuery({ text: "Updated query handling" });
    await showChatRule(ctx, store, chatId, current.id, false);
  });

  bot.callbackQuery(/^cd:(-?\d+):(.+)$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    if (!(await guardChatAdmin(ctx, config, chatId))) return;
    const rule = store.getRule(ctx.match[2]!);
    if (!rule || rule.chatId !== chatId || rule.builtin) {
      await ctx.answerCallbackQuery({ text: "Only local custom rules can be deleted", show_alert: true });
      return;
    }
    await render(
      ctx,
      `Delete local rule <b>${escapeHtml(rule.name)}</b>? It will disappear from this chat only.`,
      chatDeleteConfirmKeyboard(chatId, rule.id),
    );
  });

  bot.callbackQuery(/^cx:(-?\d+):(.+)$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    if (!(await guardChatAdmin(ctx, config, chatId))) return;
    const rule = store.getRule(ctx.match[2]!);
    if (!rule || rule.chatId !== chatId) {
      await ctx.answerCallbackQuery({ text: "That rule cannot be deleted here", show_alert: true });
      return;
    }
    const ok = store.deleteRule(rule.id);
    await ctx.answerCallbackQuery({ text: ok ? "Deleted" : "Could not delete" });
    await showChatRules(ctx, store, config, chatId, 0, false);
  });

  bot.callbackQuery(/^cc:(-?\d+)$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    if (!(await guardChatAdmin(ctx, config, chatId))) return;
    await ctx.editMessageText("Closed. Use /rules in the chat to open this again.");
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^cn:(-?\d+)$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    if (!(await guardChatAdmin(ctx, config, chatId))) return;
    ctx.session.wizard = { kind: "create", step: "name", draft: {}, chatId };
    const text =
      "Send a name for this <b>local</b> rule. It will only apply in that chat.\nExample: <code>X → FixupX</code>";
    if (ctx.chat?.type === "private") {
      await prompt(ctx, text);
      return;
    }
    try {
      await ctx.api.sendMessage(ctx.from.id, text, {
        parse_mode: "HTML",
        reply_markup: cancelKeyboard(),
        link_preview_options: { is_disabled: true },
      });
      await ctx.answerCallbackQuery({ text: "Continue in our private chat" });
    } catch {
      ctx.session.wizard = null;
      await ctx.answerCallbackQuery({
        text: "Open a private chat with me first, tap Start, then try again.",
        show_alert: true,
      });
    }
  });
}

export async function showHome(ctx: BotContext, store: Store): Promise<void> {
  const stats = store.stats();
  await render(
    ctx,
    [
      "<b>Embedify dashboard</b>",
      "",
      "Rewrite social links so Telegram shows proper embeds.",
      "",
      `<b>Global rules</b> ${stats.rulesEnabled}/${stats.rulesTotal} enabled`,
      `<b>Chats</b> ${stats.groupsApproved} approved · ${stats.groupsPending} pending`,
      `<b>Rewrites</b> ${stats.hits} total`,
    ].join("\n"),
    homeKeyboard(),
  );
}

async function showRules(
  ctx: BotContext,
  store: Store,
  page: number,
  answer = true,
): Promise<void> {
  const rules = store.listRules();
  await render(
    ctx,
    rules.length
      ? "<b>Global replacement rules</b>\nThese apply in every approved chat unless that chat turns them off."
      : "<b>Global replacement rules</b>\nNo rules yet. Create one to get started.",
    rulesKeyboard(rules, page),
    answer,
  );
}

async function showRule(
  ctx: BotContext,
  store: Store,
  id: string,
  answer = true,
): Promise<void> {
  const rule = store.getRule(id);
  if (!rule) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Rule not found", show_alert: true });
    }
    return;
  }
  await render(ctx, ruleSummary(rule), ruleKeyboard(rule), answer);
}

async function showGroups(
  ctx: BotContext,
  store: Store,
  page: number,
  answer = true,
): Promise<void> {
  const groups = store.listGroups();
  await render(
    ctx,
    groups.length
      ? "<b>Groups & channels</b>\nApprove a chat, then open Chat rules to toggle globals or add local-only rules."
      : "<b>Groups & channels</b>\nI have not been added to any groups or channels yet.",
    groupsKeyboard(groups, page),
    answer,
  );
}

async function showGroup(
  ctx: BotContext,
  store: Store,
  chatId: number,
  answer = true,
): Promise<void> {
  const group = store.getGroup(chatId);
  if (!group) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Group not found", show_alert: true });
    }
    return;
  }
  const username = group.username ? `@${group.username}` : "—";
  await render(
    ctx,
    [
      `<b>${escapeHtml(group.title)}</b>`,
      "",
      `Status: ${escapeHtml(groupStatus(group))}`,
      `Type: ${escapeHtml(group.type)}`,
      `Username: ${escapeHtml(username)}`,
      `Chat ID: <code>${group.chatId}</code>`,
    ].join("\n"),
    groupKeyboard(group),
    answer,
  );
}

export async function showChatRules(
  ctx: BotContext,
  store: Store,
  config: AppConfig,
  chatId: number,
  page: number,
  answer = true,
): Promise<void> {
  const group = store.getGroup(chatId);
  const views = store.listChatRuleViews(chatId);
  const back = ctx.chat?.type === "private" && isBotOwner(ctx, config) ? "group" : "close";
  const title = group ? escapeHtml(group.title) : String(chatId);
  await render(
    ctx,
    [
      `<b>Rules in ${title}</b>`,
      "",
      "Global rules can be turned off here. Local rules you add only exist in this chat.",
    ].join("\n"),
    chatRulesKeyboard(views, chatId, page, back),
    answer,
  );
}

export async function showChatRule(
  ctx: BotContext,
  store: Store,
  chatId: number,
  id: string,
  answer = true,
): Promise<void> {
  const view = store.listChatRuleViews(chatId).find((item) => item.rule.id === id);
  if (!view) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Rule not found in this chat", show_alert: true });
    }
    return;
  }
  await render(ctx, ruleSummary(view.rule, view), chatRuleKeyboard(view, chatId), answer);
}

export async function prompt(ctx: BotContext, text: string): Promise<void> {
  await render(ctx, text, cancelKeyboard());
}

export async function render(
  ctx: BotContext,
  text: string,
  keyboard: ReturnType<typeof homeKeyboard>,
  answer = true,
): Promise<void> {
  const extra = {
    parse_mode: "HTML" as const,
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  };

  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, extra);
    } catch (error) {
      if (!isNotModified(error)) {
        await ctx.reply(text, extra);
      }
    }
    if (answer) {
      try {
        await ctx.answerCallbackQuery();
      } catch {
        // query may already be answered
      }
    }
    return;
  }

  await ctx.reply(text, extra);
}

async function guardChatAdmin(ctx: BotContext, config: AppConfig, chatId: number): Promise<boolean> {
  if (await canManageChat(ctx, config, chatId)) return true;
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: "Admins only", show_alert: true });
  }
  return false;
}

async function guardOwner(ctx: BotContext, config: AppConfig): Promise<boolean> {
  if (isBotOwner(ctx, config)) return true;
  await ctx.answerCallbackQuery({ text: "Owners only", show_alert: true });
  return false;
}

function isNotModified(error: unknown): boolean {
  return error instanceof GrammyError && /not modified/i.test(error.description);
}
