import { describe, expect, it } from "vitest";
import type { MessageSummary } from "@/lib/ipc";
import {
  conditionMatches,
  ruleMatches,
  type RuleCondition,
  type RuleSpec,
} from "@/lib/rules";

function summary(overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    uid: 1,
    subject: "Weekly Report",
    from: "Alice Smith <alice@example.com>",
    to: ["bob@example.com"],
    date: 1_700_000_000,
    snippet: null,
    flags: [],
    hasAttachments: false,
    isBulk: false,
    isAuto: false,
    messageId: "msg-1",
    inReplyTo: "",
    references: [],
    ...overrides,
  };
}

function rule(overrides: Partial<RuleSpec> = {}): RuleSpec {
  return {
    id: 1,
    accountId: null,
    name: "test rule",
    enabled: true,
    sortOrder: 0,
    conditions: [],
    actions: [{ type: "mark_read" }],
    ...overrides,
  };
}

describe("conditionMatches", () => {
  it("matches `from contains` case-insensitively on both sides", () => {
    const cond: RuleCondition = { field: "from", op: "contains", value: "ALICE@Example.com" };
    expect(conditionMatches(summary(), cond)).toBe(true);
  });

  it("does not match `contains` when the needle is absent", () => {
    const cond: RuleCondition = { field: "from", op: "contains", value: "carol@" };
    expect(conditionMatches(summary(), cond)).toBe(false);
  });

  it("matches `to contains` against any recipient in the joined list", () => {
    const s = summary({ to: ["bob@example.com", "Team <team@example.com>"] });
    const cond: RuleCondition = { field: "to", op: "contains", value: "team@example.com" };
    expect(conditionMatches(s, cond)).toBe(true);
  });

  it("matches `subject equals` case-insensitively but not partially", () => {
    expect(
      conditionMatches(summary(), { field: "subject", op: "equals", value: "WEEKLY REPORT" }),
    ).toBe(true);
    expect(
      conditionMatches(summary(), { field: "subject", op: "equals", value: "Weekly" }),
    ).toBe(false);
  });

  it("treats a null header as empty string for text ops", () => {
    const s = summary({ subject: null });
    expect(conditionMatches(s, { field: "subject", op: "equals", value: "" })).toBe(true);
    expect(conditionMatches(s, { field: "subject", op: "contains", value: "x" })).toBe(false);
  });

  it("matches `regex` case-insensitively against the field value", () => {
    const cond: RuleCondition = { field: "from", op: "regex", value: "^ALICE\\b" };
    expect(conditionMatches(summary(), cond)).toBe(true);
  });

  it("returns false (not throw) on an invalid regex pattern", () => {
    const cond: RuleCondition = { field: "subject", op: "regex", value: "(" };
    expect(conditionMatches(summary(), cond)).toBe(false);
  });

  it("matches boolean fields with `is` by strict equality", () => {
    const s = summary({ hasAttachments: true, isBulk: false });
    expect(conditionMatches(s, { field: "hasAttachment", op: "is", value: true })).toBe(true);
    expect(conditionMatches(s, { field: "hasAttachment", op: "is", value: false })).toBe(false);
    expect(conditionMatches(s, { field: "isBulk", op: "is", value: false })).toBe(true);
    expect(conditionMatches(s, { field: "isBulk", op: "is", value: true })).toBe(false);
  });

  it("rejects text ops applied to boolean fields", () => {
    const s = summary({ hasAttachments: true });
    expect(
      conditionMatches(s, { field: "hasAttachment", op: "contains", value: "true" }),
    ).toBe(false);
    expect(
      conditionMatches(s, { field: "hasAttachment", op: "equals", value: "true" }),
    ).toBe(false);
  });

  it("rejects a boolean value paired with a text op on a string field", () => {
    expect(conditionMatches(summary(), { field: "from", op: "contains", value: true })).toBe(
      false,
    );
  });
});

describe("ruleMatches", () => {
  it("never fires a disabled rule even when conditions match", () => {
    const r = rule({
      enabled: false,
      conditions: [{ field: "from", op: "contains", value: "alice" }],
    });
    expect(ruleMatches(summary(), r)).toBe(false);
  });

  it("never fires on an empty condition list", () => {
    expect(ruleMatches(summary(), rule({ conditions: [] }))).toBe(false);
  });

  it("ANDs conditions together — all must match", () => {
    const both = rule({
      conditions: [
        { field: "from", op: "contains", value: "alice" },
        { field: "subject", op: "contains", value: "report" },
      ],
    });
    expect(ruleMatches(summary(), both)).toBe(true);

    const oneFails = rule({
      conditions: [
        { field: "from", op: "contains", value: "alice" },
        { field: "subject", op: "contains", value: "invoice" },
      ],
    });
    expect(ruleMatches(summary(), oneFails)).toBe(false);
  });

  it("fires a single-condition rule that matches", () => {
    const r = rule({ conditions: [{ field: "isBulk", op: "is", value: true }] });
    expect(ruleMatches(summary({ isBulk: true }), r)).toBe(true);
  });
});
