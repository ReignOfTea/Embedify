import type { Composer } from "grammy";
import type { AppConfig } from "../config.js";
import type { Store } from "../db.js";
import {
  compilePattern,
  parseHostList,
  parseHostname,
  rewriteUrl,
} from "../rewrite.js";
import { canManageChat, isBotOwner } from "./auth.js";
import type { BotContext } from "./context.js";
import { prompt, render, showChatRule, showChatRules, showHome } from "./dashboard.js";
import { escapeHtml } from "./format.js";
import { chatRuleKeyboard, createModeKeyboard, homeKeyboard, ruleKeyboard, ruleSummary, yesNoKeyboard, cancelKeyboard } from "./ui.js";

export function registerWizard(
  bot: Composer<BotContext>,
  store: Store,
  config: AppConfig,
): void {
  bot.callbackQuery("d:new", async (ctx) => {
    if (!isBotOwner(ctx, config)) {
      await ctx.answerCallbackQuery({ text: "Owners only", show_alert: true });
      return;
    }
    ctx.session.wizard = { kind: "create", step: "name", draft: {}, chatId: null };
    await prompt(ctx, "Send a name for this global rule.\nExample: <code>X → FixupX</code>");
  });

  bot.callbackQuery("w:cancel", async (ctx) => {
    const wizard = ctx.session.wizard;
    if (!(await canContinueWizard(ctx, store, config))) {
      await ctx.answerCallbackQuery({ text: "Nothing to cancel" });
      return;
    }
    const chatId = wizard?.kind === "create" || wizard?.kind === "edit" ? wizard.chatId : null;
    ctx.session.wizard = null;
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    if (chatId != null) {
      await showChatRules(ctx, store, config, chatId, 0, false);
      return;
    }
    if (isBotOwner(ctx, config)) {
      await showHome(ctx, store);
      return;
    }
    await ctx.editMessageText("Cancelled.");
  });

  bot.callbackQuery(/^w:mode:(host|regex)$/, async (ctx) => {
    if (!(await canContinueWizard(ctx, store, config)) || ctx.session.wizard?.kind !== "create") {
      await ctx.answerCallbackQuery({ text: "Nothing to do" });
      return;
    }
    ctx.session.wizard.draft.mode = ctx.match[1] as "host" | "regex";
    if (ctx.session.wizard.draft.mode === "host") {
      ctx.session.wizard.step = "fromHosts";
      await prompt(
        ctx,
        "Send the host(s) to match, comma-separated.\nExample: <code>x.com, twitter.com</code>",
      );
    } else {
      ctx.session.wizard.step = "pattern";
      await prompt(
        ctx,
        [
          "Send a JavaScript regex (no surrounding slashes).",
          "Example: <code>https?://(?:www\\.)?(?:x\\.com|twitter\\.com)/([^\\s]+)</code>",
        ].join("\n"),
      );
    }
  });

  bot.callbackQuery(/^w:strip:(yes|no)$/, async (ctx) => {
    if (!(await canContinueWizard(ctx, store, config)) || ctx.session.wizard?.kind !== "create") {
      await ctx.answerCallbackQuery({ text: "Nothing to do" });
      return;
    }
    ctx.session.wizard.draft.stripQuery = ctx.match[1] === "yes";
    await finishCreate(ctx, store, config);
  });

  bot.callbackQuery(/^r:e:([^:]+):(name|fromHosts|toHost|pattern|replacement)$/, async (ctx) => {
    if (!isBotOwner(ctx, config)) {
      await ctx.answerCallbackQuery({ text: "Owners only", show_alert: true });
      return;
    }
    const ruleId = ctx.match[1]!;
    const field = ctx.match[2] as "name" | "fromHosts" | "toHost" | "pattern" | "replacement";
    const rule = store.getRule(ruleId);
    if (!rule || rule.chatId != null) {
      await ctx.answerCallbackQuery({ text: "Edit local rules from that chat's /rules panel", show_alert: true });
      return;
    }
    ctx.session.wizard = { kind: "edit", ruleId, field, chatId: null };
    await prompt(ctx, editPrompt(field));
  });

  bot.callbackQuery(
    /^ce:(-?\d+):([^:]+):(name|fromHosts|toHost|pattern|replacement)$/,
    async (ctx) => {
      const chatId = Number(ctx.match[1]);
      const ruleId = ctx.match[2]!;
      const field = ctx.match[3] as "name" | "fromHosts" | "toHost" | "pattern" | "replacement";
      if (!(await canManageChat(ctx, config, chatId))) {
        await ctx.answerCallbackQuery({ text: "Admins only", show_alert: true });
        return;
      }
      const rule = store.getRule(ruleId);
      if (!rule || rule.chatId !== chatId) {
        await ctx.answerCallbackQuery({ text: "Only local rules can be edited here", show_alert: true });
        return;
      }
      ctx.session.wizard = { kind: "edit", ruleId, field, chatId };
      const text = editPrompt(field);
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
    },
  );

  bot.command("cancel", async (ctx) => {
    const wizard = ctx.session.wizard;
    if (!wizard) {
      await ctx.reply("Nothing to cancel.");
      return;
    }
    const chatId = wizard.chatId;
    ctx.session.wizard = null;
    if (chatId != null) {
      await showChatRules(ctx, store, config, chatId, 0);
      return;
    }
    if (ctx.chat?.type === "private" && isBotOwner(ctx, config)) {
      await showHome(ctx, store);
      return;
    }
    await ctx.reply("Cancelled.");
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.session.wizard) {
      await next();
      return;
    }
    if (!(await canContinueWizard(ctx, store, config))) {
      await next();
      return;
    }
    if (ctx.message.text.startsWith("/")) {
      await next();
      return;
    }

    const wizard = ctx.session.wizard;
    if (wizard.kind === "create") {
      await handleCreateStep(ctx, store, config, ctx.message.text);
      return;
    }

    await handleEdit(ctx, store, config, wizard.ruleId, wizard.field, wizard.chatId, ctx.message.text);
  });
}

