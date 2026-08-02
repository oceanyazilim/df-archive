import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1500px] px-5 pb-16 pt-6 sm:px-7", className)}>{children}</div>;
}
