import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { rechtepruefer } from '@/server/auth/zugang';
import { db } from '@/server/db/pool';
import { type SchreibKontext, withTenant } from '@/server/kontext/index';
import { SocialFehler } from '@/server/services/social/dienst';

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

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface Rumpf {
  readonly felder: Readonly<Record<string, string>>;
  readonly alle: (name: string) => readonly string[];
  readonly json: boolean;
}

export async function liesRumpf(anfrage: NextRequest): Promise<Rumpf> {
  const typ = anfrage.headers.get('content-type') ?? '';
  if (typ.includes('application/json')) {
    /*
     * **Kaputtes JSON bleibt kaputtes JSON.** Hier stand
     * `.catch(() => ({}))` — daraus wurde ein leeres Formular, und der Aufrufer
     * bekam `unvollstaendig` (409) statt `unlesbarer_rumpf` (400). Wer eine
     * Schnittstelle anspricht, kann dann nicht unterscheiden, ob seine Syntax
     * kaputt war oder ein Feld fehlte — und sucht das Feld.
     * `fuehreSocialAus` faengt den Wurf bereits ab und antwortet 400.
     */
    const roh = (await anfrage.json()) as Record<string, unknown>;
    const felder: Record<string, string> = {};
    for (const [k, v] of Object.entries(roh)) {
      if (typeof v === 'string') felder[k] = v;
    }
    return {
      felder,
      alle: (name) => {
        const w = roh[name];
        return Array.isArray(w) ? w.filter((x): x is string => typeof x === 'string') : [];
      },
      json: true,
    };
  }
  const daten = await anfrage.formData();
  const felder: Record<string, string> = {};
  for (const [k, v] of daten.entries()) {
    if (typeof v === 'string' && !(k in felder)) felder[k] = v;
  }
  return {
    felder,
    alle: (name) => daten.getAll(name).filter((x): x is string => typeof x === 'string'),
    json: false,
  };
}

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
  const rumpf = await liesRumpf(anfrage).catch(() => null);
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
      new URL(lauf.ziel(slug, ergebnis), anfrage.nextUrl.origin), 303);
  } catch (fehler: unknown) {
    if (fehler instanceof SocialFehler) {
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message },
        { status: fehler.grund === 'unbekannt' ? 404 : 409 });
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}
