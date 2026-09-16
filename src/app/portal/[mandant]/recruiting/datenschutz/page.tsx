import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { berlinHeute } from '@/server/db/heute';
import { aufbewahrungTage, loeschStand } from '@/server/services/recruiting/dienst';
import { RecruitingSeite, leseImMandanten } from '../rahmen';
import { berlinZeit } from '../marken';

/**
 * `/portal/[mandant]/recruiting/datenschutz` — was wann gelöscht wird
 * (REC-07, LEG-11).
 *
 * **Die Seite zeigt eine Löschung, bevor sie geschieht, und danach, dass sie
 * geschah.** Beides gehört zusammen: eine Frist ohne Nachweis ist eine
 * Absichtserklärung, und ein Löschprotokoll ohne Vorschau überrascht die
 * Personalstelle mit einer Bewerbung, die sie noch gebraucht hätte.
 *
 * **Die Frist ist ein Platzhalter (O-373).** Die übliche Praxis leitet sich
 * aus § 15 Abs. 4 AGG und der dreimonatigen Klagefrist ab und landet in der
 * Literatur meist bei sechs Monaten — das ist eine PRAXIS und keine
 * Vorschrift. Diese Seite schreibt die Zahl deshalb hin und nennt sie
 * vorläufig, statt sie als Recht auszugeben.
 */
export const dynamic = 'force-dynamic';

