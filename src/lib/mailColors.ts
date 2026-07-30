// HTML mail is authored for a white page. Cursus renders it on the app's own
// surface, which under the dark and black themes is nearly black — so a
// sender's `color:#555` arrives as dark-grey-on-dark and the message is barely
// legible. The reverse happens too: a newsletter that paints itself a white
// card but never states a text colour inherits our near-white body colour and
// comes out white-on-white.
//
// Both are the same defect — the text colour and the surface behind it came
// from different authors. This module walks the sanitized tree, tracks who
// authored each side, and only when they disagree nudges the text along its own
// hue until it clears the WCAG AA bar. When the email authored both sides its
// design is self-consistent and is left exactly as sent, muted greys and all.

export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** WCAG AA for body text. */
const TARGET_CONTRAST = 4.5;

// Enough of the CSS named colours to cover what actually shows up in mail.
// Anything unknown parses to null and is left untouched, which is the safe
// outcome — we never rewrite a colour we don't understand.
const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  silver: "#c0c0c0",
  gray: "#808080",
  grey: "#808080",
  white: "#ffffff",
  maroon: "#800000",
  red: "#ff0000",
  purple: "#800080",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
  green: "#008000",
  lime: "#00ff00",
  olive: "#808000",
  yellow: "#ffff00",
  navy: "#000080",
  blue: "#0000ff",
  teal: "#008080",
  aqua: "#00ffff",
  cyan: "#00ffff",
  orange: "#ffa500",
  pink: "#ffc0cb",
  brown: "#a52a2a",
  gold: "#ffd700",
  indigo: "#4b0082",
  violet: "#ee82ee",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
  dimgray: "#696969",
  dimgrey: "#696969",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  slategray: "#708090",
  slategrey: "#708090",
  darkslategray: "#2f4f4f",
  darkslategrey: "#2f4f4f",
  lightblue: "#add8e6",
  darkblue: "#00008b",
  royalblue: "#4169e1",
  steelblue: "#4682b4",
  cornflowerblue: "#6495ed",
  darkgreen: "#006400",
  seagreen: "#2e8b57",
  forestgreen: "#228b22",
  crimson: "#dc143c",
  firebrick: "#b22222",
  darkred: "#8b0000",
  whitesmoke: "#f5f5f5",
  gainsboro: "#dcdcdc",
  ghostwhite: "#f8f8ff",
  ivory: "#fffff0",
  beige: "#f5f5dc",
  linen: "#faf0e6",
};

const HEX_RE = /^[0-9a-f]+$/;

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Splits `rgb(1, 2, 3 / 50%)` style argument lists on commas, slashes and
 *  whitespace alike — modern and legacy syntax land on the same tokens. */
function args(body: string): string[] {
  return body
    .replace(/[,/]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function channel(token: string): number | null {
  if (token.endsWith("%")) {
    const pct = Number(token.slice(0, -1));
    return Number.isFinite(pct) ? clamp(Math.round((pct * 255) / 100), 0, 255) : null;
  }
  const n = Number(token);
  return Number.isFinite(n) ? clamp(Math.round(n), 0, 255) : null;
}

function alpha(token: string | undefined): number {
  if (token === undefined) return 1;
  if (token.endsWith("%")) {
    const pct = Number(token.slice(0, -1));
    return Number.isFinite(pct) ? clamp(pct / 100, 0, 1) : 1;
  }
  const n = Number(token);
  return Number.isFinite(n) ? clamp(n, 0, 1) : 1;
}

/** Parses hex, rgb()/rgba(), hsl()/hsla() and the named colours above.
 *  Returns null for anything else (currentColor, var(), gradients, garbage) so
 *  callers know to leave the value alone. */
export function parseCssColor(input: string): Rgb | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  const value = NAMED_COLORS[raw] ?? raw;

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (!HEX_RE.test(hex)) return null;
    const pair = (i: number) => parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const single = (i: number) => {
      const c = hex.charAt(i);
      return parseInt(c + c, 16);
    };
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: single(0),
        g: single(1),
        b: single(2),
        a: hex.length === 4 ? single(3) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: pair(0),
        g: pair(1),
        b: pair(2),
        a: hex.length === 8 ? pair(3) / 255 : 1,
      };
    }
    return null;
  }

  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(value);
  if (!fn) return null;
  const name = fn[1] ?? "";
  const parts = args(fn[2] ?? "");
  if (parts.length < 3) return null;

  if (name === "rgb" || name === "rgba") {
    const r = channel(parts[0] ?? "");
    const g = channel(parts[1] ?? "");
    const b = channel(parts[2] ?? "");
    if (r === null || g === null || b === null) return null;
    return { r, g, b, a: alpha(parts[3]) };
  }

  const h = Number((parts[0] ?? "").replace(/deg$/, ""));
  const s = Number((parts[1] ?? "").replace(/%$/, ""));
  const l = Number((parts[2] ?? "").replace(/%$/, ""));
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
  const rgb = hslToRgb(((h % 360) + 360) % 360, clamp(s / 100, 0, 1), clamp(l / 100, 0, 1));
  return { ...rgb, a: alpha(parts[3]) };
}

