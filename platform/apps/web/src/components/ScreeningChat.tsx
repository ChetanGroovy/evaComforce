import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { VerdictCard } from './VerdictCard';
import { ErrorBanner } from './ui/ErrorBanner';
import { screenStart, screenAnswer } from '../api';
import type { StudyDetail, ChatEntry, Terminal, TraceRow } from '../types';

const AGENT_NAME     = 'comforceEva';
const AGENT_INITIALS = 'cE';

function nowTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function uid(): string {
  return Math.random().toString(36).slice(2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ── Avatar components ───────────────────────────────── */
function AgentAvatar() {
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: '50%',
        background: 'linear-gradient(140deg, #5b8ef0 0%, #bf5af2 100%)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 'var(--fs-xs)',
        fontWeight: 800,
        flexShrink: 0,
        letterSpacing: '-0.5px',
        boxShadow: '0 2px 8px rgba(91,142,240,0.3)',
      }}
      title={AGENT_NAME}
    >
      {AGENT_INITIALS}
    </div>
  );
}

function PatientAvatar() {
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: '50%',
        background: 'var(--bg-card)',
        border: '1.5px solid var(--border-bright)',
        color: 'var(--text-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 'var(--fs-xs)',
        fontWeight: 800,
        flexShrink: 0,
        letterSpacing: '-0.5px',
      }}
    >
      PT
    </div>
  );
}

/* ── Typing indicator ────────────────────────────────── */
function TypingIndicator() {
  return (
    <div className="typing-indicator">
      <AgentAvatar />
      <div className="typing-dots">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

/* ── Single message bubble ───────────────────────────── */
interface BubbleProps {
  kind: 'agent' | 'patient' | 'ack' | 'greeting' | 'closing' | 'error';
  text: string;
  time: string;
}

function ChatBubble({ kind, text, time }: BubbleProps) {
  const isAgent = kind !== 'patient';
  const bubbleClass =
    kind === 'ack'     ? 'bubble ack-bubble' :
    kind === 'greeting'? 'bubble greeting-bubble' :
    kind === 'closing' ? 'bubble closing-bubble' :
    'bubble';

  return (
    <div className={`msg-row ${isAgent ? 'agent' : 'patient'}`}>
      {isAgent ? <AgentAvatar /> : null}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: isAgent ? 'flex-start' : 'flex-end',
          minWidth: 0,
          maxWidth: '72%',
        }}
      >
        <div className={bubbleClass}>{text}</div>
        <div
          style={{
            fontSize: 'var(--fs-2xs)',
            color: 'var(--text-muted)',
            marginTop: 4,
            padding: '0 4px',
            opacity: 0.8,
            textAlign: isAgent ? 'left' : 'right',
          }}
        >
          {isAgent ? `${AGENT_NAME} · ` : ''}{time}
        </div>
      </div>
      {!isAgent ? <PatientAvatar /> : null}
    </div>
  );
}

/* ── Chat empty / ready states ───────────────────────── */
function ChatEmpty() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 16,
        textAlign: 'center',
        color: 'var(--text-muted)',
        padding: 40,
        animation: 'fade-in 400ms var(--ease-out)',
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--fs-2xl)',
          marginBottom: 4,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        💬
      </div>
      <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '-0.2px' }}>
        Select a study to begin
      </div>
      <div style={{ fontSize: 'var(--fs-md)', maxWidth: 300, lineHeight: 1.65 }}>
        Choose a clinical trial from the left sidebar, then start a new patient screening conversation.
      </div>
    </div>
  );
}

function ChatReady({ studyName }: { studyName: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 16,
        textAlign: 'center',
        color: 'var(--text-muted)',
        padding: 40,
        animation: 'fade-in 400ms var(--ease-out)',
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--fs-2xl)',
          marginBottom: 4,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        🩺
      </div>
      <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '-0.2px' }}>
        Ready to screen
      </div>
      <div style={{ fontSize: 'var(--fs-md)', maxWidth: 300, lineHeight: 1.65 }}>
        Click <strong style={{ color: 'var(--text-secondary)' }}>Start Screening</strong> to begin a patient
        conversation for <em style={{ color: 'var(--accent-bright)' }}>{studyName}</em>.
      </div>
    </div>
  );
}

