import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findeEigeneSchicht, type EigeneSchicht }
  from '@/server/services/mitarbeiter/schichten';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../rahmen';
import { Feld, Felder, SchichtKarte } from '../../bausteine';

/**
 * `/portal/mein/schichten/[zuordnungId]` — die einzelne Schicht (EMP-02).
 *
 * **Eine fremde Zuordnung gibt es hier nicht** — nicht „verboten", sondern
 * nicht vorhanden (AUT-06): die Personen-RLS liefert null Zeilen, und diese
 * Seite antwortet 404. Ein 403 bestaetigte, dass es die Schicht gibt, und
 * genau das ist die Auskunft, die niemand bekommen soll.
 *
 * **Kein Kunde, kein Auftrag, kein Preis** (EMP-13, K-05). Was hier steht, ist
 * was diese Kraft fuer ihre Arbeit braucht: Gesellschaft, Objekt, Zeiten,
 * Funktion. Die kaufmaennische Seite der Schicht gehoert dem Auftrag, nicht
 * dem Menschen, der sie leistet.
 */
export const dynamic = 'force-dynamic';

export default async function MeineSchicht(
  { params }: { params: Promise<{ zuordnungId: string }> },
) {
  const { zuordnungId } = await params;
  const ergebnis = await meinPortal<EigeneSchicht | null>(
    `/portal/mein/schichten/${zuordnungId}`,
    async (kontext) => findeEigeneSchicht(kontext, zuordnungId),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.daten === null) notFound();

  const { basis, daten } = ergebnis;
  const t = basis.texte;

  return (
    <MeinRahmen basis={basis} titel={t.schichten} aktiverTab="schichten">
      <Link
        href="/portal/mein/schichten"
        className="mb-s4 inline-block min-h-11 text-base text-text underline"
      >
        ← {t.schichten}
      </Link>

      <h1 className="mb-s5 text-h1 text-text">
        <span className="cse-zahl">{daten.planDatum}</span>
      </h1>

      <div className="mb-s5">
        <SchichtKarte schicht={daten} texte={t} alsLink={false} />
      </div>

      <section className="rounded-lg border border-line bg-surface p-s4">
        <Felder>
          <Feld label={t.gesellschaft}>{daten.mandantName}</Feld>
          <Feld label={t.pause}>
            <span className="cse-zahl">{daten.pauseGeplantMinuten}</span> min
          </Feld>
          <Feld label={t.status}>{daten.status}</Feld>
          {daten.funktion !== null && <Feld label="Funktion">{daten.funktion}</Feld>}
        </Felder>
      </section>

      {/*
        Die Dienstanweisung gehoert laut Seitenkarte hierher, entsteht aber
        erst mit PR 42 (SEC-06, EMP-09). Hier steht deshalb NICHTS statt eines
        toten Verweises: ein Menuepunkt, der auf 404 fuehrt, ist schlechter als
        keiner.
      */}
    </MeinRahmen>
  );
}
