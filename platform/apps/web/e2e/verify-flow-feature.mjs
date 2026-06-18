/**
 * verify-flow-feature.mjs — Automated tests for "Agent Flow + Question Routing" feature
 *
 * Run from /home/groovy/Desktop/projects/comforceEva:
 *   node platform/apps/web/e2e/verify-flow-feature.mjs
 *
 * Exit 0 = all passed, exit 1 = any failure.
 * Screenshots → /tmp/flowtest-*.png
 *
 * Target: sandbox at http://localhost:7908 (throwaway studies at /tmp/flow-verify)
 * ABSOLUTE RULE: No filesystem deletes. No touching /home/groovy/Desktop/projects/comforceEva/studies.
 */

import { chromium } from '/home/groovy/Desktop/projects/comforceEva/node_modules/playwright/index.mjs';

const BASE_URL = 'http://localhost:7908';
const STUDY_ID = 'D7960C00015';
const TIMEOUT = 45_000;

const results = [];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

function pass(name, evidence) {
  results.push({ name, status: 'PASS', evidence });
  console.log(`✔ PASS  ${name}`);
  if (evidence) console.log(`        ${evidence}`);
}

function fail(name, evidence) {
  results.push({ name, status: 'FAIL', evidence });
  console.error(`✘ FAIL  ${name}`);
  if (evidence) console.error(`        ${evidence}`);
}

async function screenshot(page, tag) {
  const p = `/tmp/flowtest-${tag}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  📸 ${p}`);
  return p;
}

async function waitForNetworkIdle(page, timeout = 5000) {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    // ok if it times out — page might have long-poll
  }
}

