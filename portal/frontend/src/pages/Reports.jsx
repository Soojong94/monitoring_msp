import React, { useState, useEffect } from 'react';
import { api } from '../api.js';

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

export default function Reports() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [fromDate, setFromDate] = useState(toDateStr(firstOfMonth));
  const [toDate, setToDate] = useState(toDateStr(now));
  const [customerId, setCustomerId] = useState('');
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getVmCustomers()
      .then((list) => {
        setCustomers(list || []);
        if (list && list.length > 0) setCustomerId(list[0]);
      })
      .catch(() => {});
  }, []);

  const setPreset = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days + 1);
    setFromDate(toDateStr(start));
    setToDate(toDateStr(end));
  };

  const setPresetMonth = (offsetMonths) => {
    const d = new Date();
    d.setMonth(d.getMonth() + offsetMonths);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    setFromDate(toDateStr(start));
    setToDate(toDateStr(end));
  };

  const handleDownload = async () => {
    if (!customerId || !fromDate || !toDate) return;
    if (fromDate > toDate) { setError('시작일이 종료일보다 늦을 수 없습니다.'); return; }
    setLoading(true);
    setError('');
    try {
      await api.downloadReport(customerId, fromDate, toDate);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">보고서</h1>
        <p className="text-sm text-gray-500 mt-1">고객사별 CPU·메모리·디스크·네트워크 I/O 데이터를 Excel로 다운로드</p>
      </div>

      <div className="bg-white rounded-xl shadow p-6 max-w-lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">고객사</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {customers.length === 0 ? (
                <option value="">데이터 없음</option>
              ) : (
                customers.map((c) => <option key={c} value={c}>{c}</option>)
              )}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">기간</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                { label: '이번 달', action: () => setPresetMonth(0) },
                { label: '지난 달', action: () => setPresetMonth(-1) },
                { label: '최근 7일', action: () => setPreset(7) },
                { label: '최근 30일', action: () => setPreset(30) },
                { label: '최근 90일', action: () => setPreset(90) },
              ].map(({ label, action }) => (
                <button
                  key={label}
                  type="button"
                  onClick={action}
                  className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-blue-50 hover:text-blue-600"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-3 items-center">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-gray-400 text-sm">~</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}

          <button
            onClick={handleDownload}
            disabled={loading || !customerId || !fromDate || !toDate}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? '생성 중... (최대 60초)' : '📥 Excel 다운로드'}
          </button>
        </div>

        <div className="mt-6 border-t pt-4">
          <div className="text-xs text-gray-500 font-medium mb-2">포함 데이터 (일별 평균/최대)</div>
          <div className="grid grid-cols-2 gap-1 text-xs text-gray-400">
            <span>· CPU 사용률 (%)</span>
            <span>· 메모리 사용률 (%)</span>
            <span>· 디스크 사용률 (%)</span>
            <span>· 네트워크 수신 (MB/s)</span>
            <span>· 네트워크 송신 (MB/s)</span>
            <span>· 디스크 읽기 (MB/s)</span>
            <span>· 디스크 쓰기 (MB/s)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
