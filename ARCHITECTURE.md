# Architecture

**loop** records a browser task once — either by you doing it or by an agent doing it — turns the
captured DOM events into an editable, plain-language step list, and replays that list
deterministically in a fresh cloud browser session.

This document describes how the pieces fit together. For product framing and the build log, see
[PLAN.md](./PLAN.md).

---

## 1. Principles

- **One infrastructure for record and replay.** Both happen in a Steel cloud session; selectors,
  rendering, and auth are identical between capture and execution.
- **DOM events are the replay source of truth.** Video and accessibility traces are for humans,
  not for replay.
- **The review screen is the trust checkpoint.** Compiled steps are edited in place; original raw
  events stay available.
- **Repro for the demo, generality by design.** The golden path targets a self-hosted invoice app,
  but nothing in the pipeline is site-specific.

---

## 2. System diagram

```
                         +------------------------------------------------------+
  browser (user)         |  Next.js app (App Router, one process)              |
  +-------------+        |                                                      |
  |  /  (chat)  |  HTTP  |  Route handlers (app/api/**)                       |
  |  /review    |<------>|    - recordings / compile / skills / agent / runs    |
  |  /run       |        |    - downloads (cached files)                        |
  |  /library   |        |                                                      |
  +-------------+        |  Server modules (lib/**)                             |
        |                |    capture  -> Steel session + CDP + recorder        |
        |  iframe        |    compiler -> normalize() + Claude (anthropic.ts)   |
        |  (Steel        |    agent    -> aria-snapshot tool loop (Claude)      |
        |   player)      |    replay   -> locator chain + Files API             |
        v                |    db/store -> SQLite (node:sqlite)                  |
  +-------------+        +-----------------------------+------------------------+
  | Steel cloud |  CDP (wss)                            | HTTP
  |  session    |<--------------------------------------+
  |  (Chromium) |                                      v
  +-------------+                                +-----------+
        |                                        | Anthropic |
        |  reachable target site                |  Claude   |
        v                                        +-----------+
  demo app (/demo/vendor) via `npm run tunnel` (cloudflared)
```

---

## 3. The pipeline

1. **Capture.** A Steel session is created (`lib/steel.ts` → `createSession`), Playwright connects
   over CDP, and a recorder is injected into every document (`lib/recorder.ts`). The recorder emits
   `click` / `change` / `enter` / `navigate` events with a CSS candidate, role, accessible name,
   value, and URL. Events stream to the server over a CDP binding and are mirrored to
   `recordings/<id>.ndjson`.
2. **Compile.** `lib/compiler.ts` `normalize()` collapses raw events into execution actions
   (drops focus clicks, dedupes checkbox changes, flushes pending fills before a submit, emits
   `goto`s), then an LLM inferer (`lib/anthropic.ts`) turns actions into a plain-language step list
   with parameter guesses. Locators are bound back to the recorded actions, never invented.
3. **Review.** `/review/[id]` (`app/review/[id]/ReviewClient.tsx`) lets the user edit step text,
   merge/delete steps, and mark each value as **changes each time** (a parameter prompted at run) or
   **always the same**. The raw event log is viewable.
4. **Save.** The reviewed steps plus a name and trigger become a `Skill` row in SQLite.
5. **Run.** `/run/[id]` starts a background run: a fresh Steel session with the saved profile,
   the compiled steps executed via a locator chain, a live Steel viewer embedded, and downloaded
   files cached and listed at the end.

The `kind` on a message in the chat is either `agent` (goal-driven, see §7) or `browser` (manual
recording); both feed the same compile → review → skill path.

---

## 4. Module map

### `lib/` (server)

| Module | Responsibility |
|---|---|
| `types.ts` | Shared types: `RecordedEvent`, `Action`, `CompiledStep`, `CompileResult`, `Recording`, `Skill`. |
| `recorder.ts` | `RECORDER_SCRIPT` injected into each document; emits namespaced `__loop*` events. |
| `capture.ts` | `startRecording` / `stopRecording` / `navigateRecording`; owns the active-capture registry (Steel session + CDP browser + page + NDJSON stream). |
| `steel.ts` | `steelClient`, `sessionConfig`, `createSession` (with captcha/stealth fallback), `profileForSession`. |
| `compiler.ts` | Pure `normalize(events) -> Action[]`, `describeAction`, `deterministicSteps`, `isChallengeEvent`; `compile(events, inferer, ctx)`. |
| `anthropic.ts` | `anthropicInferer()`: Claude tool-call that emits steps + parameter guesses; degrades to `deterministicSteps` without a key or on error. |
| `agent.ts` | `runAgent()`: goal-driven tool loop using `ariaSnapshot`, executes one action per turn. |
| `agent-runs.ts` | In-flight agent run records + abort controllers (`globalThis`-backed). |
| `replay.ts` | `runSkill()`: locator chain, param resolution, download caching, release. |
| `runs.ts` | In-flight replay run records (`globalThis`-backed). |
| `db.ts` / `store.ts` | SQLite persistence for recordings and skills. |
| `demo-data.ts` | Self-hosted invoice demo app data + a dependency-free PDF builder. |
| `fixtures/*.ndjson` | Canned event streams used by tests and the offline compile path. |

