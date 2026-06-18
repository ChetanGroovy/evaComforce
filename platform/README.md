# comforceEva platform

Production TypeScript monorepo for the deterministic clinical-trial prescreening engine.
Ports the proven prototype (`../studygen.mjs` + `../ui/`) into a maintainable, scalable, typed architecture.

See `CONTRACTS.md` for the source-of-truth interfaces. Architecture rationale: `../reference/TECH-STACK-AND-ARCHITECTURE.html`.

```
packages/  engine (pure verdict) · schema (zod) · extractor (rule+Haiku) · eval (golden/lint)
apps/      api (Fastify) · web (React+Vite+Tailwind)
```

Build: `pnpm install && pnpm -r build` · Test: `pnpm -r test` (network needed for installs).
