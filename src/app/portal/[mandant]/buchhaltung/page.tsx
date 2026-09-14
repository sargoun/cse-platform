import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { findeRoute } from '@/server/registry/routen';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { KpiStat } from '@/components/ui/KpiStat';
import { Icon } from '@/components/ui/Icon';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { altersstruktur } from '@/server/services/buchhaltung/offene-posten';
import type { IconName } from '@/lib/design/icons';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../unterseite';

/**
 * `/portal/[mandant]/buchhaltung` — die Buchhaltung einer Gesellschaft auf
 * einer Seite (ACC-07, ACC-08, §5.15, PR 65, D-484).
 *
 * Vier Zahlen, die eine Buchhalterin morgens sehen will — Forderungen,
 * davon ueberfaellig, Verbindlichkeiten, Zeilen ohne Konto — und die Karten
 * zu allem, was gebaut ist. Jede Zahl fuehrt auf die Liste dahinter
 * (DSH-04); jede Karte ist ueber das Manifest rechtegebunden.
 */
export const dynamic = 'force-dynamic';

interface Karte {
  readonly pfad: string;
  readonly titel: string;
  readonly text: string;
  readonly icon: IconName;
}

const KARTEN: readonly Karte[] = [
  { pfad: 'buchhaltung/buchungen', titel: 'Buchungen', icon: 'buch',
    text: 'Das Hauptbuch aus Rechnungen, Eingangsrechnungen und Zahlungen — mit Beleg je Zeile.' },
  { pfad: 'buchhaltung/offene-posten', titel: 'Offene Posten', icon: 'euro',
    text: 'Debitoren und Kreditoren mit Altersstruktur — 0–30, 31–60, 61–90, über 90 Tage.' },
  { pfad: 'buchhaltung/monatszahlen', titel: 'Monatszahlen (BWA-artig)', icon: 'uebersicht',
    text: 'Erlöse, Aufwand, Ergebnis je Monat des Wirtschaftsjahrs — aus den Belegen, nicht aus einer Schätzung.' },
  { pfad: 'buchhaltung/perioden', titel: 'Periodenschloss', icon: 'schloss',
    text: 'Monate vorläufig schließen, schließen — und was geschlossen ist, nimmt keine Buchung mehr auf.' },
  { pfad: 'buchhaltung/konten', titel: 'Kontenrahmen und Zuordnungen', icon: 'einstellungen',
    text: 'SKR03/SKR04 und die Kontenzuordnungen — Platzhalter bleiben Platzhalter, bis der Steuerberater bestätigt.' },
  { pfad: 'buchhaltung/bank', titel: 'Bank', icon: 'bank',
    text: 'Kontoauszüge (CAMT.053) einlesen, Umsätze zuordnen, Klärung.' },
  { pfad: 'buchhaltung/datev', titel: 'DATEV', icon: 'export',
    text: 'Buchungsstapel im EXTF-Format — Dateiexport, keine vorgetäuschte Verbindung.' },
  { pfad: 'buchhaltung/archiv', titel: 'GoBD-Archiv', icon: 'dokument',
    text: 'Rechnungen und Belege, zehn Jahre, nicht löschbar — mit Prüfbündel je Jahrgang.' },
  { pfad: 'buchhaltung/z3-export', titel: 'Z3-Export (Betriebsprüfung)', icon: 'export',
    text: 'Datenträgerüberlassung nach § 147 Abs. 6 AO — Journal, Rechnungen, Belege und Stammdaten mit Strukturbeschreibung.' },
  { pfad: 'buchhaltung/verfahrensdokumentation', titel: 'Verfahrensdokumentation', icon: 'buch',
    text: 'GoBD-Verfahrensdokumentation aus der lebenden Konfiguration — jeder Abschnitt mit seiner Quelle, jeder Platzhalter benannt.' },
];

interface Zahlen {
  readonly ohne_konto: number;
  readonly perioden_offen: number;
  readonly perioden_geschlossen: number;
  readonly stichtag: string;
}

