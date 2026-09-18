import type { Context, SessionFlavor } from "grammy";
import type { RuleMode } from "../rules.js";

export type CreateDraft = {
  name?: string;
  mode?: RuleMode;
  match?: string[];
  replaces?: string[];
  stripQuery?: boolean;
};

export type WizardState =
  | {
      kind: "create";
      step: "name" | "mode" | "match" | "replaces" | "stripQuery" | "pattern";
      draft: CreateDraft;
      chatId: number | null;
    }
  | {
      kind: "edit";
      ruleId: string;
      field: "name" | "match" | "replaces" | "pattern";
      chatId: number | null;
    };

export type SessionData = {
  wizard: WizardState | null;
};

export type BotContext = Context & SessionFlavor<SessionData>;
