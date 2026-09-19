import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld, NULL_CENT } from '@/server/services/finanz/geld';
import {
  abzugLage, giltAm, type AbzugLage, type Bescheinigung,
} from '@/server/services/finanz/estg48/abzug';
import {
  BAGATELLGRENZE_PLATZHALTER, STICHTAG_QUELLE,
} from '@/server/services/finanz/estg48/grenzen.platzhalter';
import { HINWEIS_13B } from '@/server/services/finanz/steuer/nachweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { EINGANGSRECHNUNGEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/eingangsrechnungen';

/**
 * `/portal/[mandant]/finanzen/eingangsrechnungen/[id]/steuer` — die
 * steuerliche Lage EINER Eingangsrechnung (04-SEITENKARTE.md §5.14, FIN-10,
 * LEG-06, §13b UStG, §48 EStG).
 *
 * **Geprüft wird gegen das LEISTUNGSDATUM, nicht gegen `now()`.**
 * `STICHTAG_QUELLE` steht auf `leistung_bis`, und die Seite schreibt hin,
 * GEGEN WELCHES Datum sie entschieden hat. Der Gesetzeswortlaut des §48
 * knüpft an die Zahlung an, SPEC FIN-10 an das Leistungsdatum — welches gilt,
 * ist offen (O-176). Eine Seite, die das Datum verschweigt, lässt niemanden
 * nachprüfen, warum einbehalten wurde.
 *
 * **§48 EStG hat DREI Ausgänge, und alle drei stehen hier.**
 * (1) gültige Freistellungsbescheinigung am Stichtag, (2) Jahressumme unter
 * der Bagatellgrenze, (3) Einbehalt. Der mittlere braucht
 * `bauleistung_jahressumme` — sie ist seit 0182 da, und die Summe steht
 * darunter. Er wird heute NIE erreicht, weil
 * `BAGATELLGRENZE_PLATZHALTER.grenzeCent` `null` ist: ohne Grenze wird immer
 * einbehalten, und das ist die haftungsfreie Richtung (§48a Abs. 3 EStG). Die
 * Seite sagt das wörtlich statt eine Zahl zu nennen (O-21).
 *
 * **Diese Seite pflegt nichts — und das ist ein Befund, keine Auslassung.**
 * Der Plan sah Hochladen, Gültigkeit und Widerruf hier vor. Dafür gibt es
 * heute keinen Weg: das Routenregister führt für diese Route
 * `schreiben: []`, und die Policy auf `freistellungsbescheinigung` verlangt
 * zum Schreiben `finanzen.schreiben` — während die Route mit
 * `abrechnung.freistellung_pflegen` öffnet und das Lesen der Rechnung
 * `eingang.lesen` verlangt. Drei verschiedene Schlüssel für einen Bildschirm.
 * Welcher gelten soll, ist eine Entscheidung am Rechtemodell und keine, die
 * eine Seite trifft (O-604). Bis dahin zeigt sie die Bescheinigungen und
 * verlinkt dorthin, wo sie gepflegt werden.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Steuerliche Lage — Eingangsrechnung' };

/*
 * Kennungen, keine Woerter. Rechte-, Tabellen-, Spalten-, Einstellungs- und
 * Dateinamen lauten in beiden Sprachen gleich; sie stehen deshalb hier und
 * nicht in der Texttabelle, wo eine zweite Spalte nur eine Erfindung waere.
 */
const RECHT_EINGANG_LESEN = 'eingang.lesen';
const RECHT_FREISTELLUNG_PFLEGEN = 'abrechnung.freistellung_pflegen';
const RECHT_FINANZEN_LESEN = 'finanzen.lesen';
const RECHT_FINANZEN_SCHREIBEN = 'finanzen.schreiben';
const TABELLE_FREISTELLUNG = 'freistellungsbescheinigung';
const TABELLE_MANDANT = 'mandant';
const SPALTE_KUNDE_STATUS = 'kunde_bauleistender_status';
const EINSTELLUNG_SATZ = 'finanzen.bauabzugsteuer_satz_bp';
const DIENST_ABZUG = 'services/finanz/estg48/abzug.ts';

