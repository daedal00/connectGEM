import { createRoot } from 'react-dom/client'
import { Join, NAME_KEY, readTeam } from './Join.tsx'
import { Board } from './Board.tsx'
import './theme.css'

// Four screens, so the router is a switch on the path. Wave 3 adds /admin
// and /screen/:code here.
function App() {
  const play = location.pathname.match(/^\/play\/([^/]+)\/?$/)
  if (play) {
    const code = decodeURIComponent(play[1]).toUpperCase()
    const name = localStorage.getItem(NAME_KEY)
    const team = readTeam()
    if (name && team) return <Board code={code} name={name} team={team} />
    return <Join initialCode={code} />
  }
  return <Join initialCode="" />
}

const container = document.getElementById('root')
if (!container) throw new Error('missing #root element')
createRoot(container).render(<App />)
