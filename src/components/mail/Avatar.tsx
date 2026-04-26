import { cn } from "@/lib/cn";
import { initialsFrom } from "@/lib/time";

const PALETTE = [
  "#5B8DEF",
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#10B981",
  "#06B6D4",
  "#EF4444",
  "#6366F1",
];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length]!;
}

export function Avatar({
  name,
  size = 34,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const initials = initialsFrom(name);
  const bg = colorFor(name);

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full text-white font-medium shrink-0",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.floor(size * 0.38)),
        background: `linear-gradient(135deg, ${bg} 0%, ${bg}cc 100%)`,
      }}
      aria-hidden
    >
      {initials}
    </div>
  );
}
