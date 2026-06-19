import { useState, useCallback, useEffect } from 'react';
import { Header } from './components/Header';
import { StudyPicker } from './components/StudyPicker';
import { ScreeningChat } from './components/ScreeningChat';
import { FunnelDashboard } from './components/FunnelDashboard';
import { StudyDetailPage } from './components/StudyDetailPage';
import { fetchStudies, fetchStudy, fetchReport, getStudy } from './api';
import type { StudyBrief, StudyDetail, Report } from './types';

export function App() {
  /* ── Studies ──────────────────────────────────────── */
  const [studies, setStudies] = useState<StudyBrief[]>([]);
  const [loadingStudies, setLoadingStudies] = useState(true);
  const [errorStudies, setErrorStudies] = useState<string | null>(null);

  /* ── Selected study detail ────────────────────────── */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStudy, setSelectedStudy] = useState<StudyDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  /* ── Report ───────────────────────────────────────── */
  const [report, setReport] = useState<Report | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [errorReport, setErrorReport] = useState<string | null>(null);

  /* ── View: dashboard (screening) ↔ study detail page (flow editor) ── */
  const [view, setView] = useState<'dashboard' | 'study'>('dashboard');

  /* ── Load studies ─────────────────────────────────── */
  const loadStudies = useCallback(async () => {
    setLoadingStudies(true);
    setErrorStudies(null);
    try {
      const data = await fetchStudies();
      setStudies(data);
    } catch (e) {
      setErrorStudies(`Failed to load studies: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingStudies(false);
    }
  }, []);

  useEffect(() => {
    void loadStudies();
  }, [loadStudies]);

  /* ── Load report ──────────────────────────────────── (defined before select) */
  const loadReport = useCallback(async (studyId: string) => {
    setLoadingReport(true);
    setErrorReport(null);
    try {
      const data = await fetchReport(studyId);
      setReport(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('404')) {
        // No screening data yet — show empty state
        setReport({ counts: { qualified: 0, dnq: 0, incomplete: 0, total: 0 }, dnqReasons: [], patients: [] });
      } else {
        setErrorReport(`Report error: ${msg}`);
        setReport(null);
      }
    } finally {
      setLoadingReport(false);
    }
  }, []);

  /* ── Select study ─────────────────────────────────── */
  const handleSelectStudy = useCallback(async (brief: StudyBrief) => {
    setSelectedId(brief.id);
    setLoadingDetail(true);
    setErrorDetail(null);
    setSelectedStudy(null);

    try {
      const detail = await fetchStudy(brief.id);
      setSelectedStudy(detail);
    } catch (e) {
      setErrorDetail(`Failed to load study: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingDetail(false);
    }

    void loadReport(brief.id);
  }, [loadReport]);

  const handleRefreshReport = useCallback(() => {
    if (selectedId) void loadReport(selectedId);
  }, [selectedId, loadReport]);

  const handleScreeningComplete = useCallback(() => {
    if (selectedId) void loadReport(selectedId);
  }, [selectedId, loadReport]);

  const handleStudyUpdated = useCallback(async () => {
    if (selectedId) {
      setLoadingDetail(true);
      try {
        const detail = await fetchStudy(selectedId);
        setSelectedStudy(detail);
      } catch (_) { /* ignore */ }
      finally { setLoadingDetail(false); }
    }
  }, [selectedId]);

  /* ── New study created ───────────────────────────────
     Refetch the study list, open the freshly-created study in the
     full-page detail view, then poll the StudyOnboard pipeline until the
     status settles (needs_review | ready | draft) — up to ~90s. While the
     pipeline runs the study status is 'onboarding', which StudyDetailPage
     surfaces as "Extracting criteria & questions…". */
  const handleStudyCreated = useCallback((id: string) => {
    void (async () => {
      setSelectedId(id);
      setView('study');
      setLoadingDetail(true);
      setErrorDetail(null);
      setSelectedStudy(null);

      try {
        const detail = await getStudy(id);
        setSelectedStudy(detail);
      } catch (e) {
        setErrorDetail(`Failed to load study: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setLoadingDetail(false);
      }

      void loadStudies();

      // Poll until the onboarding pipeline finishes (or times out).
      const TERMINAL = new Set(['needs_review', 'ready', 'draft']);
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const d = await getStudy(id);
          setSelectedStudy(d);
          if (!d.status || TERMINAL.has(d.status)) {
            void loadStudies();
            break;
          }
        } catch (_) { /* transient — keep polling */ }
      }
    })();
  }, [loadStudies]);

  if (view === 'study' && selectedStudy) {
    return (
      <div className="app-root">
        <Header />
        <StudyDetailPage
          study={selectedStudy}
          onBack={() => setView('dashboard')}
          onStudyUpdated={(updated) => {
            setSelectedStudy(updated);
            void loadStudies();
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-root">
      <Header />
      <div className="app-body">
        <StudyPicker
          studies={studies}
          loadingStudies={loadingStudies}
          errorStudies={errorStudies}
          selectedStudy={selectedStudy}
          loadingDetail={loadingDetail}
          errorDetail={errorDetail}
          selectedId={selectedId}
          onSelectStudy={(brief) => void handleSelectStudy(brief)}
          onStudiesRefresh={() => void loadStudies()}
          onStudyUpdated={() => void handleStudyUpdated()}
          onStudyCreated={handleStudyCreated}
          onOpenStudy={() => setView('study')}
        />
        <ScreeningChat
          selectedStudy={selectedStudy}
          onScreeningComplete={handleScreeningComplete}
        />
        <FunnelDashboard
          report={report}
          loading={loadingReport}
          error={errorReport}
          studyId={selectedId}
          onRefresh={handleRefreshReport}
        />
      </div>
    </div>
  );
}
