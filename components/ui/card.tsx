import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-emerald-500/25 bg-[linear-gradient(160deg,rgba(6,11,14,0.94),rgba(7,13,22,0.94)_55%,rgba(3,8,12,0.96))] text-slate-100 shadow-[0_0_0_1px_rgba(16,185,129,0.12)_inset,0_22px_55px_rgba(0,0,0,0.46)] backdrop-blur-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-lg font-semibold leading-none tracking-tight text-emerald-50", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}
