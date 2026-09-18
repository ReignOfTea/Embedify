import { firstHealthyCandidate } from "./health.js";
import { resolvePublicUrl, shouldFollowRedirects } from "./resolve.js";
import {
  fixerHosts,
  rewritePlan,
  type RewriteHit,
  type RewriteRule,
} from "./rewrite.js";

export type RewriteFailure = {
  url: string;
  ruleId: string | null;
  reason: "timeout" | "ssrf" | "invalid" | "network" | "host_down";
  detail: string;
};

export type EmbedResult = {
  hits: RewriteHit[];
  failures: RewriteFailure[];
};

export async function embedifyUrls(urls: string[], rules: RewriteRule[]): Promise<EmbedResult> {
  const hits: RewriteHit[] = [];
  const failures: RewriteFailure[] = [];
  const seen = new Set<string>();
  const fixers = fixerHosts(rules);

  for (const original of urls) {
    const result = await embedifyOne(original, rules, fixers);
    for (const failure of result.failures) failures.push(failure);
    if (!result.hit || seen.has(result.hit.rewritten)) continue;
    seen.add(result.hit.rewritten);
    hits.push(result.hit);
  }

  return { hits, failures };
}

async function embedifyOne(
  original: string,
  rules: RewriteRule[],
  fixers: Set<string>,
): Promise<{ hit: RewriteHit | null; failures: RewriteFailure[] }> {
  const failures: RewriteFailure[] = [];
  let working = original;
  let plan = rewritePlan(working, rules);
  const follow = shouldFollowRedirects(original, fixers) || !plan;

  if (follow) {
    const resolved = await resolvePublicUrl(original);
    if (resolved.error) {
      failures.push({
        url: original,
        ruleId: plan?.ruleId ?? null,
        reason: resolved.error,
        detail: `Could not follow ${hostLabel(original)} (${resolved.error})`,
      });
    }
    if (resolved.url !== original) {
      working = resolved.url;
      plan = rewritePlan(working, rules) ?? plan;
    }
  }

  if (!plan || plan.candidates.length === 0) {
    return { hit: null, failures };
  }

  const { pick, failedHosts } = await firstHealthyCandidate(plan.candidates);
  if (failedHosts.length > 0) {
    const exhausted = failedHosts.length >= plan.candidates.length;
    failures.push({
      url: working,
      ruleId: plan.ruleId,
      reason: "host_down",
      detail: exhausted
        ? `All fixer hosts down (${failedHosts.join(", ")}); used ${pick.destHost}`
        : `Skipped ${failedHosts.join(", ")} → ${pick.destHost}`,
    });
  }

  return {
    hit: {
      original: working === original ? original : working,
      rewritten: pick.url,
      ruleId: plan.ruleId,
      destHost: pick.destHost,
    },
    failures,
  };
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 48);
  }
}
