import Link from 'next/link';
import HomeActions from './HomeActions';

export default function Home() {
  return (
    <main className="container">
      <h1 style={{ marginBottom: 0 }}>loop</h1>
      <p className="muted" style={{ marginTop: 4 }}>Show it once, it does it forever.</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 20, flexWrap: 'wrap' }}>
        <Link href="/chat" className="btn btn-primary">
          Open chat →
        </Link>
        <Link href="/record" className="btn">
          Record a task
        </Link>
        <span className="muted small">or try it without a live browser:</span>
        <HomeActions />
      </div>

      <ul className="muted" style={{ marginTop: 28, lineHeight: 2 }}>
        <li>
          <Link href="/library">Library</Link>
        </li>
        <li>
          <Link href="/demo/vendor">Invoice demo app (vendor.com)</Link>
        </li>
      </ul>
    </main>
  );
}