export default async function Datenschutz(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const heute = await berlinHeute();
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad="datenschutz"
      titel="Datenschutz"
      kinder={async (zugang) => {
        const d = await leseImMandanten(zugang, async (kontext) => ({
          tage: await aufbewahrungTage(kontext),
          stand: await loeschStand(kontext, heute),
        }));
        const gesperrt = d.stand.faellig.filter((f) => f.loeschsperre !== null);
        /*
         * **Drei Töpfe, nicht zwei.** `zurueckgehalten` ist eine EINGESTELLTE
         * Bewerbung: der Nachtlauf nimmt sie nicht mit (O-376), weil das
         * öffentliche Formular die Löschung nur „sofern kein
         * Arbeitsverhältnis zustande kommt" zusagt. Sie deshalb gar nicht zu
         * zeigen wäre der zweite Fehler: eine Zeile, die weder gelöscht wird
         * noch irgendwo steht, ist eine, an die niemand mehr denkt.
         */
        const zurueck = d.stand.faellig.filter(
          (f) => f.loeschsperre === null && f.zurueckgehalten);
        const offen = d.stand.faellig.filter(
          (f) => f.loeschsperre === null && !f.zurueckgehalten);

        return (
          <>
            <h1 className="mb-s5 text-h1 text-text">Datenschutz und Löschung</h1>

            <Hinweis art="hinweis" cse="rec-regel" className="mb-s5 max-w-prose">
              <strong>
                Aufbewahrung: {String(d.tage)} Tage ab Eingang der Bewerbung.
              </strong>{' '}
              Die Zahl ist <strong>vorläufig</strong> (O-373) und über eine
              Zeile in den Plattformeinstellungen änderbar, ohne Code. Offen ist
              ausserdem, ob die Frist ab Eingang oder ab Absage läuft — heute ab
              Eingang, weil eine Bewerbung ohne Entscheidung sonst nie abliefe.
              {d.stand.naechste !== null && (
                <>
                  {' '}Die nächste Löschung steht am{' '}
                  <span className="tabular-nums">{d.stand.naechste}</span> an.
                </>
              )}
            </Hinweis>

            <h2 className="mb-s3 text-h3 text-text">
              Fällig zum {heute} — {String(offen.length)}
            </h2>
            {offen.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Nichts fällig.
              </p>
            ) : (
              <DataTable
                beschriftung="Bewerbungen, deren Aufbewahrungsfrist abgelaufen ist"
                zeilen={offen}
                schluessel={(f) => f.id}
                spalten={[
                  { schluessel: 'name', kopf: 'Name', zelle: (f) => f.name },
                  {
                    schluessel: 'bis',
                    kopf: 'Aufbewahrung bis',
                    zelle: (f) => <span className="tabular-nums">{f.aufbewahrungBis}</span>,
                  },
                ]}
              />
            )}

            <h2 className="mb-s3 mt-s6 text-h3 text-text">
              Gesperrt — {String(gesperrt.length)}
            </h2>
            {gesperrt.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Keine Löschsperre gesetzt. Eine Sperre hält eine Bewerbung über
                die Frist hinaus — etwa in einem laufenden AGG-Verfahren — und
                verlangt dafür einen Grund im Klartext.
              </p>
            ) : (
              <DataTable
                beschriftung="Bewerbungen mit Löschsperre"
                zeilen={gesperrt}
                schluessel={(f) => f.id}
                spalten={[
                  { schluessel: 'name', kopf: 'Name', zelle: (f) => f.name },
                  {
                    schluessel: 'bis',
                    kopf: 'Wäre fällig',
                    zelle: (f) => <span className="tabular-nums">{f.aufbewahrungBis}</span>,
                  },
                  { schluessel: 'grund', kopf: 'Grund der Sperre', zelle: (f) => f.loeschsperre ?? '—' },
                ]}
              />
            )}

            <h2 className="mb-s3 mt-s6 text-h3 text-text">
              Zurückgehalten, weil eingestellt — {String(zurueck.length)}
            </h2>
            <p className="mb-s3 max-w-prose text-sm text-text-muted" data-cse="rec-o376">
              Das Bewerbungsformular sagt zu: gelöscht nach der Frist,{' '}
              <strong className="text-text">sofern kein Arbeitsverhältnis
              zustande kommt</strong>. Diese Bewerbungen führten zu einem —
              der Nachtlauf nimmt sie deshalb nicht mit. Wie lange die
              Unterlagen eines Eingestellten bleiben und ob sie in die
              Personalakte wandern, ist eine Frage an den Mandanten und keine,
              die diese Plattform beantwortet (offene Frage O-376).
            </p>
            {zurueck.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Nichts zurückgehalten.
              </p>
            ) : (
              <DataTable
                beschriftung="Eingestellte Bewerbungen über der Frist"
                zeilen={zurueck}
                schluessel={(f) => f.id}
                spalten={[
                  { schluessel: 'name', kopf: 'Name', zelle: (f) => f.name },
                  {
                    schluessel: 'bis',
                    kopf: 'Wäre fällig',
                    zelle: (f) => <span className="tabular-nums">{f.aufbewahrungBis}</span>,
                  },
                ]}
              />
            )}

            <h2 className="mb-s3 mt-s6 text-h3 text-text">Letzte Läufe</h2>
            {d.stand.laeufe.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Der Nachtlauf ist noch nicht gelaufen. Bis dahin löscht nichts
                automatisch — und das ist der ehrliche Stand, kein Versprechen.
              </p>
            ) : (
              <DataTable
                beschriftung="Protokoll der Löschläufe"
                zeilen={d.stand.laeufe}
                schluessel={(l) => l.id}
                spalten={[
                  {
                    schluessel: 'wann',
                    kopf: 'Gelaufen (Europe/Berlin)',
                    zelle: (l) => <span className="tabular-nums">{berlinZeit(l.gelaufenAm)}</span>,
                  },
                  {
                    schluessel: 'geloescht',
                    kopf: 'Gelöscht',
                    numerisch: true,
                    zelle: (l) => String(l.geloescht),
                  },
                  {
                    schluessel: 'gesperrt',
                    kopf: 'Übersprungen (gesperrt)',
                    numerisch: true,
                    zelle: (l) => String(l.gesperrt),
                  },
                ]}
              />
            )}
          </>
        );
      }}
    />
  );
}
