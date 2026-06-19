import { z } from 'zod';

// ── Criterion ────────────────────────────────────────────────────────────────

export const CriterionSchema = z.object({
  criterion_number: z.number(),
  source_pages: z.array(z.number()),
  criterion_text: z.string(),
  verification_method: z.enum(['self_report', 'exam', 'lab', 'imaging', 'records', 'derived']),
  knockout_strength: z.enum(['hard', 'soft', 'none']),
  phone_screenable: z.boolean(),
  rationale: z.string().optional(),
}).passthrough();

export type Criterion = z.infer<typeof CriterionSchema>;

// ── ScreeningQuestion ────────────────────────────────────────────────────────

export const ScreeningQuestionSchema = z.object({
  rank: z.number(),
  variable_name: z.string(),
  sms_question: z.string(),
  answer_type: z.enum(['yes_no', 'number', 'choice', 'bmi', 'text']),
  choices: z.array(z.string()).optional(),
  routing: z.boolean().optional(),
  show_if: z.string().optional(),
  disqualify_condition: z.string().optional(),
  qualify_condition: z.string().optional(),
  depends_on: z.array(z.string()).optional(),
  criteria_ids: z.array(z.string()).optional(),
  is_qualifying_question: z.boolean().optional(),
  knockout_power: z.string().optional(),
  included_in_flow: z.boolean().optional(),
  category: z.string().optional(),
  capture: z.string().optional(),
  bmi_cutoff: z.number().optional(),
  defer_if_unanswered: z.boolean().optional(),
  defer_note: z.string().optional(),
}).passthrough();

export type ScreeningQuestion = z.infer<typeof ScreeningQuestionSchema>;

// ── Document ─────────────────────────────────────────────────────────────────

export const DocumentSchema = z.object({
  name: z.string(),
  type: z.string(),
  uploaded: z.string().optional(),
  documentId: z.string().optional(),
  extractionStatus: z.string().optional(),
}).passthrough();

export type Document = z.infer<typeof DocumentSchema>;

// ── FlowNode ─────────────────────────────────────────────────────────────────

export const FlowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  label: z.string().optional(),
  data: z.record(z.unknown()).optional(),
}).passthrough();

export type FlowNode = z.infer<typeof FlowNodeSchema>;

// ── FlowEdge ─────────────────────────────────────────────────────────────────

export const FlowEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
}).passthrough();

export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

// ── StudyMeta ────────────────────────────────────────────────────────────────

export const StudyMetaSchema = z.object({
  name: z.string(),
  internalNumber: z.string().optional(),
  sponsor: z.string().optional(),
  principalInvestigator: z.string().optional(),
  site: z.string().optional(),
  priority: z.string().optional(),
  indication: z.string().optional(),
  drug: z.string().optional(),
  flowStatus: z.string().optional(),
  flowVersion: z.number().optional(),
  isPublished: z.boolean().optional(),
  flowUpdated: z.string().optional(),
  studyId: z.string().optional(),
  selectedProtocolDocumentId: z.string().optional(),
  phase: z.string().optional(),
}).passthrough();

export type StudyMeta = z.infer<typeof StudyMetaSchema>;

// ── FunnelBucket ─────────────────────────────────────────────────────────────

export const FunnelBucketSchema = z.object({
  key: z.string().optional(),
  label: z.string().optional(),
  count: z.number().optional(),
}).passthrough();

export type FunnelBucket = z.infer<typeof FunnelBucketSchema>;

// ── Patient ──────────────────────────────────────────────────────────────────

export const PatientSchema = z.object({
  displayName: z.string().optional(),
  primaryPhone: z.string().optional(),
  lifecycleStatus: z.string().optional(),
  currentStepLabel: z.string().optional(),
  lastActivityAt: z.string().optional(),
}).passthrough();

export type Patient = z.infer<typeof PatientSchema>;

// ── Recruiter ────────────────────────────────────────────────────────────────

export const RecruiterSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  role: z.string().optional(),
  calendar: z.string().optional(),
}).passthrough();

export type Recruiter = z.infer<typeof RecruiterSchema>;

// ── Conversation ─────────────────────────────────────────────────────────────

export const ConversationSchema = z.object({
  greeting: z.string().optional(),
  closingQualified: z.string().optional(),
  closingDnq: z.string().optional(),
  closingIncomplete: z.string().optional(),
}).passthrough();

export type Conversation = z.infer<typeof ConversationSchema>;

// ── Study (top-level) ────────────────────────────────────────────────────────

export const StudySchema = z.object({
  source: z.string().optional(),
  capturedAt: z.string().optional(),
  status: z.enum(['draft', 'ready']).optional(),
  study: StudyMetaSchema,
  documents: z.array(DocumentSchema),
  knowledgeBank: z.record(z.string()),
  inclusionCriteria: z.array(CriterionSchema),
  exclusionCriteria: z.array(CriterionSchema),
  screeningQuestions: z.array(ScreeningQuestionSchema),
  flow: z.object({
    nodes: z.array(FlowNodeSchema),
    edges: z.array(FlowEdgeSchema),
  }).passthrough(),
  funnel: z.array(FunnelBucketSchema),
  patients: z.array(PatientSchema),
  recruiters: z.array(RecruiterSchema),
  conversation: ConversationSchema.optional(),
}).passthrough();

export type Study = z.infer<typeof StudySchema>;

// ── parseStudy ───────────────────────────────────────────────────────────────

export function parseStudy(json: unknown): Study {
  return StudySchema.parse(json);
}

// ── TraceRow ─────────────────────────────────────────────────────────────────

export interface TraceRow {
  rank: number;
  variable: string;
  question?: string;
  answer?: unknown;
  shown: boolean;
  known?: boolean;
  disqualified?: boolean;
  deferred?: boolean;
}
