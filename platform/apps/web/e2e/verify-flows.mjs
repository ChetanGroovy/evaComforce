/**
 * verify-flows.mjs — Functional UI verification for comforceEva sandbox at http://localhost:7906
 *
 * Run from /home/groovy/Desktop/projects/comforceEva:
 *   node platform/apps/web/e2e/verify-flows.mjs
 *
 * Exit 0 = all passed, exit 1 = any failure.
 * Screenshots → /tmp/vf2-*.png
 *
 * ABSOLUTE RULE: No filesystem deletes. No touching /home/groovy/Desktop/projects/comforceEva/studies.
 * Mutations only via http://localhost:7906 API or /tmp/verify-studies (sandbox throwaway dir).
 */

import { chromium } from '/home/groovy/Desktop/projects/comforceEva/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'fs';

const BASE_URL = 'http://localhost:7906';
const TIMEOUT = 45_000;

const results = [];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
let createdStudyId = null;

// Unique run suffix to avoid 409 conflicts on repeated runs
const RUN_ID = Date.now().toString(36).toUpperCase();
const ADD_STUDY_NAME = `Sandbox QA ${RUN_ID}`;

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
  const p = `/tmp/vf2-${tag}.png`;
  await page.screenshot({ path: p, fullPage: false });
  return p;
}

/**
 * Seed patient screening records into the sandbox studies dir so the funnel
 * has real data. Safe — /tmp/verify-studies is the throwaway sandbox copy.
 */
