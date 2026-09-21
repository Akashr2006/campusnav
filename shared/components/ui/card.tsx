import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  hover?: boolean;
  padded?: boolean;
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  function Card({ className, hover = false, padded = true, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={cn("card", padded && "p-6", hover && "card-hover", className)}
        {...rest}
      />
    );
  },
);

export function CardTitle({
  className,
  ...rest
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-base font-semibold tracking-tight", className)}
      {...rest}
    />
  );
}

export function CardDescription({
  className,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm text-[rgb(var(--muted-fg))] leading-relaxed", className)}
      {...rest}
    />
  );
}
