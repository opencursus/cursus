import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SNOOZE_PRESETS,
  SNOOZE_REMOVE_GLOBS,
  getSnoozeUntil,
  isSnoozeFlag,
  isSnoozedNow,
  snoozeKeyword,
} from "@/lib/snooze";

const CURRENT = "Cursus-SnoozedUntil:";
const LEGACY = "Flow-SnoozedUntil:";

function unixOf(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function preset(label: string) {
  const p = SNOOZE_PRESETS.find((p) => p.label === label);
  if (!p) throw new Error(`missing preset: ${label}`);
  return p;
}

describe("snoozeKeyword", () => {
  it("emits the current prefix with an integer unix timestamp", () => {
    expect(snoozeKeyword(1_700_000_000)).toBe(`${CURRENT}1700000000`);
  });

  it("floors fractional seconds", () => {
    expect(snoozeKeyword(1_700_000_000.9)).toBe(`${CURRENT}1700000000`);
  });
});

describe("isSnoozeFlag", () => {
  it("recognises current and legacy prefixes", () => {
    expect(isSnoozeFlag(`${CURRENT}123`)).toBe(true);
    expect(isSnoozeFlag(`${LEGACY}123`)).toBe(true);
  });

  it("rejects unrelated flags", () => {
    expect(isSnoozeFlag("\\Seen")).toBe(false);
    expect(isSnoozeFlag("SnoozedUntil:123")).toBe(false);
  });
});

describe("SNOOZE_REMOVE_GLOBS", () => {
  it("covers both prefix eras with wildcards", () => {
    expect(SNOOZE_REMOVE_GLOBS).toEqual([`${CURRENT}*`, `${LEGACY}*`]);
  });
});

describe("getSnoozeUntil", () => {
  it("returns null when no snooze keyword is present", () => {
    expect(getSnoozeUntil([])).toBeNull();
    expect(getSnoozeUntil(["\\Seen", "\\Flagged"])).toBeNull();
  });

  it("reads the current prefix", () => {
    expect(getSnoozeUntil(["\\Seen", `${CURRENT}1700000000`])).toBe(1_700_000_000);
  });

  it("reads the legacy prefix", () => {
    expect(getSnoozeUntil([`${LEGACY}1700000000`])).toBe(1_700_000_000);
  });

  it("picks the latest deadline when multiple keywords exist", () => {
    expect(
      getSnoozeUntil([`${LEGACY}1700000500`, `${CURRENT}1700000000`]),
    ).toBe(1_700_000_500);
  });

  it("ignores keywords with a non-numeric payload", () => {
    expect(getSnoozeUntil([`${CURRENT}soon`])).toBeNull();
    expect(getSnoozeUntil([`${CURRENT}abc`, `${CURRENT}42`])).toBe(42);
  });
});

describe("time-dependent helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("isSnoozedNow", () => {
    it("is true while the deadline is in the future, false after", () => {
      const now = new Date(2026, 2, 11, 12, 0, 0); // local Wed 2026-03-11 12:00
      vi.setSystemTime(now);
      const nowUnix = unixOf(now);
      expect(isSnoozedNow([snoozeKeyword(nowUnix + 60)])).toBe(true);
      expect(isSnoozedNow([snoozeKeyword(nowUnix - 60)])).toBe(false);
      expect(isSnoozedNow(["\\Seen"])).toBe(false);
    });
  });

  describe("SNOOZE_PRESETS", () => {
    it("Later today = now rounded to the minute plus 3 hours", () => {
      vi.setSystemTime(new Date(2026, 2, 11, 10, 30, 45, 500));
      expect(preset("Later today").computeUnix()).toBe(
        unixOf(new Date(2026, 2, 11, 13, 30, 0, 0)),
      );
    });

    it("Tomorrow morning = next day at 08:00", () => {
      vi.setSystemTime(new Date(2026, 2, 11, 22, 15, 0));
      expect(preset("Tomorrow morning").computeUnix()).toBe(
        unixOf(new Date(2026, 2, 12, 8, 0, 0, 0)),
      );
    });

    it("This weekend = upcoming Saturday at 08:00", () => {
      vi.setSystemTime(new Date(2026, 2, 11, 12, 0, 0)); // Wednesday
      expect(preset("This weekend").computeUnix()).toBe(
        unixOf(new Date(2026, 2, 14, 8, 0, 0, 0)), // Saturday
      );
    });

    it("This weekend on a Saturday jumps to next Saturday", () => {
      vi.setSystemTime(new Date(2026, 2, 14, 12, 0, 0)); // Saturday
      expect(preset("This weekend").computeUnix()).toBe(
        unixOf(new Date(2026, 2, 21, 8, 0, 0, 0)),
      );
    });

    it("Next week = next Monday at 08:00", () => {
      vi.setSystemTime(new Date(2026, 2, 11, 12, 0, 0)); // Wednesday
      expect(preset("Next week").computeUnix()).toBe(
        unixOf(new Date(2026, 2, 16, 8, 0, 0, 0)), // Monday
      );
    });

    it("Next week on a Monday jumps a full week ahead", () => {
      vi.setSystemTime(new Date(2026, 2, 16, 12, 0, 0)); // Monday
      expect(preset("Next week").computeUnix()).toBe(
        unixOf(new Date(2026, 2, 23, 8, 0, 0, 0)),
      );
    });

    it("Next week on a Sunday lands on the very next day", () => {
      vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0)); // Sunday
      expect(preset("Next week").computeUnix()).toBe(
        unixOf(new Date(2026, 2, 16, 8, 0, 0, 0)),
      );
    });
  });
});
