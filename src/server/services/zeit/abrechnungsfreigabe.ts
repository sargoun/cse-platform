import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

/**
 * Erfasste Zeit zur Abrechnung freigeben (TIM-12, FIN-07, FIN-18, EMP-04,
 * 04-PLANUNG-ZEIT §3.3/§7.3, `04-SEITENKARTE.md` §5.11).
 *
 * **Der Schritt ist auf O-39 blockiert — und das heisst nicht „ungebaut".**
 * O-39 fragt, ob es zwischen erfasster Zeit und Abrechnung einen eigenen
 * menschlichen Freigabeschritt ueberhaupt gibt, oder ob eine festgeschriebene
 * Rechnung sich die Zeilen direkt nimmt. Solange das offen ist, wird
 * `zeit.abrechnung_freigeben` NICHT geseedet und an keine Rolle gebunden
 * (03-AUTH §12.4): die Seite und dieser Dienst sind vollstaendig da, geprueft,
 * und fuer jede heutige Sitzung unerreichbar. Die Antwort des Mandanten
 * oeffnet sie mit einer Rechtebindung statt mit einem Umbau.
 *
 * **Was NICHT offen ist, ist die Bedeutung der Spalte.** `freigegeben_am`
 * steht seit 0034 im Schema und hat zwei gebaute Leser:
 * `bucheFreigegebeneZeiten` laesst nur Freigegebenes auf das Stundenkonto
 * (§7.3, EMP-04), und `zeiteintrag_auftrag` waehlt fuer die Rechnung
 * `freigegeben_am is not null and abgerechnet_am is null` (§3.3, FIN-07).
 * Geschrieben hat sie bisher nur der Seed — der das an Ort und Stelle als
 * Demo-Annahme benennt. Ohne diesen Bildschirm staut sich die Zeit vor einem
 * Tor ohne Tuer, und niemand sieht warum.
 *
 * **Geschrieben wird ueber `app.zeit_zur_abrechnung_freigeben`** (0366) und
 * nicht mit einem `update` von hier: das Recht gehoert in die Datenbank, nicht
 * nur in die Route (Invariante 3), und der Zeitpunkt in `now()` derselben
 * Transaktion (Invariante 5).
 *
 * **Keine Ruecknahme.** Was freigegeben ist, kann in ein Stundenkonto
 * geflossen sein; ein stilles Zurueckdrehen aenderte eine Zahl, die ein Mensch
 * schon in der Hand hatte (Invariante 8). Ob es eine Ruecknahme geben soll,
 * solange nichts abgerechnet ist, ist Teil derselben offenen Frage.
 * // TODO(client, O-861): In welcher Einheit wird Zeit zur Abrechnung freigegeben — je Eintrag, je Woche, je Person, je Monat —, und laesst sich eine erteilte Freigabe zuruecknehmen, solange nichts abgerechnet ist?
 */

/** Wie viele Eintraege ein Lauf hoechstens traegt — dieselbe Zahl wie in 0366. */
export const FREIGABE_HOECHSTZAHL = 500;

export interface FreigabeFilter {
  /** Berliner Kalendertag, einschliesslich. */
  readonly von: string;
  /** Berliner Kalendertag, einschliesslich. */
  readonly bis: string;
  readonly personId: string | null;
  readonly objektId: string | null;
  /** Nur Eintraege ohne aufgeloesten Auftrag (FIN-18). */
  readonly nurOhneAuftrag: boolean;
}

export interface FreigabeZeile {
  readonly id: string;
  readonly person: string;
  readonly personId: string;
  readonly objekt: string | null;
  readonly objektId: string | null;
  readonly auftragsnummer: string | null;
  readonly leistung: string | null;
  readonly beginnLokal: string;
  readonly endeLokal: string | null;
  readonly endeFolgetag: boolean;
  readonly nettoMinuten: number | null;
  readonly nacherfasst: boolean;
  readonly ohneAuftrag: boolean;
  /** Der Stundenkonto-Monat dieser Beschaeftigung ist abgeschlossen (EMP-04). */
  readonly monatGesperrt: boolean;
}

export interface FreigabeAuswahl {
  readonly personen: readonly { readonly id: string; readonly name: string }[];
  readonly objekte: readonly { readonly id: string; readonly name: string }[];
}

export interface Freigabeliste {
  readonly zeilen: readonly FreigabeZeile[];
  readonly auswahl: FreigabeAuswahl;
  /** Haelt diese Sitzung das (heute ungebundene) Recht (O-39)? */
  readonly darfFreigeben: boolean;
}

interface ZeileRoh {
  readonly id: string;
  readonly person: string;
  readonly person_id: string;
  readonly objekt: string | null;
  readonly objekt_id: string | null;
  readonly auftragsnummer: string | null;
  readonly leistung: string | null;
  readonly beginn_lokal: string;
  readonly ende_lokal: string | null;
  readonly ende_folgetag: boolean;
  readonly netto_minuten: number | null;
  readonly nacherfasst: boolean;
  readonly ohne_auftrag: boolean;
  readonly monat_gesperrt: boolean;
}

