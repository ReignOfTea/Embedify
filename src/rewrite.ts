import type { RuleMode } from "./rules.js";

export type RewriteRule = {
  id: string;
  mode: RuleMode;
  fromHosts: string[];
  toHost: string | null;
  stripQuery: boolean;
  pattern: string | null;
  replacement: string | null;
  enabled: boolean;
};

export type RewriteHit = {
  original: string;
  rewritten: string;
  ruleId: string;
};

const FALLBACK_URL_RE = /https?:\/\/[^\s<>[\]{}]+/gi;

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "");
}

export function parseHostList(input: string): string[] {
  const hosts = new Set<string>();
  for (const chunk of input.split(/[, \n]+/)) {
    const raw = chunk.trim();
    if (!raw) continue;
    try {
      if (raw.includes("://") || raw.startsWith("//")) {
        const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
        hosts.add(normalizeHost(url.hostname));
        continue;
      }
    } catch {
      // fall through and treat as a hostname
    }
    const host = normalizeHost(raw.replace(/^\/\//, "").split("/")[0] ?? "");
    if (host) hosts.add(host);
  }
  return [...hosts];
}

export function parseHostname(input: string): string | null {
  const [host] = parseHostList(input);
  return host ?? null;
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

export function rewriteUrl(url: string, rules: RewriteRule[]): RewriteHit | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const rewritten = applyRule(url, rule);
    if (rewritten && rewritten !== url) {
      return { original: url, rewritten, ruleId: rule.id };
    }
  }
  return null;
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

function applyRule(url: string, rule: RewriteRule): string | null {
  if (rule.mode === "regex") {
    if (!rule.pattern || !rule.replacement) return null;
    let regex: RegExp;
    try {
      regex = compilePattern(rule.pattern);
    } catch {
      return null;
    }
    if (!regex.test(url)) return null;
    regex.lastIndex = 0;
    return url.replace(regex, rule.replacement);
  }

  if (!rule.toHost || rule.fromHosts.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = normalizeHost(parsed.hostname);
  const matches = rule.fromHosts.some((candidate) => normalizeHost(candidate) === host);
  if (!matches) return null;

  parsed.protocol = "https:";
  parsed.hostname = rule.toHost;
  if (rule.stripQuery) {
    parsed.search = "";
    parsed.hash = "";
  }
  return parsed.toString();
}

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[),.;!?]+$/g, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
