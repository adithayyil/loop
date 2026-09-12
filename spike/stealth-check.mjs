import 'dotenv/config';
import { createSession, sessionConfig, steelClient } from '../lib/steel.ts';

console.log('sessionConfig() =', JSON.stringify(sessionConfig()));
console.log('LOOP_SOLVE_CAPTCHA =', process.env.LOOP_SOLVE_CAPTCHA ?? '(unset)');
console.log('LOOP_HUMANIZE =', process.env.LOOP_HUMANIZE ?? '(unset)');

const client = steelClient();
const session = await createSession(client, { timeout: 120_000 });
console.log('created session', session.id, '| status', session.status, '| stealth', JSON.stringify(session.stealthConfig));
await client.sessions.release(session.id);
console.log('released');
