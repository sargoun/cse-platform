import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';
import { FreigabeErforderlich, RechtsgrundlageFehlt } from '@/server/agent/policy';
import {
  BehinderungFehler, KanalNichtVerbundenFehler, dokumentiereVersand,
  type Versandart,
} from '@/server/services/bau/behinderung';

/**
 * `POST /api/bau/behinderungen/[id]/versenden` — den Versand DOKUMENTIEREN
 * (BAU-06, Invariante 7).
 *
 * **Vier Tore in dieser Reihenfolge, und die Reihenfolge ist die Zusage:**
 *
 *  1. Der Kanal. `e_mail` und `portal` sind **nicht verbunden** — es gibt in
 *     dieser Anwendung keinen Mailversand (O-116). Sie werden abgewiesen und
 *     nicht nachgebaut (CLAUDE.md: keine Schein-Integrationen).
 *  2. `server/agent/policy.ts`. Ohne genehmigte Freigabe mit benanntem
 *     Menschen und mit einem Hash ueber DEN Text, der in der Zeile steht, geht
 *     nichts hinaus. Wer nach der Freigabe den Text aendert, hat keine
 *     Freigabe mehr fuer das, was er sendet.
 *  3. Das Schreiben als Dokument. Ist der Speicher nicht verbunden, entsteht
 *     NICHTS — kein Absendedatum, kein Zustandswechsel, keine Zeile, die sich
 *     auf eine Datei beruft, die es nicht gibt.
 *  4. Erst danach `angezeigt_am`, gestempelt vom Server.
 *
 * **Die Richtlinie wird bewusst NICHT geladen.** `gate()` ohne Richtlinie ist
 * fail-closed: eine Behinderungsanzeige geht in dieser Anwendung nur mit einer
 * menschlichen Freigabe hinaus, nie automatisch. Sie ist eine
 * anspruchswahrende Rechtserklaerung, kein Rundschreiben.
 *
 * `bau.behinderung_erstellen` und nicht `versand.freigeben`: hier wird
 * dokumentiert, was ein Mensch getan hat. Die FREIGABE dafuer ist ein
 * anderer Vorgang mit einem anderen Recht — und sie wird hier geprueft,
 * nicht erteilt (D-250).
 *
 * // TODO(client, O-260): Wer gibt eine Behinderungsanzeige nach § 6 Abs. 1
 * VOB/B frei — die Bauleitung selbst oder ein Zweiter? `versand.freigeben` ist
 * heute an `super_admin`/`admin` gebunden und fuer `leitung` nur bindbar.
 *
 * `POST` statt `PATCH`: der Aufrufer ist ein HTML-Formular.
 */
export const dynamic = 'force-dynamic';

function fehlerAntwort(code: string, meldung: string, status: number): NextResponse {
  return NextResponse.json({ fehler: code, meldung }, { status });
}

export async function POST(
  anfrage: NextRequest,
  kontextParams: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const { id } = await kontextParams.params;
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const feld = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };
  const empfaenger = feld('empfaenger');
  const freigabeId = feld('freigabe');
  if (empfaenger === '') {
    return fehlerAntwort('ungueltige_eingabe',
      'Der Empfänger fehlt — eine Anzeige ohne benannten Empfänger ist kein Nachweis.', 422);
  }
  if (freigabeId === '') {
    return fehlerAntwort('FREIGABE_ERFORDERLICH',
      'Der Versand verlangt die Kennung einer genehmigten Freigabe (Invariante 7, APR-07). '
      + 'Es wurde nichts versendet und nichts dokumentiert.', 409);
  }

  const speicher = waehleSpeicher();
  let ergebnis: { readonly dokumentId: string; readonly angezeigtAm: string };
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: 'bau.behinderung_erstellen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return dokumentiereVersand(
          kontext,
          { id, versandart: feld('versandart') as Versandart, empfaenger, freigabeId },
          speicher,
          // Fail-closed: keine Richtlinie, also niemals ohne Menschen.
          null,
        );
      }))) as { readonly dokumentId: string; readonly angezeigtAm: string };
  } catch (fehler: unknown) {
    if (fehler instanceof KanalNichtVerbundenFehler) {
      return fehlerAntwort(fehler.code, fehler.message, fehler.status);
    }
    if (fehler instanceof NichtVerbundenFehler) {
      return fehlerAntwort(fehler.code,
        'Der Dokumentenspeicher ist nicht verbunden. Es wurde NICHTS versendet, nichts '
        + 'archiviert und kein Absendedatum gesetzt.', fehler.status);
    }
    // Die Fehler des Tors WOERTLICH weiter: sie sagen, was fehlt.
    if (fehler instanceof FreigabeErforderlich || fehler instanceof RechtsgrundlageFehlt) {
      return fehlerAntwort(fehler.code, fehler.message, 409);
    }
    if (fehler instanceof BehinderungFehler) {
      return fehlerAntwort(fehler.grund, fehler.message,
        fehler.grund === 'nicht_gefunden' ? 404 : fehler.status);
    }
    if (fehler instanceof NichtGefundenFehler) {
      return fehlerAntwort('nicht_gefunden', 'Nicht gefunden.', 404);
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return fehlerAntwort('keine_sitzung', 'Keine Sitzung.', 401);
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return fehlerAntwort('zweiter_faktor', 'Zweiter Faktor nötig.', 403);
    }
    throw fehler;
  }

  const mandant = feld('mandant');
  const projekt = feld('projekt');
  if (mandant !== '' && projekt !== '') {
    return NextResponse.redirect(internesZiel(
      feld('zurueck') === '' ? null : feld('zurueck'),
      `/portal/${mandant}/bau/projekte/${projekt}/behinderungen/${id}`,
      anfrage,
    ), 303);
  }
  return NextResponse.json({
    dokument_id: ergebnis.dokumentId, angezeigt_am: ergebnis.angezeigtAm,
  });
}
