import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { findeRoute } from '@/server/registry/routen';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { KpiStat } from '@/components/ui/KpiStat';
import { Icon } from '@/components/ui/Icon';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import type { IconName } from '@/lib/design/icons';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../unterseite';

/**
 * `/portal/[mandant]/finanzen` — die Finanzuebersicht dieser Gesellschaft
 * (FIN-17, REP-01, DSH-04), lesend. Das Ziel des Tabs „Finanzen" in der
 * Leiste `intern_global`, das bis hierher auf „wird noch gebaut" fuehrte.
 *
 * **Jede Kachel fragt ihr Recht, bevor sie zaehlt.** `rechnung`,
 * `offener_posten`, `eingangsrechnung` und `mahnung` stehen unter Policies
 * mit je eigenem Recht; ohne Recht gaebe die Datenbank null Zeilen, und eine
 * 0 saehe aus wie „keine Forderung". Deshalb steht dann keine Kachel, nicht
 * eine Null (dasselbe Muster wie in der Gruppenansicht, D-475).
 *
 * **Summen aus der Datenbank, in Cent, als Text uebertragen** (Invariante 1).
 * Kein Gewinn: „Fakturiert" sind festgeschriebene Rechnungen nach
 * Rechnungsdatum, „Eingang" freigegebene und gebuchte Eingangsrechnungen —
 * eine Gewinn-und-Verlust-Rechnung ist das nicht, und die Seite sagt es.
 */
export const dynamic = 'force-dynamic';

const RECHTE = {
  rechnungen: 'finanzen.lesen',
  posten: 'zahlung.lesen',
  eingang: 'eingang.lesen',
  mahnungen: 'mahnung.lesen',
} as const;

interface Kennzahlen {
  readonly jahr: number;
  readonly entwuerfe: number;
  readonly festgeschrieben_jahr: number;
  readonly fakturiert_netto_cent: string;
  readonly forderungen_offen_cent: string;
  readonly forderungen_ueberfaellig_cent: string;
  readonly posten_ueberfaellig: number;
  readonly eingang_offen: number;
  readonly eingang_offen_brutto_cent: string;
  readonly eingang_jahr_netto_cent: string;
  readonly mahnungen_offen: number;
}

interface Karte {
  readonly pfad: string;
  readonly titel: string;
  readonly text: string;
  readonly icon: IconName;
}

const KARTEN: readonly Karte[] = [
  { pfad: 'finanzen/rechnungen', titel: 'Rechnungen', icon: 'rechnung',
    text: 'Entwürfe, Festgeschriebenes, Stornos — jede Nummer lückenlos aus dem eigenen Kreis.' },
  { pfad: 'finanzen/zahlungen', titel: 'Zahlungen und offene Posten', icon: 'euro',
    text: 'Was Kunden schulden, was eingegangen ist, was überfällig wird.' },
  { pfad: 'finanzen/eingangsrechnungen', titel: 'Eingangsrechnungen', icon: 'dokument',
    text: 'Lieferantenrechnungen: erfasst, geprüft, freigegeben, gebucht.' },
  { pfad: 'finanzen/mahnungen', titel: 'Mahnwesen', icon: 'warnung',
    text: 'Stufen, Gebühren, Vorschläge — versendet wird nichts ohne Freigabe.' },
  { pfad: 'finanzen/ausgangsbuch', titel: 'Rechnungsausgangsbuch', icon: 'export',
    text: 'Je Nummernkreis, lückenlos, mit dem Stand der Hash-Kette.' },
];

