import { Bot, InlineKeyboard } from "grammy";
import type { AppConfig } from "../config.js";
import { log } from "../logger.js";
import type { BotContext } from "./context.js";

export function webAppUrl(config: AppConfig, chatId?: number | string | null): string {
  const base = config.webAppUrl!;
  if (chatId == null || chatId === "") return base;
  const url = new URL(base);
  url.searchParams.set("chat", String(chatId));
  return url.toString();
}

export function webAppKeyboard(config: AppConfig, chatId?: number | string | null): InlineKeyboard {
  return new InlineKeyboard().webApp("Open dashboard", webAppUrl(config, chatId));
}

export function startDeepLink(username: string, chatId: number): string {
  return `https://t.me/${username}?start=c${chatId}`;
}

export async function configureMenuButton(bot: Bot<BotContext>, config: AppConfig): Promise<void> {
  if (!config.webAppUrl) {
    await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
    return;
  }
  try {
    await bot.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "Dashboard",
        web_app: { url: config.webAppUrl },
      },
    });
    log.info("Telegram menu button set to Mini App");
  } catch (error) {
    log.warn("Could not set Mini App menu button. Is WEBAPP_URL public HTTPS?", error);
  }
}
