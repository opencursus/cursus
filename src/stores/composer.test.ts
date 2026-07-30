import { describe, expect, it } from "vitest";
import { signatureBlock } from "./composer";

describe("signatureBlock", () => {
  it("is empty for nothing to render", () => {
    expect(signatureBlock(null)).toBe("");
    expect(signatureBlock(undefined)).toBe("");
    expect(signatureBlock("   \n ")).toBe("");
  });

  it("wraps plain text and turns newlines into breaks", () => {
    expect(signatureBlock("Bernardo\nCursus")).toBe("<p>Bernardo<br>Cursus</p>");
  });

  it("escapes plain text so it cannot inject markup", () => {
    expect(signatureBlock("a < b & c")).toBe("<p>a &lt; b &amp; c</p>");
  });

  it("wraps inline-only markup", () => {
    expect(signatureBlock('<b>Bernardo</b> — <a href="https://x.pt">x.pt</a>')).toBe(
      '<p><b>Bernardo</b> — <a href="https://x.pt">x.pt</a></p>',
    );
  });

  it("leaves block-level markup alone", () => {
    // The editor emits paragraphs; <p><p>…</p></p> is invalid and the browser
    // would split it, losing the signature's shape.
    const html = "<p>Bernardo</p><p>Cursus</p>";
    expect(signatureBlock(html)).toBe(html);

    const table = '<table><tr><td>Bernardo</td></tr></table>';
    expect(signatureBlock(table)).toBe(table);

    const list = "<ul><li>one</li></ul>";
    expect(signatureBlock(list)).toBe(list);
  });

  it("treats a bare image as inline and wraps it", () => {
    expect(signatureBlock('<img src="data:image/png;base64,AAA">')).toBe(
      '<p><img src="data:image/png;base64,AAA"></p>',
    );
  });
});
