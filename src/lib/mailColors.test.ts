import { describe, expect, it } from "vitest";
import {
  blendOver,
  contrastRatio,
  makeReadable,
  parseCssColor,
  relativeLuminance,
  toCssColor,
  type Rgb,
} from "./mailColors";

const DARK: Rgb = { r: 21, g: 23, b: 28, a: 1 }; // --bg-raised, black theme
const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 };

describe("parseCssColor", () => {
  it("parses long and short hex", () => {
    expect(parseCssColor("#ff8800")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parseCssColor("#f80")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
  });

  it("parses hex with alpha", () => {
    expect(parseCssColor("#00000080")?.a).toBeCloseTo(0.502, 2);
    expect(parseCssColor("#000f")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("parses rgb and rgba in legacy and modern syntax", () => {
    expect(parseCssColor("rgb(17, 34, 51)")).toEqual({ r: 17, g: 34, b: 51, a: 1 });
    expect(parseCssColor("rgba(17,34,51,0.5)")).toEqual({ r: 17, g: 34, b: 51, a: 0.5 });
    expect(parseCssColor("rgb(17 34 51 / 50%)")).toEqual({ r: 17, g: 34, b: 51, a: 0.5 });
  });

  it("parses hsl", () => {
    expect(parseCssColor("hsl(0, 100%, 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseCssColor("hsl(210 100% 50%)")).toEqual({ r: 0, g: 128, b: 255, a: 1 });
  });

  it("parses named colours case-insensitively", () => {
    expect(parseCssColor("White")).toEqual(WHITE);
    expect(parseCssColor("  dimgray ")).toEqual({ r: 105, g: 105, b: 105, a: 1 });
  });

  it("treats transparent as zero alpha", () => {
    expect(parseCssColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("returns null for values it cannot resolve", () => {
    expect(parseCssColor("currentColor")).toBeNull();
    expect(parseCssColor("var(--brand)")).toBeNull();
    expect(parseCssColor("#12345")).toBeNull();
    expect(parseCssColor("#gggggg")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0, a: 1 }, WHITE)).toBeCloseTo(21, 1);
    expect(contrastRatio(DARK, DARK)).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    const a = parseCssColor("#555555")!;
    expect(contrastRatio(a, WHITE)).toBeCloseTo(contrastRatio(WHITE, a), 6);
  });

  it("scores the reported failure as unreadable", () => {
    // Mid-grey body text, as authored for a white page, on our dark surface.
    expect(contrastRatio(parseCssColor("#555555")!, DARK)).toBeLessThan(4.5);
  });
});

describe("blendOver", () => {
  it("returns the foreground untouched when opaque", () => {
    expect(blendOver(WHITE, DARK)).toEqual({ ...WHITE, a: 1 });
  });

  it("composites a half-transparent black onto white", () => {
    const out = blendOver({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE);
    expect(out.r).toBeCloseTo(127.5, 1);
    expect(out.a).toBe(1);
  });
});

describe("makeReadable", () => {
  it("leaves a colour that already passes alone", () => {
    const ok = parseCssColor("#f0f2f5")!;
    expect(makeReadable(ok, DARK)).toEqual(ok);
  });

  it("lightens dark text so it clears AA on a dark surface", () => {
    const fixed = makeReadable(parseCssColor("#555555")!, DARK);
    expect(contrastRatio(fixed, DARK)).toBeGreaterThanOrEqual(4.5);
    expect(relativeLuminance(fixed)).toBeGreaterThan(
      relativeLuminance(parseCssColor("#555555")!),
    );
  });

  it("darkens light text so it clears AA on a light surface", () => {
    const fixed = makeReadable(parseCssColor("#f0f2f5")!, WHITE);
    expect(contrastRatio(fixed, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the hue, so a brand colour stays recognisable", () => {
    const brand = parseCssColor("#1a3d8f")!; // deep blue
    const fixed = makeReadable(brand, DARK);
    expect(contrastRatio(fixed, DARK)).toBeGreaterThanOrEqual(4.5);
    expect(fixed.b).toBeGreaterThan(fixed.r);
    expect(fixed.b).toBeGreaterThan(fixed.g);
  });

  it("resolves translucent text against the surface first", () => {
    const faint = { r: 0, g: 0, b: 0, a: 0.35 };
    const fixed = makeReadable(faint, DARK);
    expect(fixed.a).toBe(1);
    expect(contrastRatio(fixed, DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it("gives the best it can when the target is unreachable", () => {
    // Mid-grey backdrop: nothing hits 4.5 in either direction.
    const mid: Rgb = { r: 119, g: 119, b: 119, a: 1 };
    const fixed = makeReadable(parseCssColor("#777777")!, mid, 4.5);
    expect(contrastRatio(fixed, mid)).toBeGreaterThan(1.5);
  });
});

describe("toCssColor", () => {
  it("round-trips through the parser", () => {
    expect(toCssColor({ r: 255, g: 136, b: 0, a: 1 })).toBe("#ff8800");
    expect(parseCssColor(toCssColor(DARK))).toEqual(DARK);
  });
});
