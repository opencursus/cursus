// Outgoing inline-image transform. The composer lets users paste/drop images
// which land in the editor HTML as <img src="data:...;base64,...">. Mail
// clients won't render multi-MB data URIs reliably (and some servers reject
// them), so before sending we lift each one out into a proper CID inline
// attachment and point the img at cid:<content-id> instead.

import type { OutgoingAttachment } from "@/lib/ipc";

const DATA_IMG_RE =
  /(<img\b[^>]*?\ssrc=")data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([^"]*)("[^>]*>)/gi;

function extensionFor(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/svg+xml") return "svg";
  return mime.split("/")[1] ?? "bin";
}

export function extractInlineImages(html: string): {
  html: string;
  inline: OutgoingAttachment[];
} {
  const inline: OutgoingAttachment[] = [];
  const out = html.replace(DATA_IMG_RE, (_m, pre: string, mime: string, b64: string, post: string) => {
    const n = inline.length + 1;
    const cid = `img${n}@cursus`;
    inline.push({
      filename: `image${n}.${extensionFor(mime.toLowerCase())}`,
      path: "",
      contentType: mime.toLowerCase(),
      dataBase64: b64,
      contentId: cid,
    });
    return `${pre}cid:${cid}${post}`;
  });
  return { html: out, inline };
}

/** Single choke point for every outgoing payload build (direct send, undo-send
 *  queue, offline outbox, send-later) so the html/attachments transform can't
 *  diverge between them. Call it on the final html (after compose-spacing). */
export function buildOutgoingBody(
  html: string,
  attachments: OutgoingAttachment[],
): { html: string; attachments: OutgoingAttachment[] } {
  const { html: outHtml, inline } = extractInlineImages(html);
  return {
    html: outHtml,
    attachments: inline.length > 0 ? [...attachments, ...inline] : attachments,
  };
}
