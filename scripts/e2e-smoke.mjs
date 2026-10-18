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
    const cards = Array.from(document.querySelectorAll('.liquid-glass-card'));
    const card = cards.find(c => c.textContent && c.textContent.includes(t));
    if (!card) throw new Error(`Top navigation card "${t}" not found`);
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

    // 2. Verify Test Plans tab renders & honest offline sync badge in sandbox
    const bodyTextPlans = await page.evaluate(() => document.body.innerText);
    assert.ok(bodyTextPlans.includes('E2E Core Plan'), 'Test Plans tab must render E2E Core Plan');

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
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Test on Phone App')
      );
      if (!btn) throw new Error('Test on Phone App button not found');
      btn.click();
    });
    await new Promise(r => setTimeout(r, 300));

    // Open Tester picker modal and select "Alice E2E"
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        b => b.textContent?.includes('Choose QA Tester') || b.textContent?.includes('Tap to select tester')
      );
      if (!btn) throw new Error('Choose QA Tester trigger not found');
      btn.click();
    });
    await new Promise(r => setTimeout(r, 150));

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const testerBtn = btns.find(b => b.textContent?.includes('Alice E2E'));
      if (!testerBtn) throw new Error('Alice E2E option not found in tester picker');
      testerBtn.click();
    });
    await new Promise(r => setTimeout(r, 150));

    // Open Device picker modal and select "WP-E2E-01"
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        b => b.textContent?.includes('Choose Mobile Device') || b.textContent?.includes('WP-E2E-01')
      );
      if (!btn) throw new Error('Choose Mobile Device trigger not found');
      btn.click();
    });
    await new Promise(r => setTimeout(r, 150));

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const devBtn = btns.find(b => b.textContent?.includes('WP-E2E-01'));
      devBtn?.click();
    });
    await new Promise(r => setTimeout(r, 150));

    // Click "Start" button on setup form
    await page.evaluate(() => {
      const startBtn = Array.from(document.querySelectorAll('button[type="submit"]')).find(b =>
        b.textContent?.includes('Start')
      );
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

    const buganizerTabBtn = await page.$('[data-testid="buganizer-tab"]');
    assert.ok(buganizerTabBtn, 'Buganizer sub-tab [data-testid="buganizer-tab"] must exist');
    await buganizerTabBtn.click();
    await new Promise(r => setTimeout(r, 250));

    const buganizerText = await page.evaluate(() => document.body.innerText);
    assert.ok(
      buganizerText.includes('E2E notification banner flicker on HUD'),
      'Buganizer tab must render the logged bug'
    );

    // 8. Verify M4 Undo Delete toast (delete plan -> hidden + toast -> Undo -> restored in place)
    await clickCardByTitle(page, 'Test Plans');
    await page.evaluate(() => {
      const delBtn = document.querySelector('button[title="Delete Test Plan"]');
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
