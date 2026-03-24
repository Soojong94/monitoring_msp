import React, { useState } from 'react';
import { api } from '../api.js';

const MODES = [
  { value: 'direct', label: 'Direct (인터넷 가능)' },
  { value: 'relay-agent', label: 'Relay Agent (내부망)' },
  { value: 'relay-server', label: 'Relay Server (게이트웨이)' },
];

export default function InstallCommand() {
  const [form, setForm] = useState({
    customer_id: '',
    server_name: '',
    csp: 'onprem',
    region: 'kr',
    environment: 'prod',
    mode: 'direct',
    relay_url: '',
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState('');

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleGenerate = async () => {
    if (!form.customer_id || !form.server_name) return;
    setLoading(true);
    try {
      const data = await api.generateCommand(form);
      setResult(data);
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">에이전트 설치 명령어 생성기</h2>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">고객사 ID *</label>
          <input
            name="customer_id"
            value={form.customer_id}
            onChange={handleChange}
            placeholder="kt, skt, naver..."
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">서버명 *</label>
          <input
            name="server_name"
            value={form.server_name}
            onChange={handleChange}
            placeholder="web-01, db-master..."
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">모드</label>
          <select
            name="mode"
            value={form.mode}
            onChange={handleChange}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">환경</label>
          <select
            name="environment"
            value={form.environment}
            onChange={handleChange}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="prod">prod</option>
            <option value="staging">staging</option>
            <option value="dev">dev</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">CSP</label>
          <input
            name="csp"
            value={form.csp}
            onChange={handleChange}
            placeholder="kt, aws, naver, onprem..."
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">리전</label>
          <input
            name="region"
            value={form.region}
            onChange={handleChange}
            placeholder="kr, ap-northeast-2..."
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {form.mode === 'relay-agent' && (
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Relay URL</label>
            <input
              name="relay_url"
              value={form.relay_url}
              onChange={handleChange}
              placeholder="http://10.0.1.5:9999/api/v1/metrics/write"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading || !form.customer_id || !form.server_name}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? '생성 중...' : '명령어 생성'}
      </button>

      {result && (
        <div className="mt-6 space-y-4">
          {[
            { key: 'linux', label: 'Linux (Bash)', lang: 'bash' },
            { key: 'windows', label: 'Windows (PowerShell)', lang: 'powershell' },
          ].map(({ key, label }) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700">{label}</span>
                <button
                  onClick={() => copyToClipboard(result[key], key)}
                  className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-600"
                >
                  {copied === key ? '✓ 복사됨' : '복사'}
                </button>
              </div>
              <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs overflow-x-auto whitespace-pre-wrap">
                {result[key]}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
