/**
 * comforceEva — Prescreening UI  v2
 * Vanilla JS, no build step, no external dependencies.
 *
 * API CONTRACT (all calls relative):
 *   GET  /api/studies           → [{id,name,sponsor,indication,questionCount}]
 *   GET  /api/studies/:id       → {id,name,sponsor,indication,drug,phase,
 *                                   questions[],criteriaCount{inclusion,exclusion}}
 *   POST /api/screen/start      {studyId}
 *                               → {sessionId, greeting?, prompt, done:false}
 *   POST /api/screen/answer     {sessionId, text}
 *                               → {ack?, prompt?, done, terminal?,
 *                                  reason?, deferred?, closing?, trace?}
 *   GET  /api/report/:id        → {counts{qualified,dnq,incomplete,total},
 *                                  dnqReasons[], patients[]}
 *
 * Conversational fields are optional — all code tolerates absence.
 */

/* ── Helpers ─────────────────────────────────────────── */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function el(tag, classes = '', attrs = {}) {
  const e = document.createElement(tag);
  if (classes) e.className = classes;
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

function now() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmt(n) {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString();
}

function pct(part, total) {
  if (!total || total === 0) return 0;
  return Math.round((part / total) * 100);
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error || j.message || msg; } catch (_) {}
    throw new Error(`${res.status}: ${msg}`);
  }
  return res.json();
}

/** Delay helper for realistic typing cadence */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Animate a numeric value counting up */
function animateCountUp(el, targetVal, duration = 600) {
  const start = performance.now();
  const num = Number(targetVal) || 0;
  if (num === 0) { el.textContent = '0'; return; }

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * num).toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ── State ───────────────────────────────────────────── */
const state = {
  studies: [],
  selectedStudy: null,
  selectedStudyBrief: null,
  sessionId: null,
  screeningActive: false,
  screeningDone: false,
  reportStudyId: null,
  lastAgentRow: null,         // tracks last agent row for avatar suppression
};

/* ── DOM refs ────────────────────────────────────────── */
const studiesList     = $('#studies-list');
const studyDetail     = $('#study-detail');
const chatMessages    = $('#chat-messages');
const chatInput       = $('#chat-input');
const sendBtn         = $('#send-btn');
const startBtn        = $('#start-btn');
const newPatientBtn   = $('#new-patient-btn');
const chatTopTitle    = $('#chat-top-title');
const chatTopSub      = $('#chat-top-sub');
const reportRefresh   = $('#report-refresh');
const reportBody      = $('#report-body');
const searchInput     = $('#study-search');
const screeningStatus = $('#screening-status');

/* ── Agent identity ──────────────────────────────────── */
const AGENT_NAME   = 'Alleviate Assistant';
const AGENT_INITIALS = 'AA';

/* ────────────────────────────────────────────────────────
   STUDY LIST
──────────────────────────────────────────────────────── */
async function loadStudies() {
  studiesList.innerHTML = '';
  const loading = el('div', 'loading-row');
  loading.innerHTML = '<div class="loading-spinner"></div> Loading studies…';
  studiesList.appendChild(loading);

  try {
    const studies = await apiFetch('/api/studies');
    state.studies = studies;
    renderStudyList(studies);
  } catch (err) {
    studiesList.innerHTML = '';
    studiesList.appendChild(errorBanner(`Failed to load studies: ${err.message}`));
  }
}

function renderStudyList(studies) {
  studiesList.innerHTML = '';

  if (!studies.length) {
    const empty = el('div', 'empty-state');
    empty.innerHTML = `
      <div class="empty-state-icon">🔬</div>
      <div class="empty-state-text">No studies available yet. Check back soon.</div>`;
    studiesList.appendChild(empty);
    return;
  }

  studies.forEach(s => {
    const card = el('div', 'study-card');
    if (state.selectedStudy && state.selectedStudy.id === s.id) card.classList.add('active');
    card.dataset.id = s.id;
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');
    const statusTag = s.status === 'draft'
      ? '<span class="study-status-tag draft">Draft</span>'
      : (s.status === 'ready' ? '<span class="study-status-tag ready">Ready</span>' : '');
    card.innerHTML = `
      <div class="study-card-name" title="${esc(s.name)}">${esc(s.name)}${statusTag}</div>
      <div class="study-card-sponsor">${esc(s.sponsor || '—')}</div>
      <div class="study-card-meta">
        ${s.indication ? `<span class="tag tag-indication">${esc(s.indication)}</span>` : ''}
        ${s.phase ? `<span class="tag tag-phase">${esc(s.phase)}</span>` : ''}
        <span class="tag tag-questions">${s.questionCount ?? '?'} Qs</span>
      </div>`;
    card.addEventListener('click', () => selectStudy(s));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStudy(s); } });
    studiesList.appendChild(card);
  });
}

