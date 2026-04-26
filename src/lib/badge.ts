import { ipc } from "@/lib/ipc";
import { useAccountsStore } from "@/stores/accounts";
import { useUiStore } from "@/stores/ui";

// Mirrors the unread count shown on Inbox folders across all accounts onto
// the Windows taskbar as an overlay icon. Subscribes once; fires the IPC
// only when the effective total actually changes.
export function attachTaskbarBadge(): void {
  let last = -1;

  const publish = (total: number) => {
    if (total === last) return;
    last = total;
    console.log("[badge] publish total=", total);
    ipc
      .windowSetUnreadBadge(total)
      .then(() => console.log("[badge] ok", total))
      .catch((e) => console.warn("[badge] failed", total, e));
  };

  const computeUnread = (
    folders: ReturnType<typeof useAccountsStore.getState>["folders"],
  ) =>
    folders
      .filter((f) => f.specialUse === "inbox")
      .reduce((sum, f) => sum + (f.unreadCount || 0), 0);

  const recompute = () => {
    const enabled = useUiStore.getState().taskbarBadgeEnabled;
    if (!enabled) {
      publish(0);
      return;
    }
    publish(computeUnread(useAccountsStore.getState().folders));
  };

  recompute();
  useAccountsStore.subscribe(recompute);
  useUiStore.subscribe(recompute);
}
