import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/** Mirrors the OS Reduce Motion preference unless the user set an explicit override. */
export function useReducedMotion(override?: boolean): boolean {
  const [systemReduced, setSystemReduced] = useState(false)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setSystemReduced(enabled)
    })
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setSystemReduced
    )
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  return override ?? systemReduced
}
