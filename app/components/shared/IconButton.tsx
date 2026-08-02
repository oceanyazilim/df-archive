"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const iconButtonVariants = cva(
  "inline-flex items-center justify-center rounded-sm border transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:shadow-focus-ring disabled:pointer-events-none disabled:opacity-50 shrink-0",
  {
    variants: {
      variant: {
        default: "bg-card border-border-strong text-foreground-secondary hover:text-foreground hover:border-accent/50",
        ghost: "bg-transparent border-transparent text-foreground-secondary hover:bg-card-hover hover:text-foreground",
        active: "bg-accent-dim border-accent/40 text-accent",
      },
      size: {
        sm: "size-7",
        md: "size-8",
        lg: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
);

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  label: string;
  icon: ReactNode;
}

/** Icon-only button. `label` is required and becomes the accessible name (visually hidden). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, label, icon, ...props }, ref) => (
    <button ref={ref} type="button" aria-label={label} title={label} className={cn(iconButtonVariants({ variant, size }), className)} {...props}>
      {icon}
    </button>
  )
);
IconButton.displayName = "IconButton";
