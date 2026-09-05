export const GOOGLE_APPS_SCRIPT_CODE = `/**
 * ==============================================================================
 * QA MANAGER - AUTOMATED GOOGLE SHEETS BUG SYNC
 * ==============================================================================
 * This script automatically creates individual tabs for every QA tester,
 * formats columns with smart dropdowns (Bug Type, Priority, Status),
 * renders screenshots via =IMAGE(), and handles real-time bug population.
 */

// Dropdown options
var BUG_TYPES = ['Bug', 'Setup Issue', 'Known Issue', 'Feature Request', 'Misc Issue'];
var PRIORITIES = ['P0', 'P1', 'P2'];
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
 * Handle HTTP POST webhooks from QA Manager
 */
function doPost(e) {
  try {
    var raw = e && e.postData ? e.postData.contents : null;
    if (!raw) {
      return respondJson({ status: 'error', message: 'No postData payload received' });
    }

    var payload = JSON.parse(raw);
    var bugs = Array.isArray(payload) ? payload : (payload.bugs || [payload]);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var processedCount = 0;

    // Group bugs by tester name (supporting "John/Justin" or single names)
    var bugsByTester = {};
    for (var i = 0; i < bugs.length; i++) {
      var bug = bugs[i];
      var testerStr = (bug.testerName || 'Unassigned').trim();
      var testerNames = testerStr.split(/[\\/,]/).map(function(t) { return t.trim(); }).filter(Boolean);
      if (testerNames.length === 0) testerNames = ['Unassigned'];

      for (var t = 0; t < testerNames.length; t++) {
        var name = testerNames[t];
        if (!bugsByTester[name]) bugsByTester[name] = [];
        bugsByTester[name].push(bug);
      }
    }

    // Populate each tester's individual tab
    for (var tester in bugsByTester) {
      var sheet = getOrCreateTab(ss, tester);
      appendOrUpdateBugs(sheet, bugsByTester[tester]);
      processedCount += bugsByTester[tester].length;
    }

    // Also populate master "All Bugs" tab
    var allSheet = getOrCreateTab(ss, 'All Bugs');
    appendOrUpdateBugs(allSheet, bugs);

    return respondJson({
      status: 'success',
      message: 'Successfully processed ' + bugs.length + ' bug(s) across ' + Object.keys(bugsByTester).length + ' tester tab(s).',
      processedCount: bugs.length
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
 * Handle HTTP GET for easy testing in browser
 */
function doGet(e) {
  return respondJson({
    status: 'ok',
    message: 'QA Manager Google Apps Script Webhook is active and ready to receive bugs!'
  });
}

/**
 * Adds custom menu in Google Sheets UI
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('QA Manager')
    .addItem('Reformat All Tabs & Dropdowns', 'formatAllExistingTabs')
    .addItem('Setup Master Tabs', 'setupAllTabs')
    .addToUi();
}

/**
 * Format all existing tabs with smart dropdowns & styling
 */
function formatAllExistingTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    setupTabFormatting(sheets[i]);
  }
  SpreadsheetApp.getUi().alert('All tabs formatted with smart dropdowns and styling!');
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

  // Setup Issue -> Gray
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Setup Issue')
    .setBackground('#E2E8F0')
    .setFontColor('#334155')
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

  // Priority P2 -> Soft Amber
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('P2')
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

    // Format fields
    var bugType = bug.bugType || 'Bug';
    var priority = bug.priority || (bug.severity === 'critical' ? 'P0' : bug.severity === 'high' ? 'P1' : 'P2');
    var status = bug.status || 'Filed';

    var formattedTimestamp = '';
    if (bug.timestamp) {
      try {
        var d = new Date(bug.timestamp);
        formattedTimestamp = '[' + (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() + ', ' +
          d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) + ']';
      } catch (e) {
        formattedTimestamp = '[' + (bug.formattedTime || bug.timestamp) + ']';
      }
    } else {
      formattedTimestamp = '[' + (bug.formattedTime || 'N/A') + ']';
    }

    var feature = bug.feature || 'General';
    var description = bug.note || '';
    var device = bug.deviceName || '';
    var tester = bug.testerName || '';
    var severity = (bug.severity || 'medium').toUpperCase();
    var planStep = (bug.planName ? bug.planName + ' - ' : '') + (bug.stepTitle || '');
    
    // Screenshot public proxy URL
    var publicImgUrl = bug.imageUrl || '';
    if (publicImgUrl.startsWith('data:image')) {
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
      if (publicImgUrl) {
        sheet.setRowHeight(targetRow, 70);
      }
    } else {
      // Append new row
      sheet.appendRow(rowValues);
      var newRow = sheet.getLastRow();
      if (publicImgUrl) {
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
`;
