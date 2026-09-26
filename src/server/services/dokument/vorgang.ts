import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';

/**
 * Die Dokumente EINES Auftrags — für das Auftrags- und das Projektblatt
 * (OPS-11, V-176, D-670).
 *
 * OPS-11 verlangt „Tasks, deadlines, status, documents on every order and
 * project". Bis V-176 kannte `dokument` keinen Auftrag (0009), und beide
 * Blätter zeigten keine Dokumente. Seit 0421 trägt `dokument.auftrag_id`
 * einen zusammengesetzten Fremdschlüssel; hier wird er gelesen.
 *
 * **Unter RLS gelesen, und das ist die ganze Rechteprüfung**: ohne
 * `dokument.lesen` liefert `t_mandant` keine Zeile. Die Seite fragt das
 * Recht vorher und sagt, warum die Liste leer ist, statt „keine Dokumente"
 * zu behaupten.
 *
 * **Ein Bau-Projekt hat keine eigene Spalte**: es zeigt die Dokumente seines
 * Auftrags (`projekt.auftrag_id`).
 */

export interface VorgangsDokument {
  readonly id: string;
  readonly titel: string;
  readonly kategorie: string;
  /**
   * Der Berliner Kalendertag der Ablage, `JJJJ-MM-TT` — aus der Datenbank.
   * Formatiert wird im Blatt, in dessen Sprache (`tagInSprache`, V-240); vorher
   * kam hier schon `TT.MM.JJJJ` und stand so auch in der englischen Oberfläche.
   */
  readonly abgelegtAm: string;
}

export interface VorgangsDokumente {
  readonly zeilen: readonly VorgangsDokument[];
  /** Alle, auch die, die über der Anzeigegrenze liegen. */
  readonly gesamt: number;
  /** Die über der Anzeigegrenze — `gesamt` minus die gezeigten. */
  readonly weitere: number;
}

const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Eine Anzeigegrenze, keine Fachregel: die vollständige Liste steht in der Ablage. */
export const DOKUMENTE_JE_BLATT = 20;

export async function leseDokumenteAmAuftrag(
  kontext: LeseKontext, auftragId: string,
): Promise<VorgangsDokumente> {
  if (!KENNUNG.test(auftragId)) return { zeilen: [], gesamt: 0, weitere: 0 };
  const zeilen = await kontext.abfrage<VorgangsDokument & { gesamt: number }>(
    `select d.id::text as id, d.titel, d.kategorie::text as kategorie,
            to_char(d.erstellt_am at time zone 'Europe/Berlin', 'YYYY-MM-DD') as "abgelegtAm",
            count(*) over ()::int as gesamt
       from dokument d
      where d.auftrag_id = $1::uuid and d.mandant_id = app.aktiver_mandant()
        and d.geloescht_am is null
      order by d.erstellt_am desc, d.titel
      limit $2`, [auftragId, DOKUMENTE_JE_BLATT]);
  const gesamt = zeilen[0]?.gesamt ?? 0;
  return {
    zeilen: zeilen.map((z) => ({
      id: z.id, titel: z.titel, kategorie: z.kategorie, abgelegtAm: z.abgelegtAm,
    })),
    gesamt,
    weitere: Math.max(0, gesamt - zeilen.length),
  };
}
