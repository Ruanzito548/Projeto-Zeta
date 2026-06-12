import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-xl border border-[rgba(69,190,95,0.3)] bg-[linear-gradient(180deg,rgba(5,20,8,0.97),rgba(3,10,4,0.97))] px-4 py-2.5 text-sm text-[#e8ffeb] ring-offset-[#030a04] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[#4a8a4a] focus-visible:border-[rgba(158,255,138,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(74,168,74,0.3)] focus-visible:shadow-[0_0_0_1px_rgba(120,255,140,0.25)_inset,0_0_18px_rgba(74,168,74,0.15)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

Input.displayName = "Input";

export { Input };
