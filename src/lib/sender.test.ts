import { describe, expect, it } from "vitest";
import { buildFrom } from "@/lib/sender";

// Only buildFrom is pure here — executeOutgoingSend goes through DB, IPC and
// the accounts store, so it is exercised by integration, not unit tests.
describe("buildFrom", () => {
  it("returns the bare email when there is no display name", () => {
    expect(buildFrom(null, "alice@example.com")).toBe("alice@example.com");
  });

  it("returns the bare email when the name is blank or equals the email", () => {
    expect(buildFrom("   ", "alice@example.com")).toBe("alice@example.com");
    expect(buildFrom("alice@example.com", "alice@example.com")).toBe(
      "alice@example.com",
    );
  });

  it("emits `Name <email>` for a plain display name", () => {
    expect(buildFrom("Alice Smith", "alice@example.com")).toBe(
      "Alice Smith <alice@example.com>",
    );
  });

  it("trims surrounding whitespace from the display name", () => {
    expect(buildFrom("  Alice  Smith ", "alice@example.com")).toBe(
      "Alice  Smith <alice@example.com>",
    );
  });

  it("quotes names containing RFC 5322 special characters", () => {
    expect(buildFrom("Smith, Alice", "alice@example.com")).toBe(
      '"Smith, Alice" <alice@example.com>',
    );
    expect(buildFrom("alice@corp", "alice@example.com")).toBe(
      '"alice@corp" <alice@example.com>',
    );
  });

  it("escapes quotes and backslashes inside a quoted name", () => {
    expect(buildFrom('Alice "Al" Smith', "alice@example.com")).toBe(
      '"Alice \\"Al\\" Smith" <alice@example.com>',
    );
    expect(buildFrom("Alice \\ Smith", "alice@example.com")).toBe(
      '"Alice \\\\ Smith" <alice@example.com>',
    );
  });
});
