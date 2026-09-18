import { InlineKeyboard, type Composer } from "grammy";
import type { AppConfig } from "../config.js";
import type { Store } from "../db.js";
import { log } from "../logger.js";
import { canManageGroup, isBotOwner, isManagedChatType } from "./auth.js";
import type { BotContext } from "./context.js";
import { showChatRules } from "./dashboard.js";
import { escapeHtml } from "./format.js";
import { groupGateKeyboard, groupStatus } from "./ui.js";
import { startDeepLink } from "./webapp.js";

export function registerGroups(
  bot: Composer<BotContext>,
  store: Store,
  config: AppConfig,
): void {
  bot.on("my_chat_member", async (ctx) => {
    const chat = ctx.chat;
    if (!isManagedChatType(chat.type)) return;

    const next = ctx.myChatMember.new_chat_member;
    const prev = ctx.myChatMember.old_chat_member;
    const inNow = next.status === "member" || next.status === "administrator";
    const inBefore = prev.status === "member" || prev.status === "administrator";

    const group = store.upsertGroup({
      ...groupFields(chat),
      left: !inNow,
    });

    if (inNow && !inBefore) {
      log.info(`Added to ${group.title} (${group.chatId})`);
      try {
        await ctx.reply(
          [
            "<b>Embedify is here.</b>",
            "",
            "I reply to social links with versions that embed properly in Telegram.",
            "A chat admin needs to approve me before I start.",
            "",
            "Also disable privacy mode in @BotFather (<code>/setprivacy</code> → Disable) so I can see messages.",
          ].join("\n"),
          {
            parse_mode: "HTML",
            reply_markup: groupGateKeyboard(),
            link_preview_options: { is_disabled: true },
          },
        );
      } catch (error) {
        log.warn("Could not send join message", error);
      }
      await notifyOwners(ctx, config, group.title, group.chatId);
    } else if (!inNow && inBefore) {
      log.info(`Removed from ${group.title} (${group.chatId})`);
    }
  });

  bot.callbackQuery("g:ok", async (ctx) => {
    if (!(await canManageGroup(ctx, config))) {
      await ctx.answerCallbackQuery({ text: "Group admins only", show_alert: true });
      return;
    }
    if (!ctx.chat || !isManagedChatType(ctx.chat.type)) {
      await ctx.answerCallbackQuery();
      return;
    }
    store.upsertGroup(groupFields(ctx.chat));
    store.setGroupApproval(ctx.chat.id, true, ctx.from.id);
    await ctx.answerCallbackQuery({ text: "Approved" });
    await ctx.editMessageText(
      "Embedify is approved in this group. I will reply to matching links with better embeds.",
    );
  });

  bot.callbackQuery("g:no", async (ctx) => {
    if (!(await canManageGroup(ctx, config))) {
      await ctx.answerCallbackQuery({ text: "Group admins only", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Okay, staying idle" });
    await ctx.editMessageText(
      "Okay. I will stay idle here until a group admin uses /approve.",
    );
  });

  bot.command("approve", async (ctx) => {
    if (!ctx.chat || !isManagedChatType(ctx.chat.type)) {
      await ctx.reply("Use this command in a group or channel.");
      return;
    }
    if (!(await canManageGroup(ctx, config))) {
      await ctx.reply("Only chat admins or bot owners can approve me.");
      return;
    }
    store.upsertGroup(groupFields(ctx.chat));
    store.setGroupApproval(ctx.chat.id, true, ctx.from?.id ?? null);
    await ctx.reply("Approved. I will rewrite matching links in this chat.");
  });

  bot.command("disable", async (ctx) => {
    if (!ctx.chat || !isManagedChatType(ctx.chat.type)) {
      await ctx.reply("Use this command in a group or channel.");
      return;
    }
    if (!(await canManageGroup(ctx, config))) {
      await ctx.reply("Only chat admins or bot owners can disable me.");
      return;
    }
    store.upsertGroup(groupFields(ctx.chat));
    store.setGroupEnabled(ctx.chat.id, false);
    await ctx.reply("Paused in this chat. Use /approve to turn me back on.");
  });

  bot.command("status", async (ctx) => {
    if (!ctx.chat || !isManagedChatType(ctx.chat.type)) {
      await ctx.reply("Use this command in a group or channel.");
      return;
    }
    const group = store.getGroup(ctx.chat.id);
    if (!group) {
      await ctx.reply("I do not have a record for this chat yet.");
      return;
    }
    await ctx.reply(`Status: ${groupStatus(group)}`, {
      reply_markup: isBotOwner(ctx, config) || (await canManageGroup(ctx, config))
        ? groupGateKeyboard()
        : undefined,
    });
  });

  bot.command("rules", async (ctx) => {
    if (!ctx.chat || !isManagedChatType(ctx.chat.type)) {
      await ctx.reply("Use /rules in a group or channel, or open the dashboard in private chat.");
      return;
    }
    if (!(await canManageGroup(ctx, config))) {
      await ctx.reply("Only chat admins or bot owners can manage rules here.");
      return;
    }
    store.upsertGroup(groupFields(ctx.chat));
    if (config.webAppUrl) {
      await ctx.reply("Manage this chat’s rules in the Embedify Mini App.", {
        reply_markup: new InlineKeyboard().url(
          "Open dashboard",
          startDeepLink(ctx.me.username ?? "embedifybot", ctx.chat.id),
        ),
        link_preview_options: { is_disabled: true },
      });
      return;
    }
    await showChatRules(ctx, store, config, ctx.chat.id, 0);
  });
}

function groupFields(chat: { id: number; title?: string; type: string; username?: string }) {
  return {
    chatId: chat.id,
    title: chat.title ?? String(chat.id),
    username: chat.username ?? null,
    type: chat.type,
  };
}

async function notifyOwners(
  ctx: BotContext,
  config: AppConfig,
  title: string,
  chatId: number,
): Promise<void> {
  const text = [
    "<b>Added to a chat</b>",
    "",
    escapeHtml(title),
    `Chat ID: <code>${chatId}</code>`,
    "",
    "Open the Dashboard Mini App to approve it and configure rules.",
  ].join("\n");

  for (const adminId of config.adminIds) {
    try {
      await ctx.api.sendMessage(adminId, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      log.warn(`Could not notify owner ${adminId}`, error);
    }
  }
}
