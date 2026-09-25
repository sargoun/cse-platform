import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { withPersonScope, withTenant, type Sitzung } from '@/server/kontext/index';
import { KeineAnstellungFehler, mandantDerAnstellung }
  from '@/server/services/zeit/einwand';
import {
  AbwesenheitNichtGefunden, ArtUngeklaertFehler, AuBisVorBeginn, meldeAbwesenheit,
} from '@/server/services/abwesenheit/index';
import { ZeitraumFehler } from '@/server/services/abwesenheit/tage';
import { datenbankGrund, zurMaske } from '../formular';

/**
 * `POST /api/mein/abwesenheit` — der Mensch meldet eine Abwesenheit (EMP-10).
 *
 * **Dies ist der eine Schreibweg im Mitarbeiterportal, der ein RECHT
 * verlangt**, und zwar `zeit.abwesenheit_melden` (SEITENKARTE §7). Es ist das
 * einzige Schreibrecht, das die Rolle `mitarbeiter` von Haus aus haelt — und
 * die INSERT-Policy auf `abwesenheit` prueft denselben Schluessel noch einmal,
 * unabhaengig von dieser Datei (AUT-05: zwei Linien, nie eine).
 *
 * **Eine MELDUNG, kein Antrag.** Die Seitenkarte fuehrt zwei verschiedene
 * Wege: `/portal/mein/abwesenheit/neu` ist die „sickness or absence report",
 * `/portal/mein/antraege/neu` der „leave request or shift swap". Deshalb
 * entsteht hier eine Abwesenheit im Zustand, den der Dienst fuer eine Meldung
 * vorsieht (`erfasst` — zur Kenntnis genommen), und kein Vorgang, ueber den
 * noch jemand entscheiden muesste. Wer Urlaub will, stellt einen Antrag.
 *
 * **Der Grund bleibt drin, wo er hingehoert.** `bemerkung`, `au_*` und
 * `dokument_id` darf `cse_app` schreiben und NICHT lesen (0073, Art. 9 DSGVO).
 * Diese Route reicht sie durch, und keine Antwort gibt sie zurueck.
 *
 * **Der aktive Mandant der Sitzung ist nicht zwingend der der Meldung.** Ein
 * Mensch mit zwei Beschaeftigungen meldet sich bei EINER Gesellschaft ab
 * (D-09, O-209); welche das ist, sagt die gewaehlte Beschaeftigung, und der
 * Mandant wird daraus serverseitig abgeleitet (K-02). `authorize` bekommt
 * deshalb genau diesen Mandanten als aktiven — geprueft wird die
 * Mitgliedschaft des Menschen DORT, nicht anderswo.
 *
 * **Jede Abweisung fuehrt auf die Maske zurueck** (V-188, D-599). Vorher
 * kamen die Abweisungen der Route als JSON, und die der DATENBANK gar nicht:
 * die doppelte Meldung (`ab_keine_dublette`, 23P01) und die Bescheinigung vor
 * dem ersten Tag (`ab_au_bis`, 23514) trugen keinen `status`, wurden
 * weitergeworfen und endeten als rohe 500 — ausgerechnet auf dem Weg, den
 * jemand morgens krank vom Telefon aus nimmt. Die Buero-Route kannte die
 * doppelte Meldung schon als „die haeufigste Eingabe am Telefon"; dieser Weg
 * nicht. Die Bescheinigung prueft jetzt der Dienst VOR dem Schreiben
 * (`AuBisVorBeginn`), die Datenbank bleibt die zweite Linie.
 */
