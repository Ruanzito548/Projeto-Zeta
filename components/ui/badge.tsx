import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-[rgba(180,255,180,0.4)] bg-[rgba(120,220,140,0.2)] text-[#f0fff0]",
        success: "border-[rgba(158,255,138,0.5)] bg-[rgba(74,168,74,0.25)] text-[#d4ffcc] shadow-[0_0_12px_rgba(74,168,74,0.2)]",
        warning: "border-[rgba(243,200,79,0.5)] bg-[rgba(243,200,79,0.12)] text-[#f7e8a0]",
        danger: "border-red-400/50 bg-red-500/12 text-red-200",
        info: "border-[rgba(120,255,140,0.35)] bg-[rgba(120,255,140,0.1)] text-[#a8ff9f]",
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
