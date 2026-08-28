import { TestPlan, TestRun, BugLog } from '../types';

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
}

/**
 * Export a single Test Run to CSV with feature, device & reporter metadata
 */
export function exportTestRunToCSV(plan: TestPlan, run: TestRun) {
  const sanitize = (text: string) => `"${(text || '').replace(/"/g, '""')}"`;

  const totalSteps = plan.steps.length;
  const greenCount = Object.values(run.results || {}).filter(r => r.status === 'green').length;
  const yellowCount = Object.values(run.results || {}).filter(r => r.status === 'yellow').length;
  const redCount = Object.values(run.results || {}).filter(r => r.status === 'red').length;

  let csvContent = '=== QA TEST EXECUTION REPORT ===\n';
  csvContent += `Test Plan,${sanitize(plan.name)}\n`;
  csvContent += `Reporter Name,${sanitize(run.testerName || 'N/A')}\n`;
  csvContent += `Device Model,${sanitize(run.deviceName || 'Unspecified Device')}\n`;
  csvContent += `Execution Status,${run.status}\n`;
  csvContent += `Date Started,${sanitize(new Date(run.startedAt).toLocaleString())}\n`;
  csvContent += `Date Completed,${sanitize(run.completedAt ? new Date(run.completedAt).toLocaleString() : 'In Progress')}\n`;
  csvContent += `Summary,Total Steps: ${totalSteps} | Green: ${greenCount} | Yellow: ${yellowCount} | Red: ${redCount} | Bugs: ${run.bugLogs.length}\n\n`;

  csvContent += '=== STEP EXECUTION DETAILS ===\n';
  csvContent += 'Step #,Step Title,Feature Identifier,Expected Outcome,Status,Execution Timestamp,Device Model,Reporter\n';

  plan.steps.forEach((step, idx) => {
    const res = run.results[step.id];
    const statusText = res ? res.status.toUpperCase() : 'NOT EXECUTED';
    const timestamp = res?.timestamp ? new Date(res.timestamp).toLocaleTimeString() : 'N/A';

    csvContent += `${idx + 1},${sanitize(step.title)},${sanitize(step.feature || 'General')},${sanitize(step.expectedOutcome)},${statusText},${sanitize(timestamp)},${sanitize(run.deviceName || '')},${sanitize(run.testerName || '')}\n`;
  });

  if (run.bugLogs.length > 0) {
    csvContent += '\n=== BUGS ===\n';
    csvContent += 'Timestamp,Feature,Severity,Step Target,Reporter,Device Model,Image URL,Bug Note\n';

    run.bugLogs.forEach(bug => {
      csvContent += `${sanitize(bug.formattedTime)},${sanitize(bug.feature || 'General')},${bug.severity.toUpperCase()},${sanitize(bug.stepTitle)},${sanitize(bug.testerName)},${sanitize(run.deviceName || bug.deviceName || '')},${sanitize(bug.imageUrl || '')},${sanitize(bug.note)}\n`;
    });
  }

  const safeDevice = (run.deviceName || 'device').replace(/[^a-zA-Z0-9]/g, '_');
  const safePlan = (plan.name || 'QA_Plan').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `QA_Report_${safePlan}_${safeDevice}_${new Date().toISOString().slice(0, 10)}.csv`;

  downloadFile(csvContent, fileName);
}

/**
 * Export All QA Runs to CSV grouped by Device Name & Feature
 */
export function exportAllQADataToCSV(plans: TestPlan[], runs: TestRun[]) {
  const sanitize = (text: string) => `"${(text || '').replace(/"/g, '""')}"`;

  let csvContent = '=== MASTER QA EXECUTION REPORT ===\n';
  csvContent += 'Plan Name,Reporter Name,Device Model,Status,Started At,Completed At,Green Steps,Yellow Steps,Red Steps,Total Bugs\n';

  runs.forEach(run => {
    const greenCount = Object.values(run.results || {}).filter(r => r.status === 'green').length;
    const yellowCount = Object.values(run.results || {}).filter(r => r.status === 'yellow').length;
    const redCount = Object.values(run.results || {}).filter(r => r.status === 'red').length;

    csvContent += `${sanitize(run.planName)},${sanitize(run.testerName)},${sanitize(run.deviceName || 'Unspecified')},${run.status},${sanitize(new Date(run.startedAt).toLocaleString())},${sanitize(run.completedAt ? new Date(run.completedAt).toLocaleString() : 'N/A')},${greenCount},${yellowCount},${redCount},${run.bugLogs.length}\n`;
  });

  const fileName = `QA_Master_Report_${new Date().toISOString().slice(0, 10)}.csv`;
  downloadFile(csvContent, fileName);
}

/**
 * Export All QA Data (Plans, Runs, Bugs) to JSON for Backup & Team Sharing
 */
export function exportAllQADataToJSON(plans: TestPlan[], runs: TestRun[], bugLogs: BugLog[]) {
  const exportPayload = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    testPlans: plans,
    testRuns: runs,
    bugLogs: bugLogs
  };

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const fileName = `QA_Flow_Studio_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  downloadFile(jsonString, fileName, 'application/json;charset=utf-8;');
}

/**
 * Export Bug Logs to CSV (compatible with Google Sheets & Excel)
 * Columns in order: Timestamp, Tester Name, Device, Feature, Description/Note, Image URL
 */
export function exportBugsToCSV(bugs: BugLog[]) {
  const sanitize = (text: string) => `"${(text || '').replace(/"/g, '""')}"`;

  let csvContent = 'Timestamp,Tester Name,Device,Feature,Description/Note,Image URL\n';

  bugs.forEach(bug => {
    let formattedTs = bug.formattedTime || 'N/A';
    try {
      const d = bug.timestamp ? new Date(bug.timestamp) : new Date();
      if (!isNaN(d.getTime())) {
        const dateStr = d.toLocaleDateString();
        const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
        formattedTs = `${dateStr} ${timeStr}`;
      }
    } catch (e) {}

    csvContent += `${sanitize(formattedTs)},${sanitize(bug.testerName || 'Anonymous')},${sanitize(bug.deviceName || 'Mobile Device')},${sanitize(bug.feature || 'General')},${sanitize(bug.note || '')},${sanitize(bug.imageUrl || '')}\n`;
  });

  const fileName = `QA_Bug_Logs_${new Date().toISOString().slice(0, 10)}.csv`;
  downloadFile(csvContent, fileName);
}

