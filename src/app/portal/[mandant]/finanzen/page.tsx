import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { findeRoute } from '@/server/registry/routen';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { KpiStat } from '@/components/ui/KpiStat';
import { Icon } from '@/components/ui/Icon';
import { cent, formatiereGeld, type Cent } from '@/server/services/finanz/geld';
import { ausgabenAufwand, jeGesellschaft } from '@/server/services/buchhaltung/aufwand';
import type { IconName } from '@/lib/design/icons';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../unterseite';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { UEBERSICHT_TEXTE, type KartenZiel } from '@/lib/i18n/verwaltung/finanzen/uebersicht';

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
  /* Der Pfad ist zugleich der Schluessel der Texttabelle (`KartenZiel`). */
  readonly pfad: KartenZiel;
  readonly icon: IconName;
}

const KARTEN: readonly Karte[] = [
  { pfad: 'finanzen/rechnungen', icon: 'rechnung' },
  { pfad: 'finanzen/zahlungen', icon: 'euro' },
  { pfad: 'finanzen/eingangsrechnungen', icon: 'dokument' },
  /*
   * **Die Lieferantenstammdaten — sie standen hier nicht** (V-125, ein
   * Befund in eigener Sache: die Seite entstand zwei Änderungen zuvor und
   * bekam keinen Eingang). Ohne sie ist jede Eingangsrechnung ohne
   * Gegenüber, und § 13b und § 48 hängen an genau diesen Zeilen.
   */
  { pfad: 'finanzen/lieferanten', icon: 'gruppe' },
  { pfad: 'finanzen/mahnungen', icon: 'warnung' },
  { pfad: 'finanzen/ausgangsbuch', icon: 'export' },
  { pfad: 'finanzen/ausgaben', icon: 'euro' },
  { pfad: 'finanzen/belege', icon: 'dokument' },
  { pfad: 'finanzen/pruefungen', icon: 'qualitaet' },
  { pfad: 'finanzen/nummernkreise', icon: 'buch' },
  { pfad: 'finanzen/hashkette', icon: 'schloss' },
  { pfad: 'buchhaltung/archiv', icon: 'schloss' },
];

