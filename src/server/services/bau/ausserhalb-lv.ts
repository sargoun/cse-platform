/**
 * BAU-05: Leistung ausserhalb des Leistungsverzeichnisses (03-GEWERKE §7.7,
 * API-KARTE `GET /api/bau/nachtrag-warnungen`).
 *
 * **Der Ausfall, den diese Datei verhindert.** Auf einer Baustelle wird
 * gearbeitet, was angeordnet wird — und angeordnet wird oefter etwas, das im
 * Leistungsverzeichnis nicht steht. Gemessen wird es trotzdem, gebucht wird
 * es trotzdem, und in der Schlussrechnung steht dann eine Menge ohne
 * Vertragsposition. Ohne Nachtrag ist das nach § 2 Abs. 8 VOB/B im Zweifel
 * **unentgeltlich**: der Auftragnehmer hat gebaut, gemessen, bezahlt — und
 * keinen Anspruch. Der Fehler faellt erst bei der Schlussrechnung auf, Monate
 * spaeter, wenn die Ankuendigungsfrist des § 2 Abs. 6 Nr. 1 laengst
 * verstrichen ist.
 *
 * Die Warnung ist deshalb nicht kosmetisch und sie ist auch keine Sperre: sie
 * **benennt** die Position und bietet an, daraus einen Nachtrag zu machen.
 * Die Arbeit auf der Baustelle aufzuhalten, waere der falsche Eingriff — die
 * Menge ist richtig, es fehlt der Vorgang daneben.
 *
 * Zwei Quellen, ein Begriff:
 *
 *  - **Aufmass** — eine Zeile mit `ausserhalb_lv` und ohne `nachtrag_id`.
 *    Genau das Praedikat des Index `aufmass_zeile_bau05_idx`.
 *  - **Zeit** — ein `zeiteintrag` auf eine Auftragszeile, zu der es in diesem
 *    Projekt KEINE LV-Position gibt. Zeit ganz ohne Auftragszeile zaehlt hier
 *    NICHT: das ist nicht zugeordnete Zeit und ein anderes Problem (FIN-07),
 *    und wer beides in eine Warnung wirft, bekommt eine Liste, die jeden Tag
 *    lang und jeden Tag gleich ist — und die niemand mehr liest.
 *
 * Der Dienst LIEST. Der Nachtrag entsteht in `nachtrag.ts`.
 */
import type { LeseKontext } from '../../kontext/index.js';

export type WarnungQuelle = 'aufmass' | 'zeit';

export interface AusserhalbLvWarnung {
  readonly quelle: WarnungQuelle;
  /** Die Zeile, aus der die Warnung kommt — `aufmass_zeile.id` bzw. `auftrag_leistung.id`. */
  readonly id: string;
  readonly projekt_id: string;
  readonly projekt: string;
  /**
   * **Die Position, um die es geht — im Klartext.** Eine Warnung ohne sie
   * schickt die Bauleitung auf die Suche durch zwoelf Aufmassblaetter.
   */
  readonly position: string;
  /** Woher genau: Blattnummer oder Auftragszeilennummer. */
  readonly herkunft: string;
  /** `numeric(12,3)` als Text bzw. Minuten als Text — nie eine Gleitkommazahl. */
  readonly umfang: string;
  readonly einheit: string;
  /** Der Weg zur Zeile, damit die Warnung anklickbar ist (NOT-03). */
  readonly ziel_id: string;
}

/**
 * Die Warnungen eines Projekts — oder aller Projekte des Mandanten.
 *
 * **Eine Abfrage, zwei Zweige, eine Ordnung.** Die naheliegende Fassung —
 * zwei Aufrufe und im Node-Prozess zusammensortieren — ergaebe zwei Listen,
 * die je nach Aufrufer verschieden sortiert sind, und eine Oberflaeche, die
 * bei jedem zweiten Aufruf anders aussieht.
 */
