import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile } from '../types';
import { getLocalDateStr } from './dateUtils';

/**
 * Escapes HTML special characters to prevent XSS and attribute breakout in rich clipboard HTML.
 */
export function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitizes a CSV cell against formula injection (=, +, -, @, \t, \r) and escapes double quotes.
 */
export function sanitizeCsvCell(text: unknown): string {
  let raw = String(text ?? '');
  if (/^[=+\-@\t\r]/.test(raw)) {
    raw = `'${raw}`;
  }
  return `"${raw.replace(/"/g, '""')}"`;
}

/**
 * Download a string content as a file in browser
 */
function downloadFile(content: string, filename: string, contentType: string = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch (e) {}
  }, 1000);
}

/**
 * Export a single Test Run to CSV with feature, device & reporter metadata
 */
export function exportTestRunToCSV(plan: TestPlan, run: TestRun) {
  const sanitize = sanitizeCsvCell;

  const totalSteps = (plan?.steps || []).length;
  const greenCount = Object.values(run.results || {}).filter(r => r && r.status === 'green').length;
  const yellowCount = Object.values(run.results || {}).filter(r => r && r.status === 'yellow').length;
  const redCount = Object.values(run.results || {}).filter(r => r && r.status === 'red').length;

  let csvContent = '=== QA TEST EXECUTION REPORT ===\n';
  csvContent += `Test Plan,${sanitize(plan.name)}\n`;
  csvContent += `Reporter Name,${sanitize(run.testerName || 'N/A')}\n`;
  csvContent += `Device Model,${sanitize(run.deviceName || 'Unspecified Device')}\n`;
  csvContent += `Execution Status,${sanitize(run.status)}\n`;
  csvContent += `Date Started,${sanitize(new Date(run.startedAt).toLocaleString())}\n`;
  csvContent += `Date Completed,${sanitize(run.completedAt ? new Date(run.completedAt).toLocaleString() : 'In Progress')}\n`;
  csvContent += `Summary,Total Steps: ${totalSteps} | Green: ${greenCount} | Yellow: ${yellowCount} | Red: ${redCount} | Bugs: ${(run.bugLogs || []).length}\n\n`;

  csvContent += '=== STEP EXECUTION DETAILS ===\n';
  csvContent += 'Step #,Step Title,Feature Identifier,Expected Outcome,Status,Execution Timestamp,Device Model,Reporter\n';

  (plan.steps || []).forEach((step, idx) => {
    const res = run.results?.[step.id];
    const statusText = res && res.status ? res.status.toUpperCase() : 'NOT EXECUTED';
    const timestamp = res?.timestamp ? new Date(res.timestamp).toLocaleTimeString() : 'N/A';

    csvContent += `${idx + 1},${sanitize(step.title)},${sanitize(step.feature || 'General')},${sanitize(step.expectedOutcome)},${sanitize(statusText)},${sanitize(timestamp)},${sanitize(run.deviceName || '')},${sanitize(run.testerName || '')}\n`;
  });

  if ((run.bugLogs || []).length > 0) {
    csvContent += '\n=== BUGS ===\n';
    csvContent += 'Timestamp,Feature,Title,Step Target,Reporter,Device Model,Image URL,Bug Note\n';

    run.bugLogs.forEach(bug => {
      csvContent += `${sanitize(bug.formattedTime)},${sanitize(bug.feature || 'General')},${sanitize(bug.title || '')},${sanitize(bug.stepTitle)},${sanitize(bug.testerName)},${sanitize(run.deviceName || bug.deviceName || '')},${sanitize(bug.imageUrl || '')},${sanitize(bug.note)}\n`;
    });
  }

  const safeDevice = (run.deviceName || 'device').replace(/[^a-zA-Z0-9]/g, '_');
  const safePlan = (plan.name || 'QA_Plan').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `QA_Report_${safePlan}_${safeDevice}_${getLocalDateStr()}.csv`;

  downloadFile(csvContent, fileName);
}

