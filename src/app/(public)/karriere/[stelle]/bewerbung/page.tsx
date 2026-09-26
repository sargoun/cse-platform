import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import { aufbewahrungTage } from '@/server/services/recruiting/dienst';
import { offeneStelle } from '../../daten';
import { Bewerbungsformular } from '../../Formular';
import { bewerbungsMeldung } from '../../meldung';

/**
 * `/karriere/[stelle]/bewerbung` — das Formular (REC-03, REC-07, LEG-11).
 *
 * Die Aufbewahrungsfrist kommt aus der Einstellung und steht als ZAHL auf der
 * Seite. „Wir löschen nach angemessener Zeit" ist keine Angabe nach Art. 13
 * DSGVO — die Tage sind eine.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Bewerbung — CSE Gruppe' };

export default async function BewerbungsSeite(
  { params, searchParams }: {
    params: Promise<{ stelle: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { stelle } = await params;
  const s = await offeneStelle(stelle);
  if (s === null) notFound();
  const tage = await oeffentlichLesen((kontext) => aufbewahrungTage(kontext));
  // V-158: eine Abweisung kommt als Grund zurück, nicht als JSON.
  const meldung = bewerbungsMeldung((await searchParams)['fehler']);

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s6 px-s5 py-s7">
      <nav aria-label="Zurück">
        <Link href={`/karriere/${s.id}`}
              className="text-sm text-text-muted underline underline-offset-2">
          ‹ {s.titel}
        </Link>
      </nav>
      <header className="flex flex-col gap-s2">
        <h1 className="m-0 text-h1 text-text">Bewerbung: {s.titel}</h1>
        <p className="m-0 text-base text-text-muted">{s.mandantName}</p>
      </header>
      <Bewerbungsformular stelleId={s.id} aufbewahrungTage={tage} meldung={meldung} />
    </main>
  );
}
