// Autonomous agent recording -> compile -> save -> replay, against a live site.
import 'dotenv/config';

const BASE = 'http://localhost:3000';
const TUNNEL = process.argv[2];
if (!TUNNEL) throw new Error('usage: node agent-e2e.mjs <tunnel-origin>');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const goal =
  'Log in with username "vendor" and password "hunter2", then filter the invoice list to Unpaid and download the first unpaid invoice PDF.';

const kick = await fetch(`${BASE}/api/agent`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ goal, startUrl: `${TUNNEL}/demo/vendor/login` }),
});
const { runId } = await kick.json();
console.log('agent runId', runId, '| goal:', goal);

let record;
let lastStep = 0;
for (let i = 0; i < 150; i++) {
  await sleep(1000);
  record = (await (await fetch(`${BASE}/api/agent/${runId}`)).json()).run;
  if (!record) continue;
  for (const step of record.steps.slice(lastStep)) {
    console.log(`  ${step.n}. ${step.action} ${step.detail}${step.result ? `  [${step.result}]` : ''}`);
  }
  lastStep = record.steps.length;
  if (record.status !== 'running') break;
}

console.log('agent status', record.status, '| summary', record.summary, '| error', record.error);
console.log('recordingId', record.recordingId);

if (record.recordingId) {
  const { recording } = await (await fetch(`${BASE}/api/recordings/${record.recordingId}`)).json();
  console.log('compiled title:', recording.result.title);
  for (const s of recording.result.steps) {
    console.log(`  ${s.n}. ${s.text}${s.param ? ` [${s.param.mode}: ${s.param.name}]` : ''}`);
  }

  const saved = await (
    await fetch(`${BASE}/api/skills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recordingId: record.recordingId,
        name: recording.result.title,
        trigger: { type: 'phrase', value: 'download unpaid invoices' },
        steps: recording.result.steps,
        profileId: recording.profileId,
      }),
    })
  ).json();

  const run = await (
    await fetch(`${BASE}/api/skills/${saved.id}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    })
  ).json();
  let runRecord;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    runRecord = (await (await fetch(`${BASE}/api/runs/${run.runId}`)).json()).run;
    if (runRecord?.status !== 'running') break;
  }
  console.log('REPLAY status', runRecord.status, '| skipped', runRecord.result?.skipped, '| files', JSON.stringify(runRecord.result?.files));
  console.log(record.status === 'done' && runRecord.status === 'done' ? 'AGENT-E2E: PASS' : 'AGENT-E2E: check above');
}
