/**
 * ==============================================================================
 * QA MANAGER - AUTOMATED GOOGLE SHEETS BUG SYNC (NATIVE TABLE EDITION)
 * ==============================================================================
 * Automatically creates individual tabs for every QA tester, formats each page
 * with the exact Green Table Theme matching Google Sheets native Tables,
 * interactive filter dropdowns, alternating green row banding, and smart dropdown chips.
 * (Severity, Screenshot Preview, and Bug ID removed; Priority strictly P0, P1, P2)
 */

var SPREADSHEET_ID = "1p5VfZLm5w9w5XGtbmKxroWwUxgWNxcwU8a0DnCoqCBk";
var SUPABASE_URL = "https://hbuvzcxhrkneywabmaod.supabase.co";
var SUPABASE_ANON_KEY = "sb_publishable_M2JvKUmCmgShodNziXNRDw_NwYoN_Rc";

// Exact Table Styling matching user screenshot
var TABLE_HEADER_BG = "#16532B"; // Google Forest Green Header
var TABLE_HEADER_TEXT = "#FFFFFF";

// Dropdown options (P0, P1, P2 only - no numbers)
var BUG_TYPES = ['Bug', 'Setup Issue', 'Known Issue', 'Feature Request', 'Misc Issue'];
var PRIORITIES = ['P0', 'P1', 'P2'];
var STATUSES = ['Filed', 'New', "Repro'd Issue"];

// 10-column Smart Table schema
var HEADERS = [
  'Bug Type',
  'Priority',
  'Status',
  'Timestamp',
  'Feature',
  'Description',
  'Device',
  'Tester',
  'Test Plan / Step',
  'Screenshot Link'
];

var COLUMN_WIDTHS = [
  130, // A: Bug Type
  90,  // B: Priority
  130, // C: Status
  165, // D: Timestamp
  180, // E: Feature
  380, // F: Description
  90,  // G: Device
  110, // H: Tester
  220, // I: Plan / Step
  200  // J: Screenshot Link
];

/**
 * Robust spreadsheet getter (works inside Sheet UI, standalone Web App, or Triggers)
 */
function getSpreadsheet() {
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {}
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * Fetch all bug logs directly from Supabase
 */
function fetchBugsFromSupabase() {
  var url = SUPABASE_URL + "/rest/v1/bug_logs?select=*&order=timestamp.asc";
  var options = {
    method: "get",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + SUPABASE_ANON_KEY
    },
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(url, options);
  var text = response.getContentText();
  try {
    return JSON.parse(text);
  } catch (err) {
    Logger.log("Error parsing Supabase response: " + text);
    return [];
  }
}

/**
 * Master Sync Function: Pulls all bugs from Supabase and populates all tabs
 */
function syncBugsFromDatabase() {
  var bugs = fetchBugsFromSupabase();
  Logger.log("Fetched " + bugs.length + " bugs from Supabase.");
  var result = populateAllBugs(bugs);
  return result;
}

/**
 * UI Menu Action: Sync Bugs Now
 */
function menuSyncNow() {
  var res = syncBugsFromDatabase();
  try {
    SpreadsheetApp.getUi().alert(
      'QA Manager Sync Complete!\n\n' +
      '• Processed: ' + res.totalBugs + ' bug(s)\n' +
      '• Tester Tables: ' + res.testers.join(', ') + '\n' +
      '• Master Table: All Bugs'
    );
  } catch (e) {
    Logger.log("Sync complete: " + JSON.stringify(res));
  }
}

/**
 * Install a 5-minute recurring background sync trigger
 */
function installAutoSyncTrigger() {
  removeAutoSyncTrigger(true);
  ScriptApp.newTrigger('syncBugsFromDatabase')
    .timeBased()
    .everyMinutes(5)
    .create();

  try {
    SpreadsheetApp.getUi().alert(
      'Auto-Sync Enabled!\n\n' +
      'Your spreadsheet will now automatically pull and sync bugs from the database every 5 minutes into smart tables.'
    );
  } catch (e) {}
}

/**
 * Remove auto-sync background trigger
 */
function removeAutoSyncTrigger(silent) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncBugsFromDatabase') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  if (!silent) {
    try {
      SpreadsheetApp.getUi().alert('Auto-Sync has been disabled.');
    } catch (e) {}
  }
}