export default async function Finanzuebersicht(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/finanzen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(UEBERSICHT_TEXTE, zugang.sprache);

  const kartenRechte = [...new Set(KARTEN.flatMap((k) => {
    const route = findeRoute(`/portal/${mandant}/${k.pfad}`);
    return route?.bewachung.art === 'recht' ? [...route.bewachung.lesen] : [];
  }))];

  const { gehalten, z, ausgabenJahrCent } = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
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
      /*
       * Die Betriebsausgaben des Jahres (V-215) — aus derselben Quelle wie
       * Monatszahlen und Gruppe (`app.ausgaben_aufwand`, 0446). Vorher stand
       * hier nur der Eingang, und wer den Aufwand des Jahres suchte, sah die
       * Tankquittungen nicht.
       */
      const ausgaben = z === undefined ? null : jeGesellschaft(await ausgabenAufwand(
        kontext, `${String(z.jahr)}-01-01`, `${String(z.jahr)}-12-31`)).get(mandantId);
      return {
        gehalten: new Set(rechte.filter((r) => r.ok).map((r) => r.recht)), z: z ?? null,
        ausgabenJahrCent: ausgaben?.nettoCent ?? cent(0n),
      };
    })) as Promise<{ gehalten: ReadonlySet<string>; z: Kennzahlen | null; ausgabenJahrCent: Cent }>);
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
      titel={t.finanzen}
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">{`${t.finanzen} ${String(z.jahr)}`}</h1>

      <div data-cse="finanzen-kacheln" className="mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        {gehalten.has(RECHTE.rechnungen) ? (
          <>
            <a href={`${basis}/rechnungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="fakturiert">
              <KpiStat label={`${t.fakturiert} ${String(z.jahr)} ${t.netto} · ${String(z.festgeschrieben_jahr)} ${t.rechnungenZahl}`}
                       wert={geld(z.fakturiert_netto_cent)} ton="success" icon="rechnung" interaktiv />
            </a>
            <a href={`${basis}/rechnungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="entwuerfe">
              <KpiStat label={t.rechnungsentwuerfe} wert={String(z.entwuerfe)}
                       ton={z.entwuerfe > 0 ? 'info' : 'muted'} icon="stift" interaktiv />
            </a>
          </>
        ) : null}
        {gehalten.has(RECHTE.posten) ? (
          <>
            <a href={`${basis}/zahlungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="forderungen">
              <KpiStat label={t.offeneForderungen} wert={geld(z.forderungen_offen_cent)}
                       ton={BigInt(z.forderungen_offen_cent) > 0n ? 'warning' : 'muted'} icon="euro" interaktiv />
            </a>
            <a href={`${basis}/zahlungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="ueberfaellig">
              <KpiStat label={`${t.ueberfaellig} · ${String(z.posten_ueberfaellig)} ${t.posten}`} wert={geld(z.forderungen_ueberfaellig_cent)}
                       ton={z.posten_ueberfaellig > 0 ? 'danger' : 'muted'} icon="warnung" interaktiv />
            </a>
          </>
        ) : null}
        {gehalten.has(RECHTE.eingang) ? (
          <>
            <a href={`${basis}/eingangsrechnungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="eingang-offen">
              <KpiStat label={`${t.eingangsrechnungenZuPruefen} · ${String(z.eingang_offen)}`} wert={geld(z.eingang_offen_brutto_cent)}
                       ton={z.eingang_offen > 0 ? 'info' : 'muted'} icon="dokument" interaktiv />
            </a>
            <a href={`${basis}/eingangsrechnungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="eingang-jahr">
              <KpiStat label={`${t.eingang} ${String(z.jahr)} ${t.netto} ${t.freigegebenGebucht}`} wert={geld(z.eingang_jahr_netto_cent)}
                       ton="muted" icon="export" interaktiv />
            </a>
            <a href={`${basis}/ausgaben?jahr=${String(z.jahr)}&aufwand=ja`} className="group block rounded-lg" data-cse="kachel" data-kachel="ausgaben-jahr">
              <KpiStat label={`${t.ausgabenKachel} ${String(z.jahr)} ${t.netto} ${t.freigegebenGebucht}`}
                       wert={formatiereGeld(ausgabenJahrCent)} ton="muted" icon="euro" interaktiv />
            </a>
          </>
        ) : null}
        {gehalten.has(RECHTE.mahnungen) ? (
          <a href={`${basis}/mahnungen`} className="group block rounded-lg" data-cse="kachel" data-kachel="mahnungen">
            <KpiStat label={t.mahnungenInArbeit} wert={String(z.mahnungen_offen)}
                     ton={z.mahnungen_offen > 0 ? 'warning' : 'muted'} icon="warnung" interaktiv />
          </a>
        ) : null}
      </div>
      <p className="mb-s6 max-w-[72ch] text-sm text-text-subtle">
        {t.kachelFussnote}
      </p>

      <h2 className="mb-s3 text-h2 text-text">{t.bereiche}</h2>
      <ul data-cse="finanzen-karten" className="grid grid-cols-1 gap-s4 md:grid-cols-2">
        {sichtbar.map((k) => (
          <li key={k.pfad}>
            <a href={`/portal/${mandant}/${k.pfad}`} data-cse="finanzen-karte" data-ziel={k.pfad}
               className="group block h-full rounded-lg border border-line bg-surface p-s5 transition duration-base ease-brand hover:-translate-y-0.5 hover:border-line-strong">
              <div className="mb-s3 flex h-10 w-10 items-center justify-center rounded-md bg-surface-3 text-text">
                <Icon name={k.icon} />
              </div>
              <h3 className="text-h3 text-text">{t.karten[k.pfad].titel}</h3>
              <p className="mt-s2 text-sm text-text-muted">{t.karten[k.pfad].text}</p>
            </a>
          </li>
        ))}
      </ul>
    </PortalRahmen>
  );
}
