import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leading?: ReactNode;
}

const base =
  "inline-flex items-center justify-center gap-2 font-medium select-none " +
  "transition-[filter,background-color,border-color,box-shadow,transform] duration-150 " +
  "active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0 " +
  "focus-visible:ring-[color:var(--accent-soft)]";

const variantClass: Record<Variant, string> = {
  primary:
    "text-white shadow-soft hover:brightness-110 disabled:hover:brightness-100",
  secondary:
    "bg-sunken text-primary border border-soft hover:border-strong hover:bg-hover",
  ghost:
    "bg-transparent text-secondary hover:bg-hover hover:text-primary",
  danger:
    "bg-[color:var(--color-danger)] text-white hover:brightness-110",
};

const sizeClass: Record<Size, string> = {
  sm: "h-8 px-3 text-[12.5px]",
  md: "h-9 px-4 text-[13px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  leading,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      type={rest.type ?? "button"}
      style={{
        borderRadius: 6,
        ...(variant === "primary"
          ? { background: "linear-gradient(135deg, #6a97fb 0%, #4670d1 100%)" }
          : {}),
        ...rest.style,
      }}
      className={cn(base, variantClass[variant], sizeClass[size], className)}
    >
      {leading}
      {children}
    </button>
  );
}
