import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ComputerApp from './ComputerApp'
import './styles/global.css'

const hash = window.location.hash.replace(/^#/, '')
const isComputer = hash === 'computer' || hash.startsWith('computer/')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isComputer ? <ComputerApp /> : <App />}</StrictMode>
)
