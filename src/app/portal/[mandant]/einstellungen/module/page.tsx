import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { internSprache } from '@/lib/i18n/intern';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import {
  MODUL_ZUWEISUNG_TEXTE, modulName,
} from '@/lib/i18n/verwaltung/einstellungen/module-zuweisung';
import {
  administrationenMitModulen, type AdministrationModule,
} from '@/server/services/system/mitgliedschaft-module';
import { GEWERKE, GEWERK_FUER_MODUL, QUERSCHNITT } from '@/server/registry/modul';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/module` — was diese Gesellschaft gebucht
 * hat und was deshalb sichtbar ist (AUT-01, D-377).
 *
 * Zwei Tabellen, eine Regel: `mandant.module` nennt die Gewerke, das
 * Register (`modul.ts`) ordnet jedes Modul einem Gewerk zu oder erklaert es
 * zum Querschnitt. Was hier steht, ist die Antwort auf „warum sehe ich das
 * Wachbuch nicht" — und `module_gepflegt = false` heisst: es wird gar nicht
 * gefiltert, weil die Buchung noch nie eingetragen wurde (O-355).
 */
export const dynamic = 'force-dynamic';

const GEWERK_NAME: Readonly<Record<string, string>> = {
  reinigung: 'Gebäudereinigung', security: 'Sicherheits- und Objektschutzdienste', bau: 'Hochbau, Ausbau, Rückbau',
};

interface Zeile {
  readonly module: readonly string[] | null;
  readonly module_gepflegt: boolean;
}

export default async function Module(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/module`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  const sprache = internSprache(zugang.sprache);
  const tModule = nachSprache(MODUL_ZUWEISUNG_TEXTE, zugang.sprache);
  /*
   * Der Name fuehrt aufs Benutzerblatt — nur, wer es oeffnen darf. Ein
   * Verweis auf eine 404 verraet, dass es das Blatt gibt (AUT-06).
   */
  const darf = await haeltRechte(zugang.sitzung, 'system.benutzer_lesen');
  const { zeilen, admins } = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      zeilen: await kontext.abfrage<Zeile>(
        `select module, module_gepflegt from mandant where id = $1`, [mandantId]),
      /*
       * AUT-01 (V-164): die zweite Haelfte dessen, was diese Seite laut
       * SEITENKARTE §5.24 zeigt — „which modules an admin holds in this
       * mandant". Geaendert wird auf dem Benutzerblatt; hier steht die Liste.
       */
      admins: await administrationenMitModulen(kontext),
    }))) as Promise<{ zeilen: readonly Zeile[]; admins: readonly AdministrationModule[] }>);
  const [m] = zeilen;
  if (m === undefined) notFound();
  const gebucht = new Set(m.module ?? []);
  const gewerkModule = Object.entries(GEWERK_FUER_MODUL);

  return (
    <PortalRahmen
      titel="Module"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Module</h1>
      <p data-cse="module-gepflegt" data-gepflegt={String(m.module_gepflegt)}
         className={`mb-s5 max-w-prose rounded-lg border p-s4 text-sm ${m.module_gepflegt
           ? 'border-line bg-surface text-text-muted' : 'border-warning bg-warning-soft text-warning'}`}>
        {m.module_gepflegt
          ? 'Die Buchung ist eingetragen: nur die Module der gebuchten Gewerke sind sichtbar (D-377).'
          : 'Die Buchung ist noch nicht eingetragen (O-355): es wird nicht gefiltert, damit eine neu angelegte Gesellschaft nicht schwarz wird. Was unten als gebucht steht, ist der Seed, keine Entscheidung.'}
      </p>

      <h2 className="mb-s3 text-h2 text-text">Gewerke</h2>
      <ul data-cse="gewerke" className="mb-s6 grid grid-cols-1 gap-s3 md:grid-cols-3">
        {GEWERKE.map((g) => (
          <li key={g} data-gewerk={g} data-gebucht={String(gebucht.has(g))}
              className="flex items-center justify-between gap-s3 rounded-lg border border-line bg-surface p-s4">
            <span className="text-sm text-text">{GEWERK_NAME[g] ?? g}</span>
            <StatusPill zustand={gebucht.has(g) ? 'Aktiv' : 'Inaktiv'} />
          </li>
        ))}
      </ul>

      <h2 className="mb-s3 text-h2 text-text">Module je Gewerk</h2>
      <ul className="mb-s6 grid grid-cols-1 gap-s3 md:grid-cols-2">
        {gewerkModule.map(([modul, gewerk]) => (
          <li key={modul} className="flex items-center justify-between gap-s3 rounded-lg border border-line bg-surface p-s4">
            <span className="text-sm text-text">
              <code>{modul}</code>
              <span className="ml-s2 text-xs text-text-muted">→ {GEWERK_NAME[gewerk] ?? gewerk}</span>
            </span>
            <StatusPill zustand={!m.module_gepflegt || gebucht.has(gewerk) ? 'Aktiv' : 'Inaktiv'} />
          </li>
        ))}
      </ul>

      <h2 className="mb-s3 text-h2 text-text">Querschnitt — in jeder Gesellschaft</h2>
      <p className="mb-s3 max-w-[72ch] text-sm text-text-muted">
        Diese Module hängen an keinem Gewerk: jede Gesellschaft hat Kunden, Aufträge,
        Rechnungen, Personal und ein Protokoll.
      </p>
      <p data-cse="querschnitt" className="flex flex-wrap gap-s2">
        {[...QUERSCHNITT].sort().map((q) => (
          <code key={q} className="rounded-md bg-surface-3 px-s2 py-s1 text-xs text-text">{q}</code>
        ))}
      </p>
      <p className="mt-s5 text-sm text-text-subtle">
        Die Buchung ändert die Super-Administration (`system.module_zuweisen`,
        Zwei-Faktor-Pflicht); die Änderung ist eine Zeile in `mandant.module`.
      </p>

      <h2 className="mb-s3 mt-s6 text-h2 text-text">{tModule.uebersichtTitel}</h2>
      <p className="mb-s4 max-w-prose text-sm text-text-muted">{tModule.uebersichtErklaerung}</p>
      {admins.length === 0 ? (
        <p data-cse="admin-module-leer"
           className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {tModule.uebersichtLeer}
        </p>
      ) : (
        <div data-cse="admin-module">
          <DataTable
            beschriftung={tModule.uebersichtBeschriftung}
            zeilen={admins}
            schluessel={(a) => a.mitgliedschaftId}
            spalten={[
              { schluessel: 'konto', kopf: tModule.spalteKonto,
                zelle: (a) => (darf['system.benutzer_lesen'] === true ? (
                  <Link href={`/portal/${mandant}/einstellungen/benutzer/${a.benutzerId}`}
                        className="text-text underline-offset-2 hover:text-brand hover:underline">
                    {a.name}
                  </Link>
                ) : a.name) },
              { schluessel: 'module', kopf: tModule.spalteModule,
                zelle: (a) => (a.module === null ? tModule.alleDerRolle
                  : a.module.map((x) => modulName(x, sprache)).join(', ')) },
            ]}
          />
        </div>
      )}
    </PortalRahmen>
  );
}