async function handleCreateStep(
  ctx: BotContext,
  store: Store,
  config: AppConfig,
  text: string,
): Promise<void> {
  if (ctx.session.wizard?.kind !== "create") return;
  const { step, draft } = ctx.session.wizard;

  if (step === "name") {
    draft.name = text.trim().slice(0, 64);
    if (!draft.name) {
      await ctx.reply("Please send a non-empty name.");
      return;
    }
    ctx.session.wizard.step = "mode";
    await render(ctx, "How should this rule match URLs?", createModeKeyboard());
    return;
  }

  if (step === "fromHosts") {
    const hosts = parseHostList(text);
    if (hosts.length === 0) {
      await ctx.reply("I could not parse any hosts. Try <code>x.com, twitter.com</code>.", {
        parse_mode: "HTML",
      });
      return;
    }
    draft.fromHosts = hosts;
    ctx.session.wizard.step = "toHost";
    await prompt(ctx, "Send the destination host.\nExample: <code>fixupx.com</code>");
    return;
  }

  if (step === "toHost") {
    const host = parseHostname(text);
    if (!host) {
      await ctx.reply("That does not look like a hostname.");
      return;
    }
    draft.toHost = host;
    ctx.session.wizard.step = "stripQuery";
    await render(
      ctx,
      "Strip tracking query parameters from matched URLs?",
      yesNoKeyboard("w:strip"),
    );
    return;
  }

  if (step === "pattern") {
    try {
      compilePattern(text);
    } catch {
      await ctx.reply("That regex did not compile. Send a valid JavaScript regex.");
      return;
    }
    draft.pattern = text;
    ctx.session.wizard.step = "replacement";
    await prompt(
      ctx,
      "Send the replacement string. Capture groups are <code>$1</code>, <code>$2</code>, …\nExample: <code>https://fixupx.com/$1</code>",
    );
    return;
  }

  if (step === "replacement") {
    draft.replacement = text.trim();
    if (!draft.replacement) {
      await ctx.reply("Replacement cannot be empty.");
      return;
    }
    await finishCreate(ctx, store, config);
  }
}