export interface BugCopyFilterOptions {
  dateFilter?: string;
  featureFilter?: string;
  deviceFilter?: string;
  searchQuery?: string;
}

/**
 * Format bugs list into plain text & rich HTML suitable for email, Slack, Teams, and messages
 */
export function formatBugsToText(bugs: BugLog[], filterOptions?: BugCopyFilterOptions): { plainText: string; htmlText: string } {
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

  const filterParts: string[] = [];
  if (filterOptions?.featureFilter && filterOptions.featureFilter !== 'all') {
    filterParts.push(`Feature: ${filterOptions.featureFilter}`);
  }
  if (filterOptions?.deviceFilter && filterOptions.deviceFilter !== 'all') {
    filterParts.push(`Device: ${filterOptions.deviceFilter}`);
  }
  if (filterOptions?.dateFilter && filterOptions.dateFilter !== 'all') {
    filterParts.push(`Date: ${filterOptions.dateFilter}`);
  }
  if (filterOptions?.searchQuery) {
    filterParts.push(`Search: "${filterOptions.searchQuery}"`);
  }
  const filterSummaryStr = filterParts.length > 0 ? `Filters: ${filterParts.join(' | ')}\n` : '';

  // 1. Plain Text Output
  let plainText = `🐛 QA Bug Report (${bugs.length} ${bugs.length === 1 ? 'Bug' : 'Bugs'})\n`;
  if (filterSummaryStr) plainText += filterSummaryStr;
  plainText += `----------------------------------------\n\n`;

  if (bugs.length === 0) {
    plainText += `No bugs match the selected filter criteria.\n`;
  } else {
    bugs.forEach((bug, idx) => {
      const ts = getFormattedTimestamp(bug);
      const feature = bug.feature || 'General';
      const description = bug.note || 'No description attached.';

      plainText += `${idx + 1}. [${ts}] Feature: ${feature}\n`;
      plainText += `   Description: ${description}\n\n`;
    });
  }
  plainText += `----------------------------------------`;

  // 2. Rich HTML Output for Email, Slack, Teams, Docs & Apple Notes
  let htmlText = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; color: #0f172a; line-height: 1.5; max-width: 680px;">`;
  htmlText += `<div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 12px;">`;
  htmlText += `<h3 style="margin: 0 0 4px 0; font-size: 16px; font-weight: 800; color: #0f172a;">`;
  htmlText += `🐛 QA Bug Report <span style="font-size: 13px; font-weight: 600; color: #64748b;">(${bugs.length} ${bugs.length === 1 ? 'Bug' : 'Bugs'})</span>`;
  htmlText += `</h3>`;
  if (filterParts.length > 0) {
    htmlText += `<div style="font-size: 11.5px; color: #64748b; font-weight: 500;">`;
    htmlText += `<b>Filters:</b> ${filterParts.join(' | ')}`;
    htmlText += `</div>`;
  }
  htmlText += `</div>`;

  if (bugs.length === 0) {
    htmlText += `<p style="color: #64748b; font-style: italic;">No bugs match the selected filter criteria.</p>`;
  } else {
    htmlText += `<ol style="margin: 0; padding-left: 20px;">`;
    bugs.forEach((bug) => {
      const ts = getFormattedTimestamp(bug);
      const feature = bug.feature || 'General';
      const note = (bug.note || 'No description attached.').replace(/\n/g, '<br/>');

      htmlText += `<li style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #f1f5f9;">`;
      htmlText += `<div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 4px;">`;
      htmlText += `<span style="color: #475569; font-weight: 600; font-family: monospace;">[${ts}]</span> `;
      htmlText += `<span style="color: #4f46e5; font-weight: 700;">Feature: ${feature}</span>`;
      htmlText += `</div>`;
      htmlText += `<div style="background-color: #f8fafc; border-left: 3px solid #cbd5e1; padding: 8px 12px; margin: 4px 0; border-radius: 4px; font-size: 12.5px; color: #1e293b; font-weight: 500;">`;
      htmlText += `<b>Description:</b> ${note}`;
      htmlText += `</div>`;
      htmlText += `</li>`;
    });
    htmlText += `</ol>`;
  }

  htmlText += `</div>`;

  return { plainText, htmlText };
}

/**
 * Copy formatted bug report (text & HTML) to system clipboard
 */
export async function copyBugsToClipboard(bugs: BugLog[], filterOptions?: BugCopyFilterOptions): Promise<boolean> {
  const { plainText, htmlText } = formatBugsToText(bugs, filterOptions);
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      const textBlob = new Blob([plainText], { type: 'text/plain' });
      const htmlBlob = new Blob([htmlText], { type: 'text/html' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': textBlob,
          'text/html': htmlBlob,
        })
      ]);
      return true;
    } else {
      await navigator.clipboard.writeText(plainText);
      return true;
    }
  } catch (err) {
    try {
      await navigator.clipboard.writeText(plainText);
      return true;
    } catch (e) {
      console.error('Failed to copy bugs to clipboard:', e);
      return false;
    }
  }
}