/**
 * Export All QA Runs to CSV grouped by Device Name & Feature
 */
export function exportAllQADataToCSV(plans: TestPlan[], runs: TestRun[]) {
  const sanitize = sanitizeCsvCell;

  let csvContent = '=== MASTER QA EXECUTION REPORT ===\n';
  csvContent += 'Plan Name,Reporter Name,Device Model,Status,Started At,Completed At,Green Steps,Yellow Steps,Red Steps,Total Bugs\n';

  (runs || []).forEach(run => {
    const greenCount = Object.values(run.results || {}).filter(r => r && r.status === 'green').length;
    const yellowCount = Object.values(run.results || {}).filter(r => r && r.status === 'yellow').length;
    const redCount = Object.values(run.results || {}).filter(r => r && r.status === 'red').length;

    csvContent += `${sanitize(run.planName)},${sanitize(run.testerName)},${sanitize(run.deviceName || 'Unspecified')},${sanitize(run.status)},${sanitize(new Date(run.startedAt).toLocaleString())},${sanitize(run.completedAt ? new Date(run.completedAt).toLocaleString() : 'N/A')},${greenCount},${yellowCount},${redCount},${(run.bugLogs || []).length}\n`;
  });

  const fileName = `QA_Master_Report_${getLocalDateStr()}.csv`;
  downloadFile(csvContent, fileName);
}

export interface FullQABackupExtra {
  archivedRuns?: TestRun[];
  devices?: DeviceProfile[];
  testers?: TesterProfile[];
  populatedFeatures?: string[];
}

/**
 * Export All QA Data (Plans, Runs, Bugs, plus optional Archived Runs, Devices, Testers, Populated Features) to JSON for Backup & Team Sharing
 */
export function exportAllQADataToJSON(
  plans: TestPlan[],
  runs: TestRun[],
  bugLogs: BugLog[],
  archivedRunsOrExtra?: TestRun[] | FullQABackupExtra,
  devices?: DeviceProfile[],
  testers?: TesterProfile[],
  populatedFeatures?: string[]
) {
  const extra: FullQABackupExtra = Array.isArray(archivedRunsOrExtra)
    ? { archivedRuns: archivedRunsOrExtra, devices, testers, populatedFeatures }
    : archivedRunsOrExtra || {};

  const exportPayload: Record<string, unknown> = {
    version: '1.1',
    exportedAt: new Date().toISOString(),
    testPlans: plans || [],
    testRuns: runs || [],
    bugLogs: bugLogs || [],
  };
  if (extra.archivedRuns !== undefined) exportPayload.archivedRuns = extra.archivedRuns;
  if (extra.devices !== undefined) exportPayload.devices = extra.devices;
  if (extra.testers !== undefined) exportPayload.testers = extra.testers;
  if (extra.populatedFeatures !== undefined) exportPayload.populatedFeatures = extra.populatedFeatures;

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const fileName = `QA_Flow_Studio_Backup_${getLocalDateStr()}.json`;
  downloadFile(jsonString, fileName, 'application/json;charset=utf-8;');
}

/**
 * Export Bug Logs to CSV (compatible with Google Sheets & Excel)
 * Columns in order: Timestamp, Tester Name, Device, Feature, Description/Note, Image URL
 */
export interface BugCsvExportOptions {
  /** Name of the test plan the export is scoped to (used in the file name). */
  planName?: string;
  /** Resolves each bug's test plan name for the "Test Plan" column. */
  getPlanName?: (bug: BugLog) => string;
}

