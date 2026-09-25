/**
 * Was das Antragsformular für eine Schicht und einen Tauschpartner anbietet
 * (EMP-10, EMP-13, V-187).
 *
 * **Der Befund, der diese Datei gebaut hat.** Die Systemart `schichttausch`
 * (0074) verlangt `einsatz_id` und `tausch_partner_anstellung_id`, und der
 * Auslöser `antrag_pflichtfelder` weist jede Zeile ohne beides ab. Das
 * Formular `/portal/mein/antraege/neu` bot die Art an, fragte aber nach
 * keinem der beiden Felder — jeder Tauschantrag endete als rohe 500.
 *
 * **Die Schicht ist eigene Sache, der Partner nicht.** Welche seiner
 * kommenden Schichten ein Mensch zum Tausch stellt, sind seine eigenen Daten
 * (EMP-02). Wer ihm als Tauschpartner angeboten wird, ist dagegen eine Liste
 * ANDERER Beschäftigter — und EMP-13 sagt: „Employees never see … other
 * employees' data". Wen eine Kraft sehen darf (alle derselben Gesellschaft,
 * nur die am selben Objekt Eingesetzten, nur mit derselben Qualifikation), in
 * welcher Namensform und auf welcher Rechtsgrundlage, ist eine Frage des
 * Datenschutzes und der Mitbestimmung (O-06) und nicht dieser Datei. Bis sie
 * beantwortet ist (O-925), bietet die Quelle NIEMANDEN an — und eine Art, die
 * einen Tauschpartner verlangt, steht im Formular als „noch nicht möglich"
 * statt als Auswahl, die an der Datenbank scheitert.
 */
import type { LeseKontext } from '../../kontext/index.js';

/** Eine eigene kommende Schicht, die sich zum Tausch stellen lässt. */
export interface TauschbareSchicht {
  readonly einsatzId: string;
  readonly anstellungId: string;
  readonly mandantName: string;
  /** `JJJJ-MM-TT`, Berliner Kalendertag des Beginns — die Seite formatiert. */
  readonly tag: string;
  /** `HH:MM`, Berliner Ortszeit, aus der Datenbank. */
  readonly beginnUhrzeit: string;
  readonly endeUhrzeit: string;
  readonly endetAmFolgetag: boolean;
  readonly objekt: string | null;
}

/** Was die Auswahl zeigt — kein Kunde, kein Auftrag, kein Preis (EMP-13). */
export const TAUSCHBARE_SCHICHT_FELDER = [
  'einsatzId', 'anstellungId', 'mandantName', 'tag', 'beginnUhrzeit',
  'endeUhrzeit', 'endetAmFolgetag', 'objekt',
] as const;

/**
 * Wie viele kommende Schichten die Auswahl höchstens zeigt. Keine Fachregel,
 * sondern die Länge einer Auswahlliste auf einem Telefon; wer weiter als
 * sechzig Schichten voraus tauschen will, spricht mit der Planung.
 */
export const TAUSCHBARE_SCHICHTEN_HOECHSTENS = 60;

/**
 * Die eigenen Schichten, die noch nicht begonnen haben — über alle
 * Beschäftigungen, jede mit ihrer Gesellschaft (EMP-14).
 *
 * **`now()` kommt aus der Datenbank** (Invariante 5), dieselbe Uhr, die der
 * Dienst beim Einreichen fragt: die Auswahl verspricht keine Schicht, die
 * die Prüfung eine Sekunde später als begonnen abweist. Eine abgesagte oder
 * entfernte Zuordnung ist keine Schicht mehr, die man tauschen könnte.
 *
 * Läuft im Personen-Scope (`t_person` auf `einsatz_zuordnung`), wie die
 * Schichtliste.
 */
