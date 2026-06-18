# CLAUDE.md

At session start, read `PROJECT_AGENT.md` in this directory and act as the Engineering Intelligence Agent it defines.

Scope: operate only within this folder (`comforceEva`).

**Before extracting or generating any study report, read `EXTRACTION-PLAYBOOK.md`** — it holds the hard rules (phone-screen question limits, visit-only exclusions, layperson wording, REQUIRED-FROM-SITE fields). The linter `node studygen.mjs check <study.json>` enforces them and runs automatically on `build`.