export function exportBugsToCSV(bugs: BugLog[], options?: BugCsvExportOptions) {
  const sanitize = sanitizeCsvCell;
  const getPlanName = options?.getPlanName;

  let csvContent = 'Timestamp,Tester Name,Device,Feature,Title,Description/Note,Image URL' + (getPlanName ? ',Test Plan' : '') + '\n';

  (bugs || []).forEach(bug => {
    let formattedTs = bug.formattedTime || 'N/A';
    try {
      const d = bug.timestamp ? new Date(bug.timestamp) : new Date();
      if (!isNaN(d.getTime())) {
        const dateStr = d.toLocaleDateString();
        const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
        formattedTs = `${dateStr} ${timeStr}`;
      }
    } catch (e) {}

    csvContent += `${sanitize(formattedTs)},${sanitize(bug.testerName || 'Anonymous')},${sanitize(bug.deviceName || 'Mobile Device')},${sanitize(bug.feature || 'General')},${sanitize(bug.title || '')},${sanitize(bug.note || '')},${sanitize(bug.imageUrl || '')}` + (getPlanName ? `,${sanitize(getPlanName(bug))}` : '') + '\n';
  });

  const planSlug = (options?.planName || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  const fileName = planSlug
    ? `QA_Bug_Logs_${planSlug}_${getLocalDateStr()}.csv`
    : `QA_Bug_Logs_${getLocalDateStr()}.csv`;
  downloadFile(csvContent, fileName);
}

export interface BugCopyFilterOptions {
  dateFilter?: string;
  featureFilter?: string;
  deviceFilter?: string;
  /** Test plan name the copied list is scoped to; shown as a heading. */
  planFilter?: string;
  searchQuery?: string;
}

/**
 * Validates that an image URL uses a safe scheme (https://, http://, or data:image/).
 */
export function isSafeImageUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(trimmed)
  );
}

/**
 * Returns a globally accessible, public HTTPS URL for a bug screenshot.
 * Works seamlessly with Google Docs, Microsoft Word, Slack, Notion, and Email clients.
 */
export function getBugPublicImageUrl(bug: BugLog): string | null {
  if (!bug || !bug.imageUrl || !isSafeImageUrl(bug.imageUrl)) return null;
  const trimmed = bug.imageUrl.trim();

  // If already an HTTP/HTTPS URL, return as is
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  // Construct canonical production endpoint for Google Docs server fetches
  let origin = 'https://qa-manager-brown.vercel.app';
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    if (window.location.origin.includes('vercel.app')) {
      origin = window.location.origin;
    }
  }

  return `${origin}/api/bug-image?id=${encodeURIComponent(bug.id || '')}`;
}

const getFormattedTimestamp = (bug: BugLog) => {
  try {
    const d = bug.timestamp ? new Date(bug.timestamp) : new Date();
    if (!isNaN(d.getTime())) {
      const dateStr = d.toLocaleDateString();
      const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      return `${dateStr}, ${timeStr}`;
    }
  } catch (e) {}
  return bug.formattedTime || 'N/A';
};

export const getBugCategorization = (bug: BugLog) => {
  const bugType = bug.bugType || 'Bug';
  let priority = bug.priority;
  if (priority === '0') priority = 'P0';
  else if (priority === '1') priority = 'P1';
  else if (priority === '2') priority = 'P2';
  else if (!priority) {
    if (bug.severity === 'critical') priority = 'P0';
    else if (bug.severity === 'high') priority = 'P1';
    else priority = 'P2';
  }
  const status = bug.status || 'Filed';
  return { bugType, priority, status };
};

export const getSmartBadgeHtml = (bugType: string, priority: string, status: string) => {
  const bugTypeBg = '#fef08a';
  const bugTypeText = '#713f12';

  const prioBg = priority === 'P0' ? '#ef4444' : priority === 'P1' ? '#f97316' : '#eab308';
  const prioText = '#ffffff';

  const statusBg = status === 'Filed' ? '#dcfce7' : status === 'New' ? '#dbeafe' : '#f3e8ff';
  const statusText = status === 'Filed' ? '#166534' : status === 'New' ? '#1e40af' : '#6b21a8';

  return `<span style="display: inline-block; background-color: ${bugTypeBg}; color: ${bugTypeText}; font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 9999px; margin-right: 4px; vertical-align: middle; border: 1px solid rgba(0,0,0,0.08); font-family: inherit;">${escapeHtml(bugType)} ▾</span>` +
         `<span style="display: inline-block; background-color: ${prioBg}; color: ${prioText}; font-size: 11px; font-weight: 800; padding: 2px 9px; border-radius: 9999px; margin-right: 4px; vertical-align: middle; font-family: inherit;">${escapeHtml(priority)} ▾</span>` +
         `<span style="display: inline-block; background-color: ${statusBg}; color: ${statusText}; font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 9999px; margin-right: 6px; vertical-align: middle; border: 1px solid rgba(0,0,0,0.08); font-family: inherit;">${escapeHtml(status)} ▾</span>`;
};

