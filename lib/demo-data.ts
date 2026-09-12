import { cookies } from 'next/headers';

export const VENDOR_USER = 'vendor';
export const VENDOR_PASS = 'hunter2';
export const SESSION_COOKIE = 'loop_vendor_session';

export type InvoiceStatus = 'paid' | 'unpaid';

export interface Invoice {
  id: string;
  number: string;
  vendor: string;
  amount: number;
  issued: string;
  status: InvoiceStatus;
}

export const INVOICES: Invoice[] = [
  { id: 'INV-1001', number: 'INV-1001', vendor: 'Acme Cloud', amount: 248.0, issued: '2026-08-02', status: 'unpaid' },
  { id: 'INV-1002', number: 'INV-1002', vendor: 'Northwind Hosting', amount: 512.5, issued: '2026-08-04', status: 'paid' },
  { id: 'INV-1003', number: 'INV-1003', vendor: 'Globex Analytics', amount: 89.99, issued: '2026-08-09', status: 'unpaid' },
  { id: 'INV-1004', number: 'INV-1004', vendor: 'Initech Supplies', amount: 1340.0, issued: '2026-08-11', status: 'paid' },
  { id: 'INV-1005', number: 'INV-1005', vendor: 'Umbrella Security', amount: 76.25, issued: '2026-08-15', status: 'unpaid' },
];

export function filterInvoices(status?: string): Invoice[] {
  if (status === 'unpaid') return INVOICES.filter((i) => i.status === 'unpaid');
  if (status === 'paid') return INVOICES.filter((i) => i.status === 'paid');
  return INVOICES;
}

export async function isLoggedIn(): Promise<boolean> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value === 'ok';
}

/** Minimal single-page PDF (no dependency) for the download step. */
export function invoicePdf(inv: Invoice): Buffer {
  const text = `Invoice ${inv.number} | ${inv.vendor} | $${inv.amount.toFixed(2)} | ${inv.status}`;
  const content = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
