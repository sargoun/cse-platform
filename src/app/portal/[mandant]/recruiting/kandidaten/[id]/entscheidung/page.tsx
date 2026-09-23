import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { ladeBewerbung, leseBewertung } from '@/server/services/recruiting/dienst';
import { punktzahlZehntel, punkteText } from '@/server/services/recruiting/rangfolge';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../../kennung';
import { RecruitingSeite, leseImMandanten } from '../../../rahmen';
import { FELD, KNOPF } from '../../../felder';
import { BEWERBUNG_TEXT } from '../../../marken';
import { grundAus, RecruitingRueckmeldung } from '../../../rueckmeldung';

/**
 * `/portal/[mandant]/recruiting/kandidaten/[id]/entscheidung` — die
 * Entscheidung (REC-08, LEG-12, Art. 22 DSGVO).
 *
 * **Diese Seite ist der einzige Ort, an dem eine Bewerbung abgelehnt oder
 * angenommen wird, und sie verlangt zwei Dinge: einen benannten Menschen und
 * eine Begründung.**
 *
 * Der benannte Mensch ist keine Formsache. Art. 22 DSGVO verbietet eine
 * Entscheidung, die ausschliesslich auf automatisierter Verarbeitung beruht
 * und rechtliche Wirkung entfaltet — eine Absage tut das. Der Riegel steht
 * deshalb nicht nur hier, sondern in der Datenbank: der Auslöser
 * `entscheidung_ist_menschlich` weist jede Zeile ab, deren Akteur kein Mensch
 * ist. Ein Agent, der diese Route aufriefe, bekäme `insufficient_privilege` —
 * nicht eine höfliche Fehlermeldung, sondern eine Abweisung.
 *
 * **Die Punktzahl steht hier als KONTEXT, nicht als Vorschlag.** Sie
 * entscheidet nichts; wer sie übergeht, muss das nicht begründen. Wer ihr
 * folgt, auch nicht — begründet wird die Entscheidung, nicht die Abweichung
 * von einer Zahl.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Entscheidung — Recruiting' };

export default async function Entscheidung(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  /* V-148: die Abweisung kommt als `?fehler=` auf DIESE Seite zurück. */
  const grund = grundAus(await searchParams);
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad={`kandidaten/${id}/entscheidung`}
      titel="Entscheidung"
      kinder={async (zugang) => {
        /*
         * `/recruiting/bewerbungen/[id]` verlangt laut Manifest
         * `recruiting.bewerbung_lesen`; diese Seite nur `recruiting.entscheiden`.
         * Wer entscheiden darf, aber nicht lesen, bekam hinter „Zur Bewerbung"
         * einen 404 — und ein Verweis auf 404 verrät, was er nicht zeigen
         * darf (AUT-06, Copilot-Runde auf PR 16 / D-581).
         */
        const darf = await haeltRechte(zugang.sitzung, 'recruiting.bewerbung_lesen');
        const d = await leseImMandanten(zugang, async (kontext) => ({
          b: await ladeBewerbung(kontext, id),
          kriterien: await leseBewertung(kontext, id),
        }));
        if (d.b === null) notFound();
        const b = d.b;
        const schonEntschieden = b.entschiedenAm !== null;

        return (
          <>
            <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
              <h1 className="m-0 text-h1 text-text">Entscheidung</h1>
              {darf['recruiting.bewerbung_lesen'] === true && (
                <Link href={`/portal/${mandant}/recruiting/bewerbungen/${id}`} className={KNOPF}>
                  Zur Bewerbung
                </Link>
              )}
            </div>
            <p className="mb-s5 text-sm text-text-muted">
              {b.name} · {b.stelleTitel ?? 'Initiativbewerbung'}
            </p>

            <RecruitingRueckmeldung sprache={zugang.sprache} seite="entscheidung"
                                    grund={grund} />

            {schonEntschieden ? (
              <Hinweis art="hinweis" cse="schon-entschieden" className="max-w-prose">
                <strong>
                  Diese Bewerbung ist bereits entschieden: {BEWERBUNG_TEXT[b.status]}.
                </strong>{' '}
                Eine Entscheidung gibt es je Bewerbung genau einmal
                (`entscheidung_je_bewerbung`). Sie zu überschreiben hiesse, den
                Stand zu ändern, auf den sich jemand berufen hat — was sich
                korrigieren lässt, ist der Status der Bewerbung, nicht die
                Entscheidung selbst.
              </Hinweis>
            ) : (
              <>
                <Hinweis art="warnung" cse="entscheidung-hinweis" className="mb-s5 max-w-prose">
                  <strong>Diese Entscheidung trifft ein Mensch, und sie wird
                  mit Ihrem Namen festgehalten.</strong> Art. 22 DSGVO verbietet
                  eine Ablehnung allein aufgrund automatisierter Verarbeitung;
                  die Datenbank weist jede Entscheidung ab, deren Akteur kein
                  Mensch ist. Die Begründung ist Pflicht — im AGG-Streit ist sie
                  das, was zählt.
                </Hinweis>

                {d.kriterien.length > 0 && (
                  <p className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text">
                    Zur Einordnung: {String(d.kriterien.length)} Kriterien,
                    Punktzahl{' '}
                    <strong className="tabular-nums">
                      {punkteText(punktzahlZehntel(d.kriterien))}
                    </strong>.{' '}
                    <span className="text-text-muted">
                      Die Zahl entscheidet nichts. Sie steht hier, weil sie
                      erklärt, was vorher geprüft wurde — nicht, was jetzt zu
                      tun ist.
                    </span>
                  </p>
                )}

                <form method="post" action={`/api/recruiting/bewerbungen/${id}/entscheidung`}
                      data-cse="entscheidung-formular"
                      className="flex max-w-prose flex-col gap-s4">
                  <input type="hidden" name="mandant" value={mandant} />
                  <input type="hidden" name="zurueck"
                         value={`/portal/${mandant}/recruiting/kandidaten/${id}/entscheidung`} />

                  <fieldset className="flex flex-col gap-s2 border-0 p-0">
                    <legend className="text-xs text-text-muted">Ergebnis</legend>
                    <label className="flex min-h-11 items-center gap-s3 text-sm text-text">
                      <input type="radio" name="ergebnis" value="eingestellt" required
                             className="size-4 accent-[var(--brand)]"
                             data-cse="ergebnis-eingestellt" />
                      <span>Eingestellt</span>
                    </label>
                    <label className="flex min-h-11 items-center gap-s3 text-sm text-text">
                      <input type="radio" name="ergebnis" value="abgelehnt"
                             className="size-4 accent-[var(--brand)]"
                             data-cse="ergebnis-abgelehnt" />
                      <span>Abgelehnt</span>
                    </label>
                  </fieldset>

                  <div className="flex flex-col gap-s2">
                    <label htmlFor="begruendung" className="text-xs text-text-muted">
                      Begründung
                    </label>
                    <textarea id="begruendung" name="begruendung" required rows={5}
                              className={FELD} data-cse="entscheidung-begruendung" />
                    <p className="text-xs text-text-subtle">
                      Sachlich und auf die Anforderungen bezogen. Sie wird
                      aufbewahrt und ist im Streitfall das Dokument, das die
                      Gesellschaft vorlegt.
                    </p>
                  </div>

                  <Button type="submit" variante="primary" data-cse="entscheidung-speichern">
                    Entscheidung festhalten
                  </Button>
                </form>
              </>
            )}
          </>
        );
      }}
    />
  );
}
