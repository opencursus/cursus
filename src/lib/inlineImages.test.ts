import { describe, expect, it } from "vitest";
import { buildOutgoingBody, extractInlineImages } from "./inlineImages";

// 1x1 transparent PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("extractInlineImages", () => {
  it("returns html unchanged when there are no data images", () => {
    const html = '<p>hello</p><img src="https://example.com/x.png">';
    const result = extractInlineImages(html);
    expect(result.html).toBe(html);
    expect(result.inline).toEqual([]);
  });

  it("replaces data URIs with cid references and captures the payload", () => {
    const html = `<p>shot:</p><img src="data:image/png;base64,${PNG_B64}" alt="x">`;
    const { html: out, inline } = extractInlineImages(html);
    expect(out).toContain('src="cid:img1@cursus"');
    expect(out).toContain('alt="x"');
    expect(out).not.toContain("data:image/png");
    expect(inline).toHaveLength(1);
    expect(inline[0]).toMatchObject({
      filename: "image1.png",
      contentType: "image/png",
      dataBase64: PNG_B64,
      contentId: "img1@cursus",
    });
  });

  it("assigns each image its own content id", () => {
    const html =
      `<img src="data:image/png;base64,${PNG_B64}">` +
      `<img src="data:image/jpeg;base64,${PNG_B64}">`;
    const { html: out, inline } = extractInlineImages(html);
    expect(inline.map((a) => a.contentId)).toEqual(["img1@cursus", "img2@cursus"]);
    expect(inline[1]?.filename).toBe("image2.jpg");
    expect(out).toContain("cid:img1@cursus");
    expect(out).toContain("cid:img2@cursus");
  });
});

describe("buildOutgoingBody", () => {
  it("appends inline images after existing attachments", () => {
    const html = `<img src="data:image/png;base64,${PNG_B64}">`;
    const existing = [{ filename: "doc.pdf", path: "C:/doc.pdf" }];
    const { html: out, attachments } = buildOutgoingBody(html, existing);
    expect(out).toContain("cid:img1@cursus");
    expect(attachments).toHaveLength(2);
    expect(attachments[0]?.filename).toBe("doc.pdf");
    expect(attachments[1]?.contentId).toBe("img1@cursus");
  });

  it("returns the same attachments array when nothing was extracted", () => {
    const existing = [{ filename: "doc.pdf", path: "C:/doc.pdf" }];
    const result = buildOutgoingBody("<p>plain</p>", existing);
    expect(result.attachments).toBe(existing);
  });
});
