import type { Composer } from "grammy";
import type { Store } from "../db.js";
import { embedifyUrls } from "../pipeline.js";
import { collectMessageUrls } from "../rewrite.js";
import { isManagedChatType } from "./auth.js";
import type { BotContext } from "./context.js";

export function registerMessages(bot: Composer<BotContext>, store: Store): void {
  bot.on(["message:text", "message:caption", "channel_post:text", "channel_post:caption"], async (ctx) => {
    if (ctx.from?.is_bot) return;
    try {
      if (ctx.session.wizard) return;
    } catch {
      // channel posts may not have a user session
    }

    const chat = ctx.chat;
    const isManaged = isManagedChatType(chat.type);
    if (isManaged) {
      const group = store.getGroup(chat.id);
      if (!group || !group.approved || !group.enabled || group.left) return;
    } else if (chat.type !== "private") {
      return;
    }

    const msg = ctx.msg;
    if (!msg) return;
    const text = msg.text ?? msg.caption ?? "";
    const urls = collectMessageUrls({
      text,
      urls: ctx.entities("url").map((entity) => entity.text),
      textLinks: ctx.entities("text_link").map((entity) => entity.url).filter((url): url is string => !!url),
    });
    if (urls.length === 0) return;

    const chatId = isManaged ? chat.id : 0;
    const rules = store.effectiveRules(isManaged ? chat.id : null);
    const { hits, failures } = await embedifyUrls(urls, rules);
    if (failures.length > 0) {
      store.recordFailures(
        failures.map((failure) => ({
          chatId,
          ruleId: failure.ruleId,
          reason: failure.reason,
          detail: failure.detail,
        })),
      );
    }
    if (hits.length === 0) return;

    store.recordRewrites(
      hits.map((hit) => ({
        chatId,
        ruleId: hit.ruleId,
        destHost: hit.destHost,
      })),
    );

    const previewAll = isManaged ? (store.getGroup(chat.id)?.previewAll ?? true) : true;
    const toSend = previewAll ? hits : hits.slice(0, 1);
    const thread =
      msg.message_thread_id !== undefined ? { message_thread_id: msg.message_thread_id } : {};

    for (const hit of toSend) {
      await ctx.reply(hit.rewritten, {
        reply_parameters: { message_id: msg.message_id },
        ...thread,
        link_preview_options: {
          url: hit.rewritten,
          prefer_large_media: true,
          show_above_text: false,
        },
      });
    }
  });
}
