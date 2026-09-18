import type { Context, SessionFlavor } from "grammy";
import type { RuleMode } from "../rules.js";

export type CreateDraft = {
  name?: string;
  mode?: RuleMode;
  fromHosts?: string[];
  toHost?: string | null;
  stripQuery?: boolean;
  pattern?: string | null;
  replacement?: string | null;
};

export type WizardState =
  | {
      kind: "create";
      step: "name" | "mode" | "fromHosts" | "toHost" | "stripQuery" | "pattern" | "replacement";
      draft: CreateDraft;
      chatId: number | null;
    }
  | {
      kind: "edit";
      ruleId: string;
      field: "name" | "fromHosts" | "toHost" | "pattern" | "replacement";
      chatId: number | null;
    };

export type SessionData = {
  wizard: WizardState | null;
};

export type BotContext = Context & SessionFlavor<SessionData>;
