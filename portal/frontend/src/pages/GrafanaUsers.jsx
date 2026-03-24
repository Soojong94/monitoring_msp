import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const ROLES = ['Admin', 'Editor', 'Viewer'];
const roleBadge = (role) => {
  const styles = {
    Admin: 'bg-purple-100 text-purple-700',
    Editor: 'bg-blue-100 text-blue-700',
    Viewer: 'bg-gray-100 text-gray-600',
  };
  return styles[role] || 'bg-gray-100 text-gray-600';
};

export default function GrafanaUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', login: '', email: '', password: '', role: 'Viewer' });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editRole, setEditRole] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setUsers(await api.getGrafanaUsers());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.login.trim() || !form.password.trim()) return;
    setCreating(true);
    try {
      await api.createGrafanaUser(form);
      setForm({ name: '', login: '', email: '', password: '', role: 'Viewer' });
      setShowForm(false);
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (id) => {
    try {
      if (editRole) await api.updateGrafanaRole(id, editRole);
      if (editPassword) await api.resetGrafanaPassword(id, editPassword);
      setEditingId(null);
      setEditRole('');
      setEditPassword('');
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleDelete = async (id, login) => {
    if (!confirm(`'${login}' Grafana 계정을 삭제하시겠습니까?`)) return;
    try {
      await api.deleteGrafanaUser(id);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Grafana 계정 관리</h1>
          <p className="text-sm text-gray-500 mt-1">Grafana 대시보드 접속 계정 관리</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600">
          + 계정 추가
        </button>
      </div>

      {/* 신규 계정 생성 폼 */}
      {showForm && (
        <div className="bg-white rounded-xl shadow p-5 mb-6">
          <div className="text-sm font-medium text-gray-700 mb-3">새 Grafana 계정</div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">이름</label>
              <input
                placeholder="홍길동"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">로그인 ID</label>
              <input
                placeholder="honggildong"
                value={form.login}
                onChange={(e) => setForm({ ...form, login: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">이메일</label>
              <input
                type="email"
                placeholder="hong@company.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">비밀번호</label>
              <input
                type="password"
                placeholder="초기 비밀번호"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
          </div>
          <div className="flex gap-3 items-center">
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
            <button onClick={handleCreate} disabled={creating} className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 disabled:opacity-50">
              {creating ? '생성 중...' : '생성'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200">
              취소
            </button>
          </div>
        </div>
      )}

      {/* 계정 목록 */}
      <div className="bg-white rounded-xl shadow">
        {loading ? (
          <div className="p-12 text-center text-gray-500">로딩 중...</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500 uppercase">
                <th className="px-5 py-3">이름</th>
                <th className="px-5 py-3">로그인 ID</th>
                <th className="px-5 py-3">이메일</th>
                <th className="px-5 py-3">역할</th>
                <th className="px-5 py-3">마지막 로그인</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <React.Fragment key={u.id}>
                  <tr className="border-b hover:bg-gray-50">
                    <td className="px-5 py-3 text-sm font-medium text-gray-800">{u.name || '-'}</td>
                    <td className="px-5 py-3 text-sm text-gray-700">{u.login}</td>
                    <td className="px-5 py-3 text-sm text-gray-500">{u.email || '-'}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${roleBadge(u.orgRole)}`}>
                        {u.orgRole || '-'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-500">
                      {u.lastSeenAt && !u.lastSeenAt.startsWith('0001')
                        ? u.lastSeenAt.slice(0, 16).replace('T', ' ')
                        : '-'}
                    </td>
                    <td className="px-5 py-3 flex gap-2 justify-end">
                      <button
                        onClick={() => { setEditingId(editingId === u.id ? null : u.id); setEditRole(u.orgRole); setEditPassword(''); }}
                        className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => handleDelete(u.id, u.login)}
                        className="text-xs px-2 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                  {editingId === u.id && (
                    <tr className="bg-orange-50 border-b">
                      <td colSpan={6} className="px-5 py-3">
                        <div className="flex gap-3 items-center flex-wrap">
                          <select
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value)}
                            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                          >
                            {ROLES.map((r) => <option key={r}>{r}</option>)}
                          </select>
                          <input
                            type="password"
                            placeholder="새 비밀번호 (변경 시만)"
                            value={editPassword}
                            onChange={(e) => setEditPassword(e.target.value)}
                            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                          />
                          <button onClick={() => handleUpdate(u.id)} className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600">
                            저장
                          </button>
                          <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200">
                            취소
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