export async function listeTauschbareSchichten(
  kontext: LeseKontext, grenze = TAUSCHBARE_SCHICHTEN_HOECHSTENS,
): Promise<readonly TauschbareSchicht[]> {
  const roh = await kontext.abfrage<{
    einsatz_id: string; anstellung_id: string; mandant_name: string; tag: string;
    beginn_uhrzeit: string; ende_uhrzeit: string; endet_am_folgetag: boolean;
    objekt: string | null;
  }>(
    `select z.einsatz_id,
            z.anstellung_id,
            m.name                                                   as mandant_name,
            to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'YYYY-MM-DD') as tag,
            to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'HH24:MI')    as beginn_uhrzeit,
            to_char(z.ende_zeitpunkt   at time zone 'Europe/Berlin', 'HH24:MI')    as ende_uhrzeit,
            ((z.ende_zeitpunkt at time zone 'Europe/Berlin')::date
             > (z.beginn_zeitpunkt at time zone 'Europe/Berlin')::date)           as endet_am_folgetag,
            o.bezeichnung                                            as objekt
       from einsatz_zuordnung z
       join einsatz e on e.mandant_id = z.mandant_id and e.id = z.einsatz_id
       join mandant m on m.id = z.mandant_id
       left join objekt o on o.mandant_id = e.mandant_id and o.id = e.objekt_id
      where z.entfernt_am is null
        and z.status <> 'abgesagt'
        and z.beginn_zeitpunkt > now()
      order by z.beginn_zeitpunkt asc, m.sortierung asc, z.id asc
      limit $1::int`,
    [grenze],
  );
  return roh.map((z) => ({
    einsatzId: z.einsatz_id,
    anstellungId: z.anstellung_id,
    mandantName: z.mandant_name,
    tag: z.tag,
    beginnUhrzeit: z.beginn_uhrzeit,
    endeUhrzeit: z.ende_uhrzeit,
    endetAmFolgetag: z.endet_am_folgetag,
    objekt: z.objekt,
  }));
}

/** Ein Mensch, der als Tauschpartner angeboten wird — nur, was die Wahl braucht. */
export interface TauschpartnerWahl {
  readonly anstellungId: string;
  readonly anzeigename: string;
}

/**
 * Woher die Auswahl der Tauschpartner kommt — die austauschbare Stelle.
 *
 * `festgelegt: false` heisst: niemand hat entschieden, wen eine Kraft sehen
 * darf. Dann gibt es keine Auswahl, und der Dienst nimmt keinen Partner an
 * (`reicheAntragEin`) — auch keinen, den eine nachgebaute Anfrage mitschickt.
 */
export type TauschpartnerQuelle =
  | { readonly festgelegt: false; readonly offeneFrage: string }
  | {
    readonly festgelegt: true;
    /** Die anbietbaren Partner für EINE Beschäftigung des Menschen. */
    readonly lese: (
      kontext: LeseKontext, anstellungId: string,
    ) => Promise<readonly TauschpartnerWahl[]>;
  };

/**
 * PLATZHALTER — die Frage ist offen, und bis zur Antwort wird niemand
 * angeboten.
 *
 * TODO(client, O-925): Wen darf eine Beschäftigte beim Schichttausch als Tauschpartner sehen und wählen — alle aktiven Beschäftigten derselben Gesellschaft, nur die am selben Objekt oder Revier Eingesetzten, nur die mit derselben Qualifikation —, in welcher Namensform, und braucht die Liste eine Einwilligung oder eine Betriebsvereinbarung (EMP-13, O-06)?
 */
export const TAUSCHPARTNER_NICHT_FESTGELEGT: TauschpartnerQuelle = {
  festgelegt: false,
  offeneFrage: 'O-925',
};

/** Die Quelle, die Formular und Dienst fragen. Die Antwort auf O-925 ersetzt nur diese Zeile. */
export const TAUSCHPARTNER_QUELLE: TauschpartnerQuelle = TAUSCHPARTNER_NICHT_FESTGELEGT;

/**
 * Kann das Formular eine Art mit diesen Anforderungen überhaupt erfüllen?
 *
 * Eine Art, die einen Tauschpartner verlangt, ist ohne festgelegte Quelle
 * nicht einreichbar — sie steht dann als „noch nicht möglich" da, nicht als
 * Auswahl, die an der Datenbank scheitert.
 */
export function artEinreichbar(
  art: { readonly erfordertTauschpartner: boolean },
  quelle: TauschpartnerQuelle = TAUSCHPARTNER_QUELLE,
): boolean {
  return !art.erfordertTauschpartner || quelle.festgelegt;
}
