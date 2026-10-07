import type { Metadata } from 'next';
import { stellenBlatt, stellenMetadaten } from '../../../karriere/Seiten';

/** `/en/karriere/[stelle]` — eine Anzeige mit englischem Rahmen (V-393). */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ stelle: string }> },
): Promise<Metadata> {
  return stellenMetadaten('en', (await params).stelle);
}

export default async function EnglishPosition(
  { params }: { params: Promise<{ stelle: string }> },
) {
  return stellenBlatt('en', (await params).stelle);
}
