export type RuleMode = "host" | "regex";

export type BuiltinRule = {
  id: string;
  name: string;
  description: string;
  mode: RuleMode;
  fromHosts: string[];
  toHost: string | null;
  stripQuery: boolean;
  pattern: string | null;
  replacement: string | null;
  enabled: boolean;
};

export const builtinRules: BuiltinRule[] = [
  {
    id: "x",
    name: "X / Twitter → FixupX",
    description: "Better tweet embeds via fixupx.com",
    mode: "host",
    fromHosts: ["x.com", "twitter.com", "mobile.twitter.com", "m.twitter.com"],
    toHost: "fixupx.com",
    stripQuery: true,
    pattern: null,
    replacement: null,
    enabled: true,
  },
  {
    id: "ig",
    name: "Instagram → DDInstagram",
    description: "Reels, posts, and IGTV embeds",
    mode: "host",
    fromHosts: ["instagram.com"],
    toHost: "ddinstagram.com",
    stripQuery: true,
    pattern: null,
    replacement: null,
    enabled: true,
  },
  {
    id: "tt",
    name: "TikTok → VxTikTok",
    description: "Videos and mobile short links",
    mode: "host",
    fromHosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com", "m.tiktok.com"],
    toHost: "vxtiktok.com",
    stripQuery: true,
    pattern: null,
    replacement: null,
    enabled: true,
  },
  {
    id: "rd",
    name: "Reddit → VxReddit",
    description: "Post and comment embeds",
    mode: "host",
    fromHosts: ["reddit.com", "old.reddit.com", "new.reddit.com", "m.reddit.com"],
    toHost: "vxreddit.com",
    stripQuery: true,
    pattern: null,
    replacement: null,
    enabled: false,
  },
  {
    id: "bsky",
    name: "Bluesky → FxBsky",
    description: "bsky.app post embeds",
    mode: "host",
    fromHosts: ["bsky.app"],
    toHost: "fxbsky.app",
    stripQuery: true,
    pattern: null,
    replacement: null,
    enabled: false,
  },
  {
    id: "threads",
    name: "Threads → FixThreads",
    description: "Threads post embeds",
    mode: "host",
    fromHosts: ["threads.net", "threads.com"],
    toHost: "fixthreads.net",
    stripQuery: true,
    pattern: null,
    replacement: null,
    enabled: false,
  },
  {
    id: "pixiv",
    name: "Pixiv → Phixiv",
    description: "Artwork embeds",
    mode: "host",
    fromHosts: ["pixiv.net"],
    toHost: "phixiv.net",
    stripQuery: true,
    pattern: null,
    replacement: null,
    enabled: false,
  },
];

export function getBuiltin(id: string): BuiltinRule | undefined {
  return builtinRules.find((rule) => rule.id === id);
}
