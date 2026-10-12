import React from 'react';
import { formatFileSize } from '@hooks/useFileManager';

interface StorageIndicatorProps {
  storageInfo: { quota: string; used: string; remaining: string } | null;
}

export const StorageIndicator: React.FC<StorageIndicatorProps> = ({ storageInfo }) => {
  if (!storageInfo) return null;

  const quota = parseInt(storageInfo.quota, 10);
  const used = parseInt(storageInfo.used, 10);
  const remaining = parseInt(storageInfo.remaining, 10);
  const usagePercent = quota > 0 ? (used / quota) * 100 : 0;

  const getProgressColor = (percent: number) => {
    if (percent >= 90) return 'bg-red-500';
    if (percent >= 70) return 'bg-yellow-500';
    return 'bg-blue-500';
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Storage Usage</h3>
      
      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Used</span>
            <span className="font-medium text-gray-900">{formatFileSize(used)}</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${getProgressColor(usagePercent)}`}
              style={{ width: `${Math.min(usagePercent, 100)}%` }}
              role="progressbar"
              aria-valuenow={Math.round(usagePercent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Storage usage"
            ></div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-2xl font-bold text-gray-900">{formatFileSize(quota)}</p>
            <p className="text-xs text-gray-500">Total</p>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-2xl font-bold text-gray-900">{formatFileSize(used)}</p>
            <p className="text-xs text-gray-500">Used</p>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-2xl font-bold text-gray-900">{formatFileSize(remaining)}</p>
            <p className="text-xs text-gray-500">Free</p>
          </div>
        </div>

        <p className="text-sm text-gray-500 text-center">
          {Math.round(usagePercent)}% used
        </p>
      </div>
    </div>
  );
};