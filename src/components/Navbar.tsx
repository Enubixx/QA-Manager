import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, WifiOff, RefreshCw, Download, MoreHorizontal, FileJson, Upload, Trash2, AlertTriangle, X, RotateCcw } from 'lucide-react';
import { onQueueCountChange } from '../services/offlineSyncQueue';
import { APK_DOWNLOAD_URL, APP_VERSION_NAME } from '../constants';
import { RecentlyDeletedEntry } from '../utils/undoDeleteStore';

interface NavbarProps {
  currentView: 'dashboard' | 'mobile' | 'plan-builder';
  onNavigate: (view: 'dashboard' | 'mobile' | 'plan-builder') => void;
  activePlanName?: string;
  onExportBackup?: () => void;
  onImportBackup?: (data: any) => void;
  onClearAllData?: () => void;
  recentlyDeletedItems?: RecentlyDeletedEntry[];
  onRestoreDeletedItem?: (entryId: string) => void;
  onOpenRecentlyDeleted?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onNavigate,
  onExportBackup,
  onImportBackup,
  onClearAllData,
  recentlyDeletedItems = [],
  onRestoreDeletedItem,
  onOpenRecentlyDeleted,
}) => {
  const [pendingCount, setPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [recentlyDeletedOpen, setRecentlyDeletedOpen] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [menuOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImportBackup) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(String(event.target?.result || ''));
        onImportBackup(parsed);
      } catch {
        alert('Failed to parse JSON file. Please select a valid QA Manager backup JSON.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <header className="bg-[#0b0f19]/90 backdrop-blur-xl border-b border-slate-800/80 sticky top-0 z-50" data-testid="app-navbar">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between gap-3">
        {/* Brand & Live Sync Indicator */}
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
          className="flex items-center gap-2.5 cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-xl"
        >
          <div className="p-1.5 bg-blue-600 rounded-xl text-white shadow-sm border border-blue-500/40 transition-transform duration-200 group-hover:scale-105">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-bold text-sm text-slate-50 tracking-tight">QA Manager</h1>
            {!isOnline ? (
              <span data-testid="navbar-sync-status" className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 backdrop-blur-md">
                <WifiOff className="w-3 h-3 text-amber-400" /> Offline {pendingCount > 0 ? `(${pendingCount} pending)` : ''}
              </span>
            ) : pendingCount > 0 ? (
              <span data-testid="navbar-sync-status" className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 backdrop-blur-md animate-pulse">
                <RefreshCw className="w-3 h-3 animate-spin text-blue-400" /> Syncing ({pendingCount})
              </span>
            ) : (
              <span data-testid="navbar-sync-status" className="text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider backdrop-blur-md flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Sync
              </span>
            )}
          </div>
        </div>

        {/* Right side: APK download & Data menu */}
        <div className="flex items-center gap-2">
          <a
            href={APK_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            data-testid="navbar-apk-link"
            className="px-3 py-1.5 bg-slate-800/90 hover:bg-slate-700 text-slate-100 rounded-xl text-xs font-semibold transition border border-slate-700/80 flex items-center gap-1.5 active:scale-95"
            title={`Download the latest QA Tester Android app (v${APP_VERSION_NAME}) from Google Drive`}
          >
            <Download className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">Download</span> APK v{APP_VERSION_NAME}
          </a>

          {(onExportBackup || onImportBackup || onClearAllData) && (
            <div className="relative" ref={menuRef}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".json"
                className="hidden"
                data-testid="navbar-import-input"
              />
              <button
                type="button"
                data-testid="data-menu-button"
                aria-label="Data menu"
                title="Backup & Data Options"
                onClick={() => setMenuOpen(v => !v)}
                className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 transition cursor-pointer"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {menuOpen && (
                <div
                  data-testid="data-menu-dropdown"
                  className="absolute right-0 mt-1.5 w-56 rounded-xl bg-[#0e1526] border border-slate-700/90 shadow-2xl py-1.5 z-50 text-xs"
                >
                  {onExportBackup && (
                    <button
                      type="button"
                      data-testid="data-menu-export"
                      onClick={() => {
                        setMenuOpen(false);
                        onExportBackup();
                      }}
                      className="w-full px-3 py-2 text-left text-slate-200 hover:bg-[#13203a] hover:text-white flex items-center gap-2 transition cursor-pointer"
                    >
                      <FileJson className="w-3.5 h-3.5 text-blue-400" />
                      <span>Export backup (JSON)</span>
                    </button>
                  )}
                  {onImportBackup && (
                    <button
                      type="button"
                      data-testid="data-menu-import"
                      onClick={() => {
                        setMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className="w-full px-3 py-2 text-left text-slate-200 hover:bg-[#13203a] hover:text-white flex items-center gap-2 transition cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Import backup (JSON)</span>
                    </button>
                  )}
                  {onRestoreDeletedItem && (
                    <button
                      type="button"
                      data-testid="data-menu-recently-deleted"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenRecentlyDeleted?.();
                        setRecentlyDeletedOpen(true);
                      }}
                      className="w-full px-3 py-2 text-left text-slate-200 hover:bg-[#13203a] hover:text-white flex items-center justify-between gap-2 transition cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                        <span>Recently deleted</span>
                      </span>
                      {recentlyDeletedItems.length > 0 && (
                        <span
                          data-testid="recently-deleted-count"
                          className="px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700"
                        >
                          {recentlyDeletedItems.length}
                        </span>
                      )}
                    </button>
                  )}
                  {onClearAllData && (
                    <>
                      <div className="my-1 border-t border-slate-800" />
                      <button
                        type="button"
                        data-testid="data-menu-clear"
                        onClick={() => {
                          setMenuOpen(false);
                          setClearConfirmText('');
                          setClearModalOpen(true);
                        }}
                        className="w-full px-3 py-2 text-left text-rose-300 hover:bg-rose-950/40 hover:text-rose-200 flex items-center gap-2 transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                        <span>Clear all data</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Strong Confirmation Modal for Clear All Data */}
      {clearModalOpen && (
        <div
          data-testid="clear-all-modal"
          onClick={() => setClearModalOpen(false)}
          className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-[#111827] border border-slate-700 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Clear All Local QA Data</h3>
                  <p className="text-[11px] text-slate-400">Local browser reset (does not wipe cloud database)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setClearModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-2 leading-relaxed bg-[#0b0f19] border border-slate-800 rounded-xl p-3">
              <p>
                This will clear all QA state and localStorage keys in this browser:
              </p>
              <ul className="list-disc list-inside text-[11px] text-slate-400 space-y-0.5">
                <li>Test plans, active test runs, and archived runs</li>
                <li>Bug logs and local triage categorizations</li>
                <li>Devices, testers, and populated features/devices lists</li>
              </ul>
              <p className="text-[11px] text-amber-300/90 pt-1">
                Shared production cloud rows are not deleted by this action. Export a JSON backup first if you have unsynced local work.
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                Type <span className="font-mono font-bold text-rose-400">DELETE</span> to confirm:
              </label>
              <input
                type="text"
                data-testid="clear-all-confirm-input"
                value={clearConfirmText}
                onChange={e => setClearConfirmText(e.target.value)}
                placeholder="Type DELETE"
                className="w-full bg-[#0b0f19] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-rose-500"
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setClearModalOpen(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="clear-all-confirm-submit"
                disabled={clearConfirmText.trim() !== 'DELETE'}
                onClick={() => {
                  if (clearConfirmText.trim() !== 'DELETE') return;
                  onClearAllData?.();
                  setClearModalOpen(false);
                  setClearConfirmText('');
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white border border-rose-500 cursor-pointer"
              >
                Clear all data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recently Deleted Modal (7-day local retention) */}
      {recentlyDeletedOpen && (
        <div
          data-testid="recently-deleted-modal"
          onClick={() => setRecentlyDeletedOpen(false)}
          onKeyDown={e => {
            if (e.key === 'Escape') setRecentlyDeletedOpen(false);
          }}
          tabIndex={-1}
          className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-[#111827] border border-slate-700 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl max-h-[80vh] flex flex-col"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Recently Deleted</h3>
                  <p className="text-[11px] text-slate-400">
                    Items deleted in this browser in the last 7 days
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="recently-deleted-close"
                onClick={() => setRecentlyDeletedOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 min-h-[120px] pr-1">
              {recentlyDeletedItems.length === 0 ? (
                <div
                  data-testid="recently-deleted-empty"
                  className="bg-[#0b0f19] border border-slate-800 rounded-xl p-6 text-center text-xs text-slate-400"
                >
                  No recently deleted items in the last 7 days.
                </div>
              ) : (
                recentlyDeletedItems.map(item => {
                  const typeLabel =
                    item.type === 'plan'
                      ? 'Test Plan'
                      : item.type === 'run'
                      ? 'Test Run'
                      : item.type === 'bug'
                      ? 'Bug'
                      : item.type === 'device'
                      ? 'Device'
                      : 'Tester';
                  const deletedDate = new Date(item.deletedAt);
                  const deletedTimeStr = !isNaN(deletedDate.getTime())
                    ? deletedDate.toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : item.deletedAt;
                  return (
                    <div
                      key={item.id}
                      data-testid="recently-deleted-row"
                      data-deleted-id={item.id}
                      data-deleted-type={item.type}
                      className="bg-[#0b0f19] border border-slate-800 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono text-[10px] font-semibold uppercase shrink-0">
                            {typeLabel}
                          </span>
                          <span className="font-semibold text-slate-100 truncate" title={item.label}>
                            {item.label}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          Deleted {deletedTimeStr}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="recently-deleted-restore"
                        onClick={() => onRestoreDeletedItem?.(item.id)}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs border border-blue-500 transition cursor-pointer shrink-0"
                      >
                        Restore
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-end pt-1">
              <button
                type="button"
                onClick={() => setRecentlyDeletedOpen(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
