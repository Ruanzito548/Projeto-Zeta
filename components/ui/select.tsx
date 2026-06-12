import * as React from "react";
import { cn } from "@/lib/utils";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => {
  return (
    <select
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-xl border border-emerald-500/30 bg-[linear-gradient(180deg,rgba(2,8,12,0.95),rgba(7,14,22,0.9))] px-4 py-2.5 text-sm text-emerald-50 focus-visible:border-emerald-300/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/35 focus-visible:shadow-[0_0_0_1px_rgba(52,211,153,0.35)_inset,0_0_24px_rgba(16,185,129,0.25)]",
        className,
      )}
      {...props}
    />
  );
});

Select.displayName = "Select";

export { Select };
