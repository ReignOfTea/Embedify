import { hostnameOf } from "./rewrite.js";
import { log } from "./logger.js";

const PROBE_TIMEOUT_MS = 800;
const POSITIVE_TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_MS = 45_000;

type CacheEntry = {
  ok: boolean;
  checkedAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<boolean>>();

export function pickHealthyCandidate<T extends { url: string; destHost: string }>(
  candidates: T[],
): { pick: T; failedHosts: string[] } {
  if (candidates.length === 0) {
    throw new Error("No rewrite candidates");
  }

  const failedHosts: string[] = [];
  for (const candidate of candidates) {
    const host = candidate.destHost || hostnameOf(candidate.url);
    if (!host) continue;
    refreshInBackground(host);
    if (cachedHealth(host) === false) {
      failedHosts.push(host);
      continue;
    }
    return { pick: candidate, failedHosts };
  }

  return { pick: candidates[0]!, failedHosts };
}

function cachedHealth(host: string): boolean | null {
  const cached = cache.get(host);
  if (!cached) return null;
  const ttl = cached.ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
  if (Date.now() - cached.checkedAt >= ttl) return null;
  return cached.ok;
}

function refreshInBackground(host: string): void {
  const cached = cache.get(host);
  if (cached) {
    const ttl = cached.ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    if (Date.now() - cached.checkedAt < ttl * 0.8) return;
  }
  if (inflight.has(host)) return;
  const probe = probeHost(host)
    .then((ok) => {
      cache.set(host, { ok, checkedAt: Date.now() });
      return ok;
    })
    .finally(() => {
      inflight.delete(host);
    });
  inflight.set(host, probe);
  void probe;
}

async function probeHost(host: string): Promise<boolean> {
  const url = `https://${host}/`;
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        Accept: "*/*",
        "User-Agent": "Embedify/1.0 (+https://github.com/ReignOfTea/Embedify)",
      },
    });
    void response.body?.cancel();
    if (response.status === 405 || response.status === 501) {
      return probeGet(url);
    }
    return response.status < 500;
  } catch {
    return probeGet(url);
  }
}

async function probeGet(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        Accept: "*/*",
        "User-Agent": "Embedify/1.0 (+https://github.com/ReignOfTea/Embedify)",
      },
    });
    void response.body?.cancel();
    return response.status < 500;
  } catch (error) {
    log.warn(`Fixer host probe failed for ${new URL(url).hostname}`, error);
    return false;
  }
}
