import React, { useState, useEffect } from 'react';
import { ShieldCheck, WifiOff, RefreshCw, Download } from 'lucide-react';
import { onQueueCountChange } from '../services/offlineSyncQueue';

interface NavbarProps {
  currentView: 'dashboard' | 'mobile' | 'plan-builder';
  onNavigate: (view: 'dashboard' | 'mobile' | 'plan-builder') => void;
  activePlanName?: string;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, onNavigate }) => {
  const [pendingCount, setPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const unsub = onQueueCountChange(setPendingCount);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      unsub();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <header className="bg-slate-950/60 backdrop-blur-2xl border-b border-white/10 sticky top-0 z-50 shadow-2xl shadow-black/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand & System Title */}
        <div className="flex items-center gap-3 cursor-pointer group" onClick={() => onNavigate('dashboard')}>
          <div className="p-2.5 bg-gradient-to-br from-indigo-500/80 via-purple-500/80 to-pink-500/80 rounded-2xl text-white shadow-xl shadow-purple-500/20 border border-white/20 transition-transform duration-300 group-hover:scale-105">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-base text-white flex items-center gap-2 tracking-tight">
              QA Manager
              {!isOnline ? (
                <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 backdrop-blur-md">
                  <WifiOff className="w-3 h-3 text-amber-400" /> Offline {pendingCount > 0 ? `(${pendingCount} pending)` : ''}
                </span>
              ) : pendingCount > 0 ? (
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 backdrop-blur-md animate-pulse">
                  <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" /> Syncing ({pendingCount})
                </span>
              ) : (
                <span className="text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider backdrop-blur-md flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Sync
                </span>
              )}
            </h1>
            <p className="text-xs text-slate-400 font-medium">Field QA Management & Execution System</p>
          </div>
        </div>

        {/* Right side APK download & navigation */}
        <div className="flex items-center gap-3">
          <a
            href="/QA_Field_Tester_v2.0.apk"
            download="QA_Field_Tester_v2.0.apk"
            className="px-3 py-1.5 bg-gradient-to-r from-emerald-600/90 to-teal-600/90 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-500/20 border border-emerald-400/30 flex items-center gap-1.5 active:scale-95"
            title="Download latest QA Field Tester Android APK (v2.0)"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Download</span> APK v2.0
          </a>
        </div>

      </div>
    </header>
  );
};
