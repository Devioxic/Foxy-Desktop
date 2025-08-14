import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        "2xl": "calc(var(--radius) + 8px)", // 16px
        xl: "calc(var(--radius) + 4px)", // 12px
        lg: "var(--radius)", // 8px
        md: "calc(var(--radius) - 4px)", // 4px
        sm: "calc(var(--radius) - 6px)", // 2px
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { transform: "translateY(20px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "slide-up": "slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
      },
      fontSize: {
        // Perfected Typographic Scale (1.25 ratio)
        xs: ["0.75rem", { lineHeight: "1.4", letterSpacing: "0.05em" }], // 12px, small caps
        sm: ["0.9375rem", { lineHeight: "1.4" }], // 15px, UI elements
        base: ["1.125rem", { lineHeight: "1.5" }], // 18px, body text
        lg: ["1.5rem", { lineHeight: "1.2", letterSpacing: "-0.02em" }], // 24px, heading
        xl: ["1.875rem", { lineHeight: "1.2", letterSpacing: "-0.02em" }], // 30px, heading
        "2xl": ["2.3125rem", { lineHeight: "1.2", letterSpacing: "-0.02em" }], // 37px, heading
        "3xl": ["2.875rem", { lineHeight: "1.2", letterSpacing: "-0.02em" }], // 46px, heading
      },
      fontWeight: {
        light: "300",
        regular: "400",
        semibold: "600",
        bold: "700",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