/** Bug title (if the tester gave one) and the description to show under it (skipped when it just repeats the title). */
function bugTitleAndDescription(bug: BugLog): { title: string; description: string } {
  const title = (bug.title || '').trim();
  const note = (bug.note || '').trim();
  return { title, description: title && note === title ? '' : (note || (title ? '' : 'No description attached.')) };
}

/**
 * Format a single bug into plain text & rich Google Docs-compatible HTML
 */
export function formatSingleBugToText(bug: BugLog): { plainText: string; htmlText: string } {
  const ts = getFormattedTimestamp(bug);
  const feature = bug.feature || 'General';
  const { title, description } = bugTitleAndDescription(bug);
  const publicImageUrl = getBugPublicImageUrl(bug);
  const { bugType, priority, status } = getBugCategorization(bug);
  const badgeHtml = getSmartBadgeHtml(bugType, priority, status);

  // Plain Text representation
  let plainText = `[${bugType}] [${priority}] [${status}] [${ts}] Feature: ${feature}\n`;
  if (title) plainText += `Title: ${title}\n`;
  if (description) plainText += `Description: ${description}\n`;
  if (publicImageUrl) {
    plainText += `Screenshot: ${publicImageUrl}\n`;
  }

  // Rich HTML for Google Docs (escaped against HTML/attribute injection)
  let htmlText = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; color: #0f172a; line-height: 1.5; max-width: 680px; margin-bottom: 14px;">`;
  htmlText += `<div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 4px;">`;
  htmlText += `${badgeHtml}`;
  htmlText += `<span style="color: #475569; font-weight: 600;">[${escapeHtml(ts)}]</span> `;
  htmlText += `<span style="color: #4f46e5; font-weight: 700;">Feature: ${escapeHtml(feature)}</span>`;
  htmlText += `</div>`;
  if (title) htmlText += `<div style="margin: 4px 0; font-size: 14px; font-weight: 700; color: #0f172a;">${escapeHtml(title)}</div>`;
  if (description) {
    htmlText += `<div style="margin: 4px 0; font-size: 13px; color: #1e293b;">`;
    htmlText += `<b>Description:</b> ${escapeHtml(description).replace(/\n/g, '<br/>')}`;
    htmlText += `</div>`;
  }

  if (publicImageUrl) {
    htmlText += `<div style="margin-top: 8px;">`;
    htmlText += `<img src="${escapeHtml(publicImageUrl)}" alt="Bug Screenshot" width="450" style="max-width: 450px; width: 100%; height: auto; border-radius: 6px; display: block; border: 1px solid #cbd5e1;" />`;
    htmlText += `</div>`;
  }

  htmlText += `</div>`;

  return { plainText, htmlText };
}

/**
 * Format bugs list into plain text & rich HTML suitable for Google Docs, Word, email, Slack, and Teams
 */
