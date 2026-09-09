if (typeof location !== 'undefined' && location.hash.replace(/^#/, '').startsWith('hud')) {
  document.documentElement.classList.add('hud-window')
  document.body?.classList.add('hud-window')
}
