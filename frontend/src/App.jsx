import React, { useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Database,
  BrainCircuit,
  FileText,
  Users,
  ShieldCheck,
  LogOut,
  Leaf,
  MapPinned,
  Menu,
  UserCheck,
} from 'lucide-react';
import { api, session } from './lib/api';
import Dashboard from './pages/Dashboard';
import Measurements from './pages/Measurements';
import Predictions from './pages/Predictions';
import Reports from './pages/Reports';
import UsersPage from './pages/Users';
import Catalogs from './pages/Catalogs';
import Audit from './pages/Audit';

const navigation = [
  ['/dashboard', 'Resumen', LayoutDashboard],
  ['/measurements', 'Mediciones', Database],
  ['/predictions', 'Predicciones IA', BrainCircuit],
  ['/reports', 'Reportes', FileText],
  ['/catalogs', 'Estaciones y variables', MapPinned],
  ['/users', 'Usuarios', Users],
  ['/audit', 'Auditoría', ShieldCheck],
];

const QUICK_USERS = [
  { name: 'Germain', role: 'Administrador', email: 'germain@ecopredict.local', pass: 'EcoPredict2026!', tone: 'emerald' },
  { name: 'Luis', role: 'Usuario', email: 'luis@ecopredict.local', pass: 'EcoPredict2026!', tone: 'sky' },
  { name: 'Renato', role: 'Usuario', email: 'renato@ecopredict.local', pass: 'EcoPredict2026!', tone: 'sky' },
  { name: 'Tania', role: 'Administrador', email: 'tania@ecopredict.local', pass: 'EcoPredict2026!', tone: 'emerald' },
];

export default function App() {
  const [auth, setAuth] = useState(session.read());
  const [sidebar, setSidebar] = useState(false);
  const nav = useNavigate();

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST', body: { refreshToken: auth.refreshToken } });
    } catch {}
    session.clear();
    setAuth(null);
    nav('/login');
  }

  const login = async (email, password) => {
    const response = await api('/auth/login', { method: 'POST', body: { email, password } });
    session.save(response);
    setAuth(response);
    nav('/dashboard');
  };

  if (!auth) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={login} />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    );
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside
        className={`${
          sidebar ? 'block' : 'hidden'
        } lg:block lg:w-64 bg-ink text-white shrink-0 p-5 lg:min-h-screen`}
      >
        <div className="flex items-center gap-2 text-xl font-extrabold tracking-tight mb-9">
          <Leaf className="text-emerald-300" />
          EcoPredict <span className="text-emerald-300">AI</span>
        </div>
        <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Plataforma ambiental</div>
        <nav className="space-y-1">
          {navigation
            .filter(([url]) => auth.user.role === 'admin' || !['/users', '/audit'].includes(url))
            .map(([url, label, Icon]) => (
              <NavLink
                key={url}
                to={url}
                onClick={() => setSidebar(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-3 rounded-xl text-sm ${
                    isActive ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10'
                  }`
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>
            ))}
        </nav>
        <div className="mt-10 pt-5 border-t border-white/20 text-sm">
          <div className="font-semibold">{auth.user.full_name}</div>
          <div className="text-slate-400 text-xs mb-4">
            {auth.user.role === 'admin' ? 'Administrador' : 'Usuario'}
          </div>
          <button className="flex gap-2 items-center text-slate-300 hover:text-white" onClick={logout}>
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
          <div className="flex gap-2 items-center">
            <button className="lg:hidden" onClick={() => setSidebar(!sidebar)} aria-label="Abrir menú">
              <Menu />
            </button>
            <span className="font-bold text-ink">Centro de análisis ambiental</span>
          </div>
          <span className="text-xs rounded-full bg-emerald-50 text-emerald-700 px-3 py-1">
            Monitoreo y predicción
          </span>
        </header>
        <div className="p-5 lg:p-8 max-w-7xl mx-auto">
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/measurements" element={<Measurements role={auth.user.role} />} />
            <Route path="/predictions" element={<Predictions />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/catalogs" element={<Catalogs role={auth.user.role} />} />
            <Route
              path="/users"
              element={auth.user.role === 'admin' ? <UsersPage /> : <Navigate to="/dashboard" />}
            />
            <Route
              path="/audit"
              element={auth.user.role === 'admin' ? <Audit /> : <Navigate to="/dashboard" />}
            />
            <Route path="*" element={<Navigate to="/dashboard" />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function autofill(u) {
    setEmail(u.email);
    setPassword(u.pass);
    setSelected(u.email);
    setError('');
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-ink to-[#0e6253]">
      <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-lg">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            setError('');
            try {
              await onLogin(email, password);
            } catch (err) {
              setError(err.message);
            } finally {
              setLoading(false);
            }
          }}
        >
          <div className="flex items-center gap-2 text-3xl font-extrabold text-ink mb-2">
            <Leaf className="text-leaf" />
            EcoPredict AI
          </div>
          <p className="muted mb-6">Accede al centro de inteligencia ambiental.</p>
          {error && <div className="error mb-4">{error}</div>}
          <div className="mb-4">
            <label>Correo electrónico</label>
            <input
              className="form-field"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="mb-6">
            <label>Contraseña</label>
            <input
              className="form-field"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button disabled={loading} className="btn w-full">
            {loading ? 'Ingresando...' : 'Ingresar al sistema'}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-200">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
            <UserCheck size={14} className="text-leaf" />
            Acceso rápido (clic para autorellenar)
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {QUICK_USERS.map((u) => {
              const active = selected === u.email;
              return (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => autofill(u)}
                  className={`text-left p-3 rounded-xl border transition ${
                    active
                      ? 'border-leaf bg-emerald-50/70 ring-1 ring-leaf'
                      : 'border-slate-200 hover:border-leaf/60 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm text-ink">{u.name}</span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        u.tone === 'emerald'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-sky-100 text-sky-800'
                      }`}
                    >
                      {u.role}
                    </span>
                  </div>
                  <div className="text-[11px] muted truncate mt-0.5">{u.email}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