export function formatBugsToText(bugs: BugLog[], filterOptions?: BugCopyFilterOptions): { plainText: string; htmlText: string } {
  let scopedBugs = Array.isArray(bugs) ? [...bugs] : [];
  if (filterOptions) {
    if (filterOptions.featureFilter && filterOptions.featureFilter !== 'all') {
      const ff = filterOptions.featureFilter.trim().toLowerCase();
      scopedBugs = scopedBugs.filter(b => (b.feature || 'General').trim().toLowerCase() === ff);
    }
    if (filterOptions.deviceFilter && filterOptions.deviceFilter !== 'all') {
      const df = filterOptions.deviceFilter.trim().toLowerCase();
      scopedBugs = scopedBugs.filter(b => (b.deviceName || '').trim().toLowerCase() === df);
    }
    if (filterOptions.searchQuery && filterOptions.searchQuery.trim()) {
      const q = filterOptions.searchQuery.trim().toLowerCase();
      scopedBugs = scopedBugs.filter(b =>
        (b.note || '').toLowerCase().includes(q) ||
        (b.title || '').toLowerCase().includes(q) ||
        (b.feature || '').toLowerCase().includes(q) ||
        (b.testerName || '').toLowerCase().includes(q) ||
        (b.deviceName || '').toLowerCase().includes(q) ||
        (b.stepTitle || '').toLowerCase().includes(q)
      );
    }
  }

  if (scopedBugs.length === 0) {
    return {
      plainText: 'No bugs match the selected filter criteria.',
      htmlText: '<p style="color: #64748b; font-style: italic;">No bugs match the selected filter criteria.</p>'
    };
  }

  // Group bugs by the person who filed them (case-insensitive grouping, sorted alphabetically by name)
  const groupedMap = new Map<string, { displayName: string; bugs: BugLog[] }>();
  scopedBugs.forEach(bug => {
    const rawName = (bug.testerName || 'Unassigned').trim() || 'Unassigned';
    const key = rawName.toLowerCase();
    if (!groupedMap.has(key)) {
      groupedMap.set(key, { displayName: rawName, bugs: [] });
    }
    groupedMap.get(key)!.bugs.push(bug);
  });

  const sortedGroups = Array.from(groupedMap.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
  );

  // 1. Plain Text Output (Grouped by individual)
  const planHeading = (filterOptions?.planFilter || '').trim();
  let plainText = planHeading ? `Test Plan: ${planHeading} (${scopedBugs.length} ${scopedBugs.length === 1 ? 'bug' : 'bugs'})\n\n` : '';
  sortedGroups.forEach((group, groupIdx) => {
    plainText += `${group.displayName}\n\n`;
    group.bugs.forEach((bug, idx) => {
      const ts = getFormattedTimestamp(bug);
      const feature = bug.feature || 'General';
      const { title, description } = bugTitleAndDescription(bug);
      const publicImageUrl = getBugPublicImageUrl(bug);
      const { bugType, priority, status } = getBugCategorization(bug);

      plainText += `[${bugType}] [${priority}] [${status}] [${ts}] Feature: ${feature}\n`;
      if (title) plainText += `Title: ${title}\n`;
      if (description) plainText += `Description: ${description}\n`;
      if (publicImageUrl) {
        plainText += `Screenshot: ${publicImageUrl}\n`;
      }
      if (idx < group.bugs.length - 1) {
        plainText += `\n`;
      }
    });

    if (groupIdx < sortedGroups.length - 1) {
      plainText += `\n\n`;
    }
  });

  // 2. Rich HTML Output for Google Docs (escaped against HTML/attribute injection)
  let htmlText = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; color: #0f172a; line-height: 1.5; max-width: 680px;">`;
  if (planHeading) {
    htmlText += `<div style="font-size: 18px; font-weight: 800; color: #1d4ed8; margin-bottom: 16px;">Test Plan: ${escapeHtml(planHeading)} <span style="font-size: 13px; font-weight: 600; color: #475569;">(${scopedBugs.length} ${scopedBugs.length === 1 ? 'bug' : 'bugs'})</span></div>`;
  }
  sortedGroups.forEach((group, groupIdx) => {
    htmlText += `<div style="${groupIdx > 0 ? 'margin-top: 28px; padding-top: 16px; border-top: 2px solid #cbd5e1;' : 'margin-top: 0;'}">`;
    htmlText += `<div style="font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 12px;">${escapeHtml(group.displayName)}</div>`;

    group.bugs.forEach((bug, idx) => {
      const ts = getFormattedTimestamp(bug);
      const feature = bug.feature || 'General';
      const { title, description: rawDescription } = bugTitleAndDescription(bug);
      const description = escapeHtml(rawDescription).replace(/\n/g, '<br/>');
      const publicImageUrl = getBugPublicImageUrl(bug);
      const { bugType, priority, status } = getBugCategorization(bug);
      const badgeHtml = getSmartBadgeHtml(bugType, priority, status);

      htmlText += `<div style="margin-bottom: 16px; padding-bottom: 12px; ${idx < group.bugs.length - 1 ? 'border-bottom: 1px solid #f1f5f9;' : ''}">`;
      htmlText += `<div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 4px;">`;
      htmlText += `${badgeHtml}`;
      htmlText += `<span style="color: #475569; font-weight: 600;">[${escapeHtml(ts)}]</span> `;
      htmlText += `<span style="color: #4f46e5; font-weight: 700;">Feature: ${escapeHtml(feature)}</span>`;
      htmlText += `</div>`;
      if (title) htmlText += `<div style="margin: 4px 0; font-size: 14px; font-weight: 700; color: #0f172a;">${escapeHtml(title)}</div>`;
      if (description) {
        htmlText += `<div style="margin: 4px 0; font-size: 13px; color: #1e293b;">`;
        htmlText += `<b>Description:</b> ${description}`;
        htmlText += `</div>`;
      }
      if (publicImageUrl) {
        htmlText += `<div style="margin-top: 8px;">`;
        htmlText += `<img src="${escapeHtml(publicImageUrl)}" alt="Bug Screenshot" width="450" style="max-width: 450px; width: 100%; height: auto; border-radius: 6px; display: block; border: 1px solid #cbd5e1;" />`;
        htmlText += `</div>`;
      }
      htmlText += `</div>`;
    });

    htmlText += `</div>`;
  });
  htmlText += `</div>`;

  return { plainText, htmlText };
}

