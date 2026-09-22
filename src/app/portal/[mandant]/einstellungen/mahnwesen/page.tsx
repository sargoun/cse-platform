import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { mahnstufen } from '@/server/services/finanz/mahnung/stufen';
import { AUFSCHLAG_B2B_BP, AUFSCHLAG_B2C_BP }
  from '@/server/services/finanz/mahnung/stufen.platzhalter';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/einstellungen/mahnwesen` — der Ort, an dem O-19
 * beantwortet wird (FIN-15).
 *
 * **Solange eine Stufe „unbestätigt" trägt, mahnt der Lauf nicht.** Das ist
 * keine Sperre, die jemand vergessen hat, sondern die Antwort auf eine
 * Geschäftsregel, die niemand getroffen hat: Frist, Gebühr und Zinsart je
 * Stufe sind eine Entscheidung der Gesellschaft. Diese Seite nimmt sie
 * entgegen — und bis dahin sagt sie, was fehlt.
 *
 * **Eine bestätigte Fassung löst die vorherige ab, sie überschreibt sie
 * nicht.** Eine versendete Mahnung beruft sich auf die Stufe, wie sie GALT;
 * ohne die alte Fassung liesse sich ein geforderter Betrag nicht mehr
 * herleiten (Invariante 8).
 *
 * // TODO(client, O-19): Mahnstufen — Fristen, Gebühren je Stufe, Zinsart und
 * ab welcher Stufe eine Folgeaktion vorgesehen ist.
 */
export const dynamic = 'force-dynamic';

export default async function Mahnwesen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const { hinweis } = await searchParams;
  const zugang = await portalZugang(`/portal/${mandant}/einstellungen/mahnwesen`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /**
   * Die Stufen UND der früheste Tag, an dem eine neue Fassung beginnen kann.
   *
   * Er kommt aus der Datenbank, nicht aus `new Date()`: die Uhr des
   * Node-Prozesses liest UTC und böte am 31.12. um 23:30 Berliner Zeit den
   * falschen Tag an (K-11, Invariante 2).
   */
  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      stufen: await mahnstufen(kontext),
      tage: await kontext.abfrage<{ heute: string; morgen: string }>(
        `select app.berlin_heute()::text as heute,
                (app.berlin_heute() + 1)::text as morgen`),
    }))) as Promise<{
      stufen: Awaited<ReturnType<typeof mahnstufen>>;
      tage: readonly { heute: string; morgen: string }[];
    }>);
  const stufen = daten.stufen;
  const heute = daten.tage[0]?.heute ?? '';
  const morgen = daten.tage[0]?.morgen ?? '';

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const laufend = stufen.filter((s) => s.gueltigBis === null);
  const offen = laufend.filter((s) => s.istPlatzhalter).length;

  return (
    <PortalRahmen
      titel="Mahnwesen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Mahnwesen</h1>

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p
          data-cse="stufen-hinweis"
          className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text"
        >
          {hinweis}
        </p>
      ) : null}

      <p
        data-cse="stufen-offen"
        data-offen={String(offen)}
        className="mb-s7 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
      >
        {offen === 0
          ? 'Alle laufenden Stufen sind bestätigt. Der nächtliche Lauf schlägt danach '
            + 'Mahnungen vor — versendet wird weiterhin nichts ohne Freigabe.'
          : `${String(offen)} laufende Stufe(n) sind unbestätigt (O-19). Solange das so `
            + 'ist, erzeugt der Mahnlauf für sie keinen Vorschlag und nennt den Grund. '
            + 'Frist, Gebühr und Zinsart sind eine Entscheidung der Gesellschaft — sie '
            + 'werden hier eingetragen, nicht geraten.'}
      </p>

      <section aria-labelledby="stufen-titel" className="mb-s7">
        <h2 id="stufen-titel" className="mb-s3 text-h2 text-text">Stufen</h2>
        {stufen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Es ist keine Stufe hinterlegt.
          </p>
        ) : (
          <DataTable
            beschriftung="Mahnstufen mit Frist, Gebühr, Zinsart, Gültigkeit und Zustand"
            zeilen={[...stufen]}
            schluessel={(s) => s.id}
            spalten={[
              { schluessel: 'stufe', kopf: 'Stufe', zelle: (s) => String(s.stufe) },
              { schluessel: 'bez', kopf: 'Bezeichnung', zelle: (s) => s.bezeichnung },
              {
                schluessel: 'frist', kopf: 'Ab Tag', numerisch: true,
                zelle: (s) => String(s.tageNachFaelligkeit),
              },
              {
                schluessel: 'gebuehr', kopf: 'Gebühr', numerisch: true,
                zelle: (s) => formatiereGeld(s.gebuehrCent),
              },
              {
                schluessel: 'zins', kopf: 'Zins',
                zelle: (s) => (s.zinsberechnung === 'keine' ? '—' : s.zinsberechnung),
              },
              {
                schluessel: 'gueltig', kopf: 'Gültig',
                zelle: (s) => `${s.gueltigAb} – ${s.gueltigBis ?? 'offen'}`,
              },
              {
                schluessel: 'zustand', kopf: 'Zustand',
                zelle: (s) => (
                  s.gueltigBis !== null
                    ? <StatusPill zustand="Archiviert" />
                    : s.istPlatzhalter
                      ? <StatusPill zustand="Entwurf" />
                      : <StatusPill zustand="Aktiv" />
                ),
              },
            ]}
          />
        )}
      </section>

      <section
        aria-labelledby="bestaetigen-titel"
        className="max-w-prose rounded-lg border border-line bg-surface p-s5"
      >
        <h2 id="bestaetigen-titel" className="text-h2 text-text">Stufe bestätigen</h2>
        <p className="mt-s2 text-xs text-text-muted">
          Die neue Fassung gilt ab dem angegebenen Tag; die bisherige endet am
          Tag davor und bleibt lesbar.
        </p>
        <form method="post" action={`/api/einstellungen/mahnwesen?mandant=${mandant}`}>
          <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-text" htmlFor="stufe">Stufe</label>
              <input
                id="stufe" name="stufe" type="number" min={1} step={1} required
                className={feld} defaultValue={1}
              />
            </div>
            <div>
              <label className="block text-sm text-text" htmlFor="tage">
                Greift ab Tag nach Fälligkeit
              </label>
              <input
                id="tage" name="tage" type="number" min={0} step={1} required
                className={feld} defaultValue={14}
              />
            </div>
          </div>

          <label className="mt-s4 block text-sm text-text" htmlFor="bezeichnung">
            Bezeichnung
          </label>
          <input
            id="bezeichnung" name="bezeichnung" type="text" required className={feld}
            placeholder="Zahlungserinnerung"
          />

          <label className="mt-s4 block text-sm text-text" htmlFor="gebuehr">
            Mahngebühr in Euro
          </label>
          <input
            id="gebuehr" name="gebuehr" type="text" inputMode="decimal" required
            className={feld} placeholder="0,00"
          />

          <label className="mt-s4 block text-sm text-text" htmlFor="zinsberechnung">
            Verzugszins
          </label>
          <select id="zinsberechnung" name="zinsberechnung" required className={feld}>
            <option value="keine">kein Verzugszins</option>
            <option value="gesetzlich_b2b">
              gesetzlich, Unternehmen (Basiszins + {String(AUFSCHLAG_B2B_BP / 100)} Punkte)
            </option>
            <option value="gesetzlich_b2c">
              gesetzlich, Verbraucher (Basiszins + {String(AUFSCHLAG_B2C_BP / 100)} Punkte)
            </option>
            <option value="vertraglich">vertraglich vereinbart</option>
          </select>

          <label className="mt-s4 block text-sm text-text" htmlFor="aufschlag">
            Vereinbarter Aufschlag in Basispunkten (nur bei „vertraglich“)
          </label>
          <input
            id="aufschlag" name="aufschlag" type="number" min={0} step={1} className={feld}
          />

          <label className="mt-s4 block text-sm text-text" htmlFor="gueltigAb">
            Gültig ab
          </label>
          <input
            id="gueltigAb" name="gueltigAb" type="date" required className={feld}
            min={heute} defaultValue={morgen}
          />
          <p className="mt-s2 text-xs text-text-muted">
            Vorgeschlagen ist der morgige Tag: solange für diese Stufe eine
            Fassung läuft, beginnt die neue am Tag danach. Rückwirkend ginge
            sie nicht — sie änderte die Grundlage bereits versendeter
            Mahnungen.
          </p>

          <p className="mt-s4 text-xs text-text-muted">
            Der Basiszinssatz nach § 247 BGB wird nicht hier gepflegt: er ist eine
            halbjährliche Bekanntmachung der Deutschen Bundesbank und gilt für
            alle Gesellschaften. Fehlt er, fordert eine Mahnung keinen Zins und
            sagt es (O-358).
          </p>

          <button
            type="submit"
            className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
          >
            Stufe bestätigen
          </button>
        </form>
      </section>
    </PortalRahmen>
  );
}
