/**
 * ==============================================================================
 * QA MANAGER - AUTOMATED GOOGLE SHEETS BUG SYNC
 * ==============================================================================
 * This script automatically creates individual tabs for every QA tester,
 * formats columns with smart dropdowns (Bug Type, Priority, Status),
 * renders screenshots via =IMAGE(), and handles real-time bug population
 * directly from Supabase and via webhook.
 */

var SPREADSHEET_ID = "1p5VfZLm5w9w5XGtbmKxroWwUxgWNxcwU8a0DnCoqCBk";
var SUPABASE_URL = "https://hbuvzcxhrkneywabmaod.supabase.co";
var SUPABASE_ANON_KEY = "sb_publishable_M2JvKUmCmgShodNziXNRDw_NwYoN_Rc";

// Dropdown options
var BUG_TYPES = ['Bug', 'Setup Issue', 'Known Issue', 'Feature Request', 'Misc Issue'];
var PRIORITIES = ['P0', 'P1', 'P2', '0', '1', '2'];
var STATUSES = ['Filed', 'New', "Repro'd Issue"];

var HEADERS = [
  'Bug Type',
  'Priority',
  'Status',
  'Timestamp',
  'Feature',
  'Description',
  'Device',
  'Tester',
  'Severity',
  'Test Plan / Step',
  'Screenshot Preview',
  'Screenshot Link',
  'Bug ID'
];

var COLUMN_WIDTHS = [
  120, // A: Bug Type
  90,  // B: Priority
  120, // C: Status
  160, // D: Timestamp
  180, // E: Feature
  380, // F: Description
  90,  // G: Device
  110, // H: Tester
  90,  // I: Severity
  220, // J: Plan / Step
  130, // K: Screenshot Preview
  180, // L: Screenshot Link
  160  // M: Bug ID
];

/**
 * Robust spreadsheet getter (works inside Sheet UI or standalone Web App / Triggers)
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
      '• Tester Tabs: ' + res.testers.join(', ') + '\n' +
      '• Master Tab: All Bugs'
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
      'Your spreadsheet will now automatically pull and sync bugs from the database every 5 minutes.'
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

  // Populate each tester's individual tab
  var testerList = [];
  for (var tester in bugsByTester) {
    testerList.push(tester);
    var sheet = getOrCreateTab(ss, tester);
    appendOrUpdateBugs(sheet, bugsByTester[tester]);
  }

  // Also populate master "All Bugs" tab
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
      '<p>Successfully populated <strong>' + res.totalBugs + ' bug(s)</strong> across individual tester tabs.</p>' +
      '<div class="testers"><strong>Updated Tabs:</strong><br>' + res.testers.join(', ') + ', All Bugs</div>' +
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
      message: 'Successfully processed ' + res.totalBugs + ' bug(s) across ' + res.testers.length + ' tester tab(s).',
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
    .addItem('🎨 Reformat All Tabs & Smart Dropdowns', 'formatAllExistingTabs')
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
    SpreadsheetApp.getUi().alert('All tabs formatted with smart dropdowns and styling!');
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
 * Setup headers, column widths, freeze rows, and smart dropdown data validations
 */
function setupTabFormatting(sheet) {
  // 1. Set headers
  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setBackground('#1E293B'); // Sleek slate dark header
  headerRange.setFontFamily('Arial');
  headerRange.setFontSize(10);
  headerRange.setHorizontalAlignment('left');

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

  // Col B: Priority Dropdown
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

  // 4. Wrap text on Description (Col F)
  sheet.getRange(2, 6, maxRows - 1, 1).setWrap(true);

  // 5. Apply conditional formatting rules for colored chips
  applyConditionalFormatting(sheet);
}

/**
 * Adds smart color rules for dropdowns
 */
function applyConditionalFormatting(sheet) {
  var rules = sheet.getConditionalFormatRules() || [];
  var maxRows = Math.max(sheet.getMaxRows(), 500);

  var bugTypeRange = sheet.getRange(2, 1, maxRows - 1, 1);
  var priorityRange = sheet.getRange(2, 2, maxRows - 1, 1);
  var statusRange = sheet.getRange(2, 3, maxRows - 1, 1);

  // Bug -> Light Yellow (#FEF08A / #713F12)
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

  // Priority P0 or 0 -> Soft Red
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=OR(B2="P0", B2="0", B2=0)')
    .setBackground('#FEE2E2')
    .setFontColor('#991B1B')
    .setBold(true)
    .setRanges([priorityRange])
    .build());

  // Priority P1 or 1 -> Soft Orange
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=OR(B2="P1", B2="1", B2=1)')
    .setBackground('#FFEDD5')
    .setFontColor('#C2410C')
    .setBold(true)
    .setRanges([priorityRange])
    .build());

  // Priority P2 or 2 -> Soft Amber
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=OR(B2="P2", B2="2", B2=2)')
    .setBackground('#FEF9C3')
    .setFontColor('#854D0E')
    .setRanges([priorityRange])
    .build());

  // Status Filed -> Soft Green
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
  var existingIds = {};

  // Build map of existing bug IDs to row index
  if (lastRow > 1) {
    var idColVals = sheet.getRange(2, 13, lastRow - 1, 1).getValues();
    for (var r = 0; r < idColVals.length; r++) {
      var id = idColVals[r][0];
      if (id) {
        existingIds[id] = r + 2; // Row number in sheet
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
    var priority = bug.priority || defaultPrio;
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
    var severity = rawSeverity.toUpperCase();
    var stepTitle = bug.step_title || bug.stepTitle || '';
    var planStep = (bug.planName ? bug.planName + ' - ' : '') + stepTitle;
    
    // Screenshot public proxy URL
    var publicImgUrl = bug.image_url || bug.imageUrl || '';
    if (publicImgUrl && publicImgUrl.indexOf('data:image') === 0) {
      publicImgUrl = 'https://qa-manager-brown.vercel.app/api/bug-image?id=' + encodeURIComponent(bugId);
    }

    var imgFormula = publicImgUrl ? '=IFERROR(IMAGE("' + publicImgUrl + '", 1), "Photo")' : 'None';
    var imgLink = publicImgUrl ? publicImgUrl : 'None';

    var rowValues = [
      bugType,
      priority,
      status,
      formattedTimestamp,
      feature,
      description,
      device,
      tester,
      severity,
      planStep,
      imgFormula,
      imgLink,
      bugId
    ];

    if (existingIds[bugId]) {
      // Update existing row
      var targetRow = existingIds[bugId];
      sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
      if (publicImgUrl && publicImgUrl !== 'None') {
        sheet.setRowHeight(targetRow, 70);
      }
    } else {
      // Append new row
      sheet.appendRow(rowValues);
      var newRow = sheet.getLastRow();
      if (publicImgUrl && publicImgUrl !== 'None') {
        sheet.setRowHeight(newRow, 70);
      }
      existingIds[bugId] = newRow;
    }
  }
}

/**
 * JSON helper
 */
function respondJson(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
