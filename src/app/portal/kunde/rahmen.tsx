import type { ReactNode } from 'react';
import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withKundeScope, KeinKundenzugangFehler, type LeseKontext }
  from '@/server/kontext/index';
import { rechtepruefer } from '@/server/auth/zugang';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { portalZugang, type PortalZugang } from '../zugang';

/**
 * Der gemeinsame Einstieg jeder Seite unter `/portal/kunde` (AUT-01, DSH-03,
 * K-18, K-20).
 *
 * ===========================================================================
 * Warum diese Huelle existiert, obwohl es nur zehn Seiten sind
 * ===========================================================================
 *
 * Das Muster stand einmal von Hand in `/portal/kunde/page.tsx`:
 * `portalZugang(pfad)`, `AnmeldungNoetig` bei `null`,
 * `db().begin(SCHNAPPSCHUSS, …)`, `withKundeScope`, ein `try/catch` auf
 * `KeinKundenzugangFehler`, dann `PortalRahmen` mit `bereich={null}`,
 * `nurLesen` und `wurzel="/portal/kunde"`. Zehn Seiten, die das je einzeln
 * abschreiben, sind zehn Gelegenheiten, den `catch` zu vergessen — und dann
 * sieht ein Kunde ohne `kunde_zugang` einen Serverfehler statt des Satzes,
 * der erklaert, was los ist. Genau derselbe Grund, aus dem `meinPortal`
 * (`/portal/mein/rahmen.tsx`) existiert.
 *
 * **`KeinKundenzugangFehler` ist nicht 404 und nicht 500.** Es ist ein
 * angemeldetes Konto ohne Kundenbindung: `app.sichtbare_mandanten()` gibt im
 * Kunden-Scope die leere Menge zurueck (fail closed, K-18), und
 * `withKundeScope` wirft, statt eine leere Liste zu erlauben. Eine Uebersicht
 * ueber dieser Menge zeigte „keine Auftraege", „keine Rechnungen", „keine
 * Nachweise" — und das liest sich wie ein Kunde ohne Geschaeft. Wer die
 * beiden verwechselt, ruft beim Kunden an.
 *
 * **Eine Transaktion, eine Bindung, alle Daten.** Der Kunden-Scope wird
 * EINMAL betreten; darin laufen die Rechtefragen der Seite UND ihre
 * Abfragen. Zwei Transaktionen waeren zwei Bindungen, und die zweite hat
 * nach `SCHNAPPSCHUSS` einen anderen Lesezeitpunkt — eine Zeile, die in der
 * Liste steht und im Detail fehlt.
 *
 * **`laden` bekommt einen `LeseKontext`.** Er hat kein `schreibe`: das ist
 * kein Versehen, sondern der Typ, den `withKundeScope` zurueckgibt. Ein
 * Schreibversuch aus einer Kundenseite ist damit ein Compilerfehler und keine
 * Laufzeitentscheidung — bis O-74 entschieden ist, hat das Kundenportal
 * keinen einzigen Schreibpfad.
 */

export interface KundenBasis {
  readonly zugang: PortalZugang;
  /**
   * Je Rechteschluessel: haelt diese Sitzung ihn in mindestens einer
   * sichtbaren Gesellschaft?
   *
   * **Nicht `haeltRechte` aus `app/portal/rechte.ts`.** Das geht ueber
   * `withTenant` und fragt `app.hat_recht(r, app.aktiver_mandant())` — und im
   * Kunden-Scope ist der aktive Mandant nach K-20 NULL. Nachgemessen gegen
   * eine echte Kundensitzung: `app.hat_recht('finanzen.herunterladen', null)`
   * antwortet `false`, dieselbe Frage ueber `app.sichtbare_mandanten()`
   * antwortet `true`. Eine Seite, die die erste Form fragt, versteckt jeden
   * bedingten Verweis — oder, schlimmer, zeigt ihn, weil `undefined !== false`
   * wahr ist, und dann steht hinter dem Knopf ein 404 (AUT-06).
   */
  readonly rechte: Readonly<Record<string, boolean>>;
}

export type KundenErgebnis<T> =
  | { readonly art: 'anmeldung' }
  | { readonly art: 'kein_zugang'; readonly basis: KundenBasis }
  | { readonly art: 'ok'; readonly basis: KundenBasis; readonly daten: T };

