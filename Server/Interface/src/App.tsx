import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import NavBar from './components/NavBar'
import Home from './pages/Home'
import Downloads from './pages/Downloads'
import Wiki from './pages/Wiki'
import AgentKey from './pages/AgentKey'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
          <NavBar />
          <div style={{ flex: 1 }}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/downloads" element={<Downloads />} />
              <Route path="/wiki" element={<Wiki />} />
              <Route path="/wiki/:section" element={<Wiki />} />
              <Route path="/agent" element={<AgentKey />} />
            </Routes>
          </div>
          <footer style={{
            borderTop: '1px solid var(--border)',
            padding: '20px 24px',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--faint)',
          }}>
            Licenta · Server Platform · {new Date().getFullYear()}
          </footer>
        </div>
      </BrowserRouter>
    </AuthProvider>
  )
}
