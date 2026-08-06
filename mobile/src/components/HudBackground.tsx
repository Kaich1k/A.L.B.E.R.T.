import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../theme'

const GRID_COLUMNS = Array.from({ length: 9 }, (_, index) => index)
const GRID_ROWS = Array.from({ length: 15 }, (_, index) => index)

/** Lightweight native HUD atmosphere. Decorative layers never intercept touches. */
export function HudBackground({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill} accessible={false}>
        <View style={styles.glowTop} />
        <View style={styles.grid}>
          {GRID_COLUMNS.map((column) => (
            <View
              key={`column-${column}`}
              style={[styles.gridColumn, { left: `${(column / (GRID_COLUMNS.length - 1)) * 100}%` }]}
            />
          ))}
          {GRID_ROWS.map((row) => (
            <View
              key={`row-${row}`}
              style={[styles.gridRow, { top: `${(row / (GRID_ROWS.length - 1)) * 100}%` }]}
            />
          ))}
        </View>
        <View style={styles.horizon} />
        <View style={[styles.corner, styles.topLeft]} />
        <View style={[styles.corner, styles.topRight]} />
        <View style={[styles.corner, styles.bottomLeft]} />
        <View style={[styles.corner, styles.bottomRight]} />
        <View style={styles.scanline} />
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0, overflow: 'hidden' },
  glowTop: {
    position: 'absolute',
    top: -180,
    left: '-10%',
    width: '120%',
    height: 350,
    borderRadius: 220,
    backgroundColor: 'rgba(45, 134, 173, 0.14)'
  },
  grid: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.42 },
  gridColumn: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(137, 207, 240, 0.12)'
  },
  gridRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(137, 207, 240, 0.1)'
  },
  horizon: {
    position: 'absolute',
    left: '-15%',
    right: '-15%',
    top: '61%',
    height: 1,
    backgroundColor: 'rgba(137,207,240,0.17)',
    shadowColor: colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 12
  },
  scanline: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '38%',
    height: 1,
    backgroundColor: 'rgba(184,228,248,0.09)'
  },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: colors.lineStrong },
  topLeft: { top: 8, left: 8, borderTopWidth: 1, borderLeftWidth: 1 },
  topRight: { top: 8, right: 8, borderTopWidth: 1, borderRightWidth: 1 },
  bottomLeft: { bottom: 8, left: 8, borderBottomWidth: 1, borderLeftWidth: 1 },
  bottomRight: { bottom: 8, right: 8, borderBottomWidth: 1, borderRightWidth: 1 },
  content: { flex: 1, zIndex: 1 }
})
