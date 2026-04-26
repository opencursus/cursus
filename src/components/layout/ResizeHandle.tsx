import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface Props {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
}

// Pointer-event based resize handle. setPointerCapture guarantees that the
// pointerup is delivered to this element even if the cursor leaves the WebView
// (e.g. onto the custom titlebar drag region, or outside the window). Without
// capture the mouseup was being swallowed and the drag looked "stuck".
export function ResizeHandle({ value, min = 320, max = 720, onChange }: Props) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const el = e.currentTarget;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore — some browsers throw if the pointer id is already captured
      }
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startValue: value,
      };
      setDragging(true);
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const delta = e.clientX - drag.startX;
      const next = Math.min(Math.max(drag.startValue + delta, min), max);
      onChange(next);
    },
    [min, max, onChange],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    dragRef.current = null;
    setDragging(false);
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      style={{ touchAction: "none" }}
      className={cn(
        "relative h-full w-[6px] shrink-0 cursor-col-resize select-none",
        "before:absolute before:inset-y-0 before:left-[2px] before:w-[2px]",
        "before:bg-[color:var(--border-soft)] before:transition-colors",
        "hover:before:bg-[color:var(--accent)]",
        dragging && "before:bg-[color:var(--accent)]",
      )}
    />
  );
}