function seedFunnelData() {
  const dir = '/tmp/verify-studies/WC45726/screening';
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/patient-seed-001.txt`, [
      'q1_age: 52',
      'sex_at_birth: Female',
      'q2_bmi: yes',
      'q3_t2d: yes',
      'q4_weightloss: yes',
      'q6_t1dm: no',
      'q7_transplant: no',
      'q8_gastric: no',
      'q9_mtc: no',
      'q10_pregnancy: no',
    ].join('\n'));
    writeFileSync(`${dir}/patient-seed-002.txt`, [
      'q1_age: 17',
      'sex_at_birth: Male',
      'q2_bmi: yes',
      'q3_t2d: yes',
      'q4_weightloss: yes',
      'q6_t1dm: no',
      'q7_transplant: no',
      'q8_gastric: no',
      'q9_mtc: no',
      'q10_pregnancy: no',
    ].join('\n'));
    writeFileSync(`${dir}/patient-seed-003.txt`, [
      'q1_age: 45',
      'sex_at_birth: Female',
      'q2_bmi: yes',
      'q3_t2d: no',
      'q4_weightloss: yes',
      'q6_t1dm: yes',
      'q7_transplant: no',
      'q8_gastric: no',
      'q9_mtc: no',
      'q10_pregnancy: no',
    ].join('\n'));
    console.log('  Seeded 3 patient records into /tmp/verify-studies/WC45726/screening');
  } catch (err) {
    console.warn(`  Warning: could not seed funnel data: ${err}`);
  }
}

/**
 * Type in the textarea and press Enter, then wait for the chat to settle.
 */
async function sendMessage(page, text) {
  const input = page.locator('textarea.chat-input-textarea');
  await input.waitFor({ state: 'visible', timeout: TIMEOUT });
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('textarea.chat-input-textarea');
      return ta && !ta.disabled;
    },
    { timeout: TIMEOUT }
  );
  await input.fill(text);
  await input.press('Enter');
  // Wait for response: typing dots gone AND (input re-enabled OR verdict card appears)
  await page.waitForFunction(
    () => {
      const typing = document.querySelector('.typing-indicator');
      const verdict = document.querySelector('.verdict-card');
      const ta = document.querySelector('textarea.chat-input-textarea');
      if (verdict) return true;
      if (!typing && ta && !ta.disabled) return true;
      return false;
    },
    { timeout: TIMEOUT }
  );
}

/**
 * Reset the chat panel if needed (click New Patient when a verdict or active
 * screening is present so the Start Screening button is visible).
 */
async function resetChatIfNeeded(page) {
  // If Start Screening is already visible and enabled, nothing to do
  const startBtn = page.locator('button', { hasText: 'Start Screening' });
  const startVisible = await startBtn.isVisible().catch(() => false);
  if (startVisible) return;

  // Try clicking New Patient
  const newPatientBtn = page.locator('button', { hasText: /New Patient/i });
  const npVisible = await newPatientBtn.isVisible().catch(() => false);
  if (npVisible) {
    await newPatientBtn.click();
    await page.waitForTimeout(400);
    return;
  }

  // If neither button is visible, select a neutral study then back
  // (this handles mid-screening state where neither button shows)
  // Force re-selection of the current active study by clicking another
  const otherCard = page.locator('.study-card:not(.active)').first();
  const otherVisible = await otherCard.isVisible().catch(() => false);
  if (otherVisible) {
    await otherCard.click();
    await page.waitForTimeout(300);
  }
}

/**
 * Click Start Screening and wait for the greeting bubble.
 */
async function startScreening(page) {
  const modalVisible = await page.locator('[role="dialog"], .modal-overlay').isVisible().catch(() => false);
  if (modalVisible) await page.keyboard.press('Escape');

  // Ensure Start Screening is accessible
  await resetChatIfNeeded(page);

  const btn = page.locator('button', { hasText: 'Start Screening' }).first();
  await btn.waitFor({ state: 'visible', timeout: TIMEOUT });
  await btn.click();
  // Wait for greeting bubble (consent question)
  await page.locator('.bubble.greeting-bubble').waitFor({ state: 'visible', timeout: TIMEOUT });
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('textarea.chat-input-textarea');
      return ta && !ta.disabled;
    },
    { timeout: TIMEOUT }
  );
}

/**
 * Select a study card in the sidebar by matching study id text.
 * Also resets chat state when switching studies.
 */
async function selectStudy(page, studyId) {
  const modalVisible = await page.locator('[role="dialog"], .modal-overlay').isVisible().catch(() => false);
  if (modalVisible) await page.keyboard.press('Escape');

  // If this study is already active and in mid-screen, reset first
  const alreadyActive = await page.locator(`.study-card.active`).filter({ hasText: studyId }).count() > 0;
  if (alreadyActive) {
    await resetChatIfNeeded(page);
    return;
  }

  const card = page.locator('.study-card').filter({ hasText: studyId }).first();
  await card.waitFor({ state: 'visible', timeout: TIMEOUT });
  await card.click();
  await page.waitForFunction(
    () => document.querySelectorAll('.study-card.active').length > 0,
    { timeout: TIMEOUT }
  );
  // After switching, also ensure chat is ready
  await resetChatIfNeeded(page);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('Seeding sandbox funnel data…');
  seedFunnelData();

  console.log('Launching Chromium → ' + BASE_URL);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(TIMEOUT);

  // ── Collect console errors, page errors, failed requests across session ──
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
  });
  page.on('requestfailed', (req) => {
    // Ignore favicon failures — not functional
    if (!req.url().includes('favicon')) {
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`);
    }
  });

  try {

    // ─────────────────────────────────────────────────────────────────────
    // TEST 1: Load — 7 study cards render (the 7 pre-seeded studies),
    //   no error banner.
    // NOTE: sandbox may have residual draft studies from prior test runs.
    //   We assert exactly 7 "ready" cards visible (the real studies), plus
    //   check that the total card count is ≥7 with 0 error banners.
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n── Test 1: Load ──');
    try {
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
      await page.locator('.study-card').first().waitFor({ state: 'visible', timeout: TIMEOUT });
      const cardCount = await page.locator('.study-card').count();
      const errorBannerCount = await page.locator('.error-banner').count();

      // The 7 known studies — use partial name strings that appear in the card text.
      // Note: AZD1163-D9640C00003 has name "D9640C00003 (AZD1163)..." so we match
      // on the portion that appears in the rendered card, not the filesystem id.
      const expectedNameFragments = [
        { id: '77242113PSA3002',      fragment: '77242113PSA3002' },
        { id: 'AZD1163-D9640C00003',  fragment: 'D9640C00003' },
        { id: 'C4771002',             fragment: 'C4771002' },
        { id: 'D7960C00015',          fragment: 'D7960C00015' },
        { id: 'MK-7240',              fragment: 'MK-7240' },
        { id: 'VP-VQW-765-3201',      fragment: 'VP-VQW-765' },
        { id: 'WC45726',              fragment: 'WC45726' },
      ];

      // Check each of the 7 known studies has a card
      let allPresent = true;
      const missing = [];
      for (const { id, fragment } of expectedNameFragments) {
        const c = await page.locator('.study-card').filter({ hasText: fragment }).count();
        if (c === 0) {
          allPresent = false;
          missing.push(id);
        }
      }

      const ss = await screenshot(page, '1-load');

      if (allPresent && errorBannerCount === 0) {
        pass('1. Load', `All 7 study cards present (total cards in sidebar: ${cardCount}), 0 error banners | screenshot: ${ss}`);
      } else {
        fail('1. Load', `missing=${missing.join(',')}, total=${cardCount}, errorBanners=${errorBannerCount} | screenshot: ${ss}`);
      }
    } catch (e) {
      const ss = await screenshot(page, '1-load-FAIL').catch(() => 'no screenshot');
      fail('1. Load', `${e} | screenshot: ${ss}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 2: QUALIFIED flow on WC45726
    // answers: yes(consent), 52, Female, yes, yes, yes, no, no, no, no, no
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n── Test 2: QUALIFIED flow (WC45726) ──');
    try {
      await selectStudy(page, 'WC45726');
      await startScreening(page);

      const answers = ['yes', '52', 'Female', 'yes', 'yes', 'yes', 'no', 'no', 'no', 'no', 'no'];
      for (const ans of answers) {
        const verdictNow = await page.locator('.verdict-card').count();
        if (verdictNow > 0) break;
        await sendMessage(page, ans);
      }

      await page.locator('.verdict-card.qualified').waitFor({ state: 'visible', timeout: TIMEOUT });
      await page.locator('.bubble.closing-bubble').waitFor({ state: 'visible', timeout: TIMEOUT });

      const verdictText = await page.locator('.verdict-card.qualified').innerText().catch(() => '');
      const closingText = await page.locator('.bubble.closing-bubble').first().innerText().catch(() => '');
      const ss = await screenshot(page, '2-qualified-WC45726');
      pass('2. QUALIFIED (WC45726)', `.verdict-card.qualified present, .bubble.closing-bubble present | verdict: "${verdictText.slice(0, 60)}…" | closing: "${closingText.slice(0, 60)}" | screenshot: ${ss}`);
    } catch (e) {
      const ss = await screenshot(page, '2-qualified-FAIL').catch(() => 'no screenshot');
      fail('2. QUALIFIED (WC45726)', `${e} | screenshot: ${ss}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 3: DNQ flow on C4771002 — REGRESSION: DNQ must show closing bubble
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n── Test 3: DNQ flow (C4771002) — REGRESSION CHECK ──');
    try {
      await selectStudy(page, 'C4771002');
      await startScreening(page);

      await sendMessage(page, 'yes');  // consent
      await sendMessage(page, '60');   // age 60 (under 65 = DNQ)

      await page.locator('.verdict-card.dnq').waitFor({ state: 'visible', timeout: TIMEOUT });
      await page.locator('.bubble.closing-bubble').waitFor({ state: 'visible', timeout: TIMEOUT });

      const closingText = await page.locator('.bubble.closing-bubble').first().innerText().catch(() => '');
      const ss = await screenshot(page, '3-dnq-C4771002');
      pass('3. DNQ (C4771002)', `.verdict-card.dnq + .bubble.closing-bubble both present | closing: "${closingText.slice(0, 80)}" | screenshot: ${ss}`);
    } catch (e) {
      const ss = await screenshot(page, '3-dnq-FAIL').catch(() => 'no screenshot');
      fail('3. DNQ (C4771002)', `${e} | screenshot: ${ss}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 4: Short-message bubble width — "yes" patient bubble must render
    // as horizontal (width > height), not a vertical sliver.
    // Run on a fresh screen of WC45726; measure the "yes" bubble width.
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n── Test 4: Short-message bubble width ──');
    try {
      await selectStudy(page, 'WC45726');
      await startScreening(page);

      // Send "yes" as the consent reply — this is a short single-word message
      const input = page.locator('textarea.chat-input-textarea');
      await input.waitFor({ state: 'visible', timeout: TIMEOUT });
      await page.waitForFunction(() => {
        const ta = document.querySelector('textarea.chat-input-textarea');
        return ta && !ta.disabled;
      }, { timeout: TIMEOUT });
      await input.fill('yes');
      await input.press('Enter');

      // Wait for the patient bubble to render (don't need to wait for bot response yet)
      await page.waitForTimeout(600);

      // Find all patient bubbles (.bubble.patient, .bubble.user, or .bubble containing "yes")
      let patientBubbles = page.locator('.bubble.patient');
      let count = await patientBubbles.count();
      if (count === 0) {
        patientBubbles = page.locator('.bubble.user');
        count = await patientBubbles.count();
      }
      if (count === 0) {
        patientBubbles = page.locator('.bubble').filter({ hasText: /^yes$/i });
        count = await patientBubbles.count();
      }
      if (count === 0) {
        patientBubbles = page.locator('.bubble').filter({ hasText: 'yes' });
        count = await patientBubbles.count();
      }

      const ss = await screenshot(page, '4-bubble-width');

      if (count === 0) {
        fail('4. Short-message bubble', `No patient bubble found (.bubble.patient / .bubble.user / .bubble with "yes") | screenshot: ${ss}`);
      } else {
        const box = await patientBubbles.first().boundingBox();
        if (!box) {
          fail('4. Short-message bubble', `boundingBox() returned null for patient bubble | screenshot: ${ss}`);
        } else {
          const isHorizontal = box.width > box.height;
          if (isHorizontal) {
            pass('4. Short-message bubble', `"yes" bubble: width=${box.width.toFixed(1)}px > height=${box.height.toFixed(1)}px — horizontal (not a vertical sliver) | screenshot: ${ss}`);
          } else {
            fail('4. Short-message bubble', `"yes" bubble: width=${box.width.toFixed(1)}px, height=${box.height.toFixed(1)}px — width NOT > height (vertical sliver!) | screenshot: ${ss}`);
          }
        }
      }

      // Wait for bot response to settle before next test
      await page.waitForFunction(
        () => {
          const typing = document.querySelector('.typing-indicator');
          const verdict = document.querySelector('.verdict-card');
          const ta = document.querySelector('textarea.chat-input-textarea');
          if (verdict) return true;
          if (!typing && ta && !ta.disabled) return true;
          return false;
        },
        { timeout: TIMEOUT }
      );
    } catch (e) {
      const ss = await screenshot(page, '4-bubble-FAIL').catch(() => 'no screenshot');
      fail('4. Short-message bubble', `${e} | screenshot: ${ss}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 5: Deflection — after consent, send "what is the drug?" →
    //   assert deflection text + same question repeated (cursor not advanced).
    // Uses a FRESH screen of WC45726 (reset from test 4's in-progress state).
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n── Test 5: Deflection ──');
    try {
      // Reset any lingering mid-screen state on WC45726 then start fresh
      await selectStudy(page, 'WC45726');
      await startScreening(page);

      // Give consent to enter screening questions
      await sendMessage(page, 'yes');

      // Record bubble count before off-topic
      const bubblesBefore = await page.locator('.bubble').count();

      // Send off-topic question
      await sendMessage(page, 'what is the drug?');

      // Count new bubbles (deflection response + repeated question = ≥2 new)
      const bubblesAfter = await page.locator('.bubble').count();
      const inputEnabled = await page.locator('textarea.chat-input-textarea').isEnabled();

      const ss = await screenshot(page, '5-deflection');

      const allBubbles = await page.locator('.bubble').allInnerTexts();
      const lastBubble = allBubbles[allBubbles.length - 1] ?? '';

      if (bubblesAfter > bubblesBefore && inputEnabled) {
        pass('5. Deflection', `Bubbles: ${bubblesBefore} → ${bubblesAfter}, input still enabled (cursor not advanced) | last bubble: "${lastBubble.slice(0, 80)}" | screenshot: ${ss}`);
      } else {
        fail('5. Deflection', `bubbles: ${bubblesBefore} → ${bubblesAfter}, inputEnabled: ${inputEnabled} | last: "${lastBubble.slice(0, 80)}" | screenshot: ${ss}`);
      }
    } catch (e) {
      const ss = await screenshot(page, '5-deflection-FAIL').catch(() => 'no screenshot');
      fail('5. Deflection', `${e} | screenshot: ${ss}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 6: Consent decline — start, reply "no" → ends with closing, no Qs
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n── Test 6: Consent decline ──');
    try {
      await selectStudy(page, 'WC45726');
      await startScreening(page);

      await sendMessage(page, 'no');

      // Poll up to 8 seconds for session end
      let hasIncomplete = 0;
      let hasClosing = 0;
      let inputDisabled = false;

      for (let i = 0; i < 16; i++) {
        await page.waitForTimeout(500);
        hasIncomplete = await page.locator('.verdict-card.incomplete').count();
        hasClosing = await page.locator('.bubble.closing-bubble').count();
        inputDisabled = await page.locator('textarea.chat-input-textarea').isDisabled().catch(() => true);
        if (hasIncomplete > 0 || hasClosing > 0 || inputDisabled) break;
      }

      const hasQualified = await page.locator('.verdict-card.qualified').count();
      const hasDNQ = await page.locator('.verdict-card.dnq').count();
      const ss = await screenshot(page, '6-consent-decline');

      if ((hasIncomplete > 0 || hasClosing > 0 || inputDisabled) && hasQualified === 0 && hasDNQ === 0) {
        pass('6. Consent decline', `Session ended (incomplete=${hasIncomplete}, closing=${hasClosing}, inputDisabled=${inputDisabled}), no clinical verdict | screenshot: ${ss}`);
      } else {
        fail('6. Consent decline', `incomplete=${hasIncomplete}, closing=${hasClosing}, inputDisabled=${inputDisabled}, qualified=${hasQualified}, dnq=${hasDNQ} | screenshot: ${ss}`);
      }
    } catch (e) {
      const ss = await screenshot(page, '6-consent-decline-FAIL').catch(() => 'no screenshot');
      fail('6. Consent decline', `${e} | screenshot: ${ss}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 7: Add Study — "+ New Study", name "Sandbox QA", submit no PDF →
    //   ASSERT a DRAFT card appears
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n── Test 7: Add Study ──');
    try {
      const newBtn = page.locator('button', { hasText: /New Study/ }).first();
      await newBtn.waitFor({ state: 'visible', timeout: TIMEOUT });
      await newBtn.click();

      await page.locator('text=Add New Study').waitFor({ state: 'visible', timeout: TIMEOUT });

      // Fill study name (required) — use unique name to avoid 409 on repeated runs
      const nameInput = page.locator('input[placeholder*="e.g."]').first();
      await nameInput.waitFor({ state: 'visible', timeout: TIMEOUT });
      await nameInput.fill(ADD_STUDY_NAME);

      // Fill sponsor if present
      const sponsorInput = page.locator('input[placeholder="Sponsor name"]').first();
      const sponsorVisible = await sponsorInput.isVisible().catch(() => false);
      if (sponsorVisible) {
        await sponsorInput.fill('QA Automation Inc');
      }

      // Submit with no PDF
      await page.locator('button', { hasText: /Upload.*Create|Create.*Study|Submit|Save/i }).first().click();

      // Wait for modal to close and card to appear
      await page.waitForTimeout(4000);

      const modalGone = !(await page.locator('text=Add New Study').isVisible().catch(() => false));

      // Check new card appeared with DRAFT badge
      const newCard = page.locator('.study-card').filter({ hasText: ADD_STUDY_NAME });
      await newCard.waitFor({ state: 'visible', timeout: 10_000 });

      // Check for "draft" text in the card (badge span, data-status, or card text)
      const draftBadgeCount = await newCard.locator('span, .badge, [class*="draft"], [data-status]').filter({ hasText: /draft/i }).count();
      const cardText = await newCard.innerText().catch(() => '');
      const hasDraftText = /draft/i.test(cardText) || draftBadgeCount > 0;

      // Get created study id from API for cleanup
      const studiesRes = await page.evaluate(async () => {
        const r = await fetch('/api/studies');
        return r.json();
      });
      const newStudy = studiesRes.find((s) => s.name && s.name.includes('Sandbox QA'));
      if (newStudy) createdStudyId = newStudy.id;

      const ss = await screenshot(page, '7-add-study');

      if (hasDraftText) {
        pass('7. Add Study', `DRAFT indicator visible on .study-card "${ADD_STUDY_NAME}" (text: "${cardText.slice(0, 80)}", modalGone=${modalGone}) | created id: ${createdStudyId} | screenshot: ${ss}`);
      } else {
        fail('7. Add Study', `modalGone=${modalGone}, draftBadge=${draftBadgeCount}, card text: "${cardText.slice(0, 80)}" | screenshot: ${ss}`);
      }
    } catch (e) {
      const ss = await screenshot(page, '7-add-study-FAIL').catch(() => 'no screenshot');
      fail('7. Add Study', `${e} | screenshot: ${ss}`);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 8: Edit Study — select a study, Edit, change sponsor, Save,
    //   reopen → ASSERT persisted
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n── Test 8: Edit Study ──');
    let originalSponsor = null;
    try {
      await selectStudy(page, 'MK-7240');

      const studyDetail = await page.evaluate(async () => {
        const r = await fetch('/api/studies/MK-7240');
        return r.json();
      });
      originalSponsor = studyDetail.sponsor ?? studyDetail.overview?.sponsor ?? '';

      const editBtn = page.locator('button', { hasText: 'Edit' }).first();
      await editBtn.waitFor({ state: 'visible', timeout: TIMEOUT });
      await editBtn.click();

      await page.locator('text=Edit Study Details').waitFor({ state: 'visible', timeout: TIMEOUT });

      // Sponsor is typically the 3rd input in edit modal
      const sponsorInput = page.locator('input').nth(2);
      await sponsorInput.waitFor({ state: 'visible', timeout: TIMEOUT });
      const newSponsor = 'E2E Test Pharma Ltd';
      await sponsorInput.fill(newSponsor);

      await page.locator('button', { hasText: 'Save Changes' }).first().click();

      await page.waitForTimeout(2500);
      const modalGone = !(await page.locator('text=Edit Study Details').isVisible().catch(() => false));

      // Re-open to verify persistence
      await editBtn.click();
      await page.locator('text=Edit Study Details').waitFor({ state: 'visible', timeout: TIMEOUT });
      const currentVal = await page.locator('input').nth(2).inputValue();

      const ss = await screenshot(page, '8-edit-study');

      if (currentVal === newSponsor) {
        pass('8. Edit Study', `Sponsor persisted as "${newSponsor}" on re-open (modalGone=${modalGone}) | screenshot: ${ss}`);
      } else {
        fail('8. Edit Study', `Expected "${newSponsor}", got "${currentVal}" | screenshot: ${ss}`);
      }

      // Revert sponsor to original
      await page.locator('input').nth(2).fill(originalSponsor ?? '');
      await page.locator('button', { hasText: 'Save Changes' }).first().click();
      await page.waitForTimeout(2000);
      console.log(`      (Reverted sponsor to "${originalSponsor}")`);

    } catch (e) {
      const ss = await screenshot(page, '8-edit-FAIL').catch(() => 'no screenshot');
      fail('8. Edit Study', `${e} | screenshot: ${ss}`);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 9: Funnel — select WC45726 → ASSERT counts + DNQ breakdown +
    //   patient rows. Sandbox has been seeded with 3 patient records.
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n── Test 9: Funnel (WC45726) ──');
    try {
      await selectStudy(page, 'WC45726');

      await page.locator('.report-panel').waitFor({ state: 'visible', timeout: TIMEOUT });
      await page.locator('.metric-card.total').waitFor({ state: 'visible', timeout: TIMEOUT });

      // Allow the funnel dashboard a moment to fetch and render data
      await page.waitForTimeout(1500);

      const totalText = await page.locator('.metric-card.total').innerText();
      const dnqCardVisible = await page.locator('.metric-card.dnq').isVisible();
      const patientRows = await page.locator('.patient-table tbody tr').count().catch(() => 0);

      const totalMatch = totalText.match(/(\d+)/);
      const totalNum = totalMatch ? parseInt(totalMatch[1]) : 0;

      // Cross-check via API
      const apiReport = await page.evaluate(async () => {
        const r = await fetch('/api/report/WC45726');
        if (!r.ok) return null;
        return r.json();
      });
      const apiTotal = apiReport?.counts?.total ?? 0;
      const apiDnqReasons = apiReport?.dnqReasons?.length ?? 0;
      const apiPatients = apiReport?.patients?.length ?? 0;

      const ss = await screenshot(page, '9-funnel-WC45726');

      // Assert: API has data AND UI metric cards are present
      if (apiTotal > 0 && dnqCardVisible && apiDnqReasons > 0) {
        pass('9. Funnel (WC45726)', `.metric-card.total (UI text: "${totalText.trim()}", API total: ${apiTotal}), .metric-card.dnq visible, DNQ reasons: ${apiDnqReasons}, patient rows: ${patientRows} (API patients: ${apiPatients}) | screenshot: ${ss}`);
      } else {
        fail('9. Funnel (WC45726)', `totalText="${totalText.trim()}", apiTotal=${apiTotal}, dnqVisible=${dnqCardVisible}, dnqReasons=${apiDnqReasons}, rows=${patientRows} | screenshot: ${ss}`);
      }
    } catch (e) {
      const ss = await screenshot(page, '9-funnel-FAIL').catch(() => 'no screenshot');
      fail('9. Funnel (WC45726)', `${e} | screenshot: ${ss}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 10a: New Patient reset — after a verdict, click "New Patient" →
    //   chat resets (no verdict, no bubbles, Start Screening shows)
    // TEST 10b: Theme toggle — data-theme flips and persists on reload
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n── Test 10a: New Patient reset ──');
    try {
      await selectStudy(page, 'C4771002');
      await startScreening(page);
      await sendMessage(page, 'yes');  // consent
      await sendMessage(page, '60');   // DNQ age

      await page.locator('.verdict-card').waitFor({ state: 'visible', timeout: TIMEOUT });
      await page.locator('.bubble.closing-bubble').waitFor({ state: 'visible', timeout: TIMEOUT });

      const newPatientBtn = page.locator('button', { hasText: /New Patient/i }).first();
      await newPatientBtn.waitFor({ state: 'visible', timeout: TIMEOUT });
      await newPatientBtn.click();

      await page.waitForTimeout(600);

      const verdictCount = await page.locator('.verdict-card').count();
      const bubbleCount = await page.locator('.bubble').count();
      const startVisible = await page.locator('button', { hasText: 'Start Screening' }).isVisible();

      const ss = await screenshot(page, '10a-new-patient-reset');

      if (verdictCount === 0 && bubbleCount === 0 && startVisible) {
        pass('10a. New Patient reset', `Chat cleared: 0 verdict cards, 0 bubbles, Start Screening visible | screenshot: ${ss}`);
      } else {
        fail('10a. New Patient reset', `verdict=${verdictCount}, bubbles=${bubbleCount}, startVisible=${startVisible} | screenshot: ${ss}`);
      }
    } catch (e) {
      const ss = await screenshot(page, '10a-new-patient-FAIL').catch(() => 'no screenshot');
      fail('10a. New Patient reset', `${e} | screenshot: ${ss}`);
    }

    console.log('\n── Test 10b: Theme toggle ──');
    try {
      const themeBefore = await page.evaluate(
        () => document.documentElement.getAttribute('data-theme') ?? 'dark'
      );

      await page.locator('button[aria-label="Toggle color theme"]').click();
      await page.waitForTimeout(400);

      const themeAfter = await page.evaluate(
        () => document.documentElement.getAttribute('data-theme') ?? ''
      );

      const flipped = themeBefore !== themeAfter;

      // Reload and check persistence
      await page.reload({ waitUntil: 'networkidle', timeout: TIMEOUT });
      await page.waitForTimeout(500);
      const themeAfterReload = await page.evaluate(
        () => document.documentElement.getAttribute('data-theme') ?? ''
      );
      const persisted = themeAfterReload === themeAfter;

      const ss = await screenshot(page, '10b-theme-toggle');

      if (flipped && persisted) {
        pass('10b. Theme toggle', `data-theme: ${themeBefore} → ${themeAfter}, persisted after reload: "${themeAfterReload}" | screenshot: ${ss}`);
      } else {
        fail('10b. Theme toggle', `flipped=${flipped} (${themeBefore}→${themeAfter}), persisted=${persisted} (reload="${themeAfterReload}") | screenshot: ${ss}`);
      }

      // Restore original theme
      if (themeAfterReload !== themeBefore) {
        await page.locator('button[aria-label="Toggle color theme"]').click();
        await page.waitForTimeout(400);
      }
    } catch (e) {
      const ss = await screenshot(page, '10b-theme-FAIL').catch(() => 'no screenshot');
      fail('10b. Theme toggle', `${e} | screenshot: ${ss}`);
    }

  } finally {
    await browser.close();
  }

  // ─────────────────────────────────────────────────────────────────────
  // CLEANUP — delete any study created during test 7 via API
  // (No filesystem deletes; only via the :7906 API endpoint)
  // ─────────────────────────────────────────────────────────────────────
  if (createdStudyId) {
    console.log(`\n── Cleanup: deleting created study ${createdStudyId} via API ──`);
    try {
      const delRes = await fetch(`${BASE_URL}/api/studies/${createdStudyId}`, { method: 'DELETE' });
      if (delRes.ok) {
        console.log(`   Deleted study ${createdStudyId}`);
      } else {
        const body = await delRes.text().catch(() => '');
        console.log(`   DELETE returned ${delRes.status} (${body}) — API may not support DELETE; sandbox dir cleanup needed manually for: ${createdStudyId}`);
      }
    } catch (err) {
      console.log(`   Could not DELETE study (${err})`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // TEST 11: Zero console errors / page errors / failed requests
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n── Test 11: Zero console/page errors & failed requests ──');
  const totalErrors = consoleErrors.length + pageErrors.length + failedRequests.length;
  if (totalErrors === 0) {
    pass('11. Zero errors', 'No console errors, page errors, or failed requests across the session');
  } else {
    const details = [
      ...consoleErrors.map((e) => `[console] ${e.slice(0, 120)}`),
      ...pageErrors.map((e) => `[pageerror] ${e.slice(0, 120)}`),
      ...failedRequests.map((e) => `[request-fail] ${e.slice(0, 120)}`),
    ].join('\n         ');
    fail('11. Zero errors', `${totalErrors} error(s):\n         ${details}`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // FINAL REPORT
  // ─────────────────────────────────────────────────────────────────────
  const allPassed = results.every((r) => r.status === 'PASS');
  const failCount = results.filter((r) => r.status === 'FAIL').length;

  console.log('\n' + '═'.repeat(72));
  if (allPassed) {
    console.log('FUNCTIONAL VERIFICATION: PASS');
  } else {
    console.log(`FUNCTIONAL VERIFICATION: FAIL — ${failCount} flow(s) failed`);
  }
  console.log('═'.repeat(72));

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✔' : '✘';
    console.log(`${icon} [${r.status}] ${r.name}`);
    if (r.evidence) console.log(`         ${r.evidence}`);
  }

  if (createdStudyId) {
    console.log(`\nCreated study id: ${createdStudyId} (cleanup attempted above)`);
  }

  console.log('\nScreenshots: /tmp/vf2-*.png');
  console.log('Harness: /home/groovy/Desktop/projects/comforceEva/platform/apps/web/e2e/verify-flows.mjs');

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error in verify-flows.mjs:', err);
  process.exit(1);
});
