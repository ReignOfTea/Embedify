import { Bot, session } from "grammy";
import type { AppConfig } from "../config.js";
import type { Store } from "../db.js";
import { log } from "../logger.js";
import { isBotOwner } from "./auth.js";
import type { BotContext, SessionData } from "./context.js";
import { registerDashboard } from "./dashboard.js";
import { registerGroups } from "./groups.js";
import { registerMessages } from "./messages.js";
import { registerWizard } from "./wizard.js";

export function createBot(config: AppConfig, store: Store): Bot<BotContext> {
  const bot = new Bot<BotContext>(config.token);

  bot.use(
    session({
      initial: (): SessionData => ({ wizard: null }),
      getSessionKey: (ctx) => {
        if (ctx.from?.id != null) return `u:${ctx.from.id}`;
        if (ctx.chat?.id != null) return `c:${ctx.chat.id}`;
        return undefined;
      },
    }),
  );

  bot.use(async (ctx, next) => {
    if (ctx.chat?.type === "private" && ctx.from && !isBotOwner(ctx, config)) {
      const data = ctx.callbackQuery?.data ?? "";
      const ownerOnly =
        data.startsWith("d:") ||
        data.startsWith("r:") ||
        data.startsWith("g:v") ||
        data.startsWith("g:a") ||
        data.startsWith("g:r") ||
        data.startsWith("g:p") ||
        data.startsWith("g:u");
      if (ownerOnly) {
        await ctx.answerCallbackQuery({ text: "Owners only", show_alert: true });
        return;
      }
    }
    await next();
  });

  bot.command("help", async (ctx) => {
    if (ctx.chat?.type === "private") {
      await ctx.reply(
        [
          "<b>Embedify</b> rewrites social links so Telegram can show proper embeds.",
          "",
          isBotOwner(ctx, config)
            ? "Tap Dashboard (or /start) to open the Mini App."
            : "Add me to a group. A chat admin must approve me before I start.",
          "",
          "Chat commands: /approve, /disable, /status, /rules",
        ].join("\n"),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
      );
      return;
    }
    await ctx.reply(
      [
        "I rewrite matching social links into embed-friendly URLs.",
        "/approve — let me work in this chat",
        "/disable — pause me",
        "/status — show whether I am active here",
        "/rules — open the dashboard for this chat",
      ].join("\n"),
    );
  });

  registerWizard(bot, store, config);
  registerDashboard(bot, store, config);
  registerGroups(bot, store, config);
  registerMessages(bot, store);

  bot.catch((error) => {
    log.error(`Update ${error.ctx.update.update_id} failed`, error.error);
  });

  return bot;
}

export async function configureBotCommands(bot: Bot<BotContext>): Promise<void> {
  await bot.api.setMyCommands(
    [
      { command: "start", description: "Open the dashboard" },
      { command: "dashboard", description: "Open the dashboard" },
      { command: "help", description: "How the bot works" },
    ],
    { scope: { type: "all_private_chats" } },
  );
  await bot.api.setMyCommands(
    [
      { command: "approve", description: "Allow Embedify in this chat" },
      { command: "disable", description: "Pause Embedify in this chat" },
      { command: "status", description: "Show Embedify status" },
      { command: "rules", description: "Manage rules for this chat" },
      { command: "help", description: "How the bot works" },
    ],
    { scope: { type: "all_group_chats" } },
  );
  await bot.api.setMyCommands(
    [
      { command: "approve", description: "Allow Embedify in this chat" },
      { command: "disable", description: "Pause Embedify in this chat" },
      { command: "status", description: "Show Embedify status" },
      { command: "rules", description: "Manage rules for this chat" },
      { command: "help", description: "How the bot works" },
    ],
    { scope: { type: "all_chat_administrators" } },
  );
}
