/**
 * ==============================================================================
 * QA MANAGER - AUTOMATED GOOGLE SHEETS BUG SYNC (DYNAMIC TEMPLATE EDITION)
 * ==============================================================================
 * Automatically creates individual tabs for every QA tester, reads the custom
 * column widths, text wrapping, and alignment settings from the user-formatted
 * "All Bugs" tab, and applies them to every tester tab and any new tab created.
 * (Severity, Screenshot Preview, and Bug ID removed; Priority strictly P0, P1, P2)
 */

var SPREADSHEET_ID = "1p5VfZLm5w9w5XGtbmKxroWwUxgWNxcwU8a0DnCoqCBk";
var SUPABASE_URL = "https://hbuvzcxhrkneywabmaod.supabase.co";
var SUPABASE_ANON_KEY = "sb_publishable_M2JvKUmCmgShodNziXNRDw_NwYoN_Rc";

// Exact Table Styling matching user screenshot
var TABLE_HEADER_BG = "#16532B"; // Google Forest Green Header
var TABLE_HEADER_TEXT = "#FFFFFF";

// Dropdown options (P0, P1, P2 only - strictly no numbers)
var BUG_TYPES = ['Bug', 'Setup Issue', 'Known Issue', 'Feature Request', 'Misc Issue'];
var PRIORITIES = ['P0', 'P1', 'P2'];
var STATUSES = ['Filed', 'New', "Repro'd Issue"];

// Exactly 10 columns - strictly aligned 1:1 with row data
var HEADERS = [
  'Bug Type',         // Col 1 (A)
  'Priority',         // Col 2 (B)
  'Status',           // Col 3 (C)
  'Timestamp',        // Col 4 (D)
  'Feature',          // Col 5 (E)
  'Description',      // Col 6 (F)
  'Device',           // Col 7 (G)
  'Tester',           // Col 8 (H)
  'Test Plan / Step', // Col 9 (I)
  'Screenshot Link'   // Col 10 (J)
];

// Default column widths (used only if All Bugs tab is not yet formatted)
var COLUMN_WIDTHS = [
  130, // Col 1 (A): Bug Type
  90,  // Col 2 (B): Priority
  130, // Col 3 (C): Status
  165, // Col 4 (D): Timestamp
  180, // Col 5 (E): Feature
  380, // Col 6 (F): Description
  90,  // Col 7 (G): Device
  110, // Col 8 (H): Tester
  220, // Col 9 (I): Test Plan / Step
  200  // Col 10 (J): Screenshot Link
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
 * Fetch all bug logs directly from Supabase (combining bug_logs table, test_runs, and archived_runs)
 */
function fetchBugsFromSupabase() {
  var headers = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": "Bearer " + SUPABASE_ANON_KEY
  };
  var options = {
    method: "get",
    headers: headers,
    muteHttpExceptions: true
  };

  var bugMap = {};

  // 1. Fetch direct bug_logs table
  try {
    var bugsUrl = SUPABASE_URL + "/rest/v1/bug_logs?select=*&order=timestamp.asc";
    var resBugs = UrlFetchApp.fetch(bugsUrl, options);
    var bugsList = JSON.parse(resBugs.getContentText() || '[]');
    if (Array.isArray(bugsList)) {
      for (var i = 0; i < bugsList.length; i++) {
        var b = bugsList[i];
        if (b && b.id) {
          bugMap[b.id] = b;
        }
      }
    }
  } catch (e) {
    Logger.log("Error fetching bug_logs: " + e);
  }

  // 2. Fetch test_runs to catch any embedded bugs logged during testing
  try {
    var runsUrl = SUPABASE_URL + "/rest/v1/test_runs?select=id,bug_logs";
    var resRuns = UrlFetchApp.fetch(runsUrl, options);
    var runsList = JSON.parse(resRuns.getContentText() || '[]');
    if (Array.isArray(runsList)) {
      for (var r = 0; r < runsList.length; r++) {
        var runBugs = runsList[r].bug_logs;
        if (Array.isArray(runBugs)) {
          for (var rb = 0; rb < runBugs.length; rb++) {
            var item = runBugs[rb];
            if (item && item.id && !bugMap[item.id]) {
              bugMap[item.id] = item;
            }
          }
        }
      }
    }
  } catch (e) {
    Logger.log("Error fetching test_runs: " + e);
  }

  // 3. Fetch archived_runs for completed test runs
  try {
    var archUrl = SUPABASE_URL + "/rest/v1/archived_runs?select=id,bug_logs";
    var resArch = UrlFetchApp.fetch(archUrl, options);
    var archList = JSON.parse(resArch.getContentText() || '[]');
    if (Array.isArray(archList)) {
      for (var a = 0; a < archList.length; a++) {
        var archBugs = archList[a].bug_logs;
        if (Array.isArray(archBugs)) {
          for (var ab = 0; ab < archBugs.length; ab++) {
            var aItem = archBugs[ab];
            if (aItem && aItem.id && !bugMap[aItem.id]) {
              bugMap[aItem.id] = aItem;
            }
          }
        }
      }
    }
  } catch (e) {
    Logger.log("Error fetching archived_runs: " + e);
  }

  var combined = [];
  for (var k in bugMap) {
    combined.push(bugMap[k]);
  }

  // Sort chronologically by timestamp ascending
  combined.sort(function(a, b) {
    var tA = new Date(a.timestamp || a.created_at || 0).getTime();
    var tB = new Date(b.timestamp || b.created_at || 0).getTime();
    return tA - tB;
  });

  return combined;
}

