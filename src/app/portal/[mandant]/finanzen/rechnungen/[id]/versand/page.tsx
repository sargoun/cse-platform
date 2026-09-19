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
import { FORMAT_TEXT, WEG_TEXT } from '@/server/services/crm/erechnung';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { RECHNUNG_AUSGABE_TEXTE } from '@/lib/i18n/verwaltung/finanzen/rechnung-ausgabe';

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

/*
 * Kennungen, keine Woerter. Rechtename, Dateipfad und Spaltenname lauten in
 * beiden Sprachen gleich; sie stehen deshalb hier und nicht in der
 * Texttabelle, wo eine zweite Spalte nur eine Erfindung waere.
 */
const POLICY_DATEI = 'server/agent/policy.ts';
const ERECHNUNG_DIENST = 'services/crm/erechnung.ts';
const RECHT_HERUNTERLADEN = 'finanzen.herunterladen';
const RECHT_VERSAND_FREIGEBEN = 'versand.freigeben';
const SPALTE_NUTZLAST_HASH = 'nutzlast_sha256';

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

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(RECHNUNG_AUSGABE_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

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
      titel: t.xrechnungTitel,
      zweck: t.xrechnungZweck,
      seite: `/portal/${mandant}/finanzen/rechnungen/${id}/xrechnung`,
      datei: `/api/finanzen/rechnungen/${id}/xrechnung.xml`,
    },
    {
      schluessel: 'zugferd',
      titel: t.zugferdTitel,
      zweck: t.zugferdZweck,
      seite: `/portal/${mandant}/finanzen/rechnungen/${id}/zugferd`,
      datei: `/api/finanzen/rechnungen/${id}/zugferd.pdf`,
    },
  ] as const;

  return (
    <PortalRahmen
      titel={t.versand}
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {darf['finanzen.lesen'] === true ? (
        <nav aria-label={g.zurueck} className="mb-s3">
          <Link
            href={`/portal/${mandant}/finanzen/rechnungen/${id}`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            ← {k.nummer ?? t.entwurfOhneNummer}
          </Link>
        </nav>
      ) : null}

      <h1 className="mb-s3 text-h1 text-text">{t.versand}</h1>

      {!verbunden ? (
        <Hinweis art="warnung" cse="versand-nicht-verbunden" className="mb-s5">
          <p className="m-0 max-w-prose">
            <strong>{t.nichtVerbundenStrong}</strong>
            {t.nichtVerbundenText}
          </p>
        </Hinweis>
      ) : (
        <Hinweis art="hinweis" cse="versand-verbunden" className="mb-s5">
          <p className="m-0 max-w-prose">
            {t.verbundenVor}
            <code>{POLICY_DATEI}</code>
            {t.verbundenNach}
          </p>
        </Hinweis>
      )}

      <h2 className="mb-s3 text-h2 text-text">{t.wegeTitel}</h2>
      <DataTable
        beschriftung={t.tabelleWege}
        zeilen={daten.wege}
        schluessel={(w) => w.kanal}
        spalten={[
          { schluessel: 'kanal', kopf: t.kanal, zelle: (w) => w.text },
          {
            schluessel: 'zustand',
            kopf: g.zustand,
            zelle: (w) => (
              <span className="inline-flex flex-wrap items-center gap-s2">
                <StatusPill
                  zustand={w.verbunden ? 'Aktiv' : 'Inaktiv'}
                  sprache={zugang.sprache}
                />
                <span className="text-xs text-text-muted">
                  {w.verbunden ? t.verbunden : g.nichtVerbunden}
                </span>
              </span>
            ),
          },
          {
            schluessel: 'grund', kopf: t.warum,
            zelle: (w) => (
              <span className="max-w-prose text-xs text-text-muted">
                {w.grund ?? t.zugangsdatenHinterlegt}
              </span>
            ),
          },
        ]}
      />

      <p className="mb-s7 mt-s3 max-w-prose text-xs text-text-muted">
        {t.portalUndPost}
      </p>

      <h2 className="mb-s3 text-h2 text-text">{t.empfaengerTitel}</h2>
      {daten.empfaenger === null ? (
        <p className="mb-s7 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {t.keinLesbarerKunde}
        </p>
      ) : (
        <>
          <dl className="mb-s3 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-text-muted">{g.kunde}</dt>
              <dd className="text-sm text-text">{daten.empfaenger.kundeName}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.xrechnungVerlangt}</dt>
              <dd className="text-sm text-text">
                {daten.empfaenger.xrechnungPflicht
                 || daten.empfaenger.istOeffentlicherAuftraggeber
                  ? t.ja
                  : t.nein}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.leitwegId}</dt>
              <dd className="cse-zahl text-sm text-text">
                {daten.empfaenger.leitwegId ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.elektronischeAdresse}</dt>
              <dd className="cse-zahl text-sm text-text">
                {daten.empfaenger.elektronischeAdresse ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.verabredeterWeg}</dt>
              <dd className="text-sm text-text">
                {daten.empfaenger.uebertragungsweg === null
                  ? <span className="text-text-muted">{t.nichtVerabredet}</span>
                  : WEG_TEXT[daten.empfaenger.uebertragungsweg]}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.verabredetesFormat}</dt>
              <dd className="text-sm text-text">
                {daten.empfaenger.rechnungsformat === null
                  ? <span className="text-text-muted">{t.nichtVerabredet}</span>
                  : FORMAT_TEXT[daten.empfaenger.rechnungsformat]}
              </dd>
            </div>
          </dl>
          <div
            data-cse="versand-empfaengerlage"
            data-art={daten.empfaenger.lage.art}
            data-weg-offen={String(daten.empfaenger.wegOffen)}
            className={`mb-s3 rounded-lg border p-s5 text-sm ${
              daten.empfaenger.lage.art === 'gesperrt'
                ? 'border-danger bg-danger-soft text-danger'
                : daten.empfaenger.lage.art === 'bereit'
                  ? 'border-line bg-surface text-text'
                  : 'border-warning bg-warning-soft text-warning'}`}
          >
            <p className="m-0 flex flex-wrap items-center gap-s3">
              <StatusPill
                zustand={daten.empfaenger.lage.art === 'gesperrt'
                  ? 'Fehler'
                  : daten.empfaenger.lage.art === 'bereit'
                    ? 'Abgeschlossen'
                    : 'Wartet'}
                sprache={zugang.sprache}
              />
              <strong className="text-text">
                {t.lageNamen[daten.empfaenger.lage.art]}
              </strong>
            </p>
            <p className="m-0 mt-s3 max-w-prose">{daten.empfaenger.lage.text}</p>
            {daten.empfaenger.lage.fehlend.length === 0 ? null : (
              <ul className="m-0 mt-s3 list-none space-y-s2 p-0">
                {daten.empfaenger.lage.fehlend.map((f) => (
                  <li key={`${f.bt}-${f.feld}`} className="max-w-prose">
                    <span className="text-xs text-text-muted">
                      {f.bt} · {f.regel}
                    </span>
                    <span className="ml-s2 text-sm text-text">{f.feld}</span>
                    <span className="mt-s1 block text-xs">{f.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="m-0 mt-s3 max-w-prose text-xs text-text-muted">
              {t.bewertetVonVor}
              <code>{ERECHNUNG_DIENST}</code>
              {t.bewertetVonMitte}
              <strong>{t.blockiert}</strong>
              {t.bewertetVonNach}
            </p>
          </div>
        </>
      )}

      <h2 className="mb-s3 text-h2 text-text">{t.erzeugnisseTitel}</h2>
      {!festgeschrieben || !k.hat_snapshot ? (
        <Hinweis art="hinweis" cse="versand-kein-snapshot" className="mb-s7">
          <p className="m-0 max-w-prose">
            {k.status === 'entwurf'
              ? t.entwurfKeinDokument
              : k.status === 'verworfen'
                ? t.verworfenKeinDokument
                : t.keinSnapshot}
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
                  {t.pruefstand}: {stand.text}
                  {stand.regelwerk === null
                    ? ''
                    : ` ${t.regelwerk}: ${stand.regelwerk}.`}
                </p>
                <p className="m-0 mt-s3 flex flex-wrap items-center gap-s3">
                  <Link
                    href={e.seite}
                    className="text-sm text-text underline underline-offset-2 hover:text-brand"
                  >
                    {t.vorschauUndPruefstand}
                  </Link>
                  {darf['finanzen.herunterladen'] === true ? (
                    <a
                      href={e.datei}
                      className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong px-s4 text-sm text-text hover:bg-surface-2"
                      data-cse="versand-herunterladen"
                    >
                      {t.dateiHerunterladen}
                    </a>
                  ) : (
                    <span className="text-xs text-text-muted">
                      {t.diesemKontoFehlt}
                      <strong>{RECHT_HERUNTERLADEN}</strong>
                      {t.dateiBleibtZu}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
          <p className="mb-s7 max-w-prose text-xs text-text-muted">
            {t.pdfPostweg}
          </p>
        </>
      )}

      <h2 className="mb-s3 text-h2 text-text">{t.protokollTitel}</h2>
      {daten.protokoll.length === 0 ? (
        <Hinweis art="hinweis" cse="versand-protokoll-leer">
          <p className="m-0 max-w-prose">
            {t.keinVersandProtokolliert}
          </p>
        </Hinweis>
      ) : (
        <DataTable
          beschriftung={t.tabelleProtokoll}
          zeilen={daten.protokoll}
          schluessel={(v) => v.id}
          spalten={[
            {
              schluessel: 'kanal',
              kopf: t.kanalUndErzeugnis,
              zelle: (v) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-text">{v.kanalText}</span>
                  <span className="text-xs text-text-muted">{v.artefaktText}</span>
                </span>
              ),
            },
            {
              schluessel: 'empfaenger',
              kopf: t.empfaengerEingefroren,
              zelle: (v) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-text">{v.empfaenger}</span>
                  {v.empfaengerName === null ? null : (
                    <span className="text-xs text-text-muted">{v.empfaengerName}</span>
                  )}
                  {v.leitwegId === null ? null : (
                    <span className="cse-zahl text-xs text-text-muted">
                      {t.leitweg} {v.leitwegId}
                    </span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'freigabe',
              kopf: t.freigegeben,
              zelle: (v) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-text">{v.freigegebenAm}</span>
                  <span className="text-xs text-text-muted">
                    {v.freigegebenVon ?? t.kontoOhneNamen}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'zustand',
              kopf: g.zustand,
              zelle: (v) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    <StatusPill zustand={STATUS_PILLE[v.status]} sprache={zugang.sprache} />
                    <span className="text-xs text-text-muted">
                      {t.statusTexte[v.status]}
                    </span>
                  </span>
                  {v.gesendetAm === null ? null : (
                    <span className="text-xs text-text-muted">
                      {t.gesendet} {v.gesendetAm}
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
              kopf: t.zugangTitel,
              zelle: (v) => (v.zugangAm === null ? (
                <span className="text-xs text-text-muted">
                  {t.zugangNichtFestgestellt}
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
              kopf: t.welcheFassung,
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
          {t.diesemKontoFehlt}
          <strong>{RECHT_VERSAND_FREIGEBEN}</strong>
          {t.versandFreigebenFehltNach}
        </p>
      ) : null}

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        {t.versandstandFussVor}
        <code>{SPALTE_NUTZLAST_HASH}</code>
        {t.versandstandFussNach}
      </p>
    </PortalRahmen>
  );
}
