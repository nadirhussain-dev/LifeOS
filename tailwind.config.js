/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './features/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        // spatial stack: a sunken/grouped surface beneath resting cards
        surface: {
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          foreground: 'hsl(var(--surface-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        // semantic — kept distinct from the brand accent and module tints
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha-value>)',
          foreground: 'hsl(var(--info-foreground) / <alpha-value>)',
        },
        // module signature tints — one per life area (rings, hero washes,
        // charts, iconography). Deliberately NOT used for chrome.
        habit: 'hsl(var(--habit) / <alpha-value>)',
        calendar: 'hsl(var(--calendar) / <alpha-value>)',
        water: 'hsl(var(--water) / <alpha-value>)',
        sleep: 'hsl(var(--sleep) / <alpha-value>)',
        journal: 'hsl(var(--journal) / <alpha-value>)',
        fitness: 'hsl(var(--fitness) / <alpha-value>)',
        goals: 'hsl(var(--goals) / <alpha-value>)',
        budget: 'hsl(var(--budget) / <alpha-value>)',
        study: 'hsl(var(--study) / <alpha-value>)',
        gallery: 'hsl(var(--gallery) / <alpha-value>)',
        music: 'hsl(var(--music) / <alpha-value>)',
        notes: 'hsl(var(--notes) / <alpha-value>)',
        // the private space — same colour language, reached only via the vault
        vault: 'hsl(var(--vault) / <alpha-value>)',
        cycle: 'hsl(var(--cycle) / <alpha-value>)',
        recovery: 'hsl(var(--recovery) / <alpha-value>)',
        intimacy: 'hsl(var(--intimacy) / <alpha-value>)',
        albums: 'hsl(var(--albums) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
      },
      // 8-point rhythm on a 4px base (mirrors constants/design-tokens.ts).
      //
      // `3xl` MUST be listed even though nothing in the app should reach past
      // `2xl` for a card: Tailwind's own default `3xl` is 24px, which — once
      // `2xl` is overridden to 28 — is SMALLER than the step below it. Fifteen
      // surfaces had picked `rounded-3xl` meaning "the big one" and were
      // silently rendering tighter than the 249 `rounded-2xl` cards beside
      // them. Overriding it restores a monotonic scale so the class names can
      // be trusted; reserve it for genuinely large squares (80pt+ icon
      // plinths, 160pt media tiles) where 28 looks pinched.
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '28px',
        '3xl': '32px',
      },
      letterSpacing: {
        tightest: '-1px',
        tighter: '-0.5px',
        tight: '-0.2px',
        normal: '0px',
        wide: '0.4px',
      },
      boxShadow: {
        // spatial elevation stack — soft on light, reads as depth on dark
        e1: '0 2px 6px rgba(0,0,0,0.05)',
        e2: '0 6px 12px rgba(0,0,0,0.08)',
        e3: '0 10px 20px rgba(0,0,0,0.12)',
        e4: '0 16px 32px rgba(0,0,0,0.18)',
      },
      fontFamily: {
        // Sora Regular as the app-wide default — every Text/TextInput that
        // doesn't specify otherwise picks this up automatically. RN doesn't
        // synthesize bold from a single font file the way CSS does, so
        // heavier weights need their own explicit classes (below), applied
        // only where real visual weight matters (headings, primary CTAs).
        sans: ['Sora_400Regular'],
        'sora-medium': ['Sora_500Medium'],
        'sora-semibold': ['Sora_600SemiBold'],
        'sora-bold': ['Sora_700Bold'],
        'sora-extrabold': ['Sora_800ExtraBold'],
        // Literata — a reading-optimized serif reserved for Journal's actual
        // written content (entry body, prompts, day snippets), so writing a
        // journal entry reads as literary rather than filling in a form.
        // Never used for chrome/labels/buttons — those stay Sora everywhere.
        journal: ['Literata_400Regular'],
        'journal-italic': ['Literata_400Regular_Italic'],
        'journal-medium': ['Literata_500Medium'],
        'journal-semibold': ['Literata_600SemiBold'],
      },
    },
  },
  plugins: [],
};
