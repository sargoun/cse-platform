import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { pruefstand } from '@/server/services/finanz/xrechnung/pruefstand';
import {
  empfaengerlage, irgendeinWegVerbunden, versandprotokoll, versandwege,
  type Empfaengerlage, type VersandStatus, type VersandZeile, type Versandweg,
} from '@/server/services/finanz/versand';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/finanzen/rechnungen/[id]/versand` — das Versandprotokoll
 * (04-SEITENKARTE.md §5.14.1, FIN-11, FIN-12, Invariante 7, K-12, SOC-07).
 *
 * **Es gibt keinen Sendeknopf, und das ist keine halbe Seite.** Kein
 * EU-gehosteter Transaktionsmailer mit Auftragsverarbeitungsvertrag ist
 * entschieden (O-36), und kein Peppol-Zugangspunkt ist eingerichtet (O-22).
 * Die Seite schreibt „Versand nicht verbunden" — und die Datei bleibt
 * herunterladbar, damit ein Mensch sie von Hand versendet. Ein simulierter
 * Erfolg wäre die Auskunft, eine Rechnung sei draussen, die es nicht ist;
 * entdeckt würde das, wenn der Mahnlauf schon gelaufen ist.
 *
 * **Derselbe Schlüssel entscheidet zweimal.** `versand.<kanal>.verbunden`
 * steuert diese Seite UND den Auslöser
 * `rechnung_versand_2_kanal_verbunden` (0181): die Oberfläche kann den Knopf
 * nicht anbieten, den die Datenbank abweist, und die Datenbank fällt nicht auf
 * eine Oberfläche herein, die es doch versucht.
 *
 * **Der Versandstand ist ein KIND, keine Spalte** (K-12): an einem
 * festgeschriebenen Beleg ändert sich nichts, am Versand dauernd. Deshalb
 * `rechnung_versand` und nicht `rechnung.versendet_am`.
 *
 * **Jeder Eintrag nennt seinen `nutzlast_sha256`.** Er belegt, WELCHE Fassung
 * hinausging — und weil das PDF aus dem Snapshot mit dem
 * Festschreibungszeitpunkt gerendert wird, ergibt derselbe Beleg bei jedem
 * Abruf byte-gleich dieselbe Datei. Der Hash ist damit nachprüfbar und nicht
 * nur protokolliert.
 *
 * **§286 BGB rechnet ab ZUGANG.** Die Spalte steht da, und wo sie leer ist,
 * heisst das „nicht festgestellt" — kein Mahnlauf darf ihn unterstellen.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Versand — Rechnung' };

const STATUS_PILLE: Readonly<Record<VersandStatus, PillZustand>> = {
  freigegeben: 'Wartet',
  gesendet: 'Abgeschlossen',
  fehlgeschlagen: 'Fehler',
  nicht_verbunden: 'Inaktiv',
};

const STATUS_TEXT: Readonly<Record<VersandStatus, string>> = {
  freigegeben: 'freigegeben — noch nicht gesendet',
  gesendet: 'gesendet',
  fehlgeschlagen: 'fehlgeschlagen',
  nicht_verbunden: 'nicht verbunden — es wurde nichts gesendet',
};

interface Kopf {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly rechnungsdatum: string | null;
  readonly hat_snapshot: boolean;
}

export default async function Versandblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const tor = await mandantTor(
    `/portal/${mandant}/finanzen/rechnungen/${id}/versand`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /*
   * Diese Seite öffnet mit `versand.lesen`. Der Beleg daneben verlangt
   * `finanzen.lesen`, die DATEIEN `finanzen.herunterladen`, und der
   * Sendeweg — wenn es ihn einmal gibt — `versand.freigeben`. Vier Rechte,
   * ein Bildschirm; ohne das jeweilige steht hier Text statt eines Verweises
   * (AUT-06, D-581).
   */
  const darf = await haeltRechte(
    sitzung, 'finanzen.lesen', 'finanzen.herunterladen', 'versand.freigeben');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select r.id, r.nummer, r.status::text as status,
                to_char(r.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                exists (select 1 from rechnung_snapshot s
                         where s.mandant_id = r.mandant_id and s.rechnung_id = r.id)
                  as hat_snapshot
           from rechnung r where r.id = $1`, [id]);
      if (kopf === undefined) {
        return { kopf: null, protokoll: [], wege: [], empfaenger: null };
      }
      return {
        kopf,
        protokoll: await versandprotokoll(kontext, id),
        wege: await versandwege(kontext),
        empfaenger: await empfaengerlage(kontext, id),
      };
    })) as Promise<{
      kopf: Kopf | null;
      protokoll: readonly VersandZeile[];
      wege: readonly Versandweg[];
      empfaenger: Empfaengerlage | null;
    }>);

  const k = daten.kopf;
  if (k === null) notFound();

  const festgeschrieben = k.status === 'festgeschrieben';
  const verbunden = irgendeinWegVerbunden(daten.wege);
  const stand = pruefstand();

  /*
   * Die drei Erzeugnisse. Ihr Zustand ist kein Prüfergebnis: ob das Dokument
   * überhaupt entsteht, entscheidet der Snapshot (K-12) und die
   * Pflichtfeldprüfung — und wie es geprüft wurde, sagt der Prüfstand, mit
   * genau drei erlaubten Worten (§5.14.3).
   */
  const erzeugnisse = [
    {
      schluessel: 'xrechnung',
      titel: 'XRechnung (UBL, EN 16931)',
      zweck: 'für öffentliche Auftraggeber',
      seite: `/portal/${mandant}/finanzen/rechnungen/${id}/xrechnung`,
      datei: `/api/finanzen/rechnungen/${id}/xrechnung.xml`,
    },
    {
      schluessel: 'zugferd',
      titel: 'ZUGFeRD (PDF/A-3 mit CII)',
      zweck: 'für gewerbliche Kunden, die eine PDF erwarten',
      seite: `/portal/${mandant}/finanzen/rechnungen/${id}/zugferd`,
      datei: `/api/finanzen/rechnungen/${id}/zugferd.pdf`,
    },
  ] as const;

  return (
    <PortalRahmen
      titel="Versand"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {darf['finanzen.lesen'] === true ? (
        <nav aria-label="Zurück" className="mb-s3">
          <Link
            href={`/portal/${mandant}/finanzen/rechnungen/${id}`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            ← {k.nummer ?? 'Entwurf ohne Nummer'}
          </Link>
        </nav>
      ) : null}

      <h1 className="mb-s3 text-h1 text-text">Versand</h1>

      {!verbunden ? (
        <Hinweis art="warnung" cse="versand-nicht-verbunden" className="mb-s5">
          <p className="m-0 max-w-prose">
            <strong>Versand nicht verbunden (O-36) — die Datei lässt sich
            herunterladen und von Hand versenden.</strong> Es ist nicht
            entschieden, welcher EU-gehostete Transaktionsmailer unter welchem
            Auftragsverarbeitungsvertrag ausliefert, und kein
            Peppol-Zugangspunkt ist eingerichtet (O-22). Es gibt deshalb keinen
            Sendeknopf — und keinen vorgetäuschten Erfolg: ein Protokolleintrag
            „gesendet" ohne Versand ist die Auskunft, dass eine Rechnung draussen
            sei, die es nicht ist.
          </p>
        </Hinweis>
      ) : (
        <Hinweis art="hinweis" cse="versand-verbunden" className="mb-s5">
          <p className="m-0 max-w-prose">
            Mindestens ein Kanal ist verbunden. Gesendet wird trotzdem nur nach
            menschlicher Zustimmung: es entsteht eine Freigabe, und erst sie
            erlaubt den Versand (Invariante 7,{' '}
            <code>server/agent/policy.ts</code>). Automatisch verlässt nichts
            das Haus.
          </p>
        </Hinweis>
      )}

      <h2 className="mb-s3 text-h2 text-text">Die Wege und ihr Zustand</h2>
      <DataTable
        beschriftung="Übertragungswege und ob sie verbunden sind"
        zeilen={daten.wege}
        schluessel={(w) => w.kanal}
        spalten={[
          { schluessel: 'kanal', kopf: 'Kanal', zelle: (w) => w.text },
          {
            schluessel: 'zustand',
            kopf: 'Zustand',
            zelle: (w) => (
              <span className="inline-flex flex-wrap items-center gap-s2">
                <StatusPill zustand={w.verbunden ? 'Aktiv' : 'Inaktiv'} />
                <span className="text-xs text-text-muted">
                  {w.verbunden ? 'verbunden' : 'nicht verbunden'}
                </span>
              </span>
            ),
          },
          {
            schluessel: 'grund', kopf: 'Warum',
            zelle: (w) => (
              <span className="max-w-prose text-xs text-text-muted">
                {w.grund ?? 'Zugangsdaten hinterlegt.'}
              </span>
            ),
          },
        ]}
      />

      <p className="mb-s7 mt-s3 max-w-prose text-xs text-text-muted">
        Kundenportal und Post stehen nicht in dieser Liste: das Portal zeigt das
        Dokument, und Papier kuvertiert ein Mensch. Beides ist kein
        elektronischer Versand durch die Plattform und braucht keine Verbindung.
      </p>

      <h2 className="mb-s3 text-h2 text-text">Was der Empfänger erwartet</h2>
      {daten.empfaenger === null ? (
        <p className="mb-s7 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Diese Rechnung hat keinen lesbaren Kunden.
        </p>
      ) : (
        <>
          <dl className="mb-s3 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-text-muted">Kunde</dt>
              <dd className="text-sm text-text">{daten.empfaenger.kundeName}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">XRechnung verlangt</dt>
              <dd className="text-sm text-text">
                {daten.empfaenger.xrechnungPflicht
                 || daten.empfaenger.istOeffentlicherAuftraggeber
                  ? 'ja'
                  : 'nein'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Leitweg-ID (BT-10)</dt>
              <dd className="cse-zahl text-sm text-text">
                {daten.empfaenger.leitwegId ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Elektronische Adresse</dt>
              <dd className="cse-zahl text-sm text-text">
                {daten.empfaenger.elektronischeAdresse ?? '—'}
              </dd>
            </div>
          </dl>
          {daten.empfaenger.wegOffen ? (
            <Hinweis art="warnung" cse="versand-weg-offen" className="mb-s7">
              <p className="m-0 max-w-prose">
                Für diesen Käufer ist <strong>kein Übertragungsweg
                hinterlegt</strong>. Die Spalte{' '}
                <code>kunde.uebertragungsweg</code> gehört dem CRM-Datenmodell
                und gibt es in der Datenbank noch nicht. Ein Käufer mit
                XRechnungspflicht und ohne hinterlegten Weg{' '}
                <strong>blockiert</strong> den Versand, statt auf einen Kanal
                zurückzufallen — so hält es 07-INTEGRATIONEN §12.1
                ausdrücklich fest, und so wird es hier auch nicht umgangen.
              </p>
            </Hinweis>
          ) : null}
        </>
      )}

      <h2 className="mb-s3 text-h2 text-text">Die Erzeugnisse</h2>
      {!festgeschrieben || !k.hat_snapshot ? (
        <Hinweis art="hinweis" cse="versand-kein-snapshot" className="mb-s7">
          <p className="m-0 max-w-prose">
            {k.status === 'entwurf'
              ? 'Dieser Beleg ist ein Entwurf. XRechnung und ZUGFeRD entstehen erst '
                + 'bei der Festschreibung, weil sie die Nummer und den Zeitpunkt '
                + 'tragen — und weil sie aus dem Snapshot gerendert werden, nie aus '
                + 'den heutigen Stammdaten (K-12).'
              : k.status === 'verworfen'
                ? 'Dieser Entwurf ist verworfen. Es gibt kein Dokument zu versenden.'
                : 'Zu diesem Beleg gibt es keinen Snapshot. Ohne ihn entstünde das '
                  + 'Dokument aus den heutigen Stammdaten — also ein zweites Dokument '
                  + 'zu derselben Nummer (K-12). Das ist ein Prüfauftrag.'}
          </p>
        </Hinweis>
      ) : (
        <>
          <ul className="mb-s3 m-0 list-none space-y-s3 p-0">
            {erzeugnisse.map((e) => (
              <li
                key={e.schluessel}
                className="rounded-lg border border-line bg-surface p-s5"
                data-cse="versand-erzeugnis"
                data-art={e.schluessel}
              >
                <p className="m-0 flex flex-wrap items-baseline gap-s3">
                  <span className="text-sm font-semibold text-text">{e.titel}</span>
                  <span className="text-xs text-text-muted">{e.zweck}</span>
                </p>
                <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">
                  Prüfstand: {stand.text}
                  {stand.regelwerk === null ? '' : ` Regelwerk: ${stand.regelwerk}.`}
                </p>
                <p className="m-0 mt-s3 flex flex-wrap items-center gap-s3">
                  <Link
                    href={e.seite}
                    className="text-sm text-text underline underline-offset-2 hover:text-brand"
                  >
                    Vorschau und Prüfstand →
                  </Link>
                  {darf['finanzen.herunterladen'] === true ? (
                    <a
                      href={e.datei}
                      className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong px-s4 text-sm text-text hover:bg-surface-2"
                      data-cse="versand-herunterladen"
                    >
                      Datei herunterladen
                    </a>
                  ) : (
                    <span className="text-xs text-text-muted">
                      Diesem Konto fehlt <strong>finanzen.herunterladen</strong> —
                      die Datei bleibt zu.
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
          <p className="mb-s7 max-w-prose text-xs text-text-muted">
            Ein PDF für den Postweg ist dasselbe ZUGFeRD-Dokument: es ist ein
            gültiges PDF/A-3 und lässt sich drucken. Ein zweiter PDF-Erzeuger
            daneben wäre eine zweite Fassung derselben Rechnung.
          </p>
        </>
      )}

      <h2 className="mb-s3 text-h2 text-text">Das Protokoll</h2>
      {daten.protokoll.length === 0 ? (
        <Hinweis art="hinweis" cse="versand-protokoll-leer">
          <p className="m-0 max-w-prose">
            Kein Versand protokolliert. Das heisst: diese Rechnung ist über die
            Plattform nicht hinausgegangen — nicht, dass der Kunde sie nicht
            hat. Wurde sie von Hand versendet, steht das hier nicht, und dieser
            Unterschied ist wichtig: §286 BGB rechnet ab ZUGANG, und einen
            Zugang, den niemand festgestellt hat, darf kein Mahnlauf
            unterstellen.
          </p>
        </Hinweis>
      ) : (
        <DataTable
          beschriftung="Freigegebene Versandvorgänge dieser Rechnung"
          zeilen={daten.protokoll}
          schluessel={(v) => v.id}
          spalten={[
            {
              schluessel: 'kanal',
              kopf: 'Kanal und Erzeugnis',
              zelle: (v) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-text">{v.kanalText}</span>
                  <span className="text-xs text-text-muted">{v.artefaktText}</span>
                </span>
              ),
            },
            {
              schluessel: 'empfaenger',
              kopf: 'Empfänger (eingefroren)',
              zelle: (v) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-text">{v.empfaenger}</span>
                  {v.empfaengerName === null ? null : (
                    <span className="text-xs text-text-muted">{v.empfaengerName}</span>
                  )}
                  {v.leitwegId === null ? null : (
                    <span className="cse-zahl text-xs text-text-muted">
                      Leitweg {v.leitwegId}
                    </span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'freigabe',
              kopf: 'Freigegeben',
              zelle: (v) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-text">{v.freigegebenAm}</span>
                  <span className="text-xs text-text-muted">
                    {v.freigegebenVon ?? 'Konto ohne Namen'}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'zustand',
              kopf: 'Zustand',
              zelle: (v) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    <StatusPill zustand={STATUS_PILLE[v.status]} />
                    <span className="text-xs text-text-muted">
                      {STATUS_TEXT[v.status]}
                    </span>
                  </span>
                  {v.gesendetAm === null ? null : (
                    <span className="text-xs text-text-muted">
                      gesendet {v.gesendetAm}
                    </span>
                  )}
                  {v.fehlertext === null ? null : (
                    <span className="max-w-prose text-xs text-warning">
                      {v.fehlertext}
                    </span>
                  )}
                  {v.externeId === null ? null : (
                    <span className="font-mono text-xs text-text-muted">
                      {v.externeId}
                    </span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'zugang',
              kopf: 'Zugang (§286 BGB)',
              zelle: (v) => (v.zugangAm === null ? (
                <span className="text-xs text-text-muted">
                  nicht festgestellt — kein Verzugsbeginn
                </span>
              ) : (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-text">{v.zugangAm}</span>
                  <span className="max-w-prose text-xs text-text-muted">
                    {v.zugangGrundlage}
                  </span>
                </span>
              )),
            },
            {
              schluessel: 'hash',
              kopf: 'Welche Fassung',
              zelle: (v) => (
                <span
                  className="break-all font-mono text-xs text-text-muted"
                  data-cse="versand-nutzlast-hash"
                >
                  {v.nutzlastSha256.slice(0, 16)}…
                </span>
              ),
            },
          ]}
        />
      )}

      {festgeschrieben && verbunden && darf['versand.freigeben'] !== true ? (
        <p className="mt-s5 max-w-prose text-sm text-text-muted">
          Diesem Konto fehlt <strong>versand.freigeben</strong>. Es sieht das
          Protokoll, gibt aber keinen Versand frei — und ein Knopf, der in ein
          403 führt, verrät nur, was er nicht zeigt.
        </p>
      ) : null}

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        Der Versandstand ist ein Kind der Rechnung und keine Spalte darauf
        (K-12): an einem festgeschriebenen Beleg ändert sich nichts, am Versand
        dauernd. <code>nutzlast_sha256</code> belegt, welche Fassung hinausging
        — weil das Dokument aus dem Snapshot mit dem Festschreibungszeitpunkt
        gerendert wird, ergibt derselbe Beleg bei jedem Abruf byte-gleich
        dieselbe Datei (Invariante 5, K-11), und der Hash ist damit nachprüfbar.
      </p>
    </PortalRahmen>
  );
}
