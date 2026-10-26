export const colors = {
  bg: '#0B0B16',
  bgAlt: '#151528',
  primary: '#8B5CF6',
  secondary: '#38BDF8',
  highlight: '#EC4899',
  text: '#F8FAFC',
  textMuted: '#A1A1AA',
  glass: 'rgba(255,255,255,0.08)',
  glassStrong: 'rgba(255,255,255,0.14)',
  glassBorder: 'rgba(255,255,255,0.18)',
  overlay: 'rgba(8,8,20,0.55)',
  success: '#34D399',
  danger: '#F87171',
  warning: '#FBBF24',
} as const;

export const gradients = {
  primary: [colors.primary, colors.secondary] as const,
  accent: [colors.primary, colors.highlight] as const,
  background: [colors.bg, colors.bgAlt] as const,
};

export const radius = { sm: 12, md: 18, lg: 24, xl: 32, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const type = {
  title: { fontSize: 28, fontWeight: '700' as const, color: colors.text, letterSpacing: -0.4 },
  heading: { fontSize: 20, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.text },
  caption: { fontSize: 13, fontWeight: '400' as const, color: colors.textMuted },
  label: { fontSize: 14, fontWeight: '600' as const, color: colors.text },
};

export const DOCK = { height: 68, margin: 16, padding: 12, radius: 28 } as const;
export const MIN_TOUCH = 48;
