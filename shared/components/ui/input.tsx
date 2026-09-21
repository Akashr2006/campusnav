"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      suppressHydrationWarning
      className={cn(
        "h-10 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3.5 text-sm",
        "placeholder:text-[rgb(var(--muted-fg))]",
        "hover:border-[rgb(var(--border-strong))]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ring))] focus-visible:border-[rgb(var(--ring))]",
        "transition-all duration-200 shadow-[var(--shadow-sm)]",
        className,
      )}
      {...rest}
    />
  );
});
