/* ── API types (matching CONTRACTS.md exactly) ───────── */

export interface StudyBrief {
  id: string;
  name: string;
  sponsor: string;
  indication: string;
  questionCount: number;
  status?: 'draft' | 'ready';
  phase?: string;
}

export interface CriteriaCount {
  inclusion: number;
  exclusion: number;
}

export interface StudyOverview {
  name?: string;
  internalNumber?: string;
  sponsor?: string;
  principalInvestigator?: string;
  site?: string;
  priority?: string;
  indication?: string;
  drug?: string;
  phase?: string;
}

export interface KnowledgeBank {
  'General Study Information'?: string;
  'Trial Design'?: string;
  'Compensation / Reimbursement'?: string;
  Blinding?: string;
  [key: string]: string | undefined;
}

/* ── Agent Flow / Question Routing ─────────────────────── */
export interface FlowNode {
  id: string;
  type: string; // 'root' | 'question' | 'dnq' | 'qualified'
  label: string;
}
export interface FlowEdge {
  source: string;
  target: string;
  label: string;
}
export interface StudyFlow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}
export interface ScreeningQuestionFull {
  rank: number;
  variable_name: string;
  sms_question: string;
  answer_type: string; // 'yes_no' | 'number' | 'choice' | ...
  choices?: string[] | null;
  category?: string;
  disqualify_condition?: string;
  qualify_condition?: string;
  show_if?: string;
  routing?: boolean;
  criteria_ids?: string[];
  knockout_power?: string;
  is_qualifying_question?: boolean;
  included_in_flow?: boolean;
  [k: string]: unknown;
}

export interface StudyDetail {
  id: string;
  name: string;
  sponsor: string;
  indication: string;
  drug?: string;
  phase?: string;
  questions?: unknown[];
  criteriaCount?: CriteriaCount;
  status?: 'draft' | 'ready';
  overview?: StudyOverview;
  knowledgeBank?: KnowledgeBank;
  flow?: StudyFlow;
  screeningQuestions?: ScreeningQuestionFull[];
}

export interface TraceRow {
  rank?: number;
  variable?: string;
  variable_name?: string;
  answer?: unknown;
  disqualified?: boolean;
}

/* ── Screen / answer API ─────────────────────────────── */

export interface StartResponse {
  sessionId: string;
  greeting?: string;
  prompt?: string;
  consent?: boolean;
  done: boolean;
  terminal?: Terminal;
  reason?: string;
  trace?: TraceRow[];
  deferred?: string | string[];
  closing?: string;
}

export interface AnswerResponse {
  ack?: string;
  prompt?: string;
  done: boolean;
  terminal?: Terminal;
  reason?: string;
  deferred?: string | string[];
  closing?: string;
  redirected?: boolean;
  trace?: TraceRow[];
}

export type Terminal = 'QUALIFIED' | 'DNQ' | 'INCOMPLETE';

/* ── Report API ──────────────────────────────────────── */

export interface ReportCounts {
  qualified: number;
  dnq: number;
  incomplete: number;
  total: number;
}

export interface DnqReason {
  reason: string;
  count: number;
}

export interface PatientResult {
  patient?: string;
  terminal?: string;
  reason?: string;
  failed?: string;
}

export interface Report {
  counts: ReportCounts;
  dnqReasons: DnqReason[];
  patients: PatientResult[];
}

/* ── UI message types ────────────────────────────────── */

export type BubbleKind = 'agent' | 'patient' | 'ack' | 'greeting' | 'closing' | 'error';

export interface ChatMessage {
  id: string;
  kind: BubbleKind;
  text: string;
  time: string;
}

export interface VerdictMessage {
  id: string;
  kind: 'verdict';
  terminal: Terminal;
  reason?: string;
  trace?: TraceRow[];
  deferred?: string | string[];
}

export interface DividerMessage {
  id: string;
  kind: 'divider';
  label: string;
}

export type ChatEntry = ChatMessage | VerdictMessage | DividerMessage;
