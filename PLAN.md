# loop — build plan

**"Show it once, it does it forever."** Record a browser task once, get an editable
plain-language step list, mark what changes each run, name it, and it runs on demand or
on a schedule in a Steel cloud browser.

This file is the single source of truth for the 24hr build. It is updated as decisions
change and as work lands — see the [build log](#build-log) at the bottom.

---

## 1. Product flow (locked)

1. **Hit record** — a record button/hotkey starts capture. DOM events (clicks, inputs,
   navigation) are the source of truth for replay; a video of the session exists for
   human review only. Optional voice narration for intent DOM can't capture.
2. **Do the task normally** — no wizard, no special mode.
3. **Stop → plain-language step list** — inferred steps ("1. Log into vendor.com,
   2. Go to Invoices, 3. Filter by Unpaid, 4. Download each PDF"), not raw events.
   This is the trust checkpoint.
4. **Mark parameters** — click any value in a step → "changes each time" vs
   "always the same", with pre-filled guesses (mostly confirmation, not typing).
5. **Name it + set a trigger** — an invocation phrase, or a schedule.
6. **First run: watch it live** — Steel live session viewer by default; silent after.

## 2. The key architectural decision: record inside a Steel session

The original framing has capture happening via a browser extension in the user's own
browser. For the 24hr build we instead **record inside a Steel cloud session that the
user drives through Steel's interactive live viewer**, embedded in our web app.

Why this is right for the hackathon (and arguably right, period, for v1):

- **One infrastructure for record and replay.** The recorded session and every replay
  are both Steel sessions: same selectors, same rendering, no "worked on my machine"
  gap between capture and execution.
- **Auth reuse comes free.** `persistProfile: true` on the recording session → the
  resulting `profileId` (cookies, localStorage) is attached to every replay session.
  The user logs in once during recording; replays are already authenticated.
  (Profiles: 300MB cap, auto-expire after 30 days unused — fine for a demo.)
- **The video comes free.** Headful Steel sessions are recorded to MP4, retrievable as
  HLS (`GET /v1/sessions/{id}/hls`). That *is* the "low-fps screen video for human
  review" — we capture zero video ourselves.
- **No extension to build/debug.** A Chrome extension with event capture, backend
  sync, and auth transfer to the cloud is easily 8+ hours alone.
- **Downloads come free.** Browser downloads land in the session's Files API
  (`client.sessions.files.list/download`) — the invoice-PDF flow needs no plumbing.

The cost: recording happens in our web app (an embedded cloud browser), not the user's
daily browser. For a demo this is a feature — the cloud browser *is* the pitch. The
local-extension capture path is the post-hackathon direction and is noted as such.

### End-to-end shape

```
Next.js app (one repo, one process, App Router, SQLite via better-sqlite3)

Env (see `.env.example`; real values in `.env`, gitignored, server-side only):
`CLAUDE_KEY` (Anthropic — event→step compiler, replay fallback agent),
`STEEL_KEY` (Steel — sessions/profiles/files; never client-side, never logged).
|
+-- /record          "Record" -> POST /api/recordings
|                      -> steel.sessions.create({ persistProfile: true,
|                           debugConfig: { interactive: true }, timeout: 15min })
|                      -> render <iframe src={debugUrl?interactive=true}>  (user drives)
|                      + floating record bar: timer / stop (Loom pattern)
|                  Meanwhile, server connects Playwright over CDP to the SAME session
|                  (wss://connect.steel.dev?apiKey=...&sessionId=...) and injects an
|                  event recorder -> NDJSON event log (click/input/navigate + selector
|                  candidates + accessible name + value + timestamp + url)
|
+-- stop             -> POST /api/recordings/:id/stop
|                      -> release Steel session (profileId now available)
|                      -> compile: events (+ narration transcript) -> LLM ->
|                         structured step list JSON with parameter guesses
|
+-- /review/:id      THE screen (see §6): numbered step cards, inline edit/delete/
|                     merge, click-a-value -> parameter pill, Undo-all to raw capture
|
+-- save             -> name + trigger (phrase | schedule) + profileId + compiled
|                     Playwright step spec  =>  skill row in SQLite
|
+-- /run/:skillId    -> resolve params ("changes each time" -> Ask Each Time prompt)
|                      -> steel.sessions.create({ profileId, debugConfig.interactive })
|                      -> execute compiled Playwright steps over CDP
|                      -> live watch page: iframe + states Running / Needs you / Done
|                      -> on done: list downloaded files (Files API), link recording
|
+-- library          -> list of skills: name, trigger, last run, run-now button
```

**Skill artifact** (the "structured semantic representation" — bit's index analogue):

```json
{
  "id": "...", "name": "Download unpaid invoices",
  "trigger": { "type": "phrase", "value": "download unpaid invoices" },
  "profileId": "steel-profile-...",
  "steps": [
    { "n": 1, "text": "Log into vendor.com", "action": "login", "url": "https://vendor.com" },
    { "n": 3, "text": "Filter by {{status}}", "action": "click",
      "selector": {"css": "...", "role": ["button", "Unpaid"], "text": "Unpaid"},
      "param": { "name": "status", "mode": "fixed", "default": "Unpaid" } }
  ],
  "sourceRecordingId": "..."
}
```

## 3. Where bit's vision approach earns a role — honestly

bit's transferable idea is the *pipeline shape*: raw signal → structured semantic
representation → queryable index, with fidelity gates and abstention. loop's analogue:
raw signal (DOM events + narration + video) → step list → skill library. The CLIP
machinery itself mostly does **not** transfer:

| Step | DOM events enough? | Vision/CLIP role |
|---|---|---|
| 1–2 Capture | **Yes.** Events are the replay source of truth. | None. Steel records the review video for us; no encoding pipeline needed. |
| 3 Step inference | **Yes, plus page context** (URL, title, accessible names already in events/traces). | None justified. An LLM reads the event stream; pixels add nothing an accessible name doesn't. |
| 4 Parameters | Yes. Values are in the events. | None. |
| 5 Triggers | Yes. | None. |
| 6 Live watch | Yes (Steel viewer). | None. |
| Voice narration | — | **bit's speech path, honestly applied:** narration is the one channel DOM can't replace ("download these because accounting needs them by Friday"). 24hr version: Whisper API call, not a local model — no GPU work, no fidelity gates. Optional; cut first if behind. |
| Replay self-healing (stretch) | Selectors break on dynamic sites. | The *one* place vision earns real keep: on selector failure, screenshot + VLM ("find the Unpaid filter") to recover. **Stretch goal only** — not in the core demo path. |

**On CLIP specifically:** the tempting use — aligning review-video moments to steps à
la bit's chunk index — is already solved for free: every DOM event carries a timestamp,
and Steel's own dashboard jumps video-to-trace the same way. Shipping CLIP here would
be solving a solved problem. Verdict: **no CLIP in the 24hr build**; the concept
transfers, the model doesn't.

## 4. Mock vs. build-for-real (24hr scope)

**Build for real (the demo path):**
- Steel session create/release from the app; interactive live-viewer embed for recording
- CDP event capture → NDJSON log (with agent-traces API as comparison — see §5)
- LLM compiler: events → structured step list + parameter guesses (one prompt,
  JSON-schema output, fixture-tested)
- Review screen: step cards, inline edit/delete, click-value→pill parameterization
- Save: name + phrase trigger + profileId, SQLite store
- Runner: param prompt → fresh Steel session w/ profile → compiled Playwright replay →
  live watch page → downloaded-files list
- Library screen with run-now

**Mock / stub (honestly labeled in the demo):**
- **Scheduling** — store the cron expression, render it in the library, but only
  "run now" actually executes. (A node-cron worker is a 30-min add if time allows.)
- **Phrase trigger** — exact-match command palette in the app, not NL intent matching.
- **Voice narration** — record button present; either wired to Whisper API late or
  demoed with typed notes. Intent context is nice, not load-bearing.
- **"Undo all" to raw capture** — keep the raw event log and a "view original events"
  toggle; full Scribe-style revert is stretch.
- **Multi-item loops** ("download *each* PDF") — demo flow downloads the first match;
  iteration is the stretch goal.
- **Login** — user logs in during the recording inside the Steel session; no
  credentials-API auto-injection (it's beta; profile reuse covers the demo).

## 5. The riskiest unknown, and the hour-1 spike

**Risk: the replay round-trip.** Everything depends on: capture human actions in a
Steel session → compile → replay reliably in a *fresh* session. Two sub-unknowns:

1. **Do Steel Agent Traces capture human input from the interactive live viewer?**
   Docs don't say. If yes, Steel's trace API (`GET /v1/sessions/{id}/agent-traces`,
   which already emits `selector.css` + accessible name + role per event) *is* our
   recorder and we write zero injection code. If no, we inject our own recorder over
   CDP (`addInitScript` + re-inject on navigation, events streamed to the server).
2. **Do recorded selectors survive a fresh session?** If CSS selectors churn,
   role/accessible-name locators (Playwright `getByRole`) become primary, CSS the
   fallback. Trace data already carries both.

**De-risk first, before any UI work (timebox 90 min):**
- Create a session via API; open the debugUrl in a browser tab; manually do a 3-step
  task (e.g., search HN + open a story, or a demo form site).
- Pull agent-traces; check whether those human actions appear with selectors.
- Simultaneously connect Playwright over CDP and verify injected recording works
  (the fallback — build it regardless of outcome, it's the controlled path).
- Hand-write a Playwright replay from the captured selectors; run in a fresh session.
- Exit criteria: one human-performed task replayed unattended end-to-end.

Secondary risk: LLM event→step inference quality. De-risk with a saved event fixture
and prompt iteration offline, decoupled from live Steel sessions.

**Pre-booked fallback** (decide by hour ~8): if deterministic codegen proves flaky,
runner becomes an LLM agent executing the step list as guardrails (Steel skills are
installed for exactly this). Less deterministic, still demoable, keeps every other
screen unchanged.

## 6. UI/UX plan (from the shipped-patterns research)

Guiding idiom (2025–26 agent tools): **structured artifact in the center, thin rail on
the side — no chat-first layout, no node canvas.** Approval is always an explicit
button, never a chat reply. Original capture is always the source of truth.

| # | Screen | Pattern copied from | Concrete design |
|---|---|---|---|
| 1 | Record start | Loom | Library/record page → big Record button → creates session → cloud browser iframe takes over the screen. |
| 2 | During capture | Loom | Floating bar only: red dot, timer, Stop. Nothing else overlays the task. |
| 3–4 | **Review + parameters (ONE screen)** | Scribe Magic Edit + Zapier pills + Shortcuts "Ask Each Time" | Processing state (read-only) → numbered step cards: plain-language text, inline edit on click, per-step delete/merge, "view original events" expander. Values render as **pills**: click a pill → menu: "Changes each time" (blue, prompts at run) / "Always the same" (grey, baked in). LLM pre-marks guesses; header shows "2 values change each run". Explicit **[Looks good — save it]** button + "keep refining" path. |
| 5 | Name + trigger | IFTTT recipe card | One compact save card: name field, trigger toggle (phrase input \| schedule picker), one-sentence summary of the loop. |
| 6 | First-run watch | OpenAI Operator + Browserbase | Full-width live view, default read-only + a **Take over** button ("we don't see what you type" energy). State banner: **Running** / **Needs you** (reason shown) / **Done**. End card: files downloaded + recording link + "Next runs will be silent." |
| — | Library | — | Simple table: name, trigger, last-run status, Run button. Utility, not a showcase. |

**Highest-leverage screen to polish: the step 3–4 review screen.** It's where "show it
once, it does it forever" is proven or disproven — the trust checkpoint *is* the
product. It fuses two well-documented patterns (Scribe's step review, Zapier's pill
parameterization) with no single incumbent, so it's where loop looks original, and it
demos legibly in <30s. Second priority: the run-watch state transitions (the emotional
payoff) — but they only land if review already earned trust.

Anti-patterns enforced: no chat-based approval; no node canvas; no "regenerate" as the
primary edit (edit in place; regeneration destroys review progress); trace defaults
collapsed; takeover visibly privacy-preserving.

## 7. Hackathon engineering practices (the ones that actually fit)

- **Vertical slice before breadth.** One golden path — record a ~4-step task → review →
  save → replay watched live — working end-to-end before *any* polish. Chosen demo
  flow: log in to **our own self-hosted invoice demo app** (routes inside the same
  Next.js project: login, invoice list, unpaid filter, PDF download — decided in the
  spike after SauceDemo proved hostile to automation), filter unpaid, download a PDF.
- **Golden-path discipline.** Hardcode assumptions shamelessly (one site, first-match
  download). Generalize only after the slice runs. Every "wouldn't it be nice" goes in
  this file's parking lot, not the code.
- **main is always demo-able.** Small commits straight to main per working slice; tag
  known-good states (`demo-1`, `demo-2`). Feature branches only for work that would
  break the demo path, merged same-hour. No long-lived branches at 24hr scale.
- **Canned fixtures early.** Save the first good recording's event NDJSON + expected
  step list as a fixture. All UI/compiler work then runs without live Steel sessions —
  and it's the fallback if the live demo's network dies. Record a full-flow backup
  video once the slice works.
- **Test only what's load-bearing:** the event→step compiler (fixture in, steps out),
  selector-strategy fallback logic, codegen snapshot. No tests for glue, UI, or API
  plumbing. `tsc` clean is the CI.
- **Timebox spikes** (90 min for the Steel round-trip) and log outcomes here. If a
  spike fails, take the pre-booked fallback — no silent retries.
- **Steel free-tier hygiene:** 15-min max session, 10 concurrent, 60 req/min. Set
  `inactivityTimeout`, release aggressively, never leave sessions running. Keys live
  in `.env` (`STEEL_KEY`, `CLAUDE_KEY` — gitignored, `.env.example` documents them),
  server-side only, never printed or committed.
- **Env gotcha (this machine):** Nix system gitconfig rewrites GitHub HTTPS→SSH and
  breaks subprocess `git clone` (hit during Steel setup). Prefix such commands with
  `GIT_CONFIG_NOSYSTEM=1`.
- **Demo script written by hour 20**, rehearsed twice, with the canned-fixture fallback
  path scripted too.

## 8. Timeline (24hr sketch)

| Hours | Work |
|---|---|
| 0–2 | §5 spike: Steel round-trip de-risk. Exit: one task replayed unattended. |
| 2–6 | Capture pipeline (CDP recorder, NDJSON log) + compiler on the golden path. |
| 6–10 | Review screen: step cards + parameter pills. |
| 10–14 | Runner: param prompt, replay, live watch, files list. **Slice complete ~H14.** |
| 14–18 | Save/name/trigger, library, profile auth reuse verified. |
| 18–22 | Polish review screen; stretch (multi-item loop, Whisper, cron worker) in that order; backup demo video. |
| 22–24 | Demo script, rehearsal, freeze. |

## 9. Spike results (hour 0–1.5, 2026-09-12) — ROUND TRIP PROVEN

**Exit criteria met: full record → compile → replay round trip passes unattended**
(`spike/roundtrip.mjs`, TodoMVC/React: recorded 6 events via our injected recorder,
compiled to 5 actions, replayed in a fresh Steel session, end state verified
`#/active` + correct todo visible, `recordings/roundtrip-proof.png`).

Answers to the open questions:

- [x] **Agent traces DO capture human input from the interactive viewer.** 24 events
      from ~60s of human driving, each with `selector.css/id/testId/name/aria`, role,
      accessibleName, boundingBox. **But values are redacted** (`change` events carry
      `valueLength`, not the value) — privacy-preserving by design.
      → **Decision: injected CDP recorder is the primary capture** (replay needs
      values; parameters need values). Traces are a free corroboration layer and
      power the post-hoc review timeline.
- [x] **debugUrl format:** `https://api.steel.dev/v1/sessions/{id}/player`. Not yet
      iframe-embedded (viewer test used it directly) — verify in H2–6 capture work.
- [x] **Locator chain works:** testId → id → role+accessibleName → css. Role+name was
      exercised for real (filter link replayed via `getByRole('link', {name})`).
- [x] **No human/automation control lock** — app-side coordination only (unchanged).
- [ ] `sessionViewerUrl` vs `debugUrl` — still unchecked, low priority.

**Major finding — third-party demo sites can be cursed:** SauceDemo accepts human
input via the Steel viewer but silently drops ALL automation input post-login
(Playwright clicks, raw CDP input, trusted keyboard — verified via window-level
capture listeners seeing zero events; direct React `onClick` invocation works;
navigations and native form submits work). Same clicks work fine on a hand-built
React page and TodoMVC in Steel. Strongly smells like deliberate automation
detection (Sauce Labs sells a testing platform).
→ **Decision: self-host the demo site.** The golden-path "vendor.com" invoice app is
a small set of routes inside our own Next.js app (login, invoice list, unpaid
filter, PDF download). Fully reproducible, no third-party flakiness, works on stage
wifi. This is now in scope (was: use a public demo site).

**Bugs/lessons caught by the spike:**
- Recorder field collision (`type` from element info overwrote event type) — fixed;
  namespace all recorder payloads (`inputType`).
- Background processes: the shell kills process groups on timeout — launch
  long-lived recorders with `setsid`, not bare `nohup &`.
- Post-click settle: navigation wait + short networkidle covers React re-render;
  300–500ms fixed waits sufficed on TodoMVC.

**Steel usage note:** each debug iteration leaked one 5-min session on failure paths;
release in `finally` from here on.

## 10. Parking lot (post-hackathon)

- Local Chrome-extension capture in the user's own browser + credentials-API auth
  transfer (Steel Credentials API, beta, supports TOTP)
- Vision-based replay self-healing (screenshot + VLM on selector failure)
- NL trigger matching; real scheduling service; multi-user
- Full Scribe-style undo/regenerate; loop detection for "download *each*" flows

---

## Build log

| Time (2026-09-12) | Entry |
|---|---|
| ~14:50 | Steel CLI v0.4.4 verified: auth OK (key already in config), `doctor --preflight` passes, scrape works, live cloud-browser demo to HN + snapshot + clean stop. 5 steel-* agent skills installed globally (auto-load next OpenCode restart). Workaround noted: `GIT_CONFIG_NOSYSTEM=1` for subprocess git clones. |
| ~15:00 | Research done: bit ARCHITECTURE.md read; Steel docs (sessions, profiles, HITL, traces, files, pricing) via docs + local skills; UI/UX patterns (Scribe, Zapier, Operator, Loom, Claude Code, Devin, n8n). Key finding: record *inside* a Steel session via interactive viewer — unifies record/replay infra, free video, free downloads, free auth reuse. |
| ~15:05 | PLAN.md v1 written: architecture, vision-vs-DOM verdict (no CLIP in 24h), mock-vs-real scope, riskiest unknown (replay round-trip) + 90-min spike plan, per-step UI plan (review screen = highest leverage), hackathon practices, 24h timeline. **Status: planning done, nothing built yet. Next: hour-0 spike.** |
| ~15:25 | `.env` populated with `CLAUDE_KEY` + `STEEL_KEY`; added `.env.example` (documents both, no values) and `.gitignore` (`.env`, node_modules, SQLite, recordings). Env contract recorded in §2 and §7. |
| ~17:15 | **SPIKE DONE — round trip PROVEN.** Traces capture human viewer input (values redacted) → injected CDP recorder is primary, traces corroborate. Replay compiles + executes unattended in a fresh session (TodoMVC/React, PASS). SauceDemo blocks automation input post-login → decision: self-host the invoice demo app inside our Next.js project. Recorder bug found+fixed (field collision). Locator chain validated. Spike scripts in `spike/`, artifacts in `recordings/`. **Next: H2–6 capture pipeline + compiler.** |
| ~16:45 | **H2–6 landed (first slice of it).** Nix flake (node 24 + git, `GIT_CONFIG_NOSYSTEM=1`) + `.envrc` (`nix develop` works; locked). Next.js 15 App Router scaffolded in-repo; **pinned `typescript@^6`** (Next 15.5 rejects the TS7 native compiler). Self-hosted invoice demo app at `/demo/vendor` verified end-to-end: login (303 + cookie), list, `?status=unpaid` filter, PDF download (native form + stable `data-testid`s, automation-friendly). Capture pipeline extracted to `lib/capture.ts` + `lib/recorder.ts` (Steel `persistProfile` session, CDP injection, NDJSON backup, profile looked up by `sourceSessionId`). Compiler: deterministic `normalize()` (collapse focus clicks, dedupe checkbox change, flush fills before submit, emit gotos) + injectable LLM inferer (`lib/anthropic.ts`, forced tool call, locators bound back to recorded actions, param guesses). API: `POST /api/recordings`, `POST|GET /api/recordings/[id][/stop]`, `POST /api/compile` (offline fixture path). **Verified:** `tsc` clean, `next build` green, 4/4 fixture tests pass, real Claude call on the TodoMVC fixture yields correct 5-step list with variable params. Store is **in-memory** (`lib/store.ts`) for now — SQLite is a later swap. Deviation from §2: `node:sqlite` (built into node 24) will replace `better-sqlite3` to avoid native builds. **Blocker noted: the Steel cloud browser can't reach `localhost`, so a live round-trip needs a public URL (tunnel/deploy) for the demo app. Next: review screen + replay runner.** |
| ~17:35 | **REVIEW + RUNNER + LIVE ROUND TRIP LANDED.** Review screen `/review/[id]`: numbered step cards, inline edit, merge/delete, "view original events" expander, value pills (blue "changes each time" / grey "always the same") with param rename and a "N values change each run" header; save card (name + phrase/schedule trigger) → SQLite-pending in-memory store. Library `/library` + run screen `/run/[id]` with "Ask each time" param inputs and Done/Needs-you banner. `lib/replay.ts` runner: locator chain testId→role+name→css→text, profile reuse, Files API download listing. **Public-URL blocker resolved:** added `cloudflared` to the flake; a quick tunnel exposes the demo app and the Steel cloud browser reaches it (verified). Login route now builds redirects from `x-forwarded-*` (was emitting `localhost:3000`, which broke the tunneled browser). Capture registry moved to `globalThis` — Next gives each route its own module instance, so the stop route couldn't see the create route's session. **Live E2E via the real API passed:** record → compile → save → replay in a fresh session; 13 events recorded, login steps auto-tagged `skipIfAuthenticated` (3 skipped because the saved profile was still logged in), 5 steps ran, PDF downloaded from the Files API (622 bytes). **Next: live watch page (stream the Steel player while a background run executes) + SQLite + polish.** |
| ~17:55 | **LIVE-WATCH RUNNER LANDED.** `POST /api/skills/[id]/run` now starts the run in the background and returns a `runId` immediately; `GET /api/runs/[id]` is polled at 1 Hz by the run screen. Run page embeds the Steel player iframe (verified embeddable: no `X-Frame-Options`, no CSP) with a "Take over in a new tab" link and Running/Done/Needs-you banner; end card lists downloads + "Next runs will be silent." Sessions are held ~4 s after completion so the viewer shows the end state, then released. **Bug fixed:** Steel drops session files on release and `files.download` wants the bare file id, not the `/files/...` list path — downloads are now cached to `recordings/downloads/<runId>/` before release and served via `/api/downloads/[runId]/[name]` (verified: 200, 622 bytes, `%PDF`). Byte-deterministic tail: live-watch E2E passed twice. `tsc` clean, 4/4 tests, `next build` green. **Next: SQLite persistence, then polish the review screen + backup demo video.** |
| ~18:00 | **SQLITE + POLISH + BACKUP VIDEO.** Persistence moved from in-memory maps to SQLite via **`node:sqlite`** (`lib/db.ts`, JSON-blob tables for recordings/skills; `lib/store.ts` now a thin re-export). Verified: skill survives a dev-server restart. Design pass: added `app/globals.css` (zinc/blue system, cards, pills, segmented control, banners, viewer) imported in the root layout; refactored review/run/library/home off inline styles; review screen now shows a "click a value…" helper, checkmarked pill menu, and on save a "Run it now →" handoff straight into the live-run page. Backup demo video recorded from the Steel session HLS via `ffmpeg` → `recordings/backup-demo.mp4` (18.75 s, 1920×1080, 938 KB) — a genuine cloud-browser run of the golden path, independent of the app UI. `tsc` clean, 4/4 tests, `next build` green, no leaked sessions. **Remaining: record-screen UX (paste/tunnel URL or deploy), multi-item loop, Whisper narration, demo script + rehearsal.** |
| ~18:15 | **RECORD SCREEN LANDED.** `/record` closes the loop from the top: Start URL field (prefilled from `LOOP_DEMO_URL`), Record button → creates the Steel session and takes over the screen with the interactive viewer, and the Loom-style floating bar (red dot, `mm:ss` timer, Stop). Stop releases the session, compiles, and routes straight to `/review/[id]`. When no public URL is configured it shows the tunnel hint. DX: `npm run tunnel` (cloudflared from the flake) + documented `LOOP_DEMO_URL`. Home now leads with **Record a task**, with the sample-compile path as the no-browser fallback. **Re-verified the whole pipeline live with the SQLite/polish code:** record → compile → save → background run → live viewer → cached download (`%PDF`, 622 bytes) — LIVE-WATCH PASS, no leaked sessions. `tsc` clean, 4/4 tests, `next build` green. |
| ~18:30 | **STEALTH / CAPTCHA WIRED (opt-in).** Session creation centralized in `lib/steel.ts` (`steelClient`/`sessionConfig`/`createSession`) and shared by capture + replay. `LOOP_SOLVE_CAPTCHA=1` sets `solveCaptcha` + `stealthConfig.autoCaptchaSolving`; `LOOP_HUMANIZE=1` sets `stealthConfig.humanizeInteractions`. Verified live: **humanize works on the free tier; captcha solving is gated by Steel** ("Launch requires at least $10 in paid balance to use CAPTCHA solving or Steel proxies"). `createSession` therefore degrades gracefully — on the 403 it logs a warning and retries without captcha (humanize retained), so a flag without credits can't break the demo. Replay no longer re-persists the profile (`persistProfile: false`). Note for the answer to "any website": captcha solving ≠ automation detection; SauceDemo's dropped input is the latter, where humanize/stealth helps. |
| ~19:15 | **AUTONOMOUS AGENT RECORDING — GOAL → REPLAY WORKS.** New `lib/agent.ts`: a Claude tool-loop drives the Steel browser one action at a time from a natural-language goal, observing with Playwright `ariaSnapshot({ mode: 'ai' })` and acting by role+accessible-name (fallback label/placeholder/text), so it emits exactly the locators our replay already understands. It injects the same DOM recorder, so agent actions compile through the identical pipeline. Tools: goto/click/type/select/press/scroll/wait/done/fail, `tool_choice:any`, max 15 steps, anti-destructive system guardrail. API `POST /api/agent` (background) + `GET /api/agent/[id]`; record screen now has an "I'll show it / Let the agent do it" toggle with a goal field, live viewer, and per-action log; on completion it routes to the existing review screen. **Live E2E PASS:** goal "log in, filter Unpaid, download first PDF" → agent did it in 6 actions unaided → compiled to 8 steps (login tagged skip-if-auth) → saved → deterministic replay with saved profile (3 skipped, PDF 622 bytes). Bug fixed: agent route flipped status to `done` before compile finished, racing the poller — terminal status now set only after the recording exists. `tsc` clean, 4/4 tests, `next build` green. **Caveat: DOM/ARIA-first — vision fallback for canvas/visual-only UIs is the next increment.** |
| ~19:45 | **DARK CHAT UI.** `/chat` is now the primary surface: full-bleed dark shell (fixed inset, near-black + indigo/violet gradient accent) with a left sidebar (brand, New task, saved loops list, library/record/demo links), a top "Site" URL bar, and a chat thread. Messages: gradient user bubbles, assistant avatar + status line (animated pulse dot for Working/Done/Needs-you). Agent actions stream in as an animated tool timeline (`action` chip + detail + result). The Steel live viewer embeds inline while the run is going. On completion a card shows "Captured N actions" with **Review & save →** into the existing review screen; saving refreshes the sidebar list. Empty state has one-tap suggestion chips; composer is an auto-focus dark field with Enter-to-run / Shift+Enter newline and a gradient send button; graceful "set a site URL first" guard. Home now leads with **Open chat**. Verified `/chat` renders (shell, composer, empty state) and CSS ships; `tsc` clean, 4/4 tests, `next build` green. |
| ~20:20 | **CAPTCHA HARD-STOP + FILTER.** A live agent run on Google search hit reCAPTCHA and flailed ~16 steps clicking tiles, producing a 24-step review full of captcha noise. Two fixes: (1) `lib/agent.ts` detects a bot challenge (`/sorry`, recaptcha/hcaptcha/turnstile markers, `#recaptcha-verify-button`, challenge iframes) after the initial navigation and after every action, then stops with a clear "solve it in the live view or enable LOOP_SOLVE_CAPTCHA with paid balance" message instead of clicking on; (2) `lib/compiler.ts` drops challenge interactions (and challenge URLs, including the leading goto) in `normalize()` so they never reach review/replay. Added a fixture test (5/5 pass). Recompiled the existing recording `39558d07` in SQLite in place: 24 steps → 8 clean steps. |
| ~21:10 | **UX REDESIGN — chat is the app, flat, no gradients.** Researched current agentic-UX patterns (activity panel separate from thread, progressive disclosure, chips that prefill, smart auto-scroll, single accent). Rewrote the chat: `/` now renders it directly (`/chat` 307-redirects to `/`), removed the old home. Flat dark palette, zero gradients (single indigo accent used only on the user bubble, send button, New task, and focus ring). Activity is now a collapsed panel by default (`N actions`) that opens to the step log; the live Steel viewer renders inline only while running and disappears when done. Added smart auto-scroll (only when near the bottom), auto-resizing textarea, Enter/Shift+Enter, suggestion chips that prefill the composer, a "Try again" retry on failure, and responsive sidebar. `tsc` clean, 5/5 tests, `next build` green; all other pages still render. **Note: these changes are not yet committed.** |
| ~21:40 | **AGENT GUARDRAILS + MANUAL RECORDING IN CHAT.** A run on GitHub ("is there a readme?") scrolled forever and leaked a session. Fixes: agent now has a 2-min time budget, **stuck detection** (same action 3× in a row → stop with "got stuck repeating 'scroll'"), a real **Stop** (`AbortController` per run, `DELETE /api/agent/[id]`), and a prompt that says answer from the visible page / stop scrolling. Live-verified: the same GitHub goal now stops after two scrolls with a clear "Needs you". Manual recording is folded into the chat as a mode: the sidebar link / "Record it myself" toggle opens a live browser inline with a Stop bar, then drops a "Recorded N actions → Review & save" card into the same thread; the `/record` page is gone (`/record` → 404, redirect `/chat` → `/`). Stop button replaces Send while the agent runs. tsc clean, 5/5 tests, build green, no leaked sessions. |
| ~22:10 | **NO URL GATE — open a browser, then type the URL.** Removed the required "Site" top bar. The chat now has an "Open a browser" action (empty state + sidebar + mode toggle) that starts a blank Steel session and drops an inline browser card with an **address bar**: type a URL + Enter → `POST /api/recordings/[id]/navigate` drives the live session, then Stop compiles the captured steps into a loop. `startRecording` no longer requires `startUrl` (blank by default); the last URL you visit is also used as the agent's start page, so "Ask the agent" works without typing a URL up front. Verified: open blank → navigate to example.com → stop → 1-step skill. tsc clean, 5/5 tests, build green, no leaked sessions. |
| ~22:40 | **COMPILE LOADING STATE + DARK REVIEW/RUN/LIBRARY.** Stopping a recording now immediately swaps the live viewer for an inline loading panel (spinner + skeleton step rows + "Turning your recording into steps…") while compile runs, and blocks new actions until it finishes. Shared dark palette extracted to a `loop-dark` class; rewrote `/review/[id]` (step cards, value pills, save card), `/run/[id]`, and `/library` on the dark theme so nothing looks like the old light UI. `tsc` clean, 5/5 tests, build green. |
