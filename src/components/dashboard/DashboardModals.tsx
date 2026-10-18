import React from 'react';
import { createPortal } from 'react-dom';
import {
  Image as ImageIcon,
  X,
  CheckCircle2,
  Copy,
  Sparkles,
  RefreshCw,
  MessageSquareText,
  ExternalLink,
  ClipboardPaste
} from 'lucide-react';
import {
  getStoredGeminiApiKey,
  saveGeminiApiKey,
  GEMINI_MODELS,
  getStoredGeminiModel,
  saveGeminiModel,
  discoverAvailableGeminiModels,
  rankModelsForSummaries,
  DEFAULT_GEMINI_MODEL,
  getGeminiKeyErrorHint
} from '../../services/geminiService';

const GEMINI_CHAT_URL = 'https://gemini.google.com/app';

export interface DashboardModalsProps {
  selectedImagePreviewUrl: string | null;
  setSelectedImagePreviewUrl: React.Dispatch<React.SetStateAction<string | null>>;
  copiedImage: boolean;
  setCopiedImage: React.Dispatch<React.SetStateAction<boolean>>;
  isApiKeyModalOpen: boolean;
  setIsApiKeyModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tempApiKey: string;
  setTempApiKey: React.Dispatch<React.SetStateAction<string>>;
  tempModel: string;
  setTempModel: React.Dispatch<React.SetStateAction<string>>;
  isTestingKey: boolean;
  setIsTestingKey: React.Dispatch<React.SetStateAction<boolean>>;
  testKeyStatus: { success: boolean; message: string; models?: string[] } | null;
  setTestKeyStatus: React.Dispatch<
    React.SetStateAction<{ success: boolean; message: string; models?: string[] } | null>
  >;
  reportDisclaimer: string;
  setReportDisclaimer: React.Dispatch<React.SetStateAction<string>>;
  openChatSummary: (notice?: string) => void;
  handleExecuteCopyReport: (
    skipKeyCheck?: boolean
  ) => Promise<{ plainText: string; htmlText: string } | null>;
  isChatSummaryOpen: boolean;
  setIsChatSummaryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  chatNotice: string | null;
  chatPromptCopied: boolean;
  handleCopyChatPrompt: () => Promise<boolean>;
  chatAutoOpenGemini: boolean;
  toggleChatAutoOpenGemini: (on: boolean) => void;
  handlePasteChatReplyFromClipboard: () => Promise<void>;
  chatReplyText: string;
  setChatReplyText: React.Dispatch<React.SetStateAction<string>>;
  chatStatus: { type: 'success' | 'error'; message: string } | null;
  setChatStatus: React.Dispatch<
    React.SetStateAction<{ type: 'success' | 'error'; message: string } | null>
  >;
  isGeneratingSummary: boolean;
  handleBuildReportFromChatReply: () => void;
  summaryToast: { type: 'success' | 'warning' | 'error'; message: string } | null;
}