async function runTests() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  // Collect console errors
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // Collect page errors (uncaught JS exceptions)
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  // Collect failed requests
  page.on('requestfailed', (req) => {
    // Only count app-originated failures (not preloads/optional)
    const url = req.url();
    if (!url.includes('favicon') && !url.includes('sourcemap')) {
      failedRequests.push(`${req.method()} ${url} → ${req.failure()?.errorText}`);
    }
  });

  try {
    // ────────────────────────────────────────────────────────────────────────
    // TEST 1: Navigate to dashboard, select study, click Agent Flow →
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n── Test 1: Navigate to dashboard → study → Agent Flow page ──');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await waitForNetworkIdle(page, 6000);

    // Wait for studies to load
    await page.waitForSelector('.study-card', { timeout: TIMEOUT });
    const studyCards = await page.$$('.study-card');
    if (studyCards.length === 0) {
      fail('T1-Navigate', 'No study cards found in dashboard');
    } else {
      pass('T1-Dashboard loads', `Found ${studyCards.length} study cards`);
    }

    // Click on study D7960C00015
    const targetCard = await page.locator('.study-card', { hasText: 'D7960C00015' }).first();
    if (!(await targetCard.isVisible())) {
      fail('T1-Select study', 'Study card for D7960C00015 not found');
    } else {
      await targetCard.click();
      await page.waitForTimeout(1500); // wait for detail card to appear
      pass('T1-Select study', 'Clicked study D7960C00015');
    }

    // Click "Agent Flow →" button
    const agentFlowBtn = page.locator('button', { hasText: 'Agent Flow →' }).first();
    await agentFlowBtn.waitFor({ state: 'visible', timeout: TIMEOUT });
    await agentFlowBtn.click();
    await page.waitForTimeout(1500);

    await screenshot(page, '01-study-detail-page');

    // Assert Back button
    const backBtn = page.locator('button.study-back-btn', { hasText: '← Back to Studies' }).first();
    const backVisible = await backBtn.isVisible();
    if (backVisible) {
      pass('T1-Back button', 'selector=button.study-back-btn contains "← Back to Studies"');
    } else {
      fail('T1-Back button', 'button.study-back-btn not visible');
    }

    // Assert study name in header
    const titleEl = page.locator('h1.study-page-title').first();
    const titleVisible = await titleEl.isVisible();
    const titleText = titleVisible ? await titleEl.textContent() : '';
    if (titleVisible && titleText.includes('D7960C00015')) {
      pass('T1-Study name in header', `h1.study-page-title = "${titleText.trim().slice(0, 60)}"`);
    } else {
      fail('T1-Study name in header', `h1.study-page-title not visible or missing study id. Got: "${titleText}"`);
    }

    // Assert tabs present
    const infoTab = page.locator('button.study-tab', { hasText: 'Study Info' }).first();
    const flowTab = page.locator('button.study-tab', { hasText: 'Agent Flow' }).first();
    const infoVisible = await infoTab.isVisible();
    const flowVisible = await flowTab.isVisible();
    if (infoVisible && flowVisible) {
      pass('T1-Tabs present', 'Both "Study Info" and "Agent Flow" tab buttons visible');
    } else {
      fail('T1-Tabs present', `Study Info visible=${infoVisible}, Agent Flow visible=${flowVisible}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    // TEST 2: Header — Priority badge, sponsor/PI/site meta
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n── Test 2: Header meta ──');

    // The study has priority "REQUIRED-FROM-SITE" — check if badge shows
    const priorityBadge = page.locator('.priority-badge').first();
    const priorityVisible = await priorityBadge.isVisible();
    // priority is "REQUIRED-FROM-SITE" (non-empty string) so badge SHOULD show
    if (priorityVisible) {
      const badgeText = await priorityBadge.textContent();
      pass('T2-Priority badge', `selector=.priority-badge text="${badgeText.trim()}"`);
    } else {
      // The study has priority = "REQUIRED-FROM-SITE" — if the component trims it, it would still show
      // Let's check what priority value the API returns
      const apiResp = await page.evaluate(async () => {
        const r = await fetch('/api/studies/D7960C00015');
        const d = await r.json();
        return d.overview?.priority;
      });
      if (apiResp && apiResp.trim()) {
        fail('T2-Priority badge', `API returns priority="${apiResp}" but .priority-badge not visible`);
      } else {
        pass('T2-Priority badge (no priority set)', `priority="${apiResp}" → badge correctly hidden`);
      }
    }

    // Check sponsor meta
    const metaEl = page.locator('.study-page-meta').first();
    const metaVisible = await metaEl.isVisible();
    const metaText = metaVisible ? await metaEl.textContent() : '';
    if (metaVisible && metaText.includes('AstraZeneca')) {
      pass('T2-Sponsor meta', `selector=.study-page-meta contains "AstraZeneca"`);
    } else {
      fail('T2-Sponsor meta', `meta not visible or missing sponsor. Got: "${metaText.slice(0, 80)}"`);
    }

    await screenshot(page, '02-header-meta');

    // ────────────────────────────────────────────────────────────────────────
    // TEST 3: Agent Flow tab — graph renders with question/DNQ/Qualified nodes
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n── Test 3: Agent Flow graph ──');

    // Ensure Agent Flow tab is active (it's the default)
    const flowTabActive = page.locator('button.study-tab.active', { hasText: 'Agent Flow' }).first();
    if (!(await flowTabActive.isVisible())) {
      // Click it to activate
      await flowTab.click();
      await page.waitForTimeout(800);
    }

    // Check .afg-node exists
    await page.waitForSelector('.afg-node', { timeout: TIMEOUT });
    const allNodes = await page.$$('.afg-node');
    const nodeCount = allNodes.length;

    if (nodeCount >= 5) {
      pass('T3-Graph renders nodes', `Found ${nodeCount} .afg-node elements (≥5 expected)`);
    } else {
      fail('T3-Graph renders nodes', `Only ${nodeCount} .afg-node elements found (need ≥5)`);
    }

    // Check question nodes (blue border nodes — style has rgba(91,142,240)
    // We detect question nodes by their rendered style content. The DOM doesn't have a data-type attr,
    // so we look at the count of nodes with blue background.
    // But actually, the layout gives us all afg-nodes — question vs dnq vs qualified.
    // Let's check via API data how many question nodes exist, then verify DOM node count.
    const studyData = await page.evaluate(async () => {
      const r = await fetch('/api/studies/D7960C00015');
      return await r.json();
    });

    const questionNodes = (studyData.flow?.nodes ?? []).filter(n => n.type === 'question');
    const dnqNodes = (studyData.flow?.nodes ?? []).filter(n => n.type === 'dnq');
    const qualifiedNodes = (studyData.flow?.nodes ?? []).filter(n => n.type === 'qualified');

    if (questionNodes.length >= 5) {
      pass('T3-Question nodes (≥5)', `Flow data has ${questionNodes.length} question nodes`);
    } else {
      fail('T3-Question nodes (≥5)', `Only ${questionNodes.length} question nodes in flow data`);
    }

    if (dnqNodes.length >= 1) {
      pass('T3-DNQ node present', `Flow data has ${dnqNodes.length} DNQ nodes`);
    } else {
      fail('T3-DNQ node present', `No DNQ nodes in flow data`);
    }

    if (qualifiedNodes.length >= 1) {
      pass('T3-Qualified node present', `Flow data has ${qualifiedNodes.length} Qualified node(s)`);
    } else {
      fail('T3-Qualified node present', `No Qualified nodes in flow data`);
    }

    // Verify total rendered nodes matches expected
    const expectedTotal = (studyData.flow?.nodes ?? []).length;
    if (nodeCount === expectedTotal) {
      pass('T3-All nodes rendered', `${nodeCount} DOM nodes == ${expectedTotal} flow nodes`);
    } else {
      fail('T3-All nodes rendered', `DOM has ${nodeCount} nodes, flow data has ${expectedTotal}`);
    }

    // Check SVG connector lines exist
    const svgLines = await page.$$('svg path[stroke]');
    if (svgLines.length >= 1) {
      pass('T3-SVG connector lines', `Found ${svgLines.length} SVG path elements with stroke`);
    } else {
      fail('T3-SVG connector lines', 'No SVG path[stroke] connectors found');
    }

    // Check no catastrophic overlapping — read bounding boxes of all nodes
    const positions = await page.evaluate(() => {
      const nodes = document.querySelectorAll('.afg-node');
      return Array.from(nodes).map((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      });
    });

    // Check that no two nodes have the SAME exact position (degenerate overlap)
    let catastrophicOverlap = false;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i], b = positions[j];
        if (Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2) {
          catastrophicOverlap = true;
          break;
        }
      }
      if (catastrophicOverlap) break;
    }

    if (!catastrophicOverlap) {
      pass('T3-No catastrophic overlap', `${positions.length} nodes all have distinct positions`);
    } else {
      fail('T3-No catastrophic overlap', 'Two or more nodes share the exact same position');
    }

    await screenshot(page, '03-agent-flow-graph');

    // Test zoom toolbar: click +, −, fit
    const zoomInBtn = page.locator('button[title="Zoom in"]').first();
    const zoomOutBtn = page.locator('button[title="Zoom out"]').first();
    const fitBtn = page.locator('button[title="Fit to view"]').first();

    const zoomBtnsVisible = (await zoomInBtn.isVisible()) && (await zoomOutBtn.isVisible()) && (await fitBtn.isVisible());
    if (!zoomBtnsVisible) {
      fail('T3-Zoom toolbar', `Zoom toolbar buttons not visible (in=${await zoomInBtn.isVisible()}, out=${await zoomOutBtn.isVisible()}, fit=${await fitBtn.isVisible()})`);
    } else {
      // Read current transform
      const getTransform = () => page.evaluate(() => {
        const canvas = document.querySelector('.afg-node')?.closest('[style*="transform"]');
        return canvas ? canvas.getAttribute('style') : null;
      });

      const transformBefore = await getTransform();
      await zoomInBtn.click();
      await page.waitForTimeout(300);
      const transformAfterZoomIn = await getTransform();
      await zoomOutBtn.click();
      await page.waitForTimeout(300);
      const transformAfterZoomOut = await getTransform();
      await fitBtn.click();
      await page.waitForTimeout(300);
      const transformAfterFit = await getTransform();

      // Transform style should change after each click (the scale or translate changes)
      if (transformBefore !== transformAfterZoomIn && transformAfterZoomIn !== transformAfterZoomOut) {
        pass('T3-Zoom changes transform', `Transform changes: "${transformBefore?.slice(0, 50)}" → "${transformAfterZoomIn?.slice(0, 50)}" → "${transformAfterZoomOut?.slice(0, 50)}"`);
      } else if (transformBefore === transformAfterZoomIn) {
        fail('T3-Zoom changes transform', 'Transform did not change after clicking zoom +');
      } else {
        fail('T3-Zoom changes transform', 'Transform did not change after clicking zoom −');
      }
    }

    await screenshot(page, '03b-zoom-tested');

    // ────────────────────────────────────────────────────────────────────────
    // TEST 4: Open "Flow Config" modal
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n── Test 4: Open Question Routing modal ──');

    const flowConfigBtn = page.locator('button.flow-config-btn').first();
    await flowConfigBtn.waitFor({ state: 'visible', timeout: TIMEOUT });
    await flowConfigBtn.click();
    await page.waitForTimeout(800);

    // Assert modal opened
    const modal = page.locator('.qrm-modal').first();
    await modal.waitFor({ state: 'visible', timeout: TIMEOUT });

    const modalVisible = await modal.isVisible();
    if (modalVisible) {
      pass('T4-Modal opens', 'selector=.qrm-modal is visible');
    } else {
      fail('T4-Modal opens', '.qrm-modal not visible after clicking Flow Config');
    }

    // Assert modal title
    const modalTitle = page.locator('.qrm-title').first();
    const titleTextModal = await modalTitle.textContent();
    if (titleTextModal?.includes('Question Routing')) {
      pass('T4-Modal title', `selector=.qrm-title = "${titleTextModal.trim()}"`);
    } else {
      fail('T4-Modal title', `Expected "Question Routing", got "${titleTextModal}"`);
    }

    // Assert multiple question cards (Q1, Q2, ...)
    const qCards = await page.$$('.qrm-card');
    const qChips = await page.$$('.qrm-qchip');

    if (qCards.length >= 2) {
      pass('T4-Multiple question cards', `Found ${qCards.length} .qrm-card elements`);
    } else {
      fail('T4-Multiple question cards', `Only ${qCards.length} .qrm-card elements found`);
    }

    // Assert Q1, Q2 chips
    const chip1 = page.locator('.qrm-qchip', { hasText: 'Q1' }).first();
    const chip2 = page.locator('.qrm-qchip', { hasText: 'Q2' }).first();
    const chipsPresent = await chip1.isVisible() && await chip2.isVisible();
    if (chipsPresent) {
      pass('T4-Q1/Q2 chips', 'Q1 and Q2 .qrm-qchip chips are visible');
    } else {
      fail('T4-Q1/Q2 chips', `Q1 visible=${await chip1.isVisible()}, Q2 visible=${await chip2.isVisible()}`);
    }

    // Assert editable question text inputs
    const questionInputs = await page.$$('input[aria-label*="Question"][aria-label*="text"]');
    if (questionInputs.length >= 2) {
      pass('T4-Question text inputs', `Found ${questionInputs.length} question text inputs`);
    } else {
      fail('T4-Question text inputs', `Only ${questionInputs.length} question text inputs found`);
    }

    // Assert destination dropdowns (path destination selects)
    const destDropdowns = await page.$$('select[aria-label="Path destination"]');
    if (destDropdowns.length >= 1) {
      pass('T4-Destination dropdowns', `Found ${destDropdowns.length} destination dropdowns`);
    } else {
      fail('T4-Destination dropdowns', `No select[aria-label="Path destination"] found`);
    }

    await screenshot(page, '04-question-routing-modal');

    // ────────────────────────────────────────────────────────────────────────
    // TEST 5: EDIT + SAVE — change question text, edge label, save, re-verify
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n── Test 5: Edit question text + edge label, save, persist ──');

    // Get the original text of Q1
    const q1Input = page.locator('input[aria-label="Question 1 text"]').first();
    await q1Input.waitFor({ state: 'visible', timeout: TIMEOUT });
    const originalQ1Text = await q1Input.inputValue();

    // Append " [edited]" to Q1 text
    const editedQ1Text = originalQ1Text + ' [edited]';
    await q1Input.fill(editedQ1Text);

    // Change the first edge label (if any path rows exist)
    const edgeLabelInputs = await page.$$('input[aria-label="Edge label"]');
    let originalEdgeLabel = null;
    let editedEdgeLabel = null;

    if (edgeLabelInputs.length > 0) {
      const firstEdgeInput = page.locator('input[aria-label="Edge label"]').first();
      originalEdgeLabel = await firstEdgeInput.inputValue();
      editedEdgeLabel = originalEdgeLabel + ' [e]';
      await firstEdgeInput.fill(editedEdgeLabel);
      pass('T5-Edge label edit prepared', `Changed first edge label to "${editedEdgeLabel.slice(0, 40)}"`);
    } else {
      pass('T5-Edge label edit skipped', 'No edge label inputs found (Q1 may have no paths); skipping');
    }

    // Click Save Changes
    const saveBtn = page.locator('button', { hasText: 'Save Changes' }).first();
    await saveBtn.click();

    // Wait for modal to close (success)
    try {
      await modal.waitFor({ state: 'hidden', timeout: 10_000 });
      pass('T5-Modal closes on save', 'Modal hidden after clicking Save Changes');
    } catch {
      // Check for error message
      const msgEl = page.locator('.qrm-footer span').first();
      const msgText = await msgEl.textContent().catch(() => '');
      fail('T5-Modal closes on save', `Modal did not close. Footer message: "${msgText}"`);
    }

    await screenshot(page, '05-after-save');

    // Re-open modal and verify persisted text
    await flowConfigBtn.click();
    await page.waitForTimeout(800);
    await modal.waitFor({ state: 'visible', timeout: TIMEOUT });

    const q1InputReopen = page.locator('input[aria-label="Question 1 text"]').first();
    await q1InputReopen.waitFor({ state: 'visible', timeout: TIMEOUT });
    const reOpenQ1Text = await q1InputReopen.inputValue();

    if (reOpenQ1Text === editedQ1Text) {
      pass('T5-Edit persisted (re-open modal)', `Q1 text = "${reOpenQ1Text.slice(0, 60)}" matches edited value`);
    } else {
      // Also verify via GET /api/studies/:id
      const freshData = await page.evaluate(async (id) => {
        const r = await fetch(`/api/studies/${id}`);
        return r.json();
      }, STUDY_ID);

      const freshQ1 = freshData.screeningQuestions?.[0]?.sms_question ?? '';
      if (freshQ1 === editedQ1Text || freshQ1.includes('[edited]')) {
        pass('T5-Edit persisted (API)', `GET /api/studies/${STUDY_ID} Q1 = "${freshQ1.slice(0, 60)}"`);
      } else {
        fail('T5-Edit persisted', `Expected "${editedQ1Text.slice(0, 50)}", modal shows "${reOpenQ1Text.slice(0, 50)}", API Q1="${freshQ1.slice(0, 50)}"`);
      }
    }

    // Verify edge label persisted (via API)
    if (editedEdgeLabel) {
      const freshData2 = await page.evaluate(async (id) => {
        const r = await fetch(`/api/studies/${id}`);
        return r.json();
      }, STUDY_ID);
      const freshEdges = freshData2.flow?.edges ?? [];
      const hasEdited = freshEdges.some(e => e.label === editedEdgeLabel);
      if (hasEdited) {
        pass('T5-Edge label persisted', `API flow.edges contains label "${editedEdgeLabel.slice(0, 40)}"`);
      } else {
        fail('T5-Edge label persisted', `Edited edge label "${editedEdgeLabel.slice(0, 40)}" not found in API. Edges: ${JSON.stringify(freshEdges.map(e => e.label)).slice(0, 200)}`);
      }
    }

    await screenshot(page, '05b-reopen-modal-verify');

    // Close modal for next test
    const cancelBtn = page.locator('button', { hasText: 'Cancel' }).first();
    await cancelBtn.click();
    await page.waitForTimeout(500);

    // ────────────────────────────────────────────────────────────────────────
    // TEST 6: DELETE — delete a path, save, assert it's gone
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n── Test 6: Delete a path, save, verify gone ──');

    await flowConfigBtn.click();
    await page.waitForTimeout(800);
    await modal.waitFor({ state: 'visible', timeout: TIMEOUT });

    // Count paths before deletion
    const pathRowsBefore = await page.$$('.qrm-path-row');
    const pathCountBefore = pathRowsBefore.length;

    if (pathCountBefore === 0) {
      fail('T6-Delete path', 'No .qrm-path-row elements found to delete');
    } else {
      // Get the edge label of the LAST path (safer to delete last than first which may be critical)
      const lastPathRow = page.locator('.qrm-path-row').last();
      const lastEdgeLabelInput = lastPathRow.locator('input[aria-label="Edge label"]').first();
      const lastEdgeLabel = await lastEdgeLabelInput.inputValue();

      // Click the delete path button in the last row
      const deletePathBtn = lastPathRow.locator('button[aria-label="Delete path"]').first();
      await deletePathBtn.click();
      await page.waitForTimeout(300);

      const pathRowsAfter = await page.$$('.qrm-path-row');
      const pathCountAfter = pathRowsAfter.length;

      if (pathCountAfter === pathCountBefore - 1) {
        pass('T6-Path row removed from UI', `Path count: ${pathCountBefore} → ${pathCountAfter}`);
      } else {
        fail('T6-Path row removed from UI', `Expected ${pathCountBefore - 1} paths, got ${pathCountAfter}`);
      }

      // Save
      await saveBtn.click();
      try {
        await modal.waitFor({ state: 'hidden', timeout: 10_000 });
        pass('T6-Modal closes after delete+save', 'Modal hidden after Save');
      } catch {
        fail('T6-Modal closes after delete+save', 'Modal did not close after delete+save');
      }

      // Verify via API
      const afterDelData = await page.evaluate(async (id) => {
        const r = await fetch(`/api/studies/${id}`);
        return r.json();
      }, STUDY_ID);
      const afterEdges = afterDelData.flow?.edges ?? [];
      const edgeStillExists = afterEdges.some(e => e.label === lastEdgeLabel);

      if (!edgeStillExists) {
        pass('T6-Deleted path not in API', `Edge label "${lastEdgeLabel.slice(0, 40)}" no longer in flow.edges`);
      } else {
        // It might persist if label was shared; do a count check instead
        const beforeCount = pathCountBefore;
        const afterCount = afterEdges.length;
        if (afterCount < beforeCount) {
          pass('T6-Deleted path count reduced in API', `Edges before=${beforeCount}, after=${afterCount}`);
        } else {
          fail('T6-Deleted path not in API', `Edge "${lastEdgeLabel.slice(0, 40)}" still found in flow.edges`);
        }
      }

      await screenshot(page, '06-after-delete');
    }

    // ────────────────────────────────────────────────────────────────────────
    // TEST 7: ADD — add a path, save, assert present
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n── Test 7: Add a path, save, verify present ──');

    await flowConfigBtn.click();
    await page.waitForTimeout(800);
    await modal.waitFor({ state: 'visible', timeout: TIMEOUT });

    // Count paths before
    const pathRowsBeforeAdd = await page.$$('.qrm-path-row');
    const countBeforeAdd = pathRowsBeforeAdd.length;

    // Click "＋ Add path" on the first question card
    const addPathBtn = page.locator('button', { hasText: '＋ Add path' }).first();
    if (!(await addPathBtn.isVisible())) {
      fail('T7-Add path button', '"＋ Add path" button not visible');
    } else {
      await addPathBtn.click();
      await page.waitForTimeout(300);

      const pathRowsAfterAdd = await page.$$('.qrm-path-row');
      const countAfterAdd = pathRowsAfterAdd.length;

      if (countAfterAdd === countBeforeAdd + 1) {
        pass('T7-New path row appears', `Path count: ${countBeforeAdd} → ${countAfterAdd}`);
      } else {
        fail('T7-New path row appears', `Expected ${countBeforeAdd + 1}, got ${countAfterAdd}`);
      }

      // Fill the new path's edge label
      const newPathLabel = `TEST_PATH_${Date.now().toString(36).toUpperCase()}`;
      const newEdgeInput = page.locator('input[aria-label="Edge label"]').last();
      await newEdgeInput.fill(newPathLabel);

      // Set destination to "qualified" if possible
      const newDestSelect = page.locator('select[aria-label="Path destination"]').last();
      await newDestSelect.selectOption({ value: 'qualified' });
      await page.waitForTimeout(200);

      // Save
      await saveBtn.click();
      try {
        await modal.waitFor({ state: 'hidden', timeout: 10_000 });
        pass('T7-Modal closes after add+save', 'Modal hidden after Save');
      } catch {
        fail('T7-Modal closes after add+save', 'Modal did not close after add+save');
      }

      // Verify via API
      const afterAddData = await page.evaluate(async (id) => {
        const r = await fetch(`/api/studies/${id}`);
        return r.json();
      }, STUDY_ID);
      const afterAddEdges = afterAddData.flow?.edges ?? [];
      const newEdgePresent = afterAddEdges.some(e => e.label === newPathLabel);

      if (newEdgePresent) {
        pass('T7-New path persisted in API', `flow.edges contains label "${newPathLabel}"`);
      } else {
        fail('T7-New path persisted in API', `Edge "${newPathLabel}" not found in flow.edges after save. Edges: ${JSON.stringify(afterAddEdges.map(e => e.label)).slice(0, 200)}`);
      }

      await screenshot(page, '07-after-add-path');
    }

    // ────────────────────────────────────────────────────────────────────────
    // TEST 8: Theme toggle — dark/light flips, graph + modal readable
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n── Test 8: Theme toggle ──');

    // Close modal if still open
    const modalStillOpen = await modal.isVisible();
    if (modalStillOpen) {
      const cancelBtnTheme = page.locator('button', { hasText: 'Cancel' }).first();
      await cancelBtnTheme.click();
      await page.waitForTimeout(400);
    }

    // Read current theme on <html> data-theme attribute
    const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));

    // Click theme toggle button
    const themeToggle = page.locator('button[aria-label="Toggle color theme"]').first();
    const themeToggleVisible = await themeToggle.isVisible();

    if (!themeToggleVisible) {
      fail('T8-Theme toggle', 'button[aria-label="Toggle color theme"] not visible');
    } else {
      await themeToggle.click();
      await page.waitForTimeout(400);

      const newTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));

      if (newTheme !== initialTheme) {
        pass('T8-Theme flips on toggle', `data-theme: "${initialTheme}" → "${newTheme}"`);
      } else {
        fail('T8-Theme flips on toggle', `data-theme did not change from "${initialTheme}"`);
      }

      await screenshot(page, '08-theme-toggled');

      // Assert graph still renders after theme change
      const graphNodesAfterTheme = await page.$$('.afg-node');
      if (graphNodesAfterTheme.length >= 5) {
        pass('T8-Graph readable after theme change', `${graphNodesAfterTheme.length} .afg-node visible`);
      } else {
        fail('T8-Graph readable after theme change', `Only ${graphNodesAfterTheme.length} .afg-node after theme change`);
      }

      // Open modal and verify it's readable
      await flowConfigBtn.click();
      await page.waitForTimeout(600);
      const modalInNewTheme = await modal.isVisible();
      if (modalInNewTheme) {
        const modalCards = await page.$$('.qrm-card');
        pass('T8-Modal readable in new theme', `Modal visible with ${modalCards.length} question cards in "${newTheme}" theme`);
      } else {
        fail('T8-Modal readable in new theme', 'Modal not visible after theme change');
      }

      await screenshot(page, '08b-modal-in-new-theme');

      // Close modal
      const cancelBtnTheme2 = page.locator('button', { hasText: 'Cancel' }).first();
      await cancelBtnTheme2.click();
      await page.waitForTimeout(400);

      // Toggle back
      await themeToggle.click();
      await page.waitForTimeout(300);
      const restoredTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (restoredTheme === initialTheme) {
        pass('T8-Theme restored', `data-theme back to "${initialTheme}"`);
      } else {
        fail('T8-Theme restored', `Expected "${initialTheme}", got "${restoredTheme}"`);
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // TEST 9: Back to Studies returns to dashboard
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n── Test 9: Back to Studies ──');

    const backBtnFinal = page.locator('button.study-back-btn').first();
    await backBtnFinal.waitFor({ state: 'visible', timeout: TIMEOUT });
    await backBtnFinal.click();
    await page.waitForTimeout(1000);

    // Should be back at dashboard — study cards visible, study page gone
    const studyPageGone = !(await page.locator('button.study-back-btn').isVisible());
    const studyCardsBack = await page.$$('.study-card');

    if (studyPageGone && studyCardsBack.length > 0) {
      pass('T9-Back to dashboard', `Study detail page gone; ${studyCardsBack.length} study cards visible`);
    } else {
      fail('T9-Back to dashboard', `study-back-btn still visible=${!studyPageGone}, study cards=${studyCardsBack.length}`);
    }

    await screenshot(page, '09-back-to-dashboard');

    // ────────────────────────────────────────────────────────────────────────
    // ZERO console/page errors + failed requests assertion
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n── Asserting zero console errors / page errors / failed requests ──');

    if (consoleErrors.length === 0) {
      pass('ZERO console errors', 'No console.error() calls captured');
    } else {
      fail('ZERO console errors', `${consoleErrors.length} console errors:\n  ${consoleErrors.slice(0, 5).join('\n  ')}`);
    }

    if (pageErrors.length === 0) {
      pass('ZERO page errors', 'No uncaught JS exceptions');
    } else {
      fail('ZERO page errors', `${pageErrors.length} page errors:\n  ${pageErrors.slice(0, 5).join('\n  ')}`);
    }

    if (failedRequests.length === 0) {
      pass('ZERO failed requests', 'No network request failures');
    } else {
      // Filter out non-critical requests
      const criticalFails = failedRequests.filter(r => !r.includes('favicon'));
      if (criticalFails.length === 0) {
        pass('ZERO critical failed requests', 'Only non-critical requests failed (favicons etc.)');
      } else {
        fail('ZERO failed requests', `${criticalFails.length} critical request failures:\n  ${criticalFails.slice(0, 5).join('\n  ')}`);
      }
    }

  } finally {
    await browser.close();
  }

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  const passed = results.filter((r) => r.status === 'PASS');
  const failed = results.filter((r) => r.status === 'FAIL');
  const allPassed = failed.length === 0;

  console.log(allPassed ? 'FLOW FEATURE TESTS: PASS' : 'FLOW FEATURE TESTS: FAIL');
  console.log(`  ${passed.length} passed / ${failed.length} failed / ${results.length} total`);

  if (failed.length > 0) {
    console.log('\nFailed assertions:');
    for (const r of failed) {
      console.error(`  ✘ ${r.name}: ${r.evidence}`);
    }
  }

  console.log('\nScreenshots:');
  for (const tag of ['01-study-detail-page','02-header-meta','03-agent-flow-graph','03b-zoom-tested',
    '04-question-routing-modal','05-after-save','05b-reopen-modal-verify','06-after-delete',
    '07-after-add-path','08-theme-toggled','08b-modal-in-new-theme','09-back-to-dashboard']) {
    console.log(`  /tmp/flowtest-${tag}.png`);
  }

  console.log(`\nHarness path: /home/groovy/Desktop/projects/comforceEva/platform/apps/web/e2e/verify-flow-feature.mjs`);
  console.log('══════════════════════════════════════════════════════════════');

  process.exit(allPassed ? 0 : 1);
}

runTests().catch((err) => {
  console.error('Fatal error in test harness:', err);
  process.exit(1);
});
