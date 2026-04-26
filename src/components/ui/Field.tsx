import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">
        {label}
      </span>
      {children}
      {error ? (
        <span className="text-[11.5px] text-[color:var(--color-danger)]">{error}</span>
      ) : hint ? (
        <span className="text-[11.5px] text-disabled">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({
  className,
  style,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      style={{ borderRadius: 6, ...style }}
      className={cn(
        "h-9 px-3 text-[13px] bg-sunken border border-soft text-primary",
        "placeholder:text-disabled outline-none focus:border-strong focus:ring-2 focus:ring-[color:var(--accent-soft)]",
        "transition-colors",
        className,
      )}
    />
  );
}

export function Select({
  className,
  style,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      style={{ borderRadius: 6, ...style }}
      className={cn(
        "h-9 px-2.5 text-[13px] bg-sunken border border-soft text-primary",
        "outline-none focus:border-strong focus:ring-2 focus:ring-[color:var(--accent-soft)]",
        "transition-colors",
        className,
      )}
    >
      {children}
    </select>
  );
}
