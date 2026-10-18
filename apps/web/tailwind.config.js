/** @type {import('tailwindcss').Config} */
const scale = (name, stops) =>
  Object.fromEntries(stops.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));
const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Noto Sans Bengali", "sans-serif"],
        mono: ['ui-monospace', "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        // Design tokens: every palette is a CSS-variable scale (see styles.css) so light/dark share the same class names.
        slate: scale("slate", STOPS),
        teal: scale("teal", STOPS),
        emerald: scale("emerald", STOPS),
        amber: scale("amber", STOPS),
        red: scale("red", STOPS),
        sky: scale("sky", STOPS),
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        link: { DEFAULT: "rgb(var(--link) / <alpha-value>)", strong: "rgb(var(--link-strong) / <alpha-value>)" },
        ink: "rgb(var(--ink) / <alpha-value>)",
      },
      boxShadow: {
        card: "0 1px 2px rgb(var(--shadow) / 0.06), 0 1px 1px rgb(var(--shadow) / 0.04)",
        lift: "0 10px 30px -10px rgb(var(--shadow) / 0.25), 0 2px 6px rgb(var(--shadow) / 0.06)",
        pop: "0 24px 60px -12px rgb(var(--shadow) / 0.35), 0 4px 12px rgb(var(--shadow) / 0.08)",
        glow: "0 0 0 4px rgb(var(--teal-500) / 0.18)",
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
      keyframes: {
        // Transform-only motion: opacity animations would blend text colors mid-flight and trip contrast checks.
        "fade-up": { from: { transform: "translateY(6px)" }, to: { transform: "none" } },
        "fade-in": { from: { transform: "translateY(2px)" }, to: { transform: "none" } },
        "pop-in": { from: { transform: "scale(0.97) translateY(4px)" }, to: { transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
      },
      animation: {
        "fade-up": "fade-up .35s cubic-bezier(.2,.7,.2,1) both",
        "fade-in": "fade-in .25s ease-out both",
        "pop-in": "pop-in .18s cubic-bezier(.2,.8,.2,1) both",
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