/**
 * Master bug population function
 */
function populateAllBugs(bugs) {
  var ss = getSpreadsheet();
  if (!Array.isArray(bugs) || bugs.length === 0) {
    return { status: 'no_data', totalBugs: 0, testers: [] };
  }

  // Group bugs by tester name (supporting "John/Justin" or single names)
  var bugsByTester = {};
  for (var i = 0; i < bugs.length; i++) {
    var bug = bugs[i];
    var testerStr = (bug.tester_name || bug.testerName || 'Unassigned').trim();
    var testerNames = testerStr.split(/[\/,]/).map(function(t) { return t.trim(); }).filter(Boolean);
    if (testerNames.length === 0) testerNames = ['Unassigned'];

    for (var t = 0; t < testerNames.length; t++) {
      var name = testerNames[t];
      if (!bugsByTester[name]) bugsByTester[name] = [];
      bugsByTester[name].push(bug);
    }
  }

  // Populate each tester's individual Smart Table tab
  var testerList = [];
  for (var tester in bugsByTester) {
    testerList.push(tester);
    var sheet = getOrCreateTab(ss, tester);
    appendOrUpdateBugs(sheet, bugsByTester[tester]);
  }

  // Also populate master "All Bugs" Smart Table tab
  var allSheet = getOrCreateTab(ss, 'All Bugs');
  appendOrUpdateBugs(allSheet, bugs);

  return {
    status: 'success',
    totalBugs: bugs.length,
    testers: testerList
  };
}

/**
 * Handle HTTP GET - triggers sync and returns rich HTML confirmation
 */
function doGet(e) {
  try {
    var res = syncBugsFromDatabase();
    var html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>QA Manager Sheet Sync</title>' +
      '<style>' +
      'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }' +
      '.card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; max-width: 440px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }' +
      '.badge { display: inline-block; background: #166534; color: #86efac; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 9999px; margin-bottom: 16px; }' +
      'h2 { margin: 0 0 8px; font-size: 20px; color: #ffffff; }' +
      'p { margin: 0 0 20px; color: #94a3b8; font-size: 14px; line-height: 1.5; }' +
      '.testers { background: #0f172a; border-radius: 8px; padding: 12px; font-size: 13px; color: #38bdf8; margin-bottom: 20px; text-align: left; }' +
      '.testers strong { color: #f8fafc; }' +
      '.close-note { font-size: 12px; color: #64748b; }' +
      '</style>' +
      '</head><body>' +
      '<div class="card">' +
      '<div class="badge">SYNC SUCCESSFUL</div>' +
      '<h2>Google Sheet Updated!</h2>' +
      '<p>Successfully populated <strong>' + res.totalBugs + ' bug(s)</strong> across individual tester Smart Tables.</p>' +
      '<div class="testers"><strong>Updated Tables:</strong><br>' + res.testers.join(', ') + ', All Bugs</div>' +
      '<div class="close-note">This window will close automatically in 3 seconds...</div>' +
      '</div>' +
      '<script>setTimeout(function(){ window.close(); }, 3000);</script>' +
      '</body></html>';

    return HtmlService.createHtmlOutput(html)
      .setTitle('QA Manager Sync')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  } catch (err) {
    return HtmlService.createHtmlOutput('<h3>Sync Error: ' + err.toString() + '</h3>');
  }
}

/**
 * Handle HTTP POST webhooks from QA Manager
 */
function doPost(e) {
  try {
    var raw = e && e.postData ? e.postData.contents : null;
    var bugs = [];
    if (raw) {
      var payload = JSON.parse(raw);
      bugs = Array.isArray(payload) ? payload : (payload.bugs || [payload]);
    } else {
      bugs = fetchBugsFromSupabase();
    }

    var res = populateAllBugs(bugs);
    return respondJson({
      status: 'success',
      message: 'Successfully processed ' + res.totalBugs + ' bug(s) across ' + res.testers.length + ' tester table(s).',
      testers: res.testers,
      processedCount: res.totalBugs
    });

  } catch (err) {
    return respondJson({
      status: 'error',
      message: err.toString(),
      stack: err.stack
    });
  }
}

