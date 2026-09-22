import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { lesePlattformen, type PlattformZeile } from '../daten';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/radar/plattformen` — wo diese Gesellschaft bieten darf
 * (RAD-09, D-07, O-07).
 *
 * **Die Tatsache, deren Fehlen am Abgabetag die Chance kostet.** Eine
 * Freischaltung auf einer Vergabeplattform dauert Tage bis Wochen; wer erst
 * beim Hochladen merkt, dass sein Haus dort kein Konto hat, hat die
 * Ausschreibung verloren, obwohl er sie gewonnen hätte.
 *
 * **Vorgabe ist `unbekannt`, nicht „nicht registriert".** Niemand hat diese
 * Frage bisher beantwortet (O-07), und eine Oberfläche, die „nicht
 * registriert" behauptet, behauptet etwas über die Konten eines Betriebs,
 * das sie nicht weiss.
 *
 * **Kein Kennwort, nirgends.** Gespeichert wird höchstens die Anmeldekennung
 * und der NAME eines Geheimnisses im Vault (SEC-A5) — nie das Geheimnis.
 */
export const dynamic = 'force-dynamic';

const STAND: Readonly<Record<string, { readonly pill: 'Aktiv' | 'Wartet' | 'Überfällig' | 'Inaktiv'; readonly text: string }>> = {
  registriert: { pill: 'Aktiv', text: 'registriert und freigeschaltet' },
  beantragt: { pill: 'Wartet', text: 'beantragt — noch nicht freigeschaltet' },
  nicht_registriert: { pill: 'Überfällig', text: 'nicht registriert' },
  abgelaufen: { pill: 'Überfällig', text: 'abgelaufen' },
  unbekannt: { pill: 'Inaktiv', text: 'unbekannt — niemand hat es bisher geprüft' },
};

export default async function Plattformen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/radar/plattformen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const darf = await haeltRechte(zugang.sitzung, 'radar.lesen');

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => lesePlattformen(kontext))) as Promise<readonly PlattformZeile[]>);

  const offeneOhneKonto = zeilen
    .filter((z) => z.registrierung !== 'registriert')
    .reduce((summe, z) => summe + z.offeneBekanntmachungen, 0);

  return (
    <PortalRahmen
      titel="Vergabeplattformen"
      wurzelTitel="Radar"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="radar"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Vergabeplattformen</h1>
        {/*
          * `/radar` oeffnet mit `radar.lesen` (Manifest); diese Seite mit `radar.plattform_verwalten`.
          * Ohne das Recht fuehrte der Verweis auf 404 und verriet damit, was er
          * nicht zeigen darf (AUT-06; D-581).
          */}
        {darf['radar.lesen'] === true && (
          <Link href={`/portal/${mandant}/radar`}
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
            Zum Radar
          </Link>
        )}
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Über diese Plattformen werden Vergabeunterlagen veröffentlicht und Angebote eingereicht.
        Eingereicht wird von Hand: eine Schnittstelle dafür gibt es nicht, Konten hängen an
        natürlichen Personen, und manche Plattform verlangt eine Signatur (D-07). Was hier zählt,
        ist deshalb die Frage davor — <strong>dürfen wir dort überhaupt bieten?</strong>
      </p>

      {offeneOhneKonto > 0 ? (
        <Hinweis art="warnung" cse="plattform-warnung" className="mb-s5 max-w-prose">
          <strong>{String(offeneOhneKonto)} offene Bekanntmachung{offeneOhneKonto === 1 ? '' : 'en'} auf
          Plattformen ohne Freischaltung.</strong> Eine Freischaltung dauert Tage bis Wochen —
          jetzt beantragen ist der Unterschied zwischen Angebot und Zuschauen.
        </Hinweis>
      ) : null}

      {zeilen.length === 0 ? (
        <Hinweis art="hinweis" cse="plattform-leer" className="max-w-prose">
          <strong>Der Plattformkatalog ist leer — mit Absicht.</strong> Welche Plattformen für diese
          Gruppe gelten und unter welcher Kennung dort wer registriert ist, ist offen (O-07). Eine
          erfundene Liste sähe aus wie ein geprüfter Stand und wäre eine Behauptung über die Konten
          dieses Betriebs. Sobald die Antwort da ist, trägt die Super-Administration die Plattformen
          ein, und der Einlesejob ordnet Bekanntmachungen über ihre Adresse automatisch zu.
        </Hinweis>
      ) : (
        <ul data-cse="plattform-liste" className="flex flex-col gap-s3">
          {zeilen.map((z) => {
            const stand = STAND[z.registrierung] ?? STAND['unbekannt']!;
            return (
              <li key={z.id} data-cse="plattform" data-stand={z.registrierung}
                  className="grid grid-cols-1 gap-s3 rounded-lg border border-line bg-surface p-s4 md:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-text">{z.name}</div>
                  <div className="mt-s1 text-xs text-text-subtle">
                    {z.betreiber ?? 'Betreiber nicht hinterlegt'}
                    {z.benutzerkennung === null ? '' : ` · Kennung ${z.benutzerkennung}`}
                    {z.registriertAm === null ? '' : ` · seit ${z.registriertAm}`}
                    {z.gueltigBis === null ? '' : ` · gültig bis ${z.gueltigBis}`}
                  </div>
                  <div className="mt-s2 text-sm text-text-muted">
                    {stand.text}
                    {z.hinweis === null ? '' : ` · ${z.hinweis}`}
                  </div>
                </div>
                <div className="flex flex-col items-start gap-s2 md:items-end">
                  <StatusPill zustand={stand.pill} />
                  <span className="text-xs text-text-subtle" data-cse="plattform-offene">
                    {String(z.offeneBekanntmachungen)} offene Bekanntmachung
                    {z.offeneBekanntmachungen === 1 ? '' : 'en'}
                  </span>
                  {z.istPlatzhalter ? (
                    <span className="text-xs text-warning">Eintrag noch unbestätigt (O-07)</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-s6 max-w-prose text-xs text-text-muted">
        Ein Kennwort steht hier nie. Gespeichert wird die Anmeldekennung und — wenn nötig — der Name
        eines Geheimnisses im Vault, nicht das Geheimnis selbst (SEC-A5).
      </p>
    </PortalRahmen>
  );
}
