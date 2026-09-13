# Architecture

**loop** records a browser task once — either by doing it in a cloud browser, or by describing the
goal to an agent — and turns the captured DOM events (plus optional voice narration) into a step
list that replays deterministically in a fresh Steel cloud browser session.

This document describes the system: the pipeline in §3, the app surfaces in §4, and what is
intentionally out of scope in §15.

---

## 1. Principles

- **One infrastructure for record and replay.** Both happen in a Steel cloud session; selectors,
  rendering, and auth are identical between capture and execution.
- **DOM events are the replay source of truth.** Video and accessibility traces are for humans,
  not for replay.
- **The review screen is the trust checkpoint.** Compiled steps are edited in place; original raw
  events stay available.
- **Nothing in the pipeline is site-specific.** Any public site can be recorded and replayed.

---

## 2. System diagram

```
                         +------------------------------------------------------+
  browser (user)         |  Next.js app (App Router, one process)              |
  +---------------+      |                                                      |
  |  /   (loops)  | HTTP |  Route handlers (app/api/**)                       |
  |  /new         |<---->|    - recordings / compile / skills / agent / runs   |
  |  /review      |      |    - downloads (cached files)                        |
  |  /loops       |      |                                                      |
  |  /runs        |      |  Server modules (lib/**)                             |
  +---------------+      |    capture  -> Steel session + CDP + recorder        |
        |                |    compiler -> normalize() + Claude (anthropic.ts)   |
        |  (Steel        |    agent    -> aria-snapshot tool loop (Claude)      |
        |   player)      |    replay   -> locator chain + Files API             |
        v                |    db/store -> SQLite (node:sqlite)                  |
  +-------------+        +-----------------------------+------------------------+
  | Steel cloud |  CDP (wss)                            | HTTP
  |  session    |<--------------------------------------+
  |  (Chromium) |                                      v
  +-------------+                                +-----------+
        |                                        | Anthropic |
        v                                        |  Claude   |
  any reachable                            +-----------+
  target site

---

## 3. The pipeline

1. **Capture.** A Steel session is created (`lib/steel.ts` → `createSession`), Playwright connects
   over CDP, and a recorder is injected into every document (`lib/recorder.ts`). The recorder emits
   `click` / `change` / `enter` / `navigate` events with a CSS candidate, role, accessible name,
   value, and URL. Events stream to the server over a CDP binding and are mirrored to
   `recordings/<id>.ndjson`. In parallel, the client can record the local tab's mic; the audio is
   transcribed (`lib/transcribe.ts`) and attached to the live capture.
2. **Compile.** `lib/compiler.ts` `normalize()` collapses raw events into execution actions
   (drops focus clicks, dedupes checkbox changes, flushes pending fills before a submit, emits
   `goto`s), then an LLM inferer (`lib/anthropic.ts`) turns actions into a plain-language step list
   with parameter guesses. Locators are bound back to the recorded actions, never invented. When
   narration was captured it is passed in as `CompileContext.narration` and steers step wording,
   parameter intent, and loop detection.
3. **Review.** `/review/[id]` (`app/review/[id]/ReviewClient.tsx`) lets the user edit or delete steps
   and mark each value as **changes each time** (a parameter prompted at run) or **always the same**.
   The raw event log is viewable.
4. **Save.** The reviewed steps plus a name and trigger become a `Skill` row in SQLite.
5. **Run.** `/loops/[id]` starts a background run: a fresh Steel session with the saved profile,
   the compiled steps executed via a locator chain, a live Steel viewer embedded, and downloaded
   files cached and listed at the end.

`/new` offers the two capture modes — `agent` (goal-driven, see §7) and `record` (manual) — and
both feed the same compile → review → skill path. `/` lists saved loops, `/runs` lists this
session's runs.

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
| `transcribe.ts` | Any OpenAI-compatible speech API (Groq / OpenAI / OpenRouter) for narration; pure `guardSegments` no-speech guard + `joinNarration`. |
| `anthropic.ts` | `anthropicInferer()`: Claude tool-call that emits steps + parameter guesses; degrades to `deterministicSteps` without a key or on error. |
| `agent.ts` | `runAgent()`: goal-driven tool loop using `ariaSnapshot`, executes one action per turn. |
| `agent-runs.ts` | In-flight agent run records + abort controllers (`globalThis`-backed). |
| `heal.ts` | Self-healing: `healStep()` re-resolves a failed locator from a live ARIA snapshot via Claude; `patchFromHealDecision()` is the pure, tested parser. |
| `vision.ts` | Canvas/visual fallback: `visionClickTarget()` screenshots via Steel, locates with Claude, corroborates, then clicks coordinates through the Computer API. |
| `vision-core.ts` | Pure vision helpers: `parseVisionDecision`, `elementCorroborates`, `pngSize` (tested without a browser). |
| `replay.ts` | `runSkill()`: locator chain, param resolution, loop iteration over repeated items, self-healing retry, download caching, release. |
| `runs.ts` | In-flight replay run records (`globalThis`-backed). |
| `db.ts` / `store.ts` | SQLite persistence for recordings and skills. |
| `fixtures/*.ndjson` | Canned event streams used by tests and the offline compile path. |

### `app/`

| Area | Responsibility |
|---|---|
| `layout.tsx` + `components/app-sidebar.tsx` | App shell: shadcn sidebar (New loop, Loops, Runs, recent loops) + global theme/toaster. |
| `page.tsx` + `components/loops-home.tsx` | Loops home: searchable table of saved loops with run actions and an empty state. |
| `new/` | Capture flow: pick **record** or **agent**, drive the live Steel viewer, optional mic narration, stop → review. |
| `review/[id]/` | Step review + parameter editing + sticky save panel; raw events in a sheet. |
| `loops/[id]/` | Loop detail: step list, run panel (params, live viewer, results, downloads, delete). |
| `runs/page.tsx` | This session's runs and their status. |
| `api/**` | HTTP surface, see §5. |
| `globals.css` | Tailwind v4 + shadcn theme: dark "signal" tokens (ink + signal-lime), Space Grotesk / Instrument Serif / JetBrains Mono. |

---

## 5. HTTP API

| Method + path | Purpose |
|---|---|
| `POST /api/recordings` | Open a browser session (blank unless `startUrl` is given); returns `{ id, sessionId, debugUrl }`. |
| `POST /api/recordings/[id]/navigate` | Navigate an open session from the in-app address bar. |
| `POST /api/recordings/[id]/narration` | Transcribe an uploaded audio blob (speech API) and attach it to the live capture. |
| `POST /api/recordings/[id]/stop` | Release the session, persist the `Recording`, compile, return `{ recording, result }`. |
| `GET /api/recordings/[id]` | Fetch a stored recording + compiled result. |
| `POST /api/compile` | Compile raw `events` or a named `fixture` offline; persists a recording. |
| `GET /api/skills` | List skills. |
| `POST /api/skills` | Save a skill (name + trigger + steps + profile). |
| `GET /api/skills/[id]` | Fetch a skill. |
| `DELETE /api/skills/[id]` | Delete a skill. |
| `POST /api/skills/[id]/run` | Start a background replay; returns `{ runId }`. |
| `GET /api/runs/[id]` | Poll a replay run (`running` / `done` / `failed`). |
| `POST /api/agent` | Start an autonomous agent run; returns `{ runId }`. |
| `GET /api/agent/[id]` | Poll an agent run (status, steps, `debugUrl`, `recordingId`). |
| `DELETE /api/agent/[id]` | Stop an agent run (aborts the loop, releases the session). |
| `GET /api/downloads/[runId]/[name]` | Serve a file cached before the session was released. |

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
- **Release.** Sessions are released in a `finally` on capture stop, agent completion, and replay
  completion; a successful run waits ~4s first so the live viewer shows the end state. A failed run
  instead keeps its session alive for `LOOP_FAILED_SESSION_MS` (default 5 min) so `Needs you` can be
  taken over, releasing on a detached timer.

---

## 7. Agent (autonomous record)

`runAgent()` (`lib/agent.ts`) drives the browser from a natural-language goal:

1. **Observe**: `page.locator('body').ariaSnapshot({ mode: 'ai' })` plus URL/title.
2. **Decide**: a Claude tool call (`tool_choice: any`) picks exactly one action.
3. **Act**: executed with Playwright, mostly by `getByRole(role, { name })` (fallback
   label/placeholder/text), so the emitted locators match the replay chain.
4. **Record**: the same DOM recorder is injected, so agent actions compile through the identical
   pipeline.

Tools: `goto`, `click`, `type`, `select`, `press`, `scroll`, `wait`, `done`, `fail`.

Guardrails:

- Default `maxSteps` 15 and a 120s wall-clock budget.
- **Stuck detection**: the same action three times in a row stops the run.
- **Challenge detection** (`detectChallenge`): CAPTCHA/bot challenge markers pause the run while
  Steel auto-solves (up to 30s when `LOOP_SOLVE_CAPTCHA=1`), then stop with a clear message rather
  than flailing.
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
- Absorbs the browser's trailing `change` and implicit submit `click` after an Enter, so a search
  compiles to one `type+enter` rather than `type+enter` + `fill` + `click`.
- Drops bot-challenge events and challenge URLs (`isChallengeEvent`).

The inferer (`anthropicInferer`) then produces `{ title, summary, steps[] }` with a forced tool
call. Each step echoes the recorded `actionIndex`, so locators are copied from the recorded action
and parameter guesses (`mode: fixed | variable`) are attached. When the goal/narration asks for
"each/every/all", the inferer marks the repeated step with `loop: { each: true }` (the offline
`deterministicSteps` uses the same `hasRepeatIntent` heuristic). Without `CLAUDE_KEY` (or on error)
it falls back to `deterministicSteps`, so the app still works offline.

---

## 9. Replay

`runSkill()` (`lib/replay.ts`):

- Creates a session with `profileId` and `persistProfile: false`.
- Resolves each step's value from run params (`Ask each time`) or the baked-in value.
- Locator chain: `dataTest` → `role` + accessible name → `css` → visible text. Inside a loop row
  the order is reversed to prefer `role`+name/`css`, since a per-item `data-testid` only exists in
  row 0.
- **Self-healing**: on failure, `healStep()` snapshots the live page (ARIA) and asks Claude for a
  replacement locator, then retries the action once. Repairs are returned in `result.healed` and
  written back to the stored skill by the run route, so the fix is permanent.
- **Vision fallback** (`via: 'vision'`): if the ARIA heal finds nothing, `visionClickTarget()`
  takes a screenshot through Steel's Computer API, asks Claude for the target's coordinates,
  corroborates the element under that point against the step name, and clicks the coordinates
  through Steel. It is runtime-only: coordinates don't generalize, so the step is not mutated and
  the run route skips persistence for vision heals. The run view labels these `· vision`.
- **Loops**: a step marked `loop: { each: true }` derives the repeating ancestor of its recorded
  target at runtime (nearest ancestor with structurally identical siblings), then runs the action
  once per item, returning to the list between items when the action navigated away.
- On completion, lists the Steel Files API and **caches downloads to
  `recordings/downloads/<runId>/` before releasing** (Steel drops session files on release).

The run is backgrounded: `POST /api/skills/[id]/run` returns a `runId` immediately and the client
polls `/api/runs/[id]`, embedding the Steel player while `running`. On failure the session is kept
for `LOOP_FAILED_SESSION_MS` so the same view can be taken over; a stale `runId` resolves to a
`runMissing` state rather than spinning.

---

## 10. Persistence

SQLite via Node's built-in `node:sqlite` (`lib/db.ts`), no native build step. Two tables store
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
  it on the 403 so a flag can't break a run. When solving is enabled the agent gives Steel up to
  30s to clear a detected challenge in-session before it hands off.
- **Proxies** (opt-in via env): `LOOP_USE_PROXY=1` sets `useProxy` (optionally pinned with
  `LOOP_PROXY_COUNTRY`); `LOOP_PROXY_URL` supplies a custom proxy and overrides it. `createSession`
  preserves proxy options across its captcha fallback retry.
- **Computer API**: the vision fallback uses `sessions.computer` for `take_screenshot` and
  `click_mouse`. Screenshots and clicks share the same space (which includes browser chrome), so the
  image from `take_screenshot` is both what the model sees and where the click lands; the code
  subtracts the screenshot↔viewport delta before probing the DOM.

---

## 12. Reachability

The Steel cloud browser cannot reach `localhost`, so recording against a local site requires
exposing it publicly (a tunnel such as `cloudflared tunnel --url http://localhost:3000`, or a
deployment) and navigating the in-app browser to that URL. (The self-hosted invoice demo app that
previously shipped in this repo, `app/demo/vendor/**`, was removed; any public site can be the
target now.)

---

## 13. Configuration

Environment (server-side only; see `.env.example`):

| Variable | Purpose |
|---|---|
| `STEEL_KEY` | Steel API key. |
| `CLAUDE_KEY` | Anthropic API key (compiler + agent). |
| `OPENROUTER_API_KEY` / `GROQ_API_KEY` / `OPENAI_KEY` | Speech API key for narration transcription, auto-detected in that order; optional. |
| `LOOP_SOLVE_CAPTCHA` | `1` to auto-solve captchas (paid Steel balance required). |
| `LOOP_HUMANIZE` | `1` for human-like mouse movement. |
| `LOOP_USE_PROXY` / `LOOP_PROXY_COUNTRY` | `1` to route through a Steel managed proxy, optionally geo-pinned. |
| `LOOP_PROXY_URL` | Custom proxy URL; overrides `LOOP_USE_PROXY`. |
| `LOOP_COMPILER_MODEL` / `LOOP_AGENT_MODEL` | Optional model overrides. |
| `LOOP_VISION_MODEL` | Optional vision-model override (defaults to the compiler model). |
| `LOOP_FAILED_SESSION_MS` | How long a failed run keeps its session open for takeover (default 300000). |
| `LOOP_DEMO_URL` | Optional default start URL when a recording opens with none. |
| `LOOP_WHISPER_KEY` / `LOOP_WHISPER_BASE_URL` / `LOOP_WHISPER_MODEL` | Optional overrides for any OpenAI-compatible speech endpoint. |

---

## 14. Development

```sh
nix develop          # node 24 + git + cloudflared, GIT_CONFIG_NOSYSTEM=1
npm install
npm run dev          # http://localhost:3000  (the workspace)
npm test             # unit tests: compiler, healing, narration, vision (node:test)
npm run typecheck    # tsc --noEmit
npm run build        # next build
npm run test:e2e     # browser E2E against a real Chromium (starts the app if needed)
```

`e2e/ui.mjs` drives the real UI in a real browser: it seeds data over the HTTP API, clicks
through the loops home, capture, review, delete, and run flows, and writes full-page
screenshots to `recordings/e2e/` for visual inspection. It builds and starts the app
automatically, and finds the nixpkgs Chromium on NixOS (`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
overrides).

`spike/` holds the de-risking scripts: `roundtrip.mjs` (the proven record→replay round trip),
`vision-locate.mjs` (vision-grounding), `product-e2e.mjs` and `seed-demo.mjs` (real-site
record→replay flows), and `release-all.mjs` / `stealth-check.mjs` (session hygiene).
`recordings/` holds runtime artifacts and is gitignored.

---

## 15. Known limitations

- **DOM/ARIA-first, vision as a fallback**: canvas/visual-only clicks can be healed at runtime by
  `lib/vision.ts` (Steel Computer + Claude), but the repair is not persisted and is corroboration-
  gated; image captchas are handled by Steel's auto-solver when `LOOP_SOLVE_CAPTCHA=1`, otherwise the
  run stops and hands off.
- **Voice narration is best-effort**: it depends on the local mic and an OpenAI-compatible speech
  API (Groq/OpenAI/OpenRouter); a missing key or transcription failure silently omits narration
  rather than failing the recording.
- **Main-frame recorder**: iframes, closed shadow DOM, file uploads, and drag-drop are not captured.
- **Selector fragility**: the locator chain helps, and ARIA self-healing repairs a broken locator
  (writing it back to the skill), but a DOM repair is not always possible — canvas/visual-only
  targets fall back to a runtime coordinate click, not a durable repair.
- **Loops are heuristic**: `loop: { each: true }` derives the repeated list at runtime from the
  recorded target's nearest structural ancestors. It can misfire on ambiguous layouts and is capped
  at `max` (default 25) items.
- **Schedules are stored, not fired**: only "Run now" executes.
- **Single-process state**: in-flight captures/runs live in `globalThis`; a restart drops them
  (persisted recordings/skills survive in SQLite).
