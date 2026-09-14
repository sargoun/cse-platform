import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { ART_TEXT, WACHBUCH_ARTEN } from '@/server/services/security/wachbuch';

/**
 * `/portal/[mandant]/security/wachbuch/neu` — eine Seite schreiben
 * (SEC-05, TIM-08).
 *
 * **Kein Zeitfeld.** Wann der Eintrag entstanden ist, entscheidet die
 * SERVERUHR (Invariante 5, TIM-08) — ein Formularfeld dafür wäre die
 * Einladung, es anders auszufüllen, und der Auslöser überschriebe es ohnehin.
 * Die Geräteuhr wandert als verstecktes Feld mit, damit ihre Abweichung
 * gespeichert werden kann; massgeblich ist sie nie.
 *
 * **Die Kontrollpunkte werden je Objekt geladen und trotzdem nur als Liste
 * gezeigt.** Ohne Skript lässt sich die Auswahl nicht abhängig machen; der
 * Grosselternschlüssel in der Datenbank weist einen Punkt eines fremden
 * Objekts ab (§1.4), also kann hier höchstens eine Eingabe scheitern — nie
 * eine falsche Zeile entstehen.
 */
export const dynamic = 'force-dynamic';

interface Objektzeile { readonly id: string; readonly bezeichnung: string }
interface Punktzeile {
  readonly id: string; readonly bezeichnung: string; readonly objekt: string;
}

export default async function WachbuchNeu(
  {
    params, searchParams,
  }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const pfad = `/portal/${mandant}/security/wachbuch/neu`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const vorbelegt = typeof suche['objekt'] === 'string' ? suche['objekt'] : null;

  const { objekte, punkte } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => ({
        objekte: await kontext.abfrage<Objektzeile>(
          `select id, bezeichnung from objekt
            where archiviert_am is null order by bezeichnung`,
        ),
        punkte: await kontext.abfrage<Punktzeile>(
          `select k.id, k.bezeichnung, o.bezeichnung as objekt
             from kontrollpunkt k
             join objekt o on o.id = k.objekt_id and o.mandant_id = k.mandant_id
            where k.archiviert_am is null
            order by o.bezeichnung, k.reihenfolge, k.bezeichnung`,
        ),
      }))) as Promise<{
        objekte: readonly Objektzeile[]; punkte: readonly Punktzeile[];
      }>);

  const feld = 'mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted';
  const eingabe = 'min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Wachbucheintrag"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 text-h1 text-text">Wachbucheintrag</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Der Zeitpunkt kommt vom Server und lässt sich nicht eintragen. Der
        Eintrag ist danach unveränderlich — eine Korrektur ist ein neuer
        Eintrag, der auf diesen verweist.
      </p>

      {objekte.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          In dieser Gesellschaft ist noch kein Objekt angelegt. Ein
          Wachbucheintrag gehört immer zu einem Objekt.
        </p>
      ) : (
        <form
          action="/api/sicherheit/wachbuch"
          method="post"
          className="max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="mandant" value={mandant} />
          <input
            type="hidden"
            name="zurueck"
            value={`/portal/${mandant}/security/wachbuch`}
          />

          <label className="mb-s4 block">
            <span className={feld}>Objekt</span>
            <select
              name="objekt"
              required
              className={eingabe}
              defaultValue={vorbelegt ?? undefined}
            >
              {objekte.map((o) => (
                <option key={o.id} value={o.id}>{o.bezeichnung}</option>
              ))}
            </select>
          </label>

          <fieldset className="mb-s4 border-0 p-0">
            <legend className={feld}>Art</legend>
            <div className="flex flex-wrap gap-s3">
              {WACHBUCH_ARTEN.map((a) => (
                <label key={a} className="flex items-center gap-s2 text-sm text-text">
                  <input
                    type="radio"
                    name="art"
                    value={a}
                    required
                    defaultChecked={a === 'rundgang'}
                    /**
                     * `schluessel` steht in der Liste, weil SEC-05 sie nennt —
                     * und ist gesperrt, weil die Schlüsselverwaltung erst mit
                     * PR 42 kommt. Sie stillschweigend wegzulassen hiesse, eine
                     * der fünf Arten verschwinden zu lassen; sie anzubieten
                     * hiesse, den Dienst in eine Bedingungsverletzung laufen zu
                     * lassen.
                     */
                    disabled={a === 'schluessel'}
                    className="min-h-6 min-w-6"
                  />
                  <span className={a === 'schluessel' ? 'text-text-subtle' : undefined}>
                    {ART_TEXT[a]}
                    {a === 'schluessel' && ' (mit PR 42)'}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mb-s4 block">
            <span className={feld}>Betreff</span>
            <input name="betreff" required maxLength={120} className={eingabe}
              placeholder="Rundgang 02:00, Nebeneingang" />
          </label>

          <label className="mb-s4 block">
            <span className={feld}>Was ist passiert?</span>
            <textarea
              name="eintragstext"
              required
              rows={6}
              className="w-full rounded-md border border-line bg-surface-3 px-s3 py-s2
                         text-sm text-text"
              placeholder="Sachlich, vollständig, in ganzen Sätzen."
            />
          </label>

          {punkte.length > 0 && (
            <label className="mb-s4 block">
              <span className={feld}>Kontrollpunkt (bei einem Rundgang)</span>
              <select name="kontrollpunkt" className={eingabe}>
                <option value="">— keiner —</option>
                {punkte.map((k) => (
                  <option key={k.id} value={k.id}>{k.objekt} · {k.bezeichnung}</option>
                ))}
              </select>
            </label>
          )}

          <label className="mb-s5 flex items-center gap-s2 text-sm text-text">
            <input type="checkbox" name="polizei" value="1" className="min-h-6 min-w-6" />
            Polizei informiert
          </label>

          <Button type="submit" variante="primary">Eintrag schreiben</Button>
        </form>
      )}
    </PortalRahmen>
  );
}
