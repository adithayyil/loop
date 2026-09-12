import { store } from '@/lib/store';
import ChatClient from './chat/ChatClient';

export const dynamic = 'force-dynamic';

export default function Home() {
  const defaultStartUrl = '';
  const skills = store.skills
    .values()
    .map((skill) => ({ id: skill.id, name: skill.name, trigger: skill.trigger }));

  return <ChatClient defaultStartUrl={defaultStartUrl} initialSkills={skills} />;
}
