import type { Route } from 'next';
import Link from 'next/link';
import { dokumentKategorieText } from '@/lib/i18n/texte';
import {
  GRENZE, groesseText, istDokumentKategorie, listeEigeneDokumente,
  zaehleEigeneKategorien, type KategorieZaehlung, type MeinDokument,
} from '@/server/services/mitarbeiter/dokumente';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meinPortal, MeinRahmen } from '../rahmen';
import { Feld, Felder, Gesellschaft, Hinweis, Leer } from '../bausteine';

/**
 * `/portal/mein/dokumente` — die Unterlagen, die diesem Menschen im Portal
 * freigegeben sind (EMP-11, DOC-01, DOC-03, DOC-04).
 *
 * **Gelesen wird im Personen-Scope, und die Decke ist die der Datenbank.**
 * `dokument.p_ma_ceiling` (restriktiv) und `dokument.t_person` (gewaehrend,
 * 0009) lassen genau durch, was `sichtbar_fuer_mitarbeiter` traegt und nicht
 * geloescht ist. Diese Seite filtert nichts nach, was die Policy schon
 * entscheidet — eine zweite Bedingung in der Anwendung waere die, die
 * irgendwann etwas anderes sagt als die erste.
 *
 * **Die offene Frage steht als SATZ auf dem Bildschirm** (O-850): „die
 * Dokumente, die diesen Menschen betreffen" und „die Dokumente, die der
 * Belegschaft freigegeben sind" sind nicht dasselbe, und `dokument` traegt
 * keine `person_id`. Wer eine Lohnabrechnung sucht und eine Betriebsanweisung
 * findet, soll lesen koennen, warum. Ein weggelassener Absatz beantwortet das
 * nicht, ein ausgegrauter Knopf auch nicht.
 *
 * **Die Filter sind LINKS und keine Auswahlfelder.** Diese Seite laeuft auf
 * alten Diensttelefonen im Treppenhaus: ohne JavaScript bedienbar (SPEC §10,
 * DESIGN §8). Ein `<select onChange>` waere dort eine Liste, die sich nie
 * aendert. Ein Link fuehrt auf eine andere Adresse, gehoert damit in die
 * Adressleiste und in den Verlauf — und laesst sich mit dem Zurueck-Knopf
 * ruecknehmen.
 *
 * **Die Kategorie steht gross daneben** (O-851): solange nicht entschieden
 * ist, welche der neun Kategorien einer Belegschaft ueberhaupt freigegeben
 * werden duerfen, ist die sichtbare Kategorie die Stelle, an der eine falsche
 * Freigabe auffaellt — der Kraft wie dem Haus.
 */
export const dynamic = 'force-dynamic';

interface Blatt {
  readonly dokumente: readonly MeinDokument[];
  readonly kategorien: readonly KategorieZaehlung[];
}

function einzeln(wert: string | string[] | undefined): string | null {
  return typeof wert === 'string' && wert !== '' ? wert : null;
}

/**
 * Eine Adresse mit genau den gesetzten Filtern — nie mit leeren Parametern.
 *
 * Der Rueckgabetyp ist `Route` und nicht `string`: `typedRoutes` prueft jede
 * `href`, und eine Zeichenkette aus einer Hilfsfunktion kommt dort nicht
 * durch. Die Zusicherung ist eng — der Pfad steht woertlich da, variabel ist
 * nur die Abfrage —, und sie steht an EINER Stelle statt an vieren.
 */
function adresse(kategorie: string | null, gesellschaft: string | null): Route {
  const teile: string[] = [];
  if (kategorie !== null) teile.push(`kategorie=${encodeURIComponent(kategorie)}`);
  if (gesellschaft !== null) teile.push(`gesellschaft=${encodeURIComponent(gesellschaft)}`);
  return (teile.length === 0
    ? '/portal/mein/dokumente'
    : `/portal/mein/dokumente?${teile.join('&')}`) as Route;
}

