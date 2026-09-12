import { INVOICES, invoicePdf, isLoggedIn } from '@/lib/demo-data';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isLoggedIn())) {
    return new Response('Unauthorized', { status: 401 });
  }
  const { id } = await params;
  const invoice = INVOICES.find((i) => i.id === id);
  if (!invoice) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(invoicePdf(invoice)), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${invoice.number}.pdf"`,
    },
  });
}
