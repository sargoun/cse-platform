import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { offeneStelle } from '../daten';

/**
 * `/karriere/[stelle]` — eine Anzeige (REC-03, PUB-11).
 *
 * Die Anforderungen stehen als LISTE, nicht als Fliesstext — dieselbe Form,
 * gegen die später bewertet wird (REC-05). Wer sich bewirbt, soll die
 * Kriterien lesen können, an denen er gemessen wird.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ stelle: string }> },
): Promise<Metadata> {
  const { stelle } = await params;
  const s = await offeneStelle(stelle);
  if (s === null) return { title: 'Stelle — CSE Gruppe' };
  return {
    title: `${s.titel} — ${s.mandantName}`,
    description: s.beschreibung.slice(0, 160),
  };
}

export default async function StellenSeite(
  { params }: { params: Promise<{ stelle: string }> },
) {
  const { stelle } = await params;
  const s = await offeneStelle(stelle);
  // Eine geschlossene oder nicht veroeffentlichte Stelle ist hier dasselbe wie
  // keine — der Unterschied waere die Auskunft, dass es sie gibt (AUT-06).
  if (s === null) notFound();

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s6 px-s5 py-s7">
      <nav aria-label="Zurück">
        <Link href="/karriere" className="text-sm text-text-muted underline underline-offset-2">
          ‹ Alle offenen Stellen
        </Link>
      </nav>

      <header className="flex flex-col gap-s2" data-bereich={s.mandantSlug}>
        <span className="text-micro uppercase tracking-[0.08em] text-text-subtle">
          {s.mandantName}
        </span>
        <h1 className="m-0 text-display text-text">{s.titel}</h1>
        <p className="m-0 text-base text-text-muted">
          {[s.einsatzort,
            s.wochenstunden === null ? null : `${s.wochenstunden.replace('.', ',')} h/Woche`,
            s.bewerbungsfrist === null ? null : `Bewerbung bis ${s.bewerbungsfrist}`]
            .filter((t) => t !== null).join(' · ') || 'Ort und Umfang nach Absprache'}
        </p>
      </header>

      <section className="max-w-prose whitespace-pre-line text-base text-text">
        {s.beschreibung}
      </section>

      {s.anforderungen.length > 0 && (
        <section className="flex flex-col gap-s3">
          <h2 className="m-0 text-h2 text-text">Was wir erwarten</h2>
          <ul data-cse="anforderungen" className="m-0 flex list-disc flex-col gap-s2 pl-s5">
            {s.anforderungen.map((a) => (
              <li key={a} className="max-w-prose text-base text-text">{a}</li>
            ))}
          </ul>
          <p className="m-0 max-w-prose text-sm text-text-muted">
            An genau diesen Punkten messen wir Bewerbungen — und eine
            Entscheidung trifft immer ein Mensch.
          </p>
        </section>
      )}

      <Link
        href={`/karriere/${s.id}/bewerbung`}
        data-cse="zur-bewerbung"
        className="inline-flex min-h-11 w-fit items-center rounded-md bg-brand px-s5 text-base font-semibold text-white hover:bg-brand-hover"
      >
        Auf diese Stelle bewerben
      </Link>
    </main>
  );
}
