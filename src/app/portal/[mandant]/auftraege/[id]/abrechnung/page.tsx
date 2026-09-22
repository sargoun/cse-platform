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
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';

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
 *
 * // TODO(client, O-04): sind dies exakt die fünf Abrechnungsarten?
 * Bezeichnung, Rundung und Satzbasis je Art bestätigen.
 */
export const dynamic = 'force-dynamic';

const FELD = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
  + 'p-s3 text-sm text-text';

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
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/auftraege/${id}/abrechnung`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  const darf = await haeltRechte(sitzung, 'auftrag.lesen');
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
      {...(darf['auftrag.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/auftraege/${id}`, text: `${daten.kopf.auftragsnummer} · ${daten.kopf.bezeichnung}` } }
        : {})}
    >
      {/*
        * Der Auftrag dahinter öffnet mit `auftrag.lesen` (Manifest); diese
        * Seite mit dem Abrechnungsrecht. Ohne das erste führte der Weg zurück
        * auf 404 und verriet damit, was er nicht zeigen darf (AUT-06, D-581).
        * Nummer und Bezeichnung stehen in der Überschrift darunter ohnehin.
        */}
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

      {/*
        * Das Formular ist der Weg, auf dem O-04 beantwortet wird: die offenen
        * Regeln stehen als Parameter am VERTRAG, weil sie je Vertrag
        * verhandelt werden. Kein Feld ist vorbelegt — weder die Art noch der
        * Rhythmus noch der Leistungszeitraum (0086).
        */}
      <form
        method="post"
        action={`/api/abrechnung?mandant=${mandant}`}
        className="mt-s5 max-w-prose rounded-lg border border-line bg-surface p-s5"
      >
        <h2 className="mb-s4 text-h3 text-text">Abrechnungsart festlegen</h2>
        <input type="hidden" name="aktion" value="anlegen" />
        <input type="hidden" name="auftragId" value={id} />

        <label className="block text-sm text-text" htmlFor="abrechnungsart">Art</label>
        <select id="abrechnungsart" name="abrechnungsart" required className={FELD}>
          <option value="">— bitte wählen —</option>
          {alleAbrechnungsarten().map((a) => (
            <option key={a.schluessel} value={a.schluessel}>
              {a.bezeichnung} (provisorisch)
            </option>
          ))}
        </select>

        <label className="mt-s4 block text-sm text-text" htmlFor="auftragLeistungId">
          Geltungsbereich
        </label>
        <select id="auftragLeistungId" name="auftragLeistungId" className={FELD}>
          <option value="">ganzer Auftrag</option>
          {daten.leistungen.map((l) => (
            <option key={l.id} value={l.id}>{l.bezeichnung}</option>
          ))}
        </select>

        <label className="mt-s4 block text-sm text-text" htmlFor="parameter">
          Parameter
        </label>
        <textarea
          id="parameter" name="parameter" rows={3} className={FELD}
          placeholder={'minuten_rundung=15\nteilmonat=kalendertage'}
        />
        <p className="mt-s1 text-xs text-text-muted">
          Eine Zeile je Regel, <code>schluessel=wert</code>. Welche Regeln die
          gewählte Art verlangt, steht unter{' '}
          <Link
            href={`/portal/${mandant}/einstellungen/abrechnungsarten`}
            className="underline underline-offset-2"
          >
            Abrechnungsarten
          </Link>
          . Fehlt eine, wird nichts gespeichert — und nichts geraten (O-04).
        </p>

        <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-3">
          <div>
            <label className="block text-sm text-text" htmlFor="pauschaleNettoCent">
              Monatspauschale (Cent)
            </label>
            <input
              id="pauschaleNettoCent" name="pauschaleNettoCent" type="number"
              min="0" step="1" className={FELD}
            />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="stundensatzCent">
              Stundensatz (Cent)
            </label>
            <input
              id="stundensatzCent" name="stundensatzCent" type="number"
              min="0" step="1" className={FELD}
            />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="festpreisNettoCent">
              Festpreis (Cent)
            </label>
            <input
              id="festpreisNettoCent" name="festpreisNettoCent" type="number"
              min="0" step="1" className={FELD}
            />
          </div>
        </div>
        <p className="mt-s1 text-xs text-text-muted">
          Beträge in GANZEN Cent — 1.890,00 € sind <code>189000</code>. Die
          Oberfläche rechnet nichts um: eine Gleitkommazahl wäre ein Bruchteil
          eines Cents, der später niemandem mehr auffällt (Invariante 1).
        </p>

        <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
          <div>
            <label className="block text-sm text-text" htmlFor="abrechnungsintervall">
              Rhythmus
            </label>
            <select
              id="abrechnungsintervall" name="abrechnungsintervall" required className={FELD}
            >
              <option value="">— bitte wählen —</option>
              {['einmalig', 'monatlich', 'quartalsweise', 'halbjaehrlich', 'jaehrlich',
                'nach_leistung'].map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="leistungszeitraumModus">
              Leistungszeitraum
            </label>
            <select
              id="leistungszeitraumModus" name="leistungszeitraumModus" required
              className={FELD}
            >
              <option value="">— bitte wählen —</option>
              {['kalendermonat', 'nach_leistungsnachweis', 'manuell'].map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
          <div>
            <label className="block text-sm text-text" htmlFor="gueltigAb">Gilt ab</label>
            <input id="gueltigAb" name="gueltigAb" type="date" required className={FELD} />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="gueltigBis">
              Gilt bis (einschließlich)
            </label>
            <input id="gueltigBis" name="gueltigBis" type="date" className={FELD} />
          </div>
        </div>

        <button
          type="submit"
          className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
        >
          Abrechnungsart eintragen
        </button>
      </form>
    </PortalRahmen>
  );
}
