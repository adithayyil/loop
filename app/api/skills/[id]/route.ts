import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const skill = store.skills.get(id);
  if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
  return NextResponse.json({ skill });
}
