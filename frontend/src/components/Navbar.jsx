import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import styles from './Navbar.module.css';

const IconClock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
  </svg>
);
const IconList = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
    <rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>
  </svg>
);
const IconWallet = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/>
    <path d="M16 3H8L4 7h16L16 3z"/><circle cx="16" cy="14" r="1" fill="currentColor"/>
  </svg>
);
const IconUsers = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
  </svg>
);
const IconDashboard = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
  </svg>
);
const IconSettings = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
);
const IconHours = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l3 3"/>
    <path d="M16.5 18.5l1.5 1.5" strokeLinecap="round"/>
  </svg>
);
const IconSchedule = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>
  </svg>
);
const IconCorrections = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);
const IconLogout = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
  </svg>
);
const IconPlan = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
    <rect x="9" y="3" width="6" height="4" rx="1"/>
    <path d="M9 12h6M9 16h4"/><circle cx="17" cy="17" r="3" strokeWidth="1.5"/><path d="M17 15.5v2l1 1" strokeWidth="1.5"/>
  </svg>
);
const IconMenu = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);

export default function Navbar({ isAdmin = false }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = isAdmin ? [
    { to: '/admin', label: 'Panel', icon: <IconDashboard />, end: true },
    { to: '/admin/fichajes', label: 'Fichajes', icon: <IconList /> },
    { to: '/admin/empleados', label: 'Empleados', icon: <IconUsers /> },
    { to: '/admin/saldos', label: 'Saldos', icon: <IconWallet /> },
    { to: '/admin/horas', label: 'Horas', icon: <IconHours /> },
    { to: '/admin/solicitudes', label: 'Correcciones', icon: <IconCorrections /> },
    { to: '/admin/horarios', label: 'Horarios', icon: <IconSchedule /> },
    { to: '/admin/reservas', label: 'Planificación', icon: <IconPlan /> },
    { to: '/admin/configuracion', label: 'Configuración', icon: <IconSettings /> },
  ] : [
    { to: '/', label: 'Fichar', icon: <IconClock />, end: true },
    { to: '/historial', label: 'Mi historial', icon: <IconList /> },
    { to: '/saldos', label: 'Mis saldos', icon: <IconWallet /> },
    { to: '/horas', label: 'Mis horas', icon: <IconHours /> },
    { to: '/solicitudes', label: 'Correcciones', icon: <IconCorrections /> },
    { to: '/plan', label: 'Planificación', icon: <IconPlan /> },
  ];

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <img src="/logo.svg" alt="Bodegas Álvaro" className={styles.logo} />
        </div>

        <button
          className={styles.menuBtn}
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Menú"
        >
          <IconMenu />
        </button>

        <div className={`${styles.links} ${menuOpen ? styles.open : ''}`}>
          {navLinks.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              {icon}
              <span>{label}</span>
            </NavLink>
          ))}
        </div>

        <div className={styles.user}>
          <div className={styles.avatar}>
            {user?.nombre?.[0]}{user?.apellidos?.[0]}
          </div>
          <div className={styles.userInfo}>
            <span className={styles.userName}>{user?.nombre} {user?.apellidos}</span>
            <span className={styles.userRole}>{user?.rol === 'admin' ? 'Administrador' : user?.departamento || 'Empleado'}</span>
          </div>
          <button onClick={logout} className={styles.logoutBtn} title="Cerrar sesión">
            <IconLogout />
          </button>
        </div>
      </div>
    </nav>
  );
}
