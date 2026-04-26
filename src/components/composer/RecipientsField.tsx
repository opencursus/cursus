import { useEffect, useRef, useState } from "react";
import { searchContacts, type ContactRow } from "@/lib/db";

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoComplete?: string;
  spellCheck?: boolean;
}

// Split the input on the *last* comma/semicolon so we only query against
// whatever the user is typing right now, not the already-accepted recipients.
function splitOnLastSeparator(value: string): { head: string; token: string } {
  let lastIdx = -1;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "," || ch === ";") lastIdx = i;
  }
  if (lastIdx < 0) return { head: "", token: value };
  return {
    head: value.slice(0, lastIdx + 1),
    token: value.slice(lastIdx + 1),
  };
}

function formatContact(c: ContactRow): string {
  const name = c.display_name?.trim();
  if (!name) return c.email;
  // Same RFC 5322 display-name escaping as Composer.buildFrom.
  if (/[@<>,;:"]/.test(name)) {
    const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}" <${c.email}>`;
  }
  return `${name} <${c.email}>`;
}

export function RecipientsField({
  value,
  onChange,
  placeholder,
  autoComplete = "off",
  spellCheck = false,
}: Props) {
  const [hits, setHits] = useState<ContactRow[]>([]);
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { head, token } = splitOnLastSeparator(value);
  const query = token.trim();

  // Debounced query against the contacts table.
  useEffect(() => {
    if (!query) {
      setHits([]);
      setOpen(false);
      return;
    }
    const handle = setTimeout(() => {
      void searchContacts(query, 8).then((results) => {
        setHits(results);
        setIdx(0);
        // Only pop the dropdown open when the field is actually focused —
        // otherwise results from an old typing session would surface when
        // the user returns to another field.
        if (document.activeElement === inputRef.current) {
          setOpen(results.length > 0);
        }
      });
    }, 120);
    return () => clearTimeout(handle);
  }, [query]);

  function accept(c: ContactRow) {
    const headNorm = head.length === 0 ? "" : head.trimEnd() + " ";
    onChange(headNorm + formatContact(c) + ", ");
    setOpen(false);
    setHits([]);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      // Stop propagation so the outer composer's Ctrl+Enter listener
      // doesn't also fire a send while the user is just picking a contact.
      e.stopPropagation();
      const chosen = hits[idx];
      if (chosen) accept(chosen);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  function onBlur() {
    // Small delay so a click on a dropdown item has time to register
    // before focus is considered lost.
    blurTimer.current = setTimeout(() => setOpen(false), 120);
  }
  function onFocus() {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    if (hits.length > 0) setOpen(true);
  }

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onFocus={onFocus}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        className="w-full bg-transparent border-0 outline-none text-[13px] text-primary placeholder:text-disabled"
      />
      {open && hits.length > 0 && (
        <ul
          role="listbox"
          style={{
            background: "var(--bg-raised)",
            borderColor: "var(--border-strong)",
            boxShadow: "var(--shadow-md)",
          }}
          className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border max-h-[240px] overflow-y-auto py-1"
        >
          {hits.map((h, i) => {
            const highlighted = i === idx;
            const primary = h.display_name?.trim() || h.email;
            const secondary = h.display_name?.trim() ? h.email : null;
            return (
              <li
                key={h.id}
                role="option"
                aria-selected={highlighted}
                onMouseDown={(e) => {
                  // Prevent blur-before-click; accept directly.
                  e.preventDefault();
                  accept(h);
                }}
                onMouseEnter={() => setIdx(i)}
                style={
                  highlighted
                    ? { background: "var(--accent-soft)" }
                    : undefined
                }
                className="flex flex-col px-3 py-1.5 cursor-pointer"
              >
                <span className="text-[12.5px] text-primary truncate">
                  {primary}
                </span>
                {secondary && (
                  <span className="text-[11px] text-muted truncate">
                    {secondary}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
