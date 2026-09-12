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
import {
  NachtragFehler, meldeNachtragAn, ordneAufmasszeileZu, type AnordnungForm,
} from '@/server/services/bau/nachtrag';

/**
 * `POST /api/bau/nachtraege` — einen Nachtrag ANMELDEN (BAU-04, BAU-05).
 *
 * **Die Anspruchsgrundlage ist eine Pflichtauswahl ohne Vorgabewert.** Das
 * Formular schickt `grundlage` als Kennung aus `nachtrag_grundlage`; fehlt
 * sie, weist `pruefeGrundlage` mit einem deutschen Satz ab (K-17, O-23). Ein
 * Freitextfeld gibt es an dieser Stelle nicht und einen vorbelegten Absatz
 * des § 2 VOB/B erst recht nicht: eine vorbelegte Grundlage waere eine
 * Rechtsfolge, die niemand gewaehlt hat.
 *
 * **`angemeldet_am` reist mit, `eingereicht_am` nicht.** Der Anspruch haengt
 * an der Ankuendigung VOR Ausfuehrungsbeginn (§ 2 Abs. 6 Nr. 1 VOB/B); die
 * Einreichung der Kalkulation ist ein zweiter Vorgang mit eigenem Recht und
 * eigener Adresse (`…/[id]/einreichen`).
 *
 * **`aufmass_zeile` schliesst die BAU-05-Schleife.** Kommt der Nachtrag aus
 * einer Warnung „ausserhalb des LV", wird die Zeile hier an ihn gehaengt —
 * sonst bliebe dieselbe Warnung nach der Abhilfe stehen, und eine Warnung,
 * die sich nicht abstellen laesst, liest nach drei Wochen niemand mehr.
 *
 * `POST` und nicht `PUT`/`PATCH`: der Aufrufer ist ein HTML-Formular, und ein
 * Formular kennt nur `GET` und `POST` (dieselbe Begruendung wie bei
 * `api/reinigung/reviere/[id]/raeume`).
 */
export const dynamic = 'force-dynamic';

const FORMEN: readonly AnordnungForm[] = ['schriftlich', 'muendlich', 'e_mail', 'unbekannt'];

function fehlerAntwort(code: string, meldung: string, status: number): NextResponse {
  return NextResponse.json({ fehler: code, meldung }, { status });
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  let formular: FormData;
  try {
    formular = await anfrage.formData();
  } catch {
    return fehlerAntwort('ungueltige_eingabe', 'Es wurden keine Daten übertragen.', 422);
  }
  const text = (name: string): string => {
    const wert = formular.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };

  const projektId = text('projekt');
  const angemeldetAm = text('angemeldet_am');
  if (projektId === '') {
    return fehlerAntwort('ungueltige_eingabe', 'Das Projekt fehlt.', 422);
  }
  if (angemeldetAm !== '' && !/^\d{4}-\d{2}-\d{2}$/u.test(angemeldetAm)) {
    return fehlerAntwort('ungueltige_eingabe',
      'Das Anmeldedatum ist kein Kalendertag (JJJJ-MM-TT).', 422);
  }
  const form = text('anordnung_form');
  const aufmassZeile = text('aufmass_zeile');

  let angelegt: { readonly id: string; readonly nummer: string };
  try {
    angelegt = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /**
         * `bau.nachtrag_anmelden` — nicht `bau.schreiben` und nicht
         * `bau.nachtrag_einreichen`. Wer ankuendigt, hat damit noch nichts
         * eingereicht, und wer ein Leistungsverzeichnis pflegt, kuendigt
         * deshalb noch keinen Anspruch an (03-AUTH §12).
         */
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
          { recht: 'bau.nachtrag_anmelden', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        const kopf = await meldeNachtragAn(kontext, {
          projektId,
          titel: text('titel'),
          grundlageId: text('grundlage'),
          begruendung: text('begruendung'),
          angemeldetAm: angemeldetAm === '' ? null : angemeldetAm,
          anordnungForm: (FORMEN as readonly string[]).includes(form)
            ? (form as AnordnungForm) : 'unbekannt',
          angeordnetVon: text('angeordnet_von') === '' ? null : text('angeordnet_von'),
          ausgefuehrtOhneBeauftragung: formular.get('ausgefuehrt_ohne_beauftragung') !== null,
          auftragLeistungId: text('auftrag_leistung') === '' ? null : text('auftrag_leistung'),
        });

        if (aufmassZeile !== '') {
          await ordneAufmasszeileZu(kontext, {
            zeileId: aufmassZeile, nachtragId: kopf.id,
          });
        }
        return kopf;
      }))) as { readonly id: string; readonly nummer: string };
  } catch (fehler: unknown) {
    if (fehler instanceof NachtragFehler) {
      return fehlerAntwort(fehler.grund, fehler.message,
        fehler.grund === 'nicht_gefunden' ? 404 : fehler.status);
    }
    // AUT-06: ein fehlendes Recht sieht von aussen aus wie eine fehlende Zeile.
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

  const mandant = text('mandant');
  if (mandant !== '') {
    return NextResponse.redirect(internesZiel(
      text('zurueck') === '' ? null : text('zurueck'),
      `/portal/${mandant}/bau/projekte/${projektId}/nachtraege/${angelegt.id}`,
      anfrage,
    ), 303);
  }
  return NextResponse.json({ id: angelegt.id, nummer: angelegt.nummer }, { status: 201 });
}
