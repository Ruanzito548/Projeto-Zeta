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
          "border border-green-400/60 bg-[linear-gradient(180deg,rgba(34,197,94,0.28),rgba(0,18,8,0.95))] text-green-50 shadow-[0_0_0_1px_rgba(34,197,94,0.35)_inset,0_0_20px_rgba(34,197,94,0.2),0_8px_24px_rgba(0,0,0,0.6)] hover:-translate-y-0.5 hover:border-green-300/80 hover:shadow-[0_0_0_1px_rgba(74,222,128,0.5)_inset,0_0_28px_rgba(34,197,94,0.3),0_12px_28px_rgba(0,0,0,0.7)]",
        secondary:
          "border border-green-500/35 bg-[linear-gradient(180deg,rgba(0,14,5,0.97),rgba(0,8,3,0.98))] text-green-200 shadow-[0_0_0_1px_rgba(34,197,94,0.15)_inset] hover:border-green-400/55 hover:bg-[linear-gradient(180deg,rgba(0,20,8,0.97),rgba(0,12,4,0.98))] hover:text-green-100",
        ghost: "border border-transparent bg-transparent text-green-300 hover:border-green-500/40 hover:bg-green-500/10 hover:text-green-100",
        danger:
          "border border-red-500/45 bg-[linear-gradient(180deg,rgba(239,68,68,0.22),rgba(30,0,0,0.97))] text-red-200 shadow-[0_0_0_1px_rgba(239,68,68,0.2)_inset] hover:border-red-400/65 hover:bg-[linear-gradient(180deg,rgba(239,68,68,0.32),rgba(40,0,0,0.97))]",
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
