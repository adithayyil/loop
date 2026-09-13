# AGENTS.md

Instructions for agents working in this repo. Architecture lives in [ARCHITECTURE.md](./ARCHITECTURE.md);
the pitch and quick start are in [README.md](./README.md).

## Setup

Everything runs inside the nix dev shell:

```sh
nix develop
npm install
```

The shell sets `GIT_CONFIG_NOSYSTEM=1` (the Nix system gitconfig rewrites GitHub HTTPS→SSH and
breaks subprocess `git clone`) and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (we only use
`playwright-core` as a CDP client, or the nixpkgs browser for E2E).

## Checks

Run these before calling anything done:

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm test` is pure unit tests (`node:test`) for the compiler, healer, narration, and vision
parsers, no browser, no keys. `npm run test:e2e` drives the real UI in a real browser, seeds data
over the HTTP API, and writes full-page screenshots to `recordings/e2e/` for visual review. It
builds and starts the app itself.

## Conventions

- TypeScript throughout. Next.js App Router; components are server components by default, add
  `'use client'` only when needed.
- `lib/**` is server-only. Never import it into a client component; go through `app/api/**`.
- Comments explain a non-obvious *why*. Do not restate the code.
- Commits are one-line [Conventional Commits](https://www.conventionalcommits.org/),
  `type: subject`. Never add `Co-Authored-By:` or session trailers.
- Commit and push only when asked.

## Architecture notes

- **Process-wide state lives on `globalThis`** (`lib/capture.ts`, `lib/runs.ts`,
  `lib/agent-runs.ts`). Next gives each route its own module instance, so module-local state is
  not shared. Keep it that way.
- **Steel sessions** are created through `lib/steel.ts` → `createSession` and released in a
  `finally` on every path. A **failed** replay keeps its session alive for
  `LOOP_FAILED_SESSION_MS` so `Needs you` can be taken over; do not "fix" that by releasing early.
- **Steel drops session files on release**, so cache downloads before releasing (see `lib/replay.ts`).
- **Vision heals are runtime-only.** `lib/vision.ts` clicks coordinates but never persists them;
  coordinates don't generalize, and the model won't reliably abstain, so the DOM-corroboration gate
  is required.
- **The recorder needs values**; Steel's own traces redact them. Capture is our injected CDP
  recorder (`lib/recorder.ts`), not traces.
- **Schedules are stored, not fired.** Only "Run now" executes.

## Environment

`.env` is gitignored and server-side only; never ship keys to the client or put real values in
`.env.example`.

- `STEEL_KEY`: cloud browser sessions.
- `CLAUDE_KEY`: compiler and agent. Without it loop still works (deterministic compiler, no agent).
- Speech keys (`OPENROUTER_API_KEY` / `GROQ_API_KEY` / `OPENAI_KEY`) and the `LOOP_*` flags are
  optional; see `.env.example`.

## Gotchas

- **NixOS cannot run Playwright's bundled Chromium.** `e2e/ui.mjs` finds the nixpkgs Chromium
  automatically; override with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
- **Keep `.gitignore`'s recordings rule anchored to the repo root** (`/recordings/`). A bare
  `recordings/` also swallows `app/api/recordings/**`, which silently untracked the whole
  recordings API once.
- **The UI is shadcn/ui + Tailwind v4.** Do not reintroduce the old `lp-*` class system. Prefer
  `buttonVariants()` on `Link` over Base UI's `Button render` for navigation, so links keep link
  semantics.
