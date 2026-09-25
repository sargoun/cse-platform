/**
 * Der Abrechnungsanker einer Schicht — die Leistungszeile des Auftrags, an
 * der ihre Zeit hängt (TIM-12, FIN-07, V-191).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund, der diese Datei gebaut hat.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein Zeiteintrag hängt über `auftrag_leistung_id` am Auftrag, und er erbt
 * diese Spalte beim Anlegen AUSSCHLIESSLICH von seiner Schicht (`z_erben`,
 * 0034). Die Schicht bekommt sie vom Träger (Turnus, Posten, Veranstaltung)
 * oder — bei einer Einzelschicht — beim Anlegen. Weder die Turnus- noch die
 * Posten-Anlage noch die Einzelschicht schrieben eine; nur der Seed tat es.
 * Jede Stunde aus einer über die Oberfläche geplanten Schicht landete damit
 * dauerhaft in `zeiteintrag_ohne_auftrag`, und die Stundenabrechnung fand sie
 * nie — nach dem Schliessen ist die Spalte am Eintrag unveränderlich.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was diese Datei entscheidet, und was nicht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sie bietet die LEBENDEN Leistungszeilen nicht stornierter Aufträge an und
 * prüft einen gewählten Anker, bevor er geschrieben wird — mit einem Satz
 * statt eines Fremdschlüsselfehlers. Den Auftrag leitet die Datenbank aus der
 * Zeile ab (`kern.einsatz_auftrag_ableiten`, 0050), und dass Zeile und
 * Auftrag zusammengehören, prüft der Enkel-Schlüssel `einsatz_leistung_fk`.
 * Welche Zeile zu welcher Schicht gehört, entscheidet ein Mensch; die Datei
 * schlägt nichts vor.
 *
 * Gelesen wird unter der RLS des Aufrufers: Leistungszeilen sieht, wer
 * `auftrag.lesen` hält. Wer das nicht hält, bekommt keine Auswahl — und kein
 * Feld, das beim Speichern einen Anker still löschte.
 */
import type { LeseKontext } from '../../kontext/index.js';

export interface AnkerbareLeistung {
  readonly id: string;
  readonly auftragId: string;
  readonly auftragsnummer: string;
  readonly positionNr: number;
  readonly bezeichnung: string;
  /** `false`: beendet oder zu einem stornierten Auftrag — nur als bisheriger Anker gezeigt. */
  readonly lebt: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Die Länge einer Auswahlliste, keine Fachregel. */
export const ANKERBARE_LEISTUNGEN_HOECHSTENS = 300;

/**
 * Die Leistungszeilen, die sich als Anker wählen lassen — lebend am heutigen
 * Berliner Tag (`gueltig_bis` gilt einschliesslich, 0050), zu einem nicht
 * stornierten Auftrag. `bisher` kommt IMMER mit, auch wenn die Zeile nicht
 * mehr lebt: eine Pflegemaske, die den bisherigen Anker nicht anbietet,
 * löschte ihn beim nächsten Speichern.
 *
 * **„Immer" heisst: auch jenseits der Obergrenze** (V-192). Die erste Fassung
 * hängte `or al.id = $2` in dieselbe Abfrage und kappte DANACH mit `limit`.
 * Bei mehr als {@link ANKERBARE_LEISTUNGEN_HOECHSTENS} lebenden Zeilen fiel
 * der bisherige Anker damit aus der Liste — sortiert nach Auftragsnummer
 * absteigend traf das gerade die alten, lange laufenden Verträge —, die Maske
 * wählte „ohne", und das nächste Speichern einer Uhrzeit löste ihn; der
 * Generator trug das auf jede künftige Schicht. Deshalb zwei Teile: die
 * gekappte Liste der lebenden Zeilen und, UNGEKAPPT daneben, die bisherige.
 *
 * `hoechstens` ist die Obergrenze der lebenden Zeilen; die Vorgabe genügt
 * jeder Maske, die Angabe gibt es für die Prüfung der Kappung.
 */
export async function listeAnkerbareLeistungen(
  kontext: LeseKontext, bisher: string | null = null,
  hoechstens: number = ANKERBARE_LEISTUNGEN_HOECHSTENS,
): Promise<readonly AnkerbareLeistung[]> {
  const zeilen = await kontext.abfrage<{
    id: string; auftrag_id: string; auftragsnummer: string; position_nr: number;
    bezeichnung: string; lebt: boolean;
  }>(
    `with lebend as (
       select al.id, al.auftrag_id, a.auftragsnummer, al.position_nr, al.bezeichnung,
              true as lebt
         from auftrag_leistung al
         join auftrag a on a.mandant_id = al.mandant_id and a.id = al.auftrag_id
        where a.status <> 'storniert'
          and (al.gueltig_bis is null or al.gueltig_bis >= app.berlin_heute())
        order by a.auftragsnummer desc, al.position_nr
        limit $1::int
     ), bisherig as (
       select al.id, al.auftrag_id, a.auftragsnummer, al.position_nr, al.bezeichnung,
              (a.status <> 'storniert'
               and (al.gueltig_bis is null or al.gueltig_bis >= app.berlin_heute())) as lebt
         from auftrag_leistung al
         join auftrag a on a.mandant_id = al.mandant_id and a.id = al.auftrag_id
        where al.id = $2::uuid
     )
     select * from lebend
     union
     select * from bisherig
     order by auftragsnummer desc, position_nr`,
    [Math.max(0, Math.trunc(hoechstens)), bisher],
  );
  return zeilen.map((z) => ({
    id: z.id,
    auftragId: z.auftrag_id,
    auftragsnummer: z.auftragsnummer,
    positionNr: Number(z.position_nr),
    bezeichnung: z.bezeichnung,
    lebt: z.lebt,
  }));
}

export type LeistungsankerGrund =
  | 'leistung_unbekannt' | 'leistung_beendet' | 'leistung_anderer_auftrag';

/**
 * Ein Anker, der so nicht geschrieben wird — mit dem Grund als Schlüssel,
 * den die Masken in ihrer Sprache nachschlagen.
 */
/**
 * Der deutsche Satz je Grund — für die Routen, die heute den Satz
 * zurückgeben statt des Schlüssels (`api/reinigung/turnus`). Masken, die
 * zweisprachig sind, schlagen den `grund` nach.
 */
const SATZ: Readonly<Record<LeistungsankerGrund, string>> = {
  leistung_unbekannt:
    'Diese Leistungszeile gibt es in dieser Gesellschaft nicht — oder sie ist für Sie '
    + 'nicht sichtbar, weil das Recht fehlt, Aufträge zu lesen.',
  leistung_beendet:
    'Diese Leistungszeile gilt nicht mehr, oder ihr Auftrag ist storniert. Neue '
    + 'Schichten hängen nur an einer Position, die heute vereinbart ist.',
  leistung_anderer_auftrag:
    'Diese Leistungszeile gehört zu einem anderen Auftrag als dem, den die Schicht nennt.',
};

export class LeistungsankerFehler extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 422;
  constructor(readonly grund: LeistungsankerGrund) {
    super(SATZ[grund]);
    this.name = 'LeistungsankerFehler';
  }
}