/**
 * Adds custom menu in Google Sheets UI
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('QA Manager')
    .addItem('⚡ Sync Bugs From Database Now', 'menuSyncNow')
    .addItem('⏱️ Enable Auto-Sync (Every 5 Mins)', 'installAutoSyncTrigger')
    .addItem('🛑 Disable Auto-Sync', 'removeAutoSyncTrigger')
    .addSeparator()
    .addItem('🎨 Reformat All Tabs as Green Smart Tables', 'formatAllExistingTabs')
    .addToUi();
}

/**
 * Format all existing tabs with smart dropdowns & styling
 */
function formatAllExistingTabs() {
  var ss = getSpreadsheet();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    setupTabFormatting(sheets[i]);
  }
  try {
    SpreadsheetApp.getUi().alert('All tabs formatted as Green Smart Tables with P0-P2 dropdowns and styling!');
  } catch (e) {}
}

/**
 * Get existing sheet or create new tab with headers & smart dropdowns
 */
function getOrCreateTab(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    setupTabFormatting(sheet);
  }
  return sheet;
}

/**
 * Setup headers, column widths, freeze rows, banded rows, filters, and smart dropdowns
 */
function setupTabFormatting(sheet) {
  // If there are lingering columns from previous 11/12/13-column versions, clear them
  var maxCols = sheet.getMaxColumns();
  if (maxCols > HEADERS.length) {
    try {
      sheet.getRange(1, HEADERS.length + 1, sheet.getMaxRows(), maxCols - HEADERS.length).clear();
    } catch (e) {}
  }

  // 1. Set headers with Google Forest Green background matching user screenshot
  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setFontColor(TABLE_HEADER_TEXT);
  headerRange.setBackground(TABLE_HEADER_BG);
  headerRange.setFontFamily('Arial');
  headerRange.setFontSize(10);
  headerRange.setHorizontalAlignment('left');
  headerRange.setVerticalAlignment('middle');
  sheet.setRowHeight(1, 38);

  // Freeze top row
  sheet.setFrozenRows(1);

  // 2. Set column widths
  for (var c = 0; c < COLUMN_WIDTHS.length; c++) {
    sheet.setColumnWidth(c + 1, COLUMN_WIDTHS[c]);
  }

  // 3. Setup Smart Dropdowns (for rows 2 to 1000)
  var maxRows = Math.max(sheet.getMaxRows(), 500);

  // Col A: Bug Type Dropdown
  var bugTypeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(BUG_TYPES, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(2, 1, maxRows - 1, 1).setDataValidation(bugTypeRule);

  // Col B: Priority Dropdown (P0, P1, P2 only - no numbers!)
  var priorityRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(PRIORITIES, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(2, 2, maxRows - 1, 1).setDataValidation(priorityRule);

  // Col C: Status Dropdown
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUSES, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(2, 3, maxRows - 1, 1).setDataValidation(statusRule);

  // 4. Wrap text on Description (Col F) & vertical middle alignment
  sheet.getRange(2, 6, maxRows - 1, 1).setWrap(true);
  sheet.getRange(2, 1, maxRows - 1, HEADERS.length).setVerticalAlignment('middle');

  // 5. Smart Table Filter (Dropdown filtering & sorting on every header)
  // Preserve existing native table filter if already active
  try {
    var existingFilter = sheet.getFilter();
    if (!existingFilter) {
      var filterRows = Math.max(sheet.getLastRow(), 2);
      sheet.getRange(1, 1, filterRows, HEADERS.length).createFilter();
    }
  } catch (filterErr) {
    Logger.log("Filter notice: " + filterErr);
  }

  // 6. Smart Table Banding (Green theme matching Google Tables)
  try {
    var bandings = sheet.getBandings();
    if (!bandings || bandings.length === 0) {
      var dataRowCount = Math.max(sheet.getLastRow(), 2);
      var tableRange = sheet.getRange(1, 1, dataRowCount, HEADERS.length);
      tableRange.applyRowBanding(SpreadsheetApp.BandingTheme.GREEN, true, false);
    }
  } catch (bandErr) {
    Logger.log("Table banding notice: " + bandErr);
  }

  // 7. Apply smart chip conditional formatting (exact colors matching user screenshot)
  applyConditionalFormatting(sheet);

  // 8. Set comfortable table row heights
  if (sheet.getLastRow() > 1) {
    sheet.setRowHeights(2, sheet.getLastRow() - 1, 34);
  }
}

/**
 * Adds smart color rules for dropdowns matching user screenshot
 */
function applyConditionalFormatting(sheet) {
  var rules = sheet.getConditionalFormatRules() || [];
  var maxRows = Math.max(sheet.getMaxRows(), 500);

  var bugTypeRange = sheet.getRange(2, 1, maxRows - 1, 1);
  var priorityRange = sheet.getRange(2, 2, maxRows - 1, 1);
  var statusRange = sheet.getRange(2, 3, maxRows - 1, 1);

  // Bug -> Light Yellow (#FEF08A / #713F12) - exact match to user screenshot
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Bug')
    .setBackground('#FEF08A')
    .setFontColor('#713F12')
    .setRanges([bugTypeRange])
    .build());

  // Setup Issue -> Gray (#E2E8F0 / #334155)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Setup Issue')
    .setBackground('#E2E8F0')
    .setFontColor('#334155')
    .setRanges([bugTypeRange])
    .build());

  // Known Issue -> Amber (#FEF3C7 / #92400E)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Known Issue')
    .setBackground('#FEF3C7')
    .setFontColor('#92400E')
    .setRanges([bugTypeRange])
    .build());

  // Feature Request -> Soft Purple (#EDE9FE / #5B21B6)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Feature Request')
    .setBackground('#EDE9FE')
    .setFontColor('#5B21B6')
    .setRanges([bugTypeRange])
    .build());

  // Misc Issue -> Blue Gray (#F1F5F9 / #475569)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Misc Issue')
    .setBackground('#F1F5F9')
    .setFontColor('#475569')
    .setRanges([bugTypeRange])
    .build());

  // Priority P0 -> Soft Red
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('P0')
    .setBackground('#FEE2E2')
    .setFontColor('#991B1B')
    .setBold(true)
    .setRanges([priorityRange])
    .build());

  // Priority P1 -> Soft Orange
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('P1')
    .setBackground('#FFEDD5')
    .setFontColor('#C2410C')
    .setBold(true)
    .setRanges([priorityRange])
    .build());

  // Priority P2 -> Soft Yellow/Amber (#FEF9C3 / #854D0E) - exact match to user screenshot
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('P2')
    .setBackground('#FEF9C3')
    .setFontColor('#854D0E')
    .setRanges([priorityRange])
    .build());

  // Status Filed -> Soft Green (#DCFCE7 / #166534) - exact match to user screenshot
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Filed')
    .setBackground('#DCFCE7')
    .setFontColor('#166534')
    .setRanges([statusRange])
    .build());

  // Status New -> Soft Blue
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('New')
    .setBackground('#DBEAFE')
    .setFontColor('#1E40AF')
    .setRanges([statusRange])
    .build());

  // Status Repro'd Issue -> Soft Purple
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("Repro'd Issue")
    .setBackground('#F3E8FF')
    .setFontColor('#6B21A8')
    .setRanges([statusRange])
    .build());

  sheet.setConditionalFormatRules(rules);
}

