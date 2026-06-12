import * as React from "react";
import { cn } from "@/lib/utils";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => {
  return (
    <select
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-xl border border-green-500/35 bg-[linear-gradient(180deg,rgba(0,5,2,0.97),rgba(0,8,3,0.95))] px-4 py-2.5 text-sm text-green-100 focus-visible:border-green-400/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/30 focus-visible:shadow-[0_0_0_1px_rgba(34,197,94,0.3)_inset,0_0_20px_rgba(34,197,94,0.15)]",
        className,
      )}
      {...props}
    />
  );
});

Select.displayName = "Select";

export { Select };