function filterStudies(query) {
  const q = query.toLowerCase().trim();
  const filtered = q
    ? state.studies.filter(s =>
        s.name?.toLowerCase().includes(q) ||
        s.sponsor?.toLowerCase().includes(q) ||
        s.indication?.toLowerCase().includes(q))
    : state.studies;
  renderStudyList(filtered);
}

/* ────────────────────────────────────────────────────────
   STUDY SELECTION
──────────────────────────────────────────────────────── */
async function selectStudy(brief) {
  state.selectedStudyBrief = brief;

  $$('.study-card').forEach(c => c.classList.remove('active'));
  const card = $(`.study-card[data-id="${brief.id}"]`);
  if (card) card.classList.add('active');

  studyDetail.innerHTML = '<div class="loading-row"><div class="loading-spinner"></div> Loading…</div>';

  try {
    const study = await apiFetch(`/api/studies/${brief.id}`);
    state.selectedStudy = study;
    renderStudyDetail(study);
    startBtn.disabled = false;
    updateChatHeader(study);
    state.reportStudyId = study.id;
    loadReport(study.id);

    // Reset chat to ready state
    if (!state.screeningActive && !state.screeningDone) {
      showChatReady(study);
    }
  } catch (err) {
    studyDetail.innerHTML = '';
    studyDetail.appendChild(errorBanner(`Failed to load study: ${err.message}`));
  }
}

function renderStudyDetail(study) {
  const cc = study.criteriaCount || {};
  studyDetail.innerHTML = `
    <div class="study-detail">
      <div class="study-detail-titlerow">
        <div class="study-detail-title" title="${esc(study.name)}">${esc(study.name)}</div>
        <button id="edit-study-btn" class="edit-study-btn" title="Edit study details">Edit</button>
      </div>
      <div class="study-detail-grid">
        <div class="detail-item">
          <span class="detail-label">Drug</span>
          <span class="detail-value">${esc(study.drug || '—')}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Phase</span>
          <span class="detail-value">${esc(study.phase || '—')}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Sponsor</span>
          <span class="detail-value">${esc(study.sponsor || '—')}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Indication</span>
          <span class="detail-value">${esc(study.indication || '—')}</span>
        </div>
      </div>
      <div class="criteria-pills">
        <div class="criteria-pill inclusion">✓ ${cc.inclusion ?? '?'} Inclusion</div>
        <div class="criteria-pill exclusion">✕ ${cc.exclusion ?? '?'} Exclusion</div>
      </div>
    </div>`;
  const eb = document.getElementById('edit-study-btn');
  if (eb) eb.addEventListener('click', () => openEditStudy(study));
}

