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
import { RUECKNAHME_OFFENE_FRAGE } from '@/server/services/freigabe/fenster.platzhalter';
import { anzahlAenderungen } from '@/server/services/freigabe/diff';
import { euroMitVorzeichen, OHNE_VERGLEICH } from '@/server/services/freigabe/zusammenfassung';
import { mengeNachPostgres } from '@/server/services/finanz/menge';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../kennung';
import {
  FEHLER_TEXT, RISIKO_LABEL, STATUS_LABEL, STATUS_PILL, VORGANG_LABEL,
  ausfuehrungText, zeitpunkt,
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

/** Fensterfristen werden in Berliner Ortszeit angezeigt (Invariante 2, K-11). */
const ZEIT = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

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
  kennungOder404(id);
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

  /**
   * **Einspruch und Rücknahme sind zwei eigene, bindbare Befugnisse**
   * (Katalog: `freigabe.einspruch_erheben`, `freigabe.rueckgaengig`). Wer sie
   * nicht hält, sieht das Fenster nicht — ein Formular anzuzeigen, das mit
   * 403 antwortet, ist keine Auskunft, sondern eine Einladung.
   */
  const { ansicht, darfEinspruch, darfRuecknahme } = await (db().begin(
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const [rechte] = await kontext.abfrage<{ einspruch: boolean; ruecknahme: boolean }>(
        `select app.hat_recht('freigabe.einspruch_erheben', app.aktiver_mandant()) as einspruch,
                app.hat_recht('freigabe.rueckgaengig', app.aktiver_mandant()) as ruecknahme`);
      return {
        ansicht: await oeffneFreigabe(kontext, id, 'web'),
        darfEinspruch: rechte?.einspruch === true,
        darfRuecknahme: rechte?.ruecknahme === true,
      };
    }))) as {
      ansicht: FreigabeAnsicht | null; darfEinspruch: boolean; darfRuecknahme: boolean;
    };
  if (ansicht === null) notFound();

  const f = ansicht.freigabe;
  const offen = f.status === 'offen';
  const gesperrt = f.unsichereFelder > 0;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const fehlerMeldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;
  const entschieden = typeof suche['entschieden'] === 'string' ? suche['entschieden'] : null;
  const vorschlag = typeof suche['vorschlag'] === 'string' ? suche['vorschlag'] : null;
  /** Was das Fensterformular vermerkt hat (APR-05, APR-06). */
  const vermerkt = typeof suche['vermerkt'] === 'string' ? suche['vermerkt'] : null;
  /* PR 63: ein Vorschlag aus einer E-Rechnung — mit den zwei Wegen, die er hat. */
  const istERechnung = f.aktion === 'eingangsrechnung_uebernehmen';
  const uebernommen = istERechnung && f.bezugTyp === 'eingangsrechnung' && f.bezugId !== null
    ? f.bezugId : null;
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
            {/*
              * **Entscheidung und Handlung sind zweierlei** (§4.8). Eine
              * genehmigte Freigabe, deren Handlung noch aussteht, sah bisher
              * aus wie eine erledigte — der Stand der AUSFÜHRUNG stand
              * nirgends. Er steht hier, und er sagt auch „nichts zu tun",
              * wenn es für diese Vorgangsart keine Handlung gibt: eine
              * Genehmigung, die nur ein Vermerk ist, soll nicht so aussehen,
              * als warte sie auf etwas.
              */}
            {f.status === 'genehmigt' ? (
              <span data-cse="ausfuehrung-stand" data-stand={f.ausfuehrungStatus}>
                {ausfuehrungText(f.ausfuehrungStatus, f.aktion)}
              </span>
            ) : null}
          </p>
        </div>
        <Link
          href={`/portal/${mandant}/freigaben`}
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          Zum Posteingang
        </Link>
      </div>

      {vorschlag !== null ? (
        <Kasten art="hinweis" cse="vorschlag-angelegt" kinder={(
          <>
            <strong>{vorschlag === 'neu' ? 'Vorschlag angelegt.' : 'Diese Datei hatte schon einen Vorschlag.'}</strong>{' '}
            Die E-Rechnung ist gelesen; jedes Feld steht unten mit seiner Quelle und seiner
            Prüfung. Erst die Freigabe erzeugt die Eingangsrechnung.
          </>
        )}
        />
      ) : null}
      {entschieden !== null && ansicht.schnappschuss !== null ? (
        <Kasten art="erfolg" cse="entscheidung-vermerkt" kinder={(
          <>
            <strong>{entschieden === 'genehmigt' ? 'Freigegeben.' : 'Abgelehnt.'}</strong>
            {' '}Kettenglied Nr. {ansicht.schnappschuss.ketteNr.toString()} ist geschrieben und
            unveränderlich.
            {uebernommen !== null ? (
              <>
                {' '}Die Eingangsrechnung ist angelegt:{' '}
                <Link href={`/portal/${mandant}/finanzen/eingangsrechnungen/${uebernommen}`}
                      data-cse="zur-eingangsrechnung" className="underline underline-offset-2">
                  zur Eingangsrechnung
                </Link>.
              </>
            ) : null}
          </>
        )}
        />
      ) : null}
      {/*
        * **Ein Einspruch und eine Rücknahme sind Ereignisse, keine
        * Korrekturen** — sie bekommen deshalb ihre eigene Rückmeldung und
        * nicht die der Entscheidung. Wer widersprochen hat, soll lesen, was
        * jetzt gilt, nicht, was vorher galt.
        */}
      {vermerkt !== null ? (
        <Kasten art="erfolg" cse="fenster-vermerkt" kinder={(
          <>
            <strong>
              {vermerkt === 'einspruch' ? 'Einspruch vermerkt.' : 'Zurückgenommen.'}
            </strong>{' '}
            {vermerkt === 'einspruch'
              ? 'Die Genehmigung ist widerrufen; ausgelöst wurde nichts (APR-05). '
                + 'Eine erneute Entscheidung ist eine NEUE Freigabe (§4.5).'
              : 'Die Ausführung ist zurückgenommen — die Entscheidung und ihr '
                + 'Schnappschuss bleiben, was sie waren (APR-06, APR-07).'}
          </>
        )}
        />
      ) : null}
      {fehler !== null ? (
        <Kasten art="warnung" cse="entscheidung-abgewiesen" kinder={(
          <>
            <strong>Nicht entschieden.</strong>{' '}
            {fehler === 'ausfuehrung' && fehlerMeldung !== null
              ? fehlerMeldung
              : (FEHLER_TEXT[fehler] ?? 'Die Entscheidung wurde abgewiesen.')}
          </>
        )}
        />
      ) : null}
      {istERechnung && offen ? (
        <Kasten art="hinweis" cse="erechnung-wege" kinder={(
          <>
            <strong>Aus einer E-Rechnung gelesen.</strong>{' '}
            Freigeben übernimmt genau diese Werte als Eingangsrechnung.
            {gesperrt
              ? ' Da Felder unsicher sind, ist die Freigabe gesperrt — die Werte lassen sich '
                + 'von Hand prüfen und erfassen:'
              : ' Wer lieber selbst erfasst, findet die Werte vorbelegt:'}{' '}
            <Link href={`/portal/${mandant}/finanzen/eingangsrechnungen/neu?von=${id}`}
                  data-cse="manuell-erfassen" className="underline underline-offset-2">
              manuell erfassen
            </Link>.
          </>
        )}
        />
      ) : null}
      {istERechnung && uebernommen !== null && entschieden === null ? (
        <Kasten art="hinweis" cse="erechnung-uebernommen" kinder={(
          <>
            <strong>Übernommen.</strong>{' '}
            <Link href={`/portal/${mandant}/finanzen/eingangsrechnungen/${uebernommen}`}
                  data-cse="zur-eingangsrechnung" className="underline underline-offset-2">
              Zur Eingangsrechnung
            </Link>.
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

      {/*
        * **Das Einspruchsfenster (APR-05).** Die Entscheidung ist gefallen, die
        * Ausführung noch nicht — und bis zum Ablauf kann jemand widersprechen.
        * Nach Ablauf steht der Knopf nicht mehr da: ein Knopf, den die
        * Datenbank abweisen würde, hätte gar nicht erst dastehen dürfen.
        */}
      {darfEinspruch && f.verzoegertBis !== null && f.verzoegertBis > new Date() ? (
        <section className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5"
                 data-cse="einspruch-fenster">
          <h2 className="mb-s2 text-h2 text-text">Einspruchsfenster läuft</h2>
          <p className="mb-s3 text-sm text-text-muted">
            Genehmigt, aber noch nicht ausgelöst — bis{' '}
            <strong>{ZEIT.format(f.verzoegertBis)}</strong> kann jemand widersprechen (APR-05).
            Danach läuft die Ausführung an; das Fenster ist ein Platzhalter (O-108).
          </p>
          <form method="post" action="/api/freigaben/fenster" className="flex flex-col gap-s3">
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="freigabe" value={id} />
            <input type="hidden" name="was" value="einspruch" />
            <label className="flex flex-col gap-s2 text-sm text-text">
              Grund des Einspruchs
              <input type="text" name="grund" required minLength={5} maxLength={500}
                     className={feld} />
            </label>
            <div>
              <Button type="submit" variante="danger" data-cse="einspruch-erheben">
                Einspruch erheben
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {/*
        * **Das Rücknahmefenster (APR-06)** — nur dort, wo die Handlung
        * umkehrbar ist. Es nimmt die AUSFÜHRUNG zurück, nicht die
        * Entscheidung: der Schnappschuss bleibt, was er war (APR-07).
        */}
      {/*
        * **Wo der Knopf stünde, steht der Grund** (APR-06, O-368). Eine
        * ausgeführte Handlung ohne laufendes Fenster sah vorher aus wie eine,
        * bei der man das Fenster verpasst hat. Sie ist etwas anderes: für
        * diese Handlung ist kein Rückweg gebaut, und ein Knopf, der nur den
        * Stand umsetzt, wäre ein vorgetäuschter Erfolg.
        */}
      {f.status === 'genehmigt' && f.ausfuehrungStatus === 'ausgefuehrt' && f.undoBis === null ? (
        <Kasten art="hinweis" cse="keine-ruecknahme" kinder={(
          <>
            <strong>Kein Rückgängig für diese Handlung.</strong>{' '}
            Der Weg dafür steht — Fenster, Frist, eigenes Recht, Protokoll —, aber er ist
            für nichts armiert: zurückzunehmen wäre die HANDLUNG, nicht der Stand, und
            dafür gibt es hier keinen gebauten Rückweg. Eine Korrektur ist eine NEUE
            Freigabe (§4.5). Offene Frage: {RUECKNAHME_OFFENE_FRAGE}.
          </>
        )}
        />
      ) : null}
      {darfRuecknahme && f.undoBis !== null && f.undoBis > new Date() ? (
        <section className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5"
                 data-cse="ruecknahme-fenster">
          <h2 className="mb-s2 text-h2 text-text">Rücknahme möglich</h2>
          <p className="mb-s3 text-sm text-text-muted">
            Ausgeführt — bis <strong>{ZEIT.format(f.undoBis)}</strong> lässt sich das
            zurücknehmen (APR-06). Zurückgenommen wird die Ausführung, nicht die Entscheidung:
            der Schnappschuss bleibt, was er war.
          </p>
          <form method="post" action="/api/freigaben/fenster" className="flex flex-col gap-s3">
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="freigabe" value={id} />
            <input type="hidden" name="was" value="ruecknahme" />
            <label className="flex flex-col gap-s2 text-sm text-text">
              Grund der Rücknahme
              <input type="text" name="grund" required minLength={5} maxLength={500}
                     className={feld} />
            </label>
            <div>
              <Button type="submit" variante="danger" data-cse="ruecknahme-ausloesen">
                Rückgängig machen
              </Button>
            </div>
          </form>
        </section>
      ) : null}

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
