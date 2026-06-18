// Deep crawl of study WC45276 (CT-388-106)_Obesity on Alleviate Health.
// Captures: study tabs (Study Info / Agent Flow / Recruiters), patients,
// scripts / knowledge bank / questions, documents (+ downloads),
// and the Add-Study form (read-only, never submits).
// Reads creds from .env. Output -> study-WC45276/.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
process.chdir(DIR);

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const { DM_LOGIN_URL, DM_USER, DM_PASS } = env;
// study URL + output dir overridable via CLI: node crawl.mjs <studyUrlOrId> <outDir>
const argStudy = process.argv[2];
const DM_STUDY_URL = argStudy
  ? (argStudy.startsWith('http') ? argStudy : `${new URL(env.DM_STUDY_URL).origin}/studies/${argStudy}`)
  : env.DM_STUDY_URL;
const BASE = new URL(DM_STUDY_URL).origin;

const OUT = process.argv[3] || 'study-WC45276';
const RAW = path.join(OUT, 'raw');        // server-action payloads
const SHOT = path.join(OUT, 'shots');     // screenshots
const HTML = path.join(OUT, 'html');      // rendered html per view
const DOCS = path.join(OUT, 'documents'); // downloaded files
[OUT, RAW, SHOT, HTML, DOCS].forEach(d => fs.mkdirSync(d, { recursive: true }));
const log = (...a) => console.log('[crawl]', ...a);

const NOISE = ['posthog', '/monitoring?', 'pylon', 'sentry', 'gtag', 'google-analytics'];
const isNoise = (u) => NOISE.some(n => u.includes(n));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

// capture all non-noise response bodies (json + next server actions)
let rawN = 0;
page.on('response', async (res) => {
  try {
    const url = res.url();
    if (isNoise(url)) return;
    const ct = res.headers()['content-type'] || '';
    const isData = ct.includes('json') || ct.includes('x-component') || ct.includes('text/plain');
    if (!isData) return;
    if (res.request().method() === 'GET' && ct.includes('html')) return;
    const txt = await res.text().catch(() => '');
    if (!txt || txt.length < 2) return;
    rawN++;
    fs.writeFileSync(path.join(RAW, `${String(rawN).padStart(3,'0')}.txt`),
      `URL: ${url}\nMETHOD: ${res.request().method()}\nSTATUS: ${res.status()}\nCT: ${ct}\n\n${txt}`);
  } catch {}
});

const snap = async (name) => {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOT, `${name}.png`), fullPage: true }).catch(() => {});
  const txt = await page.evaluate(() => document.body.innerText).catch(() => '');
  fs.writeFileSync(path.join(OUT, `${name}.txt`), txt);
  const html = await page.content().catch(() => '');
  fs.writeFileSync(path.join(HTML, `${name}.html`), html);
  log('snapped', name, `(${txt.length} chars)`);
  return txt;
};

const clickText = async (t) => {
  try {
    const el = page.getByText(t, { exact: false }).first();
    await el.click({ timeout: 8000 });
    await page.waitForTimeout(3500);
    return true;
  } catch { log('could not click', t); return false; }
};

try {
  // login
  log('login');
  await page.goto(DM_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.$('input[type=email]').then(e => e && e.fill(DM_USER));
  await page.$('input[type=password]').then(e => e && e.fill(DM_PASS));
  await page.$('button[type=submit]').then(e => e && e.click());
  await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 30000 })
    .then(() => log('login OK')).catch(() => log('LOGIN FAILED'));
  await page.waitForTimeout(3000);

  // study page — Study Info tab (default)
  log('study page');
  await page.goto(DM_STUDY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000); // let patients + sections load
  await snap('01-study-info');

  // Agent Flow tab
  if (await clickText('Agent Flow')) await snap('02-agent-flow');
  // Recruiters tab
  if (await clickText('Recruiters')) await snap('03-recruiters');

  // back to study info, expand patients (already loaded), capture
  await page.goto(DM_STUDY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  await snap('04-study-info-loaded');

  // download study documents (authenticated GETs via page context)
  const docLinks = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a[href], [data-href]').forEach(a => {
      const href = a.getAttribute('href') || a.getAttribute('data-href') || '';
      const t = (a.innerText || '').trim();
      if (/\.pdf|document|\/file|download/i.test(href)) out.push({ href, text: t });
    });
    return out;
  });
  fs.writeFileSync(path.join(OUT, 'doc-links.json'), JSON.stringify(docLinks, null, 2));
  log('doc links found:', docLinks.length);
  let di = 0;
  for (const d of docLinks) {
    try {
      const u = d.href.startsWith('http') ? d.href : BASE + d.href;
      const resp = await ctx.request.get(u);
      if (!resp.ok()) { log('doc skip', resp.status(), u.slice(0,80)); continue; }
      const buf = await resp.body();
      di++;
      const safe = (d.text || `doc${di}`).replace(/[^\w.-]+/g, '_').slice(0, 60) || `doc${di}`;
      const ext = (resp.headers()['content-type'] || '').includes('pdf') ? '.pdf' : '';
      fs.writeFileSync(path.join(DOCS, `${String(di).padStart(2,'0')}-${safe}${ext}`), buf);
      log('downloaded doc', di, safe);
    } catch (e) { log('doc err', e.message); }
  }

  // Scripts module (Knowledge Bank / questions)
  log('scripts module');
  await page.goto(BASE + '/scripts', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
  await page.waitForTimeout(6000);
  await snap('05-scripts');

  // Studies list + Add Study form (read-only)
  log('studies list');
  await page.goto(BASE + '/studies', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
  await page.waitForTimeout(6000);
  await snap('06-studies-list');
  // try open Add Study (do NOT submit)
  for (const t of ['Add Study', 'New Study', 'Create Study', 'Add study']) {
    if (await clickText(t)) { await snap('07-add-study-form'); break; }
  }

  log('DONE');
} catch (e) {
  log('FATAL', e.message);
  await page.screenshot({ path: path.join(SHOT, 'fatal.png'), fullPage: true }).catch(()=>{});
} finally {
  log('raw payloads:', rawN);
  await browser.close();
}
