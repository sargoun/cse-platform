/**
 * „Aktuell im Einsatz" (DSH-05, TIM-08).
 *
 * Die Kachel und die Liste darunter lesen DIESELBE Sicht
 * (`zeiteintrag_offen`). Das ist der ganze Zweck dieses Moduls: eine Zahl, die
 * aus einer anderen Bedingung entsteht als die Zeilen, die sie zaehlt, driftet
 * — und eine Kachel, die etwas anderes sagt als die Liste, ist schlimmer als
 * keine, weil danach niemand mehr einer Zahl auf diesem Bildschirm glaubt
 * (DSH-04).
 *
 * Die Sicht ist `security_invoker`, erbt also die RLS des Aufrufers: in
 * `mandant`-Scope zaehlt sie den aktiven Bereich, in der Gruppenansicht die
 * Bereiche mit `gruppe.zeit.lesen`, und ohne Sitzung null. Dieser Dienst
 * schreibt nichts und kann deshalb auch in der Gruppenansicht laufen.
 */
import type { LeseKontext } from '../../kontext/index.js';

export interface LaufenderEinsatz {
  readonly zeiteintragId: string;
  readonly personId: string;
  readonly anstellungId: string;
  readonly objektId: string | null;
  readonly seit: Date;
}

/**
 * Die Zahl der Kachel.
 *
 * Sie zaehlt die Sicht und nicht die Tabelle — eine zweite `where`-Bedingung
 * an dieser Stelle waere die zweite Wahrheit, gegen die der Test in
 * `tests/isolation/zeiteintrag.test.ts` prueft.
 */
export async function zaehleAktuellImEinsatz(kontext: LeseKontext): Promise<number> {
  const [zeile] = await kontext.abfrage<{ anzahl: string }>(
    `select count(*)::text as anzahl from zeiteintrag_offen`,
  );
  return Number(zeile?.anzahl ?? '0');
}

/** Die Zeilen hinter der Zahl — dieselbe Sicht, dieselbe Bedingung. */
export async function listeAktuellImEinsatz(
  kontext: LeseKontext,
): Promise<readonly LaufenderEinsatz[]> {
  const zeilen = await kontext.abfrage<{
    id: string; person_id: string; anstellung_id: string;
    objekt_id: string | null; beginn_zeitpunkt: Date;
  }>(
    `select id, person_id, anstellung_id, objekt_id, beginn_zeitpunkt
       from zeiteintrag_offen
      order by beginn_zeitpunkt asc`,
  );
  return zeilen.map((z) => ({
    zeiteintragId: z.id,
    personId: z.person_id,
    anstellungId: z.anstellung_id,
    objektId: z.objekt_id,
    seit: z.beginn_zeitpunkt,
  }));
}
