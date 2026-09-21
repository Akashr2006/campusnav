import { cn } from "@/shared/lib/utils";
import type { HTMLAttributes } from "react";

type Variant = "default" | "success" | "warning" | "danger" | "primary";

const variants: Record<Variant, string> = {
  default: "bg-[rgb(var(--muted))] text-[rgb(var(--muted-fg))]",
  success: "bg-[rgb(var(--success)/0.15)] text-[rgb(var(--success))]",
  warning: "bg-[rgb(var(--warning)/0.15)] text-[rgb(var(--warning))]",
  danger: "bg-[rgb(var(--danger)/0.15)] text-[rgb(var(--danger))]",
  primary: "bg-[rgb(var(--primary)/0.15)] text-[rgb(var(--primary))]",
};

export function Badge({
  className,
  variant = "default",
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}
