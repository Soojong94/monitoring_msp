import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function CustomerAlertPanel({ config, onRefresh }) {
  const [newEmail, setNewEmail] = useState('');
  const [thresholds, setThresholds] = useState(config.thresholds);
  const [saving, setSaving] = useState(false);
  const [addingEmail, setAddingEmail] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const role = localStorage.getItem('role');

  const handleDeleteCustomer = async () => {
    if (!confirm(`'${config.customer_id}' 알람 설정을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    try {
      await api.deleteAlertConfig(config.customer_id);
      onRefresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleAddEmail = async () => {
    if (!newEmail.trim()) return;
    setAddingEmail(true);
    try {
      await api.addEmail(config.customer_id, newEmail.trim());
      setNewEmail('');
      onRefresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setAddingEmail(false);
    }
  };

  const handleDeleteEmail = async (emailId) => {
    if (!confirm('이메일을 삭제하시겠습니까?')) return;
    try {
      await api.deleteEmail(config.customer_id, emailId);
      onRefresh();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleToggleEmail = async (emailId) => {
    try {
      await api.toggleEmail(config.customer_id, emailId);
      onRefresh();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleSaveThresholds = async () => {
    setSaving(true);
    try {
      await api.updateAlertConfig(config.customer_id, { thresholds });
      alert('임계값이 저장되었습니다.');
      onRefresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">{config.customer_id}</h3>
        {role === 'admin' && (
          <button
            onClick={handleDeleteCustomer}
            disabled={deleting}
            className="text-xs px-2 py-1 bg-red-50 text-red-500 rounded hover:bg-red-100 disabled:opacity-50"
          >
            {deleting ? '삭제 중...' : '고객사 삭제'}
          </button>
        )}
      </div>

      {/* Email section */}
      <div className="mb-5">
        <div className="text-sm font-medium text-gray-700 mb-2">알람 수신 이메일</div>
        <div className="space-y-2 mb-3">
          {config.emails.length === 0 ? (
            <div className="text-xs text-gray-400">등록된 이메일 없음</div>
          ) : (
            config.emails.map((e) => (
              <div key={e.id} className="flex items-center gap-2">
                <span className={`text-sm flex-1 ${!e.enabled ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                  {e.email}
                </span>
                {role === 'admin' && (
                  <>
                    <button
                      onClick={() => handleToggleEmail(e.id)}
                      className={`text-xs px-2 py-0.5 rounded ${
                        e.enabled
                          ? 'bg-green-100 text-green-600'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {e.enabled ? '활성' : '비활성'}
                    </button>
                    <button
                      onClick={() => handleDeleteEmail(e.id)}
                      className="text-xs px-2 py-0.5 bg-red-50 text-red-500 rounded hover:bg-red-100"
                    >
                      삭제
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
        {role === 'admin' && (
          <div className="flex gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddEmail()}
              placeholder="이메일 추가..."
              className="flex-1 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleAddEmail}
              disabled={addingEmail}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              추가
            </button>
          </div>
        )}
      </div>

      {/* Thresholds */}
      <div>
        <div className="text-sm font-medium text-gray-700 mb-2">임계값 (%)</div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          {['cpu', 'memory', 'disk'].map((key) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 mb-1 capitalize">{key}</label>
              <input
                type="number"
                min={1}
                max={100}
                value={thresholds[key]}
                onChange={(e) =>
                  setThresholds({ ...thresholds, [key]: parseInt(e.target.value) || 90 })
                }
                disabled={role !== 'admin'}
                className="w-full border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>
          ))}
        </div>
        {role === 'admin' && (
          <button
            onClick={handleSaveThresholds}
            disabled={saving}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '임계값 저장'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function AlertConfig() {
  const [configs, setConfigs] = useState([]);
  const [vmCustomers, setVmCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [adding, setAdding] = useState(false);
  const role = localStorage.getItem('role');

  const load = async () => {
    setLoading(true);
    try {
      const [data, customers] = await Promise.all([
        api.getAlertConfigs(),
        api.getVmCustomers(),
      ]);
      setConfigs(data || []);
      setVmCustomers(customers || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const configuredIds = new Set(configs.map((c) => c.customer_id));
  const availableCustomers = vmCustomers.filter(
    (id) => !configuredIds.has(id) && id.toLowerCase().includes(search.toLowerCase())
  );

  const handleAddCustomer = async (customerId) => {
    setAdding(true);
    try {
      await api.updateAlertConfig(customerId, { thresholds: { cpu: 90, memory: 90, disk: 90 } });
      setSearch('');
      setShowDropdown(false);
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">알람 설정</h1>
        <button onClick={load} className="text-sm text-blue-600 hover:underline">새로고침</button>
      </div>

      {role === 'admin' && (
        <div className="bg-white rounded-xl shadow p-4 mb-6">
          <div className="text-sm font-medium text-gray-700 mb-2">고객사 추가</div>
          <div className="relative">
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="고객사 검색 (VictoriaMetrics 등록 목록)"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {showDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {availableCustomers.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-400">
                    {vmCustomers.length === 0 ? '데이터 없음 (에이전트 미연결)' : '모든 고객사가 이미 추가됨'}
                  </div>
                ) : (
                  availableCustomers.map((id) => (
                    <button
                      key={id}
                      onMouseDown={() => handleAddCustomer(id)}
                      disabled={adding}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 text-gray-700"
                    >
                      {id}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-500 py-12">로딩 중...</div>
      ) : configs.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-12 text-center text-gray-500">
          알람 설정된 고객사가 없습니다. 위에서 고객사를 추가하세요.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {configs.map((c) => (
            <CustomerAlertPanel key={c.customer_id} config={c} onRefresh={load} />
          ))}
        </div>
      )}
    </div>
  );
}