/**
 * Legacy fallback when navigator.clipboard is unavailable or permission is denied
 */
function fallbackCopyTextToClipboard(text: string): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return !!ok;
  } catch (e) {
    return false;
  }
}

/**
 * Copy rich HTML + plain text to clipboard with graceful fallback
 */
export async function writeRichTextToClipboard(plainText: string, htmlText?: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      if (htmlText && typeof window !== 'undefined' && 'ClipboardItem' in window) {
        try {
          const textBlob = new Blob([plainText], { type: 'text/plain' });
          const htmlBlob = new Blob([htmlText], { type: 'text/html' });
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/plain': textBlob,
              'text/html': htmlBlob,
            }),
          ]);
          return true;
        } catch (richErr) {
          // Fall through to writeText
        }
      }
      if (typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(plainText);
        return true;
      }
    }
  } catch (err) {
    // Fall through to execCommand fallback
  }
  return fallbackCopyTextToClipboard(plainText);
}

/**
 * Copy formatted bug report (text & HTML) to system clipboard
 */
export async function copyBugsToClipboard(bugs: BugLog[], filterOptions?: BugCopyFilterOptions): Promise<boolean> {
  if (!Array.isArray(bugs) || bugs.length === 0) return false;
  const { plainText, htmlText } = formatBugsToText(bugs, filterOptions);
  if (plainText === 'No bugs match the selected filter criteria.') return false;
  return writeRichTextToClipboard(plainText, htmlText);
}

/**
 * Copy a single formatted bug (text & HTML with screenshot) to system clipboard
 */
export async function copySingleBugToClipboard(bug: BugLog): Promise<boolean> {
  if (!bug) return false;
  const { plainText, htmlText } = formatSingleBugToText(bug);
  return writeRichTextToClipboard(plainText, htmlText);
}


