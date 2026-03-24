import React from 'react';

export default function AlertBadge({ count }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold bg-red-500 text-white rounded-full">
      {count}
    </span>
  );
}
