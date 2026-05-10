import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "rgb(var(--border) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        brand: "rgb(var(--brand) / <alpha-value>)",
        "brand-strong": "rgb(var(--brand-strong) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)"
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 1px rgba(15, 23, 42, 0.02)",
        soft: "0 8px 24px rgba(15, 23, 42, 0.06)",
        pop: "0 16px 40px rgba(15, 23, 42, 0.10)"
      },
      animation: {
        "fade-up": "fade-up 0.5s ease-out both",
        "counter-roll": "counter-roll 0.6s ease-out both",
        shimmer: "shimmer 3s ease-in-out infinite"
      }
    }
  },
  plugins: []
} satisfies Config;
