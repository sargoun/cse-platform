import type postgres from 'postgres';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { Icon } from '@/components/ui/Icon';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { kanonischeBasis, KeinHostFehler } from '@/lib/domains';
import { listeCheckinZeilen, type CheckinZeile } from '@/server/services/zeit/checkin';
import type { BereichSchluessel } from '@/lib/design/theme';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { MARKE_GUELTIG_MINUTEN } from '@/lib/checkin-marke';
import { KOPF_CHECKIN_MARKE } from '@/lib/kopf';

/**
 * `/portal/[mandant]/zeiten/checkin-links` — die Ausgabe der Check-in-Marken
 * (TIM-07, Phase 5).
 *
 * **Der Befund, der diese Seite nötig machte.** Das Einlösen der Marke ist
 * seit 0035 vollständig gebaut: Stempeluhr, Route, Offline-Warteschlange,
 * Schichtfoto. Die AUSGABE hatte genau einen Aufrufer — den Seed. Die
 * Seitenkarte führt diese Adresse als Phase-5-Lieferung („issue, re-issue,
 * revoke; who has a link, who used it"); die Seite gab es nicht.
 *
 * Damit war die Zeiterfassung im Betrieb geschlossen, und zwar an einer
 * Stelle, an der man sie nicht sucht: nicht bei der Mitarbeiterin — die DARF
 * ihren Zeiteintrag nicht selbst schreiben (EMP-07, `p_ma_kein_update`), das
 * ist Absicht und richtig — sondern bei der Planung, die ihr den einzigen Weg
 * dorthin aushändigt.
 *
 * **Die Zeile ist die EINTEILUNG, nicht die Marke.** Der Planer fragt „wer
 * kommt morgen an den Hackeschen Markt und kann dort stempeln", nicht „welche
 * Marken existieren". Eine Liste der Marken beantwortet die zweite Frage und
 * verschweigt die erste — und genau die Einteilung OHNE Marke ist die, bei
 * der jemand vor der Tür steht und nicht einchecken kann. Sie steht deshalb
 * oben und trägt den Knopf.
 *
 * **Der Link steht genau einmal da.** `app.checkin_ausgeben` gibt ihn einmal
 * im Klartext zurück; gespeichert wird nur sein SHA-256. Wer ihn nicht
 * weitergibt, gibt ihn neu aus — das ist eine Zeile mehr im Protokoll und
 * kein Verlust. Er reist in einem kurzlebigen `httpOnly`-Keks hierher und
 * nicht in der Adresszeile: eine Zugangsmarke im Verlauf, im `Referer` und
 * im Zugriffsprotokoll wäre schlimmer als die Telefonnummer, für die derselbe
 * Weg schon abgelehnt wurde.
 *
 * **Verbunden ist kein Kanal (O-93).** Die Marke wird von Hand
 * weitergegeben — vorgelesen, per Aushang, über den eigenen Messenger. Die
 * Seite sagt das, statt einen Versand zu behaupten, den es nicht gibt.
 */
export const dynamic = 'force-dynamic';

const ZEIT = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

/** Der Zustand einer Zeile — in EINEM Wort, und in der Reihenfolge, die zählt. */
function zustand(z: CheckinZeile, jetzt: Date): {
  pill: PillZustand; text: string; offen: boolean;
} {
  if (z.tokenId === null) {
    return { pill: 'Überfällig', text: 'keine Marke', offen: true };
  }
  if (z.eingeloestAm !== null) {
    return { pill: 'Aktiv', text: `eingelöst ${ZEIT.format(z.eingeloestAm)}`, offen: false };
  }
  if (z.widerrufenAm !== null) {
    return {
      pill: 'Inaktiv',
      text: `widerrufen${z.widerrufGrund === null ? '' : ` — ${z.widerrufGrund}`}`,
      offen: true,
    };
  }
  if (z.gueltigBis !== null && z.gueltigBis.getTime() < jetzt.getTime()) {
    return { pill: 'Inaktiv', text: 'abgelaufen', offen: true };
  }
  return { pill: 'Wartet', text: 'ausgegeben, noch nicht eingelöst', offen: false };
}

