import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { GeldFehler, parseGeld } from '@/server/services/finanz/geld';
import { maskeMitEingaben } from '@/lib/formular/maske';
import { istGueltigerKalendertag, tagDeutsch } from '@/lib/datum/kalendertag';
import {
  StufenFehler, bestaetigeStufe, type Folgeaktion, type Zinsberechnung,
} from '@/server/services/finanz/mahnung/stufen';

/**
 * `POST /api/einstellungen/mahnwesen` — eine Mahnstufe bestätigen (FIN-15,
 * O-19).
 *
 * Der Handler bleibt dünn: prüfen, den Dienst rufen, antworten. Die Ablösung
 * der vorherigen Fassung entscheidet nicht er, sondern `bestaetigeStufe` —
 * und die Überlappung weist die Datenbank ab.
 *
 * `mahnung.schreiben` und nicht `mahnung.freigeben`: hier wird die REGEL
 * gesetzt, nicht ein Brief freigegeben. Wer Stufen pflegt, lässt damit noch
 * nichts hinausgehen.
 */
export const dynamic = 'force-dynamic';

const ZINSARTEN: ReadonlySet<string> = new Set(
  ['keine', 'gesetzlich_b2b', 'gesetzlich_b2c', 'vertraglich']);

function zurueck(anfrage: NextRequest, hinweis?: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(`/portal/${slug}/einstellungen/mahnwesen`, erwarteterUrsprung(anfrage));
  if (hinweis !== undefined) url.searchParams.set('hinweis', hinweis);
  return NextResponse.redirect(url, 303);
}

/** Die Felder der Maske, die bei einer Abweisung zurückreisen (D-599, V-214). */
const MASKE_FELDER = [
  'stufe', 'tage', 'bezeichnung', 'gebuehr', 'zinsberechnung', 'aufschlag',
  'folgeaktion', 'gueltigAb', 'textbaustein', 'ohneMahntext',
] as const;

/**
 * **Eine Abweisung bringt die Eingaben zurück** (V-214). Mit dem Mahntext
 * ist die Maske ein Formular, in dem jemand einen Absatz geschrieben hat —
 * ihn wegen eines Tippfehlers im Datum neu zu schreiben, wäre der Grund,
 * es beim nächsten Mal zu lassen. Der Grund reist als Schlüssel (`fehler`),
 * der Satz dazu wie bisher als `hinweis`.
 */
function zurueckMitEingaben(
  anfrage: NextRequest, grund: string, hinweis: string, daten: FormData,
): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const werte: Record<string, string | null> = { hinweis };
  for (const name of MASKE_FELDER) {
    const w = daten.get(name);
    werte[name] = typeof w === 'string' ? w : null;
  }
  const pfad = maskeMitEingaben(`/portal/${slug}/einstellungen/mahnwesen`, grund, werte);
  return NextResponse.redirect(new URL(pfad, erwarteterUrsprung(anfrage)), 303);
}

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

  const stufe = Number.parseInt(text('stufe') ?? '', 10);
  const tage = Number.parseInt(text('tage') ?? '', 10);
  const bezeichnung = text('bezeichnung');
  const gebuehr = text('gebuehr');
  const zinsart = text('zinsberechnung') ?? 'keine';
  const gueltigAb = text('gueltigAb');
  const aufschlag = text('aufschlag');

  if (bezeichnung === null || gebuehr === null || gueltigAb === null
      || !Number.isInteger(stufe) || stufe < 1
      || !Number.isInteger(tage) || tage < 0
      || !ZINSARTEN.has(zinsart)) {
    /* Ein Formular bekommt eine Seite, keine geschweifte Klammer (D-599). */
    return zurueckMitEingaben(anfrage, 'unvollstaendig',
      'Stufe, Frist, Bezeichnung, Gebühr, Zinsart und „Gültig ab“ sind Pflicht.', daten);
  }
  /*
   * Ein Tag, den es nicht gibt (31.02.), kam vorher als `22008` aus der
   * Datenbank und damit als 500 (V-217) — jetzt als Satz am Formular.
   */
  if (!istGueltigerKalendertag(gueltigAb)) {
    return zurueckMitEingaben(anfrage, 'unvollstaendig',
      '„Gültig ab“ ist kein Kalendertag.', daten);
  }

  /*
   * Der Mahntext (V-214): ein Text setzt ihn, „ohne Mahntext“ entfernt ihn,
   * ein leeres Feld übernimmt den der laufenden Fassung (D-705).
   */
  const textbaustein: string | null | undefined = daten.get('ohneMahntext') === '1'
    ? null
    : (text('textbaustein') ?? undefined);

  try {
    const gebuehrCent = parseGeld(gebuehr);
    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'mahnung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await bestaetigeStufe(kontext, {
          stufe, bezeichnung, tageNachFaelligkeit: tage, gebuehrCent,
          zinsberechnung: zinsart as Zinsberechnung,
          ...(aufschlag === null
            ? {}
            : { zinsAufschlagBp: Number.parseInt(aufschlag, 10) }),
          folgeaktion: (text('folgeaktion') ?? 'keine') as Folgeaktion,
          gueltigAb,
          ...(textbaustein === undefined ? {} : { textbaustein }),
        });
        return zurueck(anfrage,
          `Stufe ${String(stufe)} ist ab ${tagDeutsch(gueltigAb)} bestätigt. Der Mahnlauf `
          + 'schlägt sie ab jetzt vor — versendet wird weiterhin nichts ohne Freigabe.');
      }))) as NextResponse;
  } catch (fehler: unknown) {
    /**
     * **Der Aufrufer ist ein Formular, also bekommt er eine SEITE zurück.**
     *
     * Eine JSON-Antwort mit 422 lässt den Browser eine Datei anzeigen, auf der
     * `{"fehler":"ueberlappt"}` steht — der Mensch hat dann seine Eingabe
     * verloren und weiss nicht, was er tun soll. Der Satz gehört dorthin, wo
     * er ihn liest.
     */
    if (fehler instanceof GeldFehler) {
      return zurueckMitEingaben(anfrage, 'geld', fehler.message, daten);
    }
    if (fehler instanceof StufenFehler) {
      return zurueckMitEingaben(anfrage, fehler.grund, fehler.message, daten);
    }
    /*
     * Auth-Würfe an EINER Stelle (V-217): von Hand übersetzt fehlten
     * `KontoGesperrtFehler` und `ZuVieleVersucheFehler`, sie endeten als 500.
     */
    const auth = autorisierungsAntwort(fehler);
    if (auth !== null) return auth;
    throw fehler;
  }
}
