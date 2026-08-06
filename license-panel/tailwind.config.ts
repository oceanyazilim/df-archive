import type { Config } from "tailwindcss";

/** Virus Records panel theme — same token discipline as the desktop app:
 *  colors come from CSS variables, never hardcoded in components. */
const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        card: "var(--surface)",
        "card-elevated": "var(--surface-raised)",
        "card-hover": "var(--surface-hover)",
        input: "var(--input-bg)",
        border: {
          DEFAULT: "var(--border-subtle)",
          strong: "var(--border)",
        },
        foreground: "var(--text-primary)",
        "foreground-secondary": "var(--text-secondary)",
        "foreground-muted": "var(--text-muted)",
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          dim: "var(--accent-dim)",
        },
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        violet: "var(--accent-violet)",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "var(--radius-sm)",
        lg: "var(--radius-lg)",
      },
    },
  },
  plugins: [],
};

export default config;
