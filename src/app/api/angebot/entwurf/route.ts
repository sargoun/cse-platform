import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  EntwurfFehler, berichtigePosition, entfernePosition, ziehEntwurfZurueck,
} from '@/server/services/angebot/entwurf';
import { HandAngebotFehler } from '@/server/services/angebot/von-hand';

/**
 * `POST /api/angebot/entwurf` — eine Position berichtigen, entfernen oder den
 * ganzen Entwurf zurückziehen (V-130, D-620).
 *
 * **Eine eigene Adresse und nicht ein viertes `aktion=` auf `api/angebot`.**
 * Dieselbe Begründung wie bei `von-hand` und `freigabe`: das Manifest führt
 * EIN Recht je Pfad, und `api/angebot` trägt `angebot.versenden` — das
 * schwerste der drei, weil dort etwas das Haus verlässt (Invariante 7). Hier
 * verlässt nichts das Haus; hier wird ein Blatt berichtigt, das ausser dem
 * Haus niemand gesehen hat. Das ist `angebot.schreiben`.
 *
 * **Formularweg, also Rücksprung mit `?fehler=`** (D-562). Diese Route liest
 * nur `formData`; eine JSON-Antwort wäre eine weisse Seite mit einem
 * Fehlerobjekt darauf, und der getippte Text wäre weg.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'angebot.schreiben';
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
  const feld = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };
  const zurueckWeg = feld('zurueck');
  const was = feld('was');
  const position = feld('position');
  const angebot = feld('angebot');

  const zurueck = (schluessel: string | null): NextResponse => {
    const ziel = new URL(internesZiel(
      zurueckWeg === '' ? '/portal' : zurueckWeg, '/portal', anfrage));
    if (schluessel !== null) ziel.searchParams.set('fehler', schluessel);
    else ziel.searchParams.set('gespeichert', '1');
    return NextResponse.redirect(ziel, 303);
  };

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /*
         * Linie 1 — IN der gebundenen Transaktion, weil `app.hat_recht` die
         * Sitzungsbindung liest. Linie 2 ist `t_mandant` auf `angebot` und
         * `angebotsposition`, die denselben Schlüssel in ihrer `with
         * check`-Klausel noch einmal verlangen (AUT-05); der Dienst sperrt
         * die Kopfzeile mit `select … for update` und prüft ihn damit ein
         * drittes Mal, in derselben Anweisung, die schreibt.
         */
        await authorize(
          sitzung, { recht: RECHT, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (was === 'zurueckziehen') {
          if (!UUID.test(angebot)) {
            throw new EntwurfFehler('Ohne Angebot kein Rückzug.', 'nicht_gefunden', 404);
          }
          await ziehEntwurfZurueck(kontext, angebot, sitzung.benutzerId);
          return;
        }

        if (!UUID.test(position)) {
          throw new EntwurfFehler('Ohne Position keine Änderung.', 'nicht_gefunden', 404);
        }
        if (was === 'entfernen') {
          await entfernePosition(kontext, position, sitzung.benutzerId);
          return;
        }
        if (was === 'berichtigen') {
          await berichtigePosition(kontext, {
            positionId: position,
            kurztext: feld('kurztext'),
            langtext: feld('langtext'),
            menge: feld('menge'),
            einheit: feld('einheit'),
            einzelpreisEuro: feld('preis'),
          });
          return;
        }
        throw new EntwurfFehler(
          'Unbekannte Handlung.', 'abgewiesen', 400);
      }));
  } catch (fehler) {
    if (fehler instanceof EntwurfFehler) return zurueck(fehler.grund);
    /*
     * `mengeAusEingabe` und `preisAusEingabe` sind die geprüften Funktionen
     * aus `von-hand.ts` und werfen deren Fehler. Sie hier zu übersetzen
     * hiesse, dieselbe Meldung ein zweites Mal zu schreiben — und die zweite
     * Fassung wäre irgendwann die falsche.
     */
    if (fehler instanceof HandAngebotFehler) return zurueck(fehler.grund);
    throw fehler;
  }

  return zurueck(null);
}