/**
 * Append or update bugs in a specific sheet
 */
function appendOrUpdateBugs(sheet, bugs) {
  var lastRow = sheet.getLastRow();
  var existingMap = {};

  // Build map of existing bugs by (Timestamp + Feature)
  // Timestamp is Col D (col 4), Feature is Col E (col 5)
  if (lastRow > 1) {
    var numRows = lastRow - 1;
    var keysRange = sheet.getRange(2, 4, numRows, 2).getValues();
    for (var r = 0; r < keysRange.length; r++) {
      var ts = String(keysRange[r][0] || '').trim();
      var feat = String(keysRange[r][1] || '').trim();
      var key = ts + '___' + feat;
      if (key !== '___') {
        existingMap[key] = r + 2; // Row number in sheet
      }
    }
  }

  for (var i = 0; i < bugs.length; i++) {
    var bug = bugs[i];
    var bugId = bug.id || ('bug-' + Date.now() + '-' + i);

    // Format fields (supporting both camelCase and snake_case)
    var bugType = bug.bugType || bug.bug_type || 'Bug';
    var rawSeverity = (bug.severity || 'medium').toLowerCase();
    var defaultPrio = rawSeverity === 'critical' ? 'P0' : rawSeverity === 'high' ? 'P1' : 'P2';
    
    // Normalize Priority: P0, P1, P2 only (no numbers)
    var rawPrio = String(bug.priority || defaultPrio).trim();
    var priority = 'P2';
    if (rawPrio === 'P0' || rawPrio === '0') priority = 'P0';
    else if (rawPrio === 'P1' || rawPrio === '1') priority = 'P1';
    else if (rawPrio === 'P2' || rawPrio === '2') priority = 'P2';

    var status = bug.status || 'Filed';

    var rawTs = bug.timestamp || bug.created_at;
    var formattedTimestamp = '';
    if (rawTs) {
      try {
        var d = new Date(rawTs);
        formattedTimestamp = '[' + (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() + ', ' +
          d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) + ']';
      } catch (e) {
        formattedTimestamp = '[' + (bug.formatted_time || bug.formattedTime || rawTs) + ']';
      }
    } else {
      formattedTimestamp = '[' + (bug.formatted_time || bug.formattedTime || 'N/A') + ']';
    }

    var feature = bug.feature || 'General';
    var description = bug.note || '';
    var device = bug.device_name || bug.deviceName || '';
    var tester = bug.tester_name || bug.testerName || '';
    var stepTitle = bug.step_title || bug.stepTitle || '';
    var planStep = (bug.planName ? bug.planName + ' - ' : '') + stepTitle;
    
    // Screenshot link (hyperlink formula)
    var publicImgUrl = bug.image_url || bug.imageUrl || '';
    if (publicImgUrl && publicImgUrl.indexOf('data:image') === 0) {
      publicImgUrl = 'https://qa-manager-brown.vercel.app/api/bug-image?id=' + encodeURIComponent(bugId);
    }

    var imgLink = (publicImgUrl && publicImgUrl !== 'None')
      ? '=HYPERLINK("' + publicImgUrl + '", "View Screenshot")'
      : 'None';

    var bugKey = formattedTimestamp.trim() + '___' + feature.trim();

    // Preserve manual sheet dropdown changes if row already exists
    if (existingMap[bugKey]) {
      var targetRow = existingMap[bugKey];
      var existingRowVals = sheet.getRange(targetRow, 1, 1, 3).getValues()[0];
      if (existingRowVals[0]) bugType = existingRowVals[0];
      if (existingRowVals[1]) priority = existingRowVals[1];
      if (existingRowVals[2]) status = existingRowVals[2];

      var rowValues = [
        bugType,
        priority,
        status,
        formattedTimestamp,
        feature,
        description,
        device,
        tester,
        planStep,
        imgLink
      ];

      sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
      sheet.setRowHeight(targetRow, 34);
    } else {
      var rowValues = [
        bugType,
        priority,
        status,
        formattedTimestamp,
        feature,
        description,
        device,
        tester,
        planStep,
        imgLink
      ];

      sheet.appendRow(rowValues);
      var newRow = sheet.getLastRow();
      sheet.setRowHeight(newRow, 34);
      existingMap[bugKey] = newRow;
    }
  }

  // Update table banding and filter safely without disturbing native tables
  try {
    var finalRows = Math.max(sheet.getLastRow(), 2);
    var filter = sheet.getFilter();
    if (!filter) {
      sheet.getRange(1, 1, finalRows, HEADERS.length).createFilter();
    }

    var bandings = sheet.getBandings();
    if (!bandings || bandings.length === 0) {
      sheet.getRange(1, 1, finalRows, HEADERS.length).applyRowBanding(SpreadsheetApp.BandingTheme.GREEN, true, false);
    }
  } catch (e) {}
}

/**
 * JSON helper
 */
function respondJson(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
