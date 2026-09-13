import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/security/posten/neu` — einen Posten anlegen (SEC-01).
 *
 * **Ein reines Formular, ohne Skript.** Es schickt an
 * `POST /api/sicherheit/posten`; die Prüfungen stehen im Dienst und in der
 * Datenbank. Eine Seite, die selbst prüft, prüft auf dem Gerät des Aufrufers
 * — also nirgends.
 *
 * **Die Postenart wird NICHT vorgeschlagen.** SEC-01 nennt keine, der Katalog
 * wird leer ausgeliefert (O-148), und eine Auswahlliste mit „Objektschutz,
 * Empfang, Streife" sähe aus wie eine Abstimmung, die es nicht gab (K-17).
 * Solange niemand Arten hinterlegt hat, steht hier der Satz statt der Liste.
 */
export const dynamic = 'force-dynamic';

interface Objektzeile { readonly id: string; readonly bezeichnung: string }
interface Artzeile { readonly id: string; readonly bezeichnung: string }

export default async function PostenNeu(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/security/posten/neu`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const heute = await berlinHeute();
  const { objekte, arten } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => ({
        objekte: await kontext.abfrage<Objektzeile>(
          `select id, bezeichnung from objekt
            where archiviert_am is null order by bezeichnung`,
        ),
        arten: await kontext.abfrage<Artzeile>(
          `select id, bezeichnung from postenart
            where archiviert_am is null order by sortierung, bezeichnung`,
        ),
      }))) as Promise<{
        objekte: readonly Objektzeile[]; arten: readonly Artzeile[];
      }>);

  const feld = 'mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted';
  const eingabe = 'min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Posten anlegen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">Posten anlegen</h1>

      {objekte.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          In dieser Gesellschaft ist noch kein Objekt angelegt. Ein Posten steht
          immer an einem Objekt — ohne eines gibt es nichts zu besetzen.
        </p>
      ) : (
        <form
          action="/api/sicherheit/posten"
          method="post"
          className="max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="mandant" value={mandant} />

          <label className="mb-s4 block">
            <span className={feld}>Objekt</span>
            <select name="objekt" required className={eingabe}>
              {objekte.map((o) => (
                <option key={o.id} value={o.id}>{o.bezeichnung}</option>
              ))}
            </select>
          </label>

          <label className="mb-s4 block">
            <span className={feld}>Bezeichnung</span>
            <input name="bezeichnung" required maxLength={120} className={eingabe}
              placeholder="Nachtwache Haupteingang" />
          </label>

          <label className="mb-s4 block">
            <span className={feld}>Kurzzeichen (auf dem Plan)</span>
            <input name="kurzzeichen" maxLength={20} className={eingabe} placeholder="NW-1" />
          </label>

          <div className="mb-s4">
            <span className={feld}>Postenart</span>
            {arten.length === 0 ? (
              <p className="m-0 text-sm text-text-muted">
                Keine Arten hinterlegt. Welche Postenarten geführt werden, ist
                offen (O-148) — der Posten wird ohne Art angelegt, und das ist
                die ehrliche Variante.
              </p>
            ) : (
              <select name="postenart" className={eingabe}>
                <option value="">— ohne Art —</option>
                {arten.map((a) => (
                  <option key={a.id} value={a.id}>{a.bezeichnung}</option>
                ))}
              </select>
            )}
          </div>

          <div className="mb-s4 flex flex-wrap gap-s4">
            <label className="flex-1">
              <span className={feld}>Mindestbesetzung</span>
              <input name="min_besetzung" type="number" min={1} defaultValue={1}
                required className={eingabe} />
            </label>
            <label className="flex-1">
              <span className={feld}>Sollbesetzung</span>
              <input name="soll_besetzung" type="number" min={1} defaultValue={1}
                required className={eingabe} />
            </label>
          </div>
          <p className="mb-s4 max-w-prose text-sm text-text-muted">
            Die Mindestbesetzung ist die Untergrenze, unter der der Posten als
            nicht besetzt gilt — die Zahl, an der die Dringlichkeitsmeldung und
            die Veröffentlichungssperre hängen. Die Sollbesetzung ist die
            geplante Stärke.
          </p>

          <label className="mb-s4 block">
            <span className={feld}>Abdeckungsregel (RFC 5545, leer = durchgehend)</span>
            <input name="rrule" maxLength={200} className={eingabe}
              placeholder="FREQ=DAILY" />
          </label>

          <div className="mb-s4 flex flex-wrap gap-s4">
            <label className="flex-1">
              <span className={feld}>Beginn (Ortszeit, nur mit Regel)</span>
              {/* Wanduhr ohne Zone (§10.1): „22:00" bleibt 22:00, auch am
                  Tag der Zeitumstellung. */}
              <input name="dtstart" type="datetime-local" className={eingabe} />
            </label>
            <label className="flex-1">
              <span className={feld}>Dauer in Minuten</span>
              <input name="dauer" type="number" min={1} className={eingabe} placeholder="480" />
            </label>
          </div>

          <div className="mb-s5 flex flex-wrap gap-s4">
            <label className="flex-1">
              <span className={feld}>Gültig ab</span>
              <input name="gueltig_ab" type="date" required defaultValue={heute}
                className={eingabe} />
            </label>
            <label className="flex-1">
              <span className={feld}>Gültig bis (einschliesslich)</span>
              <input name="gueltig_bis" type="date" className={eingabe} />
            </label>
          </div>

          <Button type="submit" variante="primary">Posten anlegen</Button>
        </form>
      )}
    </PortalRahmen>
  );
}
