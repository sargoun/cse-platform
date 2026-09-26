import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withPersonScope, withTenant, type Sitzung } from '@/server/kontext/index';
import { KeineAnstellungFehler, mandantDerAnstellung }
  from '@/server/services/zeit/einwand';
import { AntragAbgewiesen, reicheAntragEin } from '@/server/services/abwesenheit/antrag';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { datenbankGrund, zurMaske } from '../formular';

/**
 * `POST /api/mein/antraege` — der Mensch reicht einen Antrag ein (EMP-10).
 *
 * **Kein Rechteschluessel, und das ist kein Loch.** EMP-10 fuehrt das
 * Einreichen als Selbstzugriff (`S`, SEITENKARTE §7): „Almost nothing here is
 * a permission." Ein erfundener Schluessel muesste jeder Mitarbeiterrolle
 * gebunden werden — also nichts pruefen und dabei behaupten, man pruefe.
 * Bewacht wird der Weg dreifach:
 *
 *  1. durch die Sitzung und den Ursprungsvergleich,
 *  2. durch den serverseitig aufgeloesten Mandanten — er kommt aus der
 *     Beschaeftigung, nie aus einem Feld der Anfrage (K-02, Invariante 3),
 *  3. durch die Policy `t_selbst_einreichen` auf `antrag`, die nur Zeilen
 *     zulaesst, deren Anstellung dem angemeldeten Menschen gehoert, plus die
 *     restriktive K-04-Mitarbeiterdecke darueber.
 *
 * **Der Umweg ueber zwei Scopes ist der Punkt** (K-18): im Personen-Scope ist
 * `app.aktiver_mandant()` NULL, und keine Schreibpolicy traefe zu. Also erst
 * die Beschaeftigung im Personen-Scope aufloesen — eine fremde id liefert dort
 * null Zeilen und damit 404, nicht 403 (AUT-06) —, dann `withTenant` mit genau
 * diesem Mandanten betreten, mit `portal: 'mitarbeiter'`, damit die Decke
 * weiter gilt.
 *
 * **303 und kein JSON — auch nicht bei einer Abweisung** (V-187, D-599).
 * Das Formular ist ein echtes `<form method="post">`, damit es auf einem
 * alten Diensttelefon ohne JavaScript funktioniert; eine JSON-Antwort waere
 * dort eine Sackgasse. Vorher kam jede Abweisung als JSON zurueck, und die
 * des Ausloesers `antrag_pflichtfelder` (0074) — etwa jeder Tauschantrag,
 * weil das Formular weder Schicht noch Partner schickte — als rohe 500. Jetzt
 * fuehrt jede Abweisung auf die Maske, mit dem Grund als Schluessel und den
 * gewaehlten Werten (`zurMaske`). Nur eine FREMDE Beschaeftigung bleibt 404:
 * das Formular bietet sie nicht an, und wer sie schickt, hat die Anfrage
 * nachgebaut (AUT-06).
 */
export const dynamic = 'force-dynamic';

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
/** Die Maske, auf die jede Abweisung zurueckfuehrt — das einzige Formular dieses Wegs. */
const MASKE = '/portal/mein/antraege/neu';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function textOder(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

function uuidOder(daten: FormData, feld: string): string | null {
  const wert = textOder(daten, feld);
  // Ein Wert, der keine id ist, wird VERWORFEN und nicht durchgereicht: die
  // Datenbank soll ihn gar nicht erst sehen.
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
    // Ein Konto ohne Person hat keine Beschaeftigung — und damit nichts, wofuer
    // es einen Antrag stellen koennte.
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const daten = await anfrage.formData();
  const anstellungId = uuidOder(daten, 'anstellung');
  const antragsartId = uuidOder(daten, 'antragsart');
  const von = textOder(daten, 'von');
  const bis = textOder(daten, 'bis');
  const abwesenheitsartId = uuidOder(daten, 'abwesenheitsart');
  const einsatzId = uuidOder(daten, 'einsatz');
  const tauschPartnerAnstellungId = uuidOder(daten, 'tauschpartner');
  /*
   * Was zurueckreist: Auswahlen und Tage — die Nachricht nicht. Sie kann
   * sagen, WARUM jemand frei braucht, und eine Adresse landet in Verlauf und
   * Protokollen; die Maske bittet darum, sie noch einmal einzugeben.
   */
  const maske = (grund: string): NextResponse => zurMaske(anfrage, MASKE, grund, {
    anstellung: anstellungId, antragsart: antragsartId, abwesenheitsart: abwesenheitsartId,
    von, bis, einsatz: einsatzId, tauschpartner: tauschPartnerAnstellungId,
    nachricht_neu: textOder(daten, 'nachricht') === null ? null : 'ja',
  });
  if (anstellungId === null) return maske('keine_anstellung');
  if (antragsartId === null) return maske('keine_antragsart');
  if ((von !== null && !DATUM.test(von)) || (bis !== null && !DATUM.test(bis))) {
    return maske('kein_datum');
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) => {
      const mandantId = await withPersonScope(tx, sitzung, async (kontext) =>
        mandantDerAnstellung(kontext, anstellungId));

      const imMandanten: Sitzung = {
        ...sitzung, ansicht: 'mandant', aktiverMandantId: mandantId, portal: 'mitarbeiter',
      };
      return withTenant(tx, imMandanten, async (kontext) => reicheAntragEin(kontext, {
        anstellungId,
        antragsartId,
        vonDatum: von,
        bisDatum: bis,
        abwesenheitsartId,
        einsatzId,
        tauschPartnerAnstellungId,
        nachricht: textOder(daten, 'nachricht'),
      }));
    });
  } catch (fehler) {
    if (fehler instanceof KeineAnstellungFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    const auth = autorisierungsAntwort(fehler);
    if (auth !== null) return auth;
    // Die Vorpruefung des Dienstes nennt das Feld (V-187).
    if (fehler instanceof AntragAbgewiesen) return maske(fehler.grund);
    // Die zweite Linie: Ausloeser, Pruefbedingung, Fremdschluessel, Kalender.
    const ausDatenbank = datenbankGrund(fehler);
    if (ausDatenbank !== null) {
      return maske(ausDatenbank === 'ueberlappt' ? 'ungueltige_eingabe' : ausDatenbank);
    }
    const status = (fehler as { status?: number }).status;
    const code = (fehler as { code?: string }).code;
    if (status === 404) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (typeof status === 'number' && typeof code === 'string') return maske('ungueltige_eingabe');
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal/mein/antraege', anfrage),
    303,
  );
}
