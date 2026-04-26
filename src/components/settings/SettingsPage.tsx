import { useEffect, useState } from "react";
import {
  X,
  Plus,
  Trash2,
  Pencil,
  User,
  Sliders,
  Palette,
  Keyboard,
  Info,
  Mail as MailIcon,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { cn } from "@/lib/cn";
import { useUiStore, type RemoteImagesPolicy } from "@/stores/ui";
import { useAccountsStore } from "@/stores/accounts";
import { useBodiesStore } from "@/stores/bodies";
import { toast } from "@/stores/toasts";
import {
  deleteAccount,
  deleteRule,
  listAccounts,
  listMessagesForFolder,
  listRules,
  upsertRule,
  type StoredAccount,
  type StoredRule,
} from "@/lib/db";
import type { RuleAction, RuleCondition, RuleField, RuleOp } from "@/lib/rules";
import { AccountForm } from "@/components/settings/AccountForm";
import type { Theme, ReadingPane } from "@/types";

type SectionId = "accounts" | "appearance" | "general" | "rules" | "keyboard" | "about";
type AccountsMode = "list" | "form";

const SECTIONS: Array<{ id: SectionId; label: string; icon: React.ElementType }> = [
  { id: "accounts", label: "Accounts", icon: MailIcon },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "general", label: "General", icon: Sliders },
  { id: "rules", label: "Rules", icon: Filter },
  { id: "keyboard", label: "Keyboard", icon: Keyboard },
  { id: "about", label: "About", icon: Info },
];

export function SettingsPage() {
  const closeSettings = useUiStore((s) => s.closeSettings);
  const [section, setSection] = useState<SectionId>("accounts");

  return (
    <section className="col-span-full flex flex-col bg-base overflow-hidden">
      <header className="flex items-center justify-between px-8 py-4 border-b border-soft shrink-0">
        <h1 className="text-[18px] font-semibold text-primary">Settings</h1>
        <CloseSettingsButton onClick={closeSettings} />
      </header>

      <div className="flex-1 grid grid-cols-[220px_1fr] overflow-hidden">
        <nav className="border-r border-soft py-4 px-3 space-y-1">
          {SECTIONS.map((s) => (
            <NavTab
              key={s.id}
              icon={<s.icon size={14} />}
              active={section === s.id}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </NavTab>
          ))}
        </nav>

        <div className="overflow-y-auto">
          <div className="px-10 py-8 max-w-3xl">
            {section === "accounts" && <AccountsSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "general" && <GeneralSection />}
            {section === "rules" && <RulesSection />}
            {section === "keyboard" && <KeyboardSection />}
            {section === "about" && <AboutSection />}
          </div>
        </div>
      </div>
    </section>
  );
}

function CloseSettingsButton({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label="Close settings"
      style={{
        color: hover ? "var(--color-danger)" : "var(--fg-muted)",
        transition: "color 120ms",
      }}
      className="flex h-8 w-8 items-center justify-center"
    >
      <X size={16} />
    </button>
  );
}

function NavTab({
  children,
  icon,
  active,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2 w-full rounded-md px-3 text-[13px] text-left transition-colors",
        active
          ? "bg-accent-soft text-primary font-medium"
          : "text-secondary hover:bg-hover hover:text-primary",
      )}
    >
      <span className={cn(active ? "text-accent" : "text-muted")}>{icon}</span>
      <span>{children}</span>
    </button>
  );
}