/**
 * Tor, Kunden-Scope und Daten — in dieser Reihenfolge und in einer
 * Transaktion.
 *
 * `rechte` nennt die Schluessel, die die Seite fuer bedingte Verweise
 * braucht. Sie werden in DERSELBEN gebundenen Transaktion bewertet: ohne
 * Bindung antwortet `app.hat_recht` auf alles `false`, und eine zweite
 * Rundreise pro Seitenaufruf fuer eine Frage, die eine beantwortet, ist eine
 * zu viel.
 */
export async function kundePortal<T>(
  pfad: string,
  laden: (kontext: LeseKontext) => Promise<T>,
  rechte: readonly string[] = [],
): Promise<KundenErgebnis<T>> {
  const zugang = await portalZugang(pfad);
  if (zugang === null) return { art: 'anmeldung' };

  try {
    const ergebnis = await (db().begin(SCHNAPPSCHUSS,
      async (tx: postgres.TransactionSql) =>
        withKundeScope(tx, zugang.sitzung, async (kontext) => {
          const gehalten = rechte.length === 0
            ? new Set<string>()
            /*
             * `null` als Mandant ist hier die RICHTIGE Angabe und nicht das
             * Weglassen einer: `hatRechte(…, null)` fragt in `zugang.ts`
             * ausdruecklich ueber `app.sichtbare_mandanten()` („das Recht
             * gilt, wenn es in mindestens einem dieser Bereiche gilt"). Das
             * oeffnet den VERWEIS, nicht die Zeilen — welche Zeilen
             * erscheinen, entscheidet RLS je Gesellschaft.
             */
            : await rechtepruefer(kontext.abfrage.bind(kontext)).hatRechte(rechte, null);
          const karte: Record<string, boolean> = {};
          for (const r of rechte) karte[r] = gehalten.has(r);
          return { rechte: karte, daten: await laden(kontext) };
        })) as Promise<{ rechte: Record<string, boolean>; daten: T }>);
    return { art: 'ok', basis: { zugang, rechte: ergebnis.rechte }, daten: ergebnis.daten };
  } catch (fehler) {
    if (!(fehler instanceof KeinKundenzugangFehler)) throw fehler;
    const karte: Record<string, boolean> = {};
    for (const r of rechte) karte[r] = false;
    return { art: 'kein_zugang', basis: { zugang, rechte: karte } };
  }
}

/**
 * Die Huelle einer Kundenseite.
 *
 * **`bereich={null}`** — kein Identitaetsstreifen einer der vier
 * Gesellschaften. Ein Kundenzugang kann nach O-52 auf zwei Gesellschaften der
 * Gruppe zeigen; eine Kopfzeile, die sich fuer eine entscheidet, waere fuer
 * die andere Haelfte der Liste falsch. Die Zugehoerigkeit steht deshalb an
 * jeder ZEILE (CRM-06, 04-SEITENKARTE §8) — dieselbe Entscheidung wie im
 * Mitarbeiterportal (EMP-14, D-09).
 *
 * **`nurLesen`** — und das ist keine Behauptung der Oberflaeche: der Kontext
 * dahinter hat kein `schreibe`, `app.ist_readonly()` ist gesetzt, und jede
 * `WITH CHECK` der Plattform prueft es (Invariante 10, dieselbe Linie wie in
 * der Gruppenansicht).
 */
export function KundenRahmen({
  basis, titel, aktiverTab, children,
}: {
  readonly basis: KundenBasis;
  readonly titel: string;
  readonly aktiverTab: string;
  readonly children: ReactNode;
}) {
  return (
    <PortalRahmen
      titel={titel}
      /*
       * `Übersicht` ist die Wurzel dieses Portals, und `titel` ist der Name
       * der Seite. Mit beidem liest sich die Kopfzeile als Weg:
       * `‹ Übersicht › Rechnungen` — sonst stand dort nur der Seitenname und
       * sah aus wie eine Überschrift (dieselbe Begründung wie in `MeinRahmen`).
       */
      wurzelTitel="Übersicht"
      bereich={null}
      nurLesen
      leiste={basis.zugang.leiste}
      wurzel="/portal/kunde"
      aktiverTab={aktiverTab}
      sichtbareTabs={basis.zugang.sichtbareTabs}
      navigationsRechte={basis.zugang.navigationsRechte}
    >
      {children}
    </PortalRahmen>
  );
}
