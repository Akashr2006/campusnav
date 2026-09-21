"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "gradient";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-[rgb(var(--primary))] text-[rgb(var(--primary-fg))] hover:bg-[rgb(var(--primary-2))] shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-glow)]",
  gradient:
    "gradient-primary text-white shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-glow)] hover:brightness-110",
  secondary:
    "bg-[rgb(var(--muted))] text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted-2))] border border-transparent",
  ghost: "hover:bg-[rgb(var(--muted))] text-[rgb(var(--fg))]",
  outline:
    "border border-[rgb(var(--border-strong))] bg-[rgb(var(--card))]/50 hover:bg-[rgb(var(--muted))] text-[rgb(var(--fg))]",
  danger: "bg-[rgb(var(--danger))] text-white hover:opacity-90 shadow-[var(--shadow-sm)]",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs rounded-md gap-1.5",
  md: "h-10 px-4 text-sm rounded-lg gap-2",
  lg: "h-12 px-6 text-[15px] rounded-xl gap-2",
  icon: "h-10 w-10 rounded-lg",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = "primary", size = "md", loading, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      suppressHydrationWarning
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg))]",
        "disabled:opacity-50 disabled:pointer-events-none",
        "active:scale-[0.98]",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        children
      )}
    </button>
  );
});
