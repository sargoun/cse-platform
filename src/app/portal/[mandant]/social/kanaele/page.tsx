import type postgres from 'postgres';
import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { type KanalZeile, listeKanaele } from '@/server/services/social/dienst';
import { PLATTFORM_NAME, type Plattform } from '@/server/services/social/port';
import { fehlendeSchluessel } from '@/server/versand/social-plattform';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/social/kanaele` — **die Seite, auf der nichts behauptet
 * wird** (SOC-06, SOC-07).
 *
 * Fünf fremde Plattformen, jede mit ihrem Stand. Heute steht bei allen
 * dasselbe: nicht verbunden, und zwar mit dem GRUND — welche Zugangsdaten
 * fehlen, und welche Frage offen ist (O-10). Ein grüner Haken ohne Konto
 * dahinter wäre der teuerste Bildschirm dieses Moduls: jemand plant einen
 * Beitrag, drückt, bekommt keine Fehlermeldung, und sucht ihn drei Tage später
 * bei Instagram.
 *
 * **Die eigene Website steht oben und ist kein Kanal.** Sie funktioniert
 * sofort (SOC-05), weil ein veröffentlichter Beitrag dort steht, sobald sein
 * Status es sagt — kein Adapter, kein Schlüssel, kein Vertrag.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Kanäle — Social Media' };

export default async function Kanaele(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/social/kanaele`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) =>
      listeKanaele(kontext))) as Promise<readonly KanalZeile[]>);

  const verbundene = zeilen.filter((z) => z.verbunden).length;

  return (
    <PortalRahmen
      titel="Kanäle"
      wurzelTitel="Social Media"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Kanäle</h1>
        <Link href={`/portal/${mandant}/social`} data-cse="zum-center"
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
          Zum Center
        </Link>
      </div>

      <section data-cse="kanal-website"
               className="mb-s5 rounded-lg border border-line bg-surface p-s4">
        <div className="flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="text-h2 text-text">Eigene Gesellschaftsseite</h2>
          <StatusPill zustand="Aktiv" />
        </div>
        <p className="mt-s2 max-w-prose text-sm text-text-muted">
          Sie ist <strong>kein Anschluss</strong>, sondern diese Plattform selbst: ein
          freigegebener Beitrag steht auf der öffentlichen Seite, sobald er veröffentlicht
          wurde — ohne Zugangsdaten, ohne fremden Vertrag, ohne Wartezeit (SOC-05).
        </p>
      </section>

      {verbundene === 0 ? (
        <Hinweis art="warnung" cse="kanaele-keiner" className="mb-s5 max-w-prose">
          <strong>Kein fremder Kanal ist verbunden.</strong> Ein Beitrag geht damit auf die
          eigene Seite und sonst nirgendwohin — und genau das steht danach an jedem Kanal,
          statt eines Hakens, hinter dem nichts ist. Offen ist O-10: welche Konten gehören
          welcher Gesellschaft, wer ist dort Administrator, und liegt für jedes ein
          Auftragsverarbeitungsvertrag vor?
        </Hinweis>
      ) : null}

      <ul data-cse="kanal-liste" className="flex flex-col gap-s3">
        {zeilen.map((z) => {
          const fehlt = fehlendeSchluessel(z.plattform as Plattform);
          return (
            <li key={z.id} data-cse="kanal" data-plattform={z.plattform}
                data-verbunden={z.verbunden ? '1' : '0'}
                className="grid grid-cols-1 gap-s3 rounded-lg border border-line bg-surface p-s4 md:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="text-base font-semibold text-text">
                  {PLATTFORM_NAME[z.plattform as Plattform] ?? z.anzeigename}
                </div>
                <div className="mt-s1 text-xs text-text-subtle">
                  {z.handle ?? 'kein Profilname hinterlegt'}
                </div>
                <div className="mt-s2 max-w-prose text-sm text-text-muted">
                  {z.hinweis ?? (z.verbunden
                    ? 'verbunden'
                    : 'nicht verbunden — es ist kein Zugang hinterlegt.')}
                </div>
                {!z.verbunden && fehlt.length > 0 ? (
                  <div className="mt-s2 text-xs text-text-subtle" data-cse="kanal-fehlt">
                    Es fehlen: {fehlt.join(', ')}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col items-start gap-s2 md:items-end">
                <StatusPill zustand={z.verbunden ? 'Aktiv' : 'Inaktiv'} />
                <span className="text-xs text-text-subtle">
                  {z.verbunden ? 'verbunden' : 'nicht verbunden'}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-s6 max-w-prose text-xs text-text-muted">
        Ein Zugangsschlüssel steht hier nie und wird hier nie eingetippt. Er gehört in die
        Umgebung des Betriebs; diese Seite liest nur, ob er da ist (SEC-A5).
      </p>
    </PortalRahmen>
  );
}
