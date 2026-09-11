import Link from 'next/link';
import {
  nachtragTitelVorschlag, warnungsText, type AusserhalbLvWarnung,
} from '@/server/services/bau/ausserhalb-lv';

/**
 * BAU-05 — die sichtbare Warnung „Leistung ausserhalb des Leistungsverzeichnisses".
 *
 * **Der Ausfall, den dieser Block verhindert, kostet Geld.** Gemessene oder
 * gebuchte Leistung ohne Vertragsposition ist nach § 2 Abs. 8 VOB/B im Zweifel
 * unentgeltlich. Der Fehler fällt erst bei der Schlussrechnung auf — Monate
 * später, wenn die Ankündigungsfrist des § 2 Abs. 6 Nr. 1 VOB/B längst
 * verstrichen ist.
 *
 * Drei Eigenschaften, und jede ist eine Zusage aus der Abnahme:
 *
 *  1. **Sie BENENNT die Position.** Der Satz kommt aus `warnungsText` im
 *     Dienst, nicht aus dieser Datei: „Es gibt Leistungen ausserhalb des LV"
 *     ist keine Warnung, sondern eine Stimmung — und eine zweite Fassung des
 *     Satzes hier wäre die, die beim nächsten Feld auseinanderläuft.
 *  2. **Sie BIETET AN, einen Nachtrag anzulegen** — mit vorgeschlagenem Titel
 *     und, wo es einen gibt, mit dem Bezug (Auftragszeile bzw. Aufmasszeile),
 *     damit die Warnung nach der Abhilfe verschwindet.
 *  3. **Sie sperrt nichts.** Die Arbeit auf der Baustelle aufzuhalten wäre der
 *     falsche Eingriff: die Menge ist richtig, es fehlt der Vorgang daneben.
 *
 * Die Anspruchsgrundlage wird NICHT mitgegeben. Welcher Absatz des § 2 VOB/B
 * einschlägig ist, entscheidet ein Mensch (K-17, O-23) — die Warnung füllt den
 * Titel, nie die Grundlage.
 */
export function AusserhalbLvWarnungen(
  { warnungen, mandant, projektId, ueberschrift = 'Leistung außerhalb des Leistungsverzeichnisses' }: {
    readonly warnungen: readonly AusserhalbLvWarnung[];
    readonly mandant: string;
    /** `null` in der projektübergreifenden Liste — das Ziel kommt dann je Zeile. */
    readonly projektId: string | null;
    readonly ueberschrift?: string;
  },
) {
  if (warnungen.length === 0) return null;

  return (
    <section className="mb-s6" data-cse="ausserhalb-lv">
      <h2 className="mb-s2 text-h3 text-text">{ueberschrift}</h2>
      <p className="m-0 mb-s3 max-w-prose text-sm text-text-muted">
        {warnungen.length === 1
          ? 'Eine Position ist erfasst, steht aber in keinem Leistungsverzeichnis dieses '
            + 'Projekts und hängt an keinem Nachtrag.'
          : `${String(warnungen.length)} Positionen sind erfasst, stehen aber in keinem `
            + 'Leistungsverzeichnis dieses Projekts und hängen an keinem Nachtrag.'}
        {' '}Ohne Nachtrag ist die Leistung nach § 2 Abs. 8 VOB/B im Zweifel
        unentgeltlich — und § 2 Abs. 6 Nr. 1 VOB/B verlangt die Ankündigung,
        bevor gebaut wird.
      </p>
      <ul className="m-0 list-none p-0">
        {warnungen.map((w) => {
          const ziel = projektId ?? w.projekt_id;
          const abfrage = new URLSearchParams({
            titel: nachtragTitelVorschlag(w),
            quelle: w.quelle,
          });
          // Der Bezug, an dem die Warnung hängt — er lässt sie nach dem
          // Anlegen verschwinden statt sie stehenzulassen.
          if (w.quelle === 'zeit') abfrage.set('auftrag_leistung', w.id);
          else abfrage.set('aufmass_zeile', w.id);

          return (
            <li
              key={`${w.quelle}-${w.id}`}
              className="mb-s2 rounded-lg border border-line bg-surface p-s4 text-sm"
              data-cse="ausserhalb-lv-warnung"
            >
              <p className="m-0 text-warning" data-cse="warnungstext">{warnungsText(w)}</p>
              <p className="m-0 mt-s2 text-xs text-text-subtle">
                {w.projekt} · {w.herkunft}
              </p>
              <p className="m-0 mt-s3">
                <Link
                  href={`/portal/${mandant}/bau/projekte/${ziel}/nachtraege/neu?${abfrage.toString()}`}
                  className="text-brand underline-offset-2 hover:underline"
                  data-cse="nachtrag-anbieten"
                >
                  Nachtrag anlegen
                </Link>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
