/** Browser windows that must not parent modal dialogs or count as the main app. */
export function isAuxiliaryAlbertUrl(url: string): boolean {
  const hash = (url.split('#')[1] || '').replace(/\/.*$/, '')
  return hash === 'hud' || hash === 'computer'
}
