import { BugLog } from '../types';

export interface AiFeatureIssueAnalysis {
  summary: string;
  categories: string[];
  bugCount: number;
  sampleNotes: string[];
}

/**
 * Intelligent AI Analysis of feature defects and issue types.
 * Categorizes issue notes into UI, API/Network, Performance, Auth, or Functional categories
 * and generates a concise summary of issues encountered for reports & copy summaries.
 */
export function getAiFeatureIssueAnalysis(
  featureName: string,
  associatedBugs: BugLog[] = [],
  yellowCount: number = 0,
  redCount: number = 0
): AiFeatureIssueAnalysis {
  const notes = associatedBugs
    .map(b => b.note?.trim())
    .filter((n): n is string => !!n && n.length > 0);

  const categories = new Set<string>();

  notes.forEach(note => {
    const lower = note.toLowerCase();

    // 🎨 UI / Visual Defects
    if (/ui|layout|button|screen|align|text|color|display|crop|clip|overlap|font|size|view|overflow|accordion|style/i.test(lower)) {
      categories.add('🎨 UI & Layout Glitch');
    }

    // ⚡ Performance & Latency
    if (/slow|lag|delay|freeze|latency|hang|stuck|timeout|sluggish|perf|load/i.test(lower)) {
      categories.add('⚡ Performance & Latency');
    }

    // 🔌 API & Network
    if (/net|api|connect|fetch|server|500|404|timeout|offline|sync|payload|http|cors|proxy/i.test(lower)) {
      categories.add('🔌 API & Connectivity');
    }

    // 🔒 Auth & Session
    if (/auth|login|token|permission|session|expired|denied|logout|pass|cred/i.test(lower)) {
      categories.add('🔒 Auth & Session');
    }

    // ⚙️ Functional Logic / Crash
    if (/crash|fail|error|blank|close|restart|reset|bug|defect|broken|wrong|issue|incorrect/i.test(lower)) {
      categories.add('⚙️ Functional Logic');
    }
  });

  // Fallback category if bugs exist but didn't trigger specific keywords
  if (categories.size === 0 && (associatedBugs.length > 0 || redCount > 0 || yellowCount > 0)) {
    categories.add('⚙️ General Functional Defect');
  }

  const categoryList = Array.from(categories);
  const uniqueNotes = Array.from(new Set(notes));

  let summary = '';
  if (associatedBugs.length === 0 && redCount === 0 && yellowCount === 0) {
    summary = '✅ 100% Pass — No defects or issues encountered.';
  } else {
    const bugPart = associatedBugs.length > 0 
      ? `${associatedBugs.length} bug${associatedBugs.length > 1 ? 's' : ''} logged` 
      : '';
    const failPart = (redCount + yellowCount) > 0 
      ? `${redCount + yellowCount} step failure${(redCount + yellowCount) > 1 ? 's' : ''}` 
      : '';

    const countDesc = [bugPart, failPart].filter(Boolean).join(' and ');
    const categoryText = categoryList.length > 0 ? categoryList.join(', ') : 'General defects';
    const sampleNotesText = uniqueNotes.slice(0, 2).map(n => `"${n}"`).join('; ');

    if (sampleNotesText) {
      summary = `${countDesc} [${categoryText}]: ${sampleNotesText}`;
    } else {
      summary = `${countDesc} [${categoryText}]: Step failures recorded during test execution.`;
    }
  }

  return {
    summary,
    categories: categoryList,
    bugCount: associatedBugs.length,
    sampleNotes: uniqueNotes
  };
}
