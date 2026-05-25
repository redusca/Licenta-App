import { NavLink } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import AuthModal from './AuthModal'

const TABS = [
  { to: '/', label: 'Home', end: true },
  { to: '/wiki', label: 'Wiki' },
  { to: '/downloads', label: 'Download' },
  { to: '/agent', label: 'API Key' },
]

function ServerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="3" width="16" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="2" y="12" width="16" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="15" cy="5.5" r="1" fill="currentColor"/>
      <circle cx="15" cy="14.5" r="1" fill="currentColor"/>
    </svg>
  )
}

export default function NavBar() {
  const { user, logout } = useAuth()
  const [showAuth, setShowAuth] = useState(false)

  return (
    <>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      <header className="nav">
        <div className="nav-brand">
          <div className="nav-mark">
            <ServerIcon />
          </div>
          <span>Licenta&nbsp;<span style={{ color: 'var(--muted)', fontWeight: 400 }}>/&nbsp;Server</span></span>
        </div>

        <nav className="nav-links">
          {TABS.map(tab => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className="nav-controls">
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{user.email}</span>
              <button onClick={logout} className="btn btn-secondary" style={{ padding: '5px 12px', fontSize: 12 }}>
                Sign out
              </button>
            </div>
          ) : (
            <button onClick={() => setShowAuth(true)} className="btn btn-primary" style={{ padding: '5px 14px', fontSize: 12 }}>
              Sign in
            </button>
          )}
        </div>
      </header>
    </>
  )
}
