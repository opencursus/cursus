import { getCurrentWindow } from "@tauri-apps/api/window";
import { ipc } from "@/lib/ipc";
import { useUiStore } from "@/stores/ui";

// The X button always takes a deterministic action:
//   closeToTray = true  → hide the window, keep process + tray alive
//   closeToTray = false → exit the app fully (app.exit(0))
// Without intercepting, Tauri would just close the window while the tray
// keeps the process running — which visually looks like nothing happened.
export async function attachCloseToTray(): Promise<void> {
  const win = getCurrentWindow();
  try {
    await win.onCloseRequested((event) => {
      event.preventDefault();
      if (useUiStore.getState().closeToTray) {
        void win.hide();
      } else {
        void ipc.appQuit().catch(() => {});
      }
    });
  } catch (err) {
    console.warn("onCloseRequested failed:", err);
  }
}
