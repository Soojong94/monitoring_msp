import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';

const navItems = [
  { to: '/dashboard', label: '대시보드', icon: '📊' },
  { to: '/servers', label: '서버 관리', icon: '🖥️' },
  { to: '/alerts', label: '알람 설정', icon: '🔔' },
  { to: '/system', label: '시스템', icon: '⚙️' },
  { to: '/users', label: '사용자 관리', icon: '👥', adminOnly: true },
  { to: '/grafana-users', label: 'Grafana 계정', icon: '📈', adminOnly: true },
];

export default function Layout() {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    navigate('/login');
  };

  const role = localStorage.getItem('role');

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 text-white flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <div className="text-lg font-bold text-blue-400">MSP Portal</div>
          <div className="text-xs text-gray-400 mt-1">{localStorage.getItem('username')} · {role}</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.filter(item => !item.adminOnly || role === 'admin').map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800'
                }`
              }
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors text-left"
          >
            로그아웃
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