/**
 * Compute lightweight MD5 signature of bugs to prevent unnecessary sheet rewrites
 */
function getBugsSignature(bugs) {
  if (!bugs || bugs.length === 0) return 'empty';
  var str = '';
  for (var i = 0; i < bugs.length; i++) {
    var b = bugs[i];
    str += (b.id || '') + ':' + (b.timestamp || '') + ':' + (b.status || '') + ':' + (b.priority || '') + ';';
  }
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str));
}

/**
 * Dynamically extract column widths, wrapping settings, and alignments from "All Bugs" tab
 */
function getTemplateSettingsFromAllBugs(ss) {
  var allBugsSheet = ss.getSheetByName('All Bugs') || ss.getSheetByName('all bugs');
  if (!allBugsSheet) return null;

  var settings = [];
  var lastCol = Math.min(allBugsSheet.getMaxColumns(), HEADERS.length);
  for (var c = 1; c <= lastCol; c++) {
    try {
      var width = allBugsSheet.getColumnWidth(c);
      var sampleCell = allBugsSheet.getRange(2, c);
      var wrap = sampleCell.getWrap();
      var wrapStrategy = sampleCell.getWrapStrategy();
      var hAlign = sampleCell.getHorizontalAlignment();
      var vAlign = sampleCell.getVerticalAlignment();
      settings.push({
        col: c,
        width: width,
        wrap: wrap,
        wrapStrategy: wrapStrategy,
        hAlign: hAlign,
        vAlign: vAlign
      });
    } catch (err) {
      Logger.log("Error reading settings for col " + c + ": " + err);
    }
  }
  return settings.length > 0 ? settings : null;
}

/**
 * Master Sync Function: Pulls all bugs from Supabase, updates headers,
 * copies custom formatting from "All Bugs" to every other tab, and populates data.
 * @param {boolean} [force=false] Set true to bypass signature check and force rewrite
 */
function syncBugsFromDatabase(force) {
  var bugs = fetchBugsFromSupabase();
  Logger.log("Fetched " + bugs.length + " bugs from Supabase.");
  if (!bugs || bugs.length === 0) {
    return { status: 'no_data', totalBugs: 0, testers: [] };
  }

  var props = PropertiesService.getScriptProperties();
  var currentSig = getBugsSignature(bugs);
  var lastSig = props.getProperty('LAST_BUGS_SYNC_SIGNATURE');

  if (force !== true && currentSig === lastSig) {
    Logger.log("No new or modified bugs detected. Skipping sheet rewrite.");
    return { status: 'skipped_no_changes', totalBugs: bugs.length, testers: [] };
  }

  var result = populateAllBugs(bugs);
  props.setProperty('LAST_BUGS_SYNC_SIGNATURE', currentSig);
  return result;
}

/**
 * UI Menu Action: Sync Bugs Now (Force Refresh)
 */
function menuSyncNow() {
  var res = syncBugsFromDatabase(true);
  try {
    SpreadsheetApp.getUi().alert(
      'QA Manager Sync Complete!\n\n' +
      '• Processed: ' + res.totalBugs + ' bug(s)\n' +
      '• Tester Tabs Formatted from "All Bugs": ' + res.testers.join(', ') + '\n' +
      '• Master Table: All Bugs (preserved user formatting)'
    );
  } catch (e) {
    Logger.log("Sync complete: " + JSON.stringify(res));
  }
}

