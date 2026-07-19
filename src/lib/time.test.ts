import { describe, expect, it } from "vitest";
import {
  addressName,
  formatDateStack,
  formatRelativeTime,
  initialsFrom,
} from "@/lib/time";

// All timestamps are built with the local-time Date constructor and expected
// strings are produced with the same Intl options the implementation uses, so
// the tests pin the branch logic without depending on machine locale/TZ.
const NOW = new Date(2026, 2, 11, 12, 0, 0).getTime(); // local Wed 2026-03-11 12:00

function timeOf(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

describe("formatDateStack", () => {
  it("returns empty primary for a zero timestamp", () => {
    expect(formatDateStack(0, NOW)).toEqual({ primary: "", secondary: null });
  });

  it("shows only the time for a same-day timestamp", () => {
    const t = new Date(2026, 2, 11, 8, 15, 0).getTime();
    expect(formatDateStack(t, NOW)).toEqual({ primary: timeOf(t), secondary: null });
  });

  it("shows weekday + time within the last 7 days", () => {
    const t = new Date(2026, 2, 10, 20, 30, 0).getTime(); // yesterday evening
    expect(formatDateStack(t, NOW)).toEqual({
      primary: new Date(t).toLocaleDateString(undefined, { weekday: "short" }),
      secondary: timeOf(t),
    });
  });

  it("switches from weekday to month/day at the 7-day boundary", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const justUnder = NOW - 7 * dayMs + 60_000;
    expect(formatDateStack(justUnder, NOW).primary).toBe(
      new Date(justUnder).toLocaleDateString(undefined, { weekday: "short" }),
    );
    const exactlySeven = NOW - 7 * dayMs;
    expect(formatDateStack(exactlySeven, NOW).primary).toBe(
      new Date(exactlySeven).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    );
  });

  it("shows month/day + time for an older same-year timestamp", () => {
    const t = new Date(2026, 0, 5, 9, 0, 0).getTime();
    expect(formatDateStack(t, NOW)).toEqual({
      primary: new Date(t).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      secondary: timeOf(t),
    });
  });

  it("includes the year for a prior-year timestamp", () => {
    const t = new Date(2025, 11, 25, 9, 0, 0).getTime();
    expect(formatDateStack(t, NOW)).toEqual({
      primary: new Date(t).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      secondary: timeOf(t),
    });
  });
});

describe("formatRelativeTime", () => {
  it("shows only the time for a same-day timestamp", () => {
    const t = new Date(2026, 2, 11, 9, 45, 0).getTime();
    expect(formatRelativeTime(t, NOW)).toBe(timeOf(t));
  });

  it("shows the short weekday within the last 7 days", () => {
    const t = new Date(2026, 2, 9, 18, 0, 0).getTime(); // two days ago
    expect(formatRelativeTime(t, NOW)).toBe(
      new Date(t).toLocaleDateString(undefined, { weekday: "short" }),
    );
  });

  it("shows month/day for an older same-year timestamp", () => {
    const t = new Date(2026, 1, 1, 10, 0, 0).getTime();
    expect(formatRelativeTime(t, NOW)).toBe(
      new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
  });

  it("includes the year for a prior-year timestamp", () => {
    const t = new Date(2024, 5, 15, 10, 0, 0).getTime();
    expect(formatRelativeTime(t, NOW)).toBe(
      new Date(t).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    );
  });
});

describe("initialsFrom", () => {
  it("falls back for null/undefined/empty names", () => {
    expect(initialsFrom(null)).toBe("?");
    expect(initialsFrom(undefined)).toBe("?");
    expect(initialsFrom("", "!")).toBe("!");
  });

  it("uses the first two letters of a single word", () => {
    expect(initialsFrom("alice")).toBe("AL");
  });

  it("uses first + last initials for multi-word names", () => {
    expect(initialsFrom("Alice Smith")).toBe("AS");
    expect(initialsFrom("Mary Jane Watson")).toBe("MW");
  });

  it("strips an angle-bracketed address before computing initials", () => {
    expect(initialsFrom("John Doe <john@example.com>")).toBe("JD");
  });

  it("falls back when the name is only an angle-bracketed address", () => {
    expect(initialsFrom("<john@example.com>")).toBe("?");
  });
});

describe("addressName", () => {
  it("returns empty string for null/undefined", () => {
    expect(addressName(null)).toBe("");
    expect(addressName(undefined)).toBe("");
  });

  it("extracts the display name from `Name <addr>` form", () => {
    expect(addressName("John Doe <john@example.com>")).toBe("John Doe");
  });

  it("strips surrounding quotes from the display name", () => {
    expect(addressName('"Doe, John" <john@example.com>')).toBe("Doe, John");
  });

  it("returns a bare address trimmed when there is no display name", () => {
    expect(addressName("  john@example.com  ")).toBe("john@example.com");
  });
});
