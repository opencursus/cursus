import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useUiStore } from "@/stores/ui";

// Keeps the stored preference and the OS-level autostart registration in
// sync. Called once at boot (syncs system → preference if they diverge) and
// again whenever the user toggles the setting (preference → system).
export function attachAutostart(): void {
  // Initial reconciliation: if stored = true but system = false, turn on;
  // if stored = false but system = true, turn off. The user's preference
  // wins over whatever the registry says.
  void (async () => {
    try {
      const want = useUiStore.getState().launchAtLogin;
      const have = await isEnabled();
      if (want && !have) await enable();
      if (!want && have) await disable();
    } catch (err) {
      console.warn("autostart initial sync failed:", err);
    }
  })();

  let lastWant = useUiStore.getState().launchAtLogin;
  useUiStore.subscribe((state) => {
    if (state.launchAtLogin === lastWant) return;
    lastWant = state.launchAtLogin;
    void (async () => {
      try {
        if (state.launchAtLogin) await enable();
        else await disable();
      } catch (err) {
        console.warn("autostart toggle failed:", err);
      }
    })();
  });
}