export default async function CheckinLinks(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/zeiten/checkin-links`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return (
      <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant}
        zielSlug={tor.ziel} zurueck={tor.zurueck} />
    );
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) =>
      listeCheckinZeilen(kontext))) as Promise<readonly CheckinZeile[]>);

  /*
   * **Aus dem Kopf, nicht aus dem Keks** (D-579).
   *
   * Hier stand `keks.get(...)` und daneben `keks.delete(...)`, mitten im
   * Rendern. Next 15 lässt Keksänderungen nur in einer Server-Action oder
   * einem Routenhandler zu; die Seite warf also, sobald der Keks dastand —
   * und das war genau der Moment, in dem jemand eine Marke ausgegeben hatte.
   * Statt des Links kam die Fehlerhülle, und die Marke war verloren:
   * `app.checkin_ausgeben` gibt sie genau einmal im Klartext zurück.
   *
   * Aufgefallen ist es keinem Test, weil kein Test je auf den Knopf gedrückt
   * hat. Der Verweis-Durchlauf besucht diese Seite sehr wohl — ohne Keks, und
   * dann lief die Zeile nicht. `checkin-marke.spec.ts` geht den Weg jetzt
   * vollständig.
   *
   * Das Versprechen bleibt: die Marke reist genau einen Bildschirm weit. Die
   * Middleware liest den Keks, reicht ihn hier herein und räumt ihn auf
   * derselben Antwort ab.
   */
  const frischeMarke = (await headers()).get(KOPF_CHECKIN_MARKE);

  /*
   * Die kanonische Basis, damit der Link absolut ist — ein relativer taugt in
   * einer Nachricht so wenig wie in einer E-Mail (D-532). Fehlt der Wirt,
   * steht der Pfad da und die Seite sagt, dass die Adresse davorgehört.
   */
  let basis: string | null = null;
  try {
    basis = kanonischeBasis((await headers()).get('host'));
  } catch (fehler) {
    if (!(fehler instanceof KeinHostFehler)) throw fehler;
  }

  const jetzt = new Date();
  const ohneMarke = zeilen.filter((z) => zustand(z, jetzt).offen).length;

  return (
    <PortalRahmen
      titel="Check-in-Links"
      wurzelTitel="Zeiten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zeiten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Check-in-Links</h1>
        <p className="m-0 text-sm text-text-muted">
          {zeilen.length === 1 ? '1 Einteilung' : `${String(zeilen.length)} Einteilungen`}
          {' · '}
          <span className="tabular-nums">{ohneMarke}</span> ohne gültige Marke
        </p>
      </div>

      {frischeMarke !== null && (
        <Hinweis art="erfolg" cse="marke-frisch" className="mb-s5">
          <p className="m-0 font-medium text-text">
            Der Link steht hier <strong>genau einmal</strong>.
          </p>
          <p
            data-cse="marke-link"
            className="mt-s3 break-all rounded-md border border-line bg-surface p-s3 font-mono text-sm text-text"
          >
            {basis === null ? '' : basis}/check-in/{frischeMarke}
          </p>
          {basis === null && (
            <p className="mt-s2 text-sm text-text-subtle">
              Die öffentliche Adresse dieser Installation ist nicht hinterlegt —
              setzen Sie sie vor den Pfad.
            </p>
          )}
          <p className="mt-s3 text-sm text-text-muted">
            Gespeichert wird nur seine Prüfsumme; er lässt sich nicht noch einmal
            anzeigen. Ist er weg, geben Sie einen neuen aus — das kostet eine Zeile
            im Protokoll und nichts sonst. Es ist kein Versandkanal verbunden
            (offene Frage O-93), er wird also von Hand weitergegeben.
          </p>
        </Hinweis>
      )}

      <nav aria-label="Weiter im Zeitbereich" className="mb-s4 flex flex-wrap gap-s2">
        <a
          href={`/portal/${mandant}/zeiten/live`}
          className="inline-flex min-h-11 items-center gap-s2 rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          <Icon name="zeit" groesse="sm" />
          Aktuell im Einsatz
        </a>
        <a
          href={`/portal/${mandant}/zeiten`}
          className="inline-flex min-h-11 items-center gap-s2 rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          <Icon name="zeit" groesse="sm" />
          Alle Zeiten der Woche
        </a>
      </nav>

      {zeilen.length === 0 ? (
        <p data-cse="keine-einteilungen"
           className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          In den nächsten sieben Tagen ist niemand eingeteilt. Ein Check-in-Link
          hängt an einer Einteilung — ohne sie gibt es nichts auszugeben.
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-s4 p-0 lg:grid-cols-2">
          {zeilen.map((z) => {
            const s = zustand(z, jetzt);
            return (
              <li
                key={z.zuordnungId}
                data-cse="checkin-zeile"
                data-zuordnung={z.zuordnungId}
                data-zustand={s.pill}
                className={`rounded-lg border p-s4 ${
                  z.tokenId === null ? 'border-warning bg-warning-soft' : 'border-line bg-surface'
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-s2">
                  <span className="text-h3 text-text">{z.person}</span>
                  <StatusPill zustand={s.pill} />
                </div>
                <p className="mt-s2 text-sm text-text-muted">
                  {z.objekt ?? 'ohne Objekt'}
                  {' · '}
                  <span className="tabular-nums">{ZEIT.format(z.beginn)}</span>
                  {' – '}
                  <span className="tabular-nums">
                    {new Intl.DateTimeFormat('de-DE', {
                      timeZone: 'Europe/Berlin', timeStyle: 'short',
                    }).format(z.ende)}
                  </span>
                </p>
                <p data-cse="marke-zustand" className="mt-s2 text-sm text-text-subtle">
                  {s.text}
                  {z.ausgegebenAm !== null && z.eingeloestAm === null && (
                    <> · ausgegeben {ZEIT.format(z.ausgegebenAm)}</>
                  )}
                </p>

                <div className="mt-s4 flex flex-wrap gap-s3">
                  <form method="post" action="/api/checkin-marken">
                    <input type="hidden" name="aktion" value="ausgeben" />
                    <input type="hidden" name="mandant" value={mandant} />
                    <input type="hidden" name="zuordnung" value={z.zuordnungId} />
                    <input type="hidden" name="zweck" value="checkin" />
                    <input type="hidden" name="zurueck" value={pfad} />
                    <Button type="submit" variante="primary" data-cse="marke-ausgeben">
                      {z.tokenId === null ? 'Link ausgeben' : 'Neuen Link ausgeben'}
                    </Button>
                  </form>

                  {/*
                    * Widerrufen nur, solange die Marke noch etwas bewirken kann.
                    * Eine eingelöste hat gewirkt; sie zurückzunehmen änderte
                    * nichts an der Wirkung und behauptete im Protokoll das
                    * Gegenteil (0164).
                    */}
                  {z.tokenId !== null && z.eingeloestAm === null && z.widerrufenAm === null && (
                    <form method="post" action="/api/checkin-marken"
                          className="flex flex-wrap items-center gap-s2">
                      <input type="hidden" name="aktion" value="widerrufen" />
                      <input type="hidden" name="mandant" value={mandant} />
                      <input type="hidden" name="marke" value={z.tokenId} />
                      <input type="hidden" name="zurueck" value={pfad} />
                      <label className="sr-only" htmlFor={`grund-${z.zuordnungId}`}>
                        Grund für den Widerruf
                      </label>
                      <input
                        id={`grund-${z.zuordnungId}`}
                        name="grund"
                        required
                        minLength={3}
                        placeholder="Grund"
                        className="min-h-11 w-40 rounded-md border border-line bg-surface px-s3 text-sm text-text focus:border-brand focus:outline-none"
                      />
                      <Button type="submit" variante="ghost" data-cse="marke-widerrufen">
                        Widerrufen
                      </Button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-s5 max-w-[72ch] text-sm text-text-subtle">
        Ein Link gilt für <strong>eine</strong> Person auf <strong>einer</strong> Schicht
        und nur innerhalb ihres Fensters. Er verfällt mit der Schicht, und er wird
        automatisch widerrufen, wenn die Einteilung zurückgenommen oder die Schicht
        verschoben wird. Angezeigt wird er {MARKE_GUELTIG_MINUTEN} Minuten lang genau
        einmal — danach hilft nur ein neuer.
      </p>
    </PortalRahmen>
  );
}
