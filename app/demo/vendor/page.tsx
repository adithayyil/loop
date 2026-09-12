import Link from 'next/link';
import { redirect } from 'next/navigation';
import { filterInvoices, isLoggedIn } from '@/lib/demo-data';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isLoggedIn())) redirect('/demo/vendor/login');
  const sp = await searchParams;
  const status = typeof sp.status === 'string' ? sp.status : undefined;
  const invoices = filterInvoices(status);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '48px auto' }}>
      <h1 style={{ fontSize: 24 }}>Invoices</h1>
      <nav style={{ display: 'flex', gap: 12, margin: '16px 0' }}>
        <Link href="/demo/vendor">All</Link>
        <Link href="/demo/vendor?status=unpaid">Unpaid</Link>
        <Link href="/demo/vendor?status=paid">Paid</Link>
      </nav>
      <table
        data-testid="invoice-table"
        style={{ width: '100%', borderCollapse: 'collapse' }}
      >
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th>Invoice</th>
            <th>Vendor</th>
            <th>Amount</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} data-testid={`invoice-row-${inv.id}`} style={{ borderBottom: '1px solid #eee' }}>
              <td>{inv.number}</td>
              <td>{inv.vendor}</td>
              <td>${inv.amount.toFixed(2)}</td>
              <td>{inv.status}</td>
              <td>
                <a href={`/demo/vendor/invoices/${inv.id}/pdf`} data-testid={`download-${inv.id}`}>
                  Download PDF
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: '#999', fontSize: 13 }} data-testid="invoice-count">
        {invoices.length} invoice(s)
      </p>
    </main>
  );
}