interface Kopf {
  readonly id: string;
  readonly status: string;
  readonly interne_belegnummer: string | null;
  readonly rechnungsnummer_lieferant: string | null;
  readonly lieferant: string | null;
  readonly lieferant_id: string | null;
  readonly lieferant_ust_id: string | null;
  readonly lieferant_leistungsart: string | null;
  readonly lieferant_bauleistender_bis: string | null;
  readonly rechnungsdatum: string | null;
  readonly leistungsdatum: string | null;
  readonly leistung_von: string | null;
  readonly leistung_bis: string | null;
  readonly netto_cent: string | null;
  readonly brutto_cent: string | null;
  readonly reverse_charge: boolean;
  readonly reverse_charge_grundlage: string | null;
  readonly bauabzugsteuer_pflichtig: boolean;
  readonly bauabzugsteuer_satz_bp: number | null;
  readonly bauabzugsteuer_cent: string | null;
  readonly freistellungsbescheinigung_id: string | null;
  readonly freistellung_geprueft_am: string | null;
  readonly auftrag_id: string | null;
  /** Der Stichtag als ISO-Tag — die Grundlage jeder Entscheidung hier. */
  readonly stichtag: string | null;
}

interface BescheinigungZeile extends Bescheinigung {
  readonly finanzamt: string;
  readonly dokumentId: string | null;
}

interface Jahressumme {
  readonly jahr: number;
  readonly gegenleistungCent: string;
  readonly prognoseCent: string | null;
  readonly prognoseGrundlage: string | null;
  readonly letzteAktualisierung: string;
}

