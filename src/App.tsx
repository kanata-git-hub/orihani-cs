import React from 'react';
import { ShieldCheck, LogOut, LogIn } from 'lucide-react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuth } from './contexts/AuthContext';
import { loginWithGoogle, logout } from './firebase';
import personaImg from './image/persona.png';
import { HomePage } from './pages/HomePage';
import { ClinicTool } from './pages/ClinicTool';
import { AdminDashboard } from './pages/AdminDashboard';

export default function App() {
  const { user, isAdmin } = useAuth();

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#fffdfa] text-[#552c24] selection:bg-[#ffcd4a]/40 selection:text-[#552c24]">
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-[#552c24]/10 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden bg-white shadow-sm border border-[#552c24]/10">
                <img src={personaImg} alt="오리한의원" className="w-full h-full object-cover" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-[#552c24]">오리한의원 수석 실장 AI</h1>
                <p className="text-sm uppercase tracking-widest text-[#552c24]/70 font-bold">Ori Clinic Manager</p>
              </div>
            </Link>
            
            <div className="flex items-center gap-4">
              {user && isAdmin && (
                <Link to="/admin" className="px-4 py-2 hover:bg-[#ffcd4a]/20 rounded-full transition-colors font-bold flex items-center gap-2">
                  <ShieldCheck size={18} /> Admin
                </Link>
              )}
              {user ? (
                <>
                  <span className="font-bold text-sm bg-gray-100 px-3 py-1 rounded-full text-[#552c24]">{user.displayName || user.email}</span>
                  <button 
                    onClick={logout}
                    className="flex items-center gap-2 px-4 py-2 hover:bg-red-50 text-red-600 rounded-full transition-colors font-bold text-sm"
                  >
                    <LogOut size={16} /> Logout
                  </button>
                </>
              ) : (
                <button 
                  onClick={loginWithGoogle}
                  className="flex items-center gap-2 px-4 py-2 bg-[#ffcd4a] hover:bg-[#ffcd4a]/90 text-[#552c24] rounded-full transition-colors font-bold shadow-sm"
                >
                  <LogIn size={18} /> Login
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-6 py-10">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/tool" element={<ProtectedRoute><ClinicTool /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute requireAdmin={true}><AdminDashboard /></ProtectedRoute>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
