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
  BehinderungFehler, erstelleBehinderung, type BehinderungGrund,
} from '@/server/services/bau/behinderung';

/**
 * `POST /api/bau/behinderungen` — die Behinderungsanzeige ENTWERFEN
 * (BAU-06, § 6 Abs. 1 VOB/B).
 *
 * **Der Text entsteht aus einer Vorlage, nicht aus einem Textfeld.** Das
 * Formular waehlt `vorlage` aus `behinderung_vorlage`; der Dienst setzt die
 * Platzhalter und weist einen unbekannten AB. Ein Schreiben mit `{ursache}`
 * darin geht an den Auftraggeber und ist peinlich; eines mit einer
 * stillschweigend geleerten Angabe ist gefaehrlich, weil § 6 Abs. 1 VOB/B
 * genau diese Angaben verlangt.
 *
 * **Hier entsteht KEIN Absendedatum.** Eine Behinderungsanzeige wirkt, wenn
 * sie beim Auftraggeber ist, nicht wenn sie geschrieben wurde. `angezeigt_am`
 * setzt ausschliesslich `…/[id]/versenden`, nach dem Tor und nach dem
 * archivierten Schreiben.
 *
 * `POST` und nicht `PUT`: der Aufrufer ist ein HTML-Formular.
 */
export const dynamic = 'force-dynamic';

const GRUENDE: readonly BehinderungGrund[] =
  ['risikobereich_ag', 'streik_aussperrung', 'hoehere_gewalt'];

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
  const beginnAm = text('beginn_am');
  const grund = text('grund_kategorie');
  if (projektId === '' || !/^\d{4}-\d{2}-\d{2}$/u.test(beginnAm)) {
    return fehlerAntwort('ungueltige_eingabe',
      'Projekt und Beginn der Behinderung sind Pflicht.', 422);
  }
  if (!(GRUENDE as readonly string[]).includes(grund)) {
    /**
     * Keine Vorbelegung auf „Risikobereich des Auftraggebers": § 6 Abs. 2
     * VOB/B kennt drei Sphaeren, und welche einschlaegig ist, entscheidet
     * ueber den Schadensersatzanspruch. Eine geratene Zuordnung stuende
     * spaeter in einem Schreiben an den Auftraggeber.
     */
    return fehlerAntwort('ungueltige_eingabe',
      'Die Risikosphäre nach § 6 Abs. 2 VOB/B ist eine Pflichtauswahl.', 422);
  }
  const tage = text('auswirkung_tage');

  let angelegt: { readonly id: string; readonly nummer: string };
  try {
    angelegt = await (db().begin(async (tx: postgres.TransactionSql) =>
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
        return erstelleBehinderung(kontext, {
          projektId,
          vorlageSchluessel: text('vorlage'),
          grundKategorie: grund as BehinderungGrund,
          ursache: text('ursache'),
          beginnAm,
          auswirkung: text('auswirkung'),
          auswirkungTage: /^\d{1,4}$/u.test(tage) ? Number(tage) : null,
          absender: text('absender'),
        });
      }))) as { readonly id: string; readonly nummer: string };
  } catch (fehler: unknown) {
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

  const mandant = text('mandant');
  if (mandant !== '') {
    return NextResponse.redirect(internesZiel(
      text('zurueck') === '' ? null : text('zurueck'),
      `/portal/${mandant}/bau/projekte/${projektId}/behinderungen/${angelegt.id}`,
      anfrage,
    ), 303);
  }
  return NextResponse.json({ id: angelegt.id, nummer: angelegt.nummer }, { status: 201 });
}
