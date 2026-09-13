import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { oeffneFreigabe, type FreigabeAnsicht } from '@/server/services/freigabe/laden';
import { anzahlAenderungen } from '@/server/services/freigabe/diff';
import { euroMitVorzeichen, OHNE_VERGLEICH } from '@/server/services/freigabe/zusammenfassung';
import { mengeNachPostgres } from '@/server/services/finanz/menge';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  FEHLER_TEXT, RISIKO_LABEL, STATUS_LABEL, STATUS_PILL, VORGANG_LABEL, zeitpunkt,
} from '../darstellung';

/**
 * `/portal/[mandant]/freigaben/[id]` — die Prüfung (APR-02, APR-03, APR-07,
 * APR-08, `04-SEITENKARTE.md` §5.20, D-472).
 *
 * **Das Öffnen ist eine Handlung.** Diese Seite liest über `oeffneFreigabe`,
 * und das schreibt die `freigabe_ansicht`-Zeile, auf der die Prüfdauer
 * gemessen wird — vom Server, mit `now()`, nie aus einem Rumpf (K-13). Ohne
 * diese Zeile weist die Datenbank die Entscheidung ab. Deshalb eine
 * schreibende Transaktion für eine Leseseite.
 *
 * **Der Knopf ist die Anzeige eines Riegels, nicht der Riegel.** „Freigeben"
 * ist gesperrt, solange `unsichere_felder_anzahl > 0` — die Zahl führt die
 * Datenbank (`trg_freigabe_felder_zaehlen`), die Sperre der Dienst
 * (`entscheideFreigabe`), und wer den Knopf im Browser entsperrt, trifft
 * den Dienst.
 *
 * **Nichts wird hier gerechnet.** Der Diff stand in der Zeile, seit der
 * Vorschlag geschrieben wurde; die Kopfzeile ist die gespeicherte
 * Zusammenfassung aus der Vorlage (D-464). Die Seite formatiert.
 */
export const dynamic = 'force-dynamic';

