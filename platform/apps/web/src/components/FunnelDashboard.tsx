import { useEffect, useRef, useCallback } from 'react';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { ErrorBanner } from './ui/ErrorBanner';
import { EmptyState } from './ui/EmptyState';
import type { Report } from '../types';

interface Props {
  report: Report | null;
  loading: boolean;
  error: string | null;
  studyId: string | null;
  onRefresh: () => void;
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function animateCountUp(el: HTMLElement, target: number, duration = 700): void {
  const start = performance.now();
  if (target === 0) { el.textContent = '0'; return; }

  function step(now: number) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * target).toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

interface MetricCardProps {
  cls: 'qualified' | 'dnq' | 'incomplete' | 'total';
  label: string;
  value: number;
  total: number;
  showBar: boolean;
}

function MetricCard({ cls, label, value, total, showBar }: MetricCardProps) {
  const valueRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const p = pct(value, total);

  useEffect(() => {
    if (valueRef.current) {
      animateCountUp(valueRef.current, value, 700);
    }
    if (barRef.current) {
      setTimeout(() => {
        if (barRef.current) barRef.current.style.width = `${p}%`;
      }, 100);
    }
  }, [value, p]);

  const valueColor =
    cls === 'qualified'  ? 'var(--green)' :
    cls === 'dnq'        ? 'var(--red)' :
    cls === 'incomplete' ? 'var(--amber)' :
    'var(--text-primary)';

  return (
    <div className={`metric-card ${cls}`}>
      <div
        ref={valueRef}
        style={{
          fontSize: 'var(--fs-2xl)',
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: '-1.5px',
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
        }}
      >
        —
      </div>
      <div
        style={{
          fontSize: 'var(--fs-2xs)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: 'var(--text-muted)',
          lineHeight: 1.2,
        }}
      >
        {label}
      </div>
      {showBar && total > 0 && (
        <div style={{ marginTop: 2 }}>
          <div
            style={{
              fontSize: 'var(--fs-2xs)',
              fontWeight: 600,
              marginTop: 2,
              color: valueColor,
            }}
          >
            {p}%
          </div>
          <div
            style={{
              height: 4,
              background: 'var(--bg-card)',
              borderRadius: 2,
              overflow: 'hidden',
              marginTop: 5,
            }}
          >
            <div
              ref={barRef}
              className="conversion-bar-fill"
              style={{ width: '0%' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ResultChip({ terminal }: { terminal: string }) {
  const t = terminal.toUpperCase();
  const chipClass = t === 'QUALIFIED' ? 'qualified' : t === 'DNQ' ? 'dnq' : 'incomplete';
  const chipLabel = t === 'QUALIFIED' ? 'Qual' : t === 'DNQ' ? 'DNQ' : 'Inc.';

  const CHIP_COLORS = {
    qualified:  { bg: 'var(--green-soft)',  color: 'var(--green)',  border: 'var(--green-border)'  },
    dnq:        { bg: 'var(--red-soft)',    color: 'var(--red)',    border: 'var(--red-border)'    },
    incomplete: { bg: 'var(--amber-soft)',  color: 'var(--amber)',  border: 'var(--amber-border)'  },
  } as const;
  const c = CHIP_COLORS[chipClass as keyof typeof CHIP_COLORS] ?? CHIP_COLORS.incomplete;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 'var(--fs-2xs)',
        fontWeight: 700,
        padding: '3px 8px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
        letterSpacing: 0.2,
        background: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
      }}
    >
      {chipLabel}
    </span>
  );
}

function ReportContent({ report }: { report: Report }) {
  const counts = report.counts;
  const total = Number(counts.total) || 0;
  const maxCount = report.dnqReasons.length
    ? Math.max(...report.dnqReasons.map((r) => r.count), 1)
    : 1;

  const dnqBarRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const setDnqBarRef = useCallback((reason: string, el: HTMLDivElement | null) => {
    if (el) {
      dnqBarRefs.current.set(reason, el);
    } else {
      dnqBarRefs.current.delete(reason);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      dnqBarRefs.current.forEach((el, reason) => {
        const row = report.dnqReasons.find((r) => r.reason === reason);
        if (row && el) {
          const barPct = maxCount > 0 ? Math.round((row.count / maxCount) * 100) : 0;
          el.style.width = `${barPct}%`;
        }
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [report.dnqReasons, maxCount]);

  return (
    <>
      {/* Metric grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <MetricCard cls="total"      label="Total Screened"  value={counts.total}      total={total} showBar={false} />
        <MetricCard cls="qualified"  label="Qualified"       value={counts.qualified}  total={total} showBar={true} />
        <MetricCard cls="dnq"        label="Did Not Qualify" value={counts.dnq}        total={total} showBar={true} />
        <MetricCard cls="incomplete" label="Incomplete"      value={counts.incomplete} total={total} showBar={true} />
      </div>

      {/* DNQ Breakdown */}
      <div>
        <div
          style={{
            fontSize: 'var(--fs-2xs)',
            fontWeight: 700,
            letterSpacing: 0.7,
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 10,
          }}
        >
          DNQ Breakdown
        </div>
        {report.dnqReasons.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {report.dnqReasons.map((r) => (
              <div key={r.reason} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 'var(--fs-sm)' }}>
                  <span
                    style={{
                      color: 'var(--text-secondary)',
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginRight: 8,
                    }}
                    title={r.reason}
                  >
                    {r.reason}
                  </span>
                  <span
                    style={{
                      color: 'var(--red)',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 700,
                      fontSize: 'var(--fs-xs)',
                      flexShrink: 0,
                    }}
                  >
                    {r.count}
                  </span>
                </div>
                <div
                  style={{
                    height: 5,
                    background: 'var(--bg-card)',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    ref={(el) => setDnqBarRef(r.reason, el)}
                    className="dnq-bar-fill"
                    style={{ width: '0%' }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              fontSize: 'var(--fs-sm)',
              color: 'var(--text-muted)',
              textAlign: 'center',
              padding: '14px 0',
              lineHeight: 1.6,
            }}
          >
            No disqualification data yet for this study.
          </div>
        )}
      </div>

      {/* Patient results */}
      <div>
        <div
          style={{
            fontSize: 'var(--fs-2xs)',
            fontWeight: 700,
            letterSpacing: 0.7,
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 10,
          }}
        >
          Patient Results
        </div>
        {report.patients.length > 0 ? (
          <div className="patient-table-wrapper">
            <table className="patient-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Result</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {report.patients.map((p, i) => (
                  <tr key={i}>
                    <td>{p.patient ?? '—'}</td>
                    <td>
                      <ResultChip terminal={p.terminal ?? 'INCOMPLETE'} />
                    </td>
                    <td>
                      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        {p.reason ?? p.failed ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            style={{
              fontSize: 'var(--fs-sm)',
              color: 'var(--text-muted)',
              textAlign: 'center',
              padding: '14px 0',
              lineHeight: 1.6,
            }}
          >
            No patient records yet for this study.
          </div>
        )}
      </div>
    </>
  );
}

export function FunnelDashboard({ report, loading, error, studyId, onRefresh }: Props) {
  return (
    <aside className="report-panel">
      {/* Header */}
      <div
        style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: 'var(--fs-2xs)',
            fontWeight: 700,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            flex: 1,
          }}
        >
          Funnel Dashboard
        </div>
        <button
          onClick={onRefresh}
          disabled={!studyId}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 11px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-sm)',
            fontWeight: 600,
            cursor: studyId ? 'pointer' : 'not-allowed',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-sans)',
            opacity: studyId ? 1 : 0.4,
          }}
          aria-label="Refresh report"
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M13.65 2.35A8 8 0 1 0 14 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M14 2v4h-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Refresh
        </button>
      </div>

      {/* Body */}
      <div className="report-body">
        {loading && <LoadingSpinner text="Loading report…" />}
        {error && !loading && <ErrorBanner message={error} />}
        {!loading && !error && !report && (
          <EmptyState icon="📊" text="Select a study to view the screening funnel" />
        )}
        {!loading && !error && report && <ReportContent report={report} />}
      </div>
    </aside>
  );
}
