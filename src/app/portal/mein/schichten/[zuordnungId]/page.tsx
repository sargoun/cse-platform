import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findeEigeneSchicht, type EigeneSchicht }
  from '@/server/services/mitarbeiter/schichten';
import {
  listeEigeneDienstanweisungen, type EigeneDienstanweisung,
} from '@/server/services/mitarbeiter/dienstanweisungen';
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

/** Was diese Seite in EINER Transaktion liest — Schicht plus ihre Anweisungen. */
interface Blatt {
  readonly schicht: EigeneSchicht;
  readonly anweisungen: readonly EigeneDienstanweisung[];
}

export default async function MeineSchicht(
  { params }: { params: Promise<{ zuordnungId: string }> },
) {
  const { zuordnungId } = await params;
  const ergebnis = await meinPortal<Blatt | null>(
    `/portal/mein/schichten/${zuordnungId}`,
    async (kontext, teil) => {
      const schicht = await findeEigeneSchicht(kontext, zuordnungId);
      if (schicht === null) return null;
      /**
       * Die Anweisungen DIESES Objekts, in derselben Transaktion und
       * demselben Personen-Scope. Ein zweiter Scope waere ein zweiter
       * Einstieg, und `withGroupScope` liesse die Liste lautlos leer (K-18).
       */
      const anweisungen = schicht.objektId === null ? [] as const
        : await listeEigeneDienstanweisungen(kontext, teil.sprache,
          { objektId: schicht.objektId });
      return { schicht, anweisungen };
    },
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const daten = ergebnis.daten.schicht;
  const anweisungen = ergebnis.daten.anweisungen;
  const offene = anweisungen.filter((a) => a.offen);
  const t = basis.texte;
  const zielKnopf =
    'inline-flex min-h-11 items-center justify-center rounded-md border '
    + 'border-line-strong px-s5 py-s3 text-base text-text no-underline hover:bg-surface-2';

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
        <SchichtKarte schicht={daten} texte={t} sprache={basis.sprache} alsLink={false} />
      </div>

      <section className="rounded-lg border border-line bg-surface p-s4">
        <Felder>
          <Feld label={t.gesellschaft}>{daten.mandantName}</Feld>
          <Feld label={t.pause}>
            <span className="cse-zahl">{daten.pauseGeplantMinuten}</span> min
          </Feld>
          <Feld label={t.status}>{daten.status}</Feld>
          {daten.funktion !== null && <Feld label={t.funktion}>{daten.funktion}</Feld>}
        </Felder>
      </section>

      {/*
        Was AUF dieser Schicht dokumentiert wird (SEC-05, CLN-04, TIM-10,
        BAU-07). Angeboten wird, wofuer die Schicht die Voraussetzung TRAEGT —
        ein Wachbuch braucht ein Objekt, ein Bautagebuch eine Baustelle. Ein
        Link, der auf eine Seite fuehrt, die „dazu gibt es hier nichts" sagt,
        ist ein Link, den man einmal folgt und danach nicht mehr glaubt.
      */}
      <nav aria-label={t.weiteres} className="mt-s5 flex flex-wrap gap-s3">
        <Link
          href={`/portal/mein/schichten/${daten.zuordnungId}/fotos`}
          data-cse="zu-fotos"
          className={zielKnopf}
        >
          {t.fotos}
        </Link>
        {daten.objektId !== null && (
          <>
            <Link
              href={`/portal/mein/schichten/${daten.zuordnungId}/wachbuch`}
              data-cse="zum-wachbuch"
              className={zielKnopf}
            >
              {t.wachbuch}
            </Link>
            <Link
              href={`/portal/mein/schichten/${daten.zuordnungId}/leistungsnachweis`}
              data-cse="zum-leistungsnachweis"
              className={zielKnopf}
            >
              {t.leistungsnachweis}
            </Link>
          </>
        )}
        {daten.projektId !== null && (
          <Link
            href={`/portal/mein/schichten/${daten.zuordnungId}/bautagebuch`}
            data-cse="zum-bautagebuch"
            className={zielKnopf}
          >
            {t.bautagebuch}
          </Link>
        )}
      </nav>

      {/*
        Die Dienstanweisung dieses Objekts — der Weg, den EMP-09 „vor der
        naechsten Schicht" nennt. Offene stehen zuerst und sind als offen
        bezeichnet; eine Zeile ohne Wort waere ein Verweis, den man uebersieht.
      */}
      {anweisungen.length > 0 && (
        <section className="mt-s5" data-cse="schicht-dienstanweisungen">
          <h2 className="mb-s3 text-h2 text-text">{t.dienstanweisungen}</h2>
          {offene.length > 0 && (
            <p className="mb-s3 text-base text-warning" data-cse="offene-anweisungen">
              <span className="cse-zahl">{offene.length}</span> · {t.nichtBestaetigt}
            </p>
          )}
          <ul className="m-0 list-none p-0">
            {anweisungen.map((a) => (
              <li key={a.id} className="mb-s3">
                <Link
                  href={`/portal/mein/dienstanweisungen/${a.id}`}
                  data-cse="dienstanweisung"
                  data-anweisung={a.id}
                  data-offen={a.offen ? 'ja' : 'nein'}
                  className="block min-h-11 rounded-lg border border-line bg-surface p-s4
                             no-underline transition-colors duration-fast hover:bg-surface-2"
                >
                  <span className="block text-base text-text">{a.titel}</span>
                  <span
                    className={`mt-s1 block text-sm ${a.offen ? 'text-warning' : 'text-text-muted'}`}
                  >
                    {a.offen ? t.bestaetigen : `${t.bestaetigtAm} ${a.bestaetigtLokal ?? ''}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </MeinRahmen>
  );
}
