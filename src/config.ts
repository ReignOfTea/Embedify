import { config as loadEnv } from "dotenv";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

loadEnv({ path: resolve(projectRoot, ".env"), quiet: true });

const envSchema = z.object({
  TELEGRAM_TOKEN: z.string().min(20),
  TELEGRAM_ADMIN_IDS: z.string().min(1),
  DATABASE_PATH: z.string().optional(),
  DROP_PENDING_UPDATES: z.enum(["0", "1"]).optional(),
  NODE_ENV: z.string().optional(),
  WEBAPP_URL: z.string().optional(),
  WEBAPP_PORT: z.string().optional(),
  WEBAPP_HOST: z.string().optional(),
  WEBAPP_TUNNEL: z.enum(["0", "1"]).optional(),
});

export type AppConfig = {
  token: string;
  adminIds: number[];
  databasePath: string;
  dropPendingUpdates: boolean;
  isProduction: boolean;
  webAppUrl: string | null;
  webAppPort: number;
  webAppHost: string;
  webAppTunnel: boolean;
};

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }

  const adminIds = parsed.data.TELEGRAM_ADMIN_IDS.split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const id = Number(value);
      if (!Number.isSafeInteger(id)) {
        throw new Error(`Invalid TELEGRAM_ADMIN_IDS entry: ${value}`);
      }
      return id;
    });

  if (adminIds.length === 0) {
    throw new Error("TELEGRAM_ADMIN_IDS must contain at least one numeric user id");
  }

  const databasePath = parsed.data.DATABASE_PATH ?? "./data/embedify.db";

  const webAppUrl = parsed.data.WEBAPP_URL?.replace(/\/$/, "") || null;
  if (webAppUrl) {
    try {
      const url = new URL(webAppUrl);
      if (url.protocol !== "https:") {
        throw new Error("WEBAPP_URL must be https:// — Telegram Mini Apps cannot open plain HTTP");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("https://")) throw error;
      throw new Error(`Invalid WEBAPP_URL: ${webAppUrl}`);
    }
  }

  return {
    token: parsed.data.TELEGRAM_TOKEN,
    adminIds,
    databasePath: isAbsolute(databasePath)
      ? databasePath
      : resolve(projectRoot, databasePath),
    dropPendingUpdates: parsed.data.DROP_PENDING_UPDATES === "1",
    isProduction: parsed.data.NODE_ENV === "production",
    webAppUrl,
    webAppPort: Number(parsed.data.WEBAPP_PORT ?? 8787) || 8787,
    webAppHost: parsed.data.WEBAPP_HOST ?? "127.0.0.1",
    webAppTunnel: parsed.data.WEBAPP_TUNNEL !== "0",
  };
}
