import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between border-b pb-5">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[rgb(var(--primary))]">
            {eyebrow}
          </div>
        )}
        <h1 className="h-display text-2xl font-bold tracking-tight text-[rgb(var(--fg))] sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-3xl text-xs sm:text-sm leading-relaxed text-[rgb(var(--muted-fg))]">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex flex-wrap shrink-0 items-center gap-2 pt-2 md:pt-0">{action}</div>}
    </div>
  );
}
