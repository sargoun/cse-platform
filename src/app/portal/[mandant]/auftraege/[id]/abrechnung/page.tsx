import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereMenge } from '@/server/services/finanz/menge';
import {
  alleAbrechnungsarten, istRegistriert, ladeKonfigurationen, type VertragAbrechnung,
} from '@/server/services/finanz/abrechnungsart/index';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/auftraege/[id]/abrechnung` — wie DIESER Auftrag
 * abgerechnet wird (FIN-01, FIN-05, FIN-08).
 *
 * **Die Seite zeigt die GESCHICHTE, nicht nur die geltende Zeile.** Ein
 * Vertrag, der zum 1. Januar von Stundenlohn auf Monatspauschale gewechselt
 * ist, hat zwei — und eine Rechnung aus dem Dezember lässt sich nur mit der
 * Dezemberzeile erklären. Rechnungen sind unveränderlich und kettengebunden
 * (FIN-06, K-12): eine Abrechnungsgrundlage, die sich für einen vergangenen
 * Zeitraum nicht mehr rekonstruieren lässt, ist eine dauerhafte Lücke im
 * Prüfpfad.
 *
 * **Und jede Art trägt die Marke „provisorisch"** (O-04). Fehlt ein
 * Parameter, steht das an der Zeile — nicht erst in der Fehlermeldung des
 * Abrechnungslaufs, wenn jemand schon eine Rechnung erwartet.
 */
export const dynamic = 'force-dynamic';

interface Kopf {
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly kunde: string;
}

interface Leistungszeile {
  readonly id: string;
  readonly bezeichnung: string;
}

/** Was an einer Konfiguration offen ist — aus dem Register, nicht von Hand. */
function offeneParameter(k: VertragAbrechnung): readonly string[] {
  if (!istRegistriert(k.abrechnungsart)) return [];
  const art = alleAbrechnungsarten().find((a) => a.schluessel === k.abrechnungsart);
  return (art?.offeneParameter ?? [])
    .filter((p) => k.parameter[p.schluessel] === undefined)
    .map((p) => p.schluessel);
}

function betragDerArt(k: VertragAbrechnung): string {
  if (k.pauschaleNettoCent !== null) {
    return `${formatiereGeld(k.pauschaleNettoCent)} je Monat`;
  }
  if (k.stundensatzCent !== null) return `${formatiereGeld(k.stundensatzCent)} je Stunde`;
  if (k.festpreisNettoCent !== null) return `${formatiereGeld(k.festpreisNettoCent)} pauschal`;
  return '—';
}

export default async function AuftragAbrechnung(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/auftraege/${id}/abrechnung`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      kopf: (await kontext.abfrage<Kopf>(
        `select a.auftragsnummer, a.bezeichnung, k.name as kunde
           from auftrag a
           join kunde k on k.mandant_id = a.mandant_id and k.id = a.kunde_id
          where a.id = $1`, [id]))[0] ?? null,
      leistungen: await kontext.abfrage<Leistungszeile>(
        `select id, bezeichnung from auftrag_leistung
          where auftrag_id = $1 order by position_nr`, [id]),
      konfigurationen: await ladeKonfigurationen(kontext, id),
    }))) as Promise<{
      kopf: Kopf | null;
      leistungen: readonly Leistungszeile[];
      konfigurationen: readonly VertragAbrechnung[];
    }>);

  // AUT-06: eine fremde Zeile ist nicht da, nicht verboten.
  if (daten.kopf === null) notFound();
  const leistungsName = new Map(daten.leistungen.map((l) => [l.id, l.bezeichnung]));

  return (
    <PortalRahmen
      titel={`Abrechnung · ${daten.kopf.auftragsnummer}`}
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="auftraege"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/auftraege/${id}`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← {daten.kopf.auftragsnummer} · {daten.kopf.bezeichnung}
        </Link>
      </nav>
      <h1 className="mb-s2 text-h1 text-text">Abrechnung</h1>
      <p className="mb-s5 text-sm text-text-muted">{daten.kopf.kunde}</p>

      {daten.konfigurationen.length === 0 ? (
        <p className="max-w-prose rounded-lg border border-warning bg-warning-soft p-s5 text-sm text-warning">
          Für diesen Auftrag ist keine Abrechnungsart hinterlegt. Er lässt sich
          deshalb nicht berechnen — es gibt keinen Vorgabewert, und eine
          geratene Abrechnungsart wäre eine Rechnung nach einer Regel, die im
          Vertrag nicht steht.{' '}
          <Link
            href={`/portal/${mandant}/einstellungen/abrechnungsarten`}
            className="underline underline-offset-2"
          >
            Die fünf Abrechnungsarten
          </Link>
        </p>
      ) : (
        <ul className="space-y-s4">
          {daten.konfigurationen.map((k) => {
            const offen = offeneParameter(k);
            return (
              <li key={k.id} className="rounded-lg border border-line bg-surface p-s5">
                <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s2">
                  <h2 className="text-h3 text-text">
                    {alleAbrechnungsarten().find((a) => a.schluessel === k.abrechnungsart)
                      ?.bezeichnung ?? k.abrechnungsart}
                  </h2>
                  <span className="flex items-center gap-s2">
                    <StatusPill zustand="Entwurf" />
                    <span className="text-xs text-warning">provisorisch (O-04)</span>
                  </span>
                </div>

                <dl className="grid grid-cols-1 gap-s3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-text-subtle">Gilt</dt>
                    <dd className="text-sm text-text">
                      ab {k.gueltigAb}
                      {k.gueltigBis === null ? ' (offen)' : ` bis einschließlich ${k.gueltigBis}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-subtle">Geltungsbereich</dt>
                    <dd className="text-sm text-text">
                      {k.auftragLeistungId === null
                        ? 'ganzer Auftrag'
                        : leistungsName.get(k.auftragLeistungId) ?? k.auftragLeistungId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-subtle">Satz</dt>
                    <dd className="text-sm text-text">{betragDerArt(k)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-subtle">Rhythmus</dt>
                    <dd className="text-sm text-text">
                      {k.abrechnungsintervall} · Leistungszeitraum: {k.leistungszeitraumModus}
                    </dd>
                  </div>
                  {k.mindestabnahmeStunden === null ? null : (
                    <div>
                      <dt className="text-xs text-text-subtle">Mindestabnahme</dt>
                      <dd className="text-sm text-text">
                        {formatiereMenge(k.mindestabnahmeStunden)} Std.
                      </dd>
                    </div>
                  )}
                </dl>

                {offen.length === 0 ? null : (
                  <p className="mt-s4 rounded-md border border-warning bg-warning-soft p-s3 text-sm text-warning">
                    Unbestätigter Wert: <code>{offen.join(', ')}</code> ist im
                    Vertrag nicht hinterlegt. Bis dahin weist die Abrechnung
                    dieses Auftrags mit benanntem Grund ab (O-04).
                  </p>
                )}

                {!istRegistriert(k.abrechnungsart) ? (
                  <p className="mt-s4 rounded-md border border-danger bg-danger-soft p-s3 text-sm text-danger">
                    Für <code>{k.abrechnungsart}</code> ist keine Umsetzung
                    registriert. Der Auftrag lässt sich nicht berechnen.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Eine Abrechnungsart wird nicht überschrieben, sondern durch eine neue
        Zeile abgelöst — deshalb steht hier die vollständige Reihe. So bleibt
        erklärbar, nach welcher Regel eine bereits festgeschriebene Rechnung
        entstanden ist.
      </p>
    </PortalRahmen>
  );
}