export async function ladeAusserhalbLv(
  kontext: LeseKontext,
  filter: { readonly projektId?: string | null } = {},
): Promise<readonly AusserhalbLvWarnung[]> {
  return kontext.abfrage<AusserhalbLvWarnung>(
    `select 'aufmass' as quelle, z.id, z.projekt_id, p.bezeichnung as projekt,
            z.bezeichnung as position,
            'Aufmaßblatt ' || a.nummer as herkunft,
            z.menge::text as umfang, z.einheit,
            z.aufmass_id as ziel_id
       from aufmass_zeile z
       join aufmass a on a.id = z.aufmass_id and a.mandant_id = z.mandant_id
       join projekt p on p.id = z.projekt_id and p.mandant_id = z.mandant_id
      where z.ausserhalb_lv and z.nachtrag_id is null
        and a.storniert_am is null
        and ($1::uuid is null or z.projekt_id = $1::uuid)

      union all

      select 'zeit' as quelle, al.id, t.projekt_id, p.bezeichnung as projekt,
             al.bezeichnung as position,
             'Auftragszeile ' || al.position_nr::text as herkunft,
             sum(coalesce(t.dauer_netto_minuten, 0))::text as umfang,
             'min' as einheit,
             al.id as ziel_id
        from zeiteintrag t
        join auftrag_leistung al on al.id = t.auftrag_leistung_id
                                and al.mandant_id = t.mandant_id
        join projekt p on p.id = t.projekt_id and p.mandant_id = t.mandant_id
       where t.projekt_id is not null
         and t.ersetzt_durch_zeiteintrag_id is null
         and ($1::uuid is null or t.projekt_id = $1::uuid)
         and not exists (
               select 1 from lv_position l
                where l.mandant_id = t.mandant_id
                  and l.projekt_id = t.projekt_id
                  and l.auftrag_leistung_id = t.auftrag_leistung_id
                  and l.archiviert_am is null)
         and not exists (
               select 1 from nachtrag n
                where n.mandant_id = t.mandant_id
                  and n.projekt_id = t.projekt_id
                  and n.auftrag_leistung_id = t.auftrag_leistung_id
                  and n.storniert_am is null)
       group by al.id, t.projekt_id, p.bezeichnung, al.bezeichnung, al.position_nr

      order by quelle, position`,
    [filter.projektId ?? null],
  );
}

/** Die Warnungen EINES Aufmassblattes — fuer die Blattansicht (BAU-05). */
export async function ladeAusserhalbLvJeBlatt(
  kontext: LeseKontext, aufmassId: string,
): Promise<readonly AusserhalbLvWarnung[]> {
  return kontext.abfrage<AusserhalbLvWarnung>(
    `select 'aufmass' as quelle, z.id, z.projekt_id, p.bezeichnung as projekt,
            z.bezeichnung as position,
            'Aufmaßblatt ' || a.nummer as herkunft,
            z.menge::text as umfang, z.einheit, z.aufmass_id as ziel_id
       from aufmass_zeile z
       join aufmass a on a.id = z.aufmass_id and a.mandant_id = z.mandant_id
       join projekt p on p.id = z.projekt_id and p.mandant_id = z.mandant_id
      where z.aufmass_id = $1 and z.ausserhalb_lv and z.nachtrag_id is null
      order by z.reihenfolge`,
    [aufmassId],
  );
}

/**
 * Der Satz, der neben der Warnung steht — an EINER Stelle, nicht in vier
 * Seiten.
 *
 * Er benennt die Position woertlich. „Es gibt Leistungen ausserhalb des LV"
 * ist keine Warnung, sondern eine Stimmung.
 */
export function warnungsText(w: AusserhalbLvWarnung): string {
  const umfang = w.quelle === 'zeit'
    ? `${w.umfang} Minuten`
    : `${w.umfang} ${w.einheit}`;
  return w.quelle === 'aufmass'
    ? `„${w.position}" (${umfang}, ${w.herkunft}) steht in keinem `
      + 'Leistungsverzeichnis dieses Projekts und hängt an keinem Nachtrag.'
    : `Auf „${w.position}" (${w.herkunft}) sind ${umfang} gebucht, obwohl die `
      + 'Auftragszeile in keinem Leistungsverzeichnis dieses Projekts steht '
      + 'und an keinem Nachtrag hängt.';
}

/**
 * Der Titelvorschlag fuer den Nachtrag, den die Warnung anbietet.
 *
 * Ein VORSCHLAG und keine Vorbelegung der Anspruchsgrundlage: welcher Absatz
 * des § 2 VOB/B einschlaegig ist, entscheidet ein Mensch (K-17, O-23). Die
 * Warnung fuellt den Titel, nie die Grundlage.
 */
export function nachtragTitelVorschlag(w: AusserhalbLvWarnung): string {
  return w.quelle === 'aufmass'
    ? `Leistung außerhalb des LV: ${w.position}`
    : `Leistung außerhalb des LV: ${w.position} (Stundenlohnarbeiten)`;
}
