import { existsSync } from "node:fs";
import { bin, install, Tunnel } from "cloudflared";
import { log } from "../logger.js";

export type TunnelHandle = {
  publicUrl: string;
  stop: () => void;
};

export async function startCloudflareTunnel(localUrl: string): Promise<TunnelHandle> {
  if (!existsSync(bin)) {
    log.info("Downloading cloudflared for this OS (first run only)…");
    await install(bin);
  }

  log.info(`Starting Cloudflare quick tunnel → ${localUrl}`);
  const tunnel = Tunnel.quick(localUrl);
  const recent: string[] = [];

  const onLog = (chunk: string) => {
    recent.push(chunk.trim());
    if (recent.length > 30) recent.shift();
  };
  tunnel.on("stdout", onLog);
  tunnel.on("stderr", onLog);

  const publicUrl = await waitForUrl(tunnel, recent);
  await waitForConnected(tunnel);

  log.info(`Mini App public URL: ${publicUrl}`);

  tunnel.on("exit", (code, signal) => {
    log.warn(`cloudflared exited (code ${code ?? "none"}, signal ${signal ?? "none"})`);
  });

  return {
    publicUrl,
    stop: () => {
      try {
        tunnel.stop();
      } catch {
        try {
          tunnel.process.kill();
        } catch {
          // already gone
        }
      }
    },
  };
}

function waitForUrl(tunnel: Tunnel, recent: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `Timed out waiting for a Cloudflare tunnel URL.\n${recent.slice(-8).join("\n")}`,
          ),
        ),
      );
    }, 60_000);

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    tunnel.once("url", (url: string) => {
      finish(() => resolve(url.replace(/\/$/, "")));
    });
    tunnel.once("error", (error: Error) => {
      finish(() => reject(error));
    });
    tunnel.once("exit", (code) => {
      finish(() =>
        reject(
          new Error(
            `cloudflared exited before a URL was ready (code ${code ?? "unknown"}).\n${recent.slice(-8).join("\n")}`,
          ),
        ),
      );
    });
  });
}

function waitForConnected(tunnel: Tunnel): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 8_000);
    tunnel.once("connected", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
