import type { RuleMode } from "./rules.js";

export type RewriteRule = {
  id: string;
  mode: RuleMode;
  match: string[];
  replaces: string[];
  stripQuery: boolean;
  enabled: boolean;
};

export type RewriteCandidate = {
  url: string;
  destHost: string;
};

export type RewritePlan = {
  original: string;
  ruleId: string;
  candidates: RewriteCandidate[];
};

export type RewriteHit = {
  original: string;
  rewritten: string;
  ruleId: string;
  destHost: string;
};

const FALLBACK_URL_RE = /https?:\/\/[^\s<>[\]{}]+/gi;

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "");
}

export function parseHostList(input: string): string[] {
  const hosts = new Set<string>();
  for (const chunk of splitList(input)) {
    const host = parseHostname(chunk);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

export function parseStringList(input: string): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const chunk of splitList(input)) {
    if (seen.has(chunk)) continue;
    seen.add(chunk);
    values.push(chunk);
  }
  return values;
}

export function parseHostname(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    if (raw.includes("://") || raw.startsWith("//")) {
      const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
      return normalizeHost(url.hostname);
    }
  } catch {
    // fall through and treat as a hostname
  }
  const host = normalizeHost(raw.replace(/^\/\//, "").split("/")[0] ?? "");
  return host || null;
}

export function compilePattern(pattern: string): RegExp {
  return new RegExp(pattern, "i");
}

export function extractUrls(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(FALLBACK_URL_RE)) {
    const cleaned = trimTrailingPunctuation(match[0] ?? "");
    if (cleaned) found.push(cleaned);
  }
  return unique(found);
}

export function collectMessageUrls(options: {
  text?: string;
  urls?: string[];
  textLinks?: string[];
}): string[] {
  const urls = [
    ...(options.urls ?? []),
    ...(options.textLinks ?? []),
    ...extractUrls(options.text ?? ""),
  ].map(trimTrailingPunctuation);
  return unique(urls);
}

export function fixerHosts(rules: RewriteRule[]): Set<string> {
  const hosts = new Set<string>();
  for (const rule of rules) {
    if (rule.mode !== "host") continue;
    for (const host of rule.replaces) hosts.add(normalizeHost(host));
  }
  return hosts;
}

export function rewritePlan(url: string, rules: RewriteRule[]): RewritePlan | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const candidates = planRule(url, rule);
    if (candidates.length > 0) {
      return { original: url, ruleId: rule.id, candidates };
    }
  }
  return null;
}

export function rewriteUrl(url: string, rules: RewriteRule[]): RewriteHit | null {
  const plan = rewritePlan(url, rules);
  const first = plan?.candidates[0];
  if (!plan || !first) return null;
  return {
    original: url,
    rewritten: first.url,
    ruleId: plan.ruleId,
    destHost: first.destHost,
  };
}

export function rewriteUrls(urls: string[], rules: RewriteRule[]): RewriteHit[] {
  const hits: RewriteHit[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const hit = rewriteUrl(url, rules);
    if (!hit || seen.has(hit.rewritten)) continue;
    seen.add(hit.rewritten);
    hits.push(hit);
  }
  return hits;
}

function planRule(url: string, rule: RewriteRule): RewriteCandidate[] {
  if (rule.replaces.length === 0) return [];

  if (rule.mode === "regex") {
    const pattern = rule.match[0];
    if (!pattern) return [];
    let regex: RegExp;
    try {
      regex = compilePattern(pattern);
    } catch {
      return [];
    }
    if (!regex.test(url)) return [];
    const candidates: RewriteCandidate[] = [];
    for (const replacement of rule.replaces) {
      regex.lastIndex = 0;
      const rewritten = url.replace(regex, replacement);
      if (!rewritten || rewritten === url) continue;
      candidates.push({ url: rewritten, destHost: hostnameOf(rewritten) ?? replacement });
    }
    return uniqueCandidates(candidates);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }

  const host = normalizeHost(parsed.hostname);
  const matches = rule.match.some((candidate) => normalizeHost(candidate) === host);
  if (!matches) return [];

  const candidates: RewriteCandidate[] = [];
  for (const dest of rule.replaces) {
    const destHost = normalizeHost(dest);
    if (!destHost) continue;
    const next = new URL(parsed.toString());
    next.protocol = "https:";
    next.hostname = destHost;
    if (rule.stripQuery) {
      next.search = "";
      next.hash = "";
    }
    const rewritten = next.toString();
    if (rewritten === url) continue;
    candidates.push({ url: rewritten, destHost });
  }
  return uniqueCandidates(candidates);
}

export function hostnameOf(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

function splitList(input: string): string[] {
  return input
    .split(/[\n,]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function uniqueCandidates(candidates: RewriteCandidate[]): RewriteCandidate[] {
  const seen = new Set<string>();
  const result: RewriteCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    result.push(candidate);
  }
  return result;
}

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[),.;!?]+$/g, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
