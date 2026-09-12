import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { NichtVerbundenFehler, SupabaseSpeicher } from '@/server/storage/adapter';
import { FreigabeErforderlich, RechtsgrundlageFehlt } from '@/server/agent/policy';
import { ermittleVorschlaege, legeMahnentwurfAn }
  from '@/server/services/finanz/mahnung/lauf';
import {
  KanalNichtVerbundenFehler, MahnungFehler, dokumentiereVersand, gibFrei, verwirf,
  type Versandart,
} from '@/server/services/finanz/mahnung/index';

/**
 * `POST /api/finanzen/mahnungen` — die vier Schritte des Mahnwesens
 * (FIN-15, Invariante 7).
 *
 * **Vier Aktionen, drei Rechte.** `entwuerfe` und `verwerfen` tragen
 * `mahnung.schreiben`; `freigeben` und `versenden` tragen zusätzlich
 * `mahnung.freigeben` — wer eine Mahnung vorbereitet, gibt sie nicht schon
 * deswegen frei. Das Manifest führt das Eintrittsrecht, die engere Prüfung
 * steht hier, wo sie greift.
 *
 * **Der Versand geht durch `agent/policy.ts`, und die Richtlinie wird bewusst
 * NICHT geladen.** `gate()` ohne Richtlinie ist fail-closed: eine Mahnung
 * geht nur mit einer menschlichen Freigabe hinaus, nie automatisch. Sie ist
 * die Erklärung, an die §286 BGB den Verzug knüpft — kein Rundschreiben.
 *
 * Der Handler bleibt dünn: prüfen, den Dienst rufen, antworten.
 */
export const dynamic = 'force-dynamic';

function zurueck(anfrage: NextRequest, ziel: string, hinweis?: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(`/portal/${slug}/finanzen/mahnungen${ziel}`, anfrage.nextUrl.origin);
  if (hinweis !== undefined) url.searchParams.set('hinweis', hinweis);
  return NextResponse.redirect(url, 303);
}

function fehlerAntwort(code: string, meldung: string, status: number): NextResponse {
  return NextResponse.json({ fehler: code, meldung }, { status });
}

/** Welcher Fehlergrund welchen Status trägt — HTTP gehört in die Route. */
const STATUS: Readonly<Record<MahnungFehler['grund'], number>> = {
  nicht_gefunden: 404,
  kein_entwurf: 409,
  nicht_freigegeben: 409,
  schon_versendet: 409,
  ohne_position: 422,
  ohne_grund: 422,
  zeichen_nicht_darstellbar: 422,
};

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };
  const aktion = text('aktion') ?? '';
  const speicher = new SupabaseSpeicher();

  try {
    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'mahnung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (aktion === 'entwuerfe') {
          const lage = await ermittleVorschlaege(kontext);
          let angelegt = 0;
          for (const vorschlag of lage.vorschlaege) {
            await legeMahnentwurfAn(kontext, vorschlag);
            angelegt += 1;
          }
          return zurueck(anfrage, '',
            angelegt === 0
              ? 'Kein Vorschlag — es wurde nichts angelegt.'
              : `${String(angelegt)} Entwurf/Entwürfe angelegt. Sie tragen keine Nummer, `
                + 'solange niemand freigegeben hat.');
        }

        const mahnungId = text('mahnungId');
        if (mahnungId === null) {
          return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
        }

        if (aktion === 'verwerfen') {
          const grund = text('grund');
          if (grund === null) {
            return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
          }
          await verwirf(kontext, mahnungId, grund);
          return zurueck(anfrage, `/${mahnungId}`, 'Der Entwurf ist verworfen.');
        }

        /* Ab hier: das zweite, engere Recht (Invariante 7). */
        await authorize(
          sitzung,
          { recht: 'mahnung.freigeben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (aktion === 'freigeben') {
          const begruendung = text('begruendung');
          if (begruendung === null) {
            return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
          }
          const { nummer } = await gibFrei(kontext, mahnungId, begruendung);
          return zurueck(anfrage, `/${mahnungId}`,
            `Freigegeben — die Mahnung trägt jetzt die Nummer ${nummer}.`);
        }

        if (aktion === 'versenden') {
          const empfaenger = text('empfaenger');
          const versandart = text('versandart');
          if (empfaenger === null || versandart === null) {
            return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
          }
          const ergebnis = await dokumentiereVersand(
            kontext,
            { id: mahnungId, versandart: versandart as Versandart, empfaenger },
            speicher,
            /* Fail-closed: keine Richtlinie, also niemals ohne Menschen. */
            null,
          );
          return zurueck(anfrage, `/${mahnungId}`,
            `Versand dokumentiert am ${ergebnis.versendetAm}. Ab dem Mahndatum läuft `
            + 'der Verzug.');
        }

        return NextResponse.json({ fehler: 'unbekannte_aktion' }, { status: 400 });
      }))) as NextResponse;
  } catch (fehler: unknown) {
    if (fehler instanceof KanalNichtVerbundenFehler) {
      return fehlerAntwort(fehler.code, fehler.message, 409);
    }
    if (fehler instanceof NichtVerbundenFehler) {
      return fehlerAntwort(fehler.code,
        'Der Dokumentenspeicher ist nicht verbunden. Es wurde NICHTS versendet, nichts '
        + 'archiviert und kein Absendedatum gesetzt.', fehler.status);
    }
    if (fehler instanceof FreigabeErforderlich || fehler instanceof RechtsgrundlageFehlt) {
      return fehlerAntwort(fehler.code, fehler.message, 409);
    }
    if (fehler instanceof MahnungFehler) {
      return fehlerAntwort(fehler.grund, fehler.message, STATUS[fehler.grund]);
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
}
