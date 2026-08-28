import { BugLog } from '../types';

/**
 * Summarizes and rewords feature bug notes into a short, clean, synthesized status phrase.
 */
export function getBriefIssueSummary(
  bugs: BugLog[] = [],
  yellowCount: number = 0,
  redCount: number = 0
): string {
  const notes = bugs
    .map(b => b.note?.trim())
    .filter((n): n is string => !!n && n.length > 0);

  if (notes.length === 0) {
    if (redCount > 0 || yellowCount > 0) {
      const count = redCount + yellowCount;
      return `${count} step failure${count > 1 ? 's' : ''}`;
    }
    return '';
  }

  // Clean & reword raw notes into concise status phrases
  const cleanedPhrases = notes.map(note => {
    return note
      .replace(/^(bug|issue|defect|error|problem|encountered|found):\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  });

  const unique = Array.from(new Set(cleanedPhrases));
  
  if (unique.length === 1) {
    const s = unique[0];
    return s.length > 50 ? s.slice(0, 47) + '...' : s;
  }

  const shortList = unique.slice(0, 2).map(s => (s.length > 30 ? s.slice(0, 27) + '...' : s));
  const combined = shortList.join(' & ');
  if (combined.length > 60) {
    return combined.slice(0, 57) + '...';
  }
  return combined;
}
