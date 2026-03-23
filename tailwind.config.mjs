/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // New AION brand colors based on logo
        aion: {
          // Deep blues from the sphere
          dark: '#000e41',
          primary: '#0066cc',
          blue: '#0088dd',
          // Teal-cyan transition
          teal: '#00a5b5',
          cyan: '#00c4cc',
          // Green from the arrow
          green: '#4cd964',
          'green-light': '#69ff87',
        },
        // Design system surface colors (The Analytical Monolith)
        surface: {
          DEFAULT: '#f7f9ff',
          'container-low': '#edf4ff',
          'container-lowest': '#ffffff',
          'container-high': '#d8eaff',
          'container-highest': '#c3d4eb',
          bright: '#ffffff',
          variant: 'rgba(237, 244, 255, 0.6)',
        },
        // Primary palette
        primary: {
          DEFAULT: '#000e41',
          container: '#001f70',
          light: '#0066cc',
        },
        // On-colors for text
        'on-surface': '#001d32',
        'on-primary': '#ffffff',
        // Tertiary for success/growth accents
        tertiary: {
          DEFAULT: '#001905',
          fixed: '#69ff87',
          'fixed-dim': '#4cd964',
        },
        // Outline colors
        outline: {
          DEFAULT: '#73777f',
          variant: '#c3c6ce',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        'editorial': '-0.02em',
        'label': '0.05em',
      },
      lineHeight: {
        'body': '1.6',
      },
      borderRadius: {
        'md': '0.375rem',
        'lg': '0.5rem',
      },
      boxShadow: {
        // Ambient shadow for floating elements
        'ambient': '0 12px 40px rgba(0, 29, 50, 0.06)',
        'ambient-lg': '0 20px 60px rgba(0, 29, 50, 0.08)',
      },
      backgroundImage: {
        // Signature gradient for CTAs
        'aion-gradient': 'linear-gradient(135deg, #000e41 0%, #001f70 100%)',
        // Teal to green gradient (like the arrow)
        'growth-gradient': 'linear-gradient(135deg, #00a5b5 0%, #4cd964 100%)',
      },
    },
  },
  plugins: [],
}
