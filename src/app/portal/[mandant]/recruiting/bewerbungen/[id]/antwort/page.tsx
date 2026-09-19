import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { ladeBewerbung } from '@/server/services/recruiting/dienst';
import {
  ANTWORT_ARTEN, ART_TEXT, liste, type AntwortArt, type AntwortStand,
} from '@/server/services/recruiting/antwort';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../../kennung';
import { RecruitingSeite, leseImMandanten } from '../../../rahmen';
import { FELD, KNOPF } from '../../../felder';

/**
 * `/portal/[mandant]/recruiting/bewerbungen/[id]/antwort` — die Antwort an eine
 * Bewerberin (REC-03, § 22 AGG, Invariante 7).
 *
 * **Diese Seite sagt drei Dinge, bevor sie irgendetwas anbietet:**
 *
 *  1. Dass eine Absage keinen Grund nennt — und warum. Wer das nicht liest,
 *     ergänzt einen Satz aus Höflichkeit, und genau dieser Satz ist im
 *     AGG-Streit das Indiz.
 *  2. Dass nichts hinausgeht, bevor ein Mensch freigegeben hat.
 *  3. Dass heute gar nichts hinausgeht, weil kein Postausgang verbunden ist
 *     (O-501). Das steht VORHER da und nicht als Fehlermeldung hinterher: ein
 *     Knopf, der erst beim Drücken sagt, dass er nicht darf, sieht aus wie ein
 *     Defekt.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Antwort — Recruiting' };

const STAND_PILLE: Readonly<Record<AntwortStand, PillZustand>> = {
  entwurf: 'Offen',
  wartet_auf_freigabe: 'In Arbeit',
  freigegeben: 'Bereit',
  gesendet: 'Abgeschlossen',
  verworfen: 'Archiviert',
};

const STAND_WORT: Readonly<Record<AntwortStand, string>> = {
  entwurf: 'Entwurf — noch niemand hat ihn gelesen',
  wartet_auf_freigabe: 'Liegt im Freigabe-Posteingang',
  freigegeben: 'Freigegeben, aber noch nicht hinaus',
  gesendet: 'Hinausgegangen',
  verworfen: 'Verworfen',
};

export default async function Antwortseite(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const hinweis = typeof suche['hinweis'] === 'string' ? suche['hinweis'] : null;
  const pfad = `/portal/${mandant}/recruiting/bewerbungen/${id}/antwort`;

  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad={`bewerbungen/${id}/antwort`}
      titel="Antwort"
      kinder={async (zugang) => {
        /*
         * **Auch die Rechte der ZIELE, nicht nur der eigenen Knöpfe** (AUT-06).
         * Ein Verweis auf eine Seite, die diese Sitzung nicht öffnen darf,
         * führt auf 404 — und ein Menüpunkt, der ins Leere geht, ist schlechter
         * als keiner. `verweis-rechte.test.ts` zählt genau das nach.
         */
        const darf = await haeltRechte(
          zugang.sitzung, 'recruiting.bewerbung_bewerten', 'recruiting.entscheiden',
          'recruiting.bewerbung_lesen', 'freigabe.entscheiden');
        const d = await leseImMandanten(zugang, async (kontext) => ({
          b: await ladeBewerbung(kontext, id),
          antworten: await liste(kontext, id),
        }));
        if (d.b === null) notFound();

        const vorhanden = new Set(d.antworten.map((a) => a.art));
        const offeneArten = ANTWORT_ARTEN.filter((a) => !vorhanden.has(a));

        return (
          <>
            <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
              <h1 className="m-0 text-h1 text-text">{`Antwort an ${d.b.name}`}</h1>
              {darf['recruiting.bewerbung_lesen'] === true && (
                <Link href={`/portal/${mandant}/recruiting/bewerbungen/${id}`}
                      className={KNOPF}>
                  Zurück zur Bewerbung
                </Link>
              )}
            </div>

            {/*
              * Der AGG-Satz steht GANZ OBEN und nicht bei der Absage. Wer bis
              * zum Absageformular scrollt, hat schon entschieden, was er
              * schreiben will.
              */}
            <Hinweis art="hinweis" cse="agg-hinweis" className="mb-s5 max-w-prose">
              <strong className="block">Eine Absage nennt keinen Grund.</strong>
              § 22 AGG kehrt die Beweislast um: wer Indizien für eine Benachteiligung
              vorträgt, zwingt das Unternehmen zum Gegenbeweis. Jeder Satz wie „wir
              suchen jemanden mit mehr Erfahrung" ist in der Hand eines Anwalts ein
              Altersindiz. Die Begründung verschwindet nicht — sie steht in der
              Entscheidung, wo sie den sachlichen Grund <em>belegt</em>, statt im
              Brief, wo sie ihn <em>angreifbar</em> macht. Die Datenbank weist einen
              Antworttext ab, der die interne Begründung übernommen hat.
            </Hinweis>

            <Hinweis art="warnung" cse="postausgang" className="mb-s5 max-w-prose">
              <strong className="block">Es ist kein Postausgang verbunden.</strong>
              Ein freigegebener Text bleibt deshalb stehen, und neben ihm steht der
              Grund. Offen ist O-501: welcher in der EU gehostete Anbieter mit
              AV-Vertrag, welche Absenderadresse je Gesellschaft, und ob DKIM und
              DMARC über die bestehenden Domains laufen.
            </Hinweis>

            {hinweis === 'versand' && (
              <Hinweis art="warnung" cse="versand-fehlgeschlagen" className="mb-s5 max-w-prose">
                Es ging nichts hinaus. Der Grund steht unten am Entwurf.
              </Hinweis>
            )}

            {d.antworten.length === 0 ? (
              <p className="mb-s5 max-w-prose text-sm text-text-muted">
                Für diese Bewerbung gibt es noch keinen Antwortentwurf.
              </p>
            ) : (
              <div className="mb-s5 flex flex-col gap-s5">
                {d.antworten.map((a) => (
                  <Card key={a.id}>
                    <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
                      <h2 className="m-0 text-h3 text-text">{ART_TEXT[a.art]}</h2>
                      <span>
                        <StatusPill zustand={STAND_PILLE[a.stand]} />
                        <span className="ml-s2 text-xs text-text-muted">
                          {STAND_WORT[a.stand]}
                        </span>
                      </span>
                    </div>

                    {a.stand === 'entwurf' && darf['recruiting.bewerbung_bewerten'] === true ? (
                      <form method="post" action="/api/recruiting/antwort"
                            data-cse="antwort-aendern"
                            className="flex max-w-prose flex-col gap-s3">
                        <input type="hidden" name="handlung" value="aendern" />
                        <input type="hidden" name="antwort" value={a.id} />
                        <input type="hidden" name="zurueck" value={pfad} />
                        <label htmlFor={`betreff-${a.id}`} className="text-xs text-text-muted">
                          Betreff
                        </label>
                        <input id={`betreff-${a.id}`} name="betreff" defaultValue={a.betreff}
                               className={FELD} />
                        <label htmlFor={`text-${a.id}`} className="text-xs text-text-muted">
                          Text
                        </label>
                        <textarea id={`text-${a.id}`} name="text" rows={12}
                                  defaultValue={a.text} className={FELD} />
                        <Button type="submit" variante="secondary" className="self-start">
                          Text speichern
                        </Button>
                      </form>
                    ) : (
                      <>
                        <p className="m-0 mb-s3 text-sm font-medium text-text">{a.betreff}</p>
                        <pre className="m-0 overflow-x-auto whitespace-pre-wrap rounded-md border border-line bg-surface-2 p-s4 font-sans text-sm text-text">
                          {a.text}
                        </pre>
                      </>
                    )}

                    {a.versandFehler === null ? null : (
                      <Hinweis art="warnung" cse="antwort-versandfehler" className="mt-s4">
                        {a.versandFehler}
                      </Hinweis>
                    )}

                    <div className="mt-s4 flex flex-wrap gap-s3">
                      {a.stand === 'entwurf' && darf['recruiting.entscheiden'] === true && (
                        <form method="post" action="/api/recruiting/antwort">
                          <input type="hidden" name="handlung" value="vorlegen" />
                          <input type="hidden" name="antwort" value={a.id} />
                          <input type="hidden" name="zurueck" value={pfad} />
                          <Button type="submit" variante="primary" data-cse="antwort-vorlegen">
                            Zur Freigabe geben
                          </Button>
                        </form>
                      )}
                      {a.stand === 'freigegeben' && darf['recruiting.entscheiden'] === true && (
                        <form method="post" action="/api/recruiting/antwort">
                          <input type="hidden" name="handlung" value="senden" />
                          <input type="hidden" name="antwort" value={a.id} />
                          <input type="hidden" name="zurueck" value={pfad} />
                          <Button type="submit" variante="primary" data-cse="antwort-senden">
                            Jetzt senden
                          </Button>
                        </form>
                      )}
                      {a.freigabeId !== null && darf['freigabe.entscheiden'] === true && (
                        <Link href={`/portal/${mandant}/freigaben/${a.freigabeId}`}
                              className={KNOPF}>
                          Zur Freigabe
                        </Link>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {darf['recruiting.bewerbung_bewerten'] === true && offeneArten.length > 0 && (
              <Card>
                <h2 className="mb-s3 mt-0 text-h3 text-text">Neuen Entwurf anlegen</h2>
                <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
                  Je Art einmal. Zwei Absagen an dieselbe Person sind eine zu viel.
                </p>
                <div className="flex flex-wrap gap-s3">
                  {offeneArten.map((art: AntwortArt) => (
                    <form key={art} method="post" action="/api/recruiting/antwort"
                          className="flex flex-col gap-s2">
                      <input type="hidden" name="handlung" value="entwerfen" />
                      <input type="hidden" name="bewerbung" value={id} />
                      <input type="hidden" name="art" value={art} />
                      <input type="hidden" name="zurueck" value={pfad} />
                      {art === 'rueckfrage' && (
                        <input name="offen" required placeholder="Was fehlt?"
                               className={FELD} data-cse="rueckfrage-offen" />
                      )}
                      <Button type="submit" variante="secondary"
                              data-cse={`entwerfen-${art}`}>
                        {ART_TEXT[art]}
                      </Button>
                    </form>
                  ))}
                </div>
              </Card>
            )}
          </>
        );
      }}
    />
  );
}