export default async function Finanzuebersicht(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/finanzen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  const kartenRechte = [...new Set(KARTEN.flatMap((k) => {
    const route = findeRoute(`/portal/${mandant}/${k.pfad}`);
    return route?.bewachung.art === 'recht' ? [...route.bewachung.lesen] : [];
  }))];

  const { gehalten, z } = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const rechte = await kontext.abfrage<{ recht: string; ok: boolean }>(
        `select r as recht, app.hat_recht(r, $2::uuid) as ok from unnest($1::text[]) as r`,
        [[...new Set([...Object.values(RECHTE), ...kartenRechte])], mandantId]);
      const [z] = await kontext.abfrage<Kennzahlen>(
        `with heute as (select (now() at time zone 'Europe/Berlin')::date as tag)
         select extract(year from heute.tag)::int as jahr,
                (select count(*) from rechnung r where r.status = 'entwurf')::int as entwuerfe,
                (select count(*) from rechnung r where r.status = 'festgeschrieben'
                   and extract(year from r.rechnungsdatum) = extract(year from heute.tag))::int
                  as festgeschrieben_jahr,
                (select coalesce(sum(r.netto_gesamt_cent), 0) from rechnung r
                  where r.status = 'festgeschrieben'
                    and extract(year from r.rechnungsdatum) = extract(year from heute.tag))::text
                  as fakturiert_netto_cent,
                (select coalesce(sum(op.offen_cent), 0) from offener_posten op
                  where op.art = 'debitor' and op.ausgeglichen_am is null)::text as forderungen_offen_cent,
                (select coalesce(sum(op.offen_cent), 0) from offener_posten op
                  where op.art = 'debitor' and op.ausgeglichen_am is null
                    and op.faellig_am < heute.tag)::text as forderungen_ueberfaellig_cent,
                (select count(*) from offener_posten op
                  where op.art = 'debitor' and op.ausgeglichen_am is null
                    and op.faellig_am < heute.tag)::int as posten_ueberfaellig,
                (select count(*) from eingangsrechnung e
                  where e.status in ('eingegangen', 'in_pruefung'))::int as eingang_offen,
                (select coalesce(sum(e.brutto_cent), 0) from eingangsrechnung e
                  where e.status in ('eingegangen', 'in_pruefung'))::text as eingang_offen_brutto_cent,
                (select coalesce(sum(e.netto_cent), 0) from eingangsrechnung e
                  where e.status in ('freigegeben', 'gebucht')
                    and extract(year from e.rechnungsdatum) = extract(year from heute.tag))::text
                  as eingang_jahr_netto_cent,
                (select count(*) from mahnung m
                  where m.status in ('entwurf', 'freigegeben'))::int as mahnungen_offen
           from heute`);
      return { gehalten: new Set(rechte.filter((r) => r.ok).map((r) => r.recht)), z: z ?? null };
    })) as Promise<{ gehalten: ReadonlySet<string>; z: Kennzahlen | null }>);
  if (z === null) throw new Error('Die Finanzuebersicht hat keine Kennzahlenzeile erhalten.');

  const geld = (roh: string): string => formatiereGeld(cent(BigInt(roh)));
  const basis = `/portal/${mandant}/finanzen`;
  const sichtbar = KARTEN.filter((k) => {
    const route = findeRoute(`/portal/${mandant}/${k.pfad}`);
    return route !== undefined && route.bewachung.art === 'recht'
      && route.bewachung.lesen.every((r) => gehalten.has(r));
  });

  return (
    <PortalRahmen
      titel="Finanzen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">Finanzen {String(z.jahr)}</h1>

      <div data-cse="finanzen-kacheln" className="mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        {gehalten.has(RECHTE.rechnungen) ? (
          <>
            <a href={`${basis}/rechnungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="fakturiert">
              <KpiStat label={`Fakturiert ${String(z.jahr)} netto · ${String(z.festgeschrieben_jahr)} Rechnungen`}
                       wert={geld(z.fakturiert_netto_cent)} ton="success" icon="rechnung" interaktiv />
            </a>
            <a href={`${basis}/rechnungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="entwuerfe">
              <KpiStat label="Rechnungsentwürfe" wert={String(z.entwuerfe)}
                       ton={z.entwuerfe > 0 ? 'info' : 'muted'} icon="stift" interaktiv />
            </a>
          </>
        ) : null}
        {gehalten.has(RECHTE.posten) ? (
          <>
            <a href={`${basis}/zahlungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="forderungen">
              <KpiStat label="Offene Forderungen" wert={geld(z.forderungen_offen_cent)}
                       ton={BigInt(z.forderungen_offen_cent) > 0n ? 'warning' : 'muted'} icon="euro" interaktiv />
            </a>
            <a href={`${basis}/zahlungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="ueberfaellig">
              <KpiStat label={`Überfällig · ${String(z.posten_ueberfaellig)} Posten`} wert={geld(z.forderungen_ueberfaellig_cent)}
                       ton={z.posten_ueberfaellig > 0 ? 'danger' : 'muted'} icon="warnung" interaktiv />
            </a>
          </>
        ) : null}
        {gehalten.has(RECHTE.eingang) ? (
          <>
            <a href={`${basis}/eingangsrechnungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="eingang-offen">
              <KpiStat label={`Eingangsrechnungen zu prüfen · ${String(z.eingang_offen)}`} wert={geld(z.eingang_offen_brutto_cent)}
                       ton={z.eingang_offen > 0 ? 'info' : 'muted'} icon="dokument" interaktiv />
            </a>
            <a href={`${basis}/eingangsrechnungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="eingang-jahr">
              <KpiStat label={`Eingang ${String(z.jahr)} netto (freigegeben, gebucht)`} wert={geld(z.eingang_jahr_netto_cent)}
                       ton="muted" icon="export" interaktiv />
            </a>
          </>
        ) : null}
        {gehalten.has(RECHTE.mahnungen) ? (
          <a href={`${basis}/mahnungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="mahnungen">
            <KpiStat label="Mahnungen in Arbeit" wert={String(z.mahnungen_offen)}
                     ton={z.mahnungen_offen > 0 ? 'warning' : 'muted'} icon="warnung" interaktiv />
          </a>
        ) : null}
      </div>
      <p className="mb-s6 max-w-[72ch] text-sm text-text-subtle">
        Fakturiert zählt festgeschriebene Rechnungen nach Rechnungsdatum, netto; Eingang
        freigegebene und gebuchte Eingangsrechnungen. Das ist keine Gewinn-und-Verlust-Rechnung
        — den Jahresabschluss erstellt der Steuerberater aus dem DATEV-Export. Eine Kachel,
        deren Recht Sie nicht halten, fehlt hier — sie zeigt keine Null.
      </p>

      <h2 className="mb-s3 text-h2 text-text">Bereiche</h2>
      <ul data-cse="finanzen-karten" className="grid grid-cols-1 gap-s4 md:grid-cols-2">
        {sichtbar.map((k) => (
          <li key={k.pfad}>
            <a href={`/portal/${mandant}/${k.pfad}`} data-cse="finanzen-karte" data-ziel={k.pfad}
               className="group block h-full rounded-lg border border-line bg-surface p-s5 transition duration-base ease-brand hover:-translate-y-0.5 hover:border-line-strong">
              <div className="mb-s3 flex h-10 w-10 items-center justify-center rounded-md bg-surface-3 text-text">
                <Icon name={k.icon} />
              </div>
              <h3 className="text-h3 text-text">{k.titel}</h3>
              <p className="mt-s2 text-sm text-text-muted">{k.text}</p>
            </a>
          </li>
        ))}
      </ul>
    </PortalRahmen>
  );
}
