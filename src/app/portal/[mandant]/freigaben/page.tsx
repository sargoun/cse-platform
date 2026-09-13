import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { ladePosteingang, type PosteingangEintrag } from '@/server/services/freigabe/laden';
import { AnmeldungNoetig } from '../../Anmeldung';
import { portalZugang } from '../../zugang';
import { slugTor } from '../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { RISIKO_LABEL, VORGANG_LABEL, zeitpunkt } from './darstellung';

/**
 * `/portal/[mandant]/freigaben` — der eine Posteingang (APR-01,
 * `04-SEITENKARTE.md` §5.20, D-472).
 *
 * **Die Ordnung kommt nicht aus dieser Datei.** `sortierePosteingang` ordnet
 * nach Frist, Risiko, Betrag und Alter; die Seite zeigt die Spalte, die
 * diese Ordnung erklärt, und sonst nichts. Wer die Reihenfolge ändern will,
 * ändert den Dienst und seinen Test — nicht ein `order by` in einem
 * Bildschirm.
 *
 * **Nur, was wartet und vorzeigbar ist** (`status = 'offen'`, `vorgang_typ`
 * gesetzt, D-468). Eine Freigabe, die ein Dienst in einem Schritt erteilt
 * hat, ist die Aufzeichnung einer Entscheidung und gehört nicht hierher.
 */
export const dynamic = 'force-dynamic';

export default async function Freigaben(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/freigaben`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const jetzt = new Date();
  const eintraege = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) =>
      ladePosteingang(kontext, jetzt)))) as readonly PosteingangEintrag[];

  const unsicher = eintraege.filter((e) => e.unsichereFelder > 0).length;

  return (
    <PortalRahmen
      titel="Freigaben"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="freigaben"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Freigaben</h1>
        <p className="text-sm text-text-muted" data-cse="posteingang-zaehler" data-anzahl={String(eintraege.length)}>
          {eintraege.length === 0
            ? 'Nichts wartet.'
            : `${String(eintraege.length)} warten · ${String(unsicher)} mit unsicheren Feldern`}
        </p>
      </div>

      <p className="mb-s6 max-w-prose text-sm text-text-muted">
        Alles, was das Haus verlässt oder Geld bewegt, wartet hier auf einen
        Menschen (Invariante 7). Sortiert nach Frist, dann Risiko, dann Betrag;
        was gleich dringend ist, steht in der Reihenfolge seines Eintreffens.
      </p>

      {eintraege.length === 0 ? (
        <p
          data-cse="posteingang-leer"
          className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
        >
          Kein Vorschlag wartet auf eine Entscheidung. Neue Vorgänge erscheinen
          hier, sobald ein Agent oder ein Dienst sie vorlegt.
        </p>
      ) : (
        <DataTable
          beschriftung="Wartende Freigaben, sortiert nach Frist und Risiko"
          zeilen={eintraege}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'frist', kopf: 'Frist',
              zelle: (z) => (
                <span className="inline-flex flex-col gap-s1" data-dringlichkeit={String(z.dringlichkeit)}>
                  {z.dringlichkeit === 5
                    ? <StatusPill zustand="Überfällig" />
                    : <span className="text-sm text-text">{z.dringlichkeitText}</span>}
                  <span className="text-xs text-text-subtle">{zeitpunkt(z.frist)}</span>
                </span>
              ),
            },
            {
              schluessel: 'vorgang', kopf: 'Vorgang',
              zelle: (z) => (
                <span className="flex min-w-0 flex-col gap-s1">
                  <Link
                    href={`/portal/${mandant}/freigaben/${z.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.titel}
                  </Link>
                  <span className="text-xs text-text-muted">{z.zusammenfassung}</span>
                </span>
              ),
            },
            {
              schluessel: 'art', kopf: 'Art',
              zelle: (z) => VORGANG_LABEL[z.vorgangTyp],
            },
            {
              schluessel: 'risiko', kopf: 'Risiko',
              zelle: (z) => (
                <span data-risiko={z.risiko} className={z.risiko === 'hoch' ? 'text-warning' : 'text-text'}>
                  {RISIKO_LABEL[z.risiko]}
                </span>
              ),
            },
            {
              schluessel: 'betrag', kopf: 'Betrag', numerisch: true,
              zelle: (z) => (z.betragCent === null
                ? <span className="text-text-subtle">—</span>
                : formatiereGeld(z.betragCent)),
            },
            {
              schluessel: 'pruefung', kopf: 'Prüfung',
              zelle: (z) => (z.unsichereFelder > 0
                ? (
                  <span className="inline-flex items-center gap-s2">
                    <StatusPill zustand="Wartet" />
                    <span className="text-xs text-warning">
                      {String(z.unsichereFelder)} unsicher
                    </span>
                  </span>
                )
                : <span className="text-sm text-text-muted">{z.stapelFaehig ? 'Routine' : 'Einzeln'}</span>),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
