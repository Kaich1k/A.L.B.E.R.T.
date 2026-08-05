export const colors = {
  bg0: '#000000',
  bg1: '#02070b',
  bg2: '#071119',
  bg3: '#0b1822',
  bgRaised: '#0c1b26',
  ink: '#e8f2f7',
  inkMuted: '#8aa3b5',
  inkFaint: '#718a9b',
  accent: '#89cff0',
  accentDeep: '#2b86ad',
  accentSoft: 'rgba(137, 207, 240, 0.14)',
  accentFaint: 'rgba(137, 207, 240, 0.07)',
  accentStrong: '#b8e4f8',
  accentGlow: 'rgba(137, 207, 240, 0.45)',
  ok: '#3dcf7a',
  okSoft: 'rgba(61, 207, 122, 0.12)',
  warn: '#f0b85a',
  warnSoft: 'rgba(240, 184, 90, 0.13)',
  danger: '#ff6b63',
  dangerSoft: 'rgba(255, 107, 99, 0.12)',
  line: 'rgba(137, 207, 240, 0.22)',
  lineStrong: 'rgba(137, 207, 240, 0.55)',
  lineDim: 'rgba(255, 255, 255, 0.07)',
  scrim: 'rgba(0, 4, 8, 0.82)'
} as const

export const fonts = {
  display: 'Orbitron_700Bold',
  displayMed: 'Orbitron_500Medium',
  body: 'Rajdhani_500Medium',
  bodyBold: 'Rajdhani_700Bold',
  mono: 'ShareTechMono_400Regular'
} as const

export const spacing = {
  xxs: 4,
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36
} as const

export const radii = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 14,
  pill: 999
} as const

export const sizes = {
  minTarget: 44,
  bottomNav: 66,
  contentMax: 760,
  tabletBreakpoint: 700
} as const

export const typeScale = {
  micro: 11,
  caption: 12,
  body: 16,
  bodyLarge: 18,
  title: 22,
  display: 30
} as const

export const shadows = {
  glow: {
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4
  },
  glowStrong: {
    shadowColor: colors.accentStrong,
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 7
  }
} as const