export default async function Buchhaltung({ params }: { params: Promise<{ mandant: string }> }) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/buchhaltung`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  const kartenRechte = [...new Set(KARTEN.flatMap((k) => {
    const route = findeRoute(`/portal/${mandant}/${k.pfad}`);
    return route?.bewachung.art === 'recht' ? [...route.bewachung.lesen] : [];
  }))];

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const rechte = await kontext.abfrage<{ recht: string; ok: boolean }>(
        `select r as recht, app.hat_recht(r, $2::uuid) as ok from unnest($1::text[]) as r`,
        [kartenRechte, mandantId]);
      const [z] = await kontext.abfrage<Zahlen>(
        `select (select count(*) from buchungssatz_unvollstaendig)::int as ohne_konto,
                (select count(*) from periode where status = 'offen')::int as perioden_offen,
                (select count(*) from periode where status = 'geschlossen')::int as perioden_geschlossen,
                app.berlin_heute()::text as stichtag`);
      const alter = await altersstruktur(kontext, z?.stichtag ?? '2026-01-01');
      return { gehalten: new Set(rechte.filter((r) => r.ok).map((r) => r.recht)), z, alter };
    })) as Promise<{ gehalten: ReadonlySet<string>; z: Zahlen | undefined;
      alter: Awaited<ReturnType<typeof altersstruktur>> }>);

  const sichtbar = KARTEN.filter((k) => {
    const route = findeRoute(`/portal/${mandant}/${k.pfad}`);
    return route !== undefined && route.bewachung.art === 'recht'
      && route.bewachung.lesen.every((r) => daten.gehalten.has(r));
  });

  return (
    <PortalRahmen
      titel="Buchhaltung"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Buchhaltung</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Stand {daten.alter.stichtag.slice(8, 10)}.{daten.alter.stichtag.slice(5, 7)}.{daten.alter.stichtag.slice(0, 4)}.
        Jede Zahl führt auf die Zeilen dahinter.
      </p>

      <ul data-cse="buchhaltung-kennzahlen" className="mb-s7 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        <li>
          <Link href={`/portal/${mandant}/buchhaltung/offene-posten?art=debitor`} className="group block">
            <KpiStat label="Forderungen offen" wert={formatiereGeld(daten.alter.debitor.gesamt)} icon="euro"
                     ton={daten.alter.debitor.gesamt > 0n ? 'info' : 'muted'} interaktiv />
          </Link>
        </li>
        <li>
          <Link href={`/portal/${mandant}/buchhaltung/offene-posten?art=debitor`} className="group block">
            <KpiStat label="davon überfällig" wert={formatiereGeld(daten.alter.debitor.ueberfaellig)} icon="warnung"
                     ton={daten.alter.debitor.ueberfaellig > 0n ? 'warning' : 'success'} interaktiv />
          </Link>
        </li>
        <li>
          <Link href={`/portal/${mandant}/buchhaltung/offene-posten?art=kreditor`} className="group block">
            <KpiStat label="Verbindlichkeiten offen" wert={formatiereGeld(daten.alter.kreditor.gesamt)} icon="dokument"
                     ton="muted" interaktiv />
          </Link>
        </li>
        <li>
          <Link href={`/portal/${mandant}/buchhaltung/buchungen`} className="group block">
            <KpiStat label="Buchungszeilen ohne Konto" wert={String(daten.z?.ohne_konto ?? 0)} icon="buch"
                     ton={(daten.z?.ohne_konto ?? 0) > 0 ? 'warning' : 'success'} interaktiv />
          </Link>
        </li>
      </ul>

      <ul data-cse="buchhaltung-karten" className="grid grid-cols-1 gap-s4 md:grid-cols-2">
        {sichtbar.map((k) => (
          <li key={k.pfad}>
            <Link href={`/portal/${mandant}/${k.pfad}`} data-cse="buchhaltung-karte" data-pfad={k.pfad}
                  className="flex h-full gap-s4 rounded-lg border border-line bg-surface p-s5 transition duration-base ease-brand hover:-translate-y-0.5 hover:border-line-strong">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-3 text-text">
                <Icon name={k.icon} />
              </span>
              <span className="min-w-0">
                <span className="block text-h3 text-text">{k.titel}</span>
                <span className="mt-s1 block text-sm text-text-muted">{k.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-s5 max-w-prose text-xs text-text-subtle">
        {String(daten.z?.perioden_geschlossen ?? 0)} Monat(e) geschlossen, {String(daten.z?.perioden_offen ?? 0)} offen.
        Z3-Export, Verfahrensdokumentation, Jahrespaket und Lohnexport folgen (PR 66, PR 67).
      </p>
    </PortalRahmen>
  );
}
