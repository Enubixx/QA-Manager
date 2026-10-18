import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile } from '../types';
import { getLocalDateStr } from './dateUtils';

/**
 * Download a string content as a file in browser
 */
function downloadFile(content: string, filename: string, contentType: string = 'application/json;charset=utf-8;') {
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

export interface FullQABackupExtra {
  archivedRuns?: TestRun[];
  devices?: DeviceProfile[];
  testers?: TesterProfile[];
  populatedFeatures?: string[];
  populatedDevices?: string[];
}

/**
 * Export All QA Data (Plans, Runs, Bugs, plus optional Archived Runs, Devices, Testers, Populated Features/Devices) to JSON for Backup & Team Sharing
 */
export function exportAllQADataToJSON(
  plans: TestPlan[],
  runs: TestRun[],
  bugLogs: BugLog[],
  archivedRunsOrExtra?: TestRun[] | FullQABackupExtra,
  devices?: DeviceProfile[],
  testers?: TesterProfile[],
  populatedFeatures?: string[],
  populatedDevices?: string[]
) {
  const extra: FullQABackupExtra = Array.isArray(archivedRunsOrExtra)
    ? { archivedRuns: archivedRunsOrExtra, devices, testers, populatedFeatures, populatedDevices }
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
  if (extra.populatedDevices !== undefined) exportPayload.populatedDevices = extra.populatedDevices;

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const fileName = `QA_Flow_Studio_Backup_${getLocalDateStr()}.json`;
  downloadFile(jsonString, fileName, 'application/json;charset=utf-8;');
}
