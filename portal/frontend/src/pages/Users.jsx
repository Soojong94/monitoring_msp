import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'viewer' });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState('');
  const [myPassword, setMyPassword] = useState('');
  const [changingMyPw, setChangingMyPw] = useState(false);
  const currentUser = localStorage.getItem('username') || '';

  const load = async () => {
    setLoading(true);
    try {
      setUsers(await api.getUsers());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newUser.username.trim() || !newUser.password.trim()) return;
    setCreating(true);
    try {
      await api.createUser(newUser);
      setNewUser({ username: '', password: '', role: 'viewer' });
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
      const body = {};
      if (editRole) body.role = editRole;
      if (editPassword) body.password = editPassword;
      await api.updateUser(id, body);
      setEditingId(null);
      setEditPassword('');
      setEditRole('');
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleDelete = async (id, username) => {
    if (!confirm(`'${username}' 계정을 삭제하시겠습니까?`)) return;
    try {
      await api.deleteUser(id);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleChangeMyPassword = async () => {
    if (!myPassword.trim()) return;
    setChangingMyPw(true);
    try {
      await api.changeMyPassword(myPassword);
      setMyPassword('');
      alert('비밀번호가 변경되었습니다.');
    } catch (e) {
      alert(e.message);
    } finally {
      setChangingMyPw(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">사용자 관리</h1>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          + 사용자 추가
        </button>
      </div>

      {/* 새 사용자 추가 */}
      {showForm && (
        <div className="bg-white rounded-xl shadow p-5 mb-6">
          <div className="text-sm font-medium text-gray-700 mb-3">새 계정 생성</div>
          <div className="flex gap-3 flex-wrap">
            <input
              placeholder="아이디"
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="password"
              placeholder="비밀번호"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={newUser.role}
              onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
            <button onClick={handleCreate} disabled={creating} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
              {creating ? '생성 중...' : '생성'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200">
              취소
            </button>
          </div>
        </div>
      )}

      {/* 사용자 목록 */}
      <div className="bg-white rounded-xl shadow mb-6">
        {loading ? (
          <div className="p-12 text-center text-gray-500">로딩 중...</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500 uppercase">
                <th className="px-5 py-3">아이디</th>
                <th className="px-5 py-3">역할</th>
                <th className="px-5 py-3">마지막 로그인</th>
                <th className="px-5 py-3">생성일</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <React.Fragment key={u.id}>
                  <tr className="border-b hover:bg-gray-50">
                    <td className="px-5 py-3 text-sm font-medium text-gray-800">
                      {u.username}
                      {u.username === currentUser && <span className="ml-2 text-xs text-blue-500">(나)</span>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-500">{u.last_login ? u.last_login.slice(0, 19).replace('T', ' ') : '-'}</td>
                    <td className="px-5 py-3 text-sm text-gray-500">{u.created_at ? u.created_at.slice(0, 10) : '-'}</td>
                    <td className="px-5 py-3 flex gap-2 justify-end">
                      <button
                        onClick={() => { setEditingId(editingId === u.id ? null : u.id); setEditRole(u.role); setEditPassword(''); }}
                        className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => handleDelete(u.id, u.username)}
                        className="text-xs px-2 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                  {editingId === u.id && (
                    <tr className="bg-blue-50 border-b">
                      <td colSpan={5} className="px-5 py-3">
                        <div className="flex gap-3 items-center flex-wrap">
                          <select
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value)}
                            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="viewer">Viewer</option>
                            <option value="admin">Admin</option>
                          </select>
                          <input
                            type="password"
                            placeholder="새 비밀번호 (변경 시만)"
                            value={editPassword}
                            onChange={(e) => setEditPassword(e.target.value)}
                            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button onClick={() => handleUpdate(u.id)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
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

      {/* 내 비밀번호 변경 */}
      <div className="bg-white rounded-xl shadow p-5">
        <div className="text-sm font-medium text-gray-700 mb-3">내 비밀번호 변경</div>
        <div className="flex gap-3">
          <input
            type="password"
            placeholder="새 비밀번호"
            value={myPassword}
            onChange={(e) => setMyPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleChangeMyPassword()}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={handleChangeMyPassword} disabled={changingMyPw} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
            {changingMyPw ? '변경 중...' : '변경'}
          </button>
        </div>
      </div>
    </div>
  );
}