/**
 * Prüft einen gewählten Anker, BEVOR er geschrieben wird.
 *
 * - `leistung_unbekannt`: die Zeile gibt es in dieser Gesellschaft nicht —
 *   oder der Aufrufer sieht sie nicht (`auftrag.lesen`). Beides ist für ihn
 *   dasselbe (AUT-06).
 * - `leistung_beendet`: die Zeile lebt heute nicht mehr, oder ihr Auftrag ist
 *   storniert. Eine NEUE Schicht an eine beendete Zeile zu hängen, hiesse,
 *   Zeit auf eine Position zu buchen, die nicht mehr vereinbart ist.
 * - `leistung_anderer_auftrag`: die Schicht nennt einen Auftrag, und die Zeile
 *   gehört zu einem anderen. Der Enkel-Schlüssel wiese das ebenfalls ab —
 *   hier kommt es als Satz.
 *
 * Gibt den Auftrag der Zeile zurück.
 */
export async function pruefeLeistungsanker(
  kontext: LeseKontext, auftragLeistungId: string, auftragId: string | null = null,
): Promise<string> {
  // Eine Kennung, die keine ist, erreicht den `::uuid`-Cast nicht (sonst 500).
  if (!UUID.test(auftragLeistungId)) throw new LeistungsankerFehler('leistung_unbekannt');
  const [z] = await kontext.abfrage<{ auftrag_id: string; lebt: boolean }>(
    `select al.auftrag_id,
            (a.status <> 'storniert'
             and (al.gueltig_bis is null or al.gueltig_bis >= app.berlin_heute())) as lebt
       from auftrag_leistung al
       join auftrag a on a.mandant_id = al.mandant_id and a.id = al.auftrag_id
      where al.id = $1::uuid`,
    [auftragLeistungId],
  );
  if (z === undefined) throw new LeistungsankerFehler('leistung_unbekannt');
  if (!z.lebt) throw new LeistungsankerFehler('leistung_beendet');
  if (auftragId !== null && auftragId !== z.auftrag_id) {
    throw new LeistungsankerFehler('leistung_anderer_auftrag');
  }
  return z.auftrag_id;
}