### `app/`

| Area | Responsibility |
|---|---|
| `page.tsx` + `chat/ChatClient.tsx` | The app: dark chat. Mode "Ask the agent" or "Open a browser"; threads messages; polls runs. |
| `chat/page.tsx` | Redirects `/chat` → `/`. |
| `review/[id]/` | Step review + parameter editing + save. |
| `run/[id]/` | Trigger a saved skill, watch it live, list downloads. |
| `library/page.tsx` | List saved loops. |
| `demo/vendor/` | The self-hosted "vendor.com" (login, invoice list, unpaid filter, PDF). |
| `api/**` | HTTP surface, see §5. |
| `globals.css` | Light utility styles + the dark `loop-dark` palette and chat/review/run classes. |

---

## 5. HTTP API

| Method + path | Purpose |
|---|---|
| `POST /api/recordings` | Open a browser session (blank unless `startUrl`/`LOOP_DEMO_URL`); returns `{ id, sessionId, debugUrl }`. |
| `POST /api/recordings/[id]/navigate` | Navigate an open session from the in-app address bar. |
| `POST /api/recordings/[id]/stop` | Release the session, persist the `Recording`, compile, return `{ recording, result }`. |
| `GET /api/recordings/[id]` | Fetch a stored recording + compiled result. |
| `POST /api/compile` | Compile raw `events` or a named `fixture` offline; persists a recording. |
| `GET /api/skills` | List skills. |
| `POST /api/skills` | Save a skill (name + trigger + steps + profile). |
| `GET /api/skills/[id]` | Fetch a skill. |
| `POST /api/skills/[id]/run` | Start a background replay; returns `{ runId }`. |
| `GET /api/runs/[id]` | Poll a replay run (`running` / `done` / `failed`). |
| `POST /api/agent` | Start an autonomous agent run; returns `{ runId }`. |
| `GET /api/agent/[id]` | Poll an agent run (status, steps, `debugUrl`, `recordingId`). |
| `DELETE /api/agent/[id]` | Stop an agent run (aborts the loop, releases the session). |
| `GET /api/downloads/[runId]/[name]` | Serve a file cached before the session was released. |
| `POST /demo/vendor/api/login` | Demo app login (sets a session cookie; honors `x-forwarded-*`). |
| `GET /demo/vendor/invoices/[id]/pdf` | Demo app PDF (requires the session cookie). |

All route handlers run on the Node runtime (`export const runtime = 'nodejs'`).

---

## 6. Session & recording lifecycle

- **Registry.** Active captures live in a `globalThis`-backed `Map` (`lib/capture.ts`). Next gives
  each route its own module instance, so process-wide state must not live in module locals;
  `globalThis` is the shared store for captures, runs, and agent runs.
- **Auth reuse.** Recording sessions set `persistProfile: true`. On stop, `profileForSession()`
  finds the profile whose `sourceSessionId` matches the session and stores its id on the recording.
  Replay sessions are created with that `profileId`, so replays arrive already signed in.
- **Login steps.** The compiler tags sign-in-only steps with `skipIfAuthenticated`; the runner
  skips them when a `profileId` is present, so a saved login is reused instead of re-entered.
- **Release.** Sessions are released in a `finally` on every path (capture stop, agent completion,
  replay completion). The runner keeps the session alive ~4s after completion so the live viewer
  shows the end state.

---

## 7. Agent (autonomous record)

`runAgent()` (`lib/agent.ts`) drives the browser from a natural-language goal:

1. **Observe** — `page.locator('body').ariaSnapshot({ mode: 'ai' })` plus URL/title.
2. **Decide** — a Claude tool call (`tool_choice: any`) picks exactly one action.
3. **Act** — executed with Playwright, mostly by `getByRole(role, { name })` (fallback
   label/placeholder/text), so the emitted locators match the replay chain.
4. **Record** — the same DOM recorder is injected, so agent actions compile through the identical
   pipeline.

Tools: `goto`, `click`, `type`, `select`, `press`, `scroll`, `wait`, `done`, `fail`.

Guardrails:

- Default `maxSteps` 15 and a 120s wall-clock budget.
- **Stuck detection**: the same action three times in a row stops the run.
- **Challenge detection** (`detectChallenge`): CAPTCHA/bot challenge markers stop the run with a
  clear message rather than flailing.
- **Cancellation**: an `AbortController` per run; `DELETE /api/agent/[id]` aborts and releases.
- A system prompt that forbids payments/deletions/account changes and tells the agent to answer
  from the visible page instead of scrolling indefinitely.

---

## 8. Compiler

`normalize(events)` (pure, fixture-tested) produces an ordered `Action[]`:

- Drops clicks that only focus a text field (`FOCUS_ROLES`).
- Collapses `change` events per target into pending fills; flushes them (in order) before a click,
  so form submissions fill fields first.
