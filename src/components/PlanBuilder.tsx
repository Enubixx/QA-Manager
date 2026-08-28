import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { TestPlan, TestStep } from '../types';
import { Plus, Trash2, Save, ListOrdered, FileText, Tag, ArrowUp, ArrowDown, ChevronDown, Check, X } from 'lucide-react';

interface PlanBuilderProps {
  initialPlan?: TestPlan | null;
  populatedFeatures: string[];
  onAddPopulatedFeature: (featureName: string) => void;
  onDeleteFeature?: (featureName: string) => void;
  onSavePlan: (newPlan: TestPlan) => void;
  onCancel: () => void;
}

export const PlanBuilder: React.FC<PlanBuilderProps> = ({
  initialPlan,
  populatedFeatures,
  onAddPopulatedFeature,
  onDeleteFeature,
  onSavePlan,
  onCancel
}) => {
  const [planName, setPlanName] = useState(initialPlan?.name || '');
  const [planDescription, setPlanDescription] = useState(initialPlan?.description || '');
  
  // Feature Selector Modal State (stores step index being edited, or null)
  const [selectingFeatureStepIndex, setSelectingFeatureStepIndex] = useState<number | null>(null);

  // Custom new feature input state inside modal
  const [newCustomFeatureName, setNewCustomFeatureName] = useState('');

  const handleAddNewFeatureSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomFeatureName.trim()) return;
    const createdName = newCustomFeatureName.trim();
    onAddPopulatedFeature(createdName);
    if (selectingFeatureStepIndex !== null) {
      handleUpdateStep(selectingFeatureStepIndex, 'feature', createdName);
    }
    setNewCustomFeatureName('');
  };

  // Steps state
  const [steps, setSteps] = useState<TestStep[]>(() => {
    if (initialPlan && initialPlan.steps && initialPlan.steps.length > 0) {
      return initialPlan.steps;
    }
    return [
      {
        id: 'step-' + Date.now() + '-1',
        title: 'Initialize Test Step 1',
        feature: populatedFeatures[0] || '',
        description: 'Perform initial action instruction...',
        expectedOutcome: 'Verify initial expected result.'
      }
    ];
  });

  const handleAddStep = () => {
    const newStep: TestStep = {
      id: 'step-' + Date.now() + '-' + (steps.length + 1),
      title: '',
      feature: populatedFeatures[0] || '',
      description: '',
      expectedOutcome: ''
    };
    setSteps(prev => [...prev, newStep]);
  };

  const handleUpdateStep = (index: number, field: keyof TestStep, value: string) => {
    setSteps(prev => prev.map((s, idx) => idx === index ? { ...s, [field]: value } : s));
  };

  const handleRemoveStep = (index: number) => {
    if (steps.length <= 1) return;
    setSteps(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleMoveStepUp = (index: number) => {
    if (index === 0) return;
    setSteps(prev => {
      const updated = [...prev];
      const temp = updated[index - 1];
      updated[index - 1] = updated[index];
      updated[index] = temp;
      return updated;
    });
  };

  const handleMoveStepDown = (index: number) => {
    if (index === steps.length - 1) return;
    setSteps(prev => {
      const updated = [...prev];
      const temp = updated[index + 1];
      updated[index + 1] = updated[index];
      updated[index] = temp;
      return updated;
    });
  };

  const handleSavePlanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!planName.trim()) {
      alert('Please enter a name for the Test Plan');
      return;
    }

    // Remember user-entered features
    steps.forEach(s => {
      if (s.feature?.trim()) {
        onAddPopulatedFeature(s.feature.trim());
      }
    });

    const savedPlan: TestPlan = {
      id: initialPlan?.id || 'plan-' + Date.now(),
      name: planName,
      description: planDescription,
      createdAt: initialPlan?.createdAt || new Date().toISOString(),
      steps: steps.filter(s => s.title.trim() !== '').map(s => ({
        ...s,
        feature: s.feature?.trim() || 'General'
      }))
    };

    onSavePlan(savedPlan);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      
      {/* Header (Apple Liquid Glass Header) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 pb-6 border-b border-white/10 liquid-glass-panel rounded-3xl p-6 shadow-2xl bg-slate-950/90 border-slate-800">
        <div>
          <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20 backdrop-blur-md">Plan Builder</span>
          <h2 className="text-2xl font-extrabold text-white mt-2 tracking-tight">
            {initialPlan ? `Edit Test Plan: ${initialPlan.name}` : 'Design Test Plan'}
          </h2>
          <p className="text-xs text-slate-400 font-medium mt-1">Build step-by-step test templates with Feature tagging sent directly to field QA testers on mobile phones.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 liquid-glass-button hover:bg-white/10 text-slate-300 text-xs font-semibold rounded-2xl transition-all duration-300"
          >
            Cancel
          </button>
          <button
            onClick={handleSavePlanSubmit}
            className="px-5 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white text-xs font-bold rounded-2xl shadow-lg shadow-purple-500/25 border border-white/20 flex items-center gap-2 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
          >
            <Save className="w-4 h-4" />
            {initialPlan ? 'Update Test Plan' : 'Publish Test Plan'}
          </button>
        </div>
      </div>

      <form onSubmit={handleSavePlanSubmit} className="space-y-8">
        
        {/* Basic Metadata */}
        <div className="liquid-glass-panel rounded-3xl p-6 space-y-4 shadow-2xl bg-slate-950/90 border border-slate-800">
          <h3 className="text-lg font-bold text-white flex items-center gap-2 tracking-tight">
            <FileText className="w-5 h-5 text-indigo-400" />
            1. Test Plan Overview
          </h3>
          
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Test Plan Name</label>
            <input
              type="text"
              placeholder="e.g. Mobile App Authentication & Checkout QA"
              value={planName}
              onChange={e => setPlanName(e.target.value)}
              className="w-full liquid-glass-input bg-slate-900 border border-slate-800 rounded-2xl px-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-purple-400/60 font-medium"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Description & Objective</label>
            <textarea
              rows={3}
              placeholder="Explain the goal for the QA tester walking through this on their phone..."
              value={planDescription}
              onChange={e => setPlanDescription(e.target.value)}
              className="w-full liquid-glass-input bg-slate-900 border border-slate-800 rounded-2xl px-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-purple-400/60 font-medium"
            />
          </div>
        </div>

        {/* Step Builder with Feature Tagging */}
        <div className="liquid-glass-panel rounded-3xl p-6 space-y-6 shadow-2xl bg-slate-950/90 border border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2 tracking-tight">
                <ListOrdered className="w-5 h-5 text-indigo-400" />
                2. Mobile Test Steps & Feature Metrics
              </h3>
              <p className="text-xs text-slate-400 font-medium mt-0.5">Tag each step with the Feature identifier it evaluates to track individual feature health.</p>
            </div>
            <button
              type="button"
              onClick={handleAddStep}
              className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/40 text-purple-200 text-xs font-bold rounded-2xl flex items-center gap-1.5 transition-all duration-300 backdrop-blur-md hover:scale-[1.02] active:scale-[0.98]"
            >
              <Plus className="w-4 h-4 text-purple-300" />
              Add Step
            </button>
          </div>

          <div className="space-y-5">
            {steps.map((step, idx) => (
              <div
                key={step.id}
                className="liquid-glass-card bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4 relative group transition-all duration-300 hover:border-white/20 shadow-lg"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-xl bg-indigo-500/20 text-indigo-300 font-bold text-xs flex items-center justify-center border border-indigo-500/30 backdrop-blur-md">
                      #{idx + 1}
                    </span>
                    <span className="text-xs font-medium text-slate-400">Step {idx + 1} of {steps.length}</span>

                    {/* Compact Feature Badge Button */}
                    <button
                      type="button"
                      onClick={() => setSelectingFeatureStepIndex(idx)}
                      className="px-2.5 py-1 bg-purple-950/80 hover:bg-purple-900 border border-purple-800/80 text-purple-200 rounded-lg text-xs font-mono flex items-center gap-1.5 transition ml-2 group"
                      title="Click to select or change linked feature"
                    >
                      <Tag className="w-3 h-3 text-purple-400" />
                      <span>Feature: <strong className="text-purple-300 font-bold">{step.feature || 'General'}</strong></span>
                      <ChevronDown className="w-3 h-3 text-purple-400 group-hover:translate-y-0.5 transition-transform" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMoveStepUp(idx)}
                      className={`p-1.5 rounded-lg border transition ${
                        idx === 0
                          ? 'text-slate-700 border-slate-900 cursor-not-allowed'
                          : 'text-slate-400 hover:text-white bg-slate-900 border-slate-800 hover:border-slate-700'
                      }`}
                      title="Move Step Up"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === steps.length - 1}
                      onClick={() => handleMoveStepDown(idx)}
                      className={`p-1.5 rounded-lg border transition ${
                        idx === steps.length - 1
                          ? 'text-slate-700 border-slate-900 cursor-not-allowed'
                          : 'text-slate-400 hover:text-white bg-slate-900 border-slate-800 hover:border-slate-700'
                      }`}
                      title="Move Step Down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    {steps.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveStep(idx)}
                        className="text-slate-500 hover:text-rose-400 transition p-1.5 rounded-lg hover:bg-slate-900"
                        title="Remove Step"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Step Action Title</label>
                    <input
                      type="text"
                      placeholder="e.g. Tap Login with Google SSO"
                      value={step.title}
                      onChange={e => handleUpdateStep(idx, 'title', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Expected Outcome</label>
                    <input
                      type="text"
                      placeholder="e.g. Profile dashboard loads without errors"
                      value={step.expectedOutcome}
                      onChange={e => handleUpdateStep(idx, 'expectedOutcome', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Detailed Tester Instructions</label>
                  <textarea
                    rows={2}
                    placeholder="Provide specific instructions for the mobile QA tester..."
                    value={step.description}
                    onChange={e => handleUpdateStep(idx, 'description', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            ))}
          </div>

        </div>

      </form>

      {/* Floating Sticky Pop-out Feature Selector Button */}
      <div className="fixed bottom-6 right-6 z-40">
        <button
          type="button"
          onClick={() => setSelectingFeatureStepIndex(selectingFeatureStepIndex !== null ? null : -1)}
          className="px-4 py-3 bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-extrabold text-xs rounded-full shadow-2xl shadow-purple-500/40 border border-white/30 flex items-center gap-2 transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer backdrop-blur-xl"
          title="Open Pop-out Feature Selector without scrolling to top"
        >
          <Tag className="w-4 h-4 text-purple-200" />
          <span>Feature Manager ({populatedFeatures.length})</span>
        </button>
      </div>

      {/* Pop-out Feature Selector Modal via Portal */}
      {selectingFeatureStepIndex !== null && createPortal(
        <div
          onClick={() => setSelectingFeatureStepIndex(null)}
          className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[9999] flex items-center justify-center p-4 animate-liquid-fade"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-slate-900 border border-white/20 rounded-3xl p-6 max-w-md w-full space-y-5 shadow-2xl liquid-glass-panel relative"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Tag className="w-4 h-4 text-purple-400" />
                  {selectingFeatureStepIndex >= 0
                    ? `Link Feature for Step #${selectingFeatureStepIndex + 1}`
                    : 'Pop-out Feature Tag Manager'}
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectingFeatureStepIndex >= 0 && steps[selectingFeatureStepIndex]
                    ? `Step: ${steps[selectingFeatureStepIndex].title || 'Untitled Step'}`
                    : 'Manage active feature tags or add new features'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectingFeatureStepIndex(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Existing Feature Tags List */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300">Choose from Available Features:</div>
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-1">
                {populatedFeatures.map(feat => {
                  const isCurrent = selectingFeatureStepIndex >= 0 && steps[selectingFeatureStepIndex]
                    ? (steps[selectingFeatureStepIndex].feature || '').toLowerCase() === feat.toLowerCase()
                    : false;
                  return (
                    <div
                      key={feat}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono transition cursor-pointer ${
                        isCurrent
                          ? 'bg-purple-600 text-white border-purple-400 shadow-md shadow-purple-600/30 font-bold'
                          : 'bg-slate-950 hover:bg-slate-800 text-purple-200 border-purple-900/60 hover:border-purple-600'
                      }`}
                      onClick={() => {
                        if (selectingFeatureStepIndex >= 0) {
                          handleUpdateStep(selectingFeatureStepIndex, 'feature', feat);
                        }
                        setSelectingFeatureStepIndex(null);
                      }}
                    >
                      <span>🏷️ {feat}</span>
                      {isCurrent && <Check className="w-3.5 h-3.5 text-white" />}
                      {onDeleteFeature && feat.toLowerCase() !== 'general' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete feature tag "${feat}"?`)) {
                              onDeleteFeature(feat);
                            }
                          }}
                          className="hover:text-rose-400 p-0.5 ml-1 text-purple-300/60 transition"
                          title={`Delete feature "${feat}"`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Create Custom Feature inside Modal */}
            <form onSubmit={handleAddNewFeatureSubmit} className="pt-3 border-t border-slate-800 space-y-2">
              <label className="block text-xs font-semibold text-slate-300">Create New Custom Feature Tag</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Type feature (e.g. Payments)..."
                  value={newCustomFeatureName}
                  onChange={e => setNewCustomFeatureName(e.target.value)}
                  className="flex-1 bg-slate-950 border border-purple-800/60 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-medium"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl flex items-center gap-1 transition shadow-lg shadow-purple-600/20 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create Tag
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};
