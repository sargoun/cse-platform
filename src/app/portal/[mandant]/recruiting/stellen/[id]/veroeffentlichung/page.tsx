import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { ladeStelle, leseVeroeffentlichungen } from '@/server/services/recruiting/dienst';
import { BOERSE_NAME, stand, type Boerse } from '@/server/versand/stellenboerse';
import { kennungOder404 } from '../../../../../kennung';
import { RecruitingSeite, leseImMandanten } from '../../../rahmen';
import { KNOPF } from '../../../felder';
import { berlinZeit } from '../../../marken';

/**
 * `/portal/[mandant]/recruiting/stellen/[id]/veroeffentlichung` — wohin eine
 * Stelle geht (REC-09, D-02).
 *
 * **Jedes Ziel steht hier, auch das, das nicht geht — und es steht dabei,
 * warum.** Eine Liste, in der ein Ziel einfach fehlt, liest sich wie „geht
 * nicht"; die Wahrheit ist „noch nicht beauftragt" (O-374). Das ist ein
 * Unterschied, den nur jemand auflösen kann, der weiss, dass er besteht.
 *
 * **Es gibt keinen Demo-Zweig.** Ein Versuch gegen eine unverbundene Börse
 * endet mit `409 kanal_nicht_verbunden`, und die Antwort wird als Ergebnis
 * vermerkt — mit Datum und Grund. Ein erfundener Erfolg wäre ein Beleg für
 * etwas, das nie geschah (D-02, R-17).
 *
 * **Die Karriereseite ist der eine Kanal, der ohne fremden Vertrag geht.** Sie
 * gehört dieser Plattform; eine veröffentlichte Stelle steht dort sofort.
 */
export const dynamic = 'force-dynamic';

