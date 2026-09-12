import Link from 'next/link';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default function LibraryPage() {
  const skills = store.skills.values();

  return (
    <main className="container container-wide">
      <div className="topbar">
        <h1 style={{ fontSize: 24, margin: 0 }}>Library</h1>
        <Link href="/">Home</Link>
      </div>

      {skills.length === 0 ? (
        <p className="muted" style={{ marginTop: 16 }}>
          No loops yet. <Link href="/">Compile the sample recording</Link> to try the review flow.
        </p>
      ) : (
        <table className="table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Trigger</th>
              <th>Steps</th>
              <th>Auth</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {skills.map((skill) => (
              <tr key={skill.id}>
                <td style={{ fontWeight: 600 }}>{skill.name}</td>
                <td>
                  <code className="small">
                    {skill.trigger.type}: {skill.trigger.value}
                  </code>
                </td>
                <td>{skill.steps.length}</td>
                <td className="muted small">{skill.profileId ? 'saved login' : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <Link href={`/run/${skill.id}`} className="btn btn-small">
                    Run
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
