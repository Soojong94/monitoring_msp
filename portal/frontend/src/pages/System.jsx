import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function StatusBadge({ running }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        running ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-green-500' : 'bg-red-500'}`} />
      {running ? 'Running' : 'Stopped'}
    </span>
  );
}

const SERVICE_LABELS = {
  'msp-victoriametrics': 'VictoriaMetrics',
  'msp-grafana': 'Grafana',
  'msp-alertmanager': 'Alertmanager',
  'msp-vmalert': 'VMAlert',
  'msp-nginx': 'Nginx',
  'msp-portal': 'Portal',
};

const RESTARTABLE_MAP = {
  'msp-victoriametrics': 'victoriametrics',
  'msp-grafana': 'grafana',
  'msp-alertmanager': 'alertmanager',
  'msp-vmalert': 'vmalert',
  'msp-nginx': 'nginx',
};

export default function System() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState({});
  const role = localStorage.getItem('role');

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getSystemStatus();
      setStatus(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRestart = async (containerName) => {
    const service = RESTARTABLE_MAP[containerName];
    if (!service) return;
    if (!confirm(`${SERVICE_LABELS[containerName]} 를 재시작하시겠습니까?`)) return;

    setRestarting((r) => ({ ...r, [containerName]: true }));
    try {
      await api.restartService(service);
      setTimeout(load, 3000);
    } catch (e) {
      alert(e.message);
    } finally {
      setRestarting((r) => ({ ...r, [containerName]: false }));
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-500">로딩 중...</div>;
  }

  const cert = status?.certificate;
  const certOk = cert && !cert.error && cert.days_left > 0;
  const certWarning = certOk && cert.days_left < 30;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">시스템 상태</h1>
        <button onClick={load} className="text-sm text-blue-600 hover:underline">새로고침</button>
      </div>

      {/* Containers */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-700">
          컨테이너 상태
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 bg-gray-50">
            <tr>
              <th className="px-5 py-2 text-left">서비스</th>
              <th className="px-5 py-2 text-left">상태</th>
              <th className="px-5 py-2 text-left">시작 시간</th>
              {role === 'admin' && <th className="px-5 py-2 text-right">액션</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(status?.containers || []).map((c) => (
              <tr key={c.name} className="hover:bg-gray-50">
                <td className="px-5 py-3 font-medium text-gray-800">
                  {SERVICE_LABELS[c.name] || c.name}
                </td>
                <td className="px-5 py-3">
                  <StatusBadge running={c.running} />
                  {c.error && (
                    <span className="ml-2 text-xs text-gray-400">({c.error})</span>
                  )}
                </td>
                <td className="px-5 py-3 text-gray-500 text-xs">
                  {c.started_at
                    ? new Date(c.started_at).toLocaleString('ko-KR', {
                        month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })
                    : '-'}
                </td>
                {role === 'admin' && (
                  <td className="px-5 py-3 text-right">
                    {RESTARTABLE_MAP[c.name] && (
                      <button
                        onClick={() => handleRestart(c.name)}
                        disabled={restarting[c.name]}
                        className="text-xs px-2 py-1 bg-orange-50 text-orange-600 rounded hover:bg-orange-100 disabled:opacity-50"
                      >
                        {restarting[c.name] ? '재시작 중...' : '재시작'}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Certificate */}
      <div className="bg-white rounded-xl shadow p-5">
        <div className="font-semibold text-gray-700 mb-3">TLS 인증서</div>
        {cert?.error ? (
          <div className="text-red-600 text-sm">{cert.error}</div>
        ) : (
          <div className="flex items-center gap-4">
            <div>
              <div className="text-sm text-gray-500">{cert?.hostname}</div>
              <div className="text-xs text-gray-400 mt-0.5">만료: {cert?.expires_at}</div>
            </div>
            <div className={`ml-auto text-lg font-bold ${
              !certOk ? 'text-red-600' : certWarning ? 'text-yellow-600' : 'text-green-600'
            }`}>
              {cert?.days_left != null ? `${cert.days_left}일 남음` : '-'}
            </div>
          </div>
        )}
      </div>

      {/* Storage */}
      {status?.storage && Object.keys(status.storage).length > 0 && (
        <div className="bg-white rounded-xl shadow p-5">
          <div className="font-semibold text-gray-700 mb-3">VictoriaMetrics 저장소</div>
          <pre className="text-xs text-gray-600 overflow-auto bg-gray-50 rounded-lg p-3">
            {JSON.stringify(status.storage, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
