import type { Metadata } from 'next';
import { stellenBlatt, stellenMetadaten } from '../Seiten';

/**
 * `/karriere/[stelle]` — eine Anzeige (REC-03, PUB-11).
 *
 * Die Anforderungen stehen als LISTE, nicht als Fliesstext — dieselbe Form,
 * gegen die später bewertet wird (REC-05). Wer sich bewirbt, soll die
 * Kriterien lesen können, an denen er gemessen wird. Englisch unter
 * `/en/karriere/[stelle]` (V-393).
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ stelle: string }> },
): Promise<Metadata> {
  return stellenMetadaten('de', (await params).stelle);
}

export default async function StellenSeite(
  { params }: { params: Promise<{ stelle: string }> },
) {
  return stellenBlatt('de', (await params).stelle);
}