/* ── Edit Study modal ─────────────────────────────────────── */
function openEditStudy(study) {
  const ov = study.overview || {};
  const kb = study.knowledgeBank || {};
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v || ''; };
  set('es-name', ov.name); set('es-internal', ov.internalNumber); set('es-sponsor', ov.sponsor);
  set('es-pi', ov.principalInvestigator); set('es-priority', ov.priority); set('es-site', ov.site);
  set('es-indication', ov.indication); set('es-drug', ov.drug);
  set('es-kb-general', kb['General Study Information']); set('es-kb-design', kb['Trial Design']);
  set('es-kb-comp', kb['Compensation / Reimbursement']); set('es-kb-blind', kb['Blinding']);
  const msg = document.getElementById('es-msg'); if (msg) { msg.textContent = ''; msg.className = 'modal-msg'; }
  document.getElementById('edit-study-overlay').dataset.id = study.id;
  document.getElementById('edit-study-overlay').hidden = false;
}
(function editStudyModal() {
  const overlay = document.getElementById('edit-study-overlay');
  if (!overlay) return;
  const close = () => { overlay.hidden = true; };
  ['edit-study-close', 'edit-study-cancel'].forEach(id => { const b = document.getElementById(id); if (b) b.addEventListener('click', close); });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const val = id => (document.getElementById(id) || {}).value || '';
  const submit = document.getElementById('edit-study-submit');
  submit && submit.addEventListener('click', async () => {
    const id = overlay.dataset.id;
    const msg = document.getElementById('es-msg');
    submit.disabled = true; msg.textContent = 'Saving…'; msg.className = 'modal-msg';
    try {
      const patch = {
        study: {
          name: val('es-name'), internalNumber: val('es-internal'), sponsor: val('es-sponsor'),
          principalInvestigator: val('es-pi'), site: val('es-site'), priority: val('es-priority'),
          indication: val('es-indication'), drug: val('es-drug'),
        },
        knowledgeBank: {
          'General Study Information': val('es-kb-general'), 'Trial Design': val('es-kb-design'),
          'Compensation / Reimbursement': val('es-kb-comp'), 'Blinding': val('es-kb-blind'),
        },
      };
      const res = await fetch(`/api/studies/${id}/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const data = await res.json();
      if (!res.ok) { msg.textContent = data.error || 'Save failed.'; msg.className = 'modal-msg err'; submit.disabled = false; return; }
      msg.textContent = 'Saved.'; msg.className = 'modal-msg ok';
      await loadStudies();
      if (state.selectedStudyBrief && state.selectedStudyBrief.id === id) await selectStudy({ id });
      setTimeout(() => { close(); submit.disabled = false; }, 900);
    } catch (e) { msg.textContent = 'Error: ' + (e && e.message || e); msg.className = 'modal-msg err'; submit.disabled = false; }
  });
})();

function updateChatHeader(study) {
  chatTopTitle.textContent = study.name;
  const parts = [study.sponsor, study.indication].filter(Boolean);
  chatTopSub.textContent = parts.join(' · ');
}

/* ────────────────────────────────────────────────────────
   CHAT STATE MANAGEMENT
──────────────────────────────────────────────────────── */
function resetChat() {
  chatMessages.innerHTML = '';
  state.sessionId = null;
  state.screeningActive = false;
  state.screeningDone = false;
  state.lastAgentRow = null;
  chatInput.value = '';
  setInputEnabled(false);
  startBtn.classList.remove('hidden');
  startBtn.disabled = !state.selectedStudy;
  newPatientBtn.classList.add('hidden');
  screeningStatus.classList.add('hidden');

  if (!state.selectedStudy) {
    showChatEmpty();
  } else {
    showChatReady(state.selectedStudy);
  }
}

function showChatEmpty() {
  chatMessages.innerHTML = `
    <div class="chat-empty">
      <div class="chat-empty-icon">💬</div>
      <div class="chat-empty-title">Select a study to begin</div>
      <div class="chat-empty-sub">Choose a clinical trial from the left sidebar, then start a new patient screening conversation.</div>
    </div>`;
}

function showChatReady(study) {
  chatMessages.innerHTML = `
    <div class="chat-empty">
      <div class="chat-empty-icon">🩺</div>
      <div class="chat-empty-title">Ready to screen</div>
      <div class="chat-empty-sub">Click <strong style="color:var(--text-secondary)">Start Screening</strong> to begin a patient conversation for <em style="color:var(--accent-bright)">${esc(study.name)}</em>.</div>
    </div>`;
}

/* ────────────────────────────────────────────────────────
   SCREENING FLOW
──────────────────────────────────────────────────────── */
async function startScreening() {
  if (!state.selectedStudy) return;
  startBtn.disabled = true;

  chatMessages.innerHTML = '';
  state.screeningDone = false;
  state.lastAgentRow = null;

  // Show session divider
  appendSessionDivider();

  // Show typing
  appendTyping();

  try {
    const res = await apiFetch('/api/screen/start', {
      method: 'POST',
      body: JSON.stringify({ studyId: state.selectedStudy.id }),
    });

    state.sessionId = res.sessionId;
    state.screeningActive = true;

    // Show screening status pill
    screeningStatus.classList.remove('hidden');

    removeTyping();

    // If greeting present, show it first as a warm welcome bubble
    if (res.greeting) {
      appendAgentBubble(res.greeting, 'greeting-bubble');
      // Brief pause then show the first question
      await delay(520);
      appendTyping();
      await delay(650);
      removeTyping();
    }

    // Show the first question (prompt)
    if (res.prompt) {
      appendAgentBubble(res.prompt);
    }

    if (res.done) {
      await finalizeScreening({
        done: true,
        terminal: res.terminal,
        reason: res.reason,
        trace: res.trace,
        deferred: res.deferred,
        closing: res.closing,
      });
    } else {
      setInputEnabled(true);
    }

    startBtn.classList.add('hidden');
    newPatientBtn.classList.remove('hidden');
  } catch (err) {
    removeTyping();
    appendError(`Failed to start screening: ${err.message}`);
    startBtn.disabled = false;
    screeningStatus.classList.add('hidden');
  }
}

async function sendAnswer() {
  const text = chatInput.value.trim();
  if (!text || !state.sessionId || state.screeningDone) return;

  chatInput.value = '';
  autoResizeTextarea(chatInput);
  setInputEnabled(false);

  appendPatientBubble(text);
  appendTyping();

  try {
    const res = await apiFetch('/api/screen/answer', {
      method: 'POST',
      body: JSON.stringify({ sessionId: state.sessionId, text }),
    });

    // If there's an ack, show it with typing-then-reveal pattern
    if (res.ack) {
      removeTyping();
      appendAgentBubble(res.ack, 'ack-bubble');
      // Natural delay before the next question appears
      await delay(480);
      if (!res.done && res.prompt) {
        appendTyping();
        await delay(680);
        removeTyping();
      }
    } else {
      removeTyping();
    }

    if (res.prompt && !res.done) {
      appendAgentBubble(res.prompt);
    }

    if (res.done) {
      await finalizeScreening(res);
    } else if (!res.prompt) {
      // No next question yet but not done — re-enable input
      setInputEnabled(true);
    } else if (res.prompt) {
      setInputEnabled(true);
    }

  } catch (err) {
    removeTyping();
    appendError(`Error: ${err.message}`);
    setInputEnabled(true);
  }
}

async function finalizeScreening(res) {
  state.screeningDone = true;
  state.screeningActive = false;
  setInputEnabled(false);
  screeningStatus.classList.add('hidden');

  const terminal = (res.terminal || 'INCOMPLETE').toUpperCase();

  // Small pause before verdict appears for dramatic effect
  await delay(300);

  appendVerdictCard(terminal, res.reason, res.trace, res.deferred);

  // If qualified and there's a closing message, show it as a friendly bubble
  if (terminal === 'QUALIFIED' && res.closing) {
    await delay(600);
    appendTyping();
    await delay(800);
    removeTyping();
    appendAgentBubble(res.closing, 'closing-bubble');
  }

  // Refresh dashboard after a moment
  if (state.reportStudyId) {
    setTimeout(() => loadReport(state.reportStudyId), 1400);
  }
}

/* ────────────────────────────────────────────────────────
   BUBBLE HELPERS
──────────────────────────────────────────────────────── */

/**
 * Append an agent message bubble.
 * @param {string} text - Message text
 * @param {string} [extraClass] - Optional extra CSS class for the bubble
 */
function appendAgentBubble(text, extraClass = '') {
  const row = el('div', 'msg-row agent');
  row.innerHTML = `
    <div class="msg-avatar agent-avatar" title="${esc(AGENT_NAME)}">${esc(AGENT_INITIALS)}</div>
    <div class="msg-col">
      <div class="bubble${extraClass ? ' ' + extraClass : ''}">${esc(text)}</div>
      <div class="msg-time">${esc(AGENT_NAME)} · ${now()}</div>
    </div>`;
  chatMessages.appendChild(row);
  state.lastAgentRow = row;
  scrollChat();
}

function appendPatientBubble(text) {
  const row = el('div', 'msg-row patient');
  row.innerHTML = `
    <div class="msg-col">
      <div class="bubble">${esc(text)}</div>
      <div class="msg-time">${now()}</div>
    </div>
    <div class="msg-avatar patient-avatar">PT</div>`;
  chatMessages.appendChild(row);
  state.lastAgentRow = null; // reset grouping after patient speaks
  scrollChat();
}

function appendTyping() {
  const row = el('div', 'typing-indicator');
  row.id = 'typing-row';
  row.innerHTML = `
    <div class="msg-avatar agent-avatar">${esc(AGENT_INITIALS)}</div>
    <div class="typing-dots"><span></span><span></span><span></span></div>`;
  chatMessages.appendChild(row);
  scrollChat();
}

function removeTyping() {
  const t = $('#typing-row');
  if (t) t.remove();
}

function appendError(msg) {
  const wrap = el('div', '');
  wrap.style.padding = '4px 0';
  wrap.appendChild(errorBanner(msg));
  chatMessages.appendChild(wrap);
  scrollChat();
}

function appendSessionDivider() {
  const d = el('div', 'chat-divider');
  const time = new Date().toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  d.innerHTML = `
    <div class="chat-divider-line"></div>
    <div class="chat-divider-label">Session · ${esc(time)}</div>
    <div class="chat-divider-line"></div>`;
  chatMessages.appendChild(d);
}

/* ────────────────────────────────────────────────────────
   VERDICT CARD
──────────────────────────────────────────────────────── */
function appendVerdictCard(terminal, reason, trace, deferred) {
  const meta = {
    QUALIFIED:  { cls: 'qualified',  icon: '✓',  label: 'Qualified',        badge: 'Patient Eligible' },
    DNQ:        { cls: 'dnq',        icon: '✕',  label: 'Did Not Qualify',  badge: 'Screening Result' },
    INCOMPLETE: { cls: 'incomplete', icon: '…',  label: 'Incomplete',       badge: 'Session Ended'   },
  };

  const m = meta[terminal] || meta.INCOMPLETE;
  const card = el('div', `verdict-card ${m.cls}`);

  let html = `
    <div class="verdict-header">
      <div class="verdict-icon-wrap"><span style="font-weight:800;font-size:18px;color:inherit">${m.icon}</span></div>
      <div class="verdict-title-group">
        <div class="verdict-badge">${m.badge}</div>
        <div class="verdict-label">${m.label}</div>
      </div>
    </div>`;

  if (reason) {
    html += `<div class="verdict-reason">${esc(reason)}</div>`;
  }

  if (deferred) {
    const dText = Array.isArray(deferred) ? deferred.join(', ') : String(deferred);
    html += `
      <div class="verdict-deferred">
        <span>⏳</span>
        <span><strong>Deferred items:</strong> ${esc(dText)}</span>
      </div>`;
  }

  if (trace && trace.length) {
    const traceId = `trace-${Date.now()}`;
    html += `
      <div class="verdict-actions">
        <div class="trace-toggle" role="button" tabindex="0" aria-expanded="false"
             onclick="toggleTrace(this, '${traceId}')"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleTrace(this,'${traceId}')}">
          <span class="trace-arrow">▶</span>
          Decision trace (${trace.length} item${trace.length !== 1 ? 's' : ''})
        </div>
      </div>
      <div class="trace-table-wrapper hidden" id="${traceId}">
        <table class="trace-table">
          <thead>
            <tr><th>#</th><th>Variable</th><th>Answer</th><th>Disq?</th></tr>
          </thead>
          <tbody>
            ${trace.map((r, i) => `
              <tr>
                <td>${esc(String(r.rank ?? i + 1))}</td>
                <td>${esc(r.variable || r.variable_name || '—')}</td>
                <td>${esc(String(r.answer ?? '—'))}</td>
                <td class="${r.disqualified ? 'disq-yes' : 'disq-no'}">${r.disqualified ? 'Disq.' : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  card.innerHTML = html;
  chatMessages.appendChild(card);
  scrollChat();
}

window.toggleTrace = function(toggleEl, wrapperId) {
  const arrow   = $('.trace-arrow', toggleEl);
  const wrapper = document.getElementById(wrapperId);
  if (!wrapper) return;
  const isOpen = !wrapper.classList.contains('hidden');
  wrapper.classList.toggle('hidden', isOpen);
  arrow.classList.toggle('open', !isOpen);
  toggleEl.setAttribute('aria-expanded', String(!isOpen));
};

/* ────────────────────────────────────────────────────────
   INPUT HELPERS
──────────────────────────────────────────────────────── */
function setInputEnabled(enabled) {
  chatInput.disabled = !enabled;
  sendBtn.disabled   = !enabled;
  if (enabled) chatInput.focus();
}

function autoResizeTextarea(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

function scrollChat() {
  requestAnimationFrame(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

/* ────────────────────────────────────────────────────────
   REPORT / FUNNEL DASHBOARD
──────────────────────────────────────────────────────── */
async function loadReport(studyId) {
  reportBody.innerHTML = '<div class="loading-row"><div class="loading-spinner"></div> Loading report…</div>';

  try {
    const data = await apiFetch(`/api/report/${studyId}`);
    renderReport(data);
  } catch (err) {
    reportBody.innerHTML = '';
    const msg = err.message.startsWith('404')
      ? 'No screening data yet for this study.'
      : `Report error: ${err.message}`;
    reportBody.appendChild(emptyState('📊', msg));
  }
}

function renderReport(data) {
  reportBody.innerHTML = '';

  const counts = data.counts || {};
  const total = Number(counts.total) || 0;

  // ── Metric cards ──────────────────────────────────────
  const metricGrid = el('div', 'metric-grid');

  function makeMetric(cls, label, value, showBar = false) {
    const p = pct(value, total);
    const card = el('div', `metric-card ${cls}`);
    card.innerHTML = `
      <div class="metric-value" data-target="${Number(value) || 0}">—</div>
      <div class="metric-label">${label}</div>
      ${showBar && total > 0 ? `
        <div class="conversion-bar">
          <div class="metric-pct">${p}%</div>
          <div class="conversion-bar-track">
            <div class="conversion-bar-fill" style="width:0%" data-width="${p}%"></div>
          </div>
        </div>` : ''}`;
    return card;
  }

  metricGrid.appendChild(makeMetric('total',      'Total Screened',   counts.total,      false));
  metricGrid.appendChild(makeMetric('qualified',  'Qualified',        counts.qualified,  true));
  metricGrid.appendChild(makeMetric('dnq',        'Did Not Qualify',  counts.dnq,        true));
  metricGrid.appendChild(makeMetric('incomplete', 'Incomplete',       counts.incomplete, true));
  reportBody.appendChild(metricGrid);

  // Animate count-up after a frame
  requestAnimationFrame(() => {
    $$('[data-target]', metricGrid).forEach(el => {
      const target = Number(el.dataset.target);
      animateCountUp(el, target, 700);
    });
    setTimeout(() => {
      $$('[data-width]', metricGrid).forEach(el => {
        el.style.width = el.dataset.width;
      });
    }, 100);
  });

  // ── DNQ Reason bars ────────────────────────────────────
  const dnqReasons = data.dnqReasons || [];
  const reasonSection = el('div', '');
  const maxCount = dnqReasons.length ? Math.max(...dnqReasons.map(r => r.count || 0), 1) : 1;

  let reasonHTML = `<div class="section-label">DNQ Breakdown</div>`;
  if (dnqReasons.length) {
    reasonHTML += `<div class="dnq-bars">` +
      dnqReasons.map(r => {
        const barPct = maxCount > 0 ? Math.round((r.count / maxCount) * 100) : 0;
        return `
          <div class="dnq-bar-row">
            <div class="dnq-bar-label">
              <span class="dnq-bar-text" title="${esc(r.reason)}">${esc(r.reason)}</span>
              <span class="dnq-bar-count">${r.count}</span>
            </div>
            <div class="dnq-bar-track">
              <div class="dnq-bar-fill" data-width="${barPct}%"></div>
            </div>
          </div>`;
      }).join('') + `</div>`;
  } else {
    reasonHTML += `<div style="font-size:11.5px;color:var(--text-muted);text-align:center;padding:14px 0;line-height:1.6">No disqualification data yet for this study.</div>`;
  }

  reasonSection.innerHTML = reasonHTML;
  reportBody.appendChild(reasonSection);

  // Animate bars after paint
  requestAnimationFrame(() => {
    setTimeout(() => {
      $$('.dnq-bar-fill', reasonSection).forEach(el => {
        el.style.width = el.dataset.width || '0%';
      });
    }, 80);
  });

  // ── Patient results table ──────────────────────────────
  const patients = data.patients || [];
  const patientSection = el('div', '');
  let patHTML = `<div class="section-label">Patient Results</div>`;

  if (patients.length) {
    patHTML += `
      <div class="patient-table-wrapper">
        <table class="patient-table">
          <thead>
            <tr><th>Patient</th><th>Result</th><th>Notes</th></tr>
          </thead>
          <tbody>
            ${patients.map(p => {
              const t = (p.terminal || 'INCOMPLETE').toUpperCase();
              const chipClass = t === 'QUALIFIED' ? 'qualified' : t === 'DNQ' ? 'dnq' : 'incomplete';
              const chipLabel = t === 'QUALIFIED' ? 'Qual' : t === 'DNQ' ? 'DNQ' : 'Inc.';
              return `
                <tr>
                  <td>${esc(p.patient || '—')}</td>
                  <td><span class="result-chip ${chipClass}">${chipLabel}</span></td>
                  <td><span class="patient-reason">${esc(p.reason || p.failed || '—')}</span></td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } else {
    patHTML += `<div style="font-size:11.5px;color:var(--text-muted);text-align:center;padding:14px 0;line-height:1.6">No patient records yet for this study.</div>`;
  }

  patientSection.innerHTML = patHTML;
  reportBody.appendChild(patientSection);
}

/* ────────────────────────────────────────────────────────
   UTILITY COMPONENTS
──────────────────────────────────────────────────────── */
function errorBanner(msg) {
  const b = el('div', 'error-banner');
  b.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="flex-shrink:0;margin-top:1px">
      <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.4"/>
      <path d="M8 5v4M8 11v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <span>${esc(msg)}</span>`;
  return b;
}

function emptyState(icon, text) {
  const s = el('div', 'empty-state');
  s.innerHTML = `<div class="empty-state-icon">${icon}</div><div class="empty-state-text">${esc(text)}</div>`;
  return s;
}

/* ────────────────────────────────────────────────────────
   EVENT WIRING
──────────────────────────────────────────────────────── */
startBtn.addEventListener('click', startScreening);

newPatientBtn.addEventListener('click', () => {
  resetChat();
  if (state.selectedStudy) {
    startBtn.disabled = false;
  }
});

sendBtn.addEventListener('click', sendAnswer);

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendAnswer();
  }
});

chatInput.addEventListener('input', () => autoResizeTextarea(chatInput));

reportRefresh.addEventListener('click', () => {
  if (state.reportStudyId) loadReport(state.reportStudyId);
});

searchInput.addEventListener('input', e => filterStudies(e.target.value));

/* ────────────────────────────────────────────────────────
   INIT
──────────────────────────────────────────────────────── */
resetChat();
loadStudies();

/* ── Add Study modal ──────────────────────────────────────── */
(function addStudyModal(){
  const overlay = document.getElementById('add-study-overlay');
  const openBtn = document.getElementById('add-study-btn');
  if (!overlay || !openBtn) return;
  const closeEls = ['add-study-close','add-study-cancel'].map(id=>document.getElementById(id));
  const submitBtn = document.getElementById('add-study-submit');
  const msg = document.getElementById('ns-msg');
  const fields = {
    name: document.getElementById('ns-name'),
    internal: document.getElementById('ns-internal'),
    sponsor: document.getElementById('ns-sponsor'),
    indication: document.getElementById('ns-indication'),
    protocol: document.getElementById('ns-protocol'),
    icf: document.getElementById('ns-icf'),
  };
  const open = () => { overlay.hidden = false; setMsg('',''); fields.name.focus(); };
  const close = () => { overlay.hidden = true; };
  const setMsg = (t, cls) => { msg.textContent = t; msg.className = 'modal-msg' + (cls ? ' '+cls : ''); };
  openBtn.addEventListener('click', open);
  closeEls.forEach(b => b && b.addEventListener('click', close));
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const fileToB64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]); // strip data: prefix
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  submitBtn.addEventListener('click', async () => {
    const name = fields.name.value.trim();
    if (!name) { setMsg('Study name is required.', 'err'); return; }
    submitBtn.disabled = true; setMsg('Uploading & extracting…', '');
    try {
      const documents = [];
      if (fields.protocol.files[0]) documents.push({ filename: fields.protocol.files[0].name, type: 'Protocol', dataBase64: await fileToB64(fields.protocol.files[0]) });
      if (fields.icf.files[0]) documents.push({ filename: fields.icf.files[0].name, type: 'ICF', dataBase64: await fileToB64(fields.icf.files[0]) });
      const res = await fetch('/api/studies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, internalNumber: fields.internal.value.trim(), sponsor: fields.sponsor.value.trim(), indication: fields.indication.value.trim(), documents }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || 'Failed to create study.', 'err'); submitBtn.disabled = false; return; }
      setMsg(`Created "${data.id}" (${data.documents} doc${data.documents===1?'':'s'}). ${data.note || ''}`, 'ok');
      await loadStudies();
      setTimeout(() => { close(); submitBtn.disabled = false; [fields.name,fields.internal,fields.sponsor,fields.indication].forEach(f=>f.value=''); fields.protocol.value=''; fields.icf.value=''; }, 1600);
    } catch (e) {
      setMsg('Error: ' + (e && e.message || e), 'err'); submitBtn.disabled = false;
    }
  });
})();
