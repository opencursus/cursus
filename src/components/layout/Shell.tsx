import { useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { MessageList } from "@/components/layout/MessageList";
import { MessageView } from "@/components/layout/MessageView";
import { TitleBar } from "@/components/layout/TitleBar";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Composer } from "@/components/composer/Composer";
import { MoveToFolderPicker } from "@/components/mail/MoveToFolderPicker";
import { Toaster } from "@/components/ui/Toaster";
import { useUiStore } from "@/stores/ui";

export function Shell() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const readingPane = useUiStore((s) => s.readingPane);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const closeSettings = useUiStore((s) => s.closeSettings);
  const messageListWidth = useUiStore((s) => s.messageListWidth);
  const setMessageListWidth = useUiStore((s) => s.setMessageListWidth);

  useEffect(() => {
    if (!settingsOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeSettings();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, closeSettings]);

  const sidebarWidth = sidebarCollapsed ? 64 : 240;

  return (
    <div className="h-full flex flex-col bg-base">
      <TitleBar />
      <div
        className="flex-1 grid overflow-hidden"
        style={{
          gridTemplateColumns: settingsOpen
            ? "1fr"
            : readingPane === "right"
              ? `${sidebarWidth}px ${messageListWidth}px 6px 1fr`
              : `${sidebarWidth}px 1fr`,
        }}
      >
        {settingsOpen ? (
          <SettingsPage />
        ) : (
          <>
            <Sidebar />
            <MessageList />
            {readingPane === "right" && (
              <>
                <ResizeHandle
                  value={messageListWidth}
                  onChange={setMessageListWidth}
                />
                <MessageView />
              </>
            )}
          </>
        )}
      </div>
      <Composer />
      <MoveToFolderPicker />
      <Toaster />
    </div>
  );
}
