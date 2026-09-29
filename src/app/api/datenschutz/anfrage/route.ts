import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { withEingang } from '@/server/kontext/eingang';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { mitSprache, SPRACHEN, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';
import { PFLICHTWEG_FEHLER_TEXTE, pflichtwegMeldung } from '@/lib/i18n/texte';
import {
  AnfrageFehler, nimmAn, type AnfrageArt, type AnfrageFehlerGrund,
} from '@/server/services/datenschutz/anfrage';

/**
 * `POST /api/datenschutz/anfrage` — der öffentliche Eingang für
 * Betroffenenrechte (LEG-09, Art. 15–21 DSGVO).
 *
 * **Kein Konto, keine Anmeldung, kein Ursprungstest.** Genau wie
 * `/api/anfrage`: wer eine Auskunft verlangt, ist per Definition niemand, den
 * die Plattform kennt. Ein `istGleicherUrsprung`-Riegel wäre hier sogar
 * schädlich — er sperrte den Weg für jemanden, der das Formular aus einem
 * E-Mail-Programm heraus öffnet.
 *
 * **Geschrieben wird über den EINGANGSPRINZIPAL**, der `formular.schreiben`
 * hält und ausdrücklich kein Leserecht: er nimmt entgegen und kann nichts
 * zurückholen. Eine Übernahme der öffentlichen Fläche liefert damit keinen
 * Lesezugriff auf die Liste derer, die eine Auskunft verlangt haben — und das
 * ist die Liste, die am meisten verrät.
 *
 * **Der Mandant kommt aus dem Formular und nicht aus einem Parameter der
 * Adresse.** Die vier Gesellschaften sind verschiedene juristische Personen,
 * jede für ihre Verarbeitung selbst verantwortlich; welche gemeint ist, sagt
 * der Anfragende.
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

  /**
   * Eine Abweisung: ein Programm bekommt JSON mit dem Satz (D-599), ein
   * Browser die Seite mit dem GRUND (D-769, V-272).
   *
   * **Nur der Grund reist durch die Adresse.** Hier reiste der Satz im
   * Parameter `meldung`, und die Seite zeigte ihn in ihrem Warnkasten — auch
   * den eines präparierten Links. Jetzt schlägt die Seite den Grund in ihrer
   * Sprache nach (`PFLICHTWEG_FEHLER_TEXTE`); keine Eingabe des Anfragenden
   * steht in der Adresse.
   */
  const abweisen = (
    status: number, grund: AnfrageFehlerGrund | 'gesellschaft_fehlt', meldung: string,
  ): NextResponse => {
    if (!alsSeite) return NextResponse.json({ ok: false, meldung }, { status });
    const ziel = new URL(mitSprache('/datenschutz/anfrage', sprache), anfrage.url);
    ziel.searchParams.set('fehler', grund);
    return NextResponse.redirect(ziel, 303);
  };

  /*
   * Den Mandanten NICHT aus dem Formularwert bauen, sondern nachschlagen: der
   * Wert kommt von aussen, und `withEingang` bindet ihn als aktiven Mandanten.
   * Ein nicht existierender Slug gaebe sonst eine Sitzung ohne Gesellschaft,
   * in der jede Policy schweigend null Zeilen sieht.
   */
  const [gesellschaft] = await (db().begin((tx: postgres.TransactionSql) =>
    withOeffentlich(tx, (kontext) => kontext.abfrage<{ id: string }>(
      `select id from mandant where slug = $1 and archiviert_am is null`, [bereich],
    ))) as Promise<readonly { id: string }[]>);

  if (gesellschaft === undefined) {
    return abweisen(404, 'gesellschaft_fehlt',
      PFLICHTWEG_FEHLER_TEXTE[sprache].anfrage.fehler.gesellschaft_fehlt);
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withEingang(tx, gesellschaft.id, (kontext) => nimmAn(kontext, {
        art: String(daten.get('art') ?? '') as AnfrageArt,
        name: String(daten.get('name') ?? ''),
        email: String(daten.get('email') ?? ''),
        nachricht: String(daten.get('nachricht') ?? '') || undefined,
        rolleAngabe: String(daten.get('rolle') ?? '') || undefined,
      })));
  } catch (f) {
    /*
     * Der Dienst spricht deutsch; ein Programm bekommt auf Englisch den Satz
     * zum GRUND (V-156), die Seite nur den Grund selbst (D-769).
     */
    if (f instanceof AnfrageFehler) {
      return abweisen(f.status, f.grund,
        pflichtwegMeldung('anfrage', sprache, f.grund, f.message));
    }
    throw f;
  }

  if (!alsSeite) return NextResponse.json({ ok: true });
  return NextResponse.redirect(
    new URL(mitSprache('/datenschutz/anfrage/danke', sprache), anfrage.url), 303);
}
