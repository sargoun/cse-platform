import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  SETZBAR, VorgangFehler, setzePlattformPruefung, setzeVorgangsstand,
  type SetzbarerStatus, type VorgangErgebnis,
} from '@/server/services/radar/vorgang';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { alsAntwort } from '../../sicherheit/antwort';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `POST /api/radar/vorgang` — den Stand einer Bekanntmachung setzen (RAD-07).
 *
 * Drei Stände, ein Formular: geprüft, in Bearbeitung, verworfen. Verworfen
 * ohne Grund weist der Dienst ab, und die Seite sagt warum. **Einreichen
 * steht hier nicht** — D-07: die Vergabeplattformen bieten dafür keine
 * Schnittstelle an, und eine Route, die so hiesse, wäre eine Behauptung.
 *
 * **Und die Plattformprüfung am Vorgang** (`was=plattform`, RAD-09, V-175):
 * was ein Mensch für diese Bekanntmachung über die Plattform nachgesehen hat.
 * Dasselbe Recht, dieselbe Unterseite; sie setzt keinen Stand.
 */
export const dynamic = 'force-dynamic';

/**
 * Wohin eine ABGEWIESENE Handlung zurueckgeht — aus einem GESCHLOSSENEN Satz.
 *
 * **Der Befund, der das gebracht hat.** Diese Route leitete in allen
 * Ausgaengen fest auf die Detailseite `/portal/{bereich}/radar/{id}` um. Die
 * Unterseite `/radar/[id]/status` traegt aber ihr eigenes Formular und ihren
 * eigenen Fehlerblock fuer `?fehler=grund` und `?fehler=mappe_recht` — den
 * nichts je erreichte. Wer dort „Verwerfen" ohne ausreichenden Grund drueckte,
 * landete auf der Detailseite, die davon nichts weiss, und der eingetippte
 * Grund war weg. Dieselbe Aufteilung wie in `/api/freigaben/fenster`: Fehler
 * zum Formular, Erfolg zum Ergebnis.
 *
 * **Und der Name wird aufgeloest, nicht eingesetzt.** Das Formular schickt
 * `status`, nie einen Pfad — sonst waere das Feld eine offene Weiterleitung.
 */
const FORMULARSEITE: Readonly<Record<string, string>> = {
  status: 'status',
};

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const ausschreibung = text(daten, 'ausschreibung') ?? '';
  const status = text(daten, 'status') ?? '';
  /* Nur diese eine zweite Handlung — alles andere ist ein Stand. */
  const plattformPruefung = text(daten, 'was') === 'plattform';
  if (!UUID.test(ausschreibung)) {
    return NextResponse.json({ fehler: 'unbekannte_bekanntmachung' }, { status: 400 });
  }
  if (!plattformPruefung && !(SETZBAR as readonly string[]).includes(status)) {
    return NextResponse.json({ fehler: 'status_unbekannt' }, { status: 400 });
  }

  /*
   * **Der Slug kommt aus der SITZUNG, nicht aus dem Rumpf** (Invariante 3) —
   * wie in `/api/agenten/lauf` und `/api/radar/profil`. Ein verstecktes
   * `mandant`-Feld bestimmte hier allein das Ziel der 303, waehrend gesetzt
   * wurde, was `app.aktiver_mandant()` sagt: wer in einem zweiten Reiter den
   * Bereich gewechselt hatte, landete nach einem richtigen Schreibvorgang auf
   * der Bekanntmachung einer anderen Gesellschaft — also auf einem 404.
   *
   * Der Rollback nimmt die Zuweisung an dieser Variablen nicht zurueck, also
   * hat auch der Fehlerzweig den Slug.
   */
  let slug = '';
  const seite = (): string => `/portal/${slug}/radar/${ausschreibung}`;
  /* Kam das Formular von der Unterseite, gehen Absagen DORTHIN zurueck — mit
     der Eingabe im Blick und einem Satz dazu. */
  const unterseite = eigenerEintrag(FORMULARSEITE, daten.get('zurueck'));
  const formular = (): string => (unterseite === undefined
    ? seite() : `${seite()}/${unterseite}`);

  let ergebnis: VorgangErgebnis | null;
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'radar.status_setzen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [bereich] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (bereich === undefined) throw new NichtGefundenFehler('Bereich ohne Slug');
        slug = bereich.slug;
        if (plattformPruefung) {
          await setzePlattformPruefung(kontext, ausschreibung, text(daten, 'plattformPruefung') ?? '');
          return null;
        }
        const profil = text(daten, 'profil');
        const bewertung = text(daten, 'bewertung');
        return setzeVorgangsstand(kontext, {
          ausschreibungId: ausschreibung,
          status: status as SetzbarerStatus,
          grund: text(daten, 'grund'),
          radarProfilId: profil !== null && UUID.test(profil) ? profil : null,
          bewertungId: bewertung !== null && UUID.test(bewertung) ? bewertung : null,
        });
      })) as Promise<VorgangErgebnis | null>);
  } catch (fehler) {
    /*
     * Der fehlende Grund ist kein Serverfehler, sondern eine Auskunft: die
     * Seite zeigt sie als Satz und behaelt die Eingabe des Menschen im Blick.
     * Dasselbe gilt fuer die Plattformpruefung ohne Vorgang (V-175).
     */
    if (fehler instanceof VorgangFehler
        && (fehler.code === 'grund' || fehler.code === 'mappe_recht'
            || fehler.code === 'plattform' || fehler.code === 'kein_vorgang')) {
      return NextResponse.redirect(
        internesZiel(`${formular()}?fehler=${fehler.code}`, formular(), anfrage), 303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  /* Die Plattformpruefung setzt keinen Stand — sie bleibt auf ihrer Seite. */
  if (ergebnis === null) {
    return NextResponse.redirect(
      internesZiel(`${formular()}?vermerkt=plattform`, formular(), anfrage), 303);
  }

  /* Der ERFOLG geht auf die Detailseite: dort steht der neue Stand im
     Zusammenhang mit Punktzahl, Frist und Plattformstand. */
  return NextResponse.redirect(
    internesZiel(`${seite()}?vermerkt=${encodeURIComponent(ergebnis.status)}`,
      seite(), anfrage), 303);
}