export const dynamic = 'force-dynamic';

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
/** Die Maske, auf die jede Abweisung zurueckfuehrt — das einzige Formular dieses Wegs. */
const MASKE = '/portal/mein/abwesenheit/neu';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function textOder(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

function uuidOder(daten: FormData, feld: string): string | null {
  const wert = textOder(daten, feld);
  return wert !== null && UUID.test(wert) ? wert : null;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  if (sitzung.personId === null || sitzung.personId === '') {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const daten = await anfrage.formData();
  const anstellungId = uuidOder(daten, 'anstellung');
  const abwesenheitsartId = uuidOder(daten, 'abwesenheitsart');
  const von = textOder(daten, 'von');
  const bis = textOder(daten, 'bis');
  const auBis = textOder(daten, 'au_bis');
  const ja = (feld: string): string | null => (daten.get(feld) === 'ja' ? 'ja' : null);
  /*
   * Was zurueckreist: Auswahlen, Tage und Haken — die Bemerkung NICHT. Sie
   * darf `cse_app` nicht einmal lesen (0073, Art. 9 DSGVO), und eine Adresse
   * landet in Verlauf und Protokollen. Die Maske bittet darum, sie noch einmal
   * einzugeben.
   */
  const maske = (grund: string): NextResponse => zurMaske(anfrage, MASKE, grund, {
    anstellung: anstellungId, abwesenheitsart: abwesenheitsartId, von, bis,
    von_halbtags: ja('von_halbtags'), bis_halbtags: ja('bis_halbtags'),
    au_vorliegt: ja('au_vorliegt'), au_bis: auBis,
    bemerkung_neu: textOder(daten, 'bemerkung') === null ? null : 'ja',
  });
  if (anstellungId === null) return maske('keine_anstellung');
  if (abwesenheitsartId === null) return maske('keine_art');
  if (von === null || bis === null || !DATUM.test(von) || !DATUM.test(bis)
      || (auBis !== null && !DATUM.test(auBis))) {
    return maske('kein_datum');
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) => {
      const mandantId = await withPersonScope(tx, sitzung, async (kontext) =>
        mandantDerAnstellung(kontext, anstellungId));

      const imMandanten: Sitzung = {
        ...sitzung, ansicht: 'mandant', aktiverMandantId: mandantId, portal: 'mitarbeiter',
      };
      return withTenant(tx, imMandanten, async (kontext) => {
        await authorize(
          {
            benutzerId: imMandanten.benutzerId,
            personId: imMandanten.personId,
            aktiverMandantId: mandantId,
            ansicht: 'mandant',
            aal: imMandanten.aal,
            portal: 'mitarbeiter',
            sitzungId: imMandanten.sitzungId,
          },
          { recht: 'zeit.abwesenheit_melden', mandantId, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return meldeAbwesenheit(kontext, {
          anstellungId,
          abwesenheitsartId,
          von,
          bis,
          vonHalbtags: daten.get('von_halbtags') === 'ja',
          bisHalbtags: daten.get('bis_halbtags') === 'ja',
          bemerkung: textOder(daten, 'bemerkung'),
          auBescheinigungVorliegt: daten.get('au_vorliegt') === 'ja',
          auBis,
        });
      });
    });
  } catch (fehler) {
    // Eine fremde Beschaeftigung bietet das Formular nicht an (AUT-06).
    if (fehler instanceof KeineAnstellungFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    const auth = autorisierungsAntwort(fehler);
    if (auth !== null) return auth;
    // „Fuer diese Art ist nicht hinterlegt, ob sie bezahlt ist" (O-139) ist
    // eine Auskunft, kein Serverfehler — und keine JSON-Seite.
    if (fehler instanceof ArtUngeklaertFehler) return maske('art_ungeklaert');
    if (fehler instanceof AbwesenheitNichtGefunden) return maske('art_nicht_waehlbar');
    if (fehler instanceof ZeitraumFehler) return maske(fehler.grund);
    if (fehler instanceof AuBisVorBeginn) return maske(fehler.grund);
    const ausDatenbank = datenbankGrund(fehler);
    if (ausDatenbank !== null) return maske(ausDatenbank);
    const status = (fehler as { status?: number }).status;
    const code = (fehler as { code?: string }).code;
    if (typeof status === 'number' && typeof code === 'string') return maske('ungueltige_eingabe');
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal/mein/antraege', anfrage),
    303,
  );
}
