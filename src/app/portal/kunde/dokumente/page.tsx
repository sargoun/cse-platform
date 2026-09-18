import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import {
  dateigroesse, dateityp, dokumentKategorien, DOKUMENTE_ERREICHBAR,
  KATEGORIE_LABEL, listeKundendokumente, type Kundendokument,
} from '@/server/services/kundenportal/dokument';
import { AnmeldungNoetig } from '../../Anmeldung';
import { kundePortal, KundenRahmen } from '../rahmen';
import {
  Gesellschaft, KeinZugang, Kopfzeile, Leer, Offen,
} from '../bausteine';

/**
 * `/portal/kunde/dokumente` — die freigegebenen Unterlagen (DOC-01, DOC-03,
 * DOC-04, 04-SEITENKARTE §8: „only where `sichtbar_fuer_kunde = true`").
 *
 * ===========================================================================
 * Diese Seite ist gebaut und LEER — und sie sagt, warum
 * ===========================================================================
 *
 * `dokument` traegt im Kunden-Scope zwei restriktive Decken und KEINE
 * permissive Policy; restriktive Policies schneiden weg, gewaehren kann nur
 * eine permissive. Nachgemessen gegen eine echte Kundensitzung mit einem
 * freigegebenen, zugeordneten Dokument: `select count(*) from dokument`
 * antwortet 0. Die ausfuehrliche Herleitung steht im Dienst
 * (`services/kundenportal/dokument.ts`).
 *
 * **Das ist eine offene Entscheidung, kein Defekt.** Ob Dokumente und
 * Anlagen ueberhaupt ueber das Portal ausgeliefert werden, ist als O-671
 * aufgeschrieben und unbeantwortet — und es ist eine Entscheidung ueber
 * Offenlegung, nicht ueber Policies. Sie hier nebenher zu treffen waere genau
 * das, was CLAUDE.md verbietet, und der Fehler ginge in die teure Richtung.
 *
 * **Deshalb steht der Grund AUF dem Bildschirm.** Eine leere Liste im
 * Kundenportal hat zwei Ursachen, die gleich aussehen: es gibt wirklich
 * nichts, oder eine Policy zeigt nichts (K-18). „Es liegt keine Unterlage
 * vor" waere hier schlicht gelogen — es liegen welche vor, sie kommen nur
 * nicht diesen Weg. Wer die beiden verwechselt, ruft beim Kunden an.
 *
 * Tabelle, Filter, Projektion, Rechte und Blatt sind vollstaendig gebaut. Ist
 * O-671 beantwortet, liefert dieselbe Abfrage Zeilen — an dieser Seite
 * aendert sich dann nichts ausser `DOKUMENTE_ERREICHBAR`.
 *
 * **Die KATEGORIE steht gross in der Liste**, und das ist eine Anforderung
 * aus `drizzle/0297`: solange O-736 offen ist (welche Kategorien duerfen
 * einem Kunden ueberhaupt freigegeben werden), prueft die Datenbank nur das
 * Recht. Die sichtbare Kategorie ist die Stelle, an der eine falsche Freigabe
 * auffaellt — „Personalunterlage" in einer Kundenliste sieht falsch aus, und
 * genau das soll sie.
 */
export const dynamic = 'force-dynamic';