/**
 * Das Fenster als UEBERSCHNEIDUNG, nicht als `beginn::date between …`.
 *
 * Sonst fehlte die Nachtschicht vom Sonntag auf den Montag im Fenster des
 * Montags — sichtbar leer, und niemand vermisst sie. Die Tagesgrenze steht in
 * BERLIN (`::timestamp at time zone`), nicht in UTC: sonst laege sie im
 * Sommer zwei und im Winter eine Stunde daneben, und was herausfiele, waere
 * genau die Nachtschicht (Invariante 2, Wache 5b).
 */
const FENSTER = `
        z.beginn_zeitpunkt < (($2::date + 1)::timestamp at time zone 'Europe/Berlin')
    and z.ende_zeitpunkt   > (($1::date)::timestamp at time zone 'Europe/Berlin')`;

/**
 * Was ueberhaupt freigebbar ist — dieselben Bedingungen wie in
 * `app.zeit_zur_abrechnung_freigeben` (0366).
 *
 * Ein laufender Eintrag hat kein Ende und damit keine Dauer; ein stornierter
 * oder ersetzter traegt keine Wahrheit mehr; ein bereits freigegebener ist
 * fertig. Sie hier zu zeigen hiesse, Haekchen anzubieten, die der Dienst
 * gleich darauf ablehnt.
 */
const OFFEN = `
        z.status = 'abgeschlossen'
    and z.ende_zeitpunkt is not null
    and z.freigegeben_am is null
    and z.storniert_am is null
    and z.ersetzt_am is null`;

export async function ladeFreigabeliste(
  kontext: LeseKontext, filter: FreigabeFilter,
): Promise<Freigabeliste> {
  const werte: unknown[] = [filter.von, filter.bis];
  const teile: string[] = [FENSTER, OFFEN];
  if (filter.personId !== null) {
    werte.push(filter.personId);
    teile.push(`z.person_id = $${String(werte.length)}::uuid`);
  }
  if (filter.objektId !== null) {
    werte.push(filter.objektId);
    teile.push(`z.objekt_id = $${String(werte.length)}::uuid`);
  }
  if (filter.nurOhneAuftrag) teile.push('z.auftrag_leistung_id is null');

  const roh = await kontext.abfrage<ZeileRoh>(
    `select z.id,
            (p.vorname || ' ' || p.nachname)                     as person,
            z.person_id,
            o.bezeichnung                                        as objekt,
            z.objekt_id,
            a.auftragsnummer,
            al.bezeichnung                                       as leistung,
            to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'DD.MM. HH24:MI')
                                                                 as beginn_lokal,
            to_char(z.ende_zeitpunkt   at time zone 'Europe/Berlin', 'HH24:MI')
                                                                 as ende_lokal,
            coalesce(
              (z.ende_zeitpunkt at time zone 'Europe/Berlin')::date
              > (z.beginn_zeitpunkt at time zone 'Europe/Berlin')::date, false)
                                                                 as ende_folgetag,
            z.dauer_netto_minuten                                as netto_minuten,
            z.nacherfasst,
            (z.auftrag_leistung_id is null)                      as ohne_auftrag,
            (z.gesperrt_am is not null)                          as monat_gesperrt
       from zeiteintrag z
       join person p on p.id = z.person_id
       left join objekt o on o.mandant_id = z.mandant_id and o.id = z.objekt_id
       left join auftrag_leistung al
              on al.mandant_id = z.mandant_id and al.id = z.auftrag_leistung_id
       left join auftrag a on a.mandant_id = al.mandant_id and a.id = al.auftrag_id
      where ${teile.join(' and ')}
      order by z.beginn_zeitpunkt asc, z.id asc
      limit 1000`,
    werte);

  /*
   * Die Auswahllisten lesen DASSELBE Fenster, aber ohne Personen- und
   * Objektfilter: sonst böte der Filter nach dem ersten Klick nur noch sich
   * selbst an, und der Weg zurück wäre die Adresszeile.
   */
  const personen = await kontext.abfrage<{ id: string; name: string }>(
    `select distinct p.id, (p.vorname || ' ' || p.nachname) as name
       from zeiteintrag z join person p on p.id = z.person_id
      where ${FENSTER} and ${OFFEN}
      order by name`,
    [filter.von, filter.bis]);
  const objekte = await kontext.abfrage<{ id: string; name: string }>(
    `select distinct o.id, o.bezeichnung as name
       from zeiteintrag z
       join objekt o on o.mandant_id = z.mandant_id and o.id = z.objekt_id
      where ${FENSTER} and ${OFFEN}
      order by name`,
    [filter.von, filter.bis]);

  const [recht] = await kontext.abfrage<{ hat: boolean }>(
    `select app.hat_recht('zeit.abrechnung_freigeben', app.aktiver_mandant()) as hat`);

  return {
    zeilen: roh.map((z) => ({
      id: z.id,
      person: z.person,
      personId: z.person_id,
      objekt: z.objekt,
      objektId: z.objekt_id,
      auftragsnummer: z.auftragsnummer,
      leistung: z.leistung,
      beginnLokal: z.beginn_lokal,
      endeLokal: z.ende_lokal,
      endeFolgetag: z.ende_folgetag,
      nettoMinuten: z.netto_minuten === null ? null : Number(z.netto_minuten),
      nacherfasst: z.nacherfasst,
      ohneAuftrag: z.ohne_auftrag,
      monatGesperrt: z.monat_gesperrt,
    })),
    auswahl: { personen, objekte },
    darfFreigeben: recht?.hat === true,
  };
}

