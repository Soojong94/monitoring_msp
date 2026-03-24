import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import StatusDot from '../components/StatusDot.jsx';
import AlertBadge from '../components/AlertBadge.jsx';

function SummaryCard({ label, value, color = 'text-gray-800' }) {
  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="text-sm text-gray-500 mb-1">{label}</div>
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function groupByCustomer(servers) {
  const groups = {};
  for (const s of servers) {
    const cid = s.customer_id;
    if (!groups[cid]) groups[cid] = { customer_id: cid, display_customer: s.display_customer, servers: [] };
    groups[cid].servers.push(s);
  }
  return Object.values(groups);
}

export default function Dashboard() {
  const [servers, setServers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [sv, al] = await Promise.all([api.getServers(), api.getFiringAlerts()]);
      setServers(sv || []);
      setAlerts(al || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const customers = groupByCustomer(servers);
  const totalCustomers = customers.length;
  const totalServers = servers.length;
  const offlineServers = servers.filter((s) => !s.online && !s.inactive).length;
  const firingAlerts = alerts.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        로딩 중...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">대시보드</h1>
        <button onClick={load} className="text-sm text-blue-600 hover:underline">새로고침</button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard label="고객사" value={totalCustomers} />
        <SummaryCard label="전체 서버" value={totalServers} />
        <SummaryCard label="오프라인" value={offlineServers} color={offlineServers > 0 ? 'text-red-600' : 'text-gray-800'} />
        <SummaryCard label="발생 알람" value={firingAlerts} color={firingAlerts > 0 ? 'text-orange-600' : 'text-gray-800'} />
      </div>

      {/* Customer cards */}
      <div>
        <h2 className="text-lg font-semibold text-gray-700 mb-3">고객사별 현황</h2>
        {customers.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-8 text-center text-gray-500">
            등록된 서버가 없습니다. 에이전트를 설치하면 자동으로 나타납니다.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {customers.map((c) => {
              const online = c.servers.filter((s) => s.online).length;
              const offline = c.servers.filter((s) => !s.online && !s.inactive).length;
              const alertCount = alerts.filter((a) => a.customer_id === c.customer_id).length;

              return (
                <div key={c.customer_id} className="bg-white rounded-xl shadow p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="font-semibold text-gray-800">
                        {c.display_customer || c.customer_id}
                      </div>
                      <div className="text-xs text-gray-400">{c.customer_id}</div>
                    </div>
                    <AlertBadge count={alertCount} />
                  </div>

                  <div className="space-y-2">
                    {c.servers.map((s) => (
                      <div key={s.server_name} className="flex items-center gap-2 text-sm">
                        <StatusDot online={s.online} inactive={s.inactive} />
                        <span className="text-gray-700">{s.display_server || s.server_name}</span>
                        {s.last_seen && (
                          <span className="text-xs text-gray-400 ml-auto">
                            {new Date(s.last_seen).toLocaleString('ko-KR', {
                              month: '2-digit', day: '2-digit',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-500">
                    <span>🟢 {online} 온라인</span>
                    {offline > 0 && <span className="text-red-500">🔴 {offline} 오프라인</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Firing alerts table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-700">
            발생 중인 알람
            {alerts.length > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-600 text-sm rounded-full font-normal">
                {alerts.length}
              </span>
            )}
          </h2>
          <a href="/alert-history" className="text-sm text-blue-600 hover:underline">전체 이력 →</a>
        </div>
        <div className="bg-white rounded-xl shadow overflow-hidden">
          {alerts.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-400 text-sm">현재 발생 중인 알람이 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">고객사</th>
                  <th className="px-4 py-3 text-left">서버</th>
                  <th className="px-4 py-3 text-left">알람</th>
                  <th className="px-4 py-3 text-left">심각도</th>
                  <th className="px-4 py-3 text-left">발생 시간</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {alerts.map((a, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{a.customer_id}</td>
                    <td className="px-4 py-3">{a.server_name}</td>
                    <td className="px-4 py-3 font-medium">{a.alert_name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        a.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {a.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {a.starts_at ? new Date(a.starts_at).toLocaleString('ko-KR') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
