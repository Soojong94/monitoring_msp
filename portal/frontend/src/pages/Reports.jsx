import React, { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function Reports() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
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

  const handleDownload = async () => {
    if (!customerId) return;
    setLoading(true);
    setError('');
    try {
      await api.downloadMonthlyReport(customerId, year, month);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const years = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) years.push(y);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">월간 보고서</h1>
        <p className="text-sm text-gray-500 mt-1">고객사별 CPU·메모리·디스크·네트워크 I/O 월간 데이터를 Excel로 다운로드</p>
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

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">연도</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {years.map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">월</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}

          <button
            onClick={handleDownload}
            disabled={loading || !customerId}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="animate-spin">⏳</span> 생성 중... (최대 30초)
              </>
            ) : (
              '📥 Excel 다운로드'
            )}
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
