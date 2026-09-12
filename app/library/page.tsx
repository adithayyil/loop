import Link from 'next/link';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default function LibraryPage() {
  const skills = store.skills.values();

  return (
    <main className="lp-page">
      <div className="lp-wrap wide">
        <div className="lp-head">
          <p className="lp-kicker">Library</p>
          <Link href="/" className="lp-backlink">
            ← Back to chat
          </Link>
        </div>
        <h1 className="lp-h1">Your loops</h1>
        <p className="lp-muted" style={{ fontSize: 13, marginTop: 6 }}>
          {skills.length === 0 ? 'Nothing here yet.' : `${skills.length} saved loop${skills.length === 1 ? '' : 's'}.`}
        </p>

        {skills.length === 0 ? (
          <div className="lp-empty-state">
            <p className="lp-kicker">No loops yet</p>
            <p>
              Record a task once. Replay it forever.
            </p>
            <Link href="/" className="lp-btn primary">
              Make your first loop →
            </Link>
          </div>
        ) : (
          <div className="lp-lib">
            {skills.map((skill) => (
              <div key={skill.id} className="lp-librow">
                <span className="lp-librow-name">{skill.name}</span>
                <span className="lp-chipmono">
                  {skill.trigger.type} · {skill.trigger.value}
                </span>
                <span className="lp-libmeta">{skill.steps.length} steps</span>
                <span className="lp-libmeta">
                  {skill.profileId ? (
                    <>
                      <span className="lp-authdot" />
                      saved login
                    </>
                  ) : (
                    'no login'
                  )}
                </span>
                <Link href={`/run/${skill.id}`} className="lp-btn small lp-run-cta">
                  Run →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
