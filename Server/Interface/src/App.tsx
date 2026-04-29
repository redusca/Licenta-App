import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import NavBar from './components/NavBar'
import Home from './pages/Home'
import Downloads from './pages/Downloads'
import Wiki from './pages/Wiki'
import Support from './pages/Support'
import Containers from './pages/Containers'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
          <NavBar />
          <div className="flex-1">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/downloads" element={<Downloads />} />
              <Route path="/wiki" element={<Wiki />} />
              <Route path="/support" element={<Support />} />
              <Route path="/containers" element={<Containers />} />
            </Routes>
          </div>
          <footer className="border-t border-gray-800 py-6 text-center text-xs text-gray-600">
            Licenta Platform · Open Source · {new Date().getFullYear()}
          </footer>
        </div>
      </BrowserRouter>
    </AuthProvider>
  )
}
