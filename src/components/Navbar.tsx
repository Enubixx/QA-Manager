import React from 'react';
import { ShieldCheck } from 'lucide-react';

interface NavbarProps {
  currentView: 'dashboard' | 'mobile' | 'plan-builder';
  onNavigate: (view: 'dashboard' | 'mobile' | 'plan-builder') => void;
  activePlanName?: string;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, onNavigate }) => {
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
              QA Flow Studio
              <span className="text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider backdrop-blur-md">Live Sync</span>
            </h1>
            <p className="text-xs text-slate-400 font-medium">Dataset & Sequential Mobile QA Tester</p>
          </div>
        </div>

      </div>
    </header>
  );
};
