import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ImageOff } from "lucide-react";
import { useUiStore } from "@/stores/ui";
import { flog } from "@/lib/logger";

interface Props {
  html: string;
  uid: number;
}

// Strips remote resources from sanitized HTML. Returns the modified HTML
// plus a count of blocked <img> tags so the reader can show a "load images"
// banner when policy is "ask".
function applyImagePolicy(html: string): { html: string; blocked: number } {
  const template = document.createElement("template");
  template.innerHTML = html;
  let blocked = 0;

  const stripRemote = (el: Element, attr: string): boolean => {
    const v = el.getAttribute(attr);
    if (v && /^https?:/i.test(v)) {
      el.removeAttribute(attr);
      return true;
    }
    return false;
  };

  for (const img of Array.from(template.content.querySelectorAll("img"))) {
    let any = false;
    if (stripRemote(img, "src")) any = true;
    if (stripRemote(img, "srcset")) any = true;
    if (any) {
      blocked++;
      // Keep an alt hint so the reader shows the broken-image placeholder
      // only when the email had one; otherwise collapse the tag.
      if (!img.getAttribute("alt")) img.remove();
    }
  }
  for (const el of Array.from(template.content.querySelectorAll("source"))) {
    stripRemote(el, "src");
    stripRemote(el, "srcset");
  }
  for (const el of Array.from(template.content.querySelectorAll("video,audio"))) {
    stripRemote(el, "src");
    stripRemote(el, "poster");
  }
  for (const el of Array.from(template.content.querySelectorAll("link"))) {
    el.remove();
  }
  for (const el of Array.from(template.content.querySelectorAll("[style]"))) {
    const s = el.getAttribute("style") ?? "";
    if (/url\(\s*['"]?https?:/i.test(s)) {
      const next = s.replace(
        /url\(\s*['"]?https?:[^)'"\s]+['"]?\s*\)/gi,
        "none",
      );
      el.setAttribute("style", next);
    }
  }

  return { html: template.innerHTML, blocked };
}

export function HtmlViewer({ html, uid }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const remoteImages = useUiStore((s) => s.remoteImages);
  const allowedImageUids = useUiStore((s) => s.allowedImageUids);
  const allowImagesForUid = useUiStore((s) => s.allowImagesForUid);

  const allowed =
    remoteImages === "always" || allowedImageUids.includes(uid);

  const { clean, blocked } = useMemo(() => {
    const sanitized = DOMPurify.sanitize(html, {
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
      FORBID_ATTR: ["onerror", "onload", "onclick"],
      ALLOW_DATA_ATTR: false,
    });
    if (allowed) return { clean: sanitized, blocked: 0 };
    const { html: stripped, blocked: n } = applyImagePolicy(sanitized);
    return { clean: stripped, blocked: n };
  }, [html, allowed]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const doc = iframe.contentDocument;
    if (!doc) return;

    const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg-primary");
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg-raised");
    const linkColor = getComputedStyle(document.documentElement).getPropertyValue("--accent");

    doc.open();
    doc.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base target="_blank" />
    <style>
      html, body { margin: 0; padding: 0; }
      body {
        font-family: Inter, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.6;
        color: ${fg.trim()};
        background: ${bg.trim()};
        padding: 24px 28px;
        word-wrap: break-word;
      }
      a { color: ${linkColor.trim()}; text-decoration: none; }
      a:hover { text-decoration: underline; }
      img { max-width: 100%; height: auto; }
      blockquote {
        border-left: 3px solid rgba(128, 128, 128, 0.25);
        margin: 0;
        padding: 0 0 0 16px;
        color: ${fg.trim()};
        opacity: 0.8;
      }
      pre { overflow-x: auto; background: rgba(128,128,128,0.08); padding: 10px; border-radius: 6px; }
    </style>
  </head>
  <body>${clean}</body>
</html>`);
    doc.close();

    // The iframe's sandbox blocks scripts, so the only navigation path is a
    // browser-level click on <a>. The webview's CSP refuses to load arbitrary
    // remote URLs and shows a "content blocked" page if we let that happen.
    // Intercept clicks from the parent (same-origin sandbox lets us reach
    // contentDocument) and hand the URL to the OS opener instead.
    const onClick = (event: Event) => {
      let node = event.target as Node | null;
      while (node && node.nodeType === 1 && (node as Element).tagName !== "A") {
        node = (node as Element).parentElement;
      }
      if (!node || node.nodeType !== 1) return;
      const anchor = node as HTMLAnchorElement;
      const href = anchor.getAttribute("href") ?? "";
      if (!href) return;
      const lower = href.toLowerCase();
      if (
        lower.startsWith("http://") ||
        lower.startsWith("https://") ||
        lower.startsWith("mailto:") ||
        lower.startsWith("tel:")
      ) {
        event.preventDefault();
        openUrl(href).catch((err) => {
          flog.error(`openUrl failed for ${href}:`, err);
        });
        return;
      }
      // Anything else (javascript:, data:, file:, in-page #anchor) gets blocked
      // outright — we don't trust it and the iframe sandbox would have
      // navigated the inner frame to the broken-CSP screen anyway.
      event.preventDefault();
    };
    doc.addEventListener("click", onClick, true);
    return () => {
      doc.removeEventListener("click", onClick, true);
    };
  }, [clean]);

  const showBanner = remoteImages === "ask" && blocked > 0 && !allowed;

  return (
    <div className="flex flex-col h-full">
      {showBanner && (
        <div
          style={{
            background: "var(--bg-sunken)",
            borderBottomColor: "var(--border-soft)",
          }}
          className="flex items-center gap-3 px-6 py-2 border-b shrink-0"
        >
          <ImageOff size={14} className="text-muted shrink-0" />
          <span className="text-[12.5px] text-secondary flex-1 min-w-0">
            {blocked} {blocked === 1 ? "image" : "images"} blocked to prevent
            tracking pixels.
          </span>
          <button
            type="button"
            onClick={() => allowImagesForUid(uid)}
            style={{ color: "var(--accent)" }}
            className="text-[12.5px] font-medium hover:underline"
          >
            Load images
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin"
        className="w-full flex-1 border-0 bg-raised"
        title="Email content"
      />
    </div>
  );
}
