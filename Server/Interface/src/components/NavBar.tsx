import { NavLink } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import AuthModal from './AuthModal'

const TABS = [
  { to: '/', label: 'Home', end: true },
  { to: '/downloads', label: 'Downloads' },
  { to: '/wiki', label: 'Wiki' },
  { to: '/support', label: 'Support' },
  { to: '/containers', label: 'Containers' },
]

export default function NavBar() {
  const { user, logout } = useAuth()
  const [showAuth, setShowAuth] = useState(false)

  return (
    <>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      <header className="sticky top-0 z-40 bg-gray-950/90 backdrop-blur-md border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4">
          {/* Top bar */}
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center text-white text-xs font-bold">L</div>
              <span className="font-semibold text-white tracking-tight">Licenta</span>
              <span className="badge bg-brand-900/60 text-brand-400 border border-brand-700/40">v1.0</span>
            </div>
            <div className="flex items-center gap-2">
              {user ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400 hidden sm:block">{user.email}</span>
                  <button onClick={logout} className="btn-secondary text-xs px-3 py-1.5">Sign out</button>
                </div>
              ) : (
                <button onClick={() => setShowAuth(true)} className="btn-primary text-xs px-3 py-1.5">Sign in</button>
              )}
            </div>
          </div>

          {/* Tab bar */}
          <nav className="flex -mb-px gap-1">
            {TABS.map(tab => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? 'border-brand-500 text-brand-400'
                      : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
    </>
  )
}