export const DashboardModals: React.FC<DashboardModalsProps> = ({
  selectedImagePreviewUrl,
  setSelectedImagePreviewUrl,
  copiedImage,
  setCopiedImage,
  isApiKeyModalOpen,
  setIsApiKeyModalOpen,
  tempApiKey,
  setTempApiKey,
  tempModel,
  setTempModel,
  isTestingKey,
  setIsTestingKey,
  testKeyStatus,
  setTestKeyStatus,
  reportDisclaimer,
  setReportDisclaimer,
  openChatSummary,
  handleExecuteCopyReport,
  isChatSummaryOpen,
  setIsChatSummaryOpen,
  chatNotice,
  chatPromptCopied,
  handleCopyChatPrompt,
  chatAutoOpenGemini,
  toggleChatAutoOpenGemini,
  handlePasteChatReplyFromClipboard,
  chatReplyText,
  setChatReplyText,
  chatStatus,
  setChatStatus,
  isGeneratingSummary,
  handleBuildReportFromChatReply,
  summaryToast
}) => {
  return (
    <>
      {/* Image Lightbox Preview Modal via Dedicated Portal */}
      {selectedImagePreviewUrl &&
        createPortal(
          <div
            onClick={() => setSelectedImagePreviewUrl(null)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 9999999,
              backgroundColor: 'rgba(2, 6, 23, 0.96)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)'
            }}
          >
            {/* Top Bar - ALWAYS Visible at Top of Screen Viewport */}
            <div
              onClick={e => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: '1.25rem',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'calc(100vw - 2.5rem)',
                maxWidth: '1000px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                border: '1px solid rgba(51, 65, 85, 0.8)',
                borderRadius: '1rem',
                padding: '0.75rem 1.25rem',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.8)',
                zIndex: 10
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedImagePreviewUrl(null)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95 transition-all"
              >
                <span>← Back to Dashboard</span>
              </button>

              <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-blue-400" /> Bug Screenshot Preview
              </span>

              <button
                type="button"
                onClick={() => setSelectedImagePreviewUrl(null)}
                className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
                title="Close Preview (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Center Image Container - Absolutely positioned to prevent ANY auto-expansion */}
            <div
              onClick={e => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: '6rem',
                bottom: '6rem',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'calc(100vw - 2.5rem)',
                maxWidth: '1000px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#030712',
                borderRadius: '1.25rem',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                padding: '0.75rem',
                overflow: 'hidden',
                boxShadow: '0 20px 40px -10px rgba(0,0,0,0.9)'
              }}
            >
              <img
                src={selectedImagePreviewUrl}
                alt="Evidence Screenshot"
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                  borderRadius: '0.75rem',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.9)'
                }}
              />
            </div>

            {/* Bottom Bar - Pinned at Bottom of Screen Viewport */}
            <div
              onClick={e => e.stopPropagation()}
              style={{
                position: 'absolute',
                bottom: '1.25rem',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'calc(100vw - 2.5rem)',
                maxWidth: '1000px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                border: '1px solid rgba(51, 65, 85, 0.8)',
                borderRadius: '1rem',
                padding: '0.75rem 1.25rem',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.8)',
                zIndex: 10
              }}
            >
              <span className="text-xs text-slate-400 font-mono hidden sm:inline">
                Tap anywhere outside image or press Esc to close
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const img = new Image();
                      img.crossOrigin = 'anonymous';
                      img.src = selectedImagePreviewUrl;
                      await new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = reject;
                      });
                      const canvas = document.createElement('canvas');
                      canvas.width = img.naturalWidth || img.width;
                      canvas.height = img.naturalHeight || img.height;
                      const ctx = canvas.getContext('2d');
                      ctx?.drawImage(img, 0, 0);
                      canvas.toBlob(async blob => {
                        if (!blob) {
                          console.warn('Could not export image blob for clipboard.');
                          return;
                        }
                        if (navigator.clipboard && window.ClipboardItem) {
                          await navigator.clipboard.write([
                            new ClipboardItem({ 'image/png': blob })
                          ]);
                          setCopiedImage(true);
                          setTimeout(() => setCopiedImage(false), 2000);
                        }
                      }, 'image/png');
                    } catch (err) {
                      console.error('Failed to copy image to clipboard:', err);
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl border border-blue-500 cursor-pointer transition active:scale-95 flex items-center gap-1.5 shadow-sm"
                  title="Copy raw image to clipboard"
                >
                  {copiedImage ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                      <span className="text-emerald-200">Image Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-white" />
                      <span>Copy Image</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedImagePreviewUrl(null)}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl border border-slate-700 cursor-pointer transition active:scale-95"
                >
                  ← Back
                </button>
              </div>
            </div>
          </div>,
          document.getElementById('modal-portal') || document.body
        )}

      {/* Gemini AI Key Configuration Modal Portal */}
      {isApiKeyModalOpen &&
        createPortal(
          <div
            onClick={() => setIsApiKeyModalOpen(false)}
            className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md"
          >
            <div
              onClick={e => e.stopPropagation()}
              className="liquid-glass-panel rounded-3xl p-6 max-w-md w-full border border-slate-700 shadow-2xl bg-[#111827] space-y-4 text-left animate-in fade-in zoom-in-95 duration-200"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-blue-500/15 text-blue-300 rounded-xl border border-blue-500/30">
                    <Sparkles className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Gemini AI Summarization Key</h4>
                    <p className="text-[11px] text-slate-400 font-medium">
                      Power executive QA summaries with Gemini
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsApiKeyModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-slate-300 leading-relaxed space-y-2">
                <p>
                  To generate accurate executive defect summaries without conversational noise, enter your Gemini API Key.
                </p>
                <p className="text-[11px] text-slate-400">
                  Keys are stored locally in your browser (
                  <code className="text-blue-300 font-mono">localStorage</code>). You can generate a free key at{' '}
                  <a
                    href="https://aistudio.google.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 underline font-semibold hover:text-blue-300"
                  >
                    Google AI Studio
                  </a>
                  .
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setIsApiKeyModalOpen(false);
                    openChatSummary();
                  }}
                  className="text-[11px] text-blue-300 hover:text-blue-200 font-semibold underline underline-offset-2 transition"
                >
                  Can't get a key? Summarize with an AI chat instead →
                </button>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-300">Gemini API Key</label>
                  <button
                    type="button"
                    disabled={isTestingKey || !tempApiKey.trim()}
                    onClick={async () => {
                      if (!tempApiKey.trim()) return;
                      setIsTestingKey(true);
                      setTestKeyStatus(null);
                      try {
                        const res = await discoverAvailableGeminiModels(tempApiKey.trim());
                        if (res.success && res.models.length > 0) {
                          // Only text models that can write summaries, best first (no TTS/image/retired models)
                          const ranked = rankModelsForSummaries(res.models);
                          const keepCurrent = ranked.includes(tempModel.trim());
                          const chosen = keepCurrent ? tempModel.trim() : ranked[0];
                          setTestKeyStatus({
                            success: true,
                            message: chosen
                              ? `✅ Key verified! ${ranked.length} summary-capable model(s) available - using ${chosen}.`
                              : `✅ Key verified, but no text model suitable for summaries was found (${res.models
                                  .slice(0, 3)
                                  .join(', ')}${res.models.length > 3 ? '...' : ''}).`,
                            models: ranked.length > 0 ? ranked : res.models
                          });
                          if (chosen) setTempModel(chosen);
                        } else {
                          const keyHint = getGeminiKeyErrorHint(res.error);
                          setTestKeyStatus({
                            success: false,
                            message: keyHint
                              ? `❌ ${keyHint} (Google said: ${res.error})`
                              : `❌ ${res.error || 'No supported models found for this key.'}`
                          });
                        }
                      } catch (e: any) {
                        setTestKeyStatus({
                          success: false,
                          message: `❌ ${e?.message || 'Connection test failed.'}`
                        });
                      } finally {
                        setIsTestingKey(false);
                      }
                    }}
                    className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1 disabled:opacity-50 transition cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${isTestingKey ? 'animate-spin text-blue-300' : ''}`}
                    />
                    <span>{isTestingKey ? 'Testing...' : 'Test Key & Detect Models'}</span>
                  </button>
                </div>
                <input
                  type="password"
                  placeholder="AIzaSy..."
                  value={tempApiKey}
                  onChange={e => {
                    setTempApiKey(e.target.value);
                    setTestKeyStatus(null);
                  }}
                  className="w-full bg-[#0f172a] border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none"
                />
                {testKeyStatus && (
                  <div
                    className={`p-2 rounded-lg text-[10.5px] border leading-relaxed ${
                      testKeyStatus.success
                        ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                        : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
                    }`}
                  >
                    {testKeyStatus.message}
                  </div>
                )}
              </div>

              {/* Model Selector */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                  <span>Gemini Model</span>
                  <span className="text-[10px] text-blue-400 font-semibold">Customizable</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={`e.g. ${DEFAULT_GEMINI_MODEL}`}
                    value={tempModel}
                    onChange={e => setTempModel(e.target.value)}
                    className="flex-1 bg-[#0f172a] border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none"
                  />
                  <select
                    value={tempModel}
                    onChange={e => setTempModel(e.target.value)}
                    className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-2.5 py-2 text-xs text-blue-300 font-medium focus:outline-none cursor-pointer max-w-[150px] truncate"
                  >
                    {testKeyStatus?.models && testKeyStatus.models.length > 0
                      ? testKeyStatus.models.map(m => (
                          <option key={m} value={m} className="bg-slate-900 text-slate-200">
                            {m}
                          </option>
                        ))
                      : GEMINI_MODELS.map(m => (
                          <option key={m.id} value={m.id} className="bg-slate-900 text-slate-200">
                            {m.id}
                          </option>
                        ))}
                  </select>
                </div>
                <p className="text-[10.5px] text-slate-400">
                  Default: <code className="text-blue-300 font-mono">{DEFAULT_GEMINI_MODEL}</code>. You can select an auto-detected model or type any model ID. Retired models (Gemini 1.5 / 2.0) are switched to the default automatically.
                </p>
              </div>

              {/* Optional Disclaimer / Test Notes */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-300">
                  Test Context / Disclaimer (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. During these tests, we removed local flag overrides for Maps and Instacart."
                  value={reportDisclaimer}
                  onChange={e => {
                    setReportDisclaimer(e.target.value);
                    localStorage.setItem('qa_report_disclaimer', e.target.value);
                  }}
                  className="w-full bg-[#0f172a] border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsApiKeyModalOpen(false);
                    handleExecuteCopyReport(true); // run standard summary without key
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white transition"
                >
                  Skip / Use Standard
                </button>
                <button
                  type="button"
                  onClick={() => {
                    saveGeminiApiKey(tempApiKey.trim());
                    saveGeminiModel(tempModel);
                    setIsApiKeyModalOpen(false);
                    handleExecuteCopyReport(false);
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-sm border border-blue-500 active:scale-95 transition"
                >
                  Save &amp; Run AI Summary
                </button>
              </div>
            </div>
          </div>,
          document.getElementById('modal-portal') || document.body
        )}

      {/* AI Chat (no API key) Modal Portal */}
      {isChatSummaryOpen &&
        createPortal(
          <div
            onClick={() => setIsChatSummaryOpen(false)}
            className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md"
          >
            <div
              onClick={e => e.stopPropagation()}
              className="liquid-glass-panel rounded-3xl p-6 max-w-lg w-full border border-slate-700 shadow-2xl bg-[#111827] space-y-4 text-left animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-blue-500/15 text-blue-300 rounded-xl border border-blue-500/30">
                    <MessageSquareText className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Summarize with an AI chat</h4>
                    <p className="text-[11px] text-slate-400 font-medium">
                      No API key needed - use any AI chat you're allowed to use
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsChatSummaryOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {chatNotice && (
                <div className="p-2 rounded-lg text-[10.5px] border leading-relaxed bg-amber-950/50 border-amber-500/40 text-amber-200">
                  {chatNotice}
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-[11px] font-bold text-slate-300">
                  1. The prompt is already on your clipboard (the bugs in this report plus instructions)
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyChatPrompt}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition active:scale-95 ${
                      chatPromptCopied
                        ? 'bg-emerald-500/15 text-emerald-200 border-emerald-400/40'
                        : 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-200 border-blue-500/40'
                    }`}
                  >
                    {chatPromptCopied ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{chatPromptCopied ? 'Prompt copied - copy again' : 'Copy prompt'}</span>
                  </button>
                  <a
                    href={GEMINI_CHAT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 transition active:scale-95"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open Gemini</span>
                  </a>
                  <label className="flex items-center gap-1.5 text-[10.5px] text-slate-400 hover:text-slate-200 cursor-pointer select-none transition">
                    <input
                      type="checkbox"
                      checked={chatAutoOpenGemini}
                      onChange={e => toggleChatAutoOpenGemini(e.target.checked)}
                      className="accent-blue-500 w-3.5 h-3.5 cursor-pointer"
                    />
                    <span>Open Gemini automatically</span>
                  </label>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-300">
                  2. Paste it into Gemini or Antigravity and send it
                </p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Then copy the AI's whole reply - it's a block of JSON.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold text-slate-300">
                    3. Come back to this tab - the report builds itself
                  </p>
                  <button
                    type="button"
                    onClick={handlePasteChatReplyFromClipboard}
                    className="text-[10px] text-blue-300 hover:text-blue-200 font-semibold flex items-center gap-1 transition"
                  >
                    <ClipboardPaste className="w-3 h-3" />
                    <span>Paste from clipboard</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  It's copied for you as soon as it's built. If Chrome asks, allow clipboard access - or just press ⌘V (Ctrl+V) on this page.
                </p>
                <textarea
                  value={chatReplyText}
                  onChange={e => {
                    setChatReplyText(e.target.value);
                    setChatStatus(null);
                  }}
                  placeholder='Or paste the reply here: {"reportId": "QA-...", "features": [...], "overallSummary": "..."}'
                  rows={4}
                  className="w-full bg-[#0f172a] border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-[11px] text-white font-mono placeholder-slate-500 focus:outline-none resize-y"
                />
              </div>

              {chatStatus && (
                <div
                  className={`p-2 rounded-lg text-[10.5px] border leading-relaxed ${
                    chatStatus.type === 'success'
                      ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                      : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
                  }`}
                >
                  {chatStatus.message}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsChatSummaryOpen(false);
                      handleExecuteCopyReport(true); // basic offline summary, no AI
                    }}
                    className="text-[10.5px] font-semibold text-slate-500 hover:text-slate-200 transition"
                  >
                    Use basic summary
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsChatSummaryOpen(false);
                      setTempApiKey(getStoredGeminiApiKey());
                      setTempModel(getStoredGeminiModel());
                      setIsApiKeyModalOpen(true);
                    }}
                    className="text-[10.5px] font-semibold text-slate-500 hover:text-slate-200 transition"
                  >
                    {getStoredGeminiApiKey() ? 'Change API key' : 'Add API key'}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsChatSummaryOpen(false)}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!chatReplyText.trim() || isGeneratingSummary}
                    onClick={handleBuildReportFromChatReply}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-sm border border-blue-500 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Build Report
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.getElementById('modal-portal') || document.body
        )}

      {/* Summary Status Toast */}
      {summaryToast &&
        createPortal(
          <div className="fixed top-5 left-1/2 transform -translate-x-1/2 z-[9999999] max-w-lg w-full px-4 pointer-events-none animate-in fade-in slide-in-from-top-4 duration-300">
            <div
              className={`p-3.5 rounded-2xl border shadow-2xl backdrop-blur-md flex items-center gap-3 text-xs font-semibold ${
                summaryToast.type === 'success'
                  ? 'bg-emerald-950/95 text-emerald-200 border-emerald-500/40 shadow-emerald-950/50'
                  : summaryToast.type === 'error'
                    ? 'bg-rose-950/95 text-rose-200 border-rose-500/40 shadow-rose-950/50'
                    : 'bg-amber-950/95 text-amber-200 border-amber-500/40 shadow-amber-950/50'
              }`}
            >
              <Sparkles
                className={`w-4 h-4 flex-shrink-0 ${
                  summaryToast.type === 'success'
                    ? 'text-emerald-400'
                    : summaryToast.type === 'error'
                      ? 'text-rose-400'
                      : 'text-amber-400'
                }`}
              />
              <span className="leading-snug">{summaryToast.message}</span>
            </div>
          </div>,
          document.getElementById('modal-portal') || document.body
        )}
    </>
  );
};