export default async function Kundendokumente(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const suche = await searchParams;
  /*
   * Die Kategorie wird gegen die BEKANNTE Liste geprueft und danach als
   * Parameter ($1) in die Abfrage gegeben, nie in den SQL-Text. Ein Wert, den
   * es nicht gibt, faellt auf `null` zurueck — also auf „alle" — statt eine
   * leere Liste zu erzeugen, die wie ein Ergebnis aussaehe.
   */
  const roh = typeof suche['kategorie'] === 'string' ? suche['kategorie'] : null;
  const kategorie = roh !== null && Object.hasOwn(KATEGORIE_LABEL, roh) ? roh : null;

  const ergebnis = await kundePortal('/portal/kunde/dokumente', async (kontext) => ({
    dokumente: await listeKundendokumente(kontext, { kategorie }),
    kategorien: await dokumentKategorien(kontext),
  }));

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Dokumente" aktiverTab="dokumente">
        <Kopfzeile titel="Dokumente" />
        <KeinZugang />
      </KundenRahmen>
    );
  }

  const { basis, daten } = ergebnis;
  const pille = (aktiv: boolean): string => [
    'inline-flex min-h-11 items-center rounded-full px-s4 text-sm transition-colors duration-fast ease-brand',
    aktiv ? 'bg-white text-ink' : 'bg-surface-3 text-text-muted hover:text-text',
  ].join(' ');

  return (
    <KundenRahmen basis={basis} titel="Dokumente" aktiverTab="dokumente">
      <Kopfzeile titel="Dokumente" />

      {/*
        * Der Hinweis steht ÜBER der Liste und nicht darunter: er erklärt, was
        * der Mensch gleich sieht (nämlich nichts), nicht was er schon
        * gesehen hat. Er verschwindet von selbst, sobald O-671 beantwortet
        * ist — `DOKUMENTE_ERREICHBAR` ist die eine Stelle, die sich dann
        * ändert.
        */}
      {DOKUMENTE_ERREICHBAR ? null : (
        <div className="mb-s5">
          <Offen
            nummer="O-671"
            was="Unterlagen kommen zurzeit nicht über das Portal"
            weg="Ob freigegebene Dokumente und Anhänge im Portal
              herunterladbar sind, ist noch nicht entschieden; bis dahin
              schickt Ihre Ansprechpartnerin sie auf dem bisherigen Weg. Diese
              Liste bleibt deshalb leer — das heißt NICHT, dass zu Ihnen keine
              Unterlagen vorliegen."
          />
        </div>
      )}

      {daten.kategorien.length > 1 && (
        <nav
          aria-label="Kategorie"
          data-cse="kategorie-filter"
          className="mb-s5 flex flex-wrap gap-s2"
        >
          <Link
            href="/portal/kunde/dokumente"
            aria-current={kategorie === null ? 'page' : undefined}
            className={pille(kategorie === null)}
          >
            Alle
          </Link>
          {daten.kategorien.map((k) => (
            <Link
              key={k.kategorie}
              href={`/portal/kunde/dokumente?kategorie=${k.kategorie}`}
              aria-current={kategorie === k.kategorie ? 'page' : undefined}
              className={pille(kategorie === k.kategorie)}
            >
              {KATEGORIE_LABEL[k.kategorie] ?? k.kategorie}
              <span className="ml-s2 cse-zahl text-xs text-text-subtle">{k.anzahl}</span>
            </Link>
          ))}
        </nav>
      )}

      {daten.dokumente.length === 0 ? (
        <Leer text={DOKUMENTE_ERREICHBAR
          ? (kategorie === null
            ? 'Für diesen Zugang ist keine Unterlage freigegeben. Ein Dokument erscheint hier erst, wenn es ausdrücklich für Sie freigegeben wurde — das ist ein eigener Vorgang und nie der Normalfall.'
            : 'In dieser Kategorie ist nichts freigegeben. Über „Alle" sehen Sie die übrigen.')
          : 'Diese Liste ist leer, weil der Weg noch nicht geöffnet ist (O-671) — nicht, weil keine Unterlagen vorliegen. Der Hinweis oben sagt, wie Sie sie heute bekommen.'} />
      ) : (
        <DataTable
          beschriftung="Freigegebene Dokumente mit Titel, Kategorie, Dateityp, Größe, Objekt und Gesellschaft"
          zeilen={daten.dokumente}
          schluessel={(d: Kundendokument) => d.id}
          spalten={[
            {
              schluessel: 'titel',
              kopf: 'Titel',
              zelle: (d) => (
                <span>
                  <Link
                    href={`/portal/kunde/dokumente/${d.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {d.titel}
                  </Link>
                  {d.beschreibung === null ? null : (
                    <span className="block text-sm text-text-muted">{d.beschreibung}</span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'kategorie',
              kopf: 'Kategorie',
              zelle: (d) => (
                <span data-cse="kategorie" data-kategorie={d.kategorie}>
                  {KATEGORIE_LABEL[d.kategorie] ?? d.kategorie}
                </span>
              ),
            },
            { schluessel: 'typ', kopf: 'Typ', zelle: (d) => dateityp(d.mimeTyp) },
            {
              schluessel: 'groesse',
              kopf: 'Größe',
              numerisch: true,
              zelle: (d) => dateigroesse(d.groesseBytes),
            },
            {
              schluessel: 'objekt',
              kopf: 'Objekt',
              zelle: (d) => d.objektBezeichnung ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'abgelegt',
              kopf: 'Abgelegt',
              zelle: (d) => <span className="cse-zahl">{d.abgelegtAmLokal}</span>,
            },
            {
              schluessel: 'gesellschaft',
              kopf: 'Gesellschaft',
              zelle: (d) => <Gesellschaft slug={d.mandantSlug} name={d.mandantName} />,
            },
          ]}
        />
      )}
    </KundenRahmen>
  );
}
