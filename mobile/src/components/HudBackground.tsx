import { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../theme'

export function HudBackground({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.glowTop} />
      <View pointerEvents="none" style={styles.glowSide} />
      <View pointerEvents="none" style={styles.gridH} />
      <View pointerEvents="none" style={styles.gridV} />
      <View style={styles.content}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg0
  },
  glowTop: {
    position: 'absolute',
    top: -60,
    left: '5%',
    width: '90%',
    height: 240,
    backgroundColor: 'rgba(137, 207, 240, 0.16)',
    borderRadius: 200
  },
  glowSide: {
    position: 'absolute',
    bottom: '15%',
    right: -40,
    width: 180,
    height: 220,
    backgroundColor: 'rgba(40, 110, 150, 0.2)',
    borderRadius: 200
  },
  gridH: {
    ...StyleSheet.absoluteFill,
    opacity: 0.06,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent
  },
  gridV: {
    ...StyleSheet.absoluteFill,
    opacity: 0.05,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent
  },
  content: {
    flex: 1,
    zIndex: 1
  }
})
