import { notFound } from 'next/navigation';
import { berlinHeute } from '@/server/db/heute';
import { FARBEN_DRUCK, FARBEN_MARKE, MASSE_DRUCK } from '@/lib/design/theme';
import { stundenMinutenText } from '@/lib/datum/stunden';
import { leseNachweis, type MiLoGNachweis } from '@/server/services/zeit/milog';
import { leseKonten, type Stundenkonto } from '@/server/services/zeit/stundenkonto';
import { leseEigeneAnstellungen } from '@/server/services/mitarbeiter/person';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meinPortal } from '../rahmen';
import Link from 'next/link';
import { Monatswechsler } from '../bausteine';
import { DruckKnopf } from './DruckKnopf';

/**
 * `/portal/mein/monatsnachweis` — der Stundennachweis eines Monats, je
 * Beschaeftigung (EMP-06, TIM-13, LEG-02).
 *
 * **Warum HTML und kein erzeugtes PDF.** Dieselbe Entscheidung wie beim
 * Angebotsdokument (`/portal/[mandant]/angebote/[id]/pdf`): ein
 * serverseitiger PDF-Renderer ist eine eigene Abhaengigkeit mit eigener
 * Laufzeit, und solange keine eingerichtet ist, waere ein Knopf „PDF" ohne
 * Datei eine vorgetaeuschte Funktion (CLAUDE.md, „No fake integrations").
 * Diese Seite IST das Dokument: A4, 20 mm Rand, 10 pt, weisses Blatt mit
 * `#111` Text (DESIGN §11) — der Browser macht daraus die Datei.
 *
 * **Print ist nicht die App.** Die Bildschirmpalette ist dunkel, das Blatt ist
 * es nicht; `--surface` auf Papier druckte ein schwarzes Rechteck. Deshalb die
 * fuenf Drucktoken und die sechs Druckmasse aus DESIGN §11 und nichts
 * daneben.
 *
 * **Die Zahl ist DIESELBE wie im Stundenkonto — auf die Minute.** Beide
 * stehen nebeneinander auf dem Blatt, und wo sie auseinandergehen, steht der
 * Grund dabei: ein OFFENER Monat traegt Zeiten, die noch niemand freigegeben
 * hat; gebucht wird nur Freigegebenes (§7.3, EMP-04). Ein abgeschlossener
 * Monat kann deshalb gar nicht abweichen — `schliesseMonatAb` verweigert die
 * Sperre, solange ein Eintrag unfreigegeben ist, bucht dann alles und praegt
 * erst danach. Die Differenz zu verstecken waere die schlechteste Variante:
 * sie stuende als plausible Zahl auf einem Dokument, das jemand unterschreibt.
 *
 * **Ein gesperrter Monat wird nicht neu gerechnet**, sondern aus seinem
 * gepraegten Artefakt beantwortet (D-152). `quelle` sagt, woher die Zeilen
 * kommen: `artefakt`, `live` (vorlaeufig) oder `ungepraegt`.
 *
 * // TODO(client, O-51): Muss der Stundennachweis in der Sprache des
 * Menschen ausgestellt werden, oder ist Deutsch die verlangte Form fuer eine
 * § 17-MiLoG-Aufzeichnung? Bis zur Antwort ist das Dokument DEUTSCH, mit einer
 * uebersetzten Kopfzeile darueber.
 */
export const dynamic = 'force-dynamic';

const MONAT = /^(\d{4})-(\d{2})/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function einzeln(wert: string | string[] | undefined): string | null {
  return typeof wert === 'string' && wert !== '' ? wert : null;
}

interface Beschaeftigung {
  readonly anstellungId: string;
  readonly mandantName: string;
}

interface Daten {
  readonly nachweis: MiLoGNachweis;
  readonly konto: Stundenkonto | null;
  readonly mandantName: string;
  readonly personalnummer: string | null;
  readonly anstellungId: string;
  /**
   * ALLE eigenen Beschäftigungen — für die Wahl (V-055, D-09).
   *
   * Zwei Arbeitsverhältnisse sind zwei Aufzeichnungen gegen zwei Arbeitgeber.
   * Die Seite nahm stillschweigend die erste; wer für die zweite einen
   * Nachweis brauchte, musste `?anstellung=` mit einer UUID tippen, die
   * nirgends stand.
   */
  readonly beschaeftigungen: readonly Beschaeftigung[];
}

/** `HH:MM` Berliner Ortszeit aus einem ISO-Instant — die Zone steht dabei. */
const UHR = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
});

