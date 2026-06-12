import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-amber-400/40 bg-amber-400/10 text-amber-200",
        success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        warning: "border-orange-500/40 bg-orange-500/10 text-orange-300",
        danger: "border-rose-500/40 bg-rose-500/10 text-rose-300",
        info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
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
