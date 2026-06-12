import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-emerald-400/40 bg-emerald-400/10 text-emerald-100",
        success: "border-emerald-300/60 bg-emerald-400/15 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.25)]",
        warning: "border-orange-300/55 bg-orange-400/15 text-orange-100",
        danger: "border-rose-300/55 bg-rose-400/15 text-rose-100",
        info: "border-sky-300/55 bg-sky-400/15 text-sky-100",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
