import { notFound } from 'next/navigation';
import { berlinHeute } from '@/server/db/heute';
import { FARBEN_DRUCK, FARBEN_MARKE, MASSE_DRUCK } from '@/lib/design/theme';
import { stundenMinutenText } from '@/lib/datum/stunden';
import { leseNachweis, type MiLoGNachweis } from '@/server/services/zeit/milog';
import { leseKonten, type Stundenkonto } from '@/server/services/zeit/stundenkonto';
import { leseEigeneAnstellungen } from '@/server/services/mitarbeiter/person';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meinPortal } from '../rahmen';

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

interface Daten {
  readonly nachweis: MiLoGNachweis;
  readonly konto: Stundenkonto | null;
  readonly mandantName: string;
  readonly personalnummer: string | null;
  readonly anstellungId: string;
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
      };
    },
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.daten === null) notFound();

  const { basis, daten } = ergebnis;
  const t = basis.texte;
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
        {t.monatsnachweis} · {t.drucken}
      </p>

      <header>
        <p style={{ margin: 0, fontSize: '14pt', fontWeight: 600 }}>{daten.mandantName}</p>
        <hr className="kopflinie" />
      </header>

      <h1 style={{ margin: 0, fontSize: '12pt' }}>
        Stundennachweis § 17 MiLoG — {String(monatNr).padStart(2, '0')}/{String(jahr)}
      </h1>
      <p className="leise" style={{ marginTop: '2pt' }}>
        {basis.person.name}
        {daten.personalnummer === null ? '' : ` · ${daten.personalnummer}`}
        {' · '}
        {n.quelle === 'artefakt'
          ? 'abgeschlossen und unveränderlich'
          : n.quelle === 'live' ? 'vorläufig — der Monat ist offen'
            : 'gesperrt, aber noch nicht geprägt'}
      </p>

      <table style={{ marginTop: MASSE_DRUCK['druck-block'] }}>
        <caption className="leise" style={{ captionSide: 'bottom', textAlign: 'left' }}>
          Beginn und Ende sind die tatsächlichen Zeitpunkte des Eintrags in
          Europe/Berlin. Eine Schicht über die Monatsgrenze steht in beiden
          Monatsblättern mit ihren wahren Zeiten; nur der Anteil ist
          monatsabhängig.
        </caption>
        <thead>
          <tr>
            <th scope="col">Tag</th>
            <th scope="col">Beginn</th>
            <th scope="col">Ende</th>
            <th scope="col" className="zahl">Pause</th>
            <th scope="col" className="zahl">Anteil brutto</th>
            <th scope="col" className="zahl">Anteil netto</th>
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
            <td colSpan={4}>Summe</td>
            <td className="zahl">{stundenMinutenText(n.summeBruttoMinuten)}</td>
            <td data-cse="nachweis-summe" className="zahl">
              {stundenMinutenText(n.summeNettoMinuten)}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Die Gegenprobe steht AUF dem Blatt und nicht in einem Test. */}
      <p data-cse="konto-abgleich" style={{ marginTop: MASSE_DRUCK['druck-block'] }}>
        Stundenkonto {String(monatNr).padStart(2, '0')}/{String(jahr)}:{' '}
        <span data-cse="konto-ist" className="zahl">
          {kontoIst === null ? 'kein Konto geführt' : stundenMinutenText(kontoIst)}
        </span>
        {kontoIst !== null && !stimmtUeberein && (
          <span className="leise">
            {' '}— abweichend, weil der Monat noch offen ist und nur freigegebene
            Zeiten gebucht werden.
          </span>
        )}
      </p>

      <p className="leise">Prüfsumme: {n.hash}</p>

      <footer className="fuss">
        Aufzeichnung nach § 17 Abs. 1 MiLoG. Zeitpunkte gespeichert in UTC,
        dargestellt in Europe/Berlin. Kein Entgelt: diese Aufzeichnung führt
        Minuten, bewertet wird sie in der Lohnabrechnung.
      </footer>
    </article>
  );
}
