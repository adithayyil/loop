import Link from 'next/link';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default function LibraryPage() {
  const skills = store.skills.values();

  return (
    <main className="dk-page loop-dark">
      <div className="dk-wrap wide">
        <div className="dk-head">
          <h1 style={{ fontSize: 24, margin: 0 }}>Library</h1>
          <Link href="/" className="dk-link">
            Back to chat
          </Link>
        </div>

        {skills.length === 0 ? (
          <p className="dk-muted" style={{ marginTop: 16 }}>
            No loops yet. <Link href="/">Open the chat</Link> to make one.
          </p>
        ) : (
          <table className="dk-table" style={{ marginTop: 16 }}>
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
                    <code style={{ fontSize: 12 }}>
                      {skill.trigger.type}: {skill.trigger.value}
                    </code>
                  </td>
                  <td>{skill.steps.length}</td>
                  <td className="dk-muted" style={{ fontSize: 12 }}>
                    {skill.profileId ? 'saved login' : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link href={`/run/${skill.id}`} className="dk-btn small">
                      Run
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
