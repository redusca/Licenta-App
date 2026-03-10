import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

const API = '/api/auth'

/** Safely extract a human-readable message from any FastAPI error response. */
async function _parseError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json()
    if (!data.detail) return `${fallback} (${res.status})`
    // Plain string detail
    if (typeof data.detail === 'string') return data.detail
    // Pydantic 422 — detail is [{loc, msg, type}, ...]
    if (Array.isArray(data.detail)) {
      return data.detail.map((e: { msg?: string }) => e.msg ?? JSON.stringify(e)).join('; ')
    }
    return `${fallback} (${res.status})`
  } catch {
    // Response body was not JSON (e.g. HTML 500 page)
    return `${fallback} — server returned ${res.status} (non-JSON response)`
  }
}

interface User {
  id: string
  email: string
  is_active: boolean
}

interface AuthContextType {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('licenta_token'))
  const [user, setUser] = useState<User | null>(null)

  const _fetchMe = async (tok: string) => {
    const res = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${tok}` } })
    if (!res.ok) throw new Error('Failed to fetch user')
    return res.json() as Promise<User>
  }

  const _saveToken = useCallback(async (tok: string) => {
    localStorage.setItem('licenta_token', tok)
    setToken(tok)
    const u = await _fetchMe(tok)
    setUser(u)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const form = new URLSearchParams({ username: email, password })
    const res = await fetch(`${API}/login`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(await _parseError(res, 'Login failed'))
    const { access_token } = await res.json()
    await _saveToken(access_token)
  }, [_saveToken])

  const register = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) throw new Error(await _parseError(res, 'Registration failed'))
    const { access_token } = await res.json()
    await _saveToken(access_token)
  }, [_saveToken])

  const logout = useCallback(() => {
    localStorage.removeItem('licenta_token')
    setToken(null)
    setUser(null)
  }, [])

  // Lazily fetch user if we have a stored token but no user object
  if (token && !user) {
    _fetchMe(token).then(setUser).catch(() => {
      localStorage.removeItem('licenta_token')
      setToken(null)
    })
  }

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
