import 'dotenv/config';
import Steel from 'steel-sdk';

const client = new Steel({ steelAPIKey: process.env.STEEL_KEY });
const explicit = process.argv.slice(2);
if (explicit.length) {
  for (const id of explicit) {
    const res = await client.sessions.release(id).catch((e) => ({ error: e.message }));
    console.log('release', id, JSON.stringify(res));
  }
}
try {
  const sessions = await client.sessions.list();
  const live = (sessions.sessions ?? []).filter((s) => s.status === 'live');
  console.log('live sessions:', live.map((s) => s.id).join(', ') || 'none');
  for (const s of live) {
    await client.sessions.release(s.id).catch(() => {});
  }
  if (live.length) console.log('released', live.length);
} catch (e) {
  console.log('list failed:', e.message);
}