/**
 * Dedicated UI Action: Copy formatting from "All Bugs" to all other tabs immediately
 */
function copySettingsFromAllBugs() {
  var ss = getSpreadsheet();
  var allBugsSheet = ss.getSheetByName('All Bugs') || ss.getSheetByName('all bugs');
  if (!allBugsSheet) {
    try {
      SpreadsheetApp.getUi().alert('Could not find "All Bugs" tab to copy formatting from.');
    } catch (e) {}
    return;
  }

  var templateSettings = getTemplateSettingsFromAllBugs(ss);
  if (!templateSettings) {
    try {
      SpreadsheetApp.getUi().alert('Could not read formatting from "All Bugs".');
    } catch (e) {}
    return;
  }

  var sheets = ss.getSheets();
  var count = 0;
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    if (sheet.getName().toLowerCase() !== 'all bugs') {
      setupTabFormatting(sheet, templateSettings, false);
      count++;
    }
  }

  try {
    SpreadsheetApp.getUi().alert(
      'Formatting Copied Successfully!\n\n' +
      'Copied column widths and text wrapping from "All Bugs" to ' + count + ' tab(s).'
    );
  } catch (e) {}
}

/**
 * Install a 1-minute recurring background sync trigger
 * Automatically pulls and syncs fresh bugs every 60 seconds 24/7 on Google Cloud
 */
function installAutoSyncTrigger() {
  removeAutoSyncTrigger(true);
  ScriptApp.newTrigger('autoPullAndSyncFromSupabase')
    .timeBased()
    .everyMinutes(1)
    .create();

  try {
    SpreadsheetApp.getUi().alert(
      '⏱️ 1-Minute Auto-Sync Enabled!\n\n' +
      'Your spreadsheet will now automatically pull and sync fresh bugs from the database every 1 minute into smart tables.\n\n' +
      'This runs in the background 24/7 on Google Cloud even when your spreadsheet or computer is closed.'
    );
  } catch (e) {
    Logger.log("1-minute auto-sync trigger installed.");
  }
}

/**
 * Background trigger handler executed every 1 minute
 */
function autoPullAndSyncFromSupabase() {
  try {
    var result = syncBugsFromDatabase(false);
    Logger.log("Auto-sync 1-minute result: " + JSON.stringify(result));
  } catch (err) {
    Logger.log("Auto-sync 1-minute error: " + err.toString());
  }
}

/**
 * Remove auto-sync background trigger
 */