export default async function MeineDokumente({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const frage = await searchParams;
  /*
   * Ein unbekannter Wert aus der Adressleiste wird zu `null` und nicht in die
   * Abfrage gereicht: `dokument.kategorie` ist ein Enum, und ein fremder Wert
   * waere dort ein Datenbankfehler — also ein 500 fuer einen Tippfehler.
   */
  const rohKategorie = einzeln(frage['kategorie']);
  const kategorie = rohKategorie !== null && istDokumentKategorie(rohKategorie)
    ? rohKategorie : null;
  const gesellschaft = einzeln(frage['gesellschaft']);

  const ergebnis = await meinPortal<Blatt>(
    '/portal/mein/dokumente',
    async (kontext) => ({
      dokumente: await listeEigeneDokumente(kontext, {
        kategorie, mandantSlug: gesellschaft,
      }),
      kategorien: await zaehleEigeneKategorien(kontext),
    }),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  const gesellschaften = basis.anstellungen.map((a) => ({
    slug: a.mandantSlug, name: a.mandantName,
  }));
  /* Zwei Gesellschaften sind zwei Ablagen; bei einer ist der Filter ein Knopf,
     der nichts tut, und gehoert weggelassen (D-09, EMP-14). */
  const zeigeGesellschaften = new Set(gesellschaften.map((g) => g.slug)).size > 1;

  const knopf = 'inline-flex min-h-11 items-center rounded-md border px-s3 '
    + 'text-base no-underline';
  const aktiv = `${knopf} border-line-strong bg-surface-2 text-text`;
  const ruhend = `${knopf} border-line bg-surface text-text-muted`;

  return (
    <MeinRahmen basis={basis} titel={t.dokumente} aktiverTab="heute">
      <h1 className="mb-s4 text-h1 text-text">{t.dokumente}</h1>

      {/* O-850 — die offene Zuordnung, als Satz und nicht als Leerstelle. */}
      <Hinweis text={t.dokumenteOffenerBezug} marke="offener-bezug" />

      {daten.kategorien.length > 0 && (
        <nav
          aria-label={t.kategorie}
          data-cse="kategorie-filter"
          className="mb-s4 flex flex-wrap gap-s2"
        >
          <Link
            href={adresse(null, gesellschaft)}
            data-cse="kategorie-alle"
            data-aktiv={kategorie === null ? 'ja' : 'nein'}
            className={kategorie === null ? aktiv : ruhend}
          >
            {t.alleKategorien}
          </Link>
          {daten.kategorien.map((k) => (
            <Link
              key={k.kategorie}
              href={adresse(k.kategorie, gesellschaft)}
              data-cse="kategorie-wahl"
              data-kategorie={k.kategorie}
              data-aktiv={kategorie === k.kategorie ? 'ja' : 'nein'}
              className={kategorie === k.kategorie ? aktiv : ruhend}
            >
              {dokumentKategorieText(basis.sprache, k.kategorie)}
              {' '}
              <span className="cse-zahl">{k.anzahl}</span>
            </Link>
          ))}
        </nav>
      )}

      {zeigeGesellschaften && (
        <nav
          aria-label={t.gesellschaft}
          data-cse="gesellschaft-filter"
          className="mb-s5 flex flex-wrap gap-s2"
        >
          <Link
            href={adresse(kategorie, null)}
            data-cse="gesellschaft-alle"
            data-aktiv={gesellschaft === null ? 'ja' : 'nein'}
            className={gesellschaft === null ? aktiv : ruhend}
          >
            {t.alleKategorien}
          </Link>
          {gesellschaften.map((g) => (
            <Link
              key={g.slug}
              href={adresse(kategorie, g.slug)}
              data-cse="gesellschaft-wahl"
              data-mandant={g.slug}
              data-aktiv={gesellschaft === g.slug ? 'ja' : 'nein'}
              className={gesellschaft === g.slug ? aktiv : ruhend}
            >
              {g.name}
            </Link>
          ))}
        </nav>
      )}

      {daten.dokumente.length === 0 ? <Leer text={t.keineDokumente} /> : (
        <ul data-cse="dokumente" className="m-0 flex list-none flex-col gap-s3 p-0">
          {daten.dokumente.map((d) => (
            <li key={d.id}>
              <Link
                href={`/portal/mein/dokumente/${d.id}`}
                data-cse="dokument"
                data-dokument={d.id}
                data-kategorie={d.kategorie}
                data-mandant={d.mandantSlug}
                className="block min-h-11 rounded-lg border border-line bg-surface p-s4
                           no-underline transition-colors duration-fast hover:bg-surface-2"
              >
                <div className="mb-s2 flex flex-wrap items-center gap-s3">
                  <Gesellschaft slug={d.mandantSlug} name={d.mandantName} />
                  <span data-cse="kategorie" className="text-sm text-text-muted">
                    {dokumentKategorieText(basis.sprache, d.kategorie)}
                  </span>
                </div>
                <p className="m-0 text-base text-text">{d.titel}</p>
                <Felder>
                  <Feld label={t.abgelegtAm}>
                    <span className="cse-zahl">{d.abgelegtLokal}</span>
                  </Feld>
                  <Feld label={t.groesse}>
                    <span className="cse-zahl">{groesseText(d.groesseBytes)}</span>
                  </Feld>
                  {d.objektBezeichnung !== null && (
                    <Feld label={t.objekt}>{d.objektBezeichnung}</Feld>
                  )}
                </Felder>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/*
        * Die Grenze wird GESAGT, wenn sie greift.
        *
        * Eine Liste, die bei 200 aufhoert und so tut, als waere das alles, ist
        * die teure Variante: wer sein Dokument nicht findet, sucht es nicht
        * weiter — er glaubt, es sei nicht da.
        */}
      {daten.dokumente.length >= GRENZE && (
        <p data-cse="grenze" className="mt-s4 m-0 max-w-prose text-base text-text-muted">
          <span className="cse-zahl">{GRENZE}</span> · {t.listeGekuerzt}
        </p>
      )}
    </MeinRahmen>
  );
}
