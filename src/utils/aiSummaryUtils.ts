import { BugLog } from '../types';
import { nlpCleanReword } from '../services/geminiService';

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

  return nlpCleanReword(notes, 'General');
}
