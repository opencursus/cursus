import { Fragment } from "react";
import { Users, Megaphone, Bell, Inbox, Mail } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/stores/ui";
import type { MailCategory } from "@/types";

type Tab = {
  id: MailCategory | "all" | "unread";
  label: string;
  icon: typeof Users;
};

const TABS: Tab[] = [
  { id: "all", label: "All", icon: Inbox },
  { id: "unread", label: "Unread", icon: Mail },
  { id: "people", label: "People", icon: Users },
  { id: "newsletters", label: "Newsletters", icon: Megaphone },
  { id: "notifications", label: "Notifications", icon: Bell },
];

export function CategoryTabs({ counts }: { counts: Record<string, number> }) {
  const active = useUiStore((s) => s.activeCategory);
  const setActive = useUiStore((s) => s.setActiveCategory);

  return (
    <div
      className="flex items-center justify-center gap-2 px-3 py-2"
      style={{
        background: "linear-gradient(135deg, #6a97fb 0%, #4670d1 100%)",
      }}
    >
      {TABS.map((tab, idx) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        const count = counts[tab.id] ?? 0;
        return (
          <Fragment key={tab.id}>
            {idx > 0 && (
              <span
                aria-hidden
                className="h-3.5 w-px shrink-0"
                style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
              />
            )}
            <button
              type="button"
              onClick={() => setActive(tab.id)}
              style={{
                borderRadius: 6,
                ...(isActive
                  ? {
                      background: "#ffffff",
                      color: "#4670d1",
                      boxShadow:
                        "0 1px 3px rgba(15,17,21,0.15), 0 1px 1px rgba(15,17,21,0.08)",
                    }
                  : { background: "transparent", color: "rgba(255,255,255,0.85)" }),
              }}
              className={cn(
                "flex items-center justify-center gap-1.5 h-9 px-3.5",
                "text-[12.5px] font-medium whitespace-nowrap flex-1 min-w-0",
                "transition-colors duration-150",
                !isActive && "hover:bg-white/15 hover:text-white",
              )}
            >
              <Icon size={13} />
              <span>{tab.label}</span>
              {count > 0 && tab.id !== "all" && tab.id !== "unread" && (
                <span
                  style={
                    isActive
                      ? { background: "rgba(70,112,209,0.12)", color: "#4670d1" }
                      : { background: "rgba(255,255,255,0.22)", color: "#ffffff" }
                  }
                  className="ml-1 rounded px-1.5 py-px text-[10.5px] tabular-nums font-semibold"
                >
                  {count}
                </span>
              )}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
