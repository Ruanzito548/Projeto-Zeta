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
          "border border-[rgba(158,255,138,0.7)] bg-[linear-gradient(180deg,#9eff8a_0%,#4aa84a_52%,#1a5a1a_100%)] text-[#f0fff0] font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_rgba(74,168,74,0.35)] hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_12px_28px_rgba(74,168,74,0.45)]",
        secondary:
          "border border-[rgba(120,255,140,0.3)] bg-[linear-gradient(180deg,rgba(120,255,140,0.15),rgba(20,80,30,0.3))] text-[#e0ffe0] hover:bg-[linear-gradient(180deg,rgba(150,255,170,0.22),rgba(30,100,40,0.35))] hover:border-[rgba(120,255,140,0.5)]",
        ghost: "border border-transparent bg-transparent text-[#b8e6b8] hover:border-[rgba(120,255,140,0.3)] hover:bg-[rgba(120,255,140,0.08)] hover:text-[#e0ffe0]",
        danger:
          "border border-red-500/45 bg-[linear-gradient(180deg,rgba(239,68,68,0.22),rgba(30,0,0,0.97))] text-red-200 shadow-[0_0_0_1px_rgba(239,68,68,0.2)_inset] hover:border-red-400/65 hover:brightness-110",
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
