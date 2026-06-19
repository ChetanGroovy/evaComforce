import { useState, useMemo } from 'react';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { ErrorBanner } from './ui/ErrorBanner';
import { EmptyState } from './ui/EmptyState';
import { NewStudyModal } from './NewStudyModal';
import { EditStudyModal } from './EditStudyModal';
import type { StudyBrief, StudyDetail } from '../types';

interface Props {
  studies: StudyBrief[];
  loadingStudies: boolean;
  errorStudies: string | null;
  selectedStudy: StudyDetail | null;
  loadingDetail: boolean;
  errorDetail: string | null;
  selectedId: string | null;
  onSelectStudy: (brief: StudyBrief) => void;
  onStudiesRefresh: () => void;
  onStudyUpdated: () => void;
  onOpenStudy: () => void;
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const isDraft = status === 'draft';
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 'var(--fs-2xs)',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        padding: '1px 6px',
        borderRadius: 5,
        marginLeft: 6,
        verticalAlign: 'middle',
        ...(isDraft
          ? { background: 'var(--badge-draft-bg)', color: 'var(--badge-draft-fg)', border: '1px solid var(--badge-draft-bd)' }
          : { background: 'var(--badge-ready-bg)', color: 'var(--badge-ready-fg)', border: '1px solid var(--badge-ready-bd)' }),
      }}
    >
      {status}
    </span>
  );
}

function StudyDetailCard({
  study,
  onEdit,
  onOpenStudy,
}: {
  study: StudyDetail;
  onEdit: () => void;
  onOpenStudy: () => void;
}) {
  const cc = study.criteriaCount;
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '13px 14px',
      }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: 'var(--fs-md)',
            color: 'var(--text-primary)',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={study.name}
        >
          {study.name}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={onOpenStudy}
            title="Open the Agent Flow & question routing editor"
            style={{
              background: 'linear-gradient(135deg, var(--accent), var(--purple))',
              border: 'none',
              color: '#fff',
              borderRadius: 7,
              fontSize: 'var(--fs-xs)',
              fontWeight: 600,
              padding: '4px 10px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Agent Flow →
          </button>
          <button
            onClick={onEdit}
            style={{
              background: 'var(--btn-soft-bg)',
              border: '1px solid var(--btn-soft-bd)',
              color: 'var(--btn-soft-fg)',
              borderRadius: 7,
              fontSize: 'var(--fs-xs)',
              fontWeight: 600,
              padding: '4px 10px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Edit
          </button>
        </div>
      </div>

      {/* Detail grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { label: 'Drug', value: study.drug },
          { label: 'Phase', value: study.phase },
          { label: 'Sponsor', value: study.sponsor },
          { label: 'Indication', value: study.indication },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span
              style={{
                fontSize: 'var(--fs-2xs)',
                color: 'var(--text-muted)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
              }}
            >
              {label}
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', fontWeight: 500 }}>
              {value ?? '—'}
            </span>
          </div>
        ))}
      </div>

      {/* Criteria pills */}
      {cc && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <div
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '5px 6px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--fs-xs)',
              fontWeight: 600,
              letterSpacing: 0.1,
              background: 'var(--green-soft)',
              color: 'var(--green)',
              border: '1px solid var(--green-border)',
            }}
          >
            ✓ {cc.inclusion} Inclusion
          </div>
          <div
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '5px 6px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--fs-xs)',
              fontWeight: 600,
              letterSpacing: 0.1,
              background: 'var(--red-soft)',
              color: 'var(--red)',
              border: '1px solid var(--red-border)',
            }}
          >
            ✕ {cc.exclusion} Exclusion
          </div>
        </div>
      )}
    </div>
  );
}

export function StudyPicker({
  studies,
  loadingStudies,
  errorStudies,
  selectedStudy,
  loadingDetail,
  errorDetail,
  selectedId,
  onSelectStudy,
  onStudiesRefresh,
  onStudyUpdated,
  onOpenStudy,
}: Props) {
  const [query, setQuery] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return studies;
    return studies.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.sponsor?.toLowerCase().includes(q) ||
        s.indication?.toLowerCase().includes(q),
    );
  }, [studies, query]);

  return (
    <aside className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <div
            style={{
              fontSize: 'var(--fs-2xs)',
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            Clinical Studies
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            style={{
              background: 'linear-gradient(135deg, #5b8ef0, #bf5af2)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
              padding: '5px 10px',
              cursor: 'pointer',
              letterSpacing: 0.2,
              fontFamily: 'var(--font-sans)',
            }}
          >
            + New Study
          </button>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          >
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            className="search-input"
            type="text"
            placeholder="Search studies…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      <div className="studies-list" role="list">
        {loadingStudies && <LoadingSpinner text="Loading studies…" />}
        {errorStudies && !loadingStudies && <ErrorBanner message={errorStudies} />}
        {!loadingStudies && !errorStudies && filtered.length === 0 && (
          <EmptyState icon="🔬" text="No studies available yet. Check back soon." />
        )}
        {!loadingStudies &&
          filtered.map((s) => (
            <div
              key={s.id}
              className={`study-card${selectedId === s.id ? ' active' : ''}`}
              role="listitem"
              tabIndex={0}
              onClick={() => onSelectStudy(s)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectStudy(s);
                }
              }}
            >
              <div
                style={{
                  fontSize: 'var(--fs-md)',
                  fontWeight: 600,
                  color: selectedId === s.id ? 'var(--accent-bright)' : 'var(--text-primary)',
                  marginBottom: 3,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={s.name}
              >
                {s.name}
                <StatusBadge status={s.status} />
              </div>
              <div
                style={{
                  fontSize: 'var(--fs-sm)',
                  color: 'var(--text-secondary)',
                  marginBottom: 8,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {s.sponsor ?? '—'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                {s.indication && (
                  <span
                    style={{
                      fontSize: 'var(--fs-2xs)',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: 'var(--accent-soft)',
                      color: 'var(--accent-bright)',
                      border: '1px solid var(--accent-border)',
                    }}
                  >
                    {s.indication}
                  </span>
                )}
                {s.phase && (
                  <span
                    style={{
                      fontSize: 'var(--fs-2xs)',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: 'var(--purple-soft)',
                      color: 'var(--purple)',
                      border: '1px solid var(--purple-border)',
                    }}
                  >
                    {s.phase}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 'var(--fs-2xs)',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: 'var(--bg-card)',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {s.questionCount ?? '?'} Qs
                </span>
              </div>
            </div>
          ))}
      </div>

      {/* Detail footer */}
      <div className="sidebar-footer">
        {loadingDetail && <LoadingSpinner text="Loading…" />}
        {errorDetail && !loadingDetail && <ErrorBanner message={errorDetail} />}
        {!loadingDetail && !errorDetail && selectedStudy && (
          <StudyDetailCard study={selectedStudy} onEdit={() => setShowEditModal(true)} onOpenStudy={onOpenStudy} />
        )}
        {!loadingDetail && !errorDetail && !selectedStudy && (
          <EmptyState icon="📋" text="Select a study to see details" />
        )}
      </div>

      {/* Modals */}
      {showNewModal && (
        <NewStudyModal
          onClose={() => setShowNewModal(false)}
          onCreated={onStudiesRefresh}
        />
      )}
      {showEditModal && selectedStudy && (
        <EditStudyModal
          study={selectedStudy}
          onClose={() => setShowEditModal(false)}
          onSaved={() => {
            onStudyUpdated();
            onStudiesRefresh();
          }}
        />
      )}
    </aside>
  );
}
