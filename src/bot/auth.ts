import type { AppConfig } from "../config.js";
import type { BotContext } from "./context.js";

export function isBotOwner(ctx: BotContext, config: AppConfig): boolean {
  return !!ctx.from && config.adminIds.includes(ctx.from.id);
}

export function isManagedChatType(type: string): type is "group" | "supergroup" | "channel" {
  return type === "group" || type === "supergroup" || type === "channel";
}

export async function canManageChat(
  ctx: BotContext,
  config: AppConfig,
  chatId: number | null | undefined,
): Promise<boolean> {
  if (chatId == null) return isBotOwner(ctx, config);
  if (isBotOwner(ctx, config)) return true;
  if (!ctx.from) return false;
  try {
    const member = await ctx.api.getChatMember(chatId, ctx.from.id);
    return member.status === "creator" || member.status === "administrator";
  } catch {
    return false;
  }
}

export async function canManageGroup(ctx: BotContext, config: AppConfig): Promise<boolean> {
  if (!ctx.chat || !isManagedChatType(ctx.chat.type)) {
    return isBotOwner(ctx, config);
  }
  return canManageChat(ctx, config, ctx.chat.id);
}
