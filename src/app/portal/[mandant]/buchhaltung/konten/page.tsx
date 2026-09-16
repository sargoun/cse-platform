import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { RAHMEN_NAME, type Kontenrahmen } from '@/server/services/buchhaltung/kontenrahmen';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/buchhaltung/konten` — Kontenrahmen und Zuordnungen
 * (ACC-01, PR 65, D-484). Lesend: der Kontenrahmen und jede Zuordnung
 * stehen in `datev_konfiguration` und `konto_mapping`, beide mit
 * `ist_platzhalter`, solange der Steuerberater sie nicht bestaetigt hat
 * (O-05). Diese Seite zeigt, was gilt und was noch Platzhalter ist — sie
 * erfindet keine Zuordnung und bietet keinen Editor fuer Stammdaten, die
 * eine Fachfrage sind.
 */
export const dynamic = 'force-dynamic';

const TYP: Readonly<Record<string, string>> = {
  erloes_leistung: 'Erlöskonto (Leistung)', aufwand_kategorie: 'Aufwandskonto (Kategorie)',
  debitor_kunde: 'Debitor (Kunde)', kreditor_lieferant: 'Kreditor (Lieferant)',
  geldkonto: 'Geldkonto', steuer_gruppe: 'Steuerkonto (Gruppe)',
  bauabzugsteuer_verbindlichkeit: 'Bauabzugsteuer', skonto_aufwand: 'Skonto (Aufwand)',
  skonto_ertrag: 'Skonto (Ertrag)', mahngebuehr_ertrag: 'Mahngebühr (Ertrag)',
  zins_ertrag: 'Zinsen (Ertrag)', durchlaufender_posten: 'Durchlaufender Posten',
};

interface Konfig {
  readonly kontenrahmen: string | null;
  readonly sachkontenlaenge: number | null;
  readonly wj_beginn_monat: number | null;
  readonly wj_beginn_tag: number | null;
  readonly versteuerungsart: string | null;
  readonly ist_platzhalter: boolean;
  readonly berater: boolean;
}

interface Zuordnung {
  readonly id: string;
  readonly schluessel_typ: string;
  readonly bezug: string | null;
  readonly konto: string;
  readonly gegenkonto: string | null;
  readonly bu_schluessel: string | null;
  readonly gueltig_von: string;
  readonly gueltig_bis: string | null;
  readonly ist_platzhalter: boolean;
}

export default async function Konten({ params }: { params: Promise<{ mandant: string }> }) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/buchhaltung/konten`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * `/buchhaltung/buchungen` verlangt laut Manifest `buchhaltung.lesen`; diese
   * Seite oeffnet mit `buchhaltung_konfiguration.verwalten`. Wer die
   * Zuordnungen verwalten darf, darf nicht zwangslaeufig das Journal lesen —
   * die Zahl fuehrte dann auf 404 und verriete, was sie nicht zeigen darf
   * (AUT-06, Copilot-Runde auf PR 16 / D-581). Ohne das Recht steht die
   * Zahl ohne Verweis.
   */
  const darf = await haeltRechte(zugang.sitzung, 'buchhaltung.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [konfig] = await kontext.abfrage<Konfig>(
        `select kontenrahmen::text as kontenrahmen, sachkontenlaenge, wj_beginn_monat, wj_beginn_tag,
                versteuerungsart::text as versteuerungsart, ist_platzhalter,
                (berater_nummer is not null and mandanten_nummer is not null) as berater
           from datev_konfiguration where mandant_id = app.aktiver_mandant()`);
      const zuordnungen = await kontext.abfrage<Zuordnung>(
        `select km.id, km.schluessel_typ::text as schluessel_typ,
                coalesce(k.name, l.name, sg.bezeichnung, km.erloeskonto_schluessel) as bezug,
                km.konto, km.gegenkonto, km.bu_schluessel,
                km.gueltig_von::text as gueltig_von, km.gueltig_bis::text as gueltig_bis, km.ist_platzhalter
           from konto_mapping km
           left join kunde k on k.id = km.kunde_id and k.mandant_id = km.mandant_id
           left join lieferant l on l.id = km.lieferant_id and l.mandant_id = km.mandant_id
           left join steuersatz_gruppe sg on sg.id = km.steuersatz_gruppe_id
          order by km.schluessel_typ, km.prioritaet, km.konto`);
      const [ohne] = await kontext.abfrage<{ n: number }>(`select count(*)::int as n from buchungssatz_unvollstaendig`);
      return { konfig: konfig ?? null, zuordnungen, ohneKonto: ohne?.n ?? 0 };
    })) as Promise<{ konfig: Konfig | null; zuordnungen: readonly Zuordnung[]; ohneKonto: number }>);

  const rahmen = daten.konfig?.kontenrahmen ?? null;
  const platzhalter = daten.zuordnungen.filter((z) => z.ist_platzhalter).length;

  return (
    <PortalRahmen
      titel="Kontenrahmen"
      wurzelTitel="Buchhaltung"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Kontenrahmen und Zuordnungen</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Welcher Kontenrahmen gilt und welches Konto eine Leistung, ein Kunde, eine Steuergruppe
        trägt, ist Sache des Steuerberaters (O-05). Bis zur Bestätigung ist jede Zeile ein
        Platzhalter — und der DATEV-Export sagt das in jeder Datei.
      </p>

      <Hinweis art={daten.konfig === null || daten.konfig.ist_platzhalter ? 'warnung' : 'hinweis'}
               cse="konten-konfiguration" className="mb-s6 max-w-prose">
        <strong>Kontenrahmen: {rahmen === null ? 'nicht festgelegt' : RAHMEN_NAME[rahmen as Kontenrahmen] ?? rahmen}.</strong>{' '}
        {daten.konfig === null
          ? 'Es gibt noch keine DATEV-Einrichtung für diese Gesellschaft (O-05).'
          : `Sachkontenlänge ${daten.konfig.sachkontenlaenge === null ? '—' : String(daten.konfig.sachkontenlaenge)}, `
            + `Wirtschaftsjahr ab ${daten.konfig.wj_beginn_tag === null ? '1' : String(daten.konfig.wj_beginn_tag)}.`
            + `${daten.konfig.wj_beginn_monat === null ? '1' : String(daten.konfig.wj_beginn_monat)}., `
            + `${daten.konfig.versteuerungsart ?? 'Versteuerungsart offen'}, `
            + `${daten.konfig.berater ? 'Berater- und Mandantennummer hinterlegt' : 'Berater- und Mandantennummer fehlen'}`
            + `${daten.konfig.ist_platzhalter ? ' — Platzhalter, nicht bestätigt (O-05).' : ' — bestätigt.'}`}
      </Hinweis>

      <ul data-cse="konten-kennzahlen" className="mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        <li className="rounded-lg border border-line bg-surface p-s5">
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">Zuordnungen</div>
          <div className="mt-s1 text-h2 text-text" data-cse="zuordnungen-anzahl">{String(daten.zuordnungen.length)}</div>
        </li>
        <li className="rounded-lg border border-line bg-surface p-s5">
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">davon Platzhalter</div>
          <div className="mt-s1 text-h2 text-text">{String(platzhalter)}</div>
        </li>
        <li className="rounded-lg border border-line bg-surface p-s5">
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">Buchungszeilen ohne Konto</div>
          <div className="mt-s1 text-h2 text-text">
            {darf['buchhaltung.lesen'] === true ? (
              <Link href={`/portal/${mandant}/buchhaltung/buchungen`} className="underline-offset-2 hover:text-brand hover:underline">
                {String(daten.ohneKonto)}
              </Link>
            ) : String(daten.ohneKonto)}
          </div>
        </li>
      </ul>

      {daten.zuordnungen.length === 0 ? (
        <p data-cse="konten-leer" className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch keine Kontenzuordnung. Ohne Zuordnung trägt eine Buchungszeile kein Konto und
          steht als Prüfhinweis unter Buchungen — der Export entsteht nicht (O-05).
        </p>
      ) : (
        <DataTable
          beschriftung="Kontenzuordnungen dieser Gesellschaft"
          zeilen={daten.zuordnungen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'typ', kopf: 'Zuordnung', zelle: (z) => TYP[z.schluessel_typ] ?? z.schluessel_typ },
            { schluessel: 'bezug', kopf: 'Bezug', zelle: (z) => z.bezug ?? '—' },
            { schluessel: 'konto', kopf: 'Konto', zelle: (z) => <span className="font-mono">{z.konto}</span> },
            { schluessel: 'gegenkonto', kopf: 'Gegenkonto', zelle: (z) => <span className="font-mono">{z.gegenkonto ?? '—'}</span> },
            { schluessel: 'bu', kopf: 'BU', zelle: (z) => z.bu_schluessel ?? '—' },
            { schluessel: 'gueltig', kopf: 'Gültig',
              zelle: (z) => `${z.gueltig_von.slice(8, 10)}.${z.gueltig_von.slice(5, 7)}.${z.gueltig_von.slice(0, 4)}${z.gueltig_bis === null ? ' –' : ` – ${z.gueltig_bis.slice(8, 10)}.${z.gueltig_bis.slice(5, 7)}.${z.gueltig_bis.slice(0, 4)}`}` },
            { schluessel: 'stand', kopf: 'Stand',
              zelle: (z) => <StatusPill zustand={z.ist_platzhalter ? 'Offen' : 'Bereit'} /> },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
