import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useUiStore } from "@/stores/ui";

let permissionPromise: Promise<boolean> | null = null;

async function ensurePermission(): Promise<boolean> {
  if (!permissionPromise) {
    permissionPromise = (async () => {
      try {
        if (await isPermissionGranted()) return true;
        const res = await requestPermission();
        return res === "granted";
      } catch {
        return false;
      }
    })();
  }
  return permissionPromise;
}

function windowIsFocused(): boolean {
  return typeof document !== "undefined" && !document.hidden && document.hasFocus();
}

export async function notifyNewMail(
  subject: string,
  from: string,
  count: number,
): Promise<void> {
  if (!useUiStore.getState().notificationsEnabled) return;
  // Never spam when the user is actively looking at the app.
  if (windowIsFocused()) return;
  if (!(await ensurePermission())) return;
  try {
    const title = count > 1 ? `${count} new messages` : "New message";
    const body = count > 1 ? `${from}: ${subject}` : `${from} — ${subject}`;
    sendNotification({ title, body });
  } catch (err) {
    console.warn("sendNotification failed:", err);
  }
}
