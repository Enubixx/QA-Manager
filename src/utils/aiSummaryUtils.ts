import { BugLog } from '../types';

/**
 * Summarizes feature issues into a few brief words for report copy and dashboard display.
 * Caps notes to short, clean phrases without bulky banners or multi-line clutter.
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
    if (redCount > 0 || redCount > 0) {
      return `${redCount + yellowCount} step failure${(redCount + yellowCount) > 1 ? 's' : ''}`;
    }
    return '';
  }

  const uniqueNotes = Array.from(new Set(notes));
  const joined = uniqueNotes.slice(0, 2).join('; ');
  if (joined.length > 60) {
    return joined.slice(0, 57) + '...';
  }
  return joined;
}
