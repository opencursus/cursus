import {
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { getSettings, setSetting } from "@/lib/settings";

const KEY_X = "win_x";
const KEY_Y = "win_y";
const KEY_W = "win_w";
const KEY_H = "win_h";
const KEY_MAX = "win_maximized";

const MIN_W = 960;
const MIN_H = 600;

function parseInt32(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export async function restoreWindowState(): Promise<void> {
  const win = getCurrentWindow();
  let stored: Record<string, string | null> = {};
  try {
    stored = await getSettings([KEY_X, KEY_Y, KEY_W, KEY_H, KEY_MAX]);
  } catch {
    // Fall through — center the window as a fallback.
  }

  const x = parseInt32(stored[KEY_X] ?? null);
  const y = parseInt32(stored[KEY_Y] ?? null);
  const w = parseInt32(stored[KEY_W] ?? null);
  const h = parseInt32(stored[KEY_H] ?? null);
  const maximized = stored[KEY_MAX] === "1";

  try {
    if (w != null && h != null && w >= MIN_W && h >= MIN_H) {
      await win.setSize(new PhysicalSize(w, h));
    }
    if (x != null && y != null) {
      await win.setPosition(new PhysicalPosition(x, y));
    } else {
      await win.center();
    }
    if (maximized) {
      await win.maximize();
    }
  } catch (err) {
    console.warn("restoreWindowState failed", err);
  }

  try {
    await win.show();
  } catch (err) {
    console.warn("window.show failed", err);
  }
}

export async function attachWindowPersistence(): Promise<void> {
  const win = getCurrentWindow();

  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  let sizeTimer: ReturnType<typeof setTimeout> | null = null;

  async function flushMaximizedFlag() {
    try {
      const m = await win.isMaximized();
      void setSetting(KEY_MAX, m ? "1" : "0").catch(() => {});
    } catch {
      // ignore
    }
  }

  try {
    await win.onMoved(({ payload }) => {
      if (moveTimer) clearTimeout(moveTimer);
      moveTimer = setTimeout(async () => {
        try {
          if (await win.isMaximized()) {
            // Keep the previously stored restore position while maximized.
            return;
          }
        } catch {
          /* fall through */
        }
        void setSetting(KEY_X, String(Math.trunc(payload.x))).catch(() => {});
        void setSetting(KEY_Y, String(Math.trunc(payload.y))).catch(() => {});
      }, 500);
    });
    await win.onResized(({ payload }) => {
      if (sizeTimer) clearTimeout(sizeTimer);
      sizeTimer = setTimeout(async () => {
        void flushMaximizedFlag();
        try {
          if (await win.isMaximized()) {
            return;
          }
        } catch {
          /* fall through */
        }
        void setSetting(KEY_W, String(Math.trunc(payload.width))).catch(() => {});
        void setSetting(KEY_H, String(Math.trunc(payload.height))).catch(() => {});
      }, 500);
    });
  } catch (err) {
    console.warn("attachWindowPersistence failed", err);
  }
}