async function handleEdit(
  ctx: BotContext,
  store: Store,
  config: AppConfig,
  ruleId: string,
  field: "name" | "fromHosts" | "toHost" | "pattern" | "replacement",
  chatId: number | null,
  text: string,
): Promise<void> {
  const rule = store.getRule(ruleId);
  if (!rule) {
    ctx.session.wizard = null;
    await ctx.reply("That rule no longer exists.", { reply_markup: homeKeyboard() });
    return;
  }

  if (field === "name") {
    const name = text.trim().slice(0, 64);
    if (!name) {
      await ctx.reply("Please send a non-empty name.");
      return;
    }
    store.updateRule(ruleId, { name });
  } else if (field === "fromHosts") {
    const fromHosts = parseHostList(text);
    if (fromHosts.length === 0) {
      await ctx.reply("I could not parse any hosts.");
      return;
    }
    store.updateRule(ruleId, { fromHosts });
  } else if (field === "toHost") {
    const toHost = parseHostname(text);
    if (!toHost) {
      await ctx.reply("That does not look like a hostname.");
      return;
    }
    store.updateRule(ruleId, { toHost });
  } else if (field === "pattern") {
    try {
      compilePattern(text);
    } catch {
      await ctx.reply("That regex did not compile.");
      return;
    }
    store.updateRule(ruleId, { pattern: text });
  } else if (field === "replacement") {
    const replacement = text.trim();
    if (!replacement) {
      await ctx.reply("Replacement cannot be empty.");
      return;
    }
    store.updateRule(ruleId, { replacement });
  }

  ctx.session.wizard = null;
  if (chatId != null) {
    await showChatRule(ctx, store, chatId, ruleId);
    return;
  }
  const updated = store.getRule(ruleId)!;
  await ctx.reply("Updated.\n\n" + ruleSummary(updated), {
    parse_mode: "HTML",
    reply_markup: ruleKeyboard(updated),
    link_preview_options: { is_disabled: true },
  });
}

async function finishCreate(ctx: BotContext, store: Store, config: AppConfig): Promise<void> {
  const wizard = ctx.session.wizard;
  if (wizard?.kind !== "create") return;
  const draft = wizard.draft;
  if (!draft.name || !draft.mode) {
    await ctx.reply("The draft is incomplete. Use /cancel and start again.");
    ctx.session.wizard = null;
    return;
  }

  const rule = store.createRule({
    name: draft.name,
    mode: draft.mode,
    fromHosts: draft.fromHosts ?? [],
    toHost: draft.toHost ?? null,
    stripQuery: draft.stripQuery ?? true,
    pattern: draft.pattern ?? null,
    replacement: draft.replacement ?? null,
    enabled: true,
    chatId: wizard.chatId,
  });

  const chatId = wizard.chatId;
  ctx.session.wizard = null;
  const sample =
    rule.mode === "host" && rule.fromHosts[0]
      ? rewriteUrl(`https://${rule.fromHosts[0]}/example`, [rule])
      : null;
  const extra = sample
    ? `\n\nSample: <code>${escapeHtml(sample.original)}</code> → <code>${escapeHtml(sample.rewritten)}</code>`
    : "";
  const scope = chatId == null ? "global" : "local";

  if (chatId != null) {
    const view = store.listChatRuleViews(chatId).find((item) => item.rule.id === rule.id);
    await render(
      ctx,
      `Created ${scope} rule <b>${escapeHtml(rule.name)}</b>.${extra}\n\n${ruleSummary(rule, view)}`,
      view ? chatRuleKeyboard(view, chatId) : ruleKeyboard(rule),
    );
    return;
  }

  await render(
    ctx,
    `Created ${scope} rule <b>${escapeHtml(rule.name)}</b>.${extra}\n\n${ruleSummary(rule)}`,
    ruleKeyboard(rule),
  );
}

async function canContinueWizard(
  ctx: BotContext,
  store: Store,
  config: AppConfig,
): Promise<boolean> {
  const wizard = ctx.session.wizard;
  if (!wizard) return false;
  if (wizard.kind === "create") {
    return canManageChat(ctx, config, wizard.chatId);
  }
  const rule = store.getRule(wizard.ruleId);
  return canManageChat(ctx, config, rule?.chatId ?? wizard.chatId);
}

function editPrompt(field: "name" | "fromHosts" | "toHost" | "pattern" | "replacement"): string {
  switch (field) {
    case "name":
      return "Send the new name.";
    case "fromHosts":
      return "Send the host(s) to match, comma-separated.";
    case "toHost":
      return "Send the destination host.";
    case "pattern":
      return "Send the new JavaScript regex (no surrounding slashes).";
    case "replacement":
      return "Send the new replacement string.";
  }
}
