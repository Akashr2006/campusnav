import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "card flex flex-col items-center justify-center text-center",
        compact ? "gap-3 px-6 py-10" : "gap-4 px-6 py-16",
        className
      )}
    >
      <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--muted))] p-3.5">
        <Icon className="h-6 w-6 text-[rgb(var(--muted-fg))]" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        {description && (
          <p className="text-sm leading-relaxed text-[rgb(var(--muted-fg))]">{description}</p>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
