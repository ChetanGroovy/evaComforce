import { useState } from 'react';
import type { StudyDetail } from '../types';
import { AgentFlowGraph } from './AgentFlowGraph';
import { QuestionRoutingModal } from './QuestionRoutingModal';
import { EditStudyModal } from './EditStudyModal';
import { onboardStudy, getStudy } from '../api';

/**
 * Full-page study view mirroring DM Alleviate: "Back to Studies", a header with
 * the study name + Priority badge + sponsor/PI/site, and two tabs —
 * "Study Info" (overview + Knowledge Bank, editable) and
 * "Agent Flow" (the visual flow graph + the Question Routing editor).
 */
export function StudyDetailPage({
  study,
  onBack,
  onStudyUpdated,
}: {
  study: StudyDetail;
  onBack: () => void;
  onStudyUpdated: (updated: StudyDetail) => void;
}) {
  const [tab, setTab] = useState<'info' | 'flow'>('flow');
  const [routingOpen, setRoutingOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(false);

  const extracting = onboarding || study.status === 'onboarding';

  const handleReonboard = async () => {
    if (onboarding) return;
    setOnboarding(true);
    try {
      await onboardStudy(study.id, true);
      // Poll until the pipeline settles (or times out ~90s).
      const TERMINAL = new Set(['needs_review', 'ready', 'draft']);
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const d = await getStudy(study.id);
          onStudyUpdated(d);
          if (!d.status || TERMINAL.has(d.status)) break;
        } catch (_) { /* transient — keep polling */ }
      }
    } catch (_) { /* ignore — button re-enables in finally */ }
    finally {
      setOnboarding(false);
    }
  };

  const ov = study.overview ?? {
    name: study.name,
    internalNumber: '',
    sponsor: study.sponsor,
    principalInvestigator: '',
    site: '',
    priority: '',
    indication: study.indication,
    drug: study.drug ?? '',
  };

  const priority = ov.priority?.trim();

  return (
    <div className="study-page">
      {/* Top bar */}
      <div className="study-page-topbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button className="study-back-btn" onClick={onBack}>
          ← Back to Studies
        </button>
        <button
          className="study-back-btn"
          onClick={() => void handleReonboard()}
          disabled={extracting}
          title="Re-run the document extraction / onboarding pipeline"
          style={{ opacity: extracting ? 0.6 : 1, cursor: extracting ? 'default' : 'pointer' }}
        >
          {extracting ? 'Extracting…' : '↻ Re-run onboarding'}
        </button>
      </div>

      {extracting ? (
        <div
          role="status"
          style={{
            margin: '0 0 10px',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 'var(--fs-sm)',
            fontWeight: 600,
            background: 'var(--badge-draft-bg)',
            color: 'var(--badge-draft-fg)',
            border: '1px solid var(--badge-draft-bd)',
          }}
        >
          Extracting criteria & questions…
        </div>
      ) : null}

      {/* Header */}
      <div className="study-page-header">
        <div className="study-page-title-row">
          <h1 className="study-page-title">{study.name}</h1>
          {priority ? (
            <span className="priority-badge" title="Study priority">
              Priority: {priority}
            </span>
          ) : null}
        </div>
        <div className="study-page-meta">
          {ov.internalNumber ? <span>{ov.internalNumber}</span> : null}
          {ov.sponsor ? (
            <span>
              Sponsor: <mark className="meta-mark">{ov.sponsor}</mark>
            </span>
          ) : null}
          {ov.principalInvestigator ? <span>PI: {ov.principalInvestigator}</span> : null}
          {ov.site ? <span>Site: {ov.site}</span> : null}
        </div>
      </div>

      {/* Tabs */}
      <div className="study-tabs">
        <button
          className={`study-tab ${tab === 'info' ? 'active' : ''}`}
          onClick={() => setTab('info')}
        >
          📄 Study Info
        </button>
        <button
          className={`study-tab ${tab === 'flow' ? 'active' : ''}`}
          onClick={() => setTab('flow')}
        >
          ⵘ Agent Flow
        </button>
      </div>

      {/* Tab body */}
      <div className="study-tab-body">
        {tab === 'info' ? (
          <StudyInfoTab study={study} overview={ov} onEdit={() => setEditOpen(true)} />
        ) : (
          <div className="agent-flow-wrap">
            <div className="flow-toolbar">
              <button className="flow-config-btn" onClick={() => setRoutingOpen(true)}>
                ⵘ Flow Config
              </button>
              <button
                className="flow-add-btn"
                title="Edit questions & routing"
                onClick={() => setRoutingOpen(true)}
              >
                +
              </button>
            </div>
            <AgentFlowGraph flow={study.flow ?? { nodes: [], edges: [] }} />
          </div>
        )}
      </div>

      <QuestionRoutingModal
        study={study}
        open={routingOpen}
        onClose={() => setRoutingOpen(false)}
        onSaved={(updated) => {
          onStudyUpdated(updated);
          setRoutingOpen(false);
        }}
      />
      {editOpen ? (
        <EditStudyModal
          study={study}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            onStudyUpdated(study);
          }}
        />
      ) : null}
    </div>
  );
}

function StudyInfoTab({
  study,
  overview,
  onEdit,
}: {
  study: StudyDetail;
  overview: NonNullable<StudyDetail['overview']>;
  onEdit: () => void;
}) {
  const kb = study.knowledgeBank ?? {};
  const fields: Array<[string, string | undefined]> = [
    ['Sponsor', overview.sponsor],
    ['Principal Investigator', overview.principalInvestigator],
    ['Site', overview.site],
    ['Priority', overview.priority],
    ['Indication', overview.indication],
    ['Drug', overview.drug],
    ['Internal #', overview.internalNumber],
  ];
  return (
    <div className="study-info-tab">
      <div className="study-info-head">
        <h2>Study Information</h2>
        <button className="edit-study-btn" onClick={onEdit}>
          Edit
        </button>
      </div>
      <div className="study-info-grid">
        {fields.map(([label, val]) => (
          <div className="study-info-item" key={label}>
            <span className="study-info-label">{label}</span>
            <span className="study-info-value">{val?.trim() ? val : '—'}</span>
          </div>
        ))}
      </div>
      {Object.keys(kb).length > 0 ? (
        <div className="study-kb">
          <h3>Knowledge Bank</h3>
          {Object.entries(kb).map(([k, v]) =>
            v?.trim() ? (
              <div className="study-kb-item" key={k}>
                <div className="study-kb-key">{k}</div>
                <div className="study-kb-val">{v}</div>
              </div>
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}
