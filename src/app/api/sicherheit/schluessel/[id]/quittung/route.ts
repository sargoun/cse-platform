import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechteImKontext } from '@/server/auth/kontext-rechte';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  buche, istEmpfaengerArt, istEreignis,
} from '@/server/services/security/schluessel';
import { alsAntwort } from '../../../antwort';
import { feldText as text } from '../../../formular';

/**
 * `POST /api/sicherheit/schluessel/[id]/quittung` — eine Journalzeile
 * schreiben (SEC-07, TIM-08, LEG-01).
 *
 * **Alle acht Ereignisse über EINE Adresse.** Übergabe, Rücknahme,
 * Verlustmeldung, Wiederauffinden, Sperrung, Entsperrung, Vernichtung und
 * Inventur brauchen dieselbe Sitzung, denselben Ursprungscheck, denselben
 * Mandantenkontext und dasselbe Recht — und alle acht sind dieselbe Zeile in
 * derselben Tabelle. Acht Adressen wären acht Stellen, an denen die Prüfung
 * fehlen kann.
 *
 * **Die Zeit kommt nicht von hier.** Der Server stempelt `quittiert_am` im
 * Auslöser (0079 §5); was das Formular mitschickt, ist höchstens
 * `geraete_zeit` — eine Behauptung, die daneben gespeichert wird und nie an
 * die Stelle der Serverzeit tritt (Invariante 5, TIM-08).
 *
 * **Die zweite Übergabe ohne Rücknahme weist die DATENBANK ab**
 * (`sq_offene_ausgabe_uk`, Abnahme 4). Der Dienst übersetzt den
 * Eindeutigkeitsverstoss in einen Satz; abgelehnt hat ihn der Index, und zwar
 * auch für einen Weg, der diese Adresse nicht benutzt.
 *
 * **Die Unterschrift ist heute ein NAME.** Das Bild vom Bildschirm braucht
 * `POST /api/dokumente/upload-ticket` und eine Zeile im geschlossenen Register
 * `einsatz_medien_bezug`; beides gibt es für `schluessel_quittung` nicht, und
 * die Oberfläche sagt das, statt einen Erfolg vorzutäuschen (D-232).
 *
 * **Die Bewegung kann zugleich ins Wachbuch** (V-180, SEC-05 „key"):
 * `im_wachbuch=1` schreibt in derselben Transaktion eine Seite der Art
 * `schluessel` und hängt die Quittung an sie. Dafür braucht es ZUSÄTZLICH
 * `wachbuch.schreiben` — geprüft vorher, mit einem Satz statt eines
 * Zeilenschutzfehlers.
 *
 * **Ein Browser bekommt eine Seite, kein JSON** (D-599): mit
 * `zurueck_fehler` führt eine Abweisung dorthin zurück, der Grund als
 * `?fehler=` (D-728 auf der Seite).
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest,
  kontextParam: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const { id } = await kontextParam.params;
  const daten = await anfrage.formData();
  const mandant = String(daten.get('mandant') ?? '');
  const fehlerZiel = text(daten, 'zurueck_fehler');
  /** D-599: ein Formular geht mit dem Grund zurück auf seine Seite. */
  const abgewiesen = (grund: string, antwort: () => NextResponse): NextResponse => {
    if (fehlerZiel === null) return antwort();
    const trenner = fehlerZiel.includes('?') ? '&' : '?';
    return NextResponse.redirect(internesZiel(
      `${fehlerZiel}${trenner}fehler=${encodeURIComponent(grund)}`,
      `/portal/${mandant}/security/schluessel/${id}`, anfrage), 303);
  };
  const art = daten.get('art');
  if (!istEreignis(art)) {
    return abgewiesen('pflichtfeld_fehlt', () =>
      NextResponse.json({ fehler: 'pflichtfeld_fehlt' }, { status: 400 }));
  }
  const empfaengerArt = daten.get('empfaenger_art');
  const imWachbuch = daten.get('im_wachbuch') === '1';

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'schluessel.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        if (imWachbuch) {
          const rechte = await rechteImKontext(kontext, 'wachbuch.schreiben');
          if (rechte['wachbuch.schreiben'] !== true) {
            throw Object.assign(new Error(
              'Ins Wachbuch schreibt, wer das Wachbuch führen darf (wachbuch.schreiben).'), {
              code: 'kein_wachbuchrecht', status: 403,
            });
          }
        }
        return buche(kontext, {
          schluesselId: id,
          art,
          empfaengerArt: istEmpfaengerArt(empfaengerArt) ? empfaengerArt : null,
          anstellungId: text(daten, 'anstellung'),
          kundeId: text(daten, 'kunde'),
          firmaId: text(daten, 'firma'),
          empfaengerName: text(daten, 'empfaenger_name'),
          unterzeichnerName: text(daten, 'unterzeichner'),
          geplanteRueckgabe: text(daten, 'geplante_rueckgabe'),
          aufhebtQuittungId: text(daten, 'aufhebt'),
          bemerkung: text(daten, 'bemerkung'),
          /**
           * Die Geräteuhr wandert MIT, wenn die Oberfläche sie kennt — und
           * wird sofort als Abweichung verrechnet (TIM-08). Sie zu
           * verschweigen wäre bequemer und nähme der Auswertung genau die
           * Tatsache, für die Invariante 5 die Spalte verlangt.
           */
          geraeteZeit: text(daten, 'geraete_zeit'),
          nachgetragen: daten.get('nachgetragen') === '1',
          imWachbuch,
        });
      }));
  } catch (fehler) {
    const f = fehler as { status?: unknown; code?: unknown };
    if (typeof f.status === 'number' && typeof f.code === 'string') {
      const grund = f.code;
      return abgewiesen(grund, () => alsAntwort(fehler) ?? NextResponse.json(
        { fehler: grund }, { status: 400 }));
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(
      daten.get('zurueck') as string | null,
      `/portal/${mandant}/security/schluessel/${id}`,
      anfrage,
    ),
    303,
  );
}
