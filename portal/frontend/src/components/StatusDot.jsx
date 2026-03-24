import React from 'react';

export default function StatusDot({ online, inactive }) {
  if (inactive) {
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-400" title="비활성" />;
  }
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`}
      title={online ? '온라인' : '오프라인'}
    />
  );
}