/**
 * `[id]` faengt auch `/freigaben/stapel` oder `/freigaben/erledigt` — Routen
 * der Karte, die noch keine Seite haben (PR 77). Ein Wort ist keine Kennung:
 * ohne diese Wache liefe `where f.id = $1` in „invalid input syntax for type
 * uuid" und die Seite in einen 500 statt in einen 404.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const FELD_LABEL: Readonly<Record<string, string>> = {
  menge: 'Menge', einzelpreis: 'Einzelpreis', betrag: 'Betrag',
  bezeichnung: 'Bezeichnung', herkunft: 'Herkunft', meta: 'Merkmal',
};

function Kasten(
  { art, kinder, cse }: { art: 'hinweis' | 'warnung' | 'erfolg'; kinder: React.ReactNode; cse: string },
) {
  const klasse = art === 'warnung'
    ? 'border-warning bg-warning-soft text-warning'
    : art === 'erfolg'
      ? 'border-success bg-success-soft text-success'
      : 'border-line bg-surface text-text';
  return (
    <section data-cse={cse} className={`mb-s6 rounded-lg border p-s5 text-sm ${klasse}`}>
      {kinder}
    </section>
  );
}

export default async function Freigabe(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  if (!UUID.test(id)) notFound();
  const suche = await searchParams;
  const zugang = await portalZugang(`/portal/${mandant}/freigaben/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const ansicht = await (db().begin(
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) =>
      oeffneFreigabe(kontext, id, 'web')))) as FreigabeAnsicht | null;
  if (ansicht === null) notFound();

  const f = ansicht.freigabe;
  const offen = f.status === 'offen';
  const gesperrt = f.unsichereFelder > 0;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const entschieden = typeof suche['entschieden'] === 'string' ? suche['entschieden'] : null;
  const titel = f.titel ?? 'Freigabe';
  const diff = ansicht.diff;
  const aenderungen = diff === null ? 0 : anzahlAenderungen(diff);
  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel={titel}
      wurzelTitel="Freigaben"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="freigaben"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div className="min-w-0">
          <h1 className="text-h1 text-text">{titel}</h1>
          <p className="mt-s2 flex flex-wrap items-center gap-s3 text-sm text-text-muted">
            <StatusPill zustand={STATUS_PILL[f.status]} />
            <span data-cse="freigabe-status" data-status={f.status}>{STATUS_LABEL[f.status]}</span>
          </p>
        </div>
        <Link
          href={`/portal/${mandant}/freigaben`}
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          Zum Posteingang
        </Link>
      </div>

      {entschieden !== null && ansicht.schnappschuss !== null ? (
        <Kasten art="erfolg" cse="entscheidung-vermerkt" kinder={(
          <>
            <strong>{entschieden === 'genehmigt' ? 'Freigegeben.' : 'Abgelehnt.'}</strong>
            {' '}Kettenglied Nr. {ansicht.schnappschuss.ketteNr.toString()} ist geschrieben und
            unveränderlich.
          </>
        )}
        />
      ) : null}
      {fehler !== null ? (
        <Kasten art="warnung" cse="entscheidung-abgewiesen" kinder={(
          <>
            <strong>Nicht entschieden.</strong>{' '}
            {FEHLER_TEXT[fehler] ?? 'Die Entscheidung wurde abgewiesen.'}
          </>
        )}
        />
      ) : null}

      <dl className="mb-s7 grid grid-cols-2 gap-s4 sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-sm text-text-subtle">Art</dt>
          <dd className="break-words text-text">
            {f.vorgangTyp === null ? f.aktion : VORGANG_LABEL[f.vorgangTyp]}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-text-subtle">Risiko</dt>
          <dd className="text-text" data-cse="freigabe-risiko" data-risiko={f.risiko ?? ''}>
            {f.risiko === null ? '—' : RISIKO_LABEL[f.risiko]}
            {f.risikoPunkte === null ? null : (
              <span className="text-text-subtle"> · {String(f.risikoPunkte)} Pkt.</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-text-subtle">Frist</dt>
          <dd className="text-text">{zeitpunkt(f.frist)}</dd>
        </div>
        <div>
          <dt className="text-sm text-text-subtle">Betrag</dt>
          <dd className="text-text">
            {f.betragCent === null ? '—' : formatiereGeld(f.betragCent)}
          </dd>
        </div>
      </dl>

      {/* APR-02: was sich geändert hat — die Kopfzeile zuerst */}
      <section aria-labelledby="diff-titel" className="mb-s7">
        <h2 id="diff-titel" className="mb-s3 text-h2 text-text">Was sich geändert hat</h2>
        <p data-cse="freigabe-kopfzeile" className="mb-s4 text-h3 text-text">
          {f.zusammenfassung ?? OHNE_VERGLEICH}
        </p>
        {diff === null ? (
          <p className="text-sm text-text-muted">
            Es gibt keinen vergleichbaren Vorgang. Der Vorschlag ist vollständig zu
            prüfen — die Vorschau der Nutzlast steht unten.
          </p>
        ) : aenderungen === 0 ? (
          <p className="text-sm text-text-muted">
            Keine Position hat sich gegenüber dem Vergleich geändert.
          </p>
        ) : (
          <>
            {diff.hinzugefuegt.length > 0 ? (
              <DataTable
                beschriftung="Neue Positionen"
                zeilen={diff.hinzugefuegt}
                schluessel={(p) => `neu-${p.objektId ?? ''}-${p.leistungskatalogId ?? ''}-${p.bezeichnung}`}
                spalten={[
                  { schluessel: 'bez', kopf: 'Neu', zelle: (p) => p.bezeichnung },
                  {
                    schluessel: 'menge', kopf: 'Menge', numerisch: true,
                    zelle: (p) => `${mengeNachPostgres(p.menge)} ${p.einheit}`,
                  },
                  {
                    schluessel: 'ep', kopf: 'Einzelpreis', numerisch: true,
                    zelle: (p) => formatiereGeld(p.einzelpreisCent),
                  },
                  {
                    schluessel: 'betrag', kopf: 'Betrag', numerisch: true,
                    zelle: (p) => euroMitVorzeichen(p.betragCent),
                  },
                ]}
              />
            ) : null}
            {diff.entfallen.length > 0 ? (
              <div className="mt-s4">
                <DataTable
                  beschriftung="Entfallene Positionen"
                  zeilen={diff.entfallen}
                  schluessel={(p) => `weg-${p.objektId ?? ''}-${p.leistungskatalogId ?? ''}-${p.bezeichnung}`}
                  spalten={[
                    { schluessel: 'bez', kopf: 'Entfällt', zelle: (p) => p.bezeichnung },
                    {
                      schluessel: 'menge', kopf: 'Menge', numerisch: true,
                      zelle: (p) => `${mengeNachPostgres(p.menge)} ${p.einheit}`,
                    },
                    {
                      schluessel: 'betrag', kopf: 'Betrag', numerisch: true,
                      zelle: (p) => euroMitVorzeichen(-p.betragCent as typeof p.betragCent),
                    },
                  ]}
                />
              </div>
            ) : null}
            {diff.geaendert.length > 0 ? (
              <div className="mt-s4">
                <DataTable
                  beschriftung="Geänderte Positionen"
                  zeilen={diff.geaendert}
                  schluessel={(a) => `${a.schluessel}-${a.feld}`}
                  spalten={[
                    { schluessel: 'bez', kopf: 'Position', zelle: (a) => a.bezeichnung },
                    { schluessel: 'feld', kopf: 'Feld', zelle: (a) => FELD_LABEL[a.feld] ?? a.feld },
                    { schluessel: 'alt', kopf: 'Vorher', zelle: (a) => a.alt },
                    { schluessel: 'neu', kopf: 'Nachher', zelle: (a) => a.neu },
                    {
                      schluessel: 'delta', kopf: 'Differenz', numerisch: true,
                      zelle: (a) => (a.deltaCent === null
                        ? <span className="text-text-subtle">—</span>
                        : euroMitVorzeichen(a.deltaCent)),
                    },
                  ]}
                />
              </div>
            ) : null}
            <dl className="mt-s4 grid grid-cols-2 gap-s4 sm:grid-cols-4" data-cse="diff-summen">
              <div>
                <dt className="text-sm text-text-subtle">Netto</dt>
                <dd className="text-text">{euroMitVorzeichen(diff.deltaNettoCent)}</dd>
              </div>
              <div>
                <dt className="text-sm text-text-subtle">Brutto</dt>
                <dd className="text-text">{euroMitVorzeichen(diff.deltaBruttoCent)}</dd>
              </div>
              {diff.deltaUstGruppen.map((g) => (
                <div key={g.steuersatzGruppeId}>
                  <dt className="text-sm text-text-subtle">USt {g.steuersatzGruppeId}</dt>
                  <dd className="text-text">{euroMitVorzeichen(g.deltaUstCent)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>

      {/* APR-03: jeder extrahierte Wert nennt seine Quelle */}
      <section aria-labelledby="felder-titel" className="mb-s7">
        <h2 id="felder-titel" className="mb-s3 text-h2 text-text">Nachweise</h2>
        {ansicht.felder.length === 0 ? (
          <p className="text-sm text-text-muted">
            Keine extrahierten Felder — dieser Vorschlag stammt nicht aus einem Dokument.
          </p>
        ) : (
          <DataTable
            beschriftung="Extrahierte Felder mit Quelle und Konfidenz"
            zeilen={ansicht.felder}
            schluessel={(x) => x.id}
            spalten={[
              {
                schluessel: 'feld', kopf: 'Feld',
                zelle: (x) => (
                  <span className="flex min-w-0 flex-col">
                    <span className="text-text">{x.bezeichnung}</span>
                    <span className="break-all font-mono text-xs text-text-subtle">{x.feldPfad}</span>
                  </span>
                ),
              },
              {
                schluessel: 'vorher', kopf: 'Vorher',
                zelle: (x) => x.wertVorher ?? <span className="text-text-subtle">—</span>,
              },
              {
                schluessel: 'nachher', kopf: 'Nachher',
                zelle: (x) => x.wertNachher ?? <span className="text-text-subtle">—</span>,
              },
              {
                schluessel: 'konfidenz', kopf: 'Konfidenz', numerisch: true,
                zelle: (x) => x.konfidenz ?? <span className="text-text-subtle">—</span>,
              },
              {
                schluessel: 'pruefung', kopf: 'Prüfung',
                zelle: (x) => (x.unsicher
                  ? (
                    <span className="inline-flex items-start gap-s2" data-cse="feld-unsicher">
                      <StatusPill zustand="Wartet" />
                      <span className="text-xs text-warning">{x.grund}</span>
                    </span>
                  )
                  : <StatusPill zustand="Bereit" />),
              },
              {
                schluessel: 'quelle', kopf: 'Quelle',
                zelle: (x) => (
                  <span className="flex min-w-0 flex-col text-xs text-text-muted">
                    {x.quelle.dokumentTitel === null ? null : <span>{x.quelle.dokumentTitel}</span>}
                    {x.quelle.seite === null && x.quelle.tabelle === null ? null : (
                      <span>
                        {x.quelle.seite === null ? '' : `Seite ${String(x.quelle.seite)} `}
                        {x.quelle.tabelle === null ? '' : `Tabelle ${x.quelle.tabelle}`}
                        {x.quelle.zelle === null ? '' : ` · ${x.quelle.zelle}`}
                      </span>
                    )}
                    {x.quelle.zitat === null ? null : <q className="text-text">{x.quelle.zitat}</q>}
                  </span>
                ),
              },
            ]}
          />
        )}
      </section>

      {/* Die Nutzlast selbst — vollständig, nicht ausgewählt */}
      <details className="mb-s7 rounded-lg border border-line bg-surface p-s5">
        <summary className="cursor-pointer text-sm text-text">Vorschau der Nutzlast</summary>
        <div className="mt-s3 overflow-x-auto">
          <pre className="font-mono text-xs text-text-muted" data-cse="nutzlast-vorschau">
            {JSON.stringify(ansicht.vorschau, null, 2)}
          </pre>
        </div>
        {f.payloadHash === null ? null : (
          <p className="mt-s3 break-all font-mono text-xs text-text-subtle">
            SHA-256 {f.payloadHash}
          </p>
        )}
      </details>

      {offen ? (
        <section aria-labelledby="entscheidung-titel" className="mb-s7">
          <h2 id="entscheidung-titel" className="mb-s3 text-h2 text-text">Entscheidung</h2>
          {gesperrt ? (
            <Kasten art="warnung" cse="freigeben-gesperrt" kinder={(
              <>
                <strong>Freigeben ist gesperrt:</strong>{' '}
                {String(f.unsichereFelder)} Feld(er) sind unsicher (APR-03). Eine Korrektur ist
                eine neue Freigabe; diese lässt sich nur ablehnen.
              </>
            )}
            />
          ) : null}
          <form method="post" action={`/api/freigaben/${id}/entscheidung`} className="flex flex-col gap-s4">
            <label className="flex flex-col gap-s2 text-sm text-text" htmlFor="begruendung">
              Begründung
              <span className="text-xs text-text-muted">
                Pflicht bei Ablehnung — sie steht später allein in der Kette.
              </span>
              <textarea id="begruendung" name="begruendung" rows={3} className={feld} />
            </label>
            <div className="flex flex-wrap gap-s3">
              <Button
                type="submit" name="entscheidung" value="genehmigt" variante="primary"
                disabled={gesperrt} data-cse="freigeben"
              >
                Freigeben
              </Button>
              <Button type="submit" name="entscheidung" value="abgelehnt" data-cse="ablehnen">
                Ablehnen
              </Button>
            </div>
          </form>
        </section>
      ) : ansicht.schnappschuss !== null ? (
        <section aria-labelledby="schnappschuss-titel" className="mb-s7" data-cse="schnappschuss">
          <h2 id="schnappschuss-titel" className="mb-s3 text-h2 text-text">Entscheidung</h2>
          <dl className="grid grid-cols-1 gap-s4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-text-subtle">Entschieden</dt>
              <dd className="text-text">
                {zeitpunkt(ansicht.schnappschuss.entschiedenAm)}
                {f.freigegebenVonName === null ? '' : ` · ${f.freigegebenVonName}`}
                {ansicht.schnappschuss.rolle === null ? '' : ` (${ansicht.schnappschuss.rolle})`}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-text-subtle">Kettenglied</dt>
              <dd className="text-text">Nr. {ansicht.schnappschuss.ketteNr.toString()}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-sm text-text-subtle">Begründung</dt>
              <dd className="break-words text-text">{ansicht.schnappschuss.begruendung ?? '—'}</dd>
            </div>
          </dl>
          <p className="mt-s3 break-all font-mono text-xs text-text-subtle">
            SHA-256 {ansicht.schnappschuss.hash}
          </p>
        </section>
      ) : null}
    </PortalRahmen>
  );
}
