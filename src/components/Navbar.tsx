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
    <header className="bg-[#0b0f19]/90 backdrop-blur-xl border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand & System Title */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Go to QA Manager Dashboard"
          onClick={() => onNavigate('dashboard')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onNavigate('dashboard');
            }
          }}
          className="flex items-center gap-3 cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-2xl"
        >
          <div className="p-2.5 bg-blue-600 rounded-2xl text-white shadow-sm border border-blue-500/40 transition-transform duration-200 group-hover:scale-105">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-base text-slate-50 flex items-center gap-2 tracking-tight">
              QA Manager
              {!isOnline ? (
                <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 backdrop-blur-md">
                  <WifiOff className="w-3 h-3 text-amber-400" /> Offline {pendingCount > 0 ? `(${pendingCount} pending)` : ''}
                </span>
              ) : pendingCount > 0 ? (
                <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 backdrop-blur-md animate-pulse">
                  <RefreshCw className="w-3 h-3 animate-spin text-blue-400" /> Syncing ({pendingCount})
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
            href="https://drive.google.com/file/d/15qrnpJExF8siPcuTBy6wTIBk33racp3_/view?usp=drivesdk&resourcekey=0-6Th_JDrG2WzhwHfRB9YMcw"
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-2xl text-xs font-semibold transition border border-slate-700 flex items-center gap-1.5 active:scale-95"
            title="Download the latest QA Tester Android app (v2.6.0) from Google Drive"
          >
            <Download className="w-3.5 h-3.5 text-slate-300" />
            <span className="hidden sm:inline">Download</span> APK v2.6
          </a>
        </div>

      </div>
    </header>
  );
};
