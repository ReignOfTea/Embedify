import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { hostnameOf, normalizeHost } from "./rewrite.js";
import { log } from "./logger.js";

const MAX_REDIRECTS = 5;
const RESOLVE_TIMEOUT_MS = 4_000;
const DNS_TIMEOUT_MS = 2_500;
const MAX_URL_LENGTH = 2_048;

const SHORT_HOSTS = new Set([
  "t.co",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "m.tiktok.com",
  "bit.ly",
  "tinyurl.com",
  "cutt.ly",
  "ow.ly",
  "buff.ly",
  "trib.al",
  "lnkd.in",
  "instagr.am",
]);

const blockedV4 = new BlockList();
blockedV4.addSubnet("0.0.0.0", 8, "ipv4");
blockedV4.addSubnet("10.0.0.0", 8, "ipv4");
blockedV4.addSubnet("100.64.0.0", 10, "ipv4");
blockedV4.addSubnet("127.0.0.0", 8, "ipv4");
blockedV4.addSubnet("169.254.0.0", 16, "ipv4");
blockedV4.addSubnet("172.16.0.0", 12, "ipv4");
blockedV4.addSubnet("192.0.0.0", 24, "ipv4");
blockedV4.addSubnet("192.0.2.0", 24, "ipv4");
blockedV4.addSubnet("192.168.0.0", 16, "ipv4");
blockedV4.addSubnet("198.18.0.0", 15, "ipv4");
blockedV4.addSubnet("198.51.100.0", 24, "ipv4");
blockedV4.addSubnet("203.0.113.0", 24, "ipv4");
blockedV4.addSubnet("224.0.0.0", 4, "ipv4");
blockedV4.addSubnet("240.0.0.0", 4, "ipv4");

const blockedV6 = new BlockList();
blockedV6.addAddress("::", "ipv6");
blockedV6.addAddress("::1", "ipv6");
blockedV6.addSubnet("fc00::", 7, "ipv6");
blockedV6.addSubnet("fe80::", 10, "ipv6");
blockedV6.addSubnet("ff00::", 8, "ipv6");
blockedV6.addSubnet("2001:db8::", 32, "ipv6");

export type ResolveResult = {
  url: string;
  followed: boolean;
  error?: "timeout" | "ssrf" | "invalid" | "network";
};

export function shouldFollowRedirects(url: string, fixerHostSet: Set<string>): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = normalizeHost(parsed.hostname);
  if (fixerHostSet.has(host)) return false;
  if (SHORT_HOSTS.has(host)) return true;
  if (host.endsWith(".tiktok.com") && host !== "tiktok.com") return true;
  if (host === "instagram.com" && /^\/(share|stories)\b/i.test(parsed.pathname)) return true;
  return false;
}

export async function resolvePublicUrl(url: string): Promise<ResolveResult> {
  let current: string;
  try {
    current = canonicalize(url);
  } catch {
    return { url, followed: false, error: "invalid" };
  }

  const seen = new Set<string>([current]);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const safe = await assertPublicHttpUrl(current);
    if (safe !== true) {
      return { url: hop === 0 ? url : [...seen][seen.size - 2] ?? url, followed: hop > 0, error: safe };
    }

    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "User-Agent": "Embedify/1.0 (+https://github.com/ReignOfTea/Embedify)",
        },
      });
    } catch (error) {
      const timeout = error instanceof Error && error.name === "TimeoutError";
      log.warn(`Redirect resolve failed for ${hostHint(current)}`, error);
      return { url: current, followed: hop > 0, error: timeout ? "timeout" : "network" };
    }

    if (!isRedirect(response.status)) {
      return { url: current, followed: hop > 0 };
    }

    const location = response.headers.get("location");
    if (!location) return { url: current, followed: hop > 0 };

    let next: string;
    try {
      next = canonicalize(new URL(location, current).toString());
    } catch {
      return { url: current, followed: hop > 0, error: "invalid" };
    }
    if (seen.has(next)) return { url: current, followed: hop > 0 };
    seen.add(next);
    current = next;
  }

  return { url: current, followed: true };
}

async function assertPublicHttpUrl(raw: string): Promise<true | "ssrf" | "invalid"> {
  if (raw.length > MAX_URL_LENGTH) return "invalid";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "invalid";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "ssrf";
  if (parsed.username || parsed.password) return "ssrf";
  const port = parsed.port;
  if (port && port !== "80" && port !== "443") return "ssrf";

  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || isBlockedHostname(host)) return "ssrf";

  const ipVersion = isIP(host);
  if (ipVersion) {
    return isBlockedIp(host) ? "ssrf" : true;
  }
  if (/^\d+$/.test(host) || /^\d+\.\d+$/.test(host) || /^\d+\.\d+\.\d+$/.test(host)) {
    return "ssrf";
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("dns timeout")), DNS_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return "invalid";
  }
  if (addresses.length === 0) return "invalid";
  if (addresses.some((entry) => isBlockedIp(entry.address))) return "ssrf";
  return true;
}

function isBlockedHostname(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return true;
  if (host === "metadata.google.internal" || host.endsWith(".metadata.google.internal")) return true;
  return false;
}

function isBlockedIp(ip: string): boolean {
  const mapped = ipv4Mapped(ip);
  if (mapped) return blockedV4.check(mapped, "ipv4");
  const version = isIP(ip);
  if (version === 4) return blockedV4.check(ip, "ipv4");
  if (version === 6) return blockedV6.check(ip, "ipv6");
  return true;
}

function ipv4Mapped(ip: string): string | null {
  const lower = ip.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const rest = lower.slice("::ffff:".length);
    return isIP(rest) === 4 ? rest : null;
  }
  return null;
}

function canonicalize(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function hostHint(url: string): string {
  return hostnameOf(url) ?? url.slice(0, 48);
}
