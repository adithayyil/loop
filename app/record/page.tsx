import RecordClient from './RecordClient';

export const dynamic = 'force-dynamic';

export default function RecordPage() {
  const base = process.env.LOOP_DEMO_URL?.replace(/\/$/, '');
  const defaultStartUrl = base ? `${base}/demo/vendor/login` : '';
  return <RecordClient defaultStartUrl={defaultStartUrl} />;
}
