import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Image as ImageIcon,
  Eraser,
  Code2,
  Undo,
  Redo,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useAccountsStore } from "@/stores/accounts";
import { toast } from "@/stores/toasts";
import { updateAccountSignature } from "@/lib/db";
import { insertClipboardImages, MAX_INLINE_IMAGE_BYTES } from "@/lib/editorImages";

type Mode = "visual" | "html";

// Markup the visual editor has no node for. When a stored signature contains
// any of it — typically pasted from another client, which is exactly when it
// matters most — the section opens in HTML mode so loading it can't quietly
// flatten it.
const BEYOND_EDITOR_RE = /<(table|style|font|span|div|center)\b|style\s*=|class\s*=/i;

export function SignatureSection() {
  const accounts = useAccountsStore((s) => s.accounts);
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const setAccountSignature = useAccountsStore((s) => s.setAccountSignature);

  const [accountId, setAccountId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("visual");
  const [html, setHtml] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedId = accountId ?? activeAccountId ?? accounts[0]?.id ?? null;
  const account = useMemo(
    () => accounts.find((a) => a.id === selectedId) ?? null,
    [accounts, selectedId],
  );
  const stored = account?.signatureHtml ?? "";

  const editor = useEditor(
    {
      extensions: [StarterKit, Image.configure({ allowBase64: true })],
      content: "<p></p>",
      editorProps: {
        attributes: {
          class:
            "cursus-editor outline-none min-h-[200px] px-4 py-3 text-[13px] leading-relaxed",
        },
        handlePaste: (view, event) => insertClipboardImages(view, event.clipboardData),
        handleDrop: (view, event, _slice, moved) =>
          !moved && insertClipboardImages(view, event.dataTransfer),
      },
      onUpdate: ({ editor: e }) => {
        setHtml(e.getHTML());
        setDirty(true);
      },
    },
    [],
  );

  // Load once per account. Keyed on the id rather than the stored value so a
  // save — which flows back through the store — doesn't yank the editor's
  // content out from under the cursor or bounce the user out of HTML mode.
  const loadedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!editor || selectedId === null || loadedFor.current === selectedId) return;
    loadedFor.current = selectedId;
    const raw = BEYOND_EDITOR_RE.test(stored);
    setMode(raw ? "html" : "visual");
    setHtml(stored);
    setDirty(false);
    if (!raw) {
      editor.commands.setContent(stored || "<p></p>", { emitUpdate: false });
    }
  }, [editor, selectedId, stored]);

  const save = async () => {
    if (selectedId === null) return;
    setSaving(true);
    try {
      const next = html.trim();
      // An empty editor still serializes to <p></p>; store that as "no signature".
      const cleaned = next === "<p></p>" || next === "<p><br></p>" ? "" : next;
      await updateAccountSignature(selectedId, cleaned || null);
      setAccountSignature(selectedId, cleaned || null);
      setDirty(false);
      toast.success("Signature saved");
    } catch (err) {
      toast.error(`Could not save signature: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const revert = () => {
    const raw = BEYOND_EDITOR_RE.test(stored);
    setHtml(stored);
    setMode(raw ? "html" : "visual");
    if (editor && !raw) {
      editor.commands.setContent(stored || "<p></p>", { emitUpdate: false });
    }
    setDirty(false);
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === "html") {
      // Always safe: just show what the editor is holding.
      setHtml(editor?.getHTML() ?? html);
      setMode("html");
      return;
    }
    // Lossy direction — the visual editor keeps only what its schema models.
    if (
      BEYOND_EDITOR_RE.test(html) &&
      !window.confirm(
        "The visual editor can't represent everything in this HTML — tables, " +
          "inline styles and custom classes will be dropped.\n\nSwitch anyway?",
      )
    ) {
      return;
    }
    editor?.commands.setContent(html || "<p></p>", { emitUpdate: false });
    // Re-read rather than trusting `html`: what survived the schema is what
    // will actually be saved, and the user should see that immediately.
    setHtml(editor?.getHTML() ?? html);
    setMode("visual");
    setDirty(true);
  };

  const pickImage = () => fileRef.current?.click();

  const onImagePicked = (file: File | undefined) => {
    if (!file || !editor) return;
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      toast.error("Image too large to embed (max 5 MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        editor.chain().focus().setImage({ src: reader.result }).run();
      }
    };
    reader.readAsDataURL(file);
  };

  if (accounts.length === 0) {
    return (
      <>
        <SignatureHeader />
        <p className="text-[13px] text-muted">
          Add an account first — signatures are stored per account.
        </p>
      </>
    );
  }

  return (
    <>
      <SignatureHeader />

      {accounts.length > 1 && (
        <div className="flex items-center gap-3 pb-4 border-b border-soft">
          <span className="text-[13px] font-medium text-primary">Account</span>
          <select
            value={selectedId ?? ""}
            onChange={(e) => setAccountId(Number(e.target.value))}
            style={{ borderColor: "var(--border-strong)" }}
            className="h-8 rounded-md border bg-transparent px-2 text-[12.5px] text-primary outline-none focus:border-[color:var(--accent)]"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName === a.email ? a.email : `${a.displayName} · ${a.email}`}
              </option>
            ))}
          </select>
        </div>
      )}

      <div
        className="mt-5 rounded-lg border overflow-hidden"
        style={{ borderColor: "var(--border-strong)" }}
      >
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-soft">
          {mode === "visual" ? (
            <VisualTools editor={editor} onPickImage={pickImage} />
          ) : (
            <span className="px-2 text-[12px] text-muted">
              Raw HTML — saved exactly as written.
            </span>
          )}
          <div className="flex-1" />
          <ToolButton
            active={mode === "html"}
            onClick={() => switchMode(mode === "html" ? "visual" : "html")}
            title={mode === "html" ? "Back to the visual editor" : "Edit the HTML source"}
          >
            <Code2 size={13} />
          </ToolButton>
        </div>

        {mode === "visual" ? (
          <div className="bg-raised">
            <EditorContent editor={editor} />
          </div>
        ) : (
          <textarea
            value={html}
            onChange={(e) => {
              setHtml(e.target.value);
              setDirty(true);
            }}
            spellCheck={false}
            rows={14}
            placeholder={'<p>Your Name<br><a href="https://example.com">example.com</a></p>'}
            className="w-full bg-raised px-4 py-3 text-[12.5px] font-mono leading-relaxed text-primary placeholder:text-muted outline-none resize-y"
          />
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          onImagePicked(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <p className="mt-3 text-[12px] text-muted">
        Appended below your message when you compose, reply or forward. Images
        are embedded in the message itself, so they show up without the
        recipient having to load anything remote.
      </p>

      <div className="flex items-center gap-2 mt-5">
        <Button variant="primary" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save signature"}
        </Button>
        <Button variant="ghost" onClick={revert} disabled={!dirty || saving}>
          Discard changes
        </Button>
      </div>
    </>
  );
}

function SignatureHeader() {
  return (
    <div className="mb-6">
      <h2 className="text-[16px] font-semibold text-primary">Signature</h2>
      <p className="text-[12.5px] text-muted mt-0.5">
        Write it visually or drop straight into the HTML.
      </p>
    </div>
  );
}

function VisualTools({
  editor,
  onPickImage,
}: {
  editor: Editor | null;
  onPickImage: () => void;
}) {
  if (!editor) return null;

  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <>
      <ToolButton
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
      >
        <Bold size={13} />
      </ToolButton>
      <ToolButton
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
      >
        <Italic size={13} />
      </ToolButton>
      <ToolButton
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline"
      >
        <UnderlineIcon size={13} />
      </ToolButton>
      <Divider />
      <ToolButton active={editor.isActive("link")} onClick={setLink} title="Link">
        <LinkIcon size={13} />
      </ToolButton>
      <ToolButton onClick={onPickImage} title="Insert image">
        <ImageIcon size={13} />
      </ToolButton>
      <Divider />
      <ToolButton
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bulleted list"
      >
        <List size={14} />
      </ToolButton>
      <ToolButton
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
      >
        <ListOrdered size={14} />
      </ToolButton>
      <Divider />
      <ToolButton
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        title="Clear formatting"
      >
        <Eraser size={13} />
      </ToolButton>
      <ToolButton onClick={() => editor.chain().focus().undo().run()} title="Undo">
        <Undo size={13} />
      </ToolButton>
      <ToolButton onClick={() => editor.chain().focus().redo().run()} title="Redo">
        <Redo size={13} />
      </ToolButton>
    </>
  );
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-4 w-px mx-1 bg-[color:var(--border-strong)]" />;
}
