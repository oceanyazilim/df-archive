"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:shadow-focus-ring disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-[var(--on-accent)] hover:bg-accent-hover active:translate-y-px shadow-sm",
        secondary:
          "bg-card-elevated text-foreground border border-border-strong hover:bg-card-hover active:translate-y-px",
        outline:
          "bg-transparent text-foreground border border-border-strong hover:bg-card-hover active:translate-y-px",
        ghost: "bg-transparent text-foreground-secondary hover:bg-card-hover hover:text-foreground",
        danger: "bg-transparent text-danger border border-danger/30 hover:bg-danger/10",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4 text-sm",
        lg: "h-11 px-5 text-sm",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, icon, disabled, children, ...props }, ref) => {
    // Radix Slot requires exactly one child — when asChild, the caller owns
    // the full content (including any icon) inside that single child.
    if (asChild) {
      return (
        <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
