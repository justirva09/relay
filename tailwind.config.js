/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        th: {
          bg: 'var(--c-bg)',
          sidebar: 'var(--c-sidebar)',
          surface: 'var(--c-surface)',
          elevated: 'var(--c-elevated)',
          input: 'var(--c-input)',
          hover: 'var(--c-hover)',
          overlay: 'var(--c-overlay)',
          border: 'var(--c-border)',
          'border-input': 'var(--c-border-input)',
          'border-focus': 'var(--c-border-focus)',
          'text-1': 'var(--c-text-1)',
          'text-2': 'var(--c-text-2)',
          'text-3': 'var(--c-text-3)',
          'text-4': 'var(--c-text-4)',
          accent: 'var(--c-accent)',
          'accent-hover': 'var(--c-accent-hover)',
          'accent-bg': 'var(--c-accent-bg)',
          'accent-border': 'var(--c-accent-border)',
          'accent-text': 'var(--c-accent-text)',
          'syn-key': 'var(--c-syn-key)',
          'syn-string': 'var(--c-syn-string)',
          'syn-number': 'var(--c-syn-number)',
          'syn-bool': 'var(--c-syn-bool)',
          'syn-null': 'var(--c-syn-null)',
        },
      },
    },
  },
  plugins: [],
};