export default async function Steuerblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const tor = await mandantTor(
    `/portal/${mandant}/finanzen/eingangsrechnungen/${id}/steuer`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /*
   * Drei Rechte entscheiden hier wirklich, und die Route öffnet mit einem
   * vierten. Die Seite fragt sie alle, damit sie sagen kann, WELCHES fehlt,
   * statt einen leeren Bildschirm zu zeigen.
   */
  const darf = await haeltRechte(
    sitzung, 'eingang.lesen', 'finanzen.lesen', 'finanzen.schreiben');

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(EINGANGSRECHNUNGEN_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select er.id, er.status::text as status, er.interne_belegnummer,
                er.rechnungsnummer_lieferant,
                l.name as lieferant, er.lieferant_id::text as lieferant_id,
                l.ust_id as lieferant_ust_id,
                l.leistungsart::text as lieferant_leistungsart,
                to_char(l.ist_bauleistender_bis, 'DD.MM.YYYY')
                  as lieferant_bauleistender_bis,
                to_char(er.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                to_char(er.leistungsdatum, 'DD.MM.YYYY') as leistungsdatum,
                to_char(er.leistung_von, 'YYYY-MM-DD') as leistung_von,
                to_char(er.leistung_bis, 'YYYY-MM-DD') as leistung_bis,
                er.netto_cent::text, er.brutto_cent::text,
                er.reverse_charge,
                er.reverse_charge_grundlage::text as reverse_charge_grundlage,
                er.bauabzugsteuer_pflichtig, er.bauabzugsteuer_satz_bp,
                er.bauabzugsteuer_cent::text,
                er.freistellungsbescheinigung_id::text as freistellungsbescheinigung_id,
                to_char(er.freistellung_geprueft_am, 'DD.MM.YYYY')
                  as freistellung_geprueft_am,
                er.auftrag_id::text as auftrag_id,
                /*
                 * Der Stichtag, ausgeschrieben und nicht in der Seite
                 * gerechnet: leistung_bis, sonst leistungsdatum, sonst
                 * rechnungsdatum. Die Reihenfolge ist die von
                 * STICHTAG_QUELLE — und sie steht in der Abfrage, damit die
                 * Seite denselben Tag ANZEIGT, gegen den entschieden wurde.
                 */
                to_char(coalesce(er.leistung_bis, er.leistungsdatum,
                                 er.rechnungsdatum), 'YYYY-MM-DD') as stichtag
           from eingangsrechnung er
           left join lieferant l
             on l.mandant_id = er.mandant_id and l.id = er.lieferant_id
          where er.id = $1`, [id]);
      if (kopf === undefined) {
        return { kopf: null, bescheinigungen: [], jahressumme: null, satzBp: null };
      }

      /*
       * **Der Satz kommt aus der datierten Plattformeinstellung — nicht aus
       * einer Zahl in dieser Datei.**
       *
       * Vorher stand hier `k.bauabzugsteuer_satz_bp ?? 1500`. Die Spalte hat
       * keinen Default; auf jeder Eingangsrechnung ohne gespeicherten Satz
       * rechnete die Seite damit 15 % aus dem Nichts — eine Geldzahl, die in
       * einer Komponente entsteht (Invariante 6).
       *
       * 0118 legt den Satz ausdrücklich als Einstellung und nicht als
       * Konstante ab, und `estg48/abzug.ts` schreibt den Grund hin: Sätze sind
       * schon bewegt worden, und eine einkompilierte Zahl bewertete am Tag
       * einer Änderung jede historische Rechnung neu. `services/finanz/
       * steuerfall.ts` liest sie genauso.
       *
       * Gelesen wird in DERSELBEN `withTenant`-Transaktion wie der Beleg —
       * ein zweiter Verbindungsaufbau könnte einen anderen Stand sehen.
       */
      const [satz] = await kontext.abfrage<{ bp: number | null }>(
        `select (app.plattform_einstellung('finanzen.bauabzugsteuer_satz_bp')
                 #>> '{}')::int as bp`);

      const bescheinigungen = kopf.lieferant_id === null ? [] : await kontext.abfrage<{
        id: string; nummer: string; finanzamt: string;
        gueltig_von: string; gueltig_bis: string; widerrufen_am: string | null;
        umfang: 'unbeschraenkt' | 'auftragsbezogen'; auftrag_id: string | null;
        dokument_id: string | null;
      }>(
        `select f.id::text as id, f.bescheinigung_nummer as nummer, f.finanzamt,
                to_char(f.gueltig_von, 'YYYY-MM-DD') as gueltig_von,
                to_char(f.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis,
                to_char(f.widerrufen_am, 'YYYY-MM-DD') as widerrufen_am,
                f.umfang::text as umfang, f.auftrag_id::text as auftrag_id,
                f.dokument_id::text as dokument_id
           from freistellungsbescheinigung f
          where f.lieferant_id = $1
          order by f.gueltig_bis desc`, [kopf.lieferant_id]);

      const [summe] = kopf.lieferant_id === null || kopf.stichtag === null
        ? []
        : await kontext.abfrage<{
          jahr: number; gegenleistung_cent: string; prognose_cent: string | null;
          prognose_grundlage: string | null; letzte_aktualisierung: string;
        }>(
          `select j.jahr, j.gegenleistung_cent::text, j.prognose_cent::text,
                  j.prognose_grundlage,
                  to_char(j.letzte_aktualisierung at time zone 'Europe/Berlin',
                          'DD.MM.YYYY HH24:MI') as letzte_aktualisierung
             from bauleistung_jahressumme j
            where j.lieferant_id = $1 and j.jahr = $2::int`,
          [kopf.lieferant_id, Number(kopf.stichtag.slice(0, 4))]);

      return {
        kopf,
        bescheinigungen: bescheinigungen.map((b): BescheinigungZeile => ({
          id: b.id,
          nummer: b.nummer,
          finanzamt: b.finanzamt,
          gueltigVon: b.gueltig_von,
          gueltigBis: b.gueltig_bis,
          widerrufenAm: b.widerrufen_am,
          umfang: b.umfang,
          auftragId: b.auftrag_id,
          dokumentId: b.dokument_id,
        })),
        jahressumme: summe === undefined ? null : {
          jahr: summe.jahr,
          gegenleistungCent: summe.gegenleistung_cent,
          prognoseCent: summe.prognose_cent,
          prognoseGrundlage: summe.prognose_grundlage,
          letzteAktualisierung: summe.letzte_aktualisierung,
        } satisfies Jahressumme,
        satzBp: satz?.bp ?? null,
      };
    })) as Promise<{
      kopf: Kopf | null;
      bescheinigungen: readonly BescheinigungZeile[];
      jahressumme: Jahressumme | null;
      satzBp: number | null;
    }>);

  const k = daten.kopf;
  if (k === null) {
    if (darf['eingang.lesen'] !== true) {
      return (
        <PortalRahmen
          titel={t.steuerlicheLage}
          bereich={mandant as BereichSchluessel}
          nurLesen
          leiste={zugang.leiste}
          wurzel={`/portal/${mandant}`}
          aktiverTab="eingangsrechnungen"
          sichtbareTabs={zugang.sichtbareTabs}
          navigationsRechte={zugang.navigationsRechte}
        >
          <h1 className="mb-s3 text-h1 text-text">{t.steuerlicheLage}</h1>
          <Hinweis art="warnung" cse="steuer-kein-leserecht">
            <p className="m-0 max-w-prose">
              {t.diesemKontoFehlt} <strong>{RECHT_EINGANG_LESEN}</strong>
              {t.keinLeserechtSteuerMitte}{' '}
              <strong>{RECHT_FREISTELLUNG_PFLEGEN}</strong>
              {t.keinLeserechtSteuerNach}
            </p>
          </Hinweis>
        </PortalRahmen>
      );
    }
    notFound();
  }

  /*
   * §48 EStG — die Entscheidung kommt aus dem DIENST und nicht aus dieser
   * Seite (Invariante 6). Der Stichtag ist der, den die Abfrage
   * ausgeschrieben hat; fehlt er ganz, gibt es keine Grundlage und die Lage
   * bleibt `null`.
   *
   * **Der Satz: erst der auf dem BELEG gespeicherte, sonst die datierte
   * Einstellung — und sonst nichts.** Fehlt beides, wird nicht 15 %
   * angenommen; der Bildschirm sagt „kein Satz hinterlegt" und rechnet nicht.
   */
  const satzBp: number | null = k.bauabzugsteuer_satz_bp ?? daten.satzBp;

  /*
   * **Ohne `finanzen.lesen` wird hier KEIN Ausgang bestimmt.**
   *
   * Die Policy `t_mandant` auf `freistellungsbescheinigung` verlangt
   * `finanzen.lesen`; diese Route öffnet mit `abrechnung.freistellung_pflegen`.
   * Ein Konto mit `abrechnung.freistellung_pflegen` und `eingang.lesen`, aber
   * ohne `finanzen.lesen`, sieht `daten.bescheinigungen` deshalb LEER — nicht
   * weil keine Bescheinigung vorliegt, sondern weil RLS sie entfernt hat.
   *
   * `abzugLage()` daraufhin laufen zu lassen ergäbe „Ausgang 3 — es wird
   * einbehalten" samt gerechnetem Betrag, während eine am Stichtag gültige
   * §48b-Bescheinigung im Bestand liegt. Ein Ausgang, der aus einer durch RLS
   * geleerten Liste entsteht, ist kein Ausgang — er ist eine falsche Auskunft
   * mit dem Ton einer richtigen. Deshalb ein VIERTER, benannter Zustand und
   * kein Aufruf (O-604).
   */
  const bescheinigungenSichtbar = darf['finanzen.lesen'] === true;

  const lage: AbzugLage | null = !bescheinigungenSichtbar || satzBp === null
    || k.stichtag === null || k.brutto_cent === null
    ? null
    : abzugLage({
      gegenleistungCent: cent(BigInt(k.brutto_cent)),
      istBauleistung: k.bauabzugsteuer_pflichtig,
      satzBp,
      stichtag: k.stichtag,
      leistungVon: k.leistung_von,
      leistungBis: k.leistung_bis,
      auftragId: k.auftrag_id,
      bescheinigungen: daten.bescheinigungen,
    });

  /*
   * Der MITTLERE Ausgang. Er wird nur erreicht, wenn eine Grenze feststeht —
   * und sie steht nicht fest (O-21). Die Rechnung steht hier trotzdem, damit
   * sichtbar ist, WAS verglichen würde, sobald die Antwort kommt.
   */
  const grenze = BAGATELLGRENZE_PLATZHALTER.grenzeCent;
  const jahressummeCent = daten.jahressumme === null
    ? NULL_CENT : cent(BigInt(daten.jahressumme.gegenleistungCent));
  const bagatellGreiftWuerde = grenze !== null && jahressummeCent < grenze;

  const ausgang: 'bescheinigung' | 'bagatelle' | 'einbehalt' | 'keine_bauleistung'
    | 'nicht_bewertbar' | 'kein_satz' =
    !bescheinigungenSichtbar
      ? 'nicht_bewertbar'
      : satzBp === null
        ? 'kein_satz'
        : lage === null
          ? 'keine_bauleistung'
          : !k.bauabzugsteuer_pflichtig
            ? 'keine_bauleistung'
            : lage.bescheinigungId !== null
              ? 'bescheinigung'
              : bagatellGreiftWuerde
                ? 'bagatelle'
                : 'einbehalt';

  return (
    <PortalRahmen
      titel={t.steuerlicheLage}
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="eingangsrechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label={g.zurueck} className="mb-s3">
        <Link
          href={`/portal/${mandant}/finanzen/eingangsrechnungen/${id}`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← {k.interne_belegnummer ?? k.rechnungsnummer_lieferant ?? t.eingangsrechnung}
        </Link>
      </nav>

      <h1 className="mb-s3 text-h1 text-text">{t.steuerH1}</h1>

      <dl
        data-cse="steuer-stichtag"
        className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line-strong bg-surface p-s5 sm:grid-cols-3"
      >
        <div>
          <dt className="text-xs text-text-muted">{t.lieferant}</dt>
          <dd className="text-sm text-text">{k.lieferant ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.ustIdLieferant}</dt>
          <dd className="cse-zahl text-sm text-text">{k.lieferant_ust_id ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.geprueftGegen}</dt>
          <dd className="text-sm text-text">
            {k.stichtag ?? <span className="text-warning">{t.keinDatumPruefbar}</span>}
          </dd>
        </div>
        <div className="sm:col-span-3">
          <dt className="text-xs text-text-muted">{t.welchesDatum}</dt>
          <dd className="max-w-prose text-xs text-text-muted">
            <code>{STICHTAG_QUELLE}</code> {t.stichtagErklaerung}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="ustg13b-titel" className="mb-s7">
        <h2 id="ustg13b-titel" className="mb-s3 text-h2 text-text">
          {t.titel13b}
        </h2>
        <div
          data-cse="steuer-13b"
          data-greift={String(k.reverse_charge)}
          className={`rounded-lg border p-s5 text-sm ${
            k.reverse_charge
              ? 'border-line bg-surface text-text'
              : 'border-line bg-surface text-text-muted'}`}
        >
          <p className="m-0 flex flex-wrap items-center gap-s3">
            <StatusPill
              zustand={k.reverse_charge ? 'Abgeschlossen' : 'Inaktiv'}
              sprache={zugang.sprache}
            />
            <span className="text-text">
              {k.reverse_charge ? t.greift : t.greiftNicht}
            </span>
          </p>
          <p className="m-0 mt-s3 max-w-prose">
            {k.reverse_charge
              ? `${t.grundlageVor} ${t.artText[
                (k.reverse_charge_grundlage ?? '') as keyof typeof t.artText]
                ?? t.nichtBenannt}. ${t.grundlageNach}`
              : t.keineVerlagerung}
          </p>
          {k.reverse_charge ? (
            <p className="m-0 mt-s3 max-w-prose">
              {t.hinweistextLautet}{' '}
              <strong className="text-text">
                {t.zitatAuf}{HINWEIS_13B}{t.zitatZu}
              </strong>
            </p>
          ) : null}
          <p className="m-0 mt-s3 max-w-prose text-xs text-text-muted">
            {t.status13bVor} <code>{TABELLE_MANDANT}</code>{' '}
            {t.status13bMitte} <code>{SPALTE_KUNDE_STATUS}</code>{' '}
            {t.status13bNach}
          </p>
        </div>
      </section>

      <section aria-labelledby="estg48-titel" className="mb-s7">
        <h2 id="estg48-titel" className="mb-s3 text-h2 text-text">
          {t.titel48}
        </h2>

        <div
          data-cse="steuer-48"
          data-ausgang={ausgang}
          className={`mb-s3 rounded-lg border p-s5 text-sm ${
            ausgang === 'einbehalt' || ausgang === 'nicht_bewertbar'
              || ausgang === 'kein_satz'
              ? 'border-warning bg-warning-soft text-warning'
              : 'border-line bg-surface text-text'}`}
        >
          <p className="m-0 text-text">
            <strong>
              {ausgang === 'nicht_bewertbar'
                ? `${t.ausgangNichtBewertbarVor} ${RECHT_FINANZEN_LESEN} `
                  + t.ausgangNichtBewertbarNach
                : ausgang === 'kein_satz'
                  ? t.ausgangKeinSatz
                  : ausgang === 'keine_bauleistung'
                    ? t.ausgangKeineBauleistung
                    : ausgang === 'bescheinigung'
                      ? t.ausgangBescheinigung
                      : ausgang === 'bagatelle'
                        ? t.ausgangBagatelle
                        : t.ausgangEinbehalt}
            </strong>
          </p>
          <p className="m-0 mt-s3 max-w-prose">
            {ausgang === 'nicht_bewertbar'
              ? `${t.diesemKontoFehlt} ${RECHT_FINANZEN_LESEN}`
                + `${t.nichtBewertbarMitte} ${TABELLE_FREISTELLUNG} `
                + t.nichtBewertbarNach
              : ausgang === 'kein_satz'
                ? `${t.keinSatzVor} ${EINSTELLUNG_SATZ} ${t.keinSatzNach}`
                : lage === null
                  ? t.ohneStichtag
                  : lage.grund}
          </p>
          {lage === null ? null : (
            <dl className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-text-muted">{t.grundlageBrutto}</dt>
                <dd className="cse-zahl text-sm text-text">
                  {formatiereGeld(lage.grundlageCent)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">{t.satz}</dt>
                <dd className="cse-zahl text-sm text-text">
                  {satzBp === null
                    ? <span className="text-warning">{t.keinSatzHinterlegt}</span>
                    : `${(satzBp / 100).toLocaleString('de-DE')} %`}
                </dd>
                <dd className="mt-s1 text-xs text-text-muted">
                  {k.bauabzugsteuer_satz_bp === null
                    ? `${t.satzAusEinstellungVor} ${EINSTELLUNG_SATZ} `
                      + t.satzAusEinstellungNach
                    : t.satzVomBeleg}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">{t.einbehalt}</dt>
                <dd className="cse-zahl text-sm text-text" data-cse="steuer-einbehalt">
                  {formatiereGeld(lage.einbehaltCent)}
                </dd>
              </div>
            </dl>
          )}
          {lage?.warnung === null || lage === null ? null : (
            <p className="m-0 mt-s4 max-w-prose text-warning">{lage.warnung}</p>
          )}
          {k.bauabzugsteuer_cent === null || lage === null
            || cent(BigInt(k.bauabzugsteuer_cent)) === lage.einbehaltCent ? null : (
              <p className="m-0 mt-s4 max-w-prose text-warning">
                {t.abweichungVor}{' '}
                {formatiereGeld(cent(BigInt(k.bauabzugsteuer_cent)))}
                {t.abweichungMitte} {formatiereGeld(lage.einbehaltCent)}
                {t.abweichungNach}
              </p>
            )}
        </div>

        <Hinweis art="warnung" cse="steuer-bagatelle" className="mb-s3">
          <p className="m-0 max-w-prose">
            <strong>
              {grenze === null
                ? t.keineBagatellgrenze
                : `${t.bagatellgrenzeVor} ${formatiereGeld(cent(grenze))}.`}
            </strong>{' '}
            {BAGATELLGRENZE_PLATZHALTER.herkunft} {t.fundstelle}{' '}
            {BAGATELLGRENZE_PLATZHALTER.fundstelle}.
          </p>
        </Hinweis>

        <h3 className="mb-s3 text-h3 text-text">
          {t.jahressummeTitel}
        </h3>
        {k.lieferant_id === null ? (
          <p className="mb-s3 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.ohneLieferantKeineSumme}
          </p>
        ) : daten.jahressumme === null ? (
          <p className="mb-s3 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.fuerJahrVor} {k.stichtag?.slice(0, 4) ?? t.diesesJahr}{' '}
            {t.fuerJahrNach} <strong>{t.zustandKurz.freigegeben}</strong>{' '}
            {t.vorAbzugsentscheidung}
          </p>
        ) : (
          <dl className="mb-s3 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-text-muted">
                {t.bereitsErbracht} {daten.jahressumme.jahr}
              </dt>
              <dd className="cse-zahl text-sm text-text" data-cse="steuer-jahressumme">
                {formatiereGeld(jahressummeCent)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">
                {t.erwarteteJahresgegenleistung}
              </dt>
              <dd className="cse-zahl text-sm text-text">
                {daten.jahressumme.prognoseCent === null
                  ? <span className="text-text-subtle">{t.nichtEingetragen}</span>
                  : formatiereGeld(cent(BigInt(daten.jahressumme.prognoseCent)))}
              </dd>
            </div>
            {daten.jahressumme.prognoseGrundlage === null ? null : (
              <div className="sm:col-span-2">
                <dt className="text-xs text-text-muted">{t.grundlageErwartung}</dt>
                <dd className="max-w-prose text-sm text-text">
                  {daten.jahressumme.prognoseGrundlage}
                </dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-xs text-text-muted">{t.fortgeschrieben}</dt>
              <dd className="text-xs text-text-muted">
                {daten.jahressumme.letzteAktualisierung} {t.prognoseErklaerung}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section aria-labelledby="fsb-titel">
        <h2 id="fsb-titel" className="mb-s3 text-h2 text-text">
          {t.fsbTitel}
        </h2>
        {darf['finanzen.lesen'] !== true ? (
          <Hinweis art="warnung" cse="steuer-fsb-kein-recht">
            <p className="m-0 max-w-prose">
              {t.diesemKontoFehlt} <strong>{RECHT_FINANZEN_LESEN}</strong>{' '}
              {t.fsbKeinRechtMitte} <code>{TABELLE_FREISTELLUNG}</code>
              {t.fsbKeinRechtNach}
            </p>
          </Hinweis>
        ) : daten.bescheinigungen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.keineFsbHinterlegt}
          </p>
        ) : (
          <DataTable
            beschriftung={t.tabelleFsb}
            zeilen={daten.bescheinigungen}
            schluessel={(b) => b.id}
            spalten={[
              { schluessel: 'nummer', kopf: g.nummer, zelle: (b) => b.nummer },
              { schluessel: 'finanzamt', kopf: t.finanzamt, zelle: (b) => b.finanzamt },
              {
                schluessel: 'gueltig', kopf: t.gueltig,
                zelle: (b) => `${b.gueltigVon} – ${b.gueltigBis}`,
              },
              {
                schluessel: 'umfang', kopf: t.umfang,
                zelle: (b) => (b.umfang === 'unbeschraenkt'
                  ? t.unbeschraenkt
                  : t.auftragsbezogen),
              },
              {
                schluessel: 'befund',
                kopf: `${t.amStichtag} ${k.stichtag ?? '—'}`,
                zelle: (b) => {
                  const gilt = k.stichtag !== null
                    && giltAm(b, k.stichtag, k.auftrag_id);
                  return (
                    <span className="inline-flex flex-wrap items-center gap-s2">
                      <StatusPill
                        zustand={gilt ? 'Abgeschlossen' : 'Inaktiv'}
                        sprache={zugang.sprache}
                      />
                      <span className="text-xs text-text-muted">
                        {b.widerrufenAm !== null
                          ? `${t.widerrufenAm} ${b.widerrufenAm}`
                          : gilt
                            ? t.gilt
                            : b.umfang === 'auftragsbezogen' && b.auftragId !== k.auftrag_id
                              ? t.giltAndererAuftrag
                              : t.giltNicht}
                      </span>
                    </span>
                  );
                },
              },
              {
                schluessel: 'dokument', kopf: t.beleg,
                zelle: (b) => (b.dokumentId === null
                  ? <span className="text-text-subtle">{t.keinDokument}</span>
                  : (
                    <a
                      href={`/api/dokumente/${b.dokumentId}/datei`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline"
                    >
                      {g.oeffnen}
                    </a>
                  )),
              },
            ]}
          />
        )}

        <Hinweis art="warnung" cse="steuer-pflege-offen" className="mt-s5">
          <p className="m-0 max-w-prose">
            <strong>{t.pflegeOffenBetont}</strong> {t.pflegeOffenVor}{' '}
            <code>{TABELLE_FREISTELLUNG}</code> {t.pflegeOffenZwei}{' '}
            <code>{RECHT_FINANZEN_SCHREIBEN}</code>{t.pflegeOffenDrei}{' '}
            <code>{RECHT_FREISTELLUNG_PFLEGEN}</code>{t.pflegeOffenNach}
          </p>
        </Hinweis>
      </section>

      <p className="mt-s7 max-w-prose text-xs text-text-muted">
        {t.schlussVor} <code>{DIENST_ABZUG}</code>{' '}
        {t.schlussNach}
        {k.freistellung_geprueft_am === null
          ? t.geprueftNichtVermerkt
          : `${t.geprueftAm} ${k.freistellung_geprueft_am}.`}
      </p>
    </PortalRahmen>
  );
}

// TODO(client, O-604): Welches Recht öffnet die Pflege der §48b-Freistellungsbescheinigung — `abrechnung.freistellung_pflegen` (so das Routenregister), `finanzen.schreiben` (so die Policy auf `freistellungsbescheinigung`) oder `eingang.lesen` (so der Beleg daneben)? Bis zur Antwort pflegt diese Seite nichts und nennt bei fehlendem `finanzen.lesen` den Ausgang ausdrücklich „nicht bewertbar" statt „Einbehalt".
// TODO(client, O-605): Ist der §13b-Status der EIGENEN Gesellschaft als Leistungsempfängerin als Zeitreihe zu führen (wie `kunde_bauleistender_status` für die Ausgangsseite) — und ab wann gilt eine Änderung? Bis zur Antwort zeigt die Seite den auf dem BELEG gespeicherten Stand und bewertet nicht tagesaktuell neu.
