import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { haeltRechte } from '@/app/portal/rechte';
import {
  ladeBelagsarten, laufendeFassungen, vortag, type BelagsartFassung,
} from '@/server/services/stammdaten/belagsart';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/stammdaten/belagsarten` — die Leistungswerte, aus denen
 * eine Sollzeit und daraus ein Preis wird (OPS-03, K-05, O-17;
 * SEITENKARTE §5.13).
 *
 * **Der Kern dieser Seite ist, dass eine Änderung KEIN Überschreiben ist.**
 * Ein geänderter Leistungswert bepreist jede künftige Kalkulation neu — und
 * überschrieben würde er auch jede vergangene neu bepreisen, ohne dass sich
 * das nachrechnen liesse. Die laufende Fassung wird deshalb zum Vortag
 * geschlossen und eine neue beginnt; die Ausschluss-Schranke
 * `belagsart_zeitraum_eindeutig` lässt am Wechseltag genau eine Antwort zu.
 *
 * **Alle vorhandenen Werte sind unbestätigt** (`ist_platzhalter`, O-17). Die
 * Quelle sagt es wörtlich: „Branchenübliche Grössenordnung — nicht bestätigt".
 * Wer eine Kalkulation darauf stützt, stützt sie auf eine geschätzte Zahl, und
 * genau das steht auf dem Bildschirm.
 *
 * **Zwei Rechte, und das ist hier keine Formalie.** Gelesen wird der Wert über
 * `app.belagsart_historie_lesen()` mit `stammdaten.verwalten` (0277);
 * geschrieben wird über die Tabellen-Policy, und deren `using` verlangt
 * `objekt.lesen` (0021). Wem das zweite fehlt, sieht die Liste und kann nicht
 * speichern — die Seite sagt das vorher, statt ein Formular anzubieten, das
 * die Datenbank abweist.
 *
 * **Wie weit rückwirkend überhaupt geht.** Eine neue Fassung beginnt STRIKT
 * NACH dem Beginn der laufenden; früher ist technisch ausgeschlossen, weil die
 * laufende `gueltig_bis is null` trägt und sich mit jedem früheren Tag
 * überschneidet. Unbewacht ist genau der Bereich DAZWISCHEN — zwischen dem
 * Beginn der laufenden Fassung und heute.
 *
 * // TODO(client, O-692): Darf eine Belagsart-Fassung zwischen dem Beginn der
 * laufenden Fassung und heute beginnen, wenn für diesen Zeitraum schon
 * Kalkulationen gerechnet wurden — und wer gibt das frei?
 */
export const dynamic = 'force-dynamic';

export default async function Belagsarten(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const { hinweis } = await searchParams;
  const pfad = `/portal/${mandant}/stammdaten/belagsarten`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const darf = await haeltRechte(zugang.sitzung, 'objekt.lesen');
  const schreibbar = darf['objekt.lesen'] === true;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      fassungen: await ladeBelagsarten(kontext, schreibbar),
      /*
       * Der Vorgabetag kommt aus der Datenbank, nicht aus `new Date()`: die
       * Uhr des Node-Prozesses liest UTC und boete am 31.12. um 23:30
       * Berliner Zeit den falschen Tag an (K-11, Invariante 2).
       */
      tage: await kontext.abfrage<{ heute: string; morgen: string }>(
        `select app.berlin_heute()::text as heute,
                (app.berlin_heute() + 1)::text as morgen`),
    }))) as Promise<{
      fassungen: readonly BelagsartFassung[];
      tage: readonly { heute: string; morgen: string }[];
    }>);

  const fassungen = daten.fassungen;
  const heute = daten.tage[0]?.heute ?? '';
  const morgen = daten.tage[0]?.morgen ?? '';
  const laufend = laufendeFassungen(fassungen);
  const offen = laufend.filter((f) => f.istPlatzhalter).length;
  const codes = [...new Set(fassungen.map((f) => f.code))].sort();

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const klein = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Belagsarten"
      wurzelTitel="Stammdaten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Belagsarten</h1>

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p data-cse="stammdaten-hinweis"
           className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text">
          {hinweis}
        </p>
      ) : null}

      <p data-cse="belagsarten-offen" data-offen={String(offen)}
         className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
        {offen === 0
          ? 'Jeder laufende Leistungswert ist bestätigt.'
          : `${String(offen)} von ${String(laufend.length)} laufenden Leistungswerten `
            + 'sind unbestätigt (O-17): aus welcher Quelle stammen die m²/h-Werte, und '
            + 'wer bestätigt sie? Bis dahin rechnet die Kalkulation mit einer '
            + 'geschätzten Zahl und sagt es an jeder Position.'}
        {' '}Ein Glasreinigungsrevier rechnet ausserdem heute auf die Bodenfläche —
        ein Leistungswert je m² Glas steht in keinem Katalog (O-349).
      </p>

      <Hinweis art={schreibbar ? 'hinweis' : 'warnung'} cse="belagsarten-rechte"
               className="mb-s7 max-w-[72ch]">
        {schreibbar ? (
          <>
            <strong>Eine Änderung ist eine neue Fassung.</strong> Der alte Wert bleibt
            mit seinem Zeitraum stehen, damit jede Kalkulation, die mit ihm gerechnet
            hat, nachrechenbar bleibt. Der neue Wert gilt ab dem Tag, den Sie angeben,
            und berührt keine Kalkulation, die davor entstanden ist.
          </>
        ) : (
          <>
            <strong>Speichern ist mit Ihrer Rolle nicht möglich.</strong> Gelesen wird
            dieser Katalog mit <Recht schluessel="stammdaten.verwalten" />, geschrieben verlangt
            die Tabellen-Policy zusätzlich <Recht schluessel="objekt.lesen" /> (0021). Ihrer Rolle
            fehlt das zweite Recht; die Formulare sind deshalb ausgeblendet, statt beim
            Speichern abzuweisen.
          </>
        )}
      </Hinweis>

      <section aria-labelledby="laufend-titel" className="mb-s7">
        <h2 id="laufend-titel" className="mb-s3 text-h2 text-text">
          Heute gültige Werte
        </h2>
        {laufend.length === 0 ? (
          <p data-cse="belagsarten-leer"
             className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Für diese Gesellschaft ist keine Belagsart hinterlegt. Ohne sie rechnet das
            Raumbuch keine Sollzeit — die Kalkulation weist die Position mit benanntem
            Grund ab und rät keinen Wert.
          </p>
        ) : (
          <div data-cse="belagsarten">
            <DataTable
              beschriftung="Heute gültige Belagsarten mit Leistungswert, Quelle, Beginn und Räumen"
              zeilen={[...laufend]}
              schluessel={(f) => f.id}
              spalten={[
                {
                  schluessel: 'code', kopf: 'Code',
                  zelle: (f) => (
                    <span data-cse="belagsart-zeile" data-code={f.code}>
                      <code className="text-text">{f.code}</code>
                      <span className="ml-s2 text-sm text-text">{f.bezeichnung}</span>
                    </span>
                  ),
                },
                {
                  schluessel: 'wert', kopf: 'm²/h', numerisch: true,
                  zelle: (f) => f.leistungswert,
                },
                {
                  schluessel: 'quelle', kopf: 'Quelle',
                  zelle: (f) => <span className="text-xs text-text-muted">{f.quelle}</span>,
                },
                { schluessel: 'ab', kopf: 'Gültig ab', zelle: (f) => f.gueltigAb },
                {
                  schluessel: 'raeume', kopf: 'Räume', numerisch: true,
                  zelle: (f) => (f.raeume === null
                    ? <span className="text-xs text-text-subtle">nicht lesbar</span>
                    : String(f.raeume)),
                },
                {
                  schluessel: 'zustand', kopf: 'Zustand',
                  zelle: (f) => (f.istPlatzhalter
                    ? (
                      <span className="flex items-center gap-s2">
                        <StatusPill zustand="Entwurf" />
                        <span className="text-xs text-warning">unbestätigt (O-17)</span>
                      </span>
                    )
                    : <StatusPill zustand="Aktiv" />),
                },
                {
                  schluessel: 'handlung', kopf: '',
                  zelle: (f) => (!schreibbar
                    ? <span className="text-text-subtle">—</span>
                    : (
                      <details data-cse="belagsart-bearbeiten">
                        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-text">Bearbeiten</summary>

                        <form method="post"
                              action={`/api/stammdaten/belagsarten?was=richtigstellen&mandant=${mandant}`}
                              className="mt-s3 flex w-64 flex-col gap-s2">
                          <input type="hidden" name="id" value={f.id} />
                          <p className="text-xs text-text-muted">
                            Richtigstellung ohne neue Fassung: Name, Beschreibung und
                            Quelle. Der Leistungswert bleibt — eine andere Zahl ist
                            eine neue Tatsache und keine Korrektur.
                          </p>
                          <label className="text-xs text-text-muted" htmlFor={`bez-${f.id}`}>
                            Bezeichnung
                          </label>
                          <input id={`bez-${f.id}`} name="bezeichnung" type="text" required
                                 defaultValue={f.bezeichnung} className={klein} />
                          <label className="text-xs text-text-muted" htmlFor={`bes-${f.id}`}>
                            Beschreibung
                          </label>
                          <input id={`bes-${f.id}`} name="beschreibung" type="text"
                                 defaultValue={f.beschreibung ?? ''} className={klein} />
                          <label className="text-xs text-text-muted" htmlFor={`qu-${f.id}`}>
                            Quelle
                          </label>
                          <input id={`qu-${f.id}`} name="quelle" type="text" required
                                 defaultValue={f.quelle} className={klein} />
                          <label className="flex items-center gap-s2 text-xs text-text">
                            <input type="checkbox" name="bestaetigt" value="ja"
                                   defaultChecked={!f.istPlatzhalter} />
                            Wert ist bestätigt (O-17 für diese Zeile beantwortet)
                          </label>
                          <Button type="submit" variante="secondary" className="mt-s2">
                            Richtigstellen
                          </Button>
                        </form>

                        <form method="post"
                              action={`/api/stammdaten/belagsarten?was=datieren&mandant=${mandant}`}
                              className="mt-s5 flex w-64 flex-col gap-s2">
                          <input type="hidden" name="code" value={f.code} />
                          <p className="text-xs text-text-muted">
                            Neuer Leistungswert ab einem Tag. Die laufende Fassung endet
                            am Vortag ({vortag(morgen)} bei Beginn morgen) und bleibt
                            lesbar.
                          </p>
                          <label className="text-xs text-text-muted" htmlFor={`nbez-${f.id}`}>
                            Bezeichnung
                          </label>
                          <input id={`nbez-${f.id}`} name="bezeichnung" type="text" required
                                 defaultValue={f.bezeichnung} className={klein} />
                          {/*
                            * Vorbelegt wie Bezeichnung und Quelle: die neue Fassung ist
                            * eine andere ZAHL, nicht eine andere Belagsart. Ohne dieses
                            * Feld schriebe `datiereBelagsartUm` NULL in die Beschreibung
                            * — lautlos, weil auf dem Bildschirm nichts davon stünde.
                            */}
                          <label className="text-xs text-text-muted" htmlFor={`nbes-${f.id}`}>
                            Beschreibung
                          </label>
                          <input id={`nbes-${f.id}`} name="beschreibung" type="text"
                                 defaultValue={f.beschreibung ?? ''} className={klein} />
                          <label className="text-xs text-text-muted" htmlFor={`nwert-${f.id}`}>
                            Leistungswert in m²/h
                          </label>
                          <input id={`nwert-${f.id}`} name="leistungswert" type="text"
                                 inputMode="decimal" required className={klein}
                                 defaultValue={f.leistungswert} />
                          <label className="text-xs text-text-muted" htmlFor={`nqu-${f.id}`}>
                            Quelle des neuen Werts
                          </label>
                          <input id={`nqu-${f.id}`} name="quelle" type="text" required
                                 className={klein} placeholder="Zeitaufnahme Objekt …" />
                          <label className="text-xs text-text-muted" htmlFor={`nab-${f.id}`}>
                            Gültig ab
                          </label>
                          <input id={`nab-${f.id}`} name="gueltigAb" type="date" required
                                 className={klein} defaultValue={morgen} />
                          <label className="flex items-center gap-s2 text-xs text-text">
                            <input type="checkbox" name="bestaetigt" value="ja" />
                            Wert ist bestätigt
                          </label>
                          <Button type="submit" variante="primary" className="mt-s2">
                            Neue Fassung
                          </Button>
                        </form>
                      </details>
                    )),
                },
              ]}
            />
          </div>
        )}
      </section>

      {codes.length === 0 ? null : (
        <section aria-labelledby="historie-titel" className="mb-s7">
          <h2 id="historie-titel" className="mb-s3 text-h2 text-text">Historie</h2>
          <p className="mb-s4 max-w-prose text-sm text-text-muted">
            Welcher Wert wann galt. Eine abgelöste Fassung wird nicht gelöscht: die
            Kalkulationspositionen und Importzeilen zeigen auf die FASSUNG, nicht auf
            den Code — sonst wäre ein abgegebenes Angebot nicht mehr nachrechenbar.
          </p>
          <ul data-cse="belagsart-historie" className="space-y-s4">
            {codes.map((code) => (
              <li key={code} className="rounded-lg border border-line bg-surface p-s5">
                <h3 className="text-h3 text-text">
                  <code>{code}</code>
                </h3>
                <ul className="mt-s3 space-y-s2">
                  {fassungen.filter((f) => f.code === code).map((f) => (
                    <li key={f.id} data-cse="historie-zeile" data-code={code}
                        className="text-sm text-text-muted">
                      <span className="text-text">{f.leistungswert} m²/h</span>
                      {' · '}
                      {f.gueltigAb} – {f.gueltigBis ?? 'offen'}
                      {' · '}
                      {f.quelle}
                      {f.istPlatzhalter ? (
                        <span className="ml-s2 text-xs text-warning">unbestätigt (O-17)</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {schreibbar ? (
        <section aria-labelledby="neu-titel"
                 className="max-w-prose rounded-lg border border-line bg-surface p-s5">
          <h2 id="neu-titel" className="text-h2 text-text">Belagsart anlegen</h2>
          <p className="mt-s2 text-xs text-text-muted">
            Ein neuer Code beginnt mit seiner ersten Fassung. Für einen vorhandenen
            Code nehmen Sie „Neue Fassung" in der Zeile — dann endet die laufende
            Fassung am Vortag statt zu kollidieren.
          </p>
          <form method="post"
                action={`/api/stammdaten/belagsarten?was=datieren&mandant=${mandant}`}>
            <label className="mt-s4 block text-sm text-text" htmlFor="neu-code">Code</label>
            <input id="neu-code" name="code" type="text" required className={feld}
                   placeholder="PVC" />
            <p className="mt-s2 text-xs text-text-muted">
              Der Code ist die Spalte, gegen die der Raumbuch-Import vergleicht — er
              steht so in der Datei des Kunden.
            </p>

            <label className="mt-s4 block text-sm text-text" htmlFor="neu-bezeichnung">
              Bezeichnung
            </label>
            <input id="neu-bezeichnung" name="bezeichnung" type="text" required
                   className={feld} />

            <label className="mt-s4 block text-sm text-text" htmlFor="neu-beschreibung">
              Beschreibung
            </label>
            <input id="neu-beschreibung" name="beschreibung" type="text" className={feld} />

            <label className="mt-s4 block text-sm text-text" htmlFor="neu-wert">
              Leistungswert in m²/h
            </label>
            <input id="neu-wert" name="leistungswert" type="text" inputMode="decimal"
                   required className={feld} placeholder="250" />
            <p className="mt-s2 text-xs text-text-muted">
              Quadratmeter je Stunde, bis zu drei Nachkommastellen. Aus diesem Wert und
              der Fläche entsteht die Sollzeit — gerechnet wird sie im Dienst, nie hier.
            </p>

            <label className="mt-s4 block text-sm text-text" htmlFor="neu-quelle">
              Quelle
            </label>
            <input id="neu-quelle" name="quelle" type="text" required className={feld}
                   placeholder="Zeitaufnahme, Richtwerttabelle, Vereinbarung mit dem Kunden" />
            <p className="mt-s2 text-xs text-text-muted">
              Pflichtangabe: ein Leistungswert ohne genannte Herkunft lässt sich im
              Preisstreit nicht verteidigen.
            </p>

            <label className="mt-s4 block text-sm text-text" htmlFor="neu-ab">Gültig ab</label>
            <input id="neu-ab" name="gueltigAb" type="date" required className={feld}
                   defaultValue={morgen} />
            <p className="mt-s2 text-xs text-text-muted">
              Heute ist der {heute}. Für einen NEUEN Code ist jeder Tag möglich.
              Für einen vorhandenen beginnt die neue Fassung immer NACH dem Beginn
              der laufenden — früher weist der Dienst ab, weil die laufende bis auf
              Weiteres gilt und jeder frühere Tag sich mit ihr überschneidet. Offen
              bleibt der Bereich dazwischen: ein Beginn zwischen dem Beginn der
              laufenden Fassung und heute wird angenommen und ändert rückwirkend die
              Grundlage jeder Kalkulation aus dieser Zeit (O-692).
            </p>

            <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
              <input type="checkbox" name="bestaetigt" value="ja" />
              Wert ist bestätigt (O-17 für diese Zeile beantwortet)
            </label>

            <Button type="submit" variante="primary" className="mt-s5">
              Belagsart anlegen
            </Button>
          </form>
        </section>
      ) : null}

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Welcher Raum welchen Belag hat, steht im Raumbuch des Objekts.
        {darf['objekt.lesen'] === true ? (
          <>
            {' '}Der Weg dorthin führt über die{' '}
            <Link href={`/portal/${mandant}/objekte`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline">
              Objekte
            </Link>
            .
          </>
        ) : null}
        {' '}Die Reinigungsklassen daneben stehen in den{' '}
        <Link href={`/portal/${mandant}/stammdaten/reinigungsklassen`}
              className="text-text underline-offset-2 hover:text-brand hover:underline">
          Reinigungsklassen
        </Link>
        .
      </p>
    </PortalRahmen>
  );
}
