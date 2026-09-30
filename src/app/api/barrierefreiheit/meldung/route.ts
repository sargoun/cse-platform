import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { withEingang } from '@/server/kontext/eingang';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { mitSprache, SPRACHEN, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';
import { PFLICHTWEG_FEHLER_TEXTE, pflichtwegMeldung } from '@/lib/i18n/texte';
import {
  BarriereFehler, melde, type BarriereFehlerGrund,
} from '@/server/services/datenschutz/barriere';

/**
 * `POST /api/barrierefreiheit/meldung` — der Meldeweg für Barrieren
 * (LEG-07, BFSG).
 *
 * **Kein Konto, kein Ratenlimit, kein Honigtopf.** Die Angebotsanfrage hat alle
 * drei, und hier fehlen sie mit Absicht: dieser Weg ist die gesetzliche
 * Beschwerdemöglichkeit, und jede Hürde davor trifft genau die Menschen, für
 * die er da ist. Ein Screenreader-Nutzer, dessen Software ein unsichtbares
 * Zusatzfeld doch ausfüllt, bekäme seine Meldung sonst verworfen, ohne je zu
 * erfahren warum.
 *
 * Was bleibt: die Zeile wird über den Eingangsprinzipal geschrieben, der
 * anlegen und nicht lesen darf.
 */
export const dynamic = 'force-dynamic';

function spracheAus(daten: FormData): Sprache {
  const roh = String(daten.get('sprache') ?? '');
  return (SPRACHEN as readonly string[]).includes(roh) ? (roh as Sprache) : VORGABE_SPRACHE;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  let daten: FormData;
  try {
    daten = await anfrage.formData();
  } catch {
    return NextResponse.json({ ok: false, meldung: 'unlesbar' }, { status: 400 });
  }

  const sprache = spracheAus(daten);
  const alsSeite = String(daten.get('antwort') ?? '') === 'seite';
  const bereich = String(daten.get('bereich') ?? '');
  const ziel = mitSprache('/barrierefreiheit/feedback', sprache);

  /**
   * Eine Abweisung: ein Programm bekommt JSON mit dem Satz (D-599), ein
   * Browser DIESELBE Seite mit dem GRUND (D-769, V-272).
   *
   * **Nur der Grund reist durch die Adresse.** Hier reiste der Satz im
   * Parameter `meldung`, und die Seite zeigte ihn in ihrem Warnkasten — auch
   * den eines präparierten Links, auf dem Meldeweg, den das BFSG vorschreibt.
   * Jetzt schlägt die Seite den Grund in ihrer Sprache nach
   * (`PFLICHTWEG_FEHLER_TEXTE`); nichts, was jemand eingegeben hat, steht in
   * der Adresse.
   */
  const abweisen = (
    status: number, grund: BarriereFehlerGrund | 'bereich_fehlt', meldung: string,
  ): NextResponse => {
    if (!alsSeite) return NextResponse.json({ ok: false, meldung }, { status });
    const zurueck = new URL(ziel, anfrage.url);
    zurueck.searchParams.set('fehler', grund);
    return NextResponse.redirect(zurueck, 303);
  };

  const [gesellschaft] = await (db().begin((tx: postgres.TransactionSql) =>
    withOeffentlich(tx, (kontext) => kontext.abfrage<{ id: string }>(
      `select id from mandant where slug = $1 and archiviert_am is null`, [bereich],
    ))) as Promise<readonly { id: string }[]>);

  if (gesellschaft === undefined) {
    return abweisen(404, 'bereich_fehlt',
      PFLICHTWEG_FEHLER_TEXTE[sprache].barriere.fehler.bereich_fehlt);
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withEingang(tx, gesellschaft.id, (kontext) => melde(kontext, {
        beschreibung: String(daten.get('beschreibung') ?? ''),
        seite: String(daten.get('seite') ?? '') || undefined,
        hilfsmittel: String(daten.get('hilfsmittel') ?? '') || undefined,
        email: String(daten.get('email') ?? '') || undefined,
      })));
  } catch (f) {
    // Der Dienst spricht deutsch; ein Programm bekommt auf Englisch den Satz
    // zum GRUND (V-156), die Seite nur den Grund selbst (D-769).
    if (f instanceof BarriereFehler) {
      return abweisen(f.status, f.grund,
        pflichtwegMeldung('barriere', sprache, f.grund, f.message));
    }
    throw f;
  }

  if (!alsSeite) return NextResponse.json({ ok: true });
  /*
   * Zurueck auf DIESELBE Seite mit `ok=1` und nicht auf eine eigene Dankseite:
   * ein Seitenwechsel nach einem Formular ist fuer jemanden mit Bildschirmlupe
   * ein Suchen von vorn. Die Bestaetigung steht dort als `role="status"`.
   */
  return NextResponse.redirect(new URL(`${ziel}?ok=1`, anfrage.url), 303);
}