export default async function Veroeffentlichung(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  return (
    /*
     * **`unterpfad` ist hier die eigene Seite, nicht „stellen".**
     *
     * `RecruitingSeite` baut daraus den Pfad, gegen den `mandantTor` das
     * Routenmanifest fragt. Mit `"stellen"` wurde diese Seite mit dem
     * MILDEREN Recht `recruiting.stelle_schreiben` geöffnet, obwohl das
     * Manifest für `…/[id]/veroeffentlichung` ausdrücklich
     * `recruiting.stelle_veroeffentlichen` verlangt: wer schreiben, aber
     * nicht veröffentlichen darf, sah die Börsenliste und die Versandformulare
     * und lief erst beim POST in ein 404. Gemeldet hat das die Copilot-Runde
     * auf PR 16.
     *
     * Die Sprungzeile bleibt dieselbe — sie wird aus `SPRUNGZIELE` gebaut und
     * nicht aus `unterpfad`; nur die Hervorhebung des aktiven Punktes entfällt
     * hier, und das ist richtig: diese Seite IST kein Punkt der Zeile.
     */
    <RecruitingSeite
      mandant={mandant}
      unterpfad={`stellen/${id}/veroeffentlichung`}
      titel="Veröffentlichung"
      kinder={async (zugang) => {
        const d = await leseImMandanten(zugang, async (kontext) => ({
          stelle: await ladeStelle(kontext, id),
          wege: await leseVeroeffentlichungen(kontext, id),
        }));
        if (d.stelle === null) notFound();
        const s = d.stelle;
        const boersen = stand();
        const jeBoerse = new Map(d.wege.map((w) => [w.boerse, w]));

        return (
          <>
            <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
              <h1 className="m-0 text-h1 text-text">Veröffentlichung</h1>
              <Link href={`/portal/${mandant}/recruiting/stellen/${id}`} className={KNOPF}>
                Zurück zur Stelle
              </Link>
            </div>
            <p className="mb-s5 max-w-prose text-sm text-text-muted">{s.titel}</p>

            <h2 className="mb-s3 text-h3 text-text">Karriereseite dieser Plattform</h2>
            <div className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5">
              <p className="m-0 text-sm text-text">
                <strong className="text-success">Verbunden.</strong> Eine
                freigegebene und veröffentlichte Stelle steht sofort unter{' '}
                <code className="break-all">/karriere</code> — ohne Vertrag,
                ohne fremde Kennung.
              </p>
              <p className="m-0 mt-s3 text-sm text-text-muted">
                Status dieser Stelle:{' '}
                {s.status === 'veroeffentlicht'
                  ? `veröffentlicht seit ${s.veroeffentlichtAm === null ? '—' : berlinZeit(s.veroeffentlichtAm)}`
                  : s.status === 'freigegeben'
                    ? 'freigegeben — sie darf hinaus, steht aber noch nicht auf der Karriereseite'
                    : 'noch nicht freigegeben — sie braucht zuerst eine Freigabe (Invariante 7)'}
              </p>
              {/*
                * **Der Knopf, der gefehlt hat.** Die Freigabe bringt die
                * Anzeige auf `freigegeben`; `/karriere` zeigt nur
                * `veroeffentlicht`. Ohne diesen Schritt blieb jede im Portal
                * angelegte Stelle für immer unsichtbar (D-585). Veröffentlicht
                * wird von einem Menschen, nicht im Augenblick der Genehmigung
                * — dieselbe Entscheidung wie bei Social (D-556).
                */}
              {s.status === 'freigegeben' && s.geschlossenAm === null && (
                <form method="post"
                      action={`/api/recruiting/stellen/${id}/veroeffentlichen`}
                      className="mt-s4">
                  <input type="hidden" name="mandant" value={mandant} />
                  <input type="hidden" name="boerse" value="karriereseite" />
                  <input type="hidden" name="zurueck"
                         value={`/portal/${mandant}/recruiting/stellen/${id}/veroeffentlichung`} />
                  <Button type="submit" variante="primary" data-cse="karriereseite-veroeffentlichen">
                    Auf der Karriereseite veröffentlichen
                  </Button>
                </form>
              )}
            </div>

            <h2 className="mb-s3 text-h3 text-text">Jobbörsen</h2>
            <Hinweis art="warnung" cse="boersen-hinweis" className="mb-s5 max-w-prose">
              <strong>Keine dieser Börsen ist verbunden.</strong> Das ist kein
              Fehler dieser Seite, sondern der Stand: für keine liegt ein
              Vertrag und eine freigeschaltete Kennung vor (O-374). Ein Versuch
              wird vermerkt und schlägt fehl — es gibt keinen Demo-Erfolg
              (D-02).
            </Hinweis>

            <ul className="m-0 flex list-none flex-col gap-s3 p-0">
              {boersen.map((b) => {
                const vermerk = jeBoerse.get(b.boerse);
                return (
                  <li key={b.boerse} data-cse="boerse"
                      data-boerse={b.boerse} data-verbunden={String(b.verbunden)}
                      className="rounded-lg border border-line bg-surface p-s4">
                    <div className="flex flex-wrap items-baseline justify-between gap-s3">
                      <strong className="text-sm text-text">
                        {BOERSE_NAME[b.boerse as Boerse]}
                      </strong>
                      <span className={b.verbunden ? 'text-success text-xs' : 'text-warning text-xs'}>
                        {b.verbunden ? 'verbunden' : 'nicht verbunden'}
                      </span>
                    </div>
                    <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">{b.grund}</p>
                    {vermerk !== undefined && (
                      <p className="m-0 mt-s2 text-xs text-text-subtle">
                        Letzter Versuch: {vermerk.ergebnis}
                        {vermerk.meldung !== null && ` — ${vermerk.meldung}`}
                      </p>
                    )}
                    <form method="post"
                          action={`/api/recruiting/stellen/${id}/veroeffentlichen`}
                          className="mt-s3">
                      <input type="hidden" name="mandant" value={mandant} />
                      <input type="hidden" name="boerse" value={b.boerse} />
                      <input type="hidden" name="zurueck"
                             value={`/portal/${mandant}/recruiting/stellen/${id}/veroeffentlichung`} />
                      <Button type="submit" data-cse="boerse-senden">
                        Versuchen und vermerken
                      </Button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </>
        );
      }}
    />
  );
}
