import { hostnameOf } from "./rewrite.js";
import { log } from "./logger.js";

const PROBE_TIMEOUT_MS = 3_000;
const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 60_000;

type CacheEntry = {
  ok: boolean;
  checkedAt: number;
};

const cache = new Map<string, CacheEntry>();

export async function firstHealthyCandidate<T extends { url: string; destHost: string }>(
  candidates: T[],
): Promise<{ pick: T; failedHosts: string[] }> {
  if (candidates.length === 0) {
    throw new Error("No rewrite candidates");
  }
  if (candidates.length === 1) {
    const only = candidates[0]!;
    const ok = await isHostHealthy(only.destHost || hostnameOf(only.url) || only.destHost);
    return { pick: only, failedHosts: ok ? [] : [only.destHost] };
  }

  const failedHosts: string[] = [];
  for (const candidate of candidates) {
    const host = candidate.destHost || hostnameOf(candidate.url);
    if (!host) continue;
    if (await isHostHealthy(host)) {
      return { pick: candidate, failedHosts };
    }
    failedHosts.push(host);
  }
  return { pick: candidates[0]!, failedHosts };
}

export async function isHostHealthy(host: string): Promise<boolean> {
  const cached = cache.get(host);
  if (cached && Date.now() - cached.checkedAt < (cached.ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS)) {
    return cached.ok;
  }

  const ok = await probeHost(host);
  cache.set(host, { ok, checkedAt: Date.now() });
  return ok;
}

async function probeHost(host: string): Promise<boolean> {
  const url = `https://${host}/`;
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        Accept: "text/html;q=0.8,*/*;q=0.5",
        "User-Agent": "Embedify/1.0 (+https://github.com/ReignOfTea/Embedify)",
      },
    });
    return response.status < 500;
  } catch (error) {
    log.warn(`Fixer host probe failed for ${host}`, error);
    return false;
  }
}
