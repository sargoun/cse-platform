import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { MandantAntwort } from '@/app/portal/unterseite';
import {
  ERGEBNIS_TEXT, VOLLZUG, matrix, type Entscheidungszeile, type Ort,
} from '@/server/services/datenschutz/loeschentscheidung';
import { ladeVorgang } from '../../vorgang';
import { BERLIN_TAG, Vorgangskopf } from '../../Vorgangskopf';

/**
 * `/portal/[mandant]/datenschutz/[id]/loeschung` — Art. 17 DSGVO **gegen** die
 * Aufbewahrungspflichten (LEG-09, LEG-01, LEG-02).
 *
 * **Diese Seite löscht nichts, und das sagt sie ganz oben.**
 * `04-SEITENKARTE.md` §5.25: `datenschutz.loeschung_pruefen` *does not delete*;
 * es entsteht ein Entscheidungsnachweis je Feld und Tabelle.
 *
 * **Und sie behauptet auch keinen Vollzug.** Nachgemessen in der lebenden
 * Datenbank: es gibt genau EINEN löschenden Lauf (`bewerber_loeschung`, nur
 * abgelaufene Bewerbungen), keine Funktion mit `anonymisier` im Namen und
 * keinen Codepfad, der `anonymisiert_am` schreibt. Für eine Beschäftigte,
 * einen Kundenkontakt oder eine Firma gibt es also weder Anonymisierung noch
 * Tombstone. Eine Seite, die trotzdem „freigegeben" sagt, erzeugt eine
 * unterschriebene Freigabe für eine Ausführung, die niemand ausführt — genau
 * das, wogegen `loeschkonzept.ts` seine eigene Registerabfrage begründet.
 * Deshalb heisst das Ergebnis hier **Vormerkung** (O-644).
 *
 * **Je Zeile drei Dinge nebeneinander:** was dort über die Person steht, ob
 * Löschung geschuldet ist, und welche Pflicht sie gegebenenfalls überlagert —
 * § 147 AO zehn Jahre, § 17 MiLoG zwei Jahre, die Unveränderlichkeit des
 * Protokolls, die Hashkette des Wachbuchs, § 7 UWG für den Werbewiderspruch.
 * Die Frist rechnet eine getestete Funktion im Berliner Kalender, kein Modell
 * (Invariante 6).
 *
 * **Ein Ort, dessen Recht fehlt, ist `ungelesen` — nicht leer.** Sonst
 * entstünde eine Löschentscheidung über Ungelesenes, und die trägt den Namen
 * eines Menschen.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Löschung (Art. 17) — Datenschutz' };

const ERGEBNIS_PILLE: Readonly<Record<Entscheidungszeile['ergebnis'], PillZustand>> = {
  geschuldet: 'Abgeschlossen',
  ueberlagert: 'Wartet',
  anonymisierung: 'In Arbeit',
  offen: 'Offen',
};

export default async function Loeschungsseite(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;

  const geladen = await ladeVorgang<readonly Ort[]>(
    `/portal/${mandant}/datenschutz/${id}/loeschung`, mandant, id,
    ['crm.lesen', 'crm.rechtsgrundlage_lesen'],
    async (kontext, v) => matrix(kontext, v.z.id, v.zuordnung),
  );
  if (geladen.art !== 'ok') return <MandantAntwort tor={geladen.tor} />;
  const { zugang, z, zuordnung, darf, extra: orte } = geladen;

  const darfSchreiben = darf['datenschutz.loeschung_pruefen'] === true;
  const erledigt = ['beantwortet', 'abgelehnt'].includes(z.status);
  const zurueck = `/portal/${mandant}/datenschutz/${z.id}/loeschung`;
  const feld = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';
  const ungelesen = orte.filter((o) => o.ungelesen);
  const entschieden = orte.filter((o) => o.entscheidung !== null).length;

  return (
    <PortalRahmen
      titel="Löschung (Art. 17)"
      wurzelTitel="Datenschutz"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <Vorgangskopf mandant={mandant} z={z} zuordnung={zuordnung} aktiv="loeschung"
                    darf={darf} />

      <Hinweis art="warnung" cse="loeschung-keine-loeschung" className="mb-s5 max-w-prose">
        <strong className="block">Diese Seite löscht nichts.</strong>
        Sie prüft den Antrag gegen die Aufbewahrungspflichten und erzeugt eine
        <strong> Entscheidung je Tabelle</strong>. Die Stunden selbst bleiben,
        weil das Gesetz sie verlangt — § 17 Abs. 2 MiLoG zwei Jahre, § 147 AO
        zehn Jahre ab Ende des Kalenderjahres.
      </Hinweis>

      <Hinweis art="warnung" cse="loeschung-vollzug" className="mb-s6 max-w-prose">
        <strong className="block">
          Der Vollzug fehlt heute — die Entscheidung ist eine Vormerkung (O-644).
        </strong>
        Was wirklich löscht:
        <ul className="m-0 mt-s2 list-disc ps-s5">
          {VOLLZUG.vorhanden.map((v) => <li key={v}>{v}</li>)}
        </ul>
        <span className="mt-s2 block">Was fehlt:</span>
        <ul className="m-0 mt-s1 list-disc ps-s5">
          {VOLLZUG.fehlend.map((v) => <li key={v}>{v}</li>)}
        </ul>
        <span className="mt-s2 block">
          Eine Freigabe für eine Ausführung, die niemand ausführt, wäre schlimmer
          als keine: sie trägt den Namen eines Menschen. Solange kein
          Anonymisierungsweg existiert, ist das Ergebnis eine dokumentierte
          Vormerkung, und die Ausführung geschieht von Hand und wird hier
          nachgetragen.{' '}
          <Link href={`/portal/${mandant}/datenschutz/loeschkonzept`}
                className="underline-offset-2 hover:text-text hover:underline">
            Löschkonzept der Gesellschaft
          </Link>
        </span>
      </Hinweis>

      {zuordnung.art === 'keine' ? (
        <Hinweis art="warnung" cse="loeschung-ohne-zuordnung" className="mb-s6 max-w-prose">
          <strong className="block">Dieser Vorgang ist keinem Datensatz zugeordnet.</strong>
          Welche Tabellen betroffen sind, lässt sich ohne den Datensatz nicht
          sagen.{' '}
          <Link href={`/portal/${mandant}/datenschutz/${z.id}`}
                className="underline-offset-2 hover:text-text hover:underline">
            Zuerst zuordnen
          </Link>
        </Hinweis>
      ) : null}

      {ungelesen.length > 0 ? (
        <Hinweis art="warnung" cse="loeschung-ungelesen" className="mb-s6 max-w-prose">
          <strong className="block">
            {`${String(ungelesen.length)} Ort(e) konnten nicht gelesen werden.`}
          </strong>
          Dort steht keine Zahl, sondern „ungelesen": die Datenbank antwortet auf
          ein fehlendes Recht mit null Zeilen, und „null" hiesse hier „über diesen
          Menschen ist dort nichts gespeichert". Eine Löschentscheidung darauf wäre
          eine Entscheidung über Ungelesenes. Fehlend:{' '}
          {[...new Set(ungelesen.map((o) => o.recht ?? ''))].map((r) => (
            <code key={r} className="me-s2 font-mono">{r}</code>
          ))}
        </Hinweis>
      ) : null}

      <section aria-labelledby="matrix" className="mb-s7">
        <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 id="matrix" className="m-0 text-h2 text-text">
            Orte, Pflichten und Entscheidungen
          </h2>
          <p className="m-0 text-sm text-text-muted">
            {`${String(entschieden)} von ${String(orte.length)} entschieden`}
          </p>
        </div>

        {orte.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Ohne Zuordnung gibt es keine Matrix.
          </p>
        ) : (
          <DataTable
            beschriftung="Je Tabelle: Bestand, Löschsperre, Aufbewahrungspflicht und Entscheidung"
            zeilen={[...orte]}
            schluessel={(o) => o.tabelle}
            spalten={[
              {
                schluessel: 'ort',
                kopf: 'Ort',
                zelle: (o) => (
                  <span>
                    {o.titel}
                    <span className="block font-mono text-xs text-text-muted">
                      {o.tabelle}
                    </span>
                  </span>
                ),
              },
              {
                schluessel: 'bestand',
                kopf: 'Zeilen',
                numerisch: true,
                zelle: (o) => (o.ungelesen
                  ? <span className="text-warning">ungelesen</span>
                  : String(o.zeilen)),
              },
              {
                schluessel: 'sperre',
                kopf: 'Was der Löschung entgegensteht',
                zelle: (o) => (
                  <span>
                    {o.sperreText}
                    <span className="block text-xs text-text-muted">
                      {o.loeschartText}
                    </span>
                  </span>
                ),
              },
              {
                schluessel: 'faellt',
                kopf: 'Sperre fällt',
                zelle: (o) => (o.sperreFaelltAm === null
                  ? <span className="text-text-subtle">—</span>
                  : BERLIN_TAG.format(
                    new Date(`${o.sperreFaelltAm}T12:00:00Z`))),
              },
              {
                schluessel: 'entscheidung',
                kopf: 'Entscheidung',
                zelle: (o) => (o.entscheidung === null
                  ? <span className="text-text-subtle">offen</span>
                  : (
                    <span>
                      <StatusPill zustand={ERGEBNIS_PILLE[o.entscheidung.ergebnis]} />
                      <span className="block text-xs text-text-muted">
                        {ERGEBNIS_TEXT[o.entscheidung.ergebnis]}
                      </span>
                      {o.entscheidung.rechtsgrundlage === null ? null : (
                        <span className="block text-xs text-text-muted">
                          {o.entscheidung.rechtsgrundlage}
                        </span>
                      )}
                      {o.entscheidung.offeneFrage === null ? null : (
                        <span className="block text-xs text-warning">
                          {o.entscheidung.offeneFrage}
                        </span>
                      )}
                      <span className="block text-xs text-text-subtle">
                        {o.entscheidung.entschiedenVon ?? '—'}
                      </span>
                    </span>
                  )),
              },
              {
                schluessel: 'handlung',
                kopf: '',
                zelle: (o) => (!darfSchreiben || erledigt
                  ? <span className="text-text-subtle">—</span>
                  : (
                    <details data-cse="ort-entscheiden">
                      <summary className="cursor-pointer text-sm text-brand">
                        Entscheiden
                      </summary>
                      <form method="post" action="/api/datenschutz/loeschung"
                            className="mt-s3 flex flex-col gap-s2">
                        <input type="hidden" name="anfrage" value={z.id} />
                        <input type="hidden" name="tabelle" value={o.tabelle} />
                        <input type="hidden" name="zeilen"
                               value={String(o.ungelesen ? 0 : o.zeilen)} />
                        <input type="hidden" name="zurueck" value={zurueck} />
                        <label className="flex flex-col gap-s2 text-xs text-text">
                          Fundstelle der Pflicht (bei „überlagert" Pflicht)
                          <input name="rechtsgrundlage" className={feld}
                                 data-cse="ort-fundstelle"
                                 defaultValue={o.sperre.art === 'gesetz'
                                   || o.sperre.art === 'unveraenderlich'
                                   ? o.sperreText : ''} />
                        </label>
                        <label className="flex flex-col gap-s2 text-xs text-text">
                          Sperre fällt am
                          <input name="sperreFaelltAm" type="date" className={feld}
                                 data-cse="ort-frist"
                                 defaultValue={o.sperreFaelltAm ?? ''} />
                        </label>
                        <label className="flex flex-col gap-s2 text-xs text-text">
                          Offene Frage (bei „offen" Pflicht)
                          <input name="offeneFrage" className={feld}
                                 data-cse="ort-frage"
                                 defaultValue={o.sperre.art === 'offen'
                                   ? o.sperre.frage : ''} />
                        </label>
                        <label className="flex flex-col gap-s2 text-xs text-text">
                          Bemerkung
                          <textarea name="bemerkung" rows={2} className={feld} />
                        </label>
                        <div className="flex flex-wrap gap-s2">
                          <Button type="submit" name="ergebnis" value="geschuldet"
                                  variante="secondary">
                            Geschuldet
                          </Button>
                          <Button type="submit" name="ergebnis" value="ueberlagert"
                                  variante="secondary">
                            Überlagert
                          </Button>
                          <Button type="submit" name="ergebnis" value="anonymisierung"
                                  variante="secondary">
                            Anonymisierung
                          </Button>
                          <Button type="submit" name="ergebnis" value="offen"
                                  variante="ghost">
                            Offen
                          </Button>
                        </div>
                      </form>
                    </details>
                  )),
              },
            ]}
          />
        )}
      </section>

      {!darfSchreiben && (
        <p className="text-sm text-text-muted" data-cse="loeschung-kein-recht">
          Entschieden wird von einer Sitzung mit
          {' '}<code className="font-mono">datenschutz.loeschung_pruefen</code>.
          Sie sehen diese Seite, weil Sie eine der anderen Zuständigkeiten haben.
        </p>
      )}
    </PortalRahmen>
  );
}
