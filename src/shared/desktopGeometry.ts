export interface DesktopBounds { x: number; y: number; width: number; height: number }

/** The screenshot may be scaled; mouse events always use desktop logical points. */
export function imagePointToDesktop(
  x: number, y: number, pixels: { width: number; height: number }, bounds: DesktopBounds
): { x: number; y: number } {
  if (![x, y, pixels.width, pixels.height, bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      pixels.width <= 0 || pixels.height <= 0 || bounds.width <= 0 || bounds.height <= 0 ||
      x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) throw new Error('Point is outside the observed screenshot.')
  return { x: bounds.x + x * bounds.width / pixels.width, y: bounds.y + y * bounds.height / pixels.height }
}

export function sameDesktopBounds(a: DesktopBounds, b: DesktopBounds): boolean {
  return ['x', 'y', 'width', 'height'].every((key) => a[key as keyof DesktopBounds] === b[key as keyof DesktopBounds])
}
