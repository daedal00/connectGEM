import { createRoot } from 'react-dom/client'
import { Join, NAME_KEY } from './Join.tsx'
import { Play } from './Play.tsx'
import { Admin } from './Admin.tsx'
import { Screen } from './Screen.tsx'
import './theme.css'

// Four screens, so the router is a switch on the path.
function App() {
  const path = location.pathname
  if (path === '/admin' || path === '/admin/') return <Admin />

  const screen = path.match(/^\/screen(?:\/([^/]+))?\/?$/)
  if (screen) return <Screen code={screen[1] ? decodeURIComponent(screen[1]).toUpperCase() : null} />

  const play = path.match(/^\/play\/([^/]+)\/?$/)
  if (play) {
    const code = decodeURIComponent(play[1]).toUpperCase()
    const name = localStorage.getItem(NAME_KEY)
    if (name) return <Play code={code} name={name} />
    return <Join initialCode={code} />
  }
  return <Join initialCode="" />
}

const container = document.getElementById('root')
if (!container) throw new Error('missing #root element')
createRoot(container).render(<App />)
