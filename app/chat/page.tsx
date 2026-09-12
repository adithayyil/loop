import { store } from '@/lib/store';
import ChatClient from './ChatClient';

export const dynamic = 'force-dynamic';

export default function ChatPage() {
  const base = process.env.LOOP_DEMO_URL?.replace(/\/$/, '');
  const defaultStartUrl = base ? `${base}/demo/vendor/login` : '';
  const skills = store.skills
    .values()
    .map((skill) => ({ id: skill.id, name: skill.name, trigger: skill.trigger }));

  return <ChatClient defaultStartUrl={defaultStartUrl} initialSkills={skills} />;
}
