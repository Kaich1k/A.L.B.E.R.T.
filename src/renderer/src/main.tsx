import './hudBoot'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ComputerApp from './ComputerApp'
import HudApp from './HudApp'
import './styles/global.css'

const hash = window.location.hash.replace(/^#/, '')
const isComputer = hash === 'computer' || hash.startsWith('computer/')
const isHud = hash === 'hud'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isHud ? <HudApp /> : isComputer ? <ComputerApp /> : <App />}
  </StrictMode>
)
