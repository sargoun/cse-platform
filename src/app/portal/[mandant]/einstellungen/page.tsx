import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { findeRoute } from '@/server/registry/routen';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/lib/design/icons';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../unterseite';

/**
 * `/portal/[mandant]/einstellungen` — der Einstieg in die Einstellungen
 * dieser Gesellschaft (AUT-03, SEITENKARTE 5.24).
 *
 * **Nur Karten, die fuehren.** Jede Karte fragt das Recht ihrer Zielseite —
 * aus dem Manifest, nicht aus einer zweiten Liste — und erscheint nur, wenn
 * diese Sitzung es haelt. Eine Karte, die auf 404 fuehrt, verriete, was es
 * gibt (AUT-06); eine ausgegraute sagte dasselbe. Seiten mit
 * Zwei-Faktor-Pflicht erscheinen nur einer `aal2`-Sitzung.
 */
export const dynamic = 'force-dynamic';

interface Karte {
  readonly pfad: string;
  readonly titel: string;
  readonly text: string;
  readonly icon: IconName;
}

const KARTEN: readonly Karte[] = [
  { pfad: 'einstellungen/mandant', titel: 'Unternehmensdaten', icon: 'gruppe',
    text: 'Firma, Anschrift, Register, Steuernummern, Bankverbindung — und ob sie bestätigt sind.' },
  { pfad: 'einstellungen/benutzer', titel: 'Benutzer', icon: 'person',
    text: 'Wer in dieser Gesellschaft ein Konto hat, mit welcher Rolle, und ob der zweite Faktor steht.' },
  { pfad: 'einstellungen/rollen', titel: 'Rollen und Rechte', icon: 'schloss',
    text: 'Die Rechtematrix: welche Rolle was darf, und wo diese Gesellschaft abweicht.' },
  { pfad: 'einstellungen/module', titel: 'Module', icon: 'einstellungen',
    text: 'Welche Gewerke diese Gesellschaft gebucht hat — und was deshalb sichtbar ist.' },
  { pfad: 'einstellungen/steuer', titel: 'Steuer', icon: 'rechnung',
    text: 'Steuersatzgruppen der Plattform und die steuerliche Identität dieser Gesellschaft.' },
  { pfad: 'einstellungen/abrechnungsarten', titel: 'Abrechnungsarten', icon: 'euro',
    text: 'Die fünf Arten und ihre Parameter — was davon noch unbestätigt ist.' },
  { pfad: 'einstellungen/mahnwesen', titel: 'Mahnwesen', icon: 'warnung',
    text: 'Stufen, Fristen, Gebühren — bestätigt oder noch offen.' },
  { pfad: 'einstellungen/protokoll', titel: 'Protokoll', icon: 'dokument',
    text: 'Wer wann was geändert hat: das Prüfprotokoll dieser Gesellschaft.' },
  { pfad: 'einstellungen/integrationen', titel: 'Integrationen', icon: 'export',
    text: 'Jede Anbindung mit ihrem wahren Zustand — verbunden, nicht verbunden, Dateiexport.' },
  { pfad: 'einstellungen/dpa', titel: 'Auftragsverarbeiter', icon: 'schloss',
    text: 'Das Verzeichnis nach Art. 30 DSGVO: Dienst, Zweck, Region, Vertrag.' },
];

export default async function Einstellungen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  // Die Rechte ALLER Karten in einer Frage — gegen den aktiven Bereich (K-03).
  const gefragt = [...new Set(KARTEN.flatMap((k) => {
    const route = findeRoute(`/portal/${mandant}/${k.pfad}`);
    return route?.bewachung.art === 'recht' ? [...route.bewachung.lesen] : [];
  }))];
  const gehalten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const zeilen = await kontext.abfrage<{ recht: string; ok: boolean }>(
        `select r as recht, app.hat_recht(r, $2::uuid) as ok from unnest($1::text[]) as r`,
        [gefragt, mandantId]);
      return new Set(zeilen.filter((z) => z.ok).map((z) => z.recht));
    })) as Promise<ReadonlySet<string>>);

  const sichtbar = KARTEN.filter((k) => {
    const route = findeRoute(`/portal/${mandant}/${k.pfad}`);
    if (route === undefined || route.bewachung.art !== 'recht') return false;
    if (route.bewachung.aal2 && zugang.sitzung.aal !== 'aal2') return false;
    return route.bewachung.lesen.every((r) => gehalten.has(r));
  });

  return (
    <PortalRahmen
      titel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Einstellungen</h1>
      <p className="mb-s6 max-w-[72ch] text-sm text-text-muted">
        Was diese Gesellschaft ausmacht und wer darin arbeitet. Alles hier ist
        eine Ansicht; geändert wird über die jeweils zuständige Stelle — und
        jede Änderung steht im Protokoll.
      </p>
      <ul data-cse="einstellungen-karten" className="grid grid-cols-1 gap-s4 md:grid-cols-2">
        {sichtbar.map((k) => (
          <li key={k.pfad}>
            <a href={`/portal/${mandant}/${k.pfad}`} data-cse="einstellungen-karte" data-ziel={k.pfad}
               className="group block h-full rounded-lg border border-line bg-surface p-s5 transition duration-base ease-brand hover:-translate-y-0.5 hover:border-line-strong">
              <div className="mb-s3 flex h-10 w-10 items-center justify-center rounded-md bg-surface-3 text-text">
                <Icon name={k.icon} />
              </div>
              <h2 className="text-h3 text-text">{k.titel}</h2>
              <p className="mt-s2 text-sm text-text-muted">{k.text}</p>
            </a>
          </li>
        ))}
      </ul>
      {sichtbar.length === 0 ? (
        <p data-cse="einstellungen-leer" className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für Ihre Rolle gibt es hier nichts einzustellen.
        </p>
      ) : null}
    </PortalRahmen>
  );
}
