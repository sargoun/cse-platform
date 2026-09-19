import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import {
  ERGEBNIS_TEXT, FELDER, editorPfad, liste,
  type BerichtigungErgebnis, type FeldZeile,
} from '@/server/services/datenschutz/berichtigung';
import { ladeVorgang } from '../../vorgang';
import { BERLIN, Vorgangskopf } from '../../Vorgangskopf';

/**
 * `/portal/[mandant]/datenschutz/[id]/berichtigung` — Art. 16 und Art. 19 DSGVO
 * (LEG-09).
 *
 * **Sie ändert fremde Tabellen nicht, und das ist keine Lücke.** Die Korrektur
 * geschieht im zuständigen Editor — Personalakte, CRM-Kontakt, Bewerbung —,
 * weil dort die Schreibrechte, die Prüfungen und die Fachlogik sitzen. Ein
 * zweiter Schreibweg „von der Datenschutzseite aus" wäre ein Weg um jede
 * dieser Prüfungen herum. Hier wird festgehalten, WAS berichtigt wurde, von
 * welchem Wert auf welchen und von wem.
 *
 * **Der gespeicherte Wert wird bei der Aufnahme MITGESCHRIEBEN.** Nach der
 * Berichtigung ist er fort; ein Nachweis, der ihn erst im Moment der Vorlage
 * liest, zeigte dann den neuen Wert auf beiden Seiten und belegte nichts.
 *
 * **Art. 19 steht als eigene Spalte da, nicht als Fussnote.** Wer die
 * unrichtigen Daten bekommen hat, muss die Berichtigung erfahren — Lohnbüro,
 * Auftraggeber, Behörde. Wer das war, weiss die Plattform nicht; also benennt
 * es ein Mensch, und die Spalte zeigt, ob er es getan hat.
 *
 * **Das Recht dieser Seite ist `datenschutz.berichtigung_bearbeiten`**, und
 * seit `0220` sieht ein Träger dieses Rechts den Vorgang auch: die RLS von
 * `0176` kannte nur `datenschutz.auskunft_erstellen`, und wer nur berichtigen
 * durfte, kam durch das Tor und las null Zeilen — eine leere Seite statt einer
 * Arbeitsliste.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Berichtigung (Art. 16) — Datenschutz' };

const ERGEBNIS_PILLE: Readonly<Record<BerichtigungErgebnis, PillZustand>> = {
  offen: 'Offen',
  berichtigt: 'Abgeschlossen',
  ergaenzt: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
};

export default async function Berichtigungsseite(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const tor = await mandantTor(
    `/portal/${mandant}/datenschutz/${id}/berichtigung`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const { z, zuordnung, darf, extra: felder } = await ladeVorgang<readonly FeldZeile[]>(
    zugang, mandant, id, [],
    async (kontext, v) => liste(kontext, v.z.id),
  );

  const darfSchreiben = darf['datenschutz.berichtigung_bearbeiten'] === true;
  /* Die Akte verlangt `datenschutz.auskunft_erstellen`; wer nur berichtigen
     darf, bekaeme hinter dem Verweis ein 404 (AUT-06, D-567). */
  const darfAkte = darf['datenschutz.auskunft_erstellen'] === true;
  const erledigt = ['beantwortet', 'abgelehnt'].includes(z.status);
  const zurueck = `/portal/${mandant}/datenschutz/${z.id}/berichtigung`;
  const feld = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';
  const vorschlaege = zuordnung.art === 'keine' ? [] : FELDER[zuordnung.art];
  const editor = editorPfad(mandant, zuordnung.art, zuordnung.id);
  const offen = felder.filter((f) => f.ergebnis === 'offen');
  const zuUnterrichten = felder.filter(
    (f) => (f.ergebnis === 'berichtigt' || f.ergebnis === 'ergaenzt')
      && f.art19UnterrichtetAm === null);

  return (
    <PortalRahmen
      titel="Berichtigung (Art. 16)"
      wurzelTitel="Datenschutz"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <Vorgangskopf mandant={mandant} z={z} zuordnung={zuordnung} aktiv="berichtigung"
                    darf={darf} />

      <Hinweis art="hinweis" cse="berichtigung-erklaerung" className="mb-s6 max-w-prose">
        <strong className="block">Diese Seite korrigiert nichts selbst.</strong>
        Sie hält fest, was strittig ist und wie entschieden wurde. Geändert wird im
        zuständigen Editor — dort sitzen die Schreibrechte und die Prüfungen. Die
        Spur der Änderung selbst liegt ohnehin im Prüfprotokoll.
        {editor === null ? (
          zuordnung.art === 'ansprechpartner' ? (
            <span className="mt-s2 block">
              Ein Ansprechpartner wird auf der Seite seines Kunden bearbeitet
              {zuordnung.pfad === null ? '.' : (
                <>
                  {': '}
                  {/* `<a>`, nicht `Link`: das Ziel entsteht zur Laufzeit im
                      Dienst, und `typedRoutes` kennt nur Literale. */}
                  <a href={zuordnung.pfad}
                     className="underline-offset-2 hover:text-text hover:underline">
                    dorthin
                  </a>
                </>
              )}
            </span>
          ) : null
        ) : (
          <span className="mt-s2 block">
            <a href={editor} data-cse="berichtigung-editor"
               className="underline-offset-2 hover:text-text hover:underline">
              Zum Datensatz
            </a>
          </span>
        )}
      </Hinweis>

      <Hinweis art="warnung" cse="berichtigung-art19" className="mb-s6 max-w-prose">
        <strong className="block">Art. 19 DSGVO wird leicht vergessen.</strong>
        Wer den falschen Wert bekommen hat, muss die Berichtigung erfahren — und
        wer das war, weiss die Plattform nicht: Lohnbüro, Auftraggeber und Behörde
        stehen nirgends als Empfängerliste. Benennen Sie sie je Feld, dann steht
        im Nachweis, dass es geschehen ist.
        {zuUnterrichten.length > 0 ? (
          <span className="mt-s2 block" data-cse="art19-offen">
            {`${String(zuUnterrichten.length)} berichtigte(s) Feld(er) ohne Unterrichtung.`}
          </span>
        ) : null}
      </Hinweis>

      {zuordnung.art === 'keine' ? (
        <Hinweis art="warnung" cse="berichtigung-ohne-zuordnung" className="mb-s6 max-w-prose">
          <strong className="block">Dieser Vorgang ist keinem Datensatz zugeordnet.</strong>
          Welches Feld falsch ist, lässt sich ohne den Datensatz nicht sagen.{' '}
          {darfAkte ? (
            <Link href={`/portal/${mandant}/datenschutz/${z.id}`}
                  className="underline-offset-2 hover:text-text hover:underline">
              Zuerst zuordnen
            </Link>
          ) : 'Zuerst zuordnen — auf der Vorgangsseite.'}
        </Hinweis>
      ) : null}

      <section aria-labelledby="felder" className="mb-s7">
        <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 id="felder" className="m-0 text-h2 text-text">Strittige Felder</h2>
          <p className="m-0 text-sm text-text-muted">
            {`${String(offen.length)} offen von ${String(felder.length)}`}
          </p>
        </div>

        {felder.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Noch kein Feld aufgenommen. Nehmen Sie unten auf, was die Person als
            falsch bezeichnet — ein Feld je Zeile, mit dem gespeicherten und dem
            behaupteten Wert.
          </p>
        ) : (
          <DataTable
            beschriftung="Strittige Felder, ihr Stand und die Art.-19-Unterrichtung"
            zeilen={[...felder]}
            schluessel={(f) => f.id}
            spalten={[
              {
                schluessel: 'ort',
                kopf: 'Feld',
                zelle: (f) => (
                  <span>
                    {f.feld}
                    <span className="block font-mono text-xs text-text-muted">
                      {f.tabelle}
                    </span>
                  </span>
                ),
              },
              {
                schluessel: 'gespeichert',
                kopf: 'Gespeichert',
                zelle: (f) => f.wertGespeichert ?? '—',
              },
              {
                schluessel: 'behauptet',
                kopf: 'Als richtig angegeben',
                zelle: (f) => f.wertBehauptet ?? '—',
              },
              {
                schluessel: 'quelle',
                kopf: 'Herkunft des Wertes',
                zelle: (f) => f.quelle ?? '—',
              },
              {
                schluessel: 'stand',
                kopf: 'Stand',
                zelle: (f) => (
                  <span>
                    <StatusPill zustand={ERGEBNIS_PILLE[f.ergebnis]} />
                    <span className="block text-xs text-text-muted">
                      {ERGEBNIS_TEXT[f.ergebnis]}
                    </span>
                    {f.berichtigtAm === null ? null : (
                      <span className="block text-xs text-text-muted">
                        {`${BERLIN.format(new Date(f.berichtigtAm))} · ${f.berichtigtVon ?? '—'}`}
                      </span>
                    )}
                    {f.begruendung === null ? null : (
                      <span className="block text-xs text-text-muted">{f.begruendung}</span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'art19',
                kopf: 'Art. 19 — unterrichtet',
                zelle: (f) => (f.art19UnterrichtetAm === null
                  ? (f.ergebnis === 'berichtigt' || f.ergebnis === 'ergaenzt'
                    ? <span className="text-warning">offen</span>
                    : <span className="text-text-subtle">—</span>)
                  : (
                    <span>
                      {BERLIN.format(new Date(f.art19UnterrichtetAm))}
                      <span className="block text-xs text-text-muted">
                        {f.art19Empfaenger ?? '—'}
                      </span>
                    </span>
                  )),
              },
              {
                schluessel: 'handlung',
                kopf: '',
                zelle: (f) => (!darfSchreiben || erledigt
                  ? <span className="text-text-subtle">—</span>
                  : (
                    <details data-cse="feld-entscheiden">
                      <summary className="cursor-pointer text-sm text-brand">
                        Entscheiden
                      </summary>
                      <form method="post" action="/api/datenschutz/berichtigung"
                            className="mt-s3 flex flex-col gap-s2">
                        <input type="hidden" name="feldId" value={f.id} />
                        <input type="hidden" name="handlung" value="entscheiden" />
                        <input type="hidden" name="zurueck" value={zurueck} />
                        <textarea name="begruendung" rows={3} className={feld}
                                  data-cse="feld-begruendung"
                                  placeholder="Bei Ablehnung Pflicht: warum ist der gespeicherte Wert richtig?" />
                        <div className="flex flex-wrap gap-s2">
                          <Button type="submit" name="ergebnis" value="berichtigt"
                                  variante="secondary">
                            Berichtigt
                          </Button>
                          <Button type="submit" name="ergebnis" value="ergaenzt"
                                  variante="secondary">
                            Ergänzt
                          </Button>
                          <Button type="submit" name="ergebnis" value="abgelehnt"
                                  variante="ghost">
                            Abgelehnt
                          </Button>
                        </div>
                      </form>

                      {(f.ergebnis === 'berichtigt' || f.ergebnis === 'ergaenzt') && (
                        <form method="post" action="/api/datenschutz/berichtigung"
                              data-cse="feld-art19"
                              className="mt-s4 flex flex-col gap-s2 border-t border-line pt-s3">
                          <input type="hidden" name="feldId" value={f.id} />
                          <input type="hidden" name="handlung" value="unterrichten" />
                          <input type="hidden" name="zurueck" value={zurueck} />
                          <label className="flex flex-col gap-s2 text-sm text-text">
                            Art. 19: wen haben Sie unterrichtet?
                            <input name="empfaenger" required className={feld}
                                   defaultValue={f.art19Empfaenger ?? ''}
                                   placeholder="z. B. Lohnbüro Meier, Auftraggeber X" />
                          </label>
                          <div>
                            <Button type="submit" variante="secondary">
                              Unterrichtung festhalten
                            </Button>
                          </div>
                        </form>
                      )}
                    </details>
                  )),
              },
            ]}
          />
        )}
      </section>

      {darfSchreiben && !erledigt && zuordnung.art !== 'keine' && (
        <section aria-labelledby="aufnehmen" className="mb-s7">
          <h2 id="aufnehmen" className="mb-s2 text-h2 text-text">Feld aufnehmen</h2>
          <form method="post" action="/api/datenschutz/berichtigung"
                data-cse="feld-aufnehmen"
                className="flex max-w-[60ch] flex-col gap-s3">
            <input type="hidden" name="anfrage" value={z.id} />
            <input type="hidden" name="handlung" value="aufnehmen" />
            <input type="hidden" name="zurueck" value={zurueck} />

            <label className="flex flex-col gap-s2 text-sm text-text">
              Welches Feld?
              <select name="feldwahl" className={feld} data-cse="feld-wahl">
                <option value="">— aus der Liste wählen, oder unten von Hand —</option>
                {vorschlaege.map((v) => (
                  <option key={`${v.tabelle}.${v.feld}`}
                          value={`${v.tabelle}.${v.feld}`}>
                    {`${v.bezeichnung} (${v.tabelle}.${v.feld})`}
                  </option>
                ))}
              </select>
            </label>
            <p className="m-0 text-xs text-text-muted">
              Die Liste ist ein Vorschlag aus dem Schema, keine Beschränkung: steht
              das Feld nicht dabei, tragen Sie Tabelle und Feld unten von Hand ein.
            </p>
            <div className="flex flex-wrap gap-s3">
              <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                Tabelle (von Hand)
                <input name="tabelle" className={feld} data-cse="feld-tabelle" />
              </label>
              <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                Feld (von Hand)
                <input name="feld" className={feld} data-cse="feld-feld" />
              </label>
            </div>

            <label className="flex flex-col gap-s2 text-sm text-text">
              Was ist gespeichert?
              <input name="wertGespeichert" className={feld}
                     data-cse="feld-gespeichert" />
            </label>
            <label className="flex flex-col gap-s2 text-sm text-text">
              Was gibt die Person als richtig an?
              <input name="wertBehauptet" required className={feld}
                     data-cse="feld-behauptet" />
            </label>
            <label className="flex flex-col gap-s2 text-sm text-text">
              Woher stammt der gespeicherte Wert?
              <input name="quelle" className={feld} data-cse="feld-quelle"
                     placeholder="Arbeitsvertrag, Selbstauskunft, Formular …" />
            </label>
            <div>
              <Button type="submit" variante="primary">Aufnehmen</Button>
            </div>
          </form>
        </section>
      )}

      {!darfSchreiben && (
        <p className="text-sm text-text-muted" data-cse="berichtigung-kein-recht">
          Aufgenommen und entschieden wird von einer Sitzung mit
          {' '}<code className="font-mono">datenschutz.berichtigung_bearbeiten</code>.
          Sie sehen diese Seite, weil Sie eine der anderen Zuständigkeiten haben.
        </p>
      )}
    </PortalRahmen>
  );
}
