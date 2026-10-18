import { spawn } from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 5199;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForServer(url, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for Vite server at ${url}`);
}

async function clickCardByTitle(page, title) {
  await page.evaluate(t => {
    const map = {
      'Test Plans': 'nav-tab-overview',
      'Devices & Testers': 'nav-tab-floor',
      'Floor': 'nav-tab-floor',
      'CUJ Report': 'nav-tab-features',
      'Bugs Feed': 'nav-tab-bugs',
      'Bugs': 'nav-tab-bugs',
    };
    const testId = map[t];
    if (testId) {
      const btn = document.querySelector(`[data-testid="${testId}"]`);
      if (btn) {
        btn.click();
        return;
      }
    }
    const navButtons = Array.from(document.querySelectorAll('[data-testid="navbar-tabs"] button'));
    const navBtn = navButtons.find(b => b.textContent && b.textContent.includes(t));
    if (navBtn) {
      navBtn.click();
      return;
    }
    const cards = Array.from(document.querySelectorAll('.liquid-glass-card'));
    const card = cards.find(c => c.textContent && c.textContent.includes(t));
    if (!card) throw new Error(`Top navigation tab "${t}" not found`);
    card.click();
  }, title);
  await new Promise(r => setTimeout(r, 250));
}

async function runE2ESmoke() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const viteProc = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'pipe',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
      VITE_PROTOTYPE_SEED_URL: '',
    },
  });

  let browser;
  try {
    await waitForServer(baseUrl);

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', err => {
      consoleErrors.push(String(err));
    });

    // 1. Seed deterministic offline state (device in pool with 0 active quotas so Start-of-day Activate works)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 60000 });
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        await new Promise(r => setTimeout(r, 500));
      }
    }
    await page.waitForSelector('#root', { timeout: 60000 });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('qa_prototype_seeded', 'skip');
      localStorage.setItem(
        'qa_test_plans',
        JSON.stringify([
          {
            id: 'plan-e2e-1',
            name: 'E2E Core Plan',
            description: 'Deterministic E2E smoke test plan',
            createdAt: new Date().toISOString(),
            steps: [
              {
                id: 'step-e2e-1',
                title: 'Verify Notification Banner',
                feature: 'Notifications',
                description: 'Send a test notification and verify banner appears on HUD.',
                expectedResult: 'Banner renders clearly within 2s.',
              },
              {
                id: 'step-e2e-2',
                title: 'Verify Camera Capture',
                feature: 'Camera',
                description: 'Press capture button once.',
                expectedResult: 'Photo saved with shutter sound.',
              },
            ],
          },
        ])
      );
      localStorage.setItem(
        'qa_testers_list',
        JSON.stringify([{ id: 'tester-e2e-1', name: 'Alice E2E' }])
      );
      localStorage.setItem(
        'qa_devices_list',
        JSON.stringify([{ id: 'dev-e2e-1', name: 'WP-E2E-01', isReady: true, quotas: [] }])
      );
      localStorage.setItem('qa_populated_devices', JSON.stringify(['WP-E2E-01']));
      localStorage.setItem('qa_populated_features', JSON.stringify(['Notifications', 'Camera']));
      localStorage.setItem('qa_test_runs', JSON.stringify([]));
      localStorage.setItem('qa_archived_runs', JSON.stringify([]));
      localStorage.setItem('qa_bug_logs', JSON.stringify([]));
    });

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => document.body && document.body.innerText.includes('E2E Core Plan'),
      { timeout: 60000 }
    );

    // 2. Verify Test Plans tab renders, columns align, & honest offline sync badge in sandbox
    const bodyTextPlans = await page.evaluate(() => document.body.innerText);
    assert.ok(bodyTextPlans.includes('E2E Core Plan'), 'Test Plans tab must render E2E Core Plan');

    const colAlignment = await page.evaluate(() => {
      const pairs = [
        ['[data-testid="plans-col-header-plan"]', '[data-testid="test-plan-name-cell"]'],
        ['[data-testid="plans-col-header-steps"]', '[data-testid="test-plan-steps"]'],
        ['[data-testid="plans-col-header-lastrun"]', '[data-testid="test-plan-last-run"]'],
        ['[data-testid="plans-col-header-today"]', '[data-testid="test-plan-today"]'],
        ['[data-testid="plans-col-header-bugs"]', '[data-testid="test-plan-bugs"]'],
      ];
      return pairs.map(([hSel, rSel]) => {
        const h = document.querySelector(hSel)?.getBoundingClientRect();
        const r = document.querySelector(rSel)?.getBoundingClientRect();
        return { hSel, diff: h && r ? Math.abs(h.left - r.left) : 999 };
      });
    });
    for (const c of colAlignment) {
      assert.ok(c.diff <= 2, `Expected column ${c.hSel} to align with row cell within 2px, got diff=${c.diff}px`);
    }

    const syncBadge = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="navbar-sync-status"]');
      return el ? { state: el.getAttribute('data-sync-state'), text: el.textContent?.trim() } : null;
    });
    assert.ok(
      syncBadge && syncBadge.state === 'offline' && syncBadge.text?.includes('Offline · saved on this device'),
      `Expected offline sync badge in offline sandbox, got: ${JSON.stringify(syncBadge)}`
    );

    // 3. Navigate to Devices & Testers tab and activate WP-E2E-01 onto the floor
    await clickCardByTitle(page, 'Devices & Testers');

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Activate')
      );
      if (!btn) throw new Error('Start-of-day Activate button not found');
      btn.click();
    });
    await new Promise(r => setTimeout(r, 250));

    const floorAfterActivate = await page.evaluate(() => document.body.innerText);
    assert.ok(floorAfterActivate.includes('WP-E2E-01'), 'Activated device WP-E2E-01 must appear on floor');
    assert.ok(floorAfterActivate.includes('0/2'), 'Activated device must show 0/2 initial quota');

    // 4. Verify CUJ Report tab renders with compact header, empty state, and ⋯ menu
    await clickCardByTitle(page, 'CUJ Report');
    const cujText = await page.evaluate(() => document.body.innerText);
    assert.ok(
      cujText.includes('CUJ Report') && cujText.includes('No completed runs today'),
      'CUJ Report tab must render compact header and empty state'
    );
    const cujMenuBtn = await page.$('[data-testid="cuj-menu-button"]');
    assert.ok(cujMenuBtn, 'CUJ Report ⋯ menu button must exist');
    await cujMenuBtn.click();
    await new Promise(r => setTimeout(r, 100));
    const cujMenuText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="cuj-menu-dropdown"]');
      return el ? el.textContent : '';
    });
    assert.ok(
      cujMenuText?.includes('Add feature') && cujMenuText?.includes('Simulate a run') && cujMenuText?.includes('Reset day'),
      `Expected CUJ ⋯ menu items, got: ${cujMenuText}`
    );
    await cujMenuBtn.click();
    await new Promise(r => setTimeout(r, 100));

    // 5. Return to Test Plans and launch Mobile Tester to complete a run & log a bug
    await clickCardByTitle(page, 'Test Plans');

    await page.evaluate(() => {
      const btn =
        document.querySelector('[data-testid="run-on-phone-button"]') ||
        Array.from(document.querySelectorAll('button')).find(
          b =>
            b.textContent?.includes('Test on phone') ||
            b.textContent?.includes('Run on phone') ||
            b.textContent?.includes('Test on Phone App')
        );
      if (!btn) throw new Error('Test on phone button not found');
      btn.click();
    });
    await new Promise(r => setTimeout(r, 300));

    // Verify U5 "Start a session" setup screen
    const setupTitleText = await page.evaluate(
      () => document.querySelector('[data-testid="mobile-setup-title"]')?.textContent?.trim() || ''
    );
    assert.equal(setupTitleText, 'Start a session', 'Mobile setup title must be "Start a session"');

    // Open "1 · You" searchable A-Z dropdown and select "Alice E2E"
    const testerTrigger = await page.$('[data-testid="mobile-tester-dropdown-trigger"]');
    assert.ok(testerTrigger, '1 · You dropdown trigger must exist');
    await testerTrigger.click();
    await new Promise(r => setTimeout(r, 150));

    await page.evaluate(() => {
      const opt = document.querySelector('[data-testid="mobile-tester-option"][data-tester-name="Alice E2E"]');
      if (!opt) throw new Error('Alice E2E option not found in 1 · You dropdown');
      opt.click();
    });
    await new Promise(r => setTimeout(r, 150));

    // Tap "WP-E2E-01" device card in "2 · Device"
    await page.evaluate(() => {
      const devCard = document.querySelector('[data-testid="mobile-device-card"][data-device-name="WP-E2E-01"]');
      if (!devCard) throw new Error('WP-E2E-01 card not found in 2 · Device');
      devCard.click();
    });
    await new Promise(r => setTimeout(r, 150));

    // Verify Start button label "Start on WP-E2E-01 →" and summary line "Alice E2E · E2E Core Plan · run 1 of 2 today"
    const startBtnLabel = await page.evaluate(
      () => document.querySelector('[data-testid="mobile-start-btn"]')?.textContent?.trim() || ''
    );
    assert.ok(
      startBtnLabel.includes('Start on WP-E2E-01'),
      `Expected Start button label "Start on WP-E2E-01 →", got: ${startBtnLabel}`
    );
    const setupSummaryText = await page.evaluate(
      () => document.querySelector('[data-testid="mobile-setup-summary"]')?.textContent?.trim() || ''
    );
    assert.ok(
      setupSummaryText.includes('Alice E2E') &&
        setupSummaryText.includes('E2E Core Plan') &&
        setupSummaryText.includes('run 1 of 2 today'),
      `Expected setup summary "Alice E2E · E2E Core Plan · run 1 of 2 today", got: ${setupSummaryText}`
    );

    // Click "Start on WP-E2E-01 →" button on setup form
    await page.evaluate(() => {
      const startBtn = document.querySelector('[data-testid="mobile-start-btn"]');
      if (!startBtn) throw new Error('Start button not found on setup modal');
      startBtn.click();
    });
    await new Promise(r => setTimeout(r, 300));

    // Log a bug on Step 1
    await page.evaluate(() => {
      const logBugBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Log Bug')
      );
      if (!logBugBtn) throw new Error('Log Bug button not found');
      logBugBtn.click();
    });
    await new Promise(r => setTimeout(r, 200));

    const titleInput = await page.$('[data-testid="bug-title"]');
    assert.ok(titleInput, 'Bug title input [data-testid="bug-title"] must exist');
    await titleInput.type('E2E notification banner flicker on HUD');

    const descInput = await page.$('[data-testid="bug-description"]');
    assert.ok(descInput, 'Bug description textarea [data-testid="bug-description"] must exist');
    await descInput.type('Banner flickers for 500ms when notification arrives.');
    await new Promise(r => setTimeout(r, 100));

    await page.evaluate(() => {
      const saveBtn = Array.from(document.querySelectorAll('button[type="submit"]')).find(b =>
        b.textContent?.includes('Save Bug Log')
      );
      if (!saveBtn) throw new Error('Save Bug Log button not found');
      saveBtn.click();
    });
    await new Promise(r => setTimeout(r, 250));

    // Step 1: Select "Pass" then click "Confirm"
    await page.evaluate(() => {
      const passBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent?.trim() === 'Pass'
      );
      if (!passBtn) throw new Error('Pass button not found on Step 1');
      passBtn.click();
    });
    await new Promise(r => setTimeout(r, 150));

    await page.evaluate(() => {
      const confirmBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent?.trim() === 'Confirm'
      );
      if (!confirmBtn) throw new Error('Confirm button not found on Step 1');
      confirmBtn.click();
    });
    await new Promise(r => setTimeout(r, 250));

    // Step 2 (Final Step): Select "Pass" then click "Confirm" -> completes run
    await page.evaluate(() => {
      const passBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent?.trim() === 'Pass'
      );
      if (!passBtn) throw new Error('Pass button not found on Step 2');
      passBtn.click();
    });
    await new Promise(r => setTimeout(r, 150));

    await page.evaluate(() => {
      const confirmBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent?.trim() === 'Confirm'
      );
      if (!confirmBtn) throw new Error('Confirm button not found on Step 2');
      confirmBtn.click();
    });
    await new Promise(r => setTimeout(r, 350));

    // Exit Mobile Tester back to Dashboard
    await page.evaluate(() => {
      const exitBtn = Array.from(document.querySelectorAll('button')).find(
        b => b.textContent?.includes('Back to Dashboard') || b.textContent?.includes('← Dashboard')
      );
      if (!exitBtn) throw new Error('Back to Dashboard button not found');
      exitBtn.click();
    });
    await new Promise(r => setTimeout(r, 300));

    // 6. Verify Devices & Testers shows quota 1/2 and tester Alice E2E is Idle (not stuck active)
    await clickCardByTitle(page, 'Devices & Testers');

    const floorAfterRun = await page.evaluate(() => document.body.innerText);
    assert.ok(floorAfterRun.includes('1/2'), `Expected quota 1/2 after completing run, got:\n${floorAfterRun}`);
    assert.ok(floorAfterRun.includes('Ready'), 'Device WP-E2E-01 must return to Ready state after run completion');
    assert.ok(floorAfterRun.includes('Live Now (0)'), 'Tester Alice E2E must be idle (Live Now (0)) after run completion');

    // 7. Verify Bugs Feed shows the logged bug (quiet row without default Bug/P2/Open) and Buganizer sub-tab renders
    await clickCardByTitle(page, 'Bugs Feed');

    const bugsFeedText = await page.evaluate(() => document.body.innerText);
    assert.ok(
      bugsFeedText.includes('E2E notification banner flicker on HUD'),
      'Bugs Feed must display the logged bug'
    );

    const feedRowCheck = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="feed-row"]');
      const rx95Offline = document.querySelector('[data-testid="feed-rx95-chip"]');
      return {
        hasTypeChip: !!row?.querySelector('[data-testid="feed-type-chip"]'),
        hasPriChip: !!row?.querySelector('[data-testid="feed-priority-chip"]'),
        hasOpenBtn: Array.from(row?.querySelectorAll('button') || []).some(b => b.textContent?.trim() === 'Open'),
        hasRx95Offline: !!rx95Offline,
      };
    });
    assert.equal(feedRowCheck.hasTypeChip, false, 'Default Bug type chip must be hidden on collapsed row');
    assert.equal(feedRowCheck.hasPriChip, false, 'Default P2 priority chip must be hidden on collapsed row');
    assert.equal(feedRowCheck.hasOpenBtn, false, 'Collapsed bug row must not have Open button');
    assert.equal(feedRowCheck.hasRx95Offline, false, 'Offline RX95 chip must be hidden when no error');

    // Verify U3: Time group header, keyboard hint, J/1/3 shortcuts, Group by Tester, Tester filter
    const u3InitialCheck = await page.evaluate(() => {
      const grpHeader = document.querySelector('[data-testid="feed-group-header"]')?.textContent?.trim() || '';
      const kbHint = document.querySelector('[data-testid="feed-keyboard-hint"]')?.textContent?.trim() || '';
      return { grpHeader, kbHint };
    });
    assert.ok(u3InitialCheck.grpHeader.includes('LAST HOUR'), `Expected LAST HOUR group header, got: ${u3InitialCheck.grpHeader}`);
    assert.ok(u3InitialCheck.kbHint.includes('Keyboard:'), `Expected keyboard hint line, got: ${u3InitialCheck.kbHint}`);

    // Press J to focus row, then 1 to set P0, then 3 to reset to P2
    await page.keyboard.press('j');
    await new Promise(r => setTimeout(r, 100));
    await page.keyboard.press('1');
    await new Promise(r => setTimeout(r, 150));
    const hasP0AfterKey = await page.evaluate(() => {
      const chip = document.querySelector('[data-testid="feed-row"] [data-testid="feed-priority-chip"]');
      return chip ? chip.textContent?.trim() : '';
    });
    assert.equal(hasP0AfterKey, 'P0', 'Pressing 1 on focused bug row must set priority to P0');
    await page.keyboard.press('3');
    await new Promise(r => setTimeout(r, 150));

    // Switch Group by -> Tester
    const groupByBtn = await page.$('[data-testid="feed-group-by"]');
    assert.ok(groupByBtn, 'Group by button must exist');
    await groupByBtn.click();
    await new Promise(r => setTimeout(r, 100));
    const groupByTesterOpt = await page.$('[data-testid="group-by-tester"]');
    assert.ok(groupByTesterOpt, 'Group by Tester option must exist');
    await groupByTesterOpt.click();
    await new Promise(r => setTimeout(r, 150));
    const testerGrpText = await page.evaluate(
      () => document.querySelector('[data-testid="feed-group-header"]')?.textContent?.trim() || ''
    );
    assert.ok(testerGrpText.includes('ALICE E2E'), `Expected ALICE E2E tester group header, got: ${testerGrpText}`);

    // Switch back to Group by -> Time
    await groupByBtn.click();
    await new Promise(r => setTimeout(r, 100));
    const groupByTimeOpt = await page.$('[data-testid="group-by-time"]');
    await groupByTimeOpt.click();
    await new Promise(r => setTimeout(r, 100));

    // Open Tester filter popover
    const testerFilterBtn = await page.$('[data-testid="feed-tester-filter"]');
    assert.ok(testerFilterBtn, 'Tester filter button must exist');
    await testerFilterBtn.click();
    await new Promise(r => setTimeout(r, 100));
    const testerPopoverText = await page.evaluate(
      () => document.querySelector('[data-testid="feed-tester-popover"]')?.textContent || ''
    );
    assert.ok(
      testerPopoverText.includes('All testers') && testerPopoverText.includes('Alice E2E'),
      `Expected All testers and Alice E2E in tester filter popover, got: ${testerPopoverText}`
    );
    await testerFilterBtn.click();
    await new Promise(r => setTimeout(r, 100));

    // Verify 3-stage pipeline tabs (① To review -> R mark reviewed -> ② Ready to file -> ③ Filed)
    const reviewTabBtn = await page.$('[data-testid="pipeline-tab-review"]');
    const readyTabBtn = await page.$('[data-testid="pipeline-tab-ready"]');
    const filedTabBtn = await page.$('[data-testid="pipeline-tab-filed"]');
    assert.ok(
      reviewTabBtn && readyTabBtn && filedTabBtn,
      'Pipeline stage tabs ① To review, ② Ready to file, and ③ Filed must exist'
    );

    // Press R to mark the focused bug reviewed so it moves to ② Ready to file
    await page.keyboard.press('r');
    await new Promise(r => setTimeout(r, 150));

    await readyTabBtn.click();
    await new Promise(r => setTimeout(r, 250));

    const buganizerText = await page.evaluate(() => document.body.innerText);
    assert.ok(
      buganizerText.includes('E2E notification banner flicker on HUD') &&
        buganizerText.includes('NEW ISSUE'),
      '② Ready to file stage must render the reviewed bug with NEW ISSUE badge'
    );

    // 8. Verify M4 Undo Delete toast (delete plan via ⋯ menu -> hidden + toast -> Undo -> restored in place)
    await clickCardByTitle(page, 'Test Plans');
    const planMenuBtn = await page.$('[data-testid="test-plan-menu-button"]');
    if (planMenuBtn) {
      await planMenuBtn.click();
      await new Promise(r => setTimeout(r, 100));
    }
    await page.evaluate(() => {
      const delBtn =
        document.querySelector('[data-testid="plan-menu-delete"]') ||
        document.querySelector('button[title="Delete Test Plan"]');
      if (!delBtn) throw new Error('Delete Test Plan button not found');
      delBtn.click();
    });
    await new Promise(r => setTimeout(r, 200));

    const toastText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="undo-toast"]');
      return el ? el.textContent : '';
    });
    assert.ok(
      toastText && toastText.includes('Deleted') && toastText.includes('E2E Core Plan') && toastText.includes('Undo'),
      `Expected Undo toast for E2E Core Plan, got: ${toastText}`
    );

    await page.evaluate(() => {
      const undoBtn = document.querySelector('[data-testid="undo-toast-button"]');
      if (!undoBtn) throw new Error('Undo button not found on toast');
      undoBtn.click();
    });
    await new Promise(r => setTimeout(r, 200));

    const afterUndoText = await page.evaluate(() => document.body.innerText);
    assert.ok(
      afterUndoText.includes('E2E Core Plan'),
      'Clicking Undo must restore E2E Core Plan in place'
    );

    assert.equal(consoleErrors.length, 0, `Expected 0 console errors, got: ${consoleErrors.join('; ')}`);
    console.log('E2E SMOKE TEST PASSED (all tabs, device activation, mobile run completion, quota 1/2, tester idle, Bugs Feed & Buganizer, Undo delete verified, 0 console errors)!');
  } finally {
    if (browser) await browser.close();
    viteProc.kill('SIGTERM');
  }
}

runE2ESmoke().catch(err => {
  console.error('E2E SMOKE TEST FAILED:', err);
  process.exit(1);
});