/**
 * Die Summe der Nettominuten einer Liste — rein.
 *
 * `null` ist KEINE Null: ein Eintrag ohne berechnete Dauer ist einer, über den
 * niemand etwas weiss, und er wird nicht stillschweigend als „0 Minuten"
 * mitaddiert. Die Zahl daneben sagt, wie viele das sind.
 */
export function summeMinuten(
  zeilen: readonly { readonly nettoMinuten: number | null }[],
): { readonly minuten: number; readonly ohneDauer: number } {
  let minuten = 0;
  let ohneDauer = 0;
  for (const z of zeilen) {
    if (z.nettoMinuten === null) ohneDauer += 1;
    else minuten += z.nettoMinuten;
  }
  return { minuten, ohneDauer };
}

export type FreigabeErgebnis =
  | 'freigegeben' | 'nicht_gefunden' | 'nicht_abgeschlossen'
  | 'bereits_freigegeben' | 'storniert' | 'ohne_dauer';

/** Der Satz je Ergebnis — in Worten, weil ein Schlüssel keine Auskunft ist. */
export const ERGEBNIS_TEXT: Readonly<Record<FreigabeErgebnis, string>> = {
  freigegeben: 'freigegeben',
  nicht_gefunden: 'nicht gefunden oder nicht sichtbar',
  nicht_abgeschlossen: 'noch nicht abgeschlossen — ein laufender Eintrag hat keine Dauer',
  bereits_freigegeben: 'war schon freigegeben',
  storniert: 'storniert oder ersetzt — sie trägt keine Wahrheit mehr',
  ohne_dauer: 'ohne berechnete Nettodauer — es gäbe nichts abzurechnen',
};

export class FreigabeFehler extends Error {
  readonly code: 'leer' | 'zu_gross';
  readonly status = 400;
  constructor(code: 'leer' | 'zu_gross', nachricht: string) {
    super(nachricht);
    this.code = code;
    this.name = 'FreigabeFehler';
  }
}

export interface FreigabeBericht {
  readonly freigegeben: number;
  readonly uebersprungen: readonly {
    readonly zeiteintragId: string; readonly ergebnis: FreigabeErgebnis;
  }[];
}

/**
 * Gibt die gewaehlten Eintraege frei — je Zeile ein Ergebnis.
 *
 * Kein Alles-oder-nichts: ein Lauf ueber sechzig Eintraege, der an der einen
 * stornierten Zeile stirbt, erzieht dazu, ihn nicht zu benutzen. Die
 * Rechtepruefung, die Bedingungen je Zeile und das Protokoll stecken in
 * `app.zeit_zur_abrechnung_freigeben` (0366); dieser Dienst zaehlt und
 * uebersetzt.
 */
export async function gibFrei(
  kontext: SchreibKontext, ids: readonly string[],
): Promise<FreigabeBericht> {
  if (ids.length === 0) {
    throw new FreigabeFehler('leer', 'Es war nichts ausgewählt.');
  }
  if (ids.length > FREIGABE_HOECHSTZAHL) {
    throw new FreigabeFehler('zu_gross',
      `Höchstens ${String(FREIGABE_HOECHSTZAHL)} Einträge auf einmal — darüber ist es `
      + 'keine Prüfung mehr.');
  }

  const zeilen = await kontext.schreibe<{ zeiteintrag_id: string; ergebnis: string }>(
    `select zeiteintrag_id, ergebnis from app.zeit_zur_abrechnung_freigeben($1::uuid[])`,
    [[...ids]]);

  const uebersprungen = zeilen
    .filter((z) => z.ergebnis !== 'freigegeben')
    .map((z) => ({
      zeiteintragId: z.zeiteintrag_id,
      ergebnis: z.ergebnis as FreigabeErgebnis,
    }));

  return {
    freigegeben: zeilen.filter((z) => z.ergebnis === 'freigegeben').length,
    uebersprungen,
  };
}
