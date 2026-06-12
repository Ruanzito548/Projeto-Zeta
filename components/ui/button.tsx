"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold tracking-[0.01em] transition-all duration-200 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border border-emerald-400/55 bg-[linear-gradient(180deg,rgba(38,255,159,0.26),rgba(9,35,24,0.92))] text-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.35)_inset,0_8px_24px_rgba(16,185,129,0.35)] hover:-translate-y-0.5 hover:border-emerald-300/80 hover:shadow-[0_0_0_1px_rgba(110,231,183,0.5)_inset,0_12px_28px_rgba(16,185,129,0.45)]",
        secondary:
          "border border-emerald-500/30 bg-[linear-gradient(180deg,rgba(12,29,23,0.95),rgba(7,12,18,0.96))] text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.15)_inset] hover:border-emerald-400/55 hover:bg-[linear-gradient(180deg,rgba(18,43,34,0.95),rgba(8,14,21,0.96))]",
        ghost: "border border-transparent bg-transparent text-emerald-100 hover:border-emerald-500/40 hover:bg-emerald-500/10",
        danger:
          "border border-rose-400/45 bg-[linear-gradient(180deg,rgba(244,63,94,0.25),rgba(49,10,21,0.95))] text-rose-100 shadow-[0_0_0_1px_rgba(244,63,94,0.25)_inset] hover:border-rose-300/65 hover:bg-[linear-gradient(180deg,rgba(244,63,94,0.36),rgba(58,12,25,0.96))]",
      },
      size: {
        default: "h-11 px-5 py-2.5",
        sm: "h-9 rounded-lg px-3.5",
        lg: "h-12 rounded-xl px-7",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
