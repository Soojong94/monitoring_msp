import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import StatusDot from '../components/StatusDot.jsx';
import InstallCommand from '../components/InstallCommand.jsx';

function AliasModal({ server, onClose, onSave }) {
  const [form, setForm] = useState({
    display_customer: server.display_customer || '',
    display_server: server.display_server || '',
    notes: server.notes || '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.setAlias(server.customer_id, server.server_name, form);
      onSave();
      onClose();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">서버 별칭 설정</h3>
        <div className="text-sm text-gray-500 mb-4">
          {server.customer_id} / {server.server_name}
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">고객사 표시명</label>
            <input
              value={form.display_customer}
              onChange={(e) => setForm({ ...form, display_customer: e.target.value })}
              placeholder="예: KT 클라우드"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">서버 표시명</label>
            <input
              value={form.display_server}
              onChange={(e) => setForm({ ...form, display_server: e.target.value })}
              placeholder="예: 웹 서버 1"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">메모</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder="담당자, 용도 등..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Servers() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [editServer, setEditServer] = useState(null);
  const [activeTab, setActiveTab] = useState('servers');
  const role = localStorage.getItem('role');

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getServers(showInactive);
      setServers(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [showInactive]);

  const handleDeactivate = async (s) => {
    if (!confirm(`"${s.server_name}" 을 비활성화하시겠습니까? (메트릭 데이터는 유지됩니다)`)) return;
    try {
      await api.deactivateServer(s.customer_id, s.server_name);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handlePurge = async (s) => {
    if (!confirm(`"${s.server_name}" 의 모든 메트릭 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      await api.purgeServer(s.customer_id, s.server_name);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleRestore = async (s) => {
    try {
      await api.restoreServer(s.customer_id, s.server_name);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  // Group by customer
  const grouped = servers.reduce((acc, s) => {
    const cid = s.customer_id;
    if (!acc[cid]) acc[cid] = [];
    acc[cid].push(s);
    return acc;
  }, {});

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">서버 관리</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            비활성 서버 포함
          </label>
          <button onClick={load} className="text-sm text-blue-600 hover:underline">새로고침</button>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('servers')}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            activeTab === 'servers' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          서버 목록
        </button>
        <button
          onClick={() => setActiveTab('install')}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            activeTab === 'install' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          설치 명령어 생성
        </button>
      </div>

      {activeTab === 'install' ? (
        <InstallCommand />
      ) : loading ? (
        <div className="text-center text-gray-500 py-12">로딩 중...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="bg-white rounded-xl shadow p-12 text-center text-gray-500">
          등록된 서버가 없습니다.
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([customerId, svrs]) => (
            <div key={customerId} className="bg-white rounded-xl shadow overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <span className="font-semibold text-gray-800">
                  {svrs[0]?.display_customer || customerId}
                </span>
                <span className="text-xs text-gray-400">({customerId})</span>
                <span className="text-xs text-gray-500 ml-2">{svrs.length}대</span>
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500">
                  <tr>
                    <th className="px-5 py-2 text-left">상태</th>
                    <th className="px-5 py-2 text-left">서버명</th>
                    <th className="px-5 py-2 text-left">표시명</th>
                    <th className="px-5 py-2 text-left">메모</th>
                    <th className="px-5 py-2 text-left">마지막 수신</th>
                    {role === 'admin' && <th className="px-5 py-2 text-right">액션</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {svrs.map((s) => (
                    <tr key={s.server_name} className={`hover:bg-gray-50 ${s.inactive ? 'opacity-50' : ''}`}>
                      <td className="px-5 py-3">
                        <StatusDot online={s.online} inactive={s.inactive} />
                      </td>
                      <td className="px-5 py-3 font-medium text-gray-800">{s.server_name}</td>
                      <td className="px-5 py-3 text-gray-600">{s.display_server || '-'}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs max-w-xs truncate">{s.notes || '-'}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {s.last_seen
                          ? new Date(s.last_seen).toLocaleString('ko-KR', {
                              month: '2-digit', day: '2-digit',
                              hour: '2-digit', minute: '2-digit',
                            })
                          : '-'}
                      </td>
                      {role === 'admin' && (
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditServer(s)}
                              className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                            >
                              별칭
                            </button>
                            {s.inactive ? (
                              <button
                                onClick={() => handleRestore(s)}
                                className="text-xs px-2 py-1 bg-green-50 text-green-600 rounded hover:bg-green-100"
                              >
                                복원
                              </button>
                            ) : (
                              <button
                                onClick={() => handleDeactivate(s)}
                                className="text-xs px-2 py-1 bg-gray-50 text-gray-600 rounded hover:bg-gray-100"
                              >
                                비활성화
                              </button>
                            )}
                            <button
                              onClick={() => handlePurge(s)}
                              className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100"
                            >
                              삭제
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {editServer && (
        <AliasModal
          server={editServer}
          onClose={() => setEditServer(null)}
          onSave={load}
        />
      )}
    </div>
  );
}
