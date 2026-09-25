import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { grundAufsFormularweg } from '@/app/api/formular-antwort';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withPersonScope, withTenant, type Sitzung } from '@/server/kontext/index';
import {
  AntragNichtGefunden, findeAntrag, zieheAntragZurueck,
} from '@/server/services/abwesenheit/antrag';
import { KeineAnstellungFehler, mandantDerAnstellung }
  from '@/server/services/zeit/einwand';

/**
 * `POST /api/mein/antraege/[id]/zurueckziehen` — der Mensch nimmt seinen
 * eigenen Antrag zurueck (EMP-10).
 *
 * **Kein Rechteschluessel, und das ist kein Loch** — dieselbe Begruendung wie
 * beim Einreichen (04-SEITENKARTE §7, K-19): „nur der Betroffene" laesst sich
 * als Recht nicht ausdruecken, weil ein Recht einer Rolle gehoert und eine
 * Rolle vielen Menschen. Bewacht wird der Weg vierfach:
 *
 *  1. Sitzung und Ursprungsvergleich,
 *  2. der Antrag wird im PERSONEN-Scope gelesen — `antrag.t_person` gibt dort
 *     nur die eigenen Zeilen heraus, eine fremde Kennung ergibt 404 (AUT-06),
 *  3. der Mandant kommt aus der BESCHAEFTIGUNG des Antrags, nie aus einem Feld
 *     der Anfrage (K-02, Invariante 3),
 *  4. `antrag.t_selbst_zurueckziehen` (0301) laesst nur `eingereicht` und
 *     `in_pruefung` heran und nur den Zielzustand `zurueckgezogen` — eine
 *     Selbstgenehmigung faellt an der WITH-CHECK-Haelfte, gemessen mit „new row
 *     violates row-level security policy".
 *
 * **303 und kein JSON.** Das Formular ist ein echtes `<form method="post">`,
 * damit es auf einem alten Diensttelefon ohne JavaScript funktioniert.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest,
  kontext: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await kontext.params;

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

  try {
    await db().begin(async (tx: postgres.TransactionSql) => {
      /*
       * Zuerst im Personen-Scope: welcher Beschaeftigung gehoert dieser
       * Antrag? Das ist die Stelle, an der ein fremder Antrag verschwindet —
       * `findeAntrag` gibt dort null zurueck, und daraus wird 404.
       */
      const anstellungId = await withPersonScope(tx, sitzung, async (k) => {
        const antrag = await findeAntrag(k, id);
        return antrag?.anstellungId ?? null;
      });
      if (anstellungId === null) throw new AntragNichtGefunden(id);

      const mandantId = await withPersonScope(tx, sitzung, async (k) =>
        mandantDerAnstellung(k, anstellungId));

      const imMandanten: Sitzung = {
        ...sitzung, ansicht: 'mandant', aktiverMandantId: mandantId, portal: 'mitarbeiter',
      };
      return withTenant(tx, imMandanten, async (k) => zieheAntragZurueck(k, id));
    });
  } catch (fehler: unknown) {
    if (fehler instanceof AntragNichtGefunden || fehler instanceof KeineAnstellungFehler) {
      /*
       * Meist ein Wettlauf: die Personalstelle hat entschieden, während das
       * Blatt offen war. Zurück aufs Blatt, das jetzt den Stand zeigt (V-198).
       */
      return grundAufsFormularweg(anfrage, daten, 'nicht_gefunden', 404);
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal/mein/antraege', anfrage),
    303,
  );
}
