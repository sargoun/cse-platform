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
  ladeReinigungsklassen, type ReinigungsklasseZeile,
} from '@/server/services/stammdaten/reinigungsklasse';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/stammdaten/reinigungsklassen` — die Einstufung, die im
 * Raumbuch neben jedem Raum steht (OPS-02, K-17, O-55; SEITENKARTE §5.13).
 *
 * **Was eine Klasse heute steuert, und was nicht.** Sie steuert zwei Dinge:
 * die Einstufung eines Raums (`raum.reinigungsklasse_id`) und die
 * Code-Zuordnung des Raumbuch-Imports. Sie geht in KEINE Sollzeit und in
 * KEINE Kalkulation — die rechnen über die Belagsart und ihren
 * Leistungswert. Die Tabelle trägt ausdrücklich keinen Frequenzfaktor: einen
 * anzuhängen hiesse, eine Preisregel zu erfinden (0021, K-17). Wer hier eine
 * Preiswirkung erwartet, sucht sie bei den Belagsarten.
 *
 * **Die vier Klassen im Bestand sind geraten** (`ist_platzhalter`, O-55): RK1
 * Büro, RK2 Verkehrsfläche, RK3 Sanitär, RK4 Technik. Ob die Gruppe DIN 77400
 * folgt oder ein eigenes Schema führt, hat niemand bestätigt.
 *
 * **Der Katalog ist mandantengebunden.** Es gibt hier keine Plattformzeile:
 * jede Gesellschaft führt ihre eigene Liste, und in einer Gesellschaft ohne
 * Reinigungsgewerk ist die Seite leer — das ist richtig und nicht kaputt.
 *
 * **Gelesen mit `objekt.lesen`, gepflegt mit `stammdaten.verwalten`** (0021).
 * Wem das Leserecht fehlt, sieht eine leere Liste statt einer Sperre; deshalb
 * sagt die Seite es ausdrücklich.
 *
 * // TODO(client, O-693): Was geschieht mit Räumen, die auf eine ARCHIVIERTE
 * Reinigungsklasse zeigen — bleibt die Einstufung stehen (heutiges Verhalten)
 * oder müssen sie vor dem Archivieren umgestuft werden?
 */
export const dynamic = 'force-dynamic';

export default async function Reinigungsklassen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const { hinweis } = await searchParams;
  const pfad = `/portal/${mandant}/stammdaten/reinigungsklassen`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const darf = await haeltRechte(
    zugang.sitzung, 'objekt.lesen', 'objekt_import.lesen');
  const lesbar = darf['objekt.lesen'] === true;

  const klassen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ladeReinigungsklassen(kontext, {
      raeume: lesbar,
      importzeilen: darf['objekt_import.lesen'] === true,
    })))) as readonly ReinigungsklasseZeile[];

  const laufend = klassen.filter((k) => k.archiviertAm === null);
  const offen = laufend.filter((k) => k.istPlatzhalter).length;

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const klein = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Reinigungsklassen"
      wurzelTitel="Stammdaten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Reinigungsklassen</h1>

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p data-cse="stammdaten-hinweis"
           className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text">
          {hinweis}
        </p>
      ) : null}

      <p data-cse="klassen-offen" data-offen={String(offen)}
         className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
        {offen === 0
          ? 'Jede laufende Klasse ist bestätigt.'
          : `${String(offen)} von ${String(laufend.length)} laufenden Klassen sind `
            + 'unbestätigt (O-55): welche Reinigungsklassen verwendet die Gruppe — '
            + 'DIN 77400, ein eigenes Schema oder eine Liste je Kunde? Und steuern sie '
            + 'Frequenz, Preis, beides oder nichts?'}
        {' '}Heute steuern sie nichts davon: sie beschreiben, was zu tun ist.
      </p>

      <Hinweis art={lesbar ? 'hinweis' : 'warnung'} cse="klassen-rechte"
               className="mb-s7 max-w-[72ch]">
        {lesbar ? (
          <>
            <strong>Der Code wird erst mit dem Archivieren wieder frei.</strong> Der
            Teilindex <code>reinigungsklasse_code_uk</code> lässt einen Code nur einmal
            aktiv zu. Vor dem Archivieren steht in der Zeile, wie viele Räume und
            Importzeilen noch daran hängen: die Einstufung bleibt an diesen Räumen
            stehen, und eine Klasse stillschweigend wegzunehmen liesse sie ohne
            Bedeutung zurück (O-693).
          </>
        ) : (
          <>
            <strong>Diese Liste bleibt mit Ihrer Rolle leer, und gespeichert werden
            kann hier nichts.</strong> Gelesen wird der Katalog mit
            {' '}<code>objekt.lesen</code>, gepflegt mit
            {' '}<code>stammdaten.verwalten</code> (0021) — Ihrer Rolle fehlt das erste.
            Eine leere Tabelle heisst hier also nicht „keine Klassen". Auch das
            Anlegen schüge fehl: Postgres wendet auf das <code>returning</code> eines
            <code>insert</code> die Lesepolicy an. Die Formulare sind deshalb
            ausgeblendet, statt ein Versprechen zu geben, das die Datenbank
            zurücknimmt.
          </>
        )}
      </Hinweis>

      <section aria-labelledby="klassen-titel" className="mb-s7">
        <h2 id="klassen-titel" className="mb-s3 text-h2 text-text">Katalog</h2>
        {klassen.length === 0 ? (
          <p data-cse="klassen-leer"
             className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Für diese Gesellschaft ist keine Reinigungsklasse hinterlegt. Ein Raumbuch
            trägt dann keine Einstufung — die Räume bleiben, die Beschreibung fehlt.
          </p>
        ) : (
          <div data-cse="klassen">
            <DataTable
              beschriftung="Reinigungsklassen mit Code, Beschreibung, Sortierung und Bestand"
              zeilen={[...klassen]}
              schluessel={(k) => k.id}
              spalten={[
                {
                  schluessel: 'code', kopf: 'Code',
                  zelle: (k) => (
                    <span data-cse="klasse-zeile" data-code={k.code}>
                      <code className="text-text">{k.code}</code>
                      <span className="ml-s2 text-sm text-text">{k.bezeichnung}</span>
                    </span>
                  ),
                },
                {
                  schluessel: 'beschreibung', kopf: 'Beschreibung',
                  zelle: (k) => (k.beschreibung === null
                    ? <span className="text-text-subtle">—</span>
                    : <span className="text-xs text-text-muted">{k.beschreibung}</span>),
                },
                {
                  schluessel: 'sortierung', kopf: 'Reihenfolge', numerisch: true,
                  zelle: (k) => String(k.sortierung),
                },
                {
                  schluessel: 'raeume', kopf: 'Räume', numerisch: true,
                  zelle: (k) => (k.raeume === null
                    ? <span className="text-xs text-text-subtle">nicht lesbar</span>
                    : String(k.raeume)),
                },
                {
                  schluessel: 'import', kopf: 'Importzeilen', numerisch: true,
                  zelle: (k) => (k.importzeilen === null
                    ? <span className="text-xs text-text-subtle">nicht lesbar</span>
                    : String(k.importzeilen)),
                },
                {
                  schluessel: 'zustand', kopf: 'Zustand',
                  zelle: (k) => (k.archiviertAm !== null
                    ? <StatusPill zustand="Archiviert" />
                    : k.istPlatzhalter
                      ? (
                        <span className="flex items-center gap-s2">
                          <StatusPill zustand="Entwurf" />
                          <span className="text-xs text-warning">unbestätigt (O-55)</span>
                        </span>
                      )
                      : <StatusPill zustand="Aktiv" />),
                },
                {
                  schluessel: 'handlung', kopf: '',
                  zelle: (k) => (k.archiviertAm !== null
                    ? <span className="text-text-subtle">—</span>
                    : (
                      <details data-cse="klasse-bearbeiten">
                        <summary className="cursor-pointer text-sm text-brand">Bearbeiten</summary>
                        <form method="post"
                              action={`/api/stammdaten/reinigungsklassen?was=aendern&mandant=${mandant}`}
                              className="mt-s3 flex w-64 flex-col gap-s2">
                          <input type="hidden" name="id" value={k.id} />
                          <label className="text-xs text-text-muted" htmlFor={`code-${k.id}`}>
                            Code
                          </label>
                          <input id={`code-${k.id}`} name="code" type="text" required
                                 defaultValue={k.code} className={klein} />
                          <p className="text-xs text-text-subtle">
                            Der Code ist die Spalte, gegen die der Raumbuch-Import
                            vergleicht. Ihn zu ändern ändert, welche KÜNFTIGEN
                            Importzeilen zuordnen; die bereits zugeordneten Räume
                            bleiben, wo sie sind.
                          </p>
                          <label className="text-xs text-text-muted" htmlFor={`bez-${k.id}`}>
                            Bezeichnung
                          </label>
                          <input id={`bez-${k.id}`} name="bezeichnung" type="text" required
                                 defaultValue={k.bezeichnung} className={klein} />
                          <label className="text-xs text-text-muted" htmlFor={`bes-${k.id}`}>
                            Beschreibung
                          </label>
                          <input id={`bes-${k.id}`} name="beschreibung" type="text"
                                 defaultValue={k.beschreibung ?? ''} className={klein} />
                          <label className="text-xs text-text-muted" htmlFor={`sort-${k.id}`}>
                            Reihenfolge
                          </label>
                          <input id={`sort-${k.id}`} name="sortierung" type="number" min={0}
                                 step={1} defaultValue={k.sortierung} className={klein} />
                          <label className="flex items-center gap-s2 text-xs text-text">
                            <input type="checkbox" name="bestaetigt" value="ja"
                                   defaultChecked={!k.istPlatzhalter} />
                            Klasse ist bestätigt (O-55 für diese Zeile beantwortet)
                          </label>
                          <Button type="submit" variante="primary" className="mt-s2">
                            Speichern
                          </Button>
                        </form>
                        <form method="post"
                              action={`/api/stammdaten/reinigungsklassen?was=archivieren&mandant=${mandant}`}
                              className="mt-s3">
                          <input type="hidden" name="id" value={k.id} />
                          <p className="mb-s2 text-xs text-text-muted">
                            {k.raeume === null
                              ? 'Wie viele Räume daran hängen, ist mit Ihren Rechten nicht '
                                + 'lesbar.'
                              : k.raeume === 0
                                ? 'Kein Raum hängt an dieser Klasse.'
                                : `${String(k.raeume)} Raum/Räume behalten die Einstufung `
                                  + 'und verweisen danach auf eine archivierte Klasse '
                                  + '(O-693).'}
                          </p>
                          <Button type="submit" variante="secondary">Archivieren</Button>
                        </form>
                      </details>
                    )),
                },
              ]}
            />
          </div>
        )}
      </section>

      {lesbar ? (
        <section aria-labelledby="neu-titel"
                 className="max-w-prose rounded-lg border border-line bg-surface p-s5">
          <h2 id="neu-titel" className="text-h2 text-text">Klasse anlegen</h2>
          <p className="mt-s2 text-xs text-text-muted">
            Die Klasse gehört dieser Gesellschaft. Codes kommen aus dem Raumbuch des
            Kunden und sehen so aus, wie sie dort aussehen — geprüft wird nur, dass er
            da ist und keinen Randleerraum trägt.
          </p>
          <form method="post"
                action={`/api/stammdaten/reinigungsklassen?was=anlegen&mandant=${mandant}`}>
            <label className="mt-s4 block text-sm text-text" htmlFor="neu-code">Code</label>
            <input id="neu-code" name="code" type="text" required className={feld}
                   placeholder="RK1" />

            <label className="mt-s4 block text-sm text-text" htmlFor="neu-bezeichnung">
              Bezeichnung
            </label>
            <input id="neu-bezeichnung" name="bezeichnung" type="text" required
                   className={feld} placeholder="Büro und Besprechung" />

            <label className="mt-s4 block text-sm text-text" htmlFor="neu-beschreibung">
              Beschreibung
            </label>
            <input id="neu-beschreibung" name="beschreibung" type="text" className={feld}
                   placeholder="Was in dieser Klasse zu tun ist" />

            <label className="mt-s4 block text-sm text-text" htmlFor="neu-sortierung">
              Reihenfolge
            </label>
            <input id="neu-sortierung" name="sortierung" type="number" min={0} step={1}
                   className={feld} defaultValue={0} />
            <p className="mt-s2 text-xs text-text-muted">
              Bestimmt nur die Anzeigereihenfolge im Raumbuch — keine Wertung und keine
              Frequenz.
            </p>

            <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
              <input type="checkbox" name="bestaetigt" value="ja" />
              Klasse ist bestätigt (O-55 für diese Zeile beantwortet)
            </label>

            <Button type="submit" variante="primary" className="mt-s5">Klasse anlegen</Button>
          </form>
        </section>
      ) : null}

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Der Leistungswert, aus dem eine Sollzeit entsteht, hängt an der Belagsart —
        sie steht in den{' '}
        <Link href={`/portal/${mandant}/stammdaten/belagsarten`}
              className="text-text underline-offset-2 hover:text-brand hover:underline">
          Belagsarten
        </Link>
        .
        {lesbar ? (
          <>
            {' '}Welcher Raum in welcher Klasse liegt, steht im Raumbuch des{' '}
            <Link href={`/portal/${mandant}/objekte`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline">
              Objekts
            </Link>
            .
          </>
        ) : null}
      </p>
    </PortalRahmen>
  );
}
