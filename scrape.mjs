// Logs into DM Clinical Research app, opens the study page, captures
// rendered DOM, screenshots, and all XHR/fetch JSON responses.
// Reads creds from .env. Outputs to scrape-out/.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// --- tiny .env loader (no dep) ---
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const { DM_LOGIN_URL, DM_STUDY_URL, DM_USER, DM_PASS } = env;
if (!DM_USER || !DM_PASS) { console.error('Missing DM_USER/DM_PASS in .env'); process.exit(1); }

const OUT = 'scrape-out';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[scrape]', ...a);

const apiDump = [];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// noise we don't care about
const NOISE = ['posthog', '/monitoring?', 'pylon', 'sentry', 'google', 'gtag'];
const isNoise = (u) => NOISE.some(n => u.includes(n));

// capture JSON API responses + log auth/POST
page.on('response', async (res) => {
  try {
    const url = res.url();
    const req = res.request();
    const ct = res.headers()['content-type'] || '';
    if ((req.method() === 'POST' || /login|auth|token|session|sign/i.test(url)) && !isNoise(url)) {
      log('AUTH/POST', res.status(), req.method(), url.slice(0, 120));
    }
    if (ct.includes('application/json') && !isNoise(url)) {
      let body; try { body = await res.json(); } catch { return; }
      apiDump.push({ url, status: res.status(), method: req.method(), body });
    }
  } catch {}
});

try {
  // 1. login
  log('opening login', DM_LOGIN_URL);
  await page.goto(DM_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, '01-login.png'), fullPage: true });

  // try common selectors for email/password
  const emailSel = ['input[type=email]', 'input[name=email]', 'input[name=username]', '#email', '#username'];
  const passSel  = ['input[type=password]', 'input[name=password]', '#password'];
  const findFill = async (sels, val) => {
    for (const s of sels) {
      const el = await page.$(s);
      if (el) { await el.fill(val); return s; }
    }
    return null;
  };
  const eSel = await findFill(emailSel, DM_USER);
  const pSel = await findFill(passSel, DM_PASS);
  log('filled email via', eSel, '| pass via', pSel);

  // submit
  const submitSel = ['button[type=submit]', 'button:has-text("Sign in")', 'button:has-text("Log in")', 'button:has-text("Login")'];
  let submitted = false;
  for (const s of submitSel) {
    const el = await page.$(s);
    if (el) { await el.click(); submitted = true; log('clicked', s); break; }
  }
  if (!submitted) await page.keyboard.press('Enter');

  // wait for navigation away from /login (success), else stay = fail
  await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 30000 })
    .then(() => log('login OK — left /login'))
    .catch(() => log('login STILL on /login — likely failed, check 02 screenshot'));
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, '02-after-login.png'), fullPage: true });
  log('post-login url', page.url());

  // dump any visible error on login form
  const loginErr = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (page.url().includes('/login')) fs.writeFileSync(path.join(OUT, 'login-page.txt'), loginErr);

  // 2. open study page
  log('opening study', DM_STUDY_URL);
  await page.goto(DM_STUDY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(OUT, '03-study.png'), fullPage: true });

  // dump rendered DOM + visible text
  const html = await page.content();
  fs.writeFileSync(path.join(OUT, 'study.html'), html);
  const text = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(OUT, 'study.txt'), text);

  log('final url', page.url());
} catch (e) {
  log('ERROR', e.message);
  await page.screenshot({ path: path.join(OUT, 'error.png'), fullPage: true }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, 'api-responses.json'), JSON.stringify(apiDump, null, 2));
  log('captured', apiDump.length, 'JSON responses');
  await browser.close();
}
