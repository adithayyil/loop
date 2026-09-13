import { store } from '@/lib/store';
import { LoopsHome } from './components/loops-home';

export const dynamic = 'force-dynamic';

export default function LoopsPage() {
  const loops = store.skills.values().map((skill) => ({
    id: skill.id,
    name: skill.name,
    trigger: skill.trigger,
    stepCount: skill.steps.length,
    hasProfile: Boolean(skill.profileId),
  }));

  return <LoopsHome loops={loops} />;
}
