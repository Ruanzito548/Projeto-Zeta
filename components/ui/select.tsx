import * as React from "react";
import { cn } from "@/lib/utils";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => {
  return (
    <select
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-xl border border-[rgba(69,190,95,0.3)] bg-[linear-gradient(180deg,rgba(5,20,8,0.97),rgba(3,10,4,0.97))] px-4 py-2.5 text-sm text-[#e8ffeb] focus-visible:border-[rgba(158,255,138,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(74,168,74,0.3)] focus-visible:shadow-[0_0_0_1px_rgba(120,255,140,0.25)_inset,0_0_18px_rgba(74,168,74,0.15)]",
        className,
      )}
      {...props}
    />
  );
});

Select.displayName = "Select";

export { Select };
