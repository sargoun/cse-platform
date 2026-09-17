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

const ART_TEXT: Readonly<Record<string, string>> = {
  bau: 'Bauleistung (§13b Abs. 2 Nr. 4 UStG)',
  gebaeudereinigung: 'Gebäudereinigung (§13b Abs. 2 Nr. 8 UStG)',
};

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
        return { kopf: null, bescheinigungen: [], jahressumme: null };
      }

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
      };
    })) as Promise<{
      kopf: Kopf | null;
      bescheinigungen: readonly BescheinigungZeile[];
      jahressumme: Jahressumme | null;
    }>);

  const k = daten.kopf;
  if (k === null) {
    if (darf['eingang.lesen'] !== true) {
      return (
        <PortalRahmen
          titel="Steuerliche Lage"
          bereich={mandant as BereichSchluessel}
          nurLesen
          leiste={zugang.leiste}
          wurzel={`/portal/${mandant}`}
          aktiverTab="eingangsrechnungen"
          sichtbareTabs={zugang.sichtbareTabs}
          navigationsRechte={zugang.navigationsRechte}
        >
          <h1 className="mb-s3 text-h1 text-text">Steuerliche Lage</h1>
          <Hinweis art="warnung" cse="steuer-kein-leserecht">
            <p className="m-0 max-w-prose">
              Diesem Konto fehlt <strong>eingang.lesen</strong>. Diese Route
              öffnet mit <strong>abrechnung.freistellung_pflegen</strong>, die
              Rechnung selbst liegt aber hinter dem Eingangsrecht — beide Mengen
              sind nicht deckungsgleich, und welche gelten soll, ist offen
              (O-604).
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
   */
  const satzBp = k.bauabzugsteuer_satz_bp ?? 1500;
  const lage: AbzugLage | null = k.stichtag === null || k.brutto_cent === null
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

  const ausgang: 'bescheinigung' | 'bagatelle' | 'einbehalt' | 'keine_bauleistung' =
    lage === null
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
      titel="Steuerliche Lage"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="eingangsrechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/finanzen/eingangsrechnungen/${id}`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← {k.interne_belegnummer ?? k.rechnungsnummer_lieferant ?? 'Eingangsrechnung'}
        </Link>
      </nav>

      <h1 className="mb-s3 text-h1 text-text">§13b UStG und §48 EStG</h1>

      <dl
        data-cse="steuer-stichtag"
        className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line-strong bg-surface p-s5 sm:grid-cols-3"
      >
        <div>
          <dt className="text-xs text-text-muted">Lieferant</dt>
          <dd className="text-sm text-text">{k.lieferant ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">USt-IdNr. des Lieferanten</dt>
          <dd className="cse-zahl text-sm text-text">{k.lieferant_ust_id ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Geprüft gegen</dt>
          <dd className="text-sm text-text">
            {k.stichtag ?? <span className="text-warning">kein Datum — nichts prüfbar</span>}
          </dd>
        </div>
        <div className="sm:col-span-3">
          <dt className="text-xs text-text-muted">Welches Datum das ist</dt>
          <dd className="max-w-prose text-xs text-text-muted">
            <code>{STICHTAG_QUELLE}</code> — also das Ende des
            Leistungszeitraums, sonst das Leistungsdatum, sonst das
            Rechnungsdatum. Der Gesetzeswortlaut des §48 EStG knüpft an die
            ZAHLUNG an, SPEC FIN-10 an das Leistungsdatum; welches gilt, ist
            offen (O-176). Die Entscheidung unten ist gegen den genannten Tag
            getroffen und gegen keinen anderen.
          </dd>
        </div>
      </dl>

      <section aria-labelledby="ustg13b-titel" className="mb-s7">
        <h2 id="ustg13b-titel" className="mb-s3 text-h2 text-text">
          §13b UStG — Steuerschuldnerschaft des Leistungsempfängers
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
            <StatusPill zustand={k.reverse_charge ? 'Abgeschlossen' : 'Inaktiv'} />
            <span className="text-text">
              {k.reverse_charge ? 'greift' : 'greift nicht'}
            </span>
          </p>
          <p className="m-0 mt-s3 max-w-prose">
            {k.reverse_charge
              ? `Grundlage: ${ART_TEXT[k.reverse_charge_grundlage ?? ''] ?? 'nicht benannt'}. `
                + 'Die Umsatzsteuer schuldet diese Gesellschaft als '
                + 'Leistungsempfängerin; der Lieferant weist keine aus.'
              : 'Diese Rechnung trägt keine Verlagerung der Steuerschuld. Ohne '
                + 'hinterlegten Nachweis wird die Umsatzsteuer ausgewiesen — die '
                + 'sichere Richtung: zu Unrecht ausgewiesene Steuer wird geschuldet '
                + '(§14c UStG) und ist korrigierbar, eine zu Unrecht verlagerte ist '
                + 'beim Empfänger ein Ausfall.'}
          </p>
          {k.reverse_charge ? (
            <p className="m-0 mt-s3 max-w-prose">
              Der feste Hinweistext auf dem Beleg lautet:{' '}
              <strong className="text-text">„{HINWEIS_13B}"</strong>
            </p>
          ) : null}
          <p className="m-0 mt-s3 max-w-prose text-xs text-text-muted">
            Der §13b-Status der EIGENEN Gesellschaft als Leistungsempfängerin
            ist nirgends als Zeitreihe hinterlegt — <code>mandant</code> trägt
            kein entsprechendes Feld, und <code>kunde_bauleistender_status</code>
            beschreibt die Ausgangsseite. Was hier steht, ist deshalb der auf dem
            BELEG gespeicherte Stand und keine tagesaktuelle Neubewertung
            (O-605).
          </p>
        </div>
      </section>

      <section aria-labelledby="estg48-titel" className="mb-s7">
        <h2 id="estg48-titel" className="mb-s3 text-h2 text-text">
          §48 EStG — Bauabzugsteuer, drei Ausgänge
        </h2>

        <div
          data-cse="steuer-48"
          data-ausgang={ausgang}
          className={`mb-s3 rounded-lg border p-s5 text-sm ${
            ausgang === 'einbehalt'
              ? 'border-warning bg-warning-soft text-warning'
              : 'border-line bg-surface text-text'}`}
        >
          <p className="m-0 text-text">
            <strong>
              {ausgang === 'keine_bauleistung'
                ? 'Angewandt: §48 EStG greift nicht'
                : ausgang === 'bescheinigung'
                  ? 'Angewandt: Ausgang 1 — gültige Freistellungsbescheinigung'
                  : ausgang === 'bagatelle'
                    ? 'Angewandt: Ausgang 2 — Jahressumme unter der Bagatellgrenze'
                    : 'Angewandt: Ausgang 3 — es wird einbehalten'}
            </strong>
          </p>
          <p className="m-0 mt-s3 max-w-prose">
            {lage === null
              ? 'Ohne Stichtag oder ohne Betrag lässt sich nichts entscheiden — '
                + 'und geraten wird hier nichts.'
              : lage.grund}
          </p>
          {lage === null ? null : (
            <dl className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-text-muted">Grundlage (brutto)</dt>
                <dd className="cse-zahl text-sm text-text">
                  {formatiereGeld(lage.grundlageCent)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Satz</dt>
                <dd className="cse-zahl text-sm text-text">
                  {(satzBp / 100).toLocaleString('de-DE')} %
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Einbehalt</dt>
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
                Auf dem Beleg steht ein Einbehalt von{' '}
                {formatiereGeld(cent(BigInt(k.bauabzugsteuer_cent)))}, die heutige
                Prüfung ergibt {formatiereGeld(lage.einbehaltCent)}. Gebucht wurde
                nach dem Beleg; die Abweichung ist ein Prüfauftrag, keine
                Korrektur.
              </p>
            )}
        </div>

        <Hinweis art="warnung" cse="steuer-bagatelle" className="mb-s3">
          <p className="m-0 max-w-prose">
            <strong>
              {grenze === null
                ? 'Keine Bagatellgrenze angewandt (O-21) — es wird einbehalten.'
                : `Bagatellgrenze: ${formatiereGeld(cent(grenze))}.`}
            </strong>{' '}
            {BAGATELLGRENZE_PLATZHALTER.herkunft} Fundstelle:{' '}
            {BAGATELLGRENZE_PLATZHALTER.fundstelle}.
          </p>
        </Hinweis>

        <h3 className="mb-s3 text-h3 text-text">
          Die Jahressumme dieses Leistenden — der zweite Ausgang
        </h3>
        {k.lieferant_id === null ? (
          <p className="mb-s3 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Ohne zugeordneten Lieferanten gibt es keine Jahressumme. §48 Abs. 2
            EStG misst je Leistungsempfänger und Leistendem.
          </p>
        ) : daten.jahressumme === null ? (
          <p className="mb-s3 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Für {k.stichtag?.slice(0, 4) ?? 'dieses Jahr'} ist noch keine
            Gegenleistung an diesen Leistenden erfasst. Die Summe entsteht beim
            Übergang einer Eingangsrechnung nach <strong>freigegeben</strong> —
            also VOR der Abzugsentscheidung und nicht danach.
          </p>
        ) : (
          <dl className="mb-s3 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-text-muted">
                Bereits erbrachte Gegenleistung {daten.jahressumme.jahr}
              </dt>
              <dd className="cse-zahl text-sm text-text" data-cse="steuer-jahressumme">
                {formatiereGeld(jahressummeCent)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">
                Erwartete Jahresgegenleistung (§48 Abs. 1)
              </dt>
              <dd className="cse-zahl text-sm text-text">
                {daten.jahressumme.prognoseCent === null
                  ? <span className="text-text-subtle">nicht eingetragen</span>
                  : formatiereGeld(cent(BigInt(daten.jahressumme.prognoseCent)))}
              </dd>
            </div>
            {daten.jahressumme.prognoseGrundlage === null ? null : (
              <div className="sm:col-span-2">
                <dt className="text-xs text-text-muted">Grundlage der Erwartung</dt>
                <dd className="max-w-prose text-sm text-text">
                  {daten.jahressumme.prognoseGrundlage}
                </dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-xs text-text-muted">Fortgeschrieben</dt>
              <dd className="text-xs text-text-muted">
                {daten.jahressumme.letzteAktualisierung} · Die Prognose trägt ein
                Mensch ein und wird nie abgeleitet — eine geschätzte Prognose wäre
                eine, die die Plattform behauptet und niemand verantwortet.
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section aria-labelledby="fsb-titel">
        <h2 id="fsb-titel" className="mb-s3 text-h2 text-text">
          Freistellungsbescheinigungen nach §48b EStG
        </h2>
        {darf['finanzen.lesen'] !== true ? (
          <Hinweis art="warnung" cse="steuer-fsb-kein-recht">
            <p className="m-0 max-w-prose">
              Diesem Konto fehlt <strong>finanzen.lesen</strong> — und genau das
              verlangt die Policy auf <code>freistellungsbescheinigung</code>.
              Die Bescheinigungen bleiben deshalb ungezeigt; das ist kein leerer
              Bestand, sondern ein fehlendes Recht (O-604).
            </p>
          </Hinweis>
        ) : daten.bescheinigungen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Für diesen Lieferanten ist keine Freistellungsbescheinigung
            hinterlegt. Ohne sie wird einbehalten — das ist Ausgang 3 und kein
            Versäumnis der Seite.
          </p>
        ) : (
          <DataTable
            beschriftung="Freistellungsbescheinigungen dieses Lieferanten mit Gültigkeit und Widerruf"
            zeilen={daten.bescheinigungen}
            schluessel={(b) => b.id}
            spalten={[
              { schluessel: 'nummer', kopf: 'Nummer', zelle: (b) => b.nummer },
              { schluessel: 'finanzamt', kopf: 'Finanzamt', zelle: (b) => b.finanzamt },
              {
                schluessel: 'gueltig', kopf: 'Gültig',
                zelle: (b) => `${b.gueltigVon} – ${b.gueltigBis}`,
              },
              {
                schluessel: 'umfang', kopf: 'Umfang',
                zelle: (b) => (b.umfang === 'unbeschraenkt'
                  ? 'unbeschränkt'
                  : 'auftragsbezogen'),
              },
              {
                schluessel: 'befund',
                kopf: `Am ${k.stichtag ?? '—'}`,
                zelle: (b) => {
                  const gilt = k.stichtag !== null
                    && giltAm(b, k.stichtag, k.auftrag_id);
                  return (
                    <span className="inline-flex flex-wrap items-center gap-s2">
                      <StatusPill zustand={gilt ? 'Abgeschlossen' : 'Inaktiv'} />
                      <span className="text-xs text-text-muted">
                        {b.widerrufenAm !== null
                          ? `widerrufen am ${b.widerrufenAm}`
                          : gilt
                            ? 'gilt'
                            : b.umfang === 'auftragsbezogen' && b.auftragId !== k.auftrag_id
                              ? 'gilt für einen anderen Auftrag'
                              : 'gilt am Stichtag nicht'}
                      </span>
                    </span>
                  );
                },
              },
              {
                schluessel: 'dokument', kopf: 'Beleg',
                zelle: (b) => (b.dokumentId === null
                  ? <span className="text-text-subtle">kein Dokument</span>
                  : (
                    <a
                      href={`/api/dokumente/${b.dokumentId}/datei`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline"
                    >
                      öffnen
                    </a>
                  )),
              },
            ]}
          />
        )}

        <Hinweis art="warnung" cse="steuer-pflege-offen" className="mt-s5">
          <p className="m-0 max-w-prose">
            <strong>Hochladen, Gültigkeit setzen und Widerruf sind hier nicht
            möglich (O-604).</strong> Für diese Route ist im Register kein
            Schreibrecht eingetragen; die Policy auf{' '}
            <code>freistellungsbescheinigung</code> verlangt zum Schreiben{' '}
            <code>finanzen.schreiben</code>, während die Route mit{' '}
            <code>abrechnung.freistellung_pflegen</code> öffnet. Welcher
            Schlüssel gelten soll, ist eine Entscheidung am Rechtemodell — und
            eine Maske, die auf eine Policy trifft, die sie abweist, ist
            schlechter als keine.
          </p>
        </Hinweis>
      </section>

      <p className="mt-s7 max-w-prose text-xs text-text-muted">
        Der Einbehaltbetrag kommt aus <code>services/finanz/estg48/abzug.ts</code>{' '}
        und nie aus einem Modell (Invariante 6). Geprüft
        {k.freistellung_geprueft_am === null
          ? ' wurde die Bescheinigung auf dem Beleg nicht vermerkt.'
          : ` wurde die Bescheinigung laut Beleg am ${k.freistellung_geprueft_am}.`}
      </p>
    </PortalRahmen>
  );
}