/* ── Divider ─────────────────────────────────────────── */
function SessionDivider({ label }: { label: string }) {
  return (
    <div className="chat-divider">
      <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
      <div
        style={{
          fontSize: 'var(--fs-2xs)',
          fontWeight: 600,
          color: 'var(--text-muted)',
          letterSpacing: 0.5,
          whiteSpace: 'nowrap',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
    </div>
  );
}

/* ── Main ScreeningChat component ────────────────────── */
interface Props {
  selectedStudy: StudyDetail | null;
  onScreeningComplete: () => void;
}

export function ScreeningChat({ selectedStudy, onScreeningComplete }: Props) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [typing, setTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [screeningActive, setScreeningActive] = useState(false);
  const [screeningDone, setScreeningDone] = useState(false);
  const [inputEnabled, setInputEnabled] = useState(false);
  const [inputText, setInputText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (messagesRef.current) {
        messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
      }
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [entries, typing, scrollToBottom]);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, []);

  const addEntry = useCallback((entry: ChatEntry) => {
    setEntries((prev) => [...prev, entry]);
  }, []);

  // Reset the chat whenever the selected study actually changes — even if a
  // screening session is in progress (switching studies must never leave one
  // study's session bleeding into another study's chat slot).
  const prevStudyId = useRef<string | null>(null);
  useEffect(() => {
    const id = selectedStudy?.id ?? null;
    if (prevStudyId.current !== null && prevStudyId.current !== id) {
      setEntries([]);
      setSessionId(null);
      setScreeningActive(false);
      setScreeningDone(false);
      setInputEnabled(false);
      setInputText('');
      setErrorMsg(null);
      setTyping(false);
    }
    prevStudyId.current = id;
  }, [selectedStudy?.id]);

  const resetChat = useCallback(() => {
    setEntries([]);
    setSessionId(null);
    setScreeningActive(false);
    setScreeningDone(false);
    setInputEnabled(false);
    setInputText('');
    setErrorMsg(null);
    setTyping(false);
  }, []);

  const finalizeScreening = useCallback(
    async (params: {
      terminal?: string;
      reason?: string;
      trace?: TraceRow[];
      deferred?: string | string[];
      closing?: string;
    }) => {
      setScreeningDone(true);
      setScreeningActive(false);
      setInputEnabled(false);

      const terminal = ((params.terminal ?? 'INCOMPLETE') as string).toUpperCase() as Terminal;

      await sleep(300);

      addEntry({
        id: uid(),
        kind: 'verdict',
        terminal,
        reason: params.reason,
        trace: params.trace,
        deferred: params.deferred,
      });

      // Show the closing message for EVERY terminal (QUALIFIED scheduling,
      // DNQ on-file, INCOMPLETE follow-up) — not just qualified patients.
      if (params.closing) {
        await sleep(600);
        setTyping(true);
        await sleep(800);
        setTyping(false);
        addEntry({
          id: uid(),
          kind: 'closing',
          text: params.closing,
          time: nowTime(),
        });
      }

      onScreeningComplete();
    },
    [addEntry, onScreeningComplete],
  );

  const startScreening = useCallback(async () => {
    if (!selectedStudy) return;
    setErrorMsg(null);

    resetChat();

    // Session divider
    const divLabel = new Date().toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    addEntry({ id: uid(), kind: 'divider', label: `Session · ${divLabel}` });

    setTyping(true);

    try {
      const res = await screenStart(selectedStudy.id);
      setSessionId(res.sessionId);
      setScreeningActive(true);
      setTyping(false);

      if (res.greeting) {
        addEntry({ id: uid(), kind: 'greeting', text: res.greeting, time: nowTime() });
        await sleep(520);
        setTyping(true);
        await sleep(650);
        setTyping(false);
      }

      if (res.prompt) {
        addEntry({ id: uid(), kind: 'agent', text: res.prompt, time: nowTime() });
      }

      if (res.done) {
        await finalizeScreening({
          terminal: res.terminal,
          reason: res.reason,
          trace: res.trace,
          deferred: res.deferred,
          closing: res.closing,
        });
      } else {
        setInputEnabled(true);
      }
    } catch (err) {
      setTyping(false);
      setErrorMsg(`Failed to start screening: ${err instanceof Error ? err.message : String(err)}`);
      setScreeningActive(false);
    }
  }, [selectedStudy, resetChat, addEntry, finalizeScreening]);

  const sendAnswer = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !sessionId || screeningDone) return;

    setInputText('');
    autoResize();
    setInputEnabled(false);
    setErrorMsg(null);

    addEntry({ id: uid(), kind: 'patient', text, time: nowTime() });
    setTyping(true);

    try {
      const res = await screenAnswer(sessionId, text);

      if (res.ack) {
        setTyping(false);
        addEntry({ id: uid(), kind: 'ack', text: res.ack, time: nowTime() });
        await sleep(480);
        if (!res.done && res.prompt) {
          setTyping(true);
          await sleep(680);
          setTyping(false);
        }
      } else {
        setTyping(false);
      }

      if (res.prompt && !res.done) {
        addEntry({ id: uid(), kind: 'agent', text: res.prompt, time: nowTime() });
      }

      if (res.done) {
        await finalizeScreening(res);
      } else if (res.prompt) {
        setInputEnabled(true);
      } else {
        setInputEnabled(true);
      }
    } catch (err) {
      setTyping(false);
      setErrorMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setInputEnabled(true);
    }
  }, [inputText, sessionId, screeningDone, addEntry, autoResize, finalizeScreening]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendAnswer();
      }
    },
    [sendAnswer],
  );

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setInputText(e.target.value);
      autoResize();
    },
    [autoResize],
  );

  // Focus textarea when enabled
  useEffect(() => {
    if (inputEnabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [inputEnabled]);

  const hasStudy = selectedStudy !== null;
  const chatTopTitle = selectedStudy?.name ?? 'Prescreening Chat';
  const chatTopSub = selectedStudy
    ? [selectedStudy.sponsor, selectedStudy.indication].filter(Boolean).join(' · ')
    : 'Select a study to begin';

  const showStartBtn = !screeningActive || screeningDone;
  const showNewPatientBtn = screeningActive || screeningDone;

  return (
    <main className="chat-main">
      {/* Top bar */}
      <div className="chat-topbar">
        <div>
          <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
            {chatTopTitle}
          </div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.2, marginTop: 1 }}>
            {chatTopSub}
          </div>
        </div>
        <div style={{ flex: 1 }} />

        {/* Screening in progress pill */}
        {screeningActive && !screeningDone && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 'var(--fs-xs)',
              fontWeight: 600,
              color: 'var(--accent-bright)',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-border)',
              borderRadius: 'var(--radius-pill)',
              padding: '3px 10px',
              animation: 'fade-in var(--t-mid) var(--ease-out)',
            }}
          >
            <div className="screening-dot" />
            Screening in progress
          </div>
        )}

        {/* New Patient button */}
        {showNewPatientBtn && (
          <button
            onClick={resetChat}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 11px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
              cursor: 'pointer',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-sans)',
              transition: 'background var(--t-fast)',
            }}
            type="button"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            New Patient
          </button>
        )}

        {/* Start Screening button */}
        {showStartBtn && (
          <button
            onClick={() => void startScreening()}
            disabled={!hasStudy}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 11px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
              cursor: hasStudy ? 'pointer' : 'not-allowed',
              border: 'none',
              background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-dim) 100%)',
              color: '#fff',
              boxShadow: 'var(--shadow-accent)',
              opacity: hasStudy ? 1 : 0.38,
              fontFamily: 'var(--font-sans)',
              transition: 'background var(--t-fast), opacity var(--t-fast)',
            }}
            type="button"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <polygon points="4,2 14,8 4,14" fill="currentColor" />
            </svg>
            Start Screening
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        className="chat-messages"
        ref={messagesRef}
        role="log"
        aria-live="polite"
        aria-label="Screening conversation"
      >
        {/* Empty state */}
        {entries.length === 0 && !typing && (
          selectedStudy ? <ChatReady studyName={selectedStudy.name} /> : <ChatEmpty />
        )}

        {/* Entries */}
        {entries.map((entry) => {
          if (entry.kind === 'divider') {
            return <SessionDivider key={entry.id} label={entry.label} />;
          }
          if (entry.kind === 'verdict') {
            return (
              <VerdictCard
                key={entry.id}
                terminal={entry.terminal}
                reason={entry.reason}
                trace={entry.trace}
                deferred={entry.deferred}
              />
            );
          }
          // Regular chat bubble
          return (
            <ChatBubble
              key={entry.id}
              kind={entry.kind}
              text={entry.text}
              time={entry.time}
            />
          );
        })}

        {/* Typing indicator */}
        {typing && <TypingIndicator />}

        {/* Inline error */}
        {errorMsg && (
          <div style={{ padding: '4px 0' }}>
            <ErrorBanner message={errorMsg} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="chat-input-area">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            className="chat-input-textarea"
            rows={1}
            placeholder="Type the patient's response…"
            disabled={!inputEnabled}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            aria-label="Patient response input"
          />
          <button
            onClick={() => void sendAnswer()}
            disabled={!inputEnabled}
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius)',
              background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-dim) 100%)',
              border: 'none',
              cursor: inputEnabled ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              flexShrink: 0,
              boxShadow: 'var(--shadow-accent)',
              opacity: inputEnabled ? 1 : 0.38,
              transition: 'background var(--t-fast), transform 80ms, box-shadow var(--t-fast)',
            }}
            aria-label="Send response"
            type="button"
          >
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3 10L17 3L10 17L9 11L3 10Z" fill="currentColor" />
            </svg>
          </button>
        </div>
        <div
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-muted)',
            marginTop: 7,
            textAlign: 'center',
            letterSpacing: 0.1,
          }}
        >
          Press{' '}
          <kbd
            style={{
              fontFamily: 'inherit',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: '0 4px',
              fontSize: 'var(--fs-2xs)',
            }}
          >
            Enter
          </kbd>{' '}
          to send &nbsp;·&nbsp;{' '}
          <kbd
            style={{
              fontFamily: 'inherit',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: '0 4px',
              fontSize: 'var(--fs-2xs)',
            }}
          >
            Shift+Enter
          </kbd>{' '}
          for newline
        </div>
      </div>
    </main>
  );
}
