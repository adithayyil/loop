import { store } from '@/lib/store';
import ChatClient from './chat/ChatClient';

export const dynamic = 'force-dynamic';

export default function Home() {
  const base = process.env.LOOP_DEMO_URL?.replace(/\/$/, '');
  const defaultStartUrl = base ? `${base}/demo/vendor/login` : '';
  const skills = store.skills
    .values()
    .map((skill) => ({ id: skill.id, name: skill.name, trigger: skill.trigger }));

  return <ChatClient defaultStartUrl={defaultStartUrl} initialSkills={skills} />;
}
