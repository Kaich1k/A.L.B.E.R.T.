import { useEffect } from 'react'
import { ComputerPanel } from './components/ComputerPanel'
import { useAlbertStore } from './store'

/** Dedicated renderer for A.L.B.E.R.T.'s Computer BrowserWindow (`#computer`). */
export default function ComputerApp(): React.JSX.Element {
  const setActivity = useAlbertStore((s) => s.setActivity)
  const setSettings = useAlbertStore((s) => s.setSettings)

  useEffect(() => {
    document.body.classList.add('computer-shell')

    void (async () => {
      try {
        const [settings, activity] = await Promise.all([
          window.albert.getSettings(),
          window.albert.listActivity()
        ])
        setSettings(settings)
        setActivity(activity)
        document.body.classList.toggle('perf-mode', settings.performanceMode !== false)
      } catch {
        /* ignore bootstrap errors */
      }
    })()

    const off = window.albert.onChatEvent((event) => {
      if (event.type === 'tool_start' || event.type === 'tool_end') {
        void window.albert.listActivity().then(setActivity)
      }
    })

    return () => {
      off()
      document.body.classList.remove('computer-shell')
    }
  }, [setActivity, setSettings])

  return (
    <div className="computer-window">
      <div className="drag-bar" />
      <ComputerPanel standalone />
    </div>
  )
}
