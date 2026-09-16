import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, erwarteterUrsprung, internesZiel } from '@/server/auth/ursprung';
import { rechtepruefer } from '@/server/auth/zugang';
import { db } from '@/server/db/pool';
import { type SchreibKontext, withTenant } from '@/server/kontext/index';
import { SocialFehler } from '@/server/services/social/dienst';
import { liesRumpf as liesRumpfIntern, type Rumpf } from '../rumpf';

/**
 * Das Gerüst der vier schreibenden Social-Routen.
 *
 * **Warum ein Gerüst und keine vier Kopien.** Ursprungsprüfung, Sitzung,
 * genau ein aktiver Mandant, `authorize`, Transaktion, Fehlerbild — das ist
 * bei allen vieren dasselbe, und vier Kopien sind vier Stellen, an denen
 * eines davon beim nächsten Umbau fehlt. Was sich unterscheidet, ist die
 * Handlung; die steht im Aufrufer.
 *
 * **`SocialFehler` ist 409, nicht 500.** Ein Beitrag, der im falschen Zustand
 * ist, ist kein Programmfehler — ein Mensch soll den Satz lesen und wissen,
 * was fehlt.
 *
 * **Und `authorize` wirft.** Wer nur `SocialFehler` faengt, beantwortet ein
 * FEHLENDES RECHT mit 500 — und 500 sagt „hier ist etwas", wo AUT-06 nichts
 * sagen will. Die Uebersetzung steht in `server/auth/antwort.ts`, damit sie
 * nicht in jeder Route neu und irgendwann anders geschrieben wird.
 */

/*
 * `UUID`, `Rumpf` und `liesRumpf` stehen jetzt in `api/rumpf.ts`: sie sind an
 * Social nicht gebunden, und Recruiting brauchte dieselbe Weiche. Hier wird
 * weiter re-exportiert, damit die vier Social-Routen ihren Import behalten —
 * ein Umzug soll keine Datei anfassen, die sich sonst nicht ändert.
 */
export { UUID, liesRumpf, type Rumpf } from '../rumpf';

export interface Lauf {
  /**
   * Der Rechteschluessel — oder die Regel, die ihn aus dem Rumpf ableitet.
   *
   * **Warum eine Funktion und kein zweites Auslesen.** Die Schrittroute
   * braucht je Schritt ein anderes Recht (Vorlegen ist Schreiben, Veroeffentlichen
   * ist Planen). Sie las den Schritt dafuer vorab aus `formData()` — und ein
   * Aufrufer mit `application/json` fiel durch dieses Raster: sein Schritt war
   * unsichtbar, das Recht wurde auf den strengsten Fall gesetzt, und
   * „Vorlegen" per JSON scheiterte fuer jemanden, der `social.schreiben` hielt.
   * Der Rumpf wird jetzt EINMAL gelesen, in beiden Formaten, und die Regel
   * sieht dasselbe wie der Handler.
   */
  readonly recht: string | ((rumpf: Rumpf) => string);
  readonly handle: (kontext: SchreibKontext, rumpf: Rumpf) => Promise<string>;
  /** Wohin ein Formular danach zeigt — `slug` ist der Bereich. */
  readonly ziel: (slug: string, ergebnis: string) => string;
}

/**
 * Wohin es geht, wenn `zurueck` nicht in diese Anwendung zeigt.
 *
 * `/portal` ist der Wegweiser (D-560) und kein Bildschirm, den jemand
 * vorgeben kann — genau das ist der Punkt.
 */
const HEIMWEG = '/portal';

export async function fuehreSocialAus(
  anfrage: NextRequest, lauf: Lauf,
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const rumpf = await liesRumpfIntern(anfrage).catch(() => null);
  if (rumpf === null) {
    return NextResponse.json({ fehler: 'unlesbarer_rumpf' }, { status: 400 });
  }
  const recht = typeof lauf.recht === 'string' ? lauf.recht : lauf.recht(rumpf);

  try {
    const { ergebnis, slug } = await (db().begin(
      async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
        await authorize(sitzung, { recht, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        const [m] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        const e = await lauf.handle(kontext, rumpf);
        return { ergebnis: e, slug: m?.slug ?? '' };
      }))) as { ergebnis: string; slug: string };

    if (rumpf.json) return NextResponse.json({ ergebnis }, { status: 200 });
    return NextResponse.redirect(
      new URL(lauf.ziel(slug, ergebnis), erwarteterUrsprung(anfrage)), 303);
  } catch (fehler: unknown) {
    if (fehler instanceof SocialFehler) {
      /*
       * **Ein Formular bekommt seine Seite zurueck, kein JSON.**
       *
       * Hier stand nur die `NextResponse.json`-Zeile darunter — fuer JEDEN
       * Aufrufer. Wer im Portal „Auf diesen Zeitpunkt legen" drueckte und
       * einen Zeitpunkt in der Vergangenheit erwischte, landete auf einer
       * weissen Seite mit `{"fehler":"vergangenheit"}`: der Satz, den jemand
       * lesen soll, stand als Datenfeld da, das Formular war weg und der
       * Rueckweg war der Zurueck-Knopf des Browsers. Die Planungsseite HATTE
       * ihre Fehlertafel (`FEHLER[…]`) die ganze Zeit — es kam nur nie etwas
       * an. Gemeldet hat das die Copilot-Runde auf PR 16.
       *
       * Dieselbe Form wie in `api/recruiting/gemeinsam.ts` und
       * `api/zeit/korrektur`: `zurueck` kommt als verstecktes Feld aus dem
       * Formular, `internesZiel` laesst nur einen Pfad DIESER Anwendung durch
       * (D-562) — ein fremdes Ziel im Feld waere sonst eine offene Umleitung.
       * Ohne `zurueck` bleibt es beim JSON: ein Aufrufer ohne Rueckweg hat
       * keine Seite, auf die man ihn schicken koennte.
       */
      const zurueck = rumpf.felder['zurueck'];
      if (!rumpf.json && zurueck !== undefined && zurueck !== '') {
        const trenner = zurueck.includes('?') ? '&' : '?';
        /*
         * **Der Rueckfall ist SERVERSEITIG** — `zurueck` in beiden Argumenten
         * hebt die Pruefung auf: ein abgewiesenes fremdes Ziel kaeme als
         * Rueckfall unveraendert zurueck. Dieselbe Stelle, derselbe Fehler wie
         * in `api/recruiting/gemeinsam.ts`; ich hatte sie von dort abgeschrieben.
         */
        return NextResponse.redirect(
          internesZiel(
            `${zurueck}${trenner}fehler=${encodeURIComponent(fehler.grund)}`,
            HEIMWEG, anfrage),
          303);
      }
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message },
        { status: fehler.grund === 'unbekannt' ? 404 : 409 });
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}
