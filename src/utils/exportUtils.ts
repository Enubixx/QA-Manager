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

