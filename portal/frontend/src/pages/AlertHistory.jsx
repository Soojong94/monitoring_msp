import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

const STATUS_STYLE = {
  firing: 'bg-red-100 text-red-700',
  resolved: 'bg-green-100 text-green-700',
};

const SEVERITY_STYLE = {
  critical: 'bg-red-500 text-white',
  warning: 'bg-yellow-400 text-white',
};

function fmt(iso) {
  if (!iso || iso.startsWith('0001')) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  } catch {
    return iso;
  }
}

export default function AlertHistory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState([]);

  const [filters, setFilters] = useState({
    customer_id: '',
    server_name: '',
    status: '',
    from_date: '',
    to_date: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAlertHistory(filters);
      setRows(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
    api.getVmCustomers().then(setCustomers).catch(() => {});
  }, []);

  const handleFilter = (e) => {
    e.preventDefault();
    load();
  };

  const clearFilters = () => {
    setFilters({ customer_id: '', server_name: '', status: '', from_date: '', to_date: '' });
  };

  const firingCount = rows.filter((r) => r.status === 'firing').length;
  const resolvedCount = rows.filter((r) => r.status === 'resolved').length;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">알람 이력</h1>
        <p className="text-sm text-gray-500 mt-1">alertmanager가 수신한 알람의 발생/해소 이력</p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-gray-500">전체</div>
          <div className="text-2xl font-bold text-gray-800">{rows.length}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-red-500">발생 중</div>
          <div className="text-2xl font-bold text-red-600">{firingCount}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-green-500">해소됨</div>
          <div className="text-2xl font-bold text-green-600">{resolvedCount}</div>
        </div>
      </div>

      {/* 필터 */}
      <form onSubmit={handleFilter} className="bg-white rounded-lg border p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">고객사</label>
          <select
            value={filters.customer_id}
            onChange={(e) => setFilters((f) => ({ ...f, customer_id: e.target.value }))}
            className="border rounded px-2 py-1.5 text-sm w-36"
          >
            <option value="">전체</option>
            {customers.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">서버명</label>
          <input
            type="text"
            value={filters.server_name}
            onChange={(e) => setFilters((f) => ({ ...f, server_name: e.target.value }))}
            placeholder="server-01"
            className="border rounded px-2 py-1.5 text-sm w-32"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">상태</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="border rounded px-2 py-1.5 text-sm w-28"
          >
            <option value="">전체</option>
            <option value="firing">발생 중</option>
            <option value="resolved">해소됨</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">시작일</label>
          <input
            type="date"
            value={filters.from_date}
            onChange={(e) => setFilters((f) => ({ ...f, from_date: e.target.value }))}
            className="border rounded px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">종료일</label>
          <input
            type="date"
            value={filters.to_date}
            onChange={(e) => setFilters((f) => ({ ...f, to_date: e.target.value }))}
            className="border rounded px-2 py-1.5 text-sm"
          />
        </div>
        <button type="submit" className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
          조회
        </button>
        <button type="button" onClick={clearFilters} className="px-4 py-1.5 bg-gray-100 text-gray-600 text-sm rounded hover:bg-gray-200">
          초기화
        </button>
      </form>

      {/* 테이블 */}
      <div className="bg-white rounded-lg border overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">불러오는 중...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-gray-400">알람 이력이 없습니다.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase border-b">
              <tr>
                <th className="px-4 py-3 text-left">고객사</th>
                <th className="px-4 py-3 text-left">서버</th>
                <th className="px-4 py-3 text-left">알람명</th>
                <th className="px-4 py-3 text-left">심각도</th>
                <th className="px-4 py-3 text-left">상태</th>
                <th className="px-4 py-3 text-left">발생 시각</th>
                <th className="px-4 py-3 text-left">해소 시각</th>
                <th className="px-4 py-3 text-left">메시지</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{r.customer_id || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{r.server_name || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{r.alert_name || '-'}</td>
                  <td className="px-4 py-3">
                    {r.severity ? (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_STYLE[r.severity] || 'bg-gray-200 text-gray-600'}`}>
                        {r.severity}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[r.status] || 'bg-gray-100 text-gray-600'}`}>
                      {r.status === 'firing' ? '발생 중' : r.status === 'resolved' ? '해소됨' : r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmt(r.started_at)}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmt(r.resolved_at)}</td>
                  <td className="px-4 py-3 text-gray-400 max-w-xs truncate" title={r.message}>{r.message || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
