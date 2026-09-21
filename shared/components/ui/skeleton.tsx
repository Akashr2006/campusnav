import { cn } from "@/shared/lib/utils";
import type { HTMLAttributes } from "react";

export function Skeleton({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shimmer rounded-md", className)} {...rest} />;
}