function removeAutoSyncTrigger(silent) {
  var triggers = ScriptApp.getProjectTriggers();
  var count = 0;
  for (var i = 0; i < triggers.length; i++) {
    var func = triggers[i].getHandlerFunction();
    if (func === 'syncBugsFromDatabase' || func === 'autoPullAndSyncFromSupabase') {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }
  if (!silent) {
    try {
      SpreadsheetApp.getUi().alert(
        '🛑 Auto-Sync Disabled\n\n' +
        'Removed background trigger(s). Automatic 1-minute syncing stopped.'
      );
    } catch (e) {}
  }
}

/**
 * Check whether the 1-minute auto-sync trigger is currently active
 */
function checkAutoSyncStatus() {
  var triggers = ScriptApp.getProjectTriggers();
  var isEnabled = false;
  for (var i = 0; i < triggers.length; i++) {
    var func = triggers[i].getHandlerFunction();
    if (func === 'syncBugsFromDatabase' || func === 'autoPullAndSyncFromSupabase') {
      isEnabled = true;
      break;
    }
  }
  try {
    SpreadsheetApp.getUi().alert(
      'Auto-Sync Status:\n\n' +
      (isEnabled 
        ? '✅ ACTIVE: Automatically pulling fresh bugs every 1 minute.' 
        : '❌ INACTIVE: Auto-sync is currently turned off.')
    );
  } catch (e) {}
}

/**
 * Master bug population function - formats headers & copies "All Bugs" template to every tab
 */
function populateAllBugs(bugs) {
  var ss = getSpreadsheet();
  if (!Array.isArray(bugs) || bugs.length === 0) {
    return { status: 'no_data', totalBugs: 0, testers: [] };
  }

  // 1. Extract the user-customized column widths and wrapping from "All Bugs"
  var templateSettings = getTemplateSettingsFromAllBugs(ss);

  // 2. Group bugs by tester name (supporting "John/Justin" or single names)
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

  // 3. Populate each tester's individual tab using settings from "All Bugs"
  var testerList = [];
  for (var tester in bugsByTester) {
    testerList.push(tester);
    var sheet = getOrCreateTab(ss, tester);
    setupTabFormatting(sheet, templateSettings, false); // Applies All Bugs formatting
    appendOrUpdateBugs(sheet, bugsByTester[tester]);
  }

  // 4. Populate master "All Bugs" tab (preserving user's customized column sizes and wrapping!)
  var allSheet = getOrCreateTab(ss, 'All Bugs');
  setupTabFormatting(allSheet, null, true); // isAllBugs = true, preserves widths & wrapping!
  appendOrUpdateBugs(allSheet, bugs);

  return {
    status: 'success',
    totalBugs: bugs.length,
    testers: testerList
  };
}

/**
 * Handle HTTP GET - triggers sync or manages 1-minute auto-sync trigger
 */
function doGet(e) {
  try {
    var action = e && e.parameter ? e.parameter.action : null;
    if (action === 'enable_auto_sync') {
      installAutoSyncTrigger();
      return respondJson({ status: 'success', message: 'Auto-sync trigger (every 1 minute) installed successfully.' });
    }
    if (action === 'disable_auto_sync') {
      removeAutoSyncTrigger(true);
      return respondJson({ status: 'success', message: 'Auto-sync trigger removed successfully.' });
    }

    var res = syncBugsFromDatabase(true);
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
      '<p>Successfully populated <strong>' + res.totalBugs + ' bug(s)</strong> with formatting copied from <strong>All Bugs</strong>.</p>' +
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
      message: 'Successfully processed ' + res.totalBugs + ' bug(s) with formatting from All Bugs.',
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
    .addItem('⚡ Sync Bugs & Copy "All Bugs" Format', 'menuSyncNow')
    .addItem('📋 Copy Formatting from "All Bugs" to All Tabs', 'copySettingsFromAllBugs')
    .addSeparator()
    .addItem('⏱️ Enable Auto-Sync (Every 1 Min)', 'installAutoSyncTrigger')
    .addItem('🛑 Disable Auto-Sync', 'removeAutoSyncTrigger')
    .addItem('ℹ️ Check Auto-Sync Status', 'checkAutoSyncStatus')
    .addSeparator()
    .addItem('🎨 Reformat All Tabs as Green Smart Tables', 'formatAllExistingTabs')
    .addToUi();
}

/**
 * Format all existing tabs with smart dropdowns & styling
 */
function formatAllExistingTabs() {
  var ss = getSpreadsheet();
  var templateSettings = getTemplateSettingsFromAllBugs(ss);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var isAllBugs = sheet.getName().toLowerCase() === 'all bugs';
    setupTabFormatting(sheet, templateSettings, isAllBugs);
  }
  try {
    SpreadsheetApp.getUi().alert('All tabs updated with column sizes and text wrapping copied from "All Bugs"!');
  } catch (e) {}
}

/**
 * Get existing sheet or create new tab
 */
function getOrCreateTab(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  return sheet;
}

/**
 * Setup headers, column widths, delete legacy extra columns, freeze rows, and set dropdowns
 * If templateSettings is provided, copies column sizes, wrapping, and alignments from "All Bugs".
 * If isAllBugs is true, preserves user's column sizes and wrapping intact!
 */
function setupTabFormatting(sheet, templateSettings, isAllBugs) {
  // 1. Delete or clear any lingering legacy columns (Col 11, 12, 13) from previous versions
  var maxCols = sheet.getMaxColumns();
  if (maxCols > HEADERS.length) {
    try {
      sheet.getRange(1, HEADERS.length + 1, sheet.getMaxRows(), maxCols - HEADERS.length).clear();
      sheet.deleteColumns(HEADERS.length + 1, maxCols - HEADERS.length);
    } catch (e) {
      Logger.log("Notice deleting extra columns: " + e);
    }
  }

  // 2. Set exact 10 headers with Google Forest Green background matching user screenshot
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

  // 3. Set column widths & wrapping (copied from All Bugs if available)
  if (!isAllBugs && templateSettings && templateSettings.length > 0) {
    var maxRows = Math.max(sheet.getMaxRows(), 500);
    for (var i = 0; i < templateSettings.length; i++) {
      var s = templateSettings[i];
      if (s.width && s.width > 0) {
        sheet.setColumnWidth(s.col, s.width);
      }
      var colRange = sheet.getRange(2, s.col, maxRows - 1, 1);
      if (s.wrapStrategy) {
        try { colRange.setWrapStrategy(s.wrapStrategy); } catch (wErr) { colRange.setWrap(s.wrap); }
      } else if (typeof s.wrap === 'boolean') {
        colRange.setWrap(s.wrap);
      }
      if (s.hAlign && s.hAlign !== 'general') colRange.setHorizontalAlignment(s.hAlign);
      if (s.vAlign) colRange.setVerticalAlignment(s.vAlign);
    }
  } else if (!isAllBugs) {
    // Fallback default column widths if templateSettings not yet available
    for (var c = 0; c < COLUMN_WIDTHS.length; c++) {
      sheet.setColumnWidth(c + 1, COLUMN_WIDTHS[c]);
    }
    sheet.getRange(2, 6, Math.max(sheet.getMaxRows(), 500) - 1, 1).setWrap(true);
  }

  // 4. Setup Smart Dropdowns (for rows 2 to 1000)
  var maxRows = Math.max(sheet.getMaxRows(), 500);

  // Col A: Bug Type Dropdown
  var bugTypeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(BUG_TYPES, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(2, 1, maxRows - 1, 1).setDataValidation(bugTypeRule);

  // Col B: Priority Dropdown (P0, P1, P2 only - strictly no numbers!)
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

  // 5. Smart Table Filter (Dropdown filtering & sorting on every header)
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

  // 8. Set comfortable table row heights (preserve All Bugs if already formatted)
  if (!isAllBugs && sheet.getLastRow() > 1) {
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

  // Priority P0 -> Soft Red (#FEE2E2 / #991B1B)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('P0')
    .setBackground('#FEE2E2')
    .setFontColor('#991B1B')
    .setBold(true)
    .setRanges([priorityRange])
    .build());

  // Priority P1 -> Soft Orange (#FFEDD5 / #C2410C)
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
 * Append or update bugs in a specific sheet - strictly aligns all 10 columns
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
    
    // Normalize Priority: P0, P1, P2 only (strictly no numbers)
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

    // Preserve manual sheet dropdown changes only if valid dropdown value
    if (existingMap[bugKey]) {
      var targetRow = existingMap[bugKey];
      var existingRowVals = sheet.getRange(targetRow, 1, 1, 3).getValues()[0];
      if (existingRowVals[0] && BUG_TYPES.indexOf(existingRowVals[0]) !== -1) bugType = existingRowVals[0];
      if (existingRowVals[1] && PRIORITIES.indexOf(existingRowVals[1]) !== -1) priority = existingRowVals[1];
      if (existingRowVals[2] && STATUSES.indexOf(existingRowVals[2]) !== -1) status = existingRowVals[2];

      // Exact 10-column values aligned 1:1 with HEADERS
      var rowValues = [
        bugType,            // Col 1 (A): Bug Type
        priority,           // Col 2 (B): Priority
        status,             // Col 3 (C): Status
        formattedTimestamp, // Col 4 (D): Timestamp
        feature,            // Col 5 (E): Feature
        description,        // Col 6 (F): Description
        device,             // Col 7 (G): Device
        tester,             // Col 8 (H): Tester
        planStep,           // Col 9 (I): Test Plan / Step
        imgLink             // Col 10 (J): Screenshot Link
      ];

      sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
      sheet.setRowHeight(targetRow, 34);
    } else {
      // Exact 10-column values aligned 1:1 with HEADERS
      var rowValues = [
        bugType,            // Col 1 (A): Bug Type
        priority,           // Col 2 (B): Priority
        status,             // Col 3 (C): Status
        formattedTimestamp, // Col 4 (D): Timestamp
        feature,            // Col 5 (E): Feature
        description,        // Col 6 (F): Description
        device,             // Col 7 (G): Device
        tester,             // Col 8 (H): Tester
        planStep,           // Col 9 (I): Test Plan / Step
        imgLink             // Col 10 (J): Screenshot Link
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
