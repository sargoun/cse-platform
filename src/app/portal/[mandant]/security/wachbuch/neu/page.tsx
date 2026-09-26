import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { haeltRechte } from '../../../../rechte';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { ART_TEXT, WACHBUCH_ARTEN } from '@/server/services/security/wachbuch';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { WACHBUCH_TEXTE } from '@/lib/i18n/verwaltung/wachbuch';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { waehleSpeicher } from '@/server/storage/waehle';

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
 *
 * **Die Schlüssel ebenso** (V-180, SEC-05 „key", SEC-07). Bis dahin war die
 * Art `Schlüssel` hier ausgegraut („mit PR 42") — gebaut war die
 * Schlüsselverwaltung längst. Den Schlüssel eines fremden Objekts weist der
 * Dienst ab, bevor geschrieben wird, und die Seite sagt, warum (`?fehler=`).
 * **Die Art `Schlüssel` steht nur da, wo ein Schlüssel wählbar ist**: ohne
 * `schluessel.lesen` oder ohne erfassten Schlüssel könnte sie nur an
 * `schluessel_fehlt` scheitern, und der getippte Text wäre danach weg. Eine
 * Wahl, die nur scheitern kann, ist keine — wie im Formular der Wache
 * (`ARTEN_OHNE_SCHLUESSEL`); an ihrer Stelle steht der Satz, warum.
 *
 * **Und die Fotos** (V-181, SEC-05 „with photos"): ein Dateifeld im selben
 * Formular. Sie gehören zu der Seite, die dieses Formular schreibt, und zu
 * keiner anderen — ein späteres Foto an einer alten Seite nimmt die
 * Datenbank nicht an (0467).
 */
export const dynamic = 'force-dynamic';

interface Objektzeile { readonly id: string; readonly bezeichnung: string }
interface Punktzeile {
  readonly id: string; readonly bezeichnung: string; readonly objekt: string;
}
interface Schluesselzeile {
  readonly id: string; readonly bezeichnung: string; readonly nummer: string | null;
  readonly objekt: string;
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
  /**
   * **Wohin nach dem Speichern — und warum das eine Rechtefrage ist.**
   *
   * `wachbuch.schreiben` und `wachbuch.lesen` sind zwei Rechte, und die
   * Matrix vergibt sie getrennt (`0008`: `mitarbeiter` schreibt und liest
   * nicht). Der Rueckweg zeigte fest auf das Buch; wer es nicht lesen darf,
   * schrieb seinen Eintrag und landete auf einem 404 — die Bestaetigung
   * seiner Arbeit war eine Fehlerseite (AUT-06, D-581).
   *
   * Ohne das Leserecht fuehrt der Weg deshalb auf DIESES Formular zurueck,
   * mit einer Bestaetigung. Die Seite darf er per Definition oeffnen: er
   * steht darauf.
   */
  const darf = await haeltRechte(sitzung, 'wachbuch.lesen');
  const zurueck = darf['wachbuch.lesen'] === true
    ? `/portal/${mandant}/security/wachbuch`
    : `${pfad}?gespeichert=1`;
  const gespeichert = suche['gespeichert'] === '1';
  const tW = nachSprache(WACHBUCH_TEXTE, zugang.sprache);
  /* D-599/D-728: der Grund einer Abweisung nur als EIGENER Eintrag. */
  const fehler = typeof suche['fehler'] === 'string'
    ? (eigenerEintrag(tW.fehler, suche['fehler']) ?? tW.fehlerUnbekannt) : null;
  const darfSchluessel = (await haeltRechte(sitzung, 'schluessel.lesen'))['schluessel.lesen'] === true;
  /* V-181: ob ein Foto überhaupt ankommen kann — die Verbundenheit des echten Speichers. */
  const speicherVerbunden = waehleSpeicher().verbunden;

  const { objekte, punkte, schluessel } = await (db().begin(
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
        /* `schluessel.lesen` fehlt → keine Liste, nicht „keine Schlüssel". */
        schluessel: darfSchluessel ? await kontext.abfrage<Schluesselzeile>(
          `select s.id, s.bezeichnung, s.schluessel_nummer as nummer,
                  o.bezeichnung as objekt
             from schluessel s
             join objekt o on o.id = s.objekt_id and o.mandant_id = s.mandant_id
            where s.archiviert_am is null
            order by o.bezeichnung, s.bezeichnung`,
        ) : null,
      }))) as Promise<{
        objekte: readonly Objektzeile[]; punkte: readonly Punktzeile[];
        schluessel: readonly Schluesselzeile[] | null;
      }>);

  /* V-180: die Art `schluessel` nur, wenn es einen Schlüssel zu wählen gibt. */
  const schluesselWaehlbar = schluessel !== null && schluessel.length > 0;
  const arten = WACHBUCH_ARTEN.filter((a) => a !== 'schluessel' || schluesselWaehlbar);

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
      aktiverTab="security"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 text-h1 text-text">Wachbucheintrag</h1>

      {gespeichert && (
        <Hinweis art="erfolg" cse="wachbuch-gespeichert" className="mb-s5 max-w-prose">
          <strong>Der Eintrag steht im Wachbuch.</strong> Er ist unveränderlich;
          eine Korrektur ist ein neuer Eintrag, der auf ihn verweist. Das Buch
          selbst bleibt Ihnen verschlossen — dafür braucht es das Leserecht.
        </Hinweis>
      )}
      {fehler !== null && (
        <Hinweis art="warnung" cse="wachbuch-abgewiesen" rolle="alert"
                 className="mb-s5 max-w-prose">
          <strong>{tW.abgewiesen}</strong>{' '}
          {fehler}
        </Hinweis>
      )}
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
          action={`/api/sicherheit/wachbuch?zurueck_fehler=${encodeURIComponent(pfad)}`}
          method="post"
          encType="multipart/form-data"
          className="max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="mandant" value={mandant} />
          <input type="hidden" name="zurueck" value={zurueck} />
          <input type="hidden" name="zurueck_fehler" value={pfad} />

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
              {arten.map((a) => (
                <label key={a} className="flex items-center gap-s2 text-sm text-text">
                  <input
                    type="radio"
                    name="art"
                    value={a}
                    required
                    defaultChecked={a === 'rundgang'}
                    className="min-h-6 min-w-6"
                  />
                  <span>{ART_TEXT[a]}</span>
                </label>
              ))}
            </div>
            {!schluesselWaehlbar && (
              <p className="m-0 mt-s2 text-sm text-text-muted" data-cse="wachbuch-ohne-schluessel">
                {schluessel === null ? tW.schluesselOhneRecht : tW.keinSchluessel}
              </p>
            )}
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

          {schluesselWaehlbar && (
            <label className="mb-s4 block">
              <span className={feld}>{tW.schluessel}</span>
              <select name="schluessel" className={eingabe} data-cse="wachbuch-schluessel">
                <option value="">{tW.ohneSchluessel}</option>
                {schluessel.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.objekt} · {k.bezeichnung}{k.nummer === null ? '' : ` · ${k.nummer}`}
                  </option>
                ))}
              </select>
              <span className="mt-s1 block text-xs text-text-muted">{tW.schluesselHinweis}</span>
            </label>
          )}

          <label className="mb-s5 flex items-center gap-s2 text-sm text-text">
            <input type="checkbox" name="polizei" value="1" className="min-h-6 min-w-6" />
            Polizei informiert
          </label>

          {/*
            V-181: Fotos kommen MIT der Seite — danach nimmt die Datenbank
            keines mehr an (0467). Ohne verbundenen Speicher kein Dateifeld,
            das nur scheitern kann, sondern der Satz, warum es fehlt.
          */}
          {speicherVerbunden ? (
            <label className="mb-s5 block" data-cse="wachbuch-fotos">
              <span className={feld}>{tW.fotos}</span>
              <input type="file" name="foto" accept="image/*" multiple
                     className={eingabe} />
              <span className="mt-s1 block text-xs text-text-muted">{tW.fotoHinweis}</span>
            </label>
          ) : (
            <p className="mb-s5 text-sm text-text-muted" data-cse="wachbuch-fotos-nicht-verbunden">
              {tW.fotoNichtVerbunden}
            </p>
          )}

          <Button type="submit" variante="primary">Eintrag schreiben</Button>
        </form>
      )}
    </PortalRahmen>
  );
}
