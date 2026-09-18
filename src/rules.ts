export type RuleMode = "host" | "regex";

export type BuiltinRule = {
  id: string;
  name: string;
  description: string;
  mode: RuleMode;
  /** Hosts to match (host mode) or a single regex (regex mode). */
  match: string[];
  /** Prioritized destinations / replacement templates. First healthy one wins. */
  replaces: string[];
  stripQuery: boolean;
  enabled: boolean;
};

export const builtinRules: BuiltinRule[] = [
  {
    id: "x",
    name: "X / Twitter",
    description: "Better tweet embeds via FixupX, then FxTwitter / VxTwitter",
    mode: "host",
    match: ["x.com", "twitter.com", "mobile.twitter.com", "m.twitter.com"],
    replaces: ["fixupx.com", "fxtwitter.com", "vxtwitter.com"],
    stripQuery: true,
    enabled: true,
  },
  {
    id: "ig",
    name: "Instagram",
    description: "Reels, posts, and IGTV embeds",
    mode: "host",
    match: ["instagram.com"],
    replaces: ["ddinstagram.com", "kkinstagram.com", "instagramez.com"],
    stripQuery: true,
    enabled: true,
  },
  {
    id: "tt",
    name: "TikTok",
    description: "Videos and mobile short links",
    mode: "host",
    match: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com", "m.tiktok.com"],
    replaces: ["vxtiktok.com", "tnktok.com"],
    stripQuery: true,
    enabled: true,
  },
  {
    id: "rd",
    name: "Reddit",
    description: "Post and comment embeds",
    mode: "host",
    match: ["reddit.com", "old.reddit.com", "new.reddit.com", "m.reddit.com"],
    replaces: ["vxreddit.com", "rxddit.com"],
    stripQuery: true,
    enabled: false,
  },
  {
    id: "bsky",
    name: "Bluesky",
    description: "bsky.app post embeds",
    mode: "host",
    match: ["bsky.app"],
    replaces: ["fxbsky.app"],
    stripQuery: true,
    enabled: false,
  },
  {
    id: "threads",
    name: "Threads",
    description: "Threads post embeds",
    mode: "host",
    match: ["threads.net", "threads.com"],
    replaces: ["fixthreads.net"],
    stripQuery: true,
    enabled: false,
  },
  {
    id: "pixiv",
    name: "Pixiv",
    description: "Artwork embeds",
    mode: "host",
    match: ["pixiv.net"],
    replaces: ["phixiv.net"],
    stripQuery: true,
    enabled: false,
  },
];

export function getBuiltin(id: string): BuiltinRule | undefined {
  return builtinRules.find((rule) => rule.id === id);
}
