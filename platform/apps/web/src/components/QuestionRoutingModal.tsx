import { useState, useEffect, useCallback } from 'react';
import { Modal, BtnGhost, BtnPrimary, ModalMsg } from './ui/Modal';
import { updateStudy } from '../api';
import type {
  StudyDetail,
  StudyFlow,
  FlowEdge,
  ScreeningQuestionFull,
} from '../types';

/* ─────────────────────────────────────────────────────────────
   Internal state types
───────────────────────────────────────────────────────────── */

interface PathRow {
  id: string; // local UUID for React key
  edgeLabel: string;
  destination: string; // node id: variable_name, 'qualified', or 'dnq_*'
}

interface QuestionRow {
  id: string; // local UUID for React key
  variable_name: string;
  sms_question: string;
  answer_type: string;
  choices: string[];
  paths: PathRow[];
  /** preserve all original fields verbatim */
  _original: ScreeningQuestionFull | null;
}

type AnswerType = 'yes_no' | 'number' | 'choice';

const ANSWER_TYPE_LABELS: Record<string, string> = {
  yes_no: 'Yes/No',
  number: 'Number',
  choice: 'Choice',
};

const ALL_ANSWER_TYPES: AnswerType[] = ['yes_no', 'number', 'choice'];

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */

let _uid = 0;
function uid(): string {
  return `_r${++_uid}_${Math.random().toString(36).slice(2, 7)}`;
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Build internal QuestionRow list from study props */
function buildRows(
  questions: ScreeningQuestionFull[],
  flow: StudyFlow,
): QuestionRow[] {
  return questions.map((q) => {
    const edgesForQ = flow.edges.filter((e) => e.source === q.variable_name);
    const paths: PathRow[] = edgesForQ.map((e) => ({
      id: uid(),
      edgeLabel: e.label,
      destination: e.target,
    }));
    return {
      id: uid(),
      variable_name: q.variable_name,
      sms_question: q.sms_question,
      answer_type: q.answer_type,
      choices: Array.isArray(q.choices) ? [...q.choices] : [],
      paths,
      _original: q,
    };
  });
}

/** Get all terminal nodes from the original flow */
function getTerminalNodes(flow: StudyFlow) {
  return flow.nodes.filter(
    (n) => n.type === 'dnq' || n.type === 'qualified' || n.type === 'root',
  );
}

/* destination display label for the coloured echo pill */
function destinationEchoLabel(
  dest: string,
  rows: QuestionRow[],
  flow: StudyFlow,
): string {
  if (dest === 'qualified') return 'Qualified';
  const q = rows.find((r) => r.variable_name === dest);
  if (q) return q.sms_question.slice(0, 40) + (q.sms_question.length > 40 ? '…' : '');
  const node = flow.nodes.find((n) => n.id === dest);
  if (node) return node.label;
  return dest;
}

function destinationKind(
  dest: string,
  rows: QuestionRow[],
): 'question' | 'dnq' | 'qualified' | 'unknown' {
  if (dest === 'qualified') return 'qualified';
  if (dest.startsWith('dnq')) return 'dnq';
  if (rows.find((r) => r.variable_name === dest)) return 'question';
  return 'unknown';
}

/* ─────────────────────────────────────────────────────────────
   Choices editor sub-component
───────────────────────────────────────────────────────────── */

interface ChoicesEditorProps {
  choices: string[];
  onChange: (choices: string[]) => void;
  onClose: () => void;
}

function ChoicesEditor({ choices, onChange, onClose }: ChoicesEditorProps) {
  const [local, setLocal] = useState<string[]>(choices.length ? [...choices] : ['']);

  function update(idx: number, val: string) {
    const next = [...local];
    next[idx] = val;
    setLocal(next);
    onChange(next.filter((c) => c.trim() !== ''));
  }

  function addChoice() {
    setLocal([...local, '']);
  }

  function removeChoice(idx: number) {
    const next = local.filter((_, i) => i !== idx);
    setLocal(next.length ? next : ['']);
    onChange(next.filter((c) => c.trim() !== ''));
  }

  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: '10px 12px',
        marginTop: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 'var(--fs-xs)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>Choices</span>
        <button
          onClick={onClose}
          style={btnReset}
          aria-label="Close choices editor"
        >
          ×
        </button>
      </div>
      {local.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            value={c}
            onChange={(e) => update(i, e.target.value)}
            placeholder={`Choice ${i + 1}`}
            style={inputStyle}
          />
          <button
            onClick={() => removeChoice(i)}
            style={{ ...btnReset, color: 'var(--red)', fontSize: 'var(--fs-lg)' }}
            aria-label="Remove choice"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={addChoice}
        style={{ ...addLink, marginTop: 2 }}
      >
        ＋ Add choice
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Shared inline style fragments
───────────────────────────────────────────────────────────── */

const btnReset: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '2px 4px',
  fontFamily: 'var(--font-sans)',
  lineHeight: 1,
};

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-xs)',
  color: 'var(--text-primary)',
  padding: '6px 9px',
  fontSize: 'var(--fs-md)',
  outline: 'none',
  fontFamily: 'var(--font-sans)',
  width: '100%',
  transition: 'border-color var(--t-fast)',
};

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-xs)',
  color: 'var(--text-primary)',
  padding: '5px 8px',
  fontSize: 'var(--fs-md)',
  outline: 'none',
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
};

const addLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--accent)',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'var(--font-sans)',
  padding: '2px 0',
  textAlign: 'left',
};

const trashBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  fontSize: 'var(--fs-lg)',
  lineHeight: 1,
  padding: '3px 5px',
  borderRadius: 'var(--radius-xs)',
  fontFamily: 'var(--font-sans)',
  flexShrink: 0,
  transition: 'color var(--t-fast)',
};

/* ─────────────────────────────────────────────────────────────
   QuestionRoutingModal
───────────────────────────────────────────────────────────── */

export interface QuestionRoutingModalProps {
  study: StudyDetail;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: StudyDetail) => void;
}

export function QuestionRoutingModal({
  study,
  open,
  onClose,
  onSaved,
}: QuestionRoutingModalProps): JSX.Element | null {
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [terminalNodes, setTerminalNodes] = useState<
    { id: string; type: string; label: string }[]
  >([]);
  const [originalFlow, setOriginalFlow] = useState<StudyFlow | null>(null);
  const [expandedChoices, setExpandedChoices] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' | 'neutral' }>({
    text: '',
    kind: 'neutral',
  });

  /* ── Initialize state on open ── */
  useEffect(() => {
    if (!open) return;
    const flow = study.flow
      ? deepClone(study.flow)
      : { nodes: [], edges: [] };
    const questions = study.screeningQuestions
      ? deepClone(study.screeningQuestions)
      : [];

    setOriginalFlow(flow);
    setTerminalNodes(getTerminalNodes(flow));
    setRows(buildRows(questions, flow));
    setExpandedChoices({});
    setMsg({ text: '', kind: 'neutral' });
    setSaving(false);
  }, [open, study]);

  /* ── Escape to close ── */
  const handleClose = useCallback(() => {
    if (!saving) onClose();
  }, [saving, onClose]);

  if (!open) return null;

  /* ─── Row mutation helpers ─── */

  function updateRow(rowId: string, patch: Partial<QuestionRow>) {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
    );
  }

  function deleteRow(rowId: string) {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    setExpandedChoices((prev) => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  }

  function addPath(rowId: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const newPath: PathRow = {
          id: uid(),
          edgeLabel: '',
          destination: '',
        };
        return { ...r, paths: [...r.paths, newPath] };
      }),
    );
  }

  function updatePath(rowId: string, pathId: string, patch: Partial<PathRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        return {
          ...r,
          paths: r.paths.map((p) =>
            p.id === pathId ? { ...p, ...patch } : p,
          ),
        };
      }),
    );
  }

  function deletePath(rowId: string, pathId: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        return { ...r, paths: r.paths.filter((p) => p.id !== pathId) };
      }),
    );
  }

  function addQuestion() {
    // Generate inside the functional updater off `prev` so rapid double-clicks
    // can't capture a stale `rows` and mint duplicate variable_names.
    setRows((prev) => {
      const used = new Set(prev.map((r) => r.variable_name));
      let n = prev.length + 1;
      while (used.has(`q${n}`)) n++;
      const vname = `q${n}`;
      const maxRank = prev.reduce((m, r) => Math.max(m, r._original?.rank ?? 0), 0);
      const newQ: QuestionRow = {
        id: uid(),
        variable_name: vname,
        sms_question: '',
        answer_type: 'yes_no',
        choices: [],
        paths: [],
        _original: { rank: maxRank + 1, variable_name: vname, sms_question: '', answer_type: 'yes_no' },
      };
      return [...prev, newQ];
    });
  }

  /* ─── Destination dropdown options ─── */

  function buildDestinationOptions(currentRowId: string) {
    const questionOpts = rows
      .filter((r) => r.id !== currentRowId)
      .map((r) => {
        const realIndex = rows.findIndex((rr) => rr.id === r.id); // true position in the full list
        return {
          value: r.variable_name,
          label: `Q${realIndex + 1}: ${r.sms_question.slice(0, 50)}${r.sms_question.length > 50 ? '…' : ''}`,
          kind: 'question' as const,
        };
      });

    const dnqOpts = terminalNodes
      .filter((n) => n.type === 'dnq')
      .map((n, i) => ({
        value: n.id,
        label: `#${i + 1}: ${n.label}`,
        kind: 'dnq' as const,
      }));

    const qualifiedOpt = terminalNodes.find((n) => n.type === 'qualified');

    return { questionOpts, dnqOpts, qualifiedOpt };
  }

  /* ─── Save ─── */

  async function handleSave() {
    setSaving(true);
    setMsg({ text: 'Saving…', kind: 'neutral' });

    try {
      // 1. Rebuild screeningQuestions — preserve all original fields, override editable ones
      const updatedQuestions: ScreeningQuestionFull[] = rows.map((r, i) => {
        const base: ScreeningQuestionFull = r._original
          ? { ...r._original }
          : {
              rank: i + 1,
              variable_name: r.variable_name,
              sms_question: r.sms_question,
              answer_type: r.answer_type,
            };
        return {
          ...base,
          rank: i + 1,
          sms_question: r.sms_question,
          answer_type: r.answer_type,
          choices: r.answer_type === 'choice' && r.choices.length > 0 ? r.choices : null,
        };
      });

      // 2. Rebuild flow.nodes:
      //    - one node per question row
      //    - keep all terminals (dnq/qualified/root) from original that are still referenced
      const referencedTargets = new Set<string>();
      rows.forEach((r) => {
        r.paths.forEach((p) => {
          if (p.destination) referencedTargets.add(p.destination);
        });
      });

      const questionNodes = rows.map((r) => ({
        id: r.variable_name,
        type: 'question' as const,
        label: r.sms_question || r.variable_name,
      }));

      const baseFlow = originalFlow ?? { nodes: [], edges: [] };
      const keptTerminals = baseFlow.nodes.filter(
        (n) =>
          (n.type === 'dnq' || n.type === 'qualified' || n.type === 'root') &&
          (referencedTargets.has(n.id) ||
            n.type === 'root' ||
            n.type === 'qualified'),
      );

      // De-dupe: if a terminal with same id already in keptTerminals, don't double-add
      const terminalIds = new Set(keptTerminals.map((n) => n.id));
      // Also add any referenced dnq/qualified that might not have been in keptTerminals
      const additionalTerminals = baseFlow.nodes.filter(
        (n) =>
          (n.type === 'dnq' || n.type === 'qualified') &&
          referencedTargets.has(n.id) &&
          !terminalIds.has(n.id),
      );

      const flowNodes = [
        ...questionNodes,
        ...keptTerminals,
        ...additionalTerminals,
      ];

      // 3. Rebuild flow.edges from all path rows
      const flowEdges: FlowEdge[] = [];

      // Preserve root edges — but drop any whose target node was deleted, and if the
      // root's target is gone entirely, repoint root at the new first question (no orphan edge).
      const validNodeIds = new Set(flowNodes.map((n) => n.id));
      let rootEdges = baseFlow.edges.filter((e) => e.source === 'root' && validNodeIds.has(e.target));
      if (rootEdges.length === 0 && rows.length > 0) {
        const firstRoot = baseFlow.edges.find((e) => e.source === 'root');
        rootEdges = [
          { source: 'root', target: rows[0]!.variable_name, label: firstRoot?.label ?? 'Interested' },
        ];
      }
      flowEdges.push(...rootEdges);

      // Rebuild question edges from path rows
      rows.forEach((r) => {
        r.paths.forEach((p) => {
          if (p.destination) {
            flowEdges.push({
              source: r.variable_name,
              target: p.destination,
              label: p.edgeLabel,
            });
          }
        });
      });

      const updatedFlow: StudyFlow = {
        nodes: flowNodes,
        edges: flowEdges,
      };

      const updated = await updateStudy(study.id, {
        screeningQuestions: updatedQuestions,
        flow: updatedFlow,
      });

      setMsg({ text: 'Saved successfully.', kind: 'ok' });
      setSaving(false);
      onSaved(updated);
      onClose();
    } catch (e) {
      setMsg({
        text: `Error: ${e instanceof Error ? e.message : String(e)}`,
        kind: 'err',
      });
      setSaving(false);
    }
  }

  /* ─── Render ─── */

  return (
    <div
      className="modal-overlay qrm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Question Routing"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="qrm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="qrm-header">
          <div>
            <div className="qrm-title">Question Routing</div>
            <div className="qrm-subtitle">
              Edit question routing, edge labels, and flow destinations.
            </div>
          </div>
          <button
            onClick={handleClose}
            className="qrm-close"
            aria-label="Close"
            disabled={saving}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="qrm-body">
          {rows.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                color: 'var(--text-muted)',
                padding: '32px 0',
                fontSize: 'var(--fs-md)',
              }}
            >
              No questions configured. Add one below.
            </div>
          )}

          {rows.map((row, qIdx) => {
            const { questionOpts, dnqOpts, qualifiedOpt } =
              buildDestinationOptions(row.id);
            const showChoices = expandedChoices[row.id] ?? false;
            const qNum = qIdx + 1;

            return (
              <div key={row.id} className="qrm-card">
                {/* Question header row */}
                <div className="qrm-q-header">
                  {/* Q chip */}
                  <span className="qrm-qchip">Q{qNum}</span>

                  {/* Type dropdown */}
                  <select
                    value={row.answer_type}
                    onChange={(e) =>
                      updateRow(row.id, { answer_type: e.target.value })
                    }
                    style={{ ...selectStyle, minWidth: 90, flexShrink: 0 }}
                    aria-label={`Question ${qNum} type`}
                  >
                    {ALL_ANSWER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {ANSWER_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>

                  {/* Question text */}
                  <input
                    type="text"
                    value={row.sms_question}
                    onChange={(e) =>
                      updateRow(row.id, { sms_question: e.target.value })
                    }
                    placeholder="Question text (sms_question)…"
                    style={{ ...inputStyle, flex: 1 }}
                    aria-label={`Question ${qNum} text`}
                  />

                  {/* Choices button — only when type=choice */}
                  {row.answer_type === 'choice' && (
                    <button
                      onClick={() =>
                        setExpandedChoices((prev) => ({
                          ...prev,
                          [row.id]: !showChoices,
                        }))
                      }
                      className="qrm-choice-btn"
                      title="Edit choices"
                    >
                      choices
                    </button>
                  )}

                  {/* Delete question */}
                  <button
                    onClick={() => deleteRow(row.id)}
                    style={{ ...trashBtn }}
                    title="Delete question"
                    aria-label={`Delete question ${qNum}`}
                  >
                    🗑
                  </button>
                </div>

                {/* Choices editor */}
                {row.answer_type === 'choice' && showChoices && (
                  <ChoicesEditor
                    choices={row.choices}
                    onChange={(c) => updateRow(row.id, { choices: c })}
                    onClose={() =>
                      setExpandedChoices((prev) => ({
                        ...prev,
                        [row.id]: false,
                      }))
                    }
                  />
                )}

                {/* Paths */}
                <div className="qrm-paths">
                  {row.paths.map((path) => {
                    const kind = destinationKind(path.destination, rows);
                    const echoLabel = path.destination
                      ? destinationEchoLabel(
                          path.destination,
                          rows,
                          originalFlow ?? { nodes: [], edges: [] },
                        )
                      : '';

                    return (
                      <div key={path.id} className="qrm-path-row">
                        {/* Edge label input */}
                        <input
                          type="text"
                          value={path.edgeLabel}
                          onChange={(e) =>
                            updatePath(row.id, path.id, {
                              edgeLabel: e.target.value,
                            })
                          }
                          placeholder="Answer / condition…"
                          style={{ ...inputStyle, flex: '0 0 200px', minWidth: 120 }}
                          aria-label="Edge label"
                        />

                        {/* Arrow */}
                        <span className="qrm-arrow">→</span>

                        {/* Destination dropdown */}
                        <select
                          value={path.destination}
                          onChange={(e) =>
                            updatePath(row.id, path.id, {
                              destination: e.target.value,
                            })
                          }
                          style={{ ...selectStyle, flex: '0 0 220px', minWidth: 140 }}
                          aria-label="Path destination"
                        >
                          <option value="">— select destination —</option>
                          {questionOpts.length > 0 && (
                            <optgroup label="Questions">
                              {questionOpts.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {dnqOpts.length > 0 && (
                            <optgroup label="DNQ Terminals">
                              {dnqOpts.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {qualifiedOpt && (
                            <optgroup label="Qualified">
                              <option value="qualified">Qualified</option>
                            </optgroup>
                          )}
                        </select>

                        {/* Echo label */}
                        {echoLabel && (
                          <span
                            className={`qrm-echo qrm-echo--${kind}`}
                            title={echoLabel}
                          >
                            {echoLabel}
                          </span>
                        )}

                        {/* Delete path */}
                        <button
                          onClick={() => deletePath(row.id, path.id)}
                          style={{ ...trashBtn, marginLeft: 'auto' }}
                          title="Delete path"
                          aria-label="Delete path"
                        >
                          🗑
                        </button>
                      </div>
                    );
                  })}

                  {/* Add path */}
                  <button
                    onClick={() => addPath(row.id)}
                    style={addLink}
                  >
                    ＋ Add path
                  </button>
                </div>
              </div>
            );
          })}

          {/* Add Question */}
          <div className="qrm-add-question">
            <button onClick={addQuestion} className="qrm-add-question-btn">
              ＋ Add Question
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="qrm-footer">
          {msg.text && (
            <span
              style={{
                fontSize: 'var(--fs-sm)',
                color:
                  msg.kind === 'ok'
                    ? 'var(--msg-ok)'
                    : msg.kind === 'err'
                    ? 'var(--msg-err)'
                    : 'var(--text-muted)',
                flex: 1,
              }}
            >
              {msg.text}
            </span>
          )}
          <BtnGhost onClick={handleClose} disabled={saving}>
            Cancel
          </BtnGhost>
          <BtnPrimary onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </BtnPrimary>
        </div>
      </div>
    </div>
  );
}
