// Pasted/dropped images land in the editor as base64 data URIs. On send,
// `extractInlineImages` lifts them back out into proper CID attachments — see
// lib/inlineImages.ts. Shared by the composer and the signature editor.

import type { EditorView } from "@tiptap/pm/view";
import { toast } from "@/stores/toasts";

export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

/** Insert pasted/dropped image files as base64 data URIs. Returns true when
 *  image files were handled so TipTap skips its default paste/drop behavior.
 *  The FileReader is async, so nodes land via the view rather than the
 *  synchronous handler return path. */
export function insertClipboardImages(
  view: EditorView,
  data: DataTransfer | null,
): boolean {
  const files = Array.from(data?.files ?? []).filter((f) =>
    f.type.startsWith("image/"),
  );
  if (files.length === 0) return false;
  for (const file of files) {
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      toast.error(`Image too large to embed (max 5 MB): ${file.name || "pasted image"}`);
      continue;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result;
      if (typeof src !== "string") return;
      const node = view.state.schema.nodes.image?.create({ src });
      if (node) view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    };
    reader.readAsDataURL(file);
  }
  return true;
}
