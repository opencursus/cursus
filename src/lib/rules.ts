// Rules engine. Each rule is { conditions[], actions[] }; conditions AND
// together. Apply pass walks new messages once per sync — ordering matters
// only because move_to actions short-circuit further actions on the same
// message (the message is no longer in the source folder).

import type { MessageSummary } from "@/lib/ipc";

export type RuleField = "from" | "to" | "subject" | "hasAttachment" | "isBulk";
export type RuleOp = "contains" | "equals" | "regex" | "is";

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  /** String for contains/equals/regex; boolean for `is`. */
  value: string | boolean;
}

export type RuleAction =
  | { type: "move_to"; folderPath: string }
  | { type: "mark_read" }
  | { type: "star" }
  | { type: "important" }
  | { type: "trash" };

export interface RuleSpec {
  id: number;
  accountId: number | null;
  name: string;
  enabled: boolean;
  sortOrder: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

function fieldValue(s: MessageSummary, field: RuleField): string | boolean {
  switch (field) {
    case "from":
      return (s.from ?? "").toLowerCase();
    case "to":
      return s.to.join(", ").toLowerCase();
    case "subject":
      return (s.subject ?? "").toLowerCase();
    case "hasAttachment":
      return s.hasAttachments;
    case "isBulk":
      return s.isBulk;
  }
}

export function conditionMatches(s: MessageSummary, cond: RuleCondition): boolean {
  const v = fieldValue(s, cond.field);
  switch (cond.op) {
    case "contains":
      if (typeof v !== "string" || typeof cond.value !== "string") return false;
      return v.includes(cond.value.toLowerCase());
    case "equals":
      if (typeof v !== "string" || typeof cond.value !== "string") return false;
      return v === cond.value.toLowerCase();
    case "regex":
      if (typeof v !== "string" || typeof cond.value !== "string") return false;
      try {
        return new RegExp(cond.value, "i").test(v);
      } catch {
        return false;
      }
    case "is":
      return v === cond.value;
  }
}

export function ruleMatches(s: MessageSummary, rule: RuleSpec): boolean {
  if (!rule.enabled) return false;
  if (rule.conditions.length === 0) return false; // never auto-fire on empty
  return rule.conditions.every((c) => conditionMatches(s, c));
}
