export function formatDateStack(
  timestamp: number,
  now: number = Date.now(),
): { primary: string; secondary: string | null } {
  if (!timestamp) return { primary: "", secondary: null };
  const date = new Date(timestamp);
  const nowDate = new Date(now);

  const sameDay =
    date.getFullYear() === nowDate.getFullYear() &&
    date.getMonth() === nowDate.getMonth() &&
    date.getDate() === nowDate.getDate();

  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (sameDay) return { primary: time, secondary: null };

  const diffMs = now - timestamp;
  const dayMs = 1000 * 60 * 60 * 24;
  const diffDays = Math.floor(diffMs / dayMs);

  if (diffDays < 7) {
    return {
      primary: date.toLocaleDateString(undefined, { weekday: "short" }),
      secondary: time,
    };
  }
  if (date.getFullYear() === nowDate.getFullYear()) {
    return {
      primary: date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      secondary: time,
    };
  }
  return {
    primary: date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    secondary: time,
  };
}

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp);
  const nowDate = new Date(now);
  const sameDay =
    date.getFullYear() === nowDate.getFullYear() &&
    date.getMonth() === nowDate.getMonth() &&
    date.getDate() === nowDate.getDate();

  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const diffMs = now - timestamp;
  const dayMs = 1000 * 60 * 60 * 24;
  const diffDays = Math.floor(diffMs / dayMs);

  if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  if (date.getFullYear() === nowDate.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function initialsFrom(name: string | null | undefined, fallback: string = "?"): string {
  if (!name) return fallback;
  const parts = name
    .replace(/<[^>]+>/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function addressName(header: string | null | undefined): string {
  if (!header) return "";
  const match = header.match(/^(.*?)\s*<.*>$/);
  if (match && match[1]) return match[1].replace(/"/g, "").trim();
  return header.trim();
}
