import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createBot, configureBotCommands } from "./bot/index.js";
import { configureMenuButton } from "./bot/webapp.js";
import { loadConfig, projectRoot } from "./config.js";
import { Store } from "./db.js";
import { log } from "./logger.js";
import { getBuiltin } from "./rules.js";
import { rewriteUrl } from "./rewrite.js";
import { startWebApp } from "./web/server.js";
import { startCloudflareTunnel, type TunnelHandle } from "./web/tunnel.js";

const config = loadConfig();
await mkdir(resolve(projectRoot, "logs"), { recursive: true });

const store = new Store(config.databasePath);
selfCheck(store);

const bot = createBot(config, store);
const httpServer = await startWebApp(config, store, bot);
let tunnel: TunnelHandle | null = null;
let stopping = false;

const localUrl = `http://127.0.0.1:${config.webAppPort}`;
if (config.cloudflareTunnelToken) {
  try {
    tunnel = await startCloudflareTunnel({
      localUrl,
      token: config.cloudflareTunnelToken,
      publicUrl: config.webAppUrl,
    });
  } catch (error) {
    log.warn(
      "Could not start the named Cloudflare tunnel. Check CLOUDFLARE_TUNNEL_TOKEN and that WEBAPP_URL is routed to this process.",
      error,
    );
  }
} else if (!config.webAppUrl && config.webAppTunnel) {
  try {
    tunnel = await startCloudflareTunnel({ localUrl });
    config.webAppUrl = tunnel.publicUrl;
  } catch (error) {
    log.warn(
      "Could not open a Cloudflare tunnel. The Mini App needs public HTTPS; in-chat menus will be used instead.",
      error,
    );
  }
} else if (config.webAppUrl) {
  log.info(`Using WEBAPP_URL ${config.webAppUrl}`);
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info(`Shutting down (${signal})`);
  try {
    await bot.stop();
  } catch (error) {
    log.warn("Error while stopping bot", error);
  }
  try {
    tunnel?.stop();
  } catch (error) {
    log.warn("Error while stopping tunnel", error);
  }
  try {
    await httpServer.close();
  } catch (error) {
    log.warn("Error while stopping Mini App server", error);
  }
  store.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("message", (message) => {
  if (message === "shutdown") void shutdown("PM2");
});
process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection", reason);
});

await configureBotCommands(bot);
await configureMenuButton(bot, config);
log.info("Starting Embedify");

await bot.start({
  drop_pending_updates: config.dropPendingUpdates,
  onStart: (info) => {
    log.info(`Online as @${info.username} (${info.id})`);
    if (typeof process.send === "function") {
      process.send("ready");
    }
  },
});

function selfCheck(store: Store): void {
  if (!store.getRule("x")) throw new Error("Built-in X rule is missing");
  const x = getBuiltin("x");
  if (!x) throw new Error("Built-in X definition is missing");
  const sample = "https://x.com/disclosetv/status/2100970764702773454";
  const hit = rewriteUrl(sample, [x]);
  if (hit?.rewritten !== "https://fixupx.com/disclosetv/status/2100970764702773454") {
    throw new Error(`Rewrite self-check failed: ${hit?.rewritten ?? "no match"}`);
  }
}
