import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-green-500/40 bg-green-500/12 text-green-200",
        success: "border-green-400/60 bg-green-500/15 text-green-100 shadow-[0_0_14px_rgba(34,197,94,0.25)]",
        warning: "border-yellow-400/50 bg-yellow-500/12 text-yellow-200",
        danger: "border-red-400/50 bg-red-500/12 text-red-200",
        info: "border-green-400/40 bg-green-500/10 text-green-300",
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
