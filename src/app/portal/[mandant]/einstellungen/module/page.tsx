import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Recht } from '@/components/ui/Recht';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { internSprache } from '@/lib/i18n/intern';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import {
  MODUL_ZUWEISUNG_TEXTE, modulName,
} from '@/lib/i18n/verwaltung/einstellungen/module-zuweisung';
import { MODULBUCHUNG_TEXTE } from '@/lib/i18n/verwaltung/einstellungen/modulbuchung';
import { eigenerEintrag } from '@/lib/nachschlagen';
import {
  administrationenMitModulen, type AdministrationModule,
} from '@/server/services/system/mitgliedschaft-module';
import { leseModulbuchung, type Modulbuchung } from '@/server/services/system/mandant-module';
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
 *
 * **Eingetragen wird hier** (V-298, D-809): eine Super-Administration mit
 * `system.module_zuweisen` setzt die Gewerke; die Seite sagt, wer es wann
 * getan hat — oder dass der Stand noch der des Seeds ist. Zurück kommen nur
 * Schlüssel (`?erfolg=`, `?fehler=`), die Sätze stehen hier (V-275, D-769).
 */
export const dynamic = 'force-dynamic';

const GEWERK_NAME: Readonly<Record<string, string>> = {
  reinigung: 'Gebäudereinigung', security: 'Sicherheits- und Objektschutzdienste', bau: 'Hochbau, Ausbau, Rückbau',
};

export default async function Module(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/module`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  const sprache = internSprache(zugang.sprache);
  const tModule = nachSprache(MODUL_ZUWEISUNG_TEXTE, zugang.sprache);
  const tBuchung = nachSprache(MODULBUCHUNG_TEXTE, zugang.sprache);
  const erfolg = eigenerEintrag(tBuchung.erfolg, suche['erfolg']) ?? null;
  const fehler = eigenerEintrag(tBuchung.fehler, suche['fehler']) ?? null;
  /*
   * Der Name fuehrt aufs Benutzerblatt — nur, wer es oeffnen darf. Ein
   * Verweis auf eine 404 verraet, dass es das Blatt gibt (AUT-06).
   */
  const darf = await haeltRechte(zugang.sitzung, 'system.benutzer_lesen', 'system.module_zuweisen');
  const { buchung, admins, superAdmin } = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, async (kontext) => ({
        buchung: await leseModulbuchung(kontext, mandantId),
        /*
         * AUT-01 (V-164): die zweite Haelfte dessen, was diese Seite laut
         * SEITENKARTE §5.24 zeigt — „which modules an admin holds in this
         * mandant". Geaendert wird auf dem Benutzerblatt; hier steht die Liste.
         */
        admins: await administrationenMitModulen(kontext),
        /* Dieselbe Frage, die `app.mandant_module_buchen` (0502) stellt. */
        superAdmin: (await kontext.abfrage<{ ja: boolean }>(
          `select app.ist_super_admin() as ja`))[0]?.ja === true,
      }))) as Promise<{
        buchung: Modulbuchung | null; admins: readonly AdministrationModule[]; superAdmin: boolean;
      }>);
  if (buchung === null) notFound();
  const gebucht = new Set(buchung.module);
  const gewerkModule = Object.entries(GEWERK_FUER_MODUL);
  const darfBuchen = darf['system.module_zuweisen'] === true && superAdmin;

  return (
    <PortalRahmen
      titel="Module"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={!darfBuchen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Module</h1>
      {erfolg !== null ? (
        <Hinweis art="erfolg" rolle="status" cse="modulbuchung-erfolg" className="mb-s5">
          {erfolg}
        </Hinweis>
      ) : null}
      {fehler !== null ? (
        <Hinweis art="warnung" rolle="alert" cse="modulbuchung-fehler" className="mb-s5">
          {fehler}
        </Hinweis>
      ) : null}
      <p data-cse="module-gepflegt" data-gepflegt={String(buchung.gepflegt)}
         className={`mb-s5 max-w-prose rounded-lg border p-s4 text-sm ${buchung.gepflegt
           ? 'border-line bg-surface text-text-muted' : 'border-warning bg-warning-soft text-warning'}`}>
        {buchung.gepflegt
          ? 'Die Buchung gilt: nur die Module der gebuchten Gewerke sind sichtbar (D-377).'
          : 'Die Buchung ist noch nicht eingetragen: es wird nicht gefiltert, damit eine neu angelegte Gesellschaft nicht schwarz wird. Voreinstellung (O-355): die Super-Administration trägt die Buchung beim Vertragsschluss ein — unten unter „Buchung eintragen“.'}
        {' '}
        <span data-cse="module-eingetragen" data-eingetragen={String(buchung.eingetragenAm !== null)}>
          {buchung.eingetragenAm === null
            ? tBuchung.seedStand
            : tBuchung.eingetragen(buchung.eingetragenAm, buchung.eingetragenVon)}
        </span>
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
            <StatusPill zustand={!buchung.gepflegt || gebucht.has(gewerk) ? 'Aktiv' : 'Inaktiv'} />
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
        Die Buchung ändert die Super-Administration (Recht{' '}
        <Recht schluessel="system.module_zuweisen" />, mit Zwei-Faktor-Pflicht); jede
        Änderung steht mit vorher und nachher im Protokoll der Gesellschaft.
      </p>

      <section aria-labelledby="buchung-titel" data-cse="modulbuchung" className="mt-s6">
        <h2 id="buchung-titel" className="mb-s3 text-h2 text-text">{tBuchung.titel}</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">{tBuchung.erklaerung}</p>
        {darfBuchen ? (
          <form method="post" action="/api/einstellungen/module" data-cse="modulbuchung-formular"
                className="max-w-prose rounded-lg border border-line bg-surface p-s5">
            <fieldset className="m-0 border-0 p-0">
              <legend className="sr-only">{tBuchung.titel}</legend>
              {GEWERKE.map((g) => (
                <label key={g} className="flex min-h-11 items-center gap-s3 text-sm text-text">
                  <input type="checkbox" name="gewerk" value={g} defaultChecked={gebucht.has(g)} />
                  {tBuchung.gewerk[g] ?? g}
                </label>
              ))}
            </fieldset>
            <p className="mt-s3 text-xs text-text-muted">{tBuchung.keinesHeisst}</p>
            <button
              type="submit"
              className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
            >
              {tBuchung.speichern}
            </button>
          </form>
        ) : darf['system.module_zuweisen'] === true ? (
          <p data-cse="modulbuchung-nur-super-admin" className="max-w-prose text-sm text-text-muted">
            {tBuchung.nurSuperAdmin}
          </p>
        ) : null}
      </section>

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
