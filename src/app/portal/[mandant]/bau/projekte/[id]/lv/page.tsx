import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import {
  baueOzBaum, findeProjekt, flachInOrdnung, istUngeprueftMaschinell, ladeLvPositionen,
  listeVerzeichnisse, lvSummeCent, positionsBetragCent, zaehltInSumme,
  type LvKnoten, type LvKopfZeile, type ProjektZeile, type LvZeile,
} from '@/server/services/bau/lv';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/projekte/[id]/lv` — das Leistungsverzeichnis als
 * OZ-Baum (BAU-01).
 *
 * Zwei Dinge sind hier nicht Kosmetik:
 *
 *  - **Die Reihenfolge.** Sie kommt aus `sortier_pfad`, also aus der
 *    normierten OZ — `1.2.10` steht HINTER `1.2.9`. Eine Textsortierung
 *    kehrte das um, und in einem LV mit vierhundert Zeilen faellt das
 *    niemandem auf.
 *  - **Die Σ je Titel und je Los.** Sie ist die Summe der gerundeten
 *    Positionsbetraege, nicht eine zweite Rundung auf der Ebene. Nur so
 *    stimmt sie auf den Cent mit der Gesamtsumme ueberein.
 *
 * **Preise koennen fehlen, und das steht dann da.** `einheitspreis_cent` ist
 * spaltenweise verriegelt (K-05): wer `bau.preis_lesen` nicht haelt, sieht
 * die Mengen und keine Betraege. Eine Summe, die das verschweigt, behauptete
 * einen Auftragswert von 0 €.
 */
export const dynamic = 'force-dynamic';

const ART_KLASSE: Readonly<Record<string, string>> = {
  los: 'text-h3 text-text',
  titel: 'text-base font-semibold text-text',
  untertitel: 'text-sm font-semibold text-text',
  position: 'text-sm text-text',
  hinweistext: 'text-sm italic text-text-muted',
};

export default async function LeistungsverzeichnisSeite(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<{ lv?: string }>;
  },
) {
  const { mandant, id } = await params;
  const { lv: gewaehlt } = await searchParams;
  const pfad = `/portal/${mandant}/bau/projekte/${id}/lv`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const projekt = await findeProjekt(kontext, id);
      if (projekt === null) return null;
      const verzeichnisse = await listeVerzeichnisse(kontext, id);
      const aktuell = verzeichnisse.find((v) => v.id === gewaehlt) ?? verzeichnisse[0] ?? null;
      const positionen = aktuell === null
        ? ([] as readonly LvZeile[])
        : await ladeLvPositionen(kontext, aktuell.id);
      return { projekt, verzeichnisse, aktuell, positionen };
    }),
  ) as Promise<{
    projekt: ProjektZeile; verzeichnisse: readonly LvKopfZeile[];
    aktuell: LvKopfZeile | null; positionen: readonly LvZeile[];
  } | null>);

  // AUT-06: ein fremdes Projekt ist nicht vorhanden, nicht verboten.
  if (daten === null) notFound();

  const baum = baueOzBaum(daten.positionen);
  const flach = flachInOrdnung(baum);
  const gesamt = lvSummeCent(baum);
  const unvollstaendig = baum.some((k) => k.unvollstaendig);
  const ausgenommen = baum.reduce((s, k) => s + k.ausgenommen, 0);

  return (
    <PortalRahmen
      titel="Leistungsverzeichnis"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div>
          <h1 className="m-0 text-h1 text-text">Leistungsverzeichnis</h1>
          <p className="m-0 mt-s1 text-sm text-text-muted">
            {daten.projekt.nummer} · {daten.projekt.bezeichnung} · {daten.projekt.kunde}
          </p>
        </div>
        <Link
          href={`/portal/${mandant}/bau/projekte/${id}/aufmass`}
          className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-line-strong hover:text-text"
        >
          Zu den Aufmaßen
        </Link>
      </div>

      {daten.verzeichnisse.length > 1 && (
        /**
         * Die Fassungswahl ist ein Formular und kein Link mit Abfrageteil.
         *
         * Nicht aus Geschmack: `typedRoutes` prueft `href` gegen die bekannten
         * Routenmuster, und ein zusammengesetzter Abfrageteil ist fuer den
         * Typ kein bekanntes Muster. Ein `<a>` mit ungepruefter Adresse waere
         * die Abkuerzung — und genau damit faengt eine Verweisruine an. Das
         * Formular funktioniert ausserdem ohne JavaScript.
         */
        <form method="get" className="mb-s4 flex flex-wrap items-end gap-s3">
          <label>
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Fassung
            </span>
            <select
              name="lv"
              defaultValue={daten.aktuell?.id ?? ''}
              className="min-h-11 rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            >
              {daten.verzeichnisse.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.bezeichnung} · Fassung {v.fassung} · {v.positionen} Positionen
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variante="secondary">Anzeigen</Button>
        </form>
      )}

      {daten.aktuell === null ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Zu diesem Projekt gibt es noch kein Leistungsverzeichnis.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full border-collapse text-sm" data-cse="lv-baum">
              <caption className="sr-only">
                Leistungsverzeichnis {daten.aktuell.bezeichnung}, in OZ-Ordnung
              </caption>
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="px-s4 py-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">OZ</th>
                  <th scope="col" className="px-s4 py-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">Bezeichnung</th>
                  <th scope="col" className="px-s4 py-s3 text-right text-micro uppercase tracking-[0.08em] text-text-subtle">Menge</th>
                  <th scope="col" className="px-s4 py-s3 text-right text-micro uppercase tracking-[0.08em] text-text-subtle">Einheitspreis</th>
                  <th scope="col" className="px-s4 py-s3 text-right text-micro uppercase tracking-[0.08em] text-text-subtle">Betrag / Σ</th>
                </tr>
              </thead>
              <tbody>
                {flach.map((knoten) => (
                  <Zeile key={knoten.zeile.id} knoten={knoten} />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong">
                  <td className="px-s4 py-s3" />
                  <td className="px-s4 py-s3 text-base font-semibold text-text">
                    Gesamtsumme (netto)
                  </td>
                  <td className="px-s4 py-s3" />
                  <td className="px-s4 py-s3" />
                  <td className="px-s4 py-s3 text-right text-base font-semibold tabular-nums text-text"
                      data-cse="lv-summe">
                    {unvollstaendig ? '—' : formatiereGeld(gesamt)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {unvollstaendig && (
            <p className="mt-s3 text-sm text-warning">
              Für mindestens eine Position ist kein Einheitspreis lesbar. Die
              Summe bleibt deshalb offen — sie wäre sonst zu niedrig, ohne dass
              man es ihr ansieht (Recht <code>bau.preis_lesen</code>).
            </p>
          )}
          {ausgenommen > 0 && (
            <p className="mt-s3 text-sm text-text-muted">
              {ausgenommen} Bedarfs- oder Alternativposition(en) sind in der Summe
              nicht enthalten — sie sind angeboten, nicht beauftragt (offene
              Frage O-155).
            </p>
          )}
        </>
      )}
    </PortalRahmen>
  );
}

/**
 * Eine Zeile des Baums. Die Einrueckung folgt `ebene`, die Σ steht bei Los,
 * Titel und Untertitel — bei einer Position steht ihr eigener Betrag.
 */
function Zeile({ knoten }: { readonly knoten: LvKnoten }) {
  const z = knoten.zeile;
  const istPosition = z.art === 'position';
  const betrag = istPosition && zaehltInSumme(z)
    ? positionsBetragCent(z.mengeVertrag, z.einheitspreisCent)
    : knoten.summeCent;

  return (
    <tr
      className="border-b border-line last:border-0"
      data-cse="lv-zeile"
      data-oz={z.oz}
      data-art={z.art}
    >
      <td className="px-s4 py-s3 align-top tabular-nums text-text-muted">{z.oz}</td>
      <td className="px-s4 py-s3 align-top" style={{ paddingLeft: `${String(z.ebene * 12)}px` }}>
        <span className={ART_KLASSE[z.art] ?? 'text-sm text-text'}>{z.kurztext}</span>
        {istUngeprueftMaschinell(z) && (
          <span className="ml-s2 align-middle">
            {/* APR-03: maschinell gelesen, von niemandem bestaetigt. */}
            <StatusPill zustand="In Prüfung" />
          </span>
        )}
        {istPosition && !zaehltInSumme(z) && (
          <span className="ml-s2 text-xs text-warning">nicht in der Summe (O-155)</span>
        )}
      </td>
      <td className="px-s4 py-s3 text-right align-top tabular-nums text-text-muted">
        {z.mengeVertrag === null
          ? ''
          : `${formatiereMenge(mengeAusPostgresOderNull(z.mengeVertrag))} ${z.einheit ?? ''}`}
      </td>
      <td className="px-s4 py-s3 text-right align-top tabular-nums text-text-muted">
        {z.einheitspreisCent === null ? '' : formatiereGeld(cent(z.einheitspreisCent))}
      </td>
      <td
        className="px-s4 py-s3 text-right align-top tabular-nums text-text"
        data-cse={istPosition ? 'lv-betrag' : 'lv-teilsumme'}
      >
        {knoten.unvollstaendig && !istPosition
          ? '—'
          : betrag === null ? '' : formatiereGeld(betrag)}
      </td>
    </tr>
  );
}