export function toCssColor(c: Rgb): string {
  const hex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

/** Composites a translucent colour onto an opaque one. */
export function blendOver(fg: Rgb, bg: Rgb): Rgb {
  if (fg.a >= 1) return { ...fg, a: 1 };
  const mix = (f: number, b: number) => f * fg.a + b * (1 - fg.a);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

export function relativeLuminance(c: Rgb): number {
  const lin = (v: number) => {
    const s = clamp(v, 0, 255) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl(c: Rgb): { h: number; s: number; l: number } {
  const r = clamp(c.r, 0, 255) / 255;
  const g = clamp(c.g, 0, 255) / 255;
  const b = clamp(c.b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

/** Walks `fg`'s lightness away from `bg` — keeping its hue and saturation, so a
 *  brand blue stays blue — until it clears `target`. Returns the input when it
 *  already passes, and the best achievable colour when even pure white or black
 *  falls short. */
export function makeReadable(fg: Rgb, bg: Rgb, target = TARGET_CONTRAST): Rgb {
  const solid = blendOver(fg, bg);
  if (contrastRatio(solid, bg) >= target) return solid;

  const lighten = relativeLuminance(bg) < 0.5;
  const { h, s, l } = rgbToHsl(solid);
  let best = solid;
  let bestRatio = contrastRatio(solid, bg);

  for (let step = 1; step <= 100; step++) {
    const nl = clamp(lighten ? l + step / 100 : l - step / 100, 0, 1);
    const candidate: Rgb = { ...hslToRgb(h, s, nl), a: 1 };
    const ratio = contrastRatio(candidate, bg);
    if (ratio >= target) return candidate;
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
    if (nl === 0 || nl === 1) break;
  }
  return best;
}

// ─── DOM pass ────────────────────────────────────────────────────────────────

/** Background an element paints itself, from the inline style (the `background`
 *  shorthand included — the browser has already split it for us) or the legacy
 *  `bgcolor` attribute. */
function ownBackground(el: Element): Rgb | null {
  const style = (el as HTMLElement).style;
  const declared = style?.backgroundColor ?? "";
  if (declared) {
    const parsed = parseCssColor(declared);
    if (parsed && parsed.a > 0) return parsed;
  }
  const attr = el.getAttribute("bgcolor");
  if (attr) {
    const parsed = parseCssColor(attr);
    if (parsed && parsed.a > 0) return parsed;
  }
  return null;
}

/** Text colour an element declares, inline or via legacy `<font color>`. */
function ownColor(el: Element): Rgb | null {
  const style = (el as HTMLElement).style;
  const declared = style?.color ?? "";
  if (declared) {
    const parsed = parseCssColor(declared);
    if (parsed) return parsed;
  }
  if (el.tagName === "FONT") {
    const attr = el.getAttribute("color");
    if (attr) return parseCssColor(attr);
  }
  return null;
}

/** The app-side colours the iframe document is painted with. */
export interface SurfaceColors {
  background: string;
  text: string;
  link: string;
}

interface Cascade {
  bg: Rgb;
  bgFromMail: boolean;
  /** The colour the author asked for, before any correction of ours. */
  intended: Rgb;
  intendedFromMail: boolean;
  /** What the browser will actually inherit here, after our rewrites. */
  rendered: Rgb;
}

/**
 * Rewrites unreadable text colours in already-sanitized mail HTML.
 *
 * Corrections are applied to `intended` — never to an already-corrected value —
 * so a mail that states `color:#555` at the top and paints a white card further
 * down gets its #555 restored inside that card, where it was right all along.
 */
export function harmonizeMailColors(html: string, surface: SurfaceColors): string {
  const backdrop = parseCssColor(surface.background);
  const bodyColor = parseCssColor(surface.text);
  const linkColor = parseCssColor(surface.link);
  if (!backdrop || !bodyColor) return html;

  try {
    const template = document.createElement("template");
    template.innerHTML = html;

    const base: Rgb = { ...backdrop, a: 1 };
    const ourText = blendOver(bodyColor, base);
    const ourLink = linkColor ? blendOver(linkColor, base) : null;

    const visit = (el: Element, inh: Cascade) => {
      const bgOwn = ownBackground(el);
      const bg = bgOwn ? blendOver(bgOwn, inh.bg) : inh.bg;
      const bgFromMail = bgOwn !== null || inh.bgFromMail;

      // Our stylesheet colours every <a>, so an anchor without an inline colour
      // resolves to the accent rather than to whatever it inherits.
      const colorOwn = ownColor(el);
      const ours = el.tagName === "A" && ourLink ? ourLink : null;
      const intended = colorOwn
        ? blendOver(colorOwn, bg)
        : (ours ?? inh.intended);
      const intendedFromMail = colorOwn ? true : ours ? false : inh.intendedFromMail;
      const inherited = colorOwn ? blendOver(colorOwn, bg) : (ours ?? inh.rendered);

      // Step in only when the two sides have different authors. Where the mail
      // set both, its own contrast decisions stand; where we set both, they
      // already pass by construction.
      const desired =
        bgFromMail !== intendedFromMail &&
        contrastRatio(intended, bg) < TARGET_CONTRAST
          ? makeReadable(intended, bg)
          : intended;

      let rendered = inherited;
      const css = toCssColor(desired);
      if (css !== toCssColor(inherited)) {
        const style = (el as HTMLElement).style;
        if (style) {
          style.color = css;
          rendered = desired;
        }
      }

      const next: Cascade = { bg, bgFromMail, intended, intendedFromMail, rendered };
      for (const child of Array.from(el.children)) visit(child, next);
    };

    const root: Cascade = {
      bg: base,
      bgFromMail: false,
      intended: ourText,
      intendedFromMail: false,
      rendered: ourText,
    };
    for (const child of Array.from(template.content.children)) visit(child, root);

    return template.innerHTML;
  } catch {
    // A malformed document is not worth losing the message over.
    return html;
  }
}
