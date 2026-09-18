import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { MandantAntwort } from '@/app/portal/unterseite';
import {
  ART_TEXT, ZUORDNUNG_TEXT, kandidaten, type Kandidat,
} from '@/server/services/datenschutz/anfrage';
import { erteilte, type AuskunftZeile } from '@/server/services/datenschutz/auskunft';
import { liste as berichtigungen } from '@/server/services/datenschutz/berichtigung';
import { liste as loeschungen } from '@/server/services/datenschutz/loeschentscheidung';
import { stand, ART_WIRKUNG, type Stand } from '@/server/services/datenschutz/werbewiderspruch';
import { ladeVorgang } from '../vorgang';
import { BERLIN, Vorgangskopf } from '../Vorgangskopf';

/**
 * `/portal/[mandant]/datenschutz/[id]` — die AKTE eines Betroffenenvorgangs
 * (LEG-09, 04-SEITENKARTE §5.25).
 *
 * Sie führt vier Dinge zusammen, und drei davon gab es vorher nicht:
 *
 * 1. **Die Selbstauskunft** — was die Person über sich gesagt hat, ausdrücklich
 *    getrennt von dem, was die Plattform über sie weiss. Die Verwechslung
 *    dieser beiden ist der Anfang jeder falschen Auskunft.
 * 2. **Der Identitätsabgleich.** Art. 12 Abs. 6 erlaubt die
 *    Identitätsnachfrage nur bei begründeten Zweifeln — also hier, im
 *    Einzelfall, von einem Menschen. Die Zuordnung ist deshalb ein Suchfeld
 *    und kein Abgleich.
 * 3. **Die Art.-21-Entscheidung.** Die Seitenkarte legt sie ausdrücklich
 *    hierher: der Verarbeitungswiderspruch wird über `/datenschutz/anfrage`
 *    erhoben und „decided at `M/datenschutz/[id]`" (§2.4). Er setzt
 *    `widerspruch_am`, woraufhin `kern.erzwinge_widerspruch()`
 *    `rechtsgrundlage = 'keine'` zwingt — **einmalig und unwiderruflich**.
 *    Diese Seite ist damit die einzige, die fremde Daten ändert, und sie sagt
 *    das, bevor der Knopf kommt.
 * 4. **Der Nachweis.** Erteilte Auskünfte mit Prüfsumme, Berichtigungen je
 *    Feld, Löschentscheidungen je Tabelle — der Stand des Vorgangs, nicht eine
 *    Notiz darüber.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Betroffenenvorgang — Datenschutz' };

interface Extra {
  readonly treffer: readonly Kandidat[];
  readonly auskuenfte: readonly AuskunftZeile[];
  readonly berichtigt: number;
  readonly geloescht: number;
  readonly stand: readonly Stand[];
}

export default async function Vorgangsakte(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const suche = await searchParams;
  const nadel = typeof suche['suche'] === 'string' ? suche['suche'] : '';

  const geladen = await ladeVorgang<Extra>(
    `/portal/${mandant}/datenschutz/${id}`, mandant, id,
    ['crm.lesen', 'crm.rechtsgrundlage_lesen'],
    async (kontext, v) => ({
      treffer: await kandidaten(kontext, nadel),
      auskuenfte: await erteilte(kontext, v.z.id),
      berichtigt: (await berichtigungen(kontext, v.z.id)).length,
      geloescht: (await loeschungen(kontext, v.z.id)).length,
      stand: v.zuordnung.art === 'ansprechpartner'
        ? await stand(kontext, v.zuordnung.id, null) : [],
    }),
  );
  if (geladen.art !== 'ok') return <MandantAntwort tor={geladen.tor} />;
  const { zugang, z, zuordnung, darf, extra } = geladen;

  const erledigt = ['beantwortet', 'abgelehnt'].includes(z.status);
  const zurueck = `/portal/${mandant}/datenschutz/${z.id}`;
  const feld = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel={ART_TEXT[z.art].kurz}
      wurzelTitel="Datenschutz"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <Vorgangskopf mandant={mandant} z={z} zuordnung={zuordnung} aktiv={null}
                    darf={darf} />

      <section aria-labelledby="selbstauskunft" className="mb-s7">
        <h2 id="selbstauskunft" className="mb-s2 text-h2 text-text">
          Was die Person über sich sagt
        </h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Das hier ist die <strong>Selbstauskunft aus dem Formular</strong> — nicht
          der Abgleich mit dem Datenbestand. Das Formular fragt absichtlich wenig:
          Art. 12 Abs. 6 DSGVO erlaubt die Identitätsnachfrage nur bei begründeten
          Zweifeln, also hier, im Einzelfall, von Ihnen.
        </p>
        <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-3">
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Anliegen
            </dt>
            <dd className="m-0 mt-s1 text-sm text-text">{ART_TEXT[z.art].lang}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              In welchem Zusammenhang (freiwillig)
            </dt>
            <dd className="m-0 mt-s1 text-sm text-text">{z.rolleAngabe ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Nachricht
            </dt>
            <dd className="m-0 mt-s1 whitespace-pre-line text-sm text-text">
              {z.nachricht ?? '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="zuordnung" className="mb-s7">
        <h2 id="zuordnung" className="mb-s2 text-h2 text-text">Identitätsabgleich</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Drei Ziele, weil es drei Arten von Personenbezug gibt (D-09): die
          <strong> Person</strong> ist der Mensch (Stammdaten, Zeiten, Nachweise),
          der <strong>Ansprechpartner</strong> die Rolle bei einem Kunden (§ 7 UWG,
          Rechtsgrundlage), die <strong>Bewerbung</strong> ein Vorgang ohne
          Anstellung. Eine Bewerberin hat keine Personenzeile — deshalb ist sie ein
          eigenes Ziel.
        </p>

        {darf['datenschutz.auskunft_erstellen'] !== true ? (
          <Hinweis art="hinweis" cse="zuordnung-kein-recht" className="max-w-prose">
            Die Zuordnung setzt, wer <code className="font-mono">datenschutz.auskunft_erstellen</code>
            {' '}hält. Sie sehen den Vorgang, weil Sie eine der anderen beiden
            Zuständigkeiten haben.
          </Hinweis>
        ) : erledigt ? (
          <Hinweis art="hinweis" cse="zuordnung-erledigt" className="max-w-prose">
            Dieser Vorgang ist entschieden. Eine entschiedene Anfrage wird nicht
            mehr umgeordnet — sonst zeigte der Nachweis auf einen anderen Menschen
            als die Antwort, die hinausging.
          </Hinweis>
        ) : (
          <>
            <form method="get" data-cse="zuordnung-suche"
                  className="mb-s4 flex max-w-[48ch] flex-wrap items-end gap-s3">
              <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                Name oder E-Mail-Adresse
                <input name="suche" defaultValue={nadel} className={feld}
                       placeholder="mindestens zwei Zeichen" />
              </label>
              <Button type="submit" variante="secondary">Suchen</Button>
            </form>

            {nadel.trim().length >= 2 && extra.treffer.length === 0 ? (
              <p className="mb-s4 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Kein Treffer. Gesucht wird in dieser Gesellschaft — unter
                Beschäftigten mit einer Anstellung hier, unter Ansprechpartnern und
                unter Bewerbungen. Wer nirgends davon steht, hat hier keine Daten;
                das ist auch eine Antwort nach Art. 15.
              </p>
            ) : null}

            {extra.treffer.length > 0 && (
              <form method="post" action="/api/datenschutz/zuordnen"
                    data-cse="zuordnung-formular" className="mb-s4">
                <input type="hidden" name="id" value={z.id} />
                <input type="hidden" name="zurueck" value={zurueck} />
                <ul className="m-0 mb-s4 list-none p-0">
                  {extra.treffer.map((t) => (
                    <li key={`${t.art}-${t.id}`} className="mb-s2">
                      <label className="flex items-baseline gap-s3 text-sm text-text">
                        <input type="radio" name="wahl" value={`${t.art}:${t.id}`}
                               data-cse="zuordnung-wahl" required />
                        <span>
                          {t.name}
                          <span className="block text-xs text-text-muted">
                            {`${ZUORDNUNG_TEXT[t.art]} · ${t.beiwerk}`}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {/*
                  * Art und Kennung sind EIN Wert (`person:uuid`), und das ist
                  * kein Detail: getrennt übertragen liessen sich eine Person
                  * auswählen und ein Ansprechpartner zuordnen — eine
                  * Kombination, die die Oberfläche nie gezeigt hat.
                  */}
                <p className="m-0 mb-s3 text-xs text-text-muted">
                  Übernommen wird die Zuordnung erst mit diesem Knopf — und sie
                  ändert nichts an den Daten der Person.
                </p>
                <Button type="submit" variante="secondary">Zuordnung übernehmen</Button>
              </form>
            )}

            {zuordnung.art !== 'keine' && (
              <form method="post" action="/api/datenschutz/zuordnen"
                    data-cse="zuordnung-loesen" className="mt-s3">
                <input type="hidden" name="id" value={z.id} />
                <input type="hidden" name="art" value="keine" />
                <input type="hidden" name="zurueck" value={zurueck} />
                <Button type="submit" variante="ghost">Zuordnung lösen</Button>
              </form>
            )}
          </>
        )}
      </section>

      {/*
        * Art. 18 und Art. 20 — benannt, nicht verschwiegen.
        *
        * Der Enum kennt sechs Arten; Wege gibt es für drei. Art. 20 lässt sich
        * über den JSON-Abruf der Art.-15-Auskunft erfüllen (ein gängiges,
        * maschinenlesbares Format), Art. 18 hat im Datenmodell kein Merkmal
        * „eingeschränkt" — und ein Haken, der nichts sperrt, wäre die
        * schlimmere Antwort.
        */}
      {z.art === 'uebertragbarkeit' && (
        <Hinweis art="hinweis" cse="vorgang-art20" className="mb-s7 max-w-prose">
          <strong className="block">Art. 20 DSGVO — Datenübertragbarkeit.</strong>
          Der Weg dafür ist die Auskunft nach Art. 15 im Format
          {' '}<strong>Struktur (JSON)</strong>: ein gängiges, maschinenlesbares
          Format im Sinne des Art. 20 Abs. 1. Ein eigener Export daneben wäre ein
          zweiter Umfang, der vom ersten abweicht.
        </Hinweis>
      )}
      {z.art === 'einschraenkung' && (
        <Hinweis art="warnung" cse="vorgang-art18" className="mb-s7 max-w-prose">
          <strong className="block">
            Art. 18 DSGVO — Einschränkung: offen (O-647).
          </strong>
          Das Datenmodell führt kein Merkmal „eingeschränkt": es gibt keine Spalte,
          die eine Verarbeitung anhält, ohne sie zu beenden. Diese Anfrage wird
          deshalb von einem Menschen beschieden und die Einschränkung
          organisatorisch umgesetzt — ein Haken, der nichts sperrt, wäre die
          schlechtere Antwort.
          {/* TODO(client, O-647): Wie wird eine Einschränkung nach Art. 18 technisch umgesetzt — Sperrmerkmal je Datensatz oder organisatorisch? */}
        </Hinweis>
      )}

      {/*
        * **Art. 21 für eine Beschäftigte oder eine Bewerberin — benannt, nicht
        * verschwiegen.**
        *
        * Der ganze Abschnitt darunter hängt an
        * `zuordnung.art === 'ansprechpartner'`, denn `widerspruch_am` gibt es
        * nur auf `ansprechpartner` und `kunde` (nachgemessen in
        * `information_schema`). Wer als Person oder als Bewerberin Art. 21
        * erklärt, sah auf der Akte deshalb GAR NICHTS darüber — während Art. 18
        * (O-647) und Art. 20 ausdrücklich als Hinweis erscheinen. Dieselbe
        * stille Lücke, die die Domäne für Art. 18 richtig vermeidet.
        */}
      {z.art === 'widerspruch'
       && (zuordnung.art === 'person' || zuordnung.art === 'bewerbung') && (
        <Hinweis art="warnung" cse="vorgang-art21-ohne-merkmal" className="mb-s7 max-w-prose">
          <strong className="block">
            Art. 21 DSGVO für diese Personengruppe: kein Merkmal im Datenmodell
            (O-647).
          </strong>
          Ein Widerspruchsmerkmal führen nur{' '}
          <code className="font-mono">ansprechpartner</code> und{' '}
          <code className="font-mono">kunde</code> — die werbliche Ansprache.
          Für eine Beschäftigte oder eine Bewerberin gibt es keine Spalte, die
          eine Verarbeitung anhält: die Verarbeitung ruht hier auf dem
          Arbeitsverhältnis beziehungsweise auf dem Bewerbungsverfahren
          (Art. 6 Abs. 1 lit. b, § 26 BDSG), und ein Haken, der nichts sperrt,
          wäre die schlechtere Antwort.
          {' '}Der Widerspruch wird deshalb von einem Menschen beschieden,
          organisatorisch umgesetzt und im Abschlusstext dieses Vorgangs
          festgehalten — er steht dann unten bei der Entscheidung und ist über
          die Prüfsumme der Akte belegt.
          {/*
            * **Dieselbe Nummer wie Art. 18, und das ist kein Sparen.** O-647
            * fragt „Sperrmerkmal je Datensatz oder organisatorisch?" — die
            * Antwort darauf entscheidet beides: ein Merkmal, das eine
            * Verarbeitung anhaelt, ist dasselbe Merkmal, das einen
            * Art.-21-Widerspruch einer Beschaeftigten traegt. Zwei Nummern
            * teilten EINE Entscheidung in zwei Haelften, die niemand getrennt
            * beantworten kann.
            */}
          {/* TODO(client, O-647): Gilt das Sperrmerkmal auch fuer einen Art.-21-Widerspruch einer Beschaeftigten oder Bewerberin, oder bleibt der organisatorisch? */}
        </Hinweis>
      )}

      {zuordnung.art === 'ansprechpartner' && (
        <section aria-labelledby="art21" className="mb-s7">
          <h2 id="art21" className="mb-s2 text-h2 text-text">
            Widerspruch gegen die Verarbeitung (Art. 21 DSGVO)
          </h2>
          <Hinweis art="warnung" cse="art21-warnung" className="mb-s4 max-w-prose">
            <strong className="block">
              Das ist die einzige Stelle dieses Vorgangs, die fremde Daten ändert —
              und sie ist unwiderruflich.
            </strong>
            {ART_WIRKUNG.verarbeitung} Die Datenbank nimmt den Widerspruch nicht
            zurück: <code className="font-mono">kern.erzwinge_widerspruch()</code>
            {' '}wirft bei jedem Versuch. Der Werbewiderspruch nach § 7 UWG ist
            etwas anderes und schwächer — er sperrt Werbung und lässt
            vertraglich notwendige Post laufen (eine Rechnung etwa).
            Terminbestätigung, Leistungsnachweis und Mahnung sind als
            {' '}<code className="font-mono">transaktional</code> geführt und
            werden bis zur Entscheidung von O-65 ebenfalls abgewiesen —
            nachgemessen in{' '}
            <code className="font-mono">app.darf_kontaktiert_werden</code>.
          </Hinweis>

          {extra.stand.length === 0 ? (
            <p className="mb-s4 text-sm text-text-muted">
              Der Widerspruchsstand ist mit den erteilten Rechten nicht lesbar.
            </p>
          ) : (
            <DataTable
              beschriftung="Widerspruchsstand des zugeordneten Kontakts"
              zeilen={[...extra.stand]}
              schluessel={(s) => `${s.ebene}-${s.betroffenerId}`}
              spalten={[
                { schluessel: 'name', kopf: 'Betroffener', zelle: (s) => s.name },
                {
                  schluessel: 'grundlage', kopf: 'Rechtsgrundlage',
                  zelle: (s) => s.rechtsgrundlage,
                },
                {
                  schluessel: 'werbung', kopf: 'Werbewiderspruch (§ 7 UWG)',
                  zelle: (s) => (s.werbewiderspruchAm === null
                    ? <span className="text-text-subtle">—</span>
                    : BERLIN.format(new Date(s.werbewiderspruchAm))),
                },
                {
                  schluessel: 'art21', kopf: 'Widerspruch (Art. 21)',
                  zelle: (s) => (s.widerspruchAm === null
                    ? <span className="text-text-subtle">—</span>
                    : <span className="text-danger">
                        {BERLIN.format(new Date(s.widerspruchAm))}
                      </span>),
                },
              ]}
            />
          )}

          {/*
            * Der Knopf erscheint nur, wenn der Stand WIRKLICH gelesen wurde.
            * `every` auf einer leeren Liste ist `true` — ohne die
            * Laengenpruefung erschiene er also auch dann, wenn der
            * Widerspruchsstand nicht lesbar war, und ein Mensch setzte eine
            * unwiderrufliche Wirkung, ohne zu sehen, was schon gilt.
            */}
          {darf['datenschutz.auskunft_erstellen'] === true && !erledigt
           && extra.stand.length > 0
           && extra.stand.every((s) => s.widerspruchAm === null) && (
            <details className="mt-s4" data-cse="art21-setzen">
              <summary className="cursor-pointer text-sm text-brand">
                Widerspruch nach Art. 21 festhalten
              </summary>
              <form method="post" action="/api/datenschutz/widerspruch"
                    className="mt-s3 flex max-w-[60ch] flex-col gap-s3">
                <input type="hidden" name="anfrage" value={z.id} />
                <input type="hidden" name="zurueck" value={zurueck} />
                <label className="flex flex-col gap-s2 text-sm text-text">
                  Was hat die Person erklärt, und wann?
                  <textarea name="bemerkung" rows={3} required className={feld}
                            data-cse="art21-bemerkung"
                            placeholder="Der Grund ist das, was eine Aufsichtsbehörde liest." />
                </label>
                <label className="flex items-center gap-s2 text-sm text-text">
                  <input type="checkbox" name="auchFirma" value="ja"
                         data-cse="art21-firma" />
                  Auch auf Ebene der Firma festhalten (§2.4 nennt beide Ebenen)
                </label>
                <div>
                  {/* `danger`, nicht `primary`: die Handlung ist nicht
                      zurücknehmbar, und DESIGN §5 lässt nur EIN `primary` je
                      Bildschirm — das gehört dem Abschluss unten. */}
                  <Button type="submit" variante="danger">
                    Widerspruch unwiderruflich festhalten
                  </Button>
                </div>
              </form>
            </details>
          )}
        </section>
      )}

      <section aria-labelledby="nachweis" className="mb-s7">
        <h2 id="nachweis" className="mb-s2 text-h2 text-text">Nachweis des Vorgangs</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Was ausgehändigt wurde, ist im Streitfall die Frage — nicht, dass
          geantwortet wurde. Jede erteilte Auskunft trägt ihre Prüfsumme.
        </p>
        <dl className="m-0 mb-s4 grid grid-cols-1 gap-s4 sm:grid-cols-3">
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Erteilte Auskünfte
            </dt>
            <dd className="m-0 mt-s1 text-sm text-text" data-cse="nachweis-auskuenfte">
              {String(extra.auskuenfte.length)}
            </dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Berichtigte Felder
            </dt>
            <dd className="m-0 mt-s1 text-sm text-text">{String(extra.berichtigt)}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Löschentscheidungen
            </dt>
            <dd className="m-0 mt-s1 text-sm text-text">{String(extra.geloescht)}</dd>
          </div>
        </dl>

        {extra.auskuenfte.length > 0 && (
          <DataTable
            beschriftung="Erteilte Auskünfte mit Prüfsumme"
            zeilen={[...extra.auskuenfte]}
            schluessel={(a) => a.id}
            spalten={[
              {
                schluessel: 'zeit', kopf: 'Erzeugt',
                zelle: (a) => BERLIN.format(new Date(a.erzeugtAm)),
              },
              { schluessel: 'von', kopf: 'Von', zelle: (a) => a.erzeugtVon ?? '—' },
              { schluessel: 'format', kopf: 'Format', zelle: (a) => a.format },
              {
                schluessel: 'umfang', kopf: 'Umfang', numerisch: true,
                zelle: (a) => `${String(a.abschnitte)} Abschnitte · ${String(a.zeilen)} Zeilen`,
              },
              {
                schluessel: 'voll', kopf: 'Vollständig',
                zelle: (a) => <StatusPill zustand={a.vollstaendig ? 'Aktiv' : 'Fehler'} />,
              },
              {
                schluessel: 'sha', kopf: 'SHA-256',
                zelle: (a) => (
                  <span className="min-w-0 break-all font-mono text-xs">{a.sha256}</span>
                ),
              },
            ]}
          />
        )}
      </section>

      <section aria-labelledby="abschluss">
        <h2 id="abschluss" className="mb-s2 text-h2 text-text">Vorgang abschliessen</h2>
        {erledigt ? (
          <p className="text-sm text-text-muted">
            Entschieden. Eine Entscheidung wird nicht zurückgenommen — eine
            geänderte Sachlage ist ein neuer Vorgang.
          </p>
        ) : darf['datenschutz.auskunft_erstellen'] !== true ? (
          <p className="text-sm text-text-muted">
            Abgeschlossen wird der Vorgang von einer Sitzung mit
            {' '}<code className="font-mono">datenschutz.auskunft_erstellen</code>.
          </p>
        ) : (
          <form method="post" action="/api/datenschutz/bearbeiten"
                data-cse="vorgang-abschluss"
                className="flex max-w-[60ch] flex-col gap-s3">
            <input type="hidden" name="id" value={z.id} />
            <input type="hidden" name="zurueck" value={zurueck} />
            <label className="flex flex-col gap-s2 text-sm text-text">
              Was wurde entschieden, und warum?
              <textarea name="entscheidung" rows={4} required className={feld}
                        data-cse="abschluss-text" />
            </label>
            <div className="flex flex-wrap gap-s2">
              <Button type="submit" name="handlung" value="beantwortet"
                      variante="primary">
                Beantwortet
              </Button>
              <Button type="submit" name="handlung" value="abgelehnt"
                      variante="secondary">
                Abgelehnt
              </Button>
              {z.verlaengertBis === null && (
                <Button type="submit" name="handlung" value="verlaengern"
                        variante="ghost">
                  Frist verlängern
                </Button>
              )}
            </div>
            <p className="m-0 text-xs text-text-muted">
              Art. 12 Abs. 3 Satz 3 erlaubt die Verlängerung um zwei Monate — nur
              einmal, nur mit Grund, und die betroffene Person muss ihn binnen
              eines Monats erfahren. Der Text oben ist dieser Grund.
            </p>
          </form>
        )}
        <p className="mt-s4 max-w-prose text-xs text-text-muted">
          <Link href={`/portal/${mandant}/datenschutz/widersprueche`}
                className="underline-offset-2 hover:text-text hover:underline">
            Nachweisblatt aller Widersprüche
          </Link>
        </p>
      </section>
    </PortalRahmen>
  );
}
