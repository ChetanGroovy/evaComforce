import type {
  StudyBrief,
  StudyDetail,
  StartResponse,
  AnswerResponse,
  Report,
} from './types';

async function apiFetch<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const { headers: extraHeaders, ...restOpts } = opts;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(extraHeaders != null ? (extraHeaders as Record<string, string>) : {}),
    },
    ...restOpts,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json() as { error?: string; message?: string };
      msg = j.error ?? j.message ?? msg;
    } catch (_) { /* empty */ }
    throw new Error(`${res.status}: ${msg}`);
  }
  return res.json() as Promise<T>;
}

/* ── Studies ──────────────────────────────────────────── */

export function fetchStudies(): Promise<StudyBrief[]> {
  return apiFetch<StudyBrief[]>('/api/studies');
}

export function fetchStudy(id: string): Promise<StudyDetail> {
  return apiFetch<StudyDetail>(`/api/studies/${id}`);
}

export interface NewStudyPayload {
  name: string;
  internalNumber?: string;
  sponsor?: string;
  indication?: string;
  documents: Array<{ filename: string; type: string; dataBase64: string }>;
}

export interface NewStudyResponse {
  id: string;
  status: string;
  documents: number;
  note?: string;
}

export function createStudy(payload: NewStudyPayload): Promise<NewStudyResponse> {
  return apiFetch<NewStudyResponse>('/api/studies', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface UpdateStudyPayload {
  study?: Record<string, string>;
  knowledgeBank?: Record<string, string>;
  conversation?: Record<string, string>;
  screeningQuestions?: unknown[];
  flow?: { nodes: unknown[]; edges: unknown[] };
  status?: string;
}

export function updateStudy(id: string, patch: UpdateStudyPayload): Promise<StudyDetail> {
  return apiFetch<StudyDetail>(`/api/studies/${id}/update`, {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

/* ── Screening ────────────────────────────────────────── */

export function screenStart(studyId: string, name?: string): Promise<StartResponse> {
  return apiFetch<StartResponse>('/api/screen/start', {
    method: 'POST',
    body: JSON.stringify({ studyId, ...(name ? { name } : {}) }),
  });
}

export function screenAnswer(sessionId: string, text: string): Promise<AnswerResponse> {
  return apiFetch<AnswerResponse>('/api/screen/answer', {
    method: 'POST',
    body: JSON.stringify({ sessionId, text }),
  });
}

/* ── Report ───────────────────────────────────────────── */

export function fetchReport(studyId: string): Promise<Report> {
  return apiFetch<Report>(`/api/report/${studyId}`);
}
