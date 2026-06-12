import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-xl border border-emerald-500/30 bg-[linear-gradient(180deg,rgba(2,8,12,0.95),rgba(7,14,22,0.9))] px-4 py-2.5 text-sm text-emerald-50 ring-offset-slate-950 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:border-emerald-300/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/35 focus-visible:shadow-[0_0_0_1px_rgba(52,211,153,0.35)_inset,0_0_24px_rgba(16,185,129,0.25)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

Input.displayName = "Input";

export { Input };
