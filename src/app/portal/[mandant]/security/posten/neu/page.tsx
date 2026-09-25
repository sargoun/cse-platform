import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { LeistungsankerFeld } from '@/components/portal/LeistungsankerFeld';
import {
  listeAnkerbareLeistungen, type AnkerbareLeistung,
} from '@/server/services/dienstplan/leistungsanker';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { Hinweis } from '@/components/ui/Hinweis';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { LEISTUNGSANKER_TEXTE } from '@/lib/i18n/verwaltung/leistungsanker';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { vorbelegt } from '@/lib/formular/maske';

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
 *
 * **Ein abgewiesener Anker kommt hierher zurück** (V-192, D-599): der Grund
 * als Satz in der Sprache der Sitzung, die Eingaben vorbelegt — nur mit
 * Werten, die die Seite anbietet (D-733 Nr. 4).
 */
export const dynamic = 'force-dynamic';

interface Objektzeile { readonly id: string; readonly bezeichnung: string }
interface Artzeile { readonly id: string; readonly bezeichnung: string }

export default async function PostenNeu(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
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
  const { objekte, arten, anker } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /* Der Abrechnungsanker (V-191, TIM-12) — nur mit `auftrag.lesen`. */
        const [lesen] = await kontext.abfrage<{ darf: boolean }>(
          `select app.hat_recht('auftrag.lesen', app.aktiver_mandant()) as darf`);
        return {
          objekte: await kontext.abfrage<Objektzeile>(
            `select id, bezeichnung from objekt
              where archiviert_am is null order by bezeichnung`,
          ),
          arten: await kontext.abfrage<Artzeile>(
            `select id, bezeichnung from postenart
              where archiviert_am is null order by sortierung, bezeichnung`,
          ),
          anker: lesen?.darf === true ? await listeAnkerbareLeistungen(kontext) : null,
        };
      })) as Promise<{
        objekte: readonly Objektzeile[]; arten: readonly Artzeile[];
        anker: readonly AnkerbareLeistung[] | null;
      }>);

  /* Die Rückkehr einer abgewiesenen Anlage (V-192) — vorbelegt wird nur, was angeboten ist. */
  const tL = nachSprache(LEISTUNGSANKER_TEXTE, zugang.sprache);
  const fehler = vorbelegt(suche, 'fehler') ?? null;
  const angeboten = (name: string, werte: readonly string[]): string | undefined => {
    const wert = vorbelegt(suche, name);
    return wert !== undefined && werte.includes(wert) ? wert : undefined;
  };
  const muster = (name: string, form: RegExp): string | undefined => {
    const wert = vorbelegt(suche, name);
    return wert !== undefined && form.test(wert) ? wert : undefined;
  };
  const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
  const vor = {
    objekt: angeboten('objekt', objekte.map((o) => o.id)),
    bezeichnung: vorbelegt(suche, 'bezeichnung')?.slice(0, 120),
    kurzzeichen: vorbelegt(suche, 'kurzzeichen')?.slice(0, 20),
    postenart: angeboten('postenart', arten.map((a) => a.id)) ?? '',
    minBesetzung: muster('min_besetzung', /^\d{1,3}$/u) ?? '1',
    sollBesetzung: muster('soll_besetzung', /^\d{1,3}$/u) ?? '1',
    rrule: vorbelegt(suche, 'rrule')?.slice(0, 200),
    dtstart: muster('dtstart', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u),
    dauer: muster('dauer', /^\d{1,4}$/u),
    gueltigAb: muster('gueltig_ab', DATUM) ?? heute,
    gueltigBis: muster('gueltig_bis', DATUM),
    anker: angeboten('auftrag_leistung', (anker ?? []).filter((l) => l.lebt).map((l) => l.id))
      ?? null,
  };

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
      aktiverTab="security"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">Posten anlegen</h1>

      {fehler !== null && (
        <Hinweis art="warnung" cse="posten-fehler" className="mb-s5 max-w-prose">
          <strong>{tL.nichtAngelegt}</strong>{' '}
          {eigenerEintrag(tL.fehler, fehler) ?? tL.fehlerSonst}
        </Hinweis>
      )}

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
            <select name="objekt" required className={eingabe} defaultValue={vor.objekt}>
              {objekte.map((o) => (
                <option key={o.id} value={o.id}>{o.bezeichnung}</option>
              ))}
            </select>
          </label>

          <label className="mb-s4 block">
            <span className={feld}>Bezeichnung</span>
            <input name="bezeichnung" required maxLength={120} className={eingabe}
              placeholder="Nachtwache Haupteingang" defaultValue={vor.bezeichnung} />
          </label>

          <label className="mb-s4 block">
            <span className={feld}>Kurzzeichen (auf dem Plan)</span>
            <input name="kurzzeichen" maxLength={20} className={eingabe} placeholder="NW-1"
              defaultValue={vor.kurzzeichen} />
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
              <select name="postenart" className={eingabe} defaultValue={vor.postenart}>
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
              <input name="min_besetzung" type="number" min={1} defaultValue={vor.minBesetzung}
                required className={eingabe} />
            </label>
            <label className="flex-1">
              <span className={feld}>Sollbesetzung</span>
              <input name="soll_besetzung" type="number" min={1} defaultValue={vor.sollBesetzung}
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
              placeholder="FREQ=DAILY" defaultValue={vor.rrule} />
          </label>

          <div className="mb-s4 flex flex-wrap gap-s4">
            <label className="flex-1">
              <span className={feld}>Beginn (Ortszeit, nur mit Regel)</span>
              {/* Wanduhr ohne Zone (§10.1): „22:00" bleibt 22:00, auch am
                  Tag der Zeitumstellung. */}
              <input name="dtstart" type="datetime-local" className={eingabe}
                defaultValue={vor.dtstart} />
            </label>
            <label className="flex-1">
              <span className={feld}>Dauer in Minuten</span>
              <input name="dauer" type="number" min={1} className={eingabe} placeholder="480"
                defaultValue={vor.dauer} />
            </label>
          </div>

          <div className="mb-s5 flex flex-wrap gap-s4">
            <label className="flex-1">
              <span className={feld}>Gültig ab</span>
              <input name="gueltig_ab" type="date" required defaultValue={vor.gueltigAb}
                className={eingabe} />
            </label>
            <label className="flex-1">
              <span className={feld}>Gültig bis (einschliesslich)</span>
              <input name="gueltig_bis" type="date" className={eingabe}
                defaultValue={vor.gueltigBis} />
            </label>
          </div>

          <div className="mb-s5">
            <LeistungsankerFeld leistungen={anker} gewaehlt={vor.anker}
                                sprache={zugang.sprache} feldKlasse={eingabe} />
          </div>

          <Button type="submit" variante="primary">Posten anlegen</Button>
        </form>
      )}
    </PortalRahmen>
  );
}
