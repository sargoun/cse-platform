import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { ZAHLUNGSMITTEL } from '@/server/services/finanz/zahlungsmittel';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/finanzen/rechnungen/neu` — der Entwurf entsteht.
 *
 * **Nichts wird geraten.** Kein vorausgefülltes Zahlungsziel (§4.2, O-66):
 * ein `14`, das hier voreingestellt wäre, setzte `faellig_am` auf jeder
 * Rechnung und triebe damit den Mahnlauf und die §288-BGB-Zinsen — ein
 * Produktionswert, den niemand entschieden hat. Bleibt das Feld leer, löst
 * der Dienst auf; findet er nichts, weist die Festschreibung mit benanntem
 * Grund ab.
 *
 * Der Entwurf bekommt hier auch KEINE Nummer. Die entsteht erst beim
 * Festschreiben, und genau deshalb kostet ein verworfener Entwurf keine.
 */
export const dynamic = 'force-dynamic';

interface Auswahl { readonly id: string; readonly name: string }
interface ObjektAuswahl extends Auswahl { readonly kunde_id: string | null }
interface Kreis { readonly bezeichnung: string; readonly ist_platzhalter: boolean;
  readonly format_maske: string }

export default async function NeueRechnung(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/rechnungen/neu`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      kunden: await kontext.abfrage<Auswahl>(
        `select id, name from kunde where archiviert_am is null order by name`),
      objekte: await kontext.abfrage<ObjektAuswahl>(
        `select id, bezeichnung as name, kunde_id from objekt
          where archiviert_am is null order by bezeichnung`),
      kreis: (await kontext.abfrage<Kreis>(
        `select bezeichnung, ist_platzhalter, format_maske from nummernkreis
          where mandant_id = app.aktiver_mandant() and kreis_typ = 'ausgangsrechnung'
            and geschlossen_am is null`))[0] ?? null,
    }))) as Promise<{
      kunden: readonly Auswahl[]; objekte: readonly ObjektAuswahl[]; kreis: Kreis | null;
    }>);

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel="Neue Rechnung"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/finanzen/rechnungen`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Alle Rechnungen
        </Link>
      </nav>
      <h1 className="mb-s5 text-h1 text-text">Neue Rechnung</h1>

      {/*
        * Der Zustand des Nummernkreises steht VOR dem Formular und nicht nach
        * dem Fehlschlag: wer einen Entwurf baut, den er anschliessend nicht
        * festschreiben kann, hat die Arbeit umsonst gemacht.
        */}
      {daten.kreis === null ? (
        <p className="mb-s5 rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          Diese Gesellschaft hat keinen offenen Rechnungsnummernkreis. Ein
          Entwurf lässt sich anlegen, festschreiben aber nicht — die Nummer
          käme aus keinem Kreis (O-01, O-134).
        </p>
      ) : daten.kreis.ist_platzhalter ? (
        <p className="mb-s5 rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          Unbestätigter Wert: der Kreis „{daten.kreis.bezeichnung}" führt die
          Maske <code>{daten.kreis.format_maske}</code> als Platzhalter. Bis
          jemand sie bestätigt, wird keine Nummer daraus vergeben (O-134).
        </p>
      ) : null}

      {daten.kunden.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Ohne Kunden keine Rechnung. Zuerst einen Kunden anlegen.
        </p>
      ) : (
        <form
          method="post"
          action={`/api/rechnungen?mandant=${mandant}`}
          className="max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="aktion" value="anlegen" />

          <label className="block text-sm text-text" htmlFor="kundeId">Kunde</label>
          <select id="kundeId" name="kundeId" required className={feld}>
            {daten.kunden.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>

          <label className="mt-s4 block text-sm text-text" htmlFor="objektId">
            Leistungsort (Objekt)
          </label>
          <select id="objektId" name="objektId" className={feld}>
            <option value="">— ohne festen Ort —</option>
            {daten.objekte.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>

          <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-text" htmlFor="leistungVon">
                Leistung von
              </label>
              <input id="leistungVon" name="leistungVon" type="date" className={feld} />
            </div>
            <div>
              <label className="block text-sm text-text" htmlFor="leistungBis">
                Leistung bis
              </label>
              <input id="leistungBis" name="leistungBis" type="date" className={feld} />
            </div>
          </div>

          <label className="mt-s4 block text-sm text-text" htmlFor="zahlungszielTage">
            Zahlungsziel (Tage)
          </label>
          <input
            id="zahlungszielTage" name="zahlungszielTage" type="number" min="0" step="1"
            className={feld}
          />
          <p className="mt-s1 text-xs text-text-muted">
            Leer lassen: dann wird die Kundenkondition oder die Einstellung der
            Gesellschaft genommen. Es gibt keinen Vorgabewert (O-66).
          </p>

          {/*
            * BT-81 (FIN-11) — und ohne dieses Feld war die XRechnung für einen
            * öffentlichen Auftraggeber gar nicht erreichbar: die Vorprüfung
            * verlangt die Angabe (BR-DE-1), und es gab keine Maske, die sie
            * setzt. Gefunden hat das der erste Browsertest, der einen Beleg an
            * das Bezirksamt führen wollte.
            *
            * Kein Vorgabewert, aus demselben Grund wie beim Zahlungsziel: ein
            * stilles „SEPA-Überweisung" behauptete eine Zahlungsart, die
            * niemand vereinbart hat — und sie stünde unveränderlich im Beleg.
            */}
          <label className="mt-s4 block text-sm text-text" htmlFor="zahlungsmittelCode">
            Zahlungsart
          </label>
          <select id="zahlungsmittelCode" name="zahlungsmittelCode" className={feld}>
            <option value="">— nicht angegeben —</option>
            {ZAHLUNGSMITTEL.map((z) => (
              <option key={z.code} value={z.code}>
                {z.bezeichnung} ({z.code})
              </option>
            ))}
          </select>
          <p className="mt-s1 text-xs text-text-muted">
            UNTDID 4461. Für einen Kunden mit XRechnungspflicht ist die Angabe
            verpflichtend (BR-DE-1); ohne sie lässt sich der Beleg nicht
            festschreiben.
          </p>

          <label className="mt-s4 block text-sm text-text" htmlFor="kopftext">
            Kopftext
          </label>
          <textarea id="kopftext" name="kopftext" rows={3} className={feld} />

          <button
            type="submit"
            className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
          >
            Entwurf anlegen
          </button>
        </form>
      )}
    </PortalRahmen>
  );
}
