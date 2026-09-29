import Link from 'next/link';
import { berlinHeute } from '@/server/db/heute';
import { montag, tagePlus, tagInSprache } from '@/lib/datum/kalendertag';
import { stundenMinutenText } from '@/lib/datum/stunden';
import {
  listeEigeneSchichten, type EigeneSchicht,
} from '@/server/services/mitarbeiter/schichten';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meinPortal, MeinRahmen } from '../rahmen';
import { Leer, SchichtKarte } from '../bausteine';

/**
 * `/portal/mein/schichten` — meine Einteilung, beide Gesellschaften
 * (EMP-02, EMP-14, TIM-01).
 *
 * **Eine Woche, eine Liste, jede Zeile mit ihrer GmbH.** Das ist die
 * Abnahmezusage von EMP-14, und sie steht und faellt mit dem Scope: gelesen
 * wird im Personen-Scope (K-18), weil die Gruppenpolicy ein Leitungsrecht
 * verlangt, das keine Reinigungskraft haelt — die Woche waere leer, und die
 * Kraft schloesse daraus, sie sei nicht eingeteilt.
 *
 * **Der Wochenanker kommt aus der Adresse, der Vorgabewert aus der Datenbank.**
 * Ein `new Date()` im Node-Prozess laese zwischen Mitternacht und 02:00
 * Berliner Zeit noch den Vortag und zeigte die VORIGE Woche (Invariante 5).
 */
export const dynamic = 'force-dynamic';

const TAG = /^\d{4}-\d{2}-\d{2}$/u;

function einzeln(wert: string | string[] | undefined): string | null {
  return typeof wert === 'string' && wert !== '' ? wert : null;
}

export default async function MeineSchichten({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const frage = await searchParams;
  const heute = await berlinHeute();
  const roh = einzeln(frage['woche']);
  const von = montag(roh !== null && TAG.test(roh) ? roh : heute);
  const bis = tagePlus(von, 6);

  const ergebnis = await meinPortal<readonly EigeneSchicht[]>(
    '/portal/mein/schichten',
    async (kontext) => listeEigeneSchichten(kontext, { von, bis }),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  const summe = daten.reduce((s, z) => s + z.dauerMinuten, 0);

  /** Nach Berliner Plantag gruppiert — der Tag ist die Einheit einer Schicht. */
  const nachTag = new Map<string, EigeneSchicht[]>();
  for (const s of daten) {
    const liste = nachTag.get(s.planDatum) ?? [];
    liste.push(s);
    nachTag.set(s.planDatum, liste);
  }

  return (
    <MeinRahmen basis={basis} titel={t.schichten} aktiverTab="schichten">
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.schichten}</h1>
        <p className="m-0 text-base text-text-muted">
          <span className="cse-zahl">{tagInSprache(von, basis.sprache)}</span> –{' '}
          <span className="cse-zahl">{tagInSprache(bis, basis.sprache)}</span>
          {' · '}
          <span data-cse="wochensumme" className="cse-zahl">{stundenMinutenText(summe)}</span>
        </p>
      </div>

      {/*
        Vor und zurueck als LINKS und nicht als Knoepfe: sie fuehren auf eine
        andere Adresse, also gehoeren sie in die Adressleiste und in den
        Verlauf. Mit `ms`/`me` statt `ml`/`mr`, damit sie auf Arabisch
        mitspiegeln.
      */}
      <nav aria-label={t.schichten} className="mb-s5 flex flex-wrap gap-s4">
        <Link
          href={`/portal/mein/schichten?woche=${tagePlus(von, -7)}`}
          data-cse="woche-zurueck"
          className="min-h-11 text-base text-text underline"
        >
          ← <span className="cse-zahl">{tagInSprache(tagePlus(von, -7), basis.sprache)}</span>
        </Link>
        <Link
          href={`/portal/mein/schichten?woche=${tagePlus(von, 7)}`}
          data-cse="woche-vor"
          className="min-h-11 text-base text-text underline"
        >
          <span className="cse-zahl">{tagInSprache(tagePlus(von, 7), basis.sprache)}</span> →
        </Link>
      </nav>

      {daten.length === 0 ? <Leer text={t.keineSchicht} /> : (
        <div className="flex flex-col gap-s5">
          {[...nachTag].map(([tag, schichten]) => (
            <section key={tag} data-cse="schicht-tag" data-tag={tag}>
              <h2 className="mb-s3 text-h3 text-text">
                <span className="cse-zahl">{tagInSprache(tag, basis.sprache)}</span>
              </h2>
              <ul className="m-0 flex list-none flex-col gap-s3 p-0">
                {schichten.map((s) => (
                  <li key={s.zuordnungId}>
                    <SchichtKarte schicht={s} texte={t} sprache={basis.sprache} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </MeinRahmen>
  );
}
