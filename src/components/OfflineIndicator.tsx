import React from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 md:bottom-4 left-4 right-4 sm:right-auto z-40 flex items-center gap-2 rounded-xl bg-amber-600/95 backdrop-blur-xs px-4 py-2.5 text-xs font-semibold text-white shadow-lg border border-amber-500">
      <WifiOff className="w-4 h-4 text-white shrink-0" />
      <span>คุณกำลังออฟไลน์ — ระบบยังคงใช้งานข้อมูล SQLite ในเครื่องได้ปกติ</span>
    </div>
  );
};
