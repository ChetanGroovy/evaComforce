import { useState } from 'react';
import type { Terminal, TraceRow } from '../types';

interface Props {
  terminal: Terminal;
  reason?: string;
  trace?: TraceRow[];
  deferred?: string | string[];
}

const META: Record<Terminal, { cls: string; icon: string; label: string; badge: string }> = {
  QUALIFIED:  { cls: 'qualified',  icon: '✓', label: 'Qualified',       badge: 'Patient Eligible'  },
  DNQ:        { cls: 'dnq',        icon: '✕', label: 'Did Not Qualify', badge: 'Screening Result'  },
  INCOMPLETE: { cls: 'incomplete', icon: '…', label: 'Incomplete',      badge: 'Session Ended'     },
};

export function VerdictCard({ terminal, reason, trace, deferred }: Props) {
  const [traceOpen, setTraceOpen] = useState(false);
  const m = META[terminal] ?? META.INCOMPLETE;

  const deferredText = Array.isArray(deferred)
    ? deferred.join(', ')
    : deferred;

  return (
    <div className={`verdict-card ${m.cls}`}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 'var(--radius)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            flexShrink: 0,
            background:
              terminal === 'QUALIFIED' ? 'rgba(48,209,88,0.14)' :
              terminal === 'DNQ'       ? 'rgba(255,69,58,0.14)' :
              'rgba(255,169,64,0.14)',
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 18 }}>{m.icon}</span>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: 'uppercase',
              opacity: 0.7,
              marginBottom: 2,
              color:
                terminal === 'QUALIFIED' ? 'var(--green)' :
                terminal === 'DNQ'       ? 'var(--red)' :
                'var(--amber)',
            }}
          >
            {m.badge}
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: '-0.5px',
              color:
                terminal === 'QUALIFIED' ? 'var(--green)' :
                terminal === 'DNQ'       ? 'var(--red)' :
                'var(--amber)',
            }}
          >
            {m.label}
          </div>
        </div>
      </div>

      {/* Reason */}
      {reason && (
        <div
          style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.55 }}
        >
          {reason}
        </div>
      )}

      {/* Deferred */}
      {deferredText && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            fontSize: 12,
            color: 'var(--amber)',
            background: 'var(--amber-soft)',
            border: '1px solid var(--amber-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '9px 12px',
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          <span>⏳</span>
          <span>
            <strong>Deferred items:</strong> {deferredText}
          </span>
        </div>
      )}

      {/* Trace toggle */}
      {trace && trace.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button
            onClick={() => setTraceOpen((v) => !v)}
            aria-expanded={traceOpen}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--bg-base)',
              fontFamily: 'var(--font-sans)',
              transition: 'background var(--t-fast), color var(--t-fast)',
            }}
          >
            <span
              className={`trace-arrow${traceOpen ? ' open' : ''}`}
            >
              ▶
            </span>
            Decision trace ({trace.length} item{trace.length !== 1 ? 's' : ''})
          </button>

          {traceOpen && (
            <div className="trace-table-wrapper">
              <table className="trace-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Variable</th>
                    <th>Answer</th>
                    <th>Disq?</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.map((row, i) => (
                    <tr key={i}>
                      <td>{row.rank ?? i + 1}</td>
                      <td>{row.variable ?? row.variable_name ?? '—'}</td>
                      <td>{row.answer != null ? String(row.answer) : '—'}</td>
                      <td
                        style={{
                          color: row.disqualified ? 'var(--red)' : 'var(--text-faint)',
                          fontWeight: row.disqualified ? 700 : 400,
                        }}
                      >
                        {row.disqualified ? 'Disq.' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