- Emits `type+enter` for Enter, `click` (with a `toggle` note for checkboxes), and `goto` on
  navigation changes.
- Drops bot-challenge events and challenge URLs (`isChallengeEvent`).

The inferer (`anthropicInferer`) then produces `{ title, summary, steps[] }` with a forced tool
call. Each step echoes the recorded `actionIndex`, so locators are copied from the recorded action
and parameter guesses (`mode: fixed | variable`) are attached. Without `CLAUDE_KEY` (or on error)
it falls back to `deterministicSteps`, so the app still works offline.

---

## 9. Replay

`runSkill()` (`lib/replay.ts`):

- Creates a session with `profileId` and `persistProfile: false`.
- Resolves each step's value from run params (`Ask each time`) or the baked-in value.
- Locator chain: `dataTest` → `role` + accessible name → `css` → visible text.
- On completion, lists the Steel Files API and **caches downloads to
  `recordings/downloads/<runId>/` before releasing** (Steel drops session files on release).

The run is backgrounded: `POST /api/skills/[id]/run` returns a `runId` immediately and the client
polls `/api/runs/[id]`, embedding the Steel player while `running`.

---

## 10. Persistence

SQLite via Node's built-in `node:sqlite` (`lib/db.ts`) — no native build step. Two tables store
JSON blobs:

```sql
recordings (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)
skills     (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL)
```

`data` is the serialized `Recording` / `Skill`. `lib/store.ts` re-exports the store; the DB lives
at `loop.db` (gitignored).

---

## 11. Steel integration

- **Sessions**: `lib/steel.ts` centralizes creation. `debugConfig.interactive` enables the
  embeddable player; `persistProfile` enables auth reuse.
- **CDP**: `chromium.connectOverCDP('wss://connect.steel.dev?apiKey=…&sessionId=…')`. The recorder
  binding and init script are installed over CDP.
- **Viewer**: `session.debugUrl` is embedded as an iframe (no `X-Frame-Options`/CSP), with a
  "Take over in a new tab" escape hatch.
- **Stealth / captcha** (opt-in via env): `LOOP_SOLVE_CAPTCHA=1` sets `solveCaptcha` +
  `stealthConfig.autoCaptchaSolving`; `LOOP_HUMANIZE=1` sets `stealthConfig.humanizeInteractions`.
  Captcha solving requires a paid Steel balance; `createSession` logs a warning and retries without
  it on the 403 so a flag can't break a run.

---

## 12. Demo app and reachability

The Steel cloud browser cannot reach `localhost`, so the self-hosted invoice app is exposed with a
tunnel:

```sh
npm run tunnel                 # cloudflared tunnel --url http://localhost:3000
# put the printed https://…trycloudflare.com in LOOP_DEMO_URL
```

`app/demo/vendor/**` is the "vendor.com": a native-form login (303 + cookie), an invoice list with
an `?status=unpaid` filter, and a dependency-free PDF route. It uses stable `data-testid`s to make
recording and replay reliable. Login redirects are built from `x-forwarded-*` headers so they work
behind the tunnel.

---

## 13. Configuration

Environment (server-side only; see `.env.example`):

| Variable | Purpose |
|---|---|
| `STEEL_KEY` | Steel API key. |
| `CLAUDE_KEY` | Anthropic API key (compiler + agent). |
| `LOOP_DEMO_URL` | Public base URL of this app (tunnel/deploy); default browser + agent start page. |
| `LOOP_SOLVE_CAPTCHA` | `1` to auto-solve captchas (paid Steel balance required). |
| `LOOP_HUMANIZE` | `1` for human-like mouse movement. |
| `LOOP_COMPILER_MODEL` / `LOOP_AGENT_MODEL` | Optional model overrides. |

---

## 14. Development

```sh
nix develop          # node 24 + git + cloudflared, GIT_CONFIG_NOSYSTEM=1
npm install
npm run dev          # http://localhost:3000  (the chat)
npm test             # compiler fixture tests (node:test)
npm run typecheck    # tsc --noEmit
npm run build        # next build
```

`spike/` holds the de-risking scripts (the proven record→replay round trip, live E2E harnesses,
the HLS backup-video capture, session cleanup). `recordings/` holds runtime artifacts and is
gitignored.

---

## 15. Known limitations

- **DOM/ARIA-first agent** — canvas/visual-only UIs and image captchas are out of scope (vision
  fallback would use Steel's `sessions.computer` + a VLM).
- **Main-frame recorder** — iframes, closed shadow DOM, file uploads, and drag-drop are not captured.
- **Selector fragility** — the locator chain helps, but there is no vision self-healing yet.
- **First-match downloads** — multi-item iteration ("download *each* PDF") is not implemented.
- **Schedules are stored, not fired** — only "Run now" executes.
- **Single-process state** — in-flight captures/runs live in `globalThis`; a restart drops them
  (persisted recordings/skills survive in SQLite).