function AccountsSection() {
  const [mode, setMode] = useState<AccountsMode>("list");
  const [editingAccount, setEditingAccount] = useState<StoredAccount | null>(null);
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const rows = await listAccounts();
      setAccounts(rows);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(id: number) {
    if (!confirm("Delete this account from Cursus? Remote mailbox is untouched.")) return;
    try {
      await deleteAccount(id);
      await refresh();
      await useAccountsStore.getState().loadAccounts();
    } catch (err) {
      setError(String(err));
    }
  }

  if (mode === "form") {
    return (
      <>
        <SectionHeader
          title={editingAccount ? "Edit account" : "Add account"}
          description={
            editingAccount
              ? "Passwords are pre-filled from the database. Change only what you need."
              : "Fill in IMAP for receiving, and SMTP or Resend for sending."
          }
        />
        <AccountForm
          editing={editingAccount}
          onCancel={() => {
            setEditingAccount(null);
            setMode("list");
          }}
          onSaved={async () => {
            await refresh();
            await useAccountsStore.getState().loadAccounts();
            setEditingAccount(null);
            setMode("list");
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[16px] font-semibold text-primary">Accounts</h2>
          <p className="text-[12.5px] text-muted mt-0.5">
            Add the IMAP + SMTP or Resend credentials for each of your accounts.
          </p>
        </div>
        <Button
          variant="primary"
          leading={<Plus size={14} />}
          className="min-w-[180px]"
          onClick={() => {
            setEditingAccount(null);
            setMode("form");
          }}
        >
          Add account
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-[color:var(--color-danger)] bg-[color:rgba(229,72,77,0.08)] text-[12.5px] text-[color:var(--color-danger)] px-3 py-2 mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-[12.5px] text-muted">Loading…</p>
      ) : accounts.length === 0 ? (
        <EmptyState
          onAdd={() => {
            setEditingAccount(null);
            setMode("form");
          }}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 bg-raised border border-soft rounded-lg px-4 py-3"
            >
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: a.color ?? "#5B8DEF" }}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-primary truncate">
                  {a.display_name || a.email}
                </div>
                <div className="text-[11.5px] text-muted truncate">
                  {a.email} · IMAP {a.imap_host}:{a.imap_port} ·
                  {a.smtp_mode === "resend"
                    ? " Resend"
                    : ` SMTP ${a.smtp_host}:${a.smtp_port}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingAccount(a);
                  setMode("form");
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-primary"
                aria-label="Edit account"
                title="Edit account"
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(a.id)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-[color:var(--color-danger)]"
                aria-label="Remove account"
                title="Remove account"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AppearanceSection() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const readingPane = useUiStore((s) => s.readingPane);
  const setReadingPane = useUiStore((s) => s.setReadingPane);

  return (
    <>
      <SectionHeader
        title="Appearance"
        description="How Cursus looks on your machine."
      />

      <Row
        label="Theme"
        hint="Follow the system, or pin a specific mode."
      >
        <SegmentedGroup<Theme>
          value={theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "black", label: "Black" },
          ]}
        />
      </Row>

      <Row
        label="Reading pane"
        hint="Show the message reader next to the inbox list, or open messages full-width."
      >
        <SegmentedGroup<ReadingPane>
          value={readingPane === "right" ? "right" : "off"}
          onChange={(v) => setReadingPane(v)}
          options={[
            { value: "right", label: "Right" },
            { value: "off", label: "Off" },
          ]}
        />
      </Row>
    </>
  );
}

function GeneralSection() {
  const syncIntervalMs = useUiStore((s) => s.syncIntervalMs);
  const setSyncIntervalMs = useUiStore((s) => s.setSyncIntervalMs);
  const notificationsEnabled = useUiStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useUiStore((s) => s.setNotificationsEnabled);
  const quietHoursEnabled = useUiStore((s) => s.quietHoursEnabled);
  const setQuietHoursEnabled = useUiStore((s) => s.setQuietHoursEnabled);
  const quietHoursStart = useUiStore((s) => s.quietHoursStart);
  const setQuietHoursStart = useUiStore((s) => s.setQuietHoursStart);
  const quietHoursEnd = useUiStore((s) => s.quietHoursEnd);
  const setQuietHoursEnd = useUiStore((s) => s.setQuietHoursEnd);
  const taskbarBadgeEnabled = useUiStore((s) => s.taskbarBadgeEnabled);
  const setTaskbarBadgeEnabled = useUiStore((s) => s.setTaskbarBadgeEnabled);
  const remoteImages = useUiStore((s) => s.remoteImages);
  const setRemoteImages = useUiStore((s) => s.setRemoteImages);
  const launchAtLogin = useUiStore((s) => s.launchAtLogin);
  const setLaunchAtLogin = useUiStore((s) => s.setLaunchAtLogin);
  const closeToTray = useUiStore((s) => s.closeToTray);
  const setCloseToTray = useUiStore((s) => s.setCloseToTray);
  const undoSendSeconds = useUiStore((s) => s.undoSendSeconds);
  const setUndoSendSeconds = useUiStore((s) => s.setUndoSendSeconds);
  const confirmBeforeSend = useUiStore((s) => s.confirmBeforeSend);
  const dontMarkReadOnOpen = useUiStore((s) => s.dontMarkReadOnOpen);
  const setDontMarkReadOnOpen = useUiStore((s) => s.setDontMarkReadOnOpen);
  const setConfirmBeforeSend = useUiStore((s) => s.setConfirmBeforeSend);

  return (
    <>
      <SectionHeader title="General" description="Global behaviour of the app." />

      <Row
        label="Sync interval"
        hint="How often Cursus refreshes the active folder. Manual disables the background loop — triggers only on focus or network reconnect."
      >
        <SegmentedGroup<string>
          value={String(syncIntervalMs)}
          onChange={(v) => setSyncIntervalMs(Number(v))}
          options={[
            { value: "0", label: "Manual" },
            { value: "30000", label: "30s" },
            { value: "60000", label: "1m" },
            { value: "300000", label: "5m" },
            { value: "900000", label: "15m" },
          ]}
        />
      </Row>

      <Row
        label="Desktop notifications"
        hint="Toast alerts in the Windows Action Center when new mail arrives and this window is not focused."
      >
        <SegmentedGroup<string>
          value={notificationsEnabled ? "on" : "off"}
          onChange={(v) => setNotificationsEnabled(v === "on")}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
      </Row>

      <Row
        label="Quiet hours"
        hint="Suppress notifications during this window. The range may wrap past midnight (e.g. 22:00 to 08:00)."
      >
        <div className="flex items-center gap-2">
          <SegmentedGroup<string>
            value={quietHoursEnabled ? "on" : "off"}
            onChange={(v) => setQuietHoursEnabled(v === "on")}
            options={[
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
          />
          {quietHoursEnabled && (
            <>
              <input
                type="time"
                value={quietHoursStart}
                onChange={(e) => setQuietHoursStart(e.target.value)}
                className="rounded-md border bg-transparent px-2 py-1 text-[12.5px] text-primary outline-none focus:border-[color:var(--accent)]"
                style={{ borderColor: "var(--border-strong)" }}
              />
              <span className="text-muted">–</span>
              <input
                type="time"
                value={quietHoursEnd}
                onChange={(e) => setQuietHoursEnd(e.target.value)}
                className="rounded-md border bg-transparent px-2 py-1 text-[12.5px] text-primary outline-none focus:border-[color:var(--accent)]"
                style={{ borderColor: "var(--border-strong)" }}
              />
            </>
          )}
        </div>
      </Row>

      <Row
        label="Taskbar badge"
        hint="Red circle with unread count (1–99+) overlaid on the taskbar icon."
      >
        <SegmentedGroup<string>
          value={taskbarBadgeEnabled ? "on" : "off"}
          onChange={(v) => setTaskbarBadgeEnabled(v === "on")}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
      </Row>

      <Row
        label="Remote images"
        hint="Many marketing emails embed 1×1 tracking pixels that signal when you opened the message. Blocking by default protects you; 'Ask' lets you load images per message."
      >
        <SegmentedGroup<RemoteImagesPolicy>
          value={remoteImages}
          onChange={setRemoteImages}
          options={[
            { value: "never", label: "Never" },
            { value: "ask", label: "Ask" },
            { value: "always", label: "Always" },
          ]}
        />
      </Row>

      <Row
        label="Launch at login"
        hint="Start Cursus automatically when you sign in. Combine with 'Close to tray' for a silent background service."
      >
        <SegmentedGroup<string>
          value={launchAtLogin ? "on" : "off"}
          onChange={(v) => setLaunchAtLogin(v === "on")}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
      </Row>

      <Row
        label="Close to tray"
        hint="Closing the window keeps Cursus running in the system tray so notifications and sync continue. Use 'Quit' in the tray menu to fully exit."
      >
        <SegmentedGroup<string>
          value={closeToTray ? "on" : "off"}
          onChange={(v) => setCloseToTray(v === "on")}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
      </Row>

      <Row
        label="Undo send"
        hint="Hold outgoing messages for a few seconds so you can click 'Undo' in the toast and recover them before they leave."
      >
        <SegmentedGroup<string>
          value={String(undoSendSeconds)}
          onChange={(v) => setUndoSendSeconds(Number(v))}
          options={[
            { value: "0", label: "Off" },
            { value: "5", label: "5s" },
            { value: "10", label: "10s" },
            { value: "30", label: "30s" },
          ]}
        />
      </Row>

      <Row
        label="Confirm before send"
        hint="Ask one more time if the subject is empty, the recipient list is empty, or the body mentions an attachment you haven't added."
      >
        <SegmentedGroup<string>
          value={confirmBeforeSend ? "on" : "off"}
          onChange={(v) => setConfirmBeforeSend(v === "on")}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
      </Row>

      <Row
        label="Mark messages as read on open"
        hint="When off, opening a thread no longer marks it as read on the server. Use the keyboard shortcut or the context menu to mark messages as read manually."
      >
        <SegmentedGroup<string>
          value={dontMarkReadOnOpen ? "off" : "on"}
          onChange={(v) => setDontMarkReadOnOpen(v === "off")}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
      </Row>

      <BulkIndexRow />
    </>
  );
}

function BulkIndexRow() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const accountsState = useAccountsStore((s) => s);

  async function runIndex() {
    const { activeAccountId, activeFolderId, folders } = accountsState;
    if (activeAccountId == null || activeFolderId == null) {
      toast.error("No active folder selected");
      return;
    }
    const folder = folders.find((f) => f.id === activeFolderId);
    if (!folder || folder.id <= 0) {
      toast.error("Folder must be synced before indexing");
      return;
    }
    const rows = await listMessagesForFolder(folder.id, 5000);
    const targets = rows.filter((r) => r.body_fetched_at == null);
    if (targets.length === 0) {
      toast.success("All messages in this folder are already indexed");
      return;
    }

    setRunning(true);
    setProgress({ done: 0, total: targets.length });
    const fetchBody = useBodiesStore.getState().fetchBody;
    let done = 0;
    for (const r of targets) {
      try {
        await fetchBody(activeAccountId, folder.path, r.imap_uid);
      } catch {
        // Per-row error is fine — the row stays unindexed and shows up
        // again on the next run.
      }
      done++;
      setProgress({ done, total: targets.length });
    }
    setRunning(false);
    setProgress(null);
    toast.success(`Indexed ${done} messages`);
  }

  return (
    <Row
      label="Index message bodies"
      hint="Pre-fetches every message body in the active folder so full-text search covers them. Otherwise bodies are only indexed when you open each message."
    >
      <button
        type="button"
        disabled={running}
        onClick={() => void runIndex()}
        className="px-3 h-7 text-[12px] rounded-md border border-strong bg-sunken hover:bg-hover hover:text-primary text-secondary disabled:opacity-50"
      >
        {running && progress
          ? `Indexing ${progress.done} / ${progress.total}…`
          : "Index now"}
      </button>
    </Row>
  );
}

// ── Rules section ─────────────────────────────────────────────────────────

interface RuleDraft {
  id: number | null;
  name: string;
  accountId: number | null;
  enabled: boolean;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

function emptyDraft(): RuleDraft {
  return {
    id: null,
    name: "",
    accountId: null,
    enabled: true,
    conditions: [{ field: "from", op: "contains", value: "" }],
    actions: [{ type: "mark_read" }],
  };
}

function fromStored(r: StoredRule): RuleDraft {
  let conditions: RuleCondition[] = [];
  let actions: RuleAction[] = [];
  try {
    conditions = JSON.parse(r.conditions_json) as RuleCondition[];
  } catch {
    /* empty */
  }
  try {
    actions = JSON.parse(r.actions_json) as RuleAction[];
  } catch {
    /* empty */
  }
  return {
    id: r.id,
    name: r.name,
    accountId: r.account_id,
    enabled: r.enabled === 1,
    conditions,
    actions,
  };
}

function RulesSection() {
  const [rules, setRules] = useState<StoredRule[]>([]);
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [draft, setDraft] = useState<RuleDraft | null>(null);

  async function refresh() {
    const [r, a] = await Promise.all([listRules(null), listAccounts()]);
    setRules(r);
    setAccounts(a);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("Rule name is required");
      return;
    }
    if (draft.conditions.length === 0) {
      toast.error("At least one condition is required");
      return;
    }
    if (draft.actions.length === 0) {
      toast.error("At least one action is required");
      return;
    }
    try {
      await upsertRule({
        id: draft.id,
        accountId: draft.accountId,
        name: draft.name.trim(),
        enabled: draft.enabled,
        sortOrder: 0,
        conditionsJson: JSON.stringify(draft.conditions),
        actionsJson: JSON.stringify(draft.actions),
      });
      setDraft(null);
      void refresh();
    } catch (err) {
      toast.error(`Save failed: ${err}`);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Delete this rule?")) return;
    await deleteRule(id);
    void refresh();
  }

  return (
    <>
      <SectionHeader
        title="Rules"
        description="Run automatic actions on incoming mail. Rules apply to messages newly arrived since the last sync."
      />

      {draft ? (
        <RuleDraftForm
          draft={draft}
          accounts={accounts}
          onChange={setDraft}
          onSave={save}
          onCancel={() => setDraft(null)}
        />
      ) : (
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            leading={<Plus size={14} />}
            onClick={() => setDraft(emptyDraft())}
          >
            Add rule
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2 mt-4">
        {rules.length === 0 ? (
          <p className="text-[12.5px] text-muted py-6 text-center">
            No rules yet.
          </p>
        ) : (
          rules.map((r) => (
            <RuleListRow
              key={r.id}
              rule={r}
              accounts={accounts}
              onEdit={() => setDraft(fromStored(r))}
              onDelete={() => void remove(r.id)}
            />
          ))
        )}
      </div>
    </>
  );
}

function RuleListRow({
  rule,
  accounts,
  onEdit,
  onDelete,
}: {
  rule: StoredRule;
  accounts: StoredAccount[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const scope =
    rule.account_id == null
      ? "All accounts"
      : accounts.find((a) => a.id === rule.account_id)?.email ?? `Account #${rule.account_id}`;
  const condCount = (() => {
    try {
      const c = JSON.parse(rule.conditions_json) as unknown[];
      return Array.isArray(c) ? c.length : 0;
    } catch {
      return 0;
    }
  })();
  const actCount = (() => {
    try {
      const a = JSON.parse(rule.actions_json) as unknown[];
      return Array.isArray(a) ? a.length : 0;
    } catch {
      return 0;
    }
  })();

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-md border"
      style={{ borderColor: "var(--border-soft)" }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-primary truncate">
          {rule.name}{" "}
          {rule.enabled === 0 && (
            <span className="text-[10.5px] text-muted font-normal">(disabled)</span>
          )}
        </div>
        <div className="text-[11.5px] text-muted truncate">
          {scope} · {condCount} condition{condCount === 1 ? "" : "s"} · {actCount} action
          {actCount === 1 ? "" : "s"}
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="px-2 py-1 text-[11.5px] text-secondary hover:text-primary hover:bg-hover rounded-md"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="px-2 py-1 text-[11.5px] text-secondary hover:text-[color:var(--color-danger)] hover:bg-hover rounded-md"
      >
        Delete
      </button>
    </div>
  );
}

const FIELDS: { value: RuleField; label: string }[] = [
  { value: "from", label: "From" },
  { value: "to", label: "To" },
  { value: "subject", label: "Subject" },
  { value: "hasAttachment", label: "Has attachment" },
  { value: "isBulk", label: "Is newsletter" },
];

const OPS: { value: RuleOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
  { value: "regex", label: "matches regex" },
  { value: "is", label: "is" },
];

function RuleDraftForm({
  draft,
  accounts,
  onChange,
  onSave,
  onCancel,
}: {
  draft: RuleDraft;
  accounts: StoredAccount[];
  onChange: (d: RuleDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  function patch(p: Partial<RuleDraft>): void {
    onChange({ ...draft, ...p });
  }
  return (
    <div
      className="flex flex-col gap-4 p-4 rounded-lg border"
      style={{ borderColor: "var(--border-strong)", background: "var(--bg-sunken)" }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="e.g. Stripe receipts"
            spellCheck={false}
          />
        </Field>
        <Field label="Account">
          <Select
            value={draft.accountId == null ? "" : String(draft.accountId)}
            onChange={(e) =>
              patch({ accountId: e.target.value === "" ? null : Number(e.target.value) })
            }
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-medium text-secondary">Conditions (all must match)</span>
          <button
            type="button"
            onClick={() =>
              patch({
                conditions: [
                  ...draft.conditions,
                  { field: "from", op: "contains", value: "" },
                ],
              })
            }
            className="text-[11.5px] text-secondary hover:text-primary"
          >
            + Add condition
          </button>
        </div>
        {draft.conditions.map((c, i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <Select
              value={c.field}
              onChange={(e) => {
                const next = [...draft.conditions];
                next[i] = { ...c, field: e.target.value as RuleField };
                patch({ conditions: next });
              }}
            >
              {FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
            <Select
              value={c.op}
              onChange={(e) => {
                const next = [...draft.conditions];
                next[i] = { ...c, op: e.target.value as RuleOp };
                patch({ conditions: next });
              }}
            >
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Input
              className="flex-1"
              value={String(c.value)}
              onChange={(e) => {
                const next = [...draft.conditions];
                next[i] = { ...c, value: e.target.value };
                patch({ conditions: next });
              }}
              placeholder={c.field === "hasAttachment" || c.field === "isBulk" ? "true" : "value"}
            />
            <button
              type="button"
              onClick={() => {
                const next = draft.conditions.filter((_, idx) => idx !== i);
                patch({ conditions: next });
              }}
              className="text-muted hover:text-[color:var(--color-danger)] px-2"
              aria-label="Remove condition"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-medium text-secondary">Actions</span>
          <button
            type="button"
            onClick={() =>
              patch({ actions: [...draft.actions, { type: "mark_read" }] })
            }
            className="text-[11.5px] text-secondary hover:text-primary"
          >
            + Add action
          </button>
        </div>
        {draft.actions.map((a, i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <Select
              value={a.type}
              onChange={(e) => {
                const t = e.target.value as RuleAction["type"];
                const next: RuleAction[] = [...draft.actions];
                next[i] =
                  t === "move_to" ? { type: "move_to", folderPath: "" } : { type: t };
                patch({ actions: next });
              }}
            >
              <option value="move_to">Move to folder</option>
              <option value="mark_read">Mark as read</option>
              <option value="star">Star</option>
              <option value="important">Mark important</option>
              <option value="trash">Move to Trash</option>
            </Select>
            {a.type === "move_to" && (
              <Input
                className="flex-1"
                value={a.folderPath}
                onChange={(e) => {
                  const next: RuleAction[] = [...draft.actions];
                  next[i] = { type: "move_to", folderPath: e.target.value };
                  patch({ actions: next });
                }}
                placeholder="folder path (e.g. INBOX.Receipts)"
              />
            )}
            <button
              type="button"
              onClick={() => {
                const next = draft.actions.filter((_, idx) => idx !== i);
                patch({ actions: next });
              }}
              className="text-muted hover:text-[color:var(--color-danger)] px-2"
              aria-label="Remove action"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[12px] text-secondary">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          Enabled
        </label>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={onSave}>
          Save rule
        </Button>
      </div>
    </div>
  );
}

function KeyboardSection() {
  const groups: Array<{
    title: string;
    items: Array<{ keys: string[]; description: string }>;
  }> = [
    {
      title: "Navigation",
      items: [
        { keys: ["↓", "j"], description: "Next conversation (within active category)" },
        { keys: ["↑", "k"], description: "Previous conversation (within active category)" },
        { keys: ["→"], description: "Next category tab" },
        { keys: ["←"], description: "Previous category tab" },
        { keys: ["Home"], description: "First conversation" },
        { keys: ["End"], description: "Last conversation" },
        { keys: ["Enter", "o"], description: "Open when none selected" },
        { keys: ["u", "Esc"], description: "Back to the list / clear selection" },
      ],
    },
    {
      title: "Selection",
      items: [
        { keys: ["x"], description: "Toggle current row in selection" },
        { keys: ["Shift", "↓"], description: "Extend selection down" },
        { keys: ["Shift", "↑"], description: "Extend selection up" },
        { keys: ["Shift", "click"], description: "Range-select from anchor" },
        { keys: ["Ctrl", "click"], description: "Toggle individual row" },
      ],
    },
    {
      title: "Compose",
      items: [
        { keys: ["c"], description: "New message" },
        { keys: ["r"], description: "Reply" },
        { keys: ["a"], description: "Reply all" },
        { keys: ["f"], description: "Forward" },
        { keys: ["Ctrl", "Enter"], description: "Send (in composer)" },
      ],
    },
    {
      title: "Actions (single or bulk)",
      items: [
        { keys: ["e"], description: "Archive — selected row or whole selection" },
        { keys: ["#", "Del"], description: "Move to trash — row or selection" },
        { keys: ["s"], description: "Toggle star — row or selection" },
        { keys: ["!"], description: "Toggle importance on the selected row" },
      ],
    },
    {
      title: "App",
      items: [
        { keys: ["/"], description: "Open search overlay" },
        { keys: ["Ctrl", "K"], description: "Open search overlay" },
        { keys: ["Ctrl", "Q"], description: "Quit Cursus (bypasses 'Close to tray')" },
      ],
    },
  ];

  return (
    <>
      <SectionHeader
        title="Keyboard"
        description="Single-letter shortcuts, Gmail/Spark-style. Ignored while typing in any input or the composer."
      />
      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <div key={group.title}>
            <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted mb-2">
              {group.title}
            </h3>
            <ul className="flex flex-col gap-1">
              {group.items.map((it) => (
                <li
                  key={it.description}
                  className="flex items-center justify-between py-1.5 text-[13px]"
                >
                  <span className="text-secondary">{it.description}</span>
                  <span className="flex items-center gap-1">
                    {it.keys.map((k, idx) => (
                      <span key={k} className="flex items-center gap-1">
                        {idx > 0 && (
                          <span className="text-[11px] text-muted">or</span>
                        )}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        background: "var(--bg-sunken)",
        borderColor: "var(--border-strong)",
        color: "var(--fg-primary)",
      }}
      className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded border text-[11.5px] font-mono"
    >
      {children}
    </kbd>
  );
}

function AboutSection() {
  return (
    <>
      <SectionHeader title="About" description="What this is running." />
      <dl className="grid grid-cols-[140px_1fr] gap-y-2.5 text-[13px]">
        <dt className="text-muted">Version</dt>
        <dd className="text-primary font-medium tabular-nums">{__APP_VERSION__}</dd>
        <dt className="text-muted">Database</dt>
        <dd className="text-primary font-mono text-[12px] break-all">
          %APPDATA%\com.flow.mail\flow.db
        </dd>
        <dt className="text-muted">Settings table</dt>
        <dd className="text-primary">
          Stored as key/value rows in SQLite — the same file as accounts and drafts.
        </dd>
      </dl>
    </>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-[16px] font-semibold text-primary">{title}</h2>
      <p className="text-[12.5px] text-muted mt-0.5">{description}</p>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-soft last:border-b-0">
      <div className="min-w-0 max-w-sm">
        <div className="text-[13px] font-medium text-primary">{label}</div>
        {hint && <div className="text-[12px] text-muted mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SegmentedGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div
      role="radiogroup"
      style={{
        background: "var(--bg-sunken)",
        borderColor: "var(--border-strong)",
      }}
      className="inline-flex items-stretch rounded-lg border p-1 gap-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            style={{
              background: active
                ? "color-mix(in oklab, var(--accent) 24%, transparent)"
                : "transparent",
              color: active ? "var(--accent)" : "var(--fg-secondary)",
              borderColor: active ? "var(--accent)" : "transparent",
              boxShadow: active ? "var(--shadow-sm)" : "none",
            }}
            className={cn(
              "min-w-[76px] h-8 px-4 rounded-md text-[12.5px] font-medium border",
              "transition-colors",
              !active && "hover:text-[color:var(--fg-primary)]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 border border-dashed border-soft rounded-xl">
      <div
        className="h-12 w-12 rounded-full flex items-center justify-center mb-3"
        style={{ background: "var(--accent-soft)" }}
      >
        <User size={18} className="text-accent" />
      </div>
      <h3 className="text-[14px] font-semibold text-primary">No accounts yet</h3>
      <p className="text-[12.5px] text-muted max-w-sm mt-1">
        Add your first mailbox to start sending and receiving from Cursus.
      </p>
      <Button
        variant="primary"
        className="mt-4 min-w-[180px]"
        leading={<Plus size={14} />}
        onClick={onAdd}
      >
        Add account
      </Button>
    </div>
  );
}
