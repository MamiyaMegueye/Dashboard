import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Palette SNDE officielle (navy / blue / cyan / green / amber / red)
        snde: {
          50:  "#EFF6FB",
          100: "#D3E6F2",
          200: "#A5C9E2",
          300: "#71A8CC",
          400: "#3FA9C9",   // cyan
          500: "#1565A0",   // blue principal
          600: "#0F4F86",
          700: "#0A3A6A",
          800: "#0A2A4E",   // navy
          900: "#06203D",
        },
      },
    },
  },
  plugins: [],
};

export default config;