export default async function Monatsnachweis({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const frage = await searchParams;
  const heute = await berlinHeute();
  const rohMonat = einzeln(frage['monat']) ?? heute;
  const treffer = MONAT.exec(rohMonat) ?? MONAT.exec(heute);
  const jahr = Number(treffer?.[1] ?? heute.slice(0, 4));
  const monatNr = Number(treffer?.[2] ?? heute.slice(5, 7));
  const monatsErster = `${String(jahr).padStart(4, '0')}-${String(monatNr).padStart(2, '0')}-01`;
  const rohAnstellung = einzeln(frage['anstellung']);

  const ergebnis = await meinPortal<Daten | null>(
    '/portal/mein/monatsnachweis',
    async (kontext) => {
      const anstellungen = await leseEigeneAnstellungen(kontext);
      /**
       * Ohne Angabe die erste eigene Beschaeftigung — und eine FREMDE id
       * fuehrt nicht etwa zu einem fremden Nachweis, sondern zu nichts: die
       * Liste stammt aus der Personen-RLS, und was nicht darin steht, gibt es
       * fuer diese Anmeldung nicht (AUT-06).
       */
      const gewaehlt = rohAnstellung !== null && UUID.test(rohAnstellung)
        ? anstellungen.find((a) => a.anstellungId === rohAnstellung)
        : anstellungen[0];
      if (gewaehlt === undefined) return null;

      const nachweis = await leseNachweis(kontext, {
        anstellungId: gewaehlt.anstellungId, monat: monatsErster,
      });
      const konten = await leseKonten(kontext, {
        anstellungId: gewaehlt.anstellungId, jahr, monat: monatNr,
      });
      return {
        nachweis,
        konto: konten[0] ?? null,
        mandantName: gewaehlt.mandantName,
        personalnummer: gewaehlt.personalnummer,
        anstellungId: gewaehlt.anstellungId,
        beschaeftigungen: anstellungen.map((a) => ({
          anstellungId: a.anstellungId, mandantName: a.mandantName,
        })),
      };
    },
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.daten === null) notFound();

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  /*
   * TODO(client, O-886): Darf das Blatt, das die Arbeiterin abruft, in ihrer Sprache stehen — oder muss die Aufzeichnung nach § 17 MiLoG deutsch sein, um als Nachweis zu gelten?
   *
   * Gebaut ist die Lesehilfe: Spalten und Erklaerungen folgen
   * `person.sprache`, die Fundstellen (`§ 17 MiLoG`) bleiben unuebersetzt, und
   * der Pruefsummen-Hash bleibt derselbe — er haengt an den Daten, nicht an
   * der Anzeige. Das folgt D-84 (Impressum/Datenschutz sind deutsch bindend,
   * die englische Fassung sagt es dazu) und ist damit kein erfundener Weg,
   * sondern der schon entschiedene. Sagt der Auftraggeber, das Blatt muesse
   * deutsch bleiben, ist die Umkehr eine Zeile: `meinTexte('de')` statt
   * `basis.texte`.
   */
  const b = t.nachweisBlatt;
  const n = daten.nachweis;
  const kontoIst = daten.konto?.istMinuten ?? null;
  const stimmtUeberein = kontoIst !== null && kontoIst === n.summeNettoMinuten;

  return (
    <article data-cse="monatsnachweis" className="cse-blatt" lang="de">
      {/*
        Die Druckregeln stehen als Blatt-eigene Regel und nicht in der globalen
        CSS: ein `@page` im Anwendungsstil legte den A4-Rand auch auf jede
        andere Seite.
      */}
      <style>{`
        .cse-blatt { background: ${FARBEN_DRUCK['druck-papier']};
                     color: ${FARBEN_DRUCK['druck-text']};
                     max-width: 210mm; margin: 0 auto; padding: 20mm;
                     font-size: 10pt; line-height: 1.5; }
        .cse-blatt table { width: 100%; border-collapse: collapse; }
        .cse-blatt th, .cse-blatt td {
                     padding: ${MASSE_DRUCK['druck-zelle-y']} ${MASSE_DRUCK['druck-zelle-x']};
                     vertical-align: top; }
        .cse-blatt thead th { border-bottom: 1px solid ${FARBEN_DRUCK['druck-text']};
                              text-align: left;
                              font-size: ${MASSE_DRUCK['druck-kopf-groesse']};
                              text-transform: uppercase;
                              letter-spacing: ${MASSE_DRUCK['druck-kopf-sperrung']}; }
        .cse-blatt tbody tr { border-bottom: 1px solid ${FARBEN_DRUCK['druck-linie-leicht']}; }
        .cse-blatt tfoot tr:last-child { border-top: 1px solid ${FARBEN_DRUCK['druck-text']};
                                         font-weight: 600; }
        .cse-blatt .zahl { text-align: right; font-variant-numeric: tabular-nums;
                           white-space: nowrap; }
        /* Die Pruefsumme: 64 Zeichen ohne Trennstelle. Ohne diese Zeile war
           sie auf dem Telefon breiter als das Blatt und die Seite lief
           seitwaerts (D-420). */
        .cse-blatt .bruch { overflow-wrap: anywhere; }
        /* Auf dem BILDSCHIRM eines Telefons sind 20mm Rand je Seite 152px von
           375 — das Blatt haette 223px Inhalt. Der Druck (DESIGN §11) behaelt
           seine A4-Raender unten in der @media-print-Regel. */
        @media (max-width: 767.98px) { .cse-blatt { padding: var(--s4); } }
        .cse-blatt .leise { color: ${FARBEN_DRUCK['druck-text-leise']};
                            font-size: ${MASSE_DRUCK['druck-meta-groesse']}; }
        .cse-blatt .kopflinie { border: 0; border-top: 3px solid ${FARBEN_MARKE.red};
                                margin: ${MASSE_DRUCK['druck-block']} 0
                                        calc(2 * ${MASSE_DRUCK['druck-block']}); }
        .cse-blatt .fuss { border-top: 1px solid ${FARBEN_DRUCK['druck-linie']};
                           margin-top: calc(2 * ${MASSE_DRUCK['druck-block']});
                           padding-top: ${MASSE_DRUCK['druck-block']};
                           font-size: ${MASSE_DRUCK['druck-kopf-groesse']};
                           color: ${FARBEN_DRUCK['druck-text-leise']}; }
        @media print {
          @page { size: A4; margin: 20mm; }
          .cse-blatt { padding: 0; max-width: none; }
          .cse-nicht-drucken { display: none; }
        }
      `}</style>

      {/*
        Die uebersetzte Kopfzeile ueber dem deutschen Dokument (O-51). Sie
        traegt `dir`/`lang` der Person, das Blatt darunter bleibt deutsch.
      */}
      <p
        className="cse-nicht-drucken leise"
        lang={basis.sprache}
        dir={basis.sprache === 'ar' ? 'rtl' : 'ltr'}
        data-cse="nachweis-kopfzeile"
      >
        {t.monatsnachweis}
      </p>

      {/*
        * **„Drucken" war ein WORT, kein Knopf** (V-055).
        *
        * Die Kopfzeile schrieb „Monatsnachweis · Drucken" — eine Anleitung
        * ohne Bedienelement. Auf einem Telefon gibt es kein Datei-Menü, und
        * wer das Blatt für die Lohnstelle auf Papier braucht, fand hier
        * nichts. Der Knopf trägt `cse-nicht-drucken` und steht damit nie auf
        * dem Ausdruck selbst.
        */}
      <p className="cse-nicht-drucken" data-cse="nachweis-werkzeuge">
        <DruckKnopf text={t.drucken} />
      </p>

      {/*
        * **Die Wahl der Beschäftigung** (V-055, D-09).
        *
        * Zwei Arbeitsverhältnisse sind zwei Aufzeichnungen gegen zwei
        * Arbeitgeber — sie zu addieren gäbe eine Zahl, gegen die niemand
        * einen Anspruch hat. Die Seite nahm stillschweigend die erste; wer
        * für die zweite einen Nachweis brauchte, musste `?anstellung=` mit
        * einer UUID tippen, die nirgends stand.
        *
        * Bei EINER Beschäftigung steht hier nichts: eine Wahl mit einer
        * Möglichkeit ist keine.
        */}
      {daten.beschaeftigungen.length < 2 ? null : (
        <nav
          aria-label={t.gesellschaft}
          data-cse="nachweis-beschaeftigung"
          className="cse-nicht-drucken mb-s4 flex flex-wrap items-center gap-s3"
        >
          {daten.beschaeftigungen.map((b) => (
            b.anstellungId === daten.anstellungId ? (
              <span
                key={b.anstellungId}
                aria-current="page"
                className="inline-flex min-h-11 items-center rounded-md border border-line-strong bg-surface-2 px-s4 text-sm font-semibold text-text"
              >
                {b.mandantName}
              </span>
            ) : (
              <Link
                key={b.anstellungId}
                href={`/portal/mein/monatsnachweis?monat=${monatsErster}&anstellung=${b.anstellungId}`}
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-text hover:bg-surface-2"
              >
                {b.mandantName}
              </Link>
            )
          ))}
        </nav>
      )}

      {/*
        * Der Monatswechsler (V-053) — auf dem Bildschirm, nie auf dem Papier.
        *
        * Der Nachweis ist das Blatt, das man beim Lohnstreit vorlegt; ein
        * Bedienelement darauf waere bestenfalls sinnlos und schlimmstenfalls
        * eine zweite Aussage neben der Aufzeichnung. `cse-nicht-drucken` ist
        * dieselbe Klasse, die die Kopfzeile darueber verschwinden laesst.
        *
        * Die gewaehlte BESCHAEFTIGUNG wandert mit: wer zwei hat (D-09) und
        * einen Monat zurueckblaettert, landete sonst wieder bei der ersten.
        */}
      <div className="cse-nicht-drucken">
        <Monatswechsler
          pfad="/portal/mein/monatsnachweis"
          monat={monatsErster}
          heute={heute}
          texte={t}
          sprache={basis.sprache}
          zusatz={{ anstellung: daten.anstellungId }}
        />
      </div>

      <header>
        <p style={{ margin: 0, fontSize: '14pt', fontWeight: 600 }}>{daten.mandantName}</p>
        <hr className="kopflinie" />
      </header>

      <h1 style={{ margin: 0, fontSize: '12pt' }}>
        {b.titel} — {String(monatNr).padStart(2, '0')}/{String(jahr)}
      </h1>
      <p className="leise" style={{ marginTop: '2pt' }}>
        {basis.person.name}
        {daten.personalnummer === null ? '' : ` · ${daten.personalnummer}`}
        {' · '}
        {n.quelle === 'artefakt' ? b.abgeschlossen
          : n.quelle === 'live' ? b.vorlaeufig : b.gesperrt}
      </p>

      {/* Ein eigener Rollbehaelter: der MiLoG-Nachweis hat sieben Spalten und
          ist auf einem Telefon breiter als das Fenster. Er ist ein amtliches
          Blatt und wird nicht gestapelt — also rollt die Tabelle, nie die
          Seite (D-420). */}
      <div className="overflow-x-auto">
      <table style={{ marginTop: MASSE_DRUCK['druck-block'] }} aria-describedby="nachweis-erklaerung">
        {/*
          * Die Beschriftung ist kurz; der erklaerende Satz steht als Absatz
          * UNTER dem Rollbehaelter und ist ueber `aria-describedby` an die
          * Tabelle gebunden. Als `<caption>` war er so breit wie die Tabelle
          * (437px bei sieben Spalten) und wurde auf dem Telefon vom
          * Rollbehaelter abgeschnitten — ein Satz, den man rollen musste,
          * um ihn zu Ende zu lesen (D-420).
          */}
        <caption className="sr-only">{b.zeitenDesMonats}</caption>
        <thead>
          <tr>
            <th scope="col">{b.tag}</th>
            <th scope="col">{b.beginn}</th>
            <th scope="col">{b.ende}</th>
            <th scope="col" className="zahl">{b.pause}</th>
            <th scope="col" className="zahl">{b.anteilBrutto}</th>
            <th scope="col" className="zahl">{b.anteilNetto}</th>
          </tr>
        </thead>
        <tbody>
          {n.zeilen.map((z) => (
            <tr key={`${z.zeiteintragId}-${z.anteilBeginn}`}>
              <td>{z.kalendertag}</td>
              <td className="zahl">{UHR.format(new Date(z.beginn))}</td>
              <td className="zahl">{UHR.format(new Date(z.ende))}</td>
              <td className="zahl">{String(z.pauseMinuten)}</td>
              <td className="zahl">{stundenMinutenText(z.anteilBruttoMinuten)}</td>
              <td className="zahl">{stundenMinutenText(z.anteilNettoMinuten)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>{b.summe}</td>
            <td className="zahl">{stundenMinutenText(n.summeBruttoMinuten)}</td>
            <td data-cse="nachweis-summe" className="zahl">
              {stundenMinutenText(n.summeNettoMinuten)}
            </td>
          </tr>
        </tfoot>
      </table>
      </div>
      <p id="nachweis-erklaerung" className="leise" style={{ marginTop: MASSE_DRUCK['druck-zelle-y'] }}>
        {b.erklaerung}
      </p>

      {/* Die Gegenprobe steht AUF dem Blatt und nicht in einem Test. */}
      <p data-cse="konto-abgleich" style={{ marginTop: MASSE_DRUCK['druck-block'] }}>
        {b.stundenkonto} {String(monatNr).padStart(2, '0')}/{String(jahr)}:{' '}
        <span data-cse="konto-ist" className="zahl">
          {kontoIst === null ? b.keinKonto : stundenMinutenText(kontoIst)}
        </span>
        {kontoIst !== null && !stimmtUeberein && (
          <span className="leise">{' '}— {b.abweichend}</span>
        )}
      </p>

      <p className="leise bruch">{b.pruefsumme} {n.hash}</p>

      <footer className="fuss">{b.fussnote}</footer>
    </article>
  );
}
