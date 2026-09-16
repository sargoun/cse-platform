import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { ladeBewerbung, ladeStelle, leseBewertung } from '@/server/services/recruiting/dienst';
import { punktzahlZehntel, punkteText } from '@/server/services/recruiting/rangfolge';
import { kennungOder404 } from '../../../../../kennung';
import { RecruitingSeite, leseImMandanten } from '../../../rahmen';
import { FELD, KNOPF } from '../../../felder';

/**
 * `/portal/[mandant]/recruiting/kandidaten/[id]/bewertung` — Kriterien
 * eintragen (REC-05, REC-08, LEG-12).
 *
 * **Jedes Kriterium braucht eine Begründung, und das Feld ist Pflicht.** Eine
 * Punktzahl ohne Grund ist im AGG-Streit nichts wert: § 22 AGG kehrt die
 * Beweislast um, sobald Indizien für eine Benachteiligung vorliegen, und dann
 * muss die Gesellschaft erklären, warum sie so entschieden hat. „7 von 10"
 * erklärt nichts.
 *
 * **Die Anforderungen der Stelle stehen daneben**, damit die Kriterien GEGEN
 * sie laufen und nicht gegen ein Bauchgefühl (REC-05). Bei einer
 * Initiativbewerbung gibt es keine — dann steht das da, statt eine Liste zu
 * erfinden.
 *
 * **Die Punktzahl rechnet diese Seite nicht.** Sie kommt aus
 * `punktzahlZehntel` — einer geprüften Funktion mit ganzzahligen Zehnteln, weil
 * ein gewichtetes Mittel in Gleitkomma bei gleichen Eingaben verschiedene
 * Ergebnisse liefern kann und ein Rang daran hängt.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Bewertung — Recruiting' };

/** Fünf Zeilen: genug für eine begründete Bewertung, wenig genug zum Ausfüllen. */
const ZEILEN = [0, 1, 2, 3, 4] as const;

export default async function Bewertung(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad="kandidaten"
      titel="Bewertung"
      kinder={async (zugang) => {
        const d = await leseImMandanten(zugang, async (kontext) => {
          const b = await ladeBewerbung(kontext, id);
          return {
            b,
            stelle: b?.stelleId === null || b?.stelleId === undefined
              ? null
              : await ladeStelle(kontext, b.stelleId),
            bisher: await leseBewertung(kontext, id),
          };
        });
        if (d.b === null) notFound();

        return (
          <>
            <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
              <h1 className="m-0 text-h1 text-text">Bewertung</h1>
              <Link href={`/portal/${mandant}/recruiting/bewerbungen/${id}`} className={KNOPF}>
                Zur Bewerbung
              </Link>
            </div>
            <p className="mb-s5 text-sm text-text-muted">
              {d.b.name} · {d.b.stelleTitel ?? 'Initiativbewerbung'}
            </p>

            <Hinweis art="warnung" cse="bewertung-hinweis" className="mb-s5 max-w-prose">
              <strong>Jede Punktzahl braucht einen Grund.</strong> § 22 AGG
              kehrt die Beweislast um, sobald Indizien für eine Benachteiligung
              vorliegen — dann muss die Gesellschaft erklären, warum sie so
              entschieden hat. „7 von 10" erklärt nichts. Eine Bewertung ist
              ausserdem noch keine Entscheidung: die trifft ein benannter
              Mensch auf der nächsten Seite (REC-08, Art. 22 DSGVO).
            </Hinweis>

            {d.bisher.length > 0 && (
              <div className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s5">
                <p className="m-0 text-sm text-text">
                  Bereits erfasst: {String(d.bisher.length)} Kriterien, Punktzahl{' '}
                  <strong className="tabular-nums">
                    {punkteText(punktzahlZehntel(d.bisher))}
                  </strong>. Was Sie hier ergänzen, kommt hinzu — eine
                  Bewertung wird nicht überschrieben, weil sonst niemand mehr
                  sähe, was zuerst dastand.
                </p>
              </div>
            )}

            {d.stelle !== null && d.stelle.anforderungen.length > 0 && (
              <>
                <h2 className="mb-s3 text-h3 text-text">Anforderungen dieser Stelle</h2>
                <ul className="mb-s5 m-0 max-w-prose list-disc pl-s5 text-sm text-text">
                  {d.stelle.anforderungen.map((a) => <li key={a}>{a}</li>)}
                </ul>
              </>
            )}

            <form method="post" action={`/api/recruiting/bewerbungen/${id}/bewertung`}
                  data-cse="bewertung-formular"
                  className="flex max-w-prose flex-col gap-s5">
              <input type="hidden" name="mandant" value={mandant} />
              <input type="hidden" name="zurueck"
                     value={`/portal/${mandant}/recruiting/kandidaten/${id}/bewertung`} />

              {ZEILEN.map((i) => (
                <fieldset key={i} data-cse="bewertung-zeile"
                          className="flex flex-col gap-s2 rounded-lg border border-line p-s4">
                  <legend className="px-s2 text-xs text-text-muted">
                    Kriterium {String(i + 1)}
                  </legend>
                  <input name="kriterium" maxLength={120} className={FELD}
                         placeholder="Anforderung, gegen die geprüft wird"
                         data-cse="kriterium-name" />
                  <div className="flex flex-wrap gap-s3">
                    <label className="flex flex-1 flex-col gap-s2 text-xs text-text-muted">
                      Gewicht (0–100)
                      <input name="gewicht" type="number" min="0" max="100" step="1"
                             defaultValue="0" className={FELD} data-cse="kriterium-gewicht" />
                    </label>
                    <label className="flex flex-1 flex-col gap-s2 text-xs text-text-muted">
                      Punkte (0–10)
                      <input name="punkte" type="number" min="0" max="10" step="1"
                             defaultValue="0" className={FELD} data-cse="kriterium-punkte" />
                    </label>
                  </div>
                  <textarea name="begruendung" rows={2} className={FELD}
                            placeholder="Warum diese Punktzahl — in einem Satz"
                            data-cse="kriterium-begruendung" />
                </fieldset>
              ))}

              <p className="max-w-prose text-xs text-text-subtle">
                Zeilen ohne Kriterium werden übergangen. Eine Zeile mit
                Kriterium ohne Begründung wird abgewiesen — das ist kein
                Formfehler, sondern der Zweck der Begründung.
              </p>

              <Button type="submit" variante="primary" data-cse="bewertung-speichern">
                Bewertung speichern
              </Button>
            </form>
          </>
        );
      }}
    />
  );
}
