/**
 * Die Korrekturspur (TIM-11, EMP-04, EMP-07, §5.7, §15.6).
 *
 * **Eine Korrektur ist eine neue Fassung, nie ein UPDATE am Beleg.** Der
 * naheliegende Weg — den Zeitdatensatz aendern und die Aenderung daneben
 * protokollieren — verliert genau das, worauf es ankommt: die Fassung, DIE
 * GALT, als der Lohn gezahlt und die Rechnung geschrieben wurde. Eine
 * festgeschriebene Rechnung zeigte danach auf eine Zeile, deren Inhalt sich
 * seither geaendert hat.
 *
 * Der Ablauf ist deshalb dreiteilig und laeuft in EINER Transaktion:
 *
 *   1. die aktuelle Fassung lesen (`ersetzt_am is null`) — sie ist das
 *      „vorher";
 *   2. die naechste Fassung schreiben: gleiche `kette_id`, `version + 1`, die
 *      geaenderten Werte, `quelle = 'planer_entscheidung'`;
 *   3. die Korrekturzeile schreiben. Ihr Ausloeser markiert die alte Fassung
 *      als abgeloest — die einzige Mutation, die `z_unveraenderlich` zulaesst.
 *
 * Umgekehrt ginge es nicht: die Korrekturzeile verweist auf die Ersatzfassung,
 * und ohne sie gaebe es zwei Fassungen mit `ersetzt_am is null` — also zwei
 * „aktuelle" Wahrheiten ueber dieselbe Schicht, und jede Stundenauswertung
 * zaehlte doppelt.
 *
 * Ein Eintrag, der noch `laufend` ist, wird NICHT so korrigiert: dort erlaubt
 * `z_unveraenderlich` die direkte Aenderung, weil noch nichts feststeht. Die
 * Spur beginnt, wenn der Datensatz geschlossen ist.
 */
import type { SchreibKontext } from '../../kontext/index.js';
import { istPortalSprache, type PortalSprache } from '../../../lib/i18n/texte.js';
import { korrekturNachricht } from '../../../lib/i18n/zeitkorrektur.js';
import { eroeffneFaden } from '../kern/nachricht.js';

export class KeinNachrichtenRechtFehler extends Error {
  constructor() {
    super('Diese Gesellschaft hat der korrigierenden Rolle `nachricht.versenden` '
      + 'entzogen. Eine Korrektur ohne Nachricht an die Mitarbeiterin gibt es nicht '
      + '(TIM-11) — entweder das Recht binden oder nicht korrigieren.');
    this.name = 'KeinNachrichtenRechtFehler';
  }
}

export type KorrekturArt =
  | 'zeit_korrektur' | 'pause_korrektur' | 'zuordnung_korrektur'
  | 'nacherfassung' | 'storno';

export type KorrekturGrund =
  | 'vergessen_auszustempeln' | 'geraet_defekt' | 'falsches_objekt'
  | 'einwand_mitarbeiter' | 'nachtrag_offline' | 'sonstiges';

export interface KorrekturEingabe {
  /** Die AKTUELLE Fassung der Kette. */
  readonly zeiteintragId: string;
  readonly art: KorrekturArt;
  readonly grundKategorie: KorrekturGrund;
  /** Pflicht, ohne Mindestlaenge: „Krank" ist eine Begruendung (§5.7). */
  readonly begruendung: string;
  /** Wer korrigiert — nie der betroffene Mensch (`zk_nicht_selbst`). */
  readonly durchgefuehrtVon: string;
  readonly beginnZeitpunkt?: Date;
  readonly endeZeitpunkt?: Date | null;
  readonly pauseMinuten?: number;
  /** Was der Mensch behauptet hat — die Grundlage der Entscheidung (§1.8). */
  readonly behauptetBeginn?: Date | null;
  readonly behauptetEnde?: Date | null;
  /**
   * Die Gegenbuchung, wenn der Monat des Ursprungs gesperrt ist. Fehlt sie
   * dort, weist `zk_sperre_ausgleich` die Korrektur ab — eine Differenz, die
   * nirgends ankommt, ist keine Korrektur (EMP-04, §12.2).
   */
  readonly ausgleichBewegungId?: string | null;
  /**
   * Der Einwand, auf den diese Korrektur antwortet (EMP-07, TIM-11).
   *
   * **Der Befund, der dieses Feld gebracht hat.** Die Spalte
   * `zeiteintrag_korrektur.zeit_einwand_id` gibt es seit der Anlage der
   * Tabelle, mit eigenem Fremdschluessel (`zk_einwand_fk` auf
   * `zeit_einwand(mandant_id, id)`) — und im ganzen `src/`-Baum schrieb sie
   * NIEMAND. Gelesen wurde sie: `leseEinwand` haengt daran den Abschnitt
   * „Ist eine Korrektur gefolgt?" des Einwandblatts. Die Antwort war damit
   * immer „nein", auch wenn jemand denselben Tag eine Minute spaeter
   * korrigiert hatte. Eine anerkannte Meldung ohne Korrektur ist der Fall,
   * den man sehen will — eine Seite, die ihn IMMER zeigt, ist schlimmer als
   * keine, weil sie aussieht wie eine Antwort.
   *
   * Optional, und das ist Absicht: nicht jede Korrektur antwortet auf eine
   * Meldung. Der Planer, der eine vergessene Abmeldung nachtraegt, hat
   * keinen Einwand vor sich.
   */
  readonly zeitEinwandId?: string | null;
  readonly ipAdresse?: string | null;
}

export class KeinAktuellerEintragFehler extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(id: string) {
    super(`Zeiteintrag ${id} ist nicht die aktuelle Fassung seiner Kette.`);
    this.name = 'KeinAktuellerEintragFehler';
  }
}

export class LaufenderEintragFehler extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor() {
    super('Ein laufender Zeiteintrag wird bearbeitet, nicht korrigiert.');
    this.name = 'LaufenderEintragFehler';
  }
}

interface EintragZeile {
  id: string;
  mandant_id: string;
  kette_id: string;
  version: number;
  anstellung_id: string;
  person_id: string;
  einsatz_id: string | null;
  einsatz_zuordnung_id: string | null;
  objekt_id: string | null;
  auftrag_leistung_id: string | null;
  revier_id: string | null;
  beginn_zeitpunkt: Date;
  ende_zeitpunkt: Date | null;
  pause_minuten: number;
  status: string;
  ersetzt_am: Date | null;
  checkin_token_id: string | null;
  checkout_token_id: string | null;
  geraete_zeit_beginn: Date | null;
  geraete_zeit_ende: Date | null;
}

export interface KorrekturErgebnis {
  readonly korrekturId: string;
  readonly neueFassungId: string;
  readonly version: number;
}

export async function korrigiereZeiteintrag(
  kontext: SchreibKontext,
  eingabe: KorrekturEingabe,
): Promise<KorrekturErgebnis> {
  const [alt] = await kontext.abfrage<EintragZeile>(
    `select id, mandant_id, kette_id, version, anstellung_id, person_id,
            einsatz_id, einsatz_zuordnung_id, objekt_id, auftrag_leistung_id,
            revier_id, beginn_zeitpunkt, ende_zeitpunkt, pause_minuten, status,
            ersetzt_am, checkin_token_id, checkout_token_id,
            geraete_zeit_beginn, geraete_zeit_ende
       from zeiteintrag where id = $1`,
    [eingabe.zeiteintragId],
  );
  // Kein Satz heisst hier zweierlei — es gibt ihn nicht, oder er gehoert einer
  // anderen Gesellschaft und die RLS blendet ihn aus. Beides ist dieselbe
  // Antwort nach aussen (AUT-06); der Unterschied waere die Auskunft, dass es
  // ihn woanders gibt.
  if (alt === undefined) throw new KeinAktuellerEintragFehler(eingabe.zeiteintragId);
  if (alt.ersetzt_am !== null) throw new KeinAktuellerEintragFehler(eingabe.zeiteintragId);
  if (alt.status === 'laufend') throw new LaufenderEintragFehler();

  const beginn = eingabe.beginnZeitpunkt ?? alt.beginn_zeitpunkt;
  const ende = eingabe.endeZeitpunkt === undefined ? alt.ende_zeitpunkt : eingabe.endeZeitpunkt;
  const pause = eingabe.pauseMinuten ?? alt.pause_minuten;

  const storno = eingabe.art === 'storno';

  /**
   * Die Ersatzfassung — `quelle_* = 'planer_entscheidung'`, weil ein benannter
   * Mensch entschieden hat, und `nacherfasst = true`, weil die Bedingung
   * `z_quelle_*_belegt` das verlangt. Der Beleg fuer die Entscheidung ist die
   * Korrekturzeile unten; ohne sie duerfte diese Fassung nicht entstehen.
   *
   * `behauptet_*` traegt, was der Mensch gesagt hat — je Ereignis und nicht
   * beides: wer nur das Ende vergessen hat, behauptet keinen Beginn, und die
   * Bedingung `z_anspruch_je_ereignis` verlangt genau deshalb nur EINE der
   * beiden Seiten.
   */
  let neueFassungId: string | null = null;
  if (!storno) {
    const [neu] = await kontext.schreibe<{ id: string }>(
      `insert into zeiteintrag
         (mandant_id, kette_id, version, ersetzt_zeiteintrag_id,
          anstellung_id, person_id, einsatz_id, einsatz_zuordnung_id, objekt_id,
          auftrag_leistung_id, revier_id,
          beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
          erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
          geraete_zeit_beginn, geraete_zeit_ende,
          behauptet_beginn, behauptet_ende, nacherfasst,
          checkin_token_id, checkout_token_id, status,
          erstellt_von_art, erstellt_von, erstellt_von_person_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12::timestamptz, $13::timestamptz, $14,
               'nacherfassung', case when $13::timestamptz is null then null
                                     else 'nacherfassung' end::erfassungs_art,
               'planer_entscheidung',
               case when $13::timestamptz is null then null
                    else 'planer_entscheidung' end::zeitquelle,
               $15::timestamptz, $16::timestamptz,
               $17::timestamptz, $18::timestamptz, true,
               $19, $20, $21::zeiteintrag_status,
               'mensch', $22, $23)
       returning id`,
      [
        alt.mandant_id, alt.kette_id, alt.version + 1, alt.id,
        alt.anstellung_id, alt.person_id, alt.einsatz_id, alt.einsatz_zuordnung_id,
        alt.objekt_id, alt.auftrag_leistung_id, alt.revier_id,
        beginn.toISOString(), ende?.toISOString() ?? null, pause,
        alt.geraete_zeit_beginn?.toISOString() ?? null,
        alt.geraete_zeit_ende?.toISOString() ?? null,
        // Wenigstens eine Seite muss behauptet sein — ohne Angabe des
        // Aufrufers ist es die Seite, die sich geaendert hat.
        eingabe.behauptetBeginn?.toISOString()
          ?? (eingabe.beginnZeitpunkt === undefined ? null : beginn.toISOString()),
        eingabe.behauptetEnde?.toISOString()
          ?? (eingabe.endeZeitpunkt === undefined ? null : ende?.toISOString() ?? null),
        alt.checkin_token_id, alt.checkout_token_id, alt.status,
        eingabe.durchgefuehrtVon, alt.person_id,
      ],
    );
    neueFassungId = neu?.id ?? null;
    if (neueFassungId === null) throw new Error('Die Ersatzfassung wurde nicht geschrieben.');
  }

  /**
   * `vorher` und `nachher` als vollstaendige Feldabbilder (SEC-A9). Sie werden
   * in der DATENBANK gebildet (`to_jsonb`), nicht hier zusammengesetzt: ein
   * von Hand gebautes Abbild vergisst die Spalte, die eine spaetere Migration
   * ergaenzt hat — und niemand sieht es, weil das Abbild trotzdem plausibel
   * aussieht.
   */
  const [korrektur] = await kontext.schreibe<{ id: string }>(
    `insert into zeiteintrag_korrektur
       (mandant_id, kette_id, ursprung_zeiteintrag_id, ersatz_zeiteintrag_id,
        art, grund_kategorie, begruendung, vorher, nachher,
        ausgleich_bewegung_id, zeit_einwand_id, durchgefuehrt_von, ip_adresse,
        erstellt_von_art, erstellt_von)
     select $1, $2, $3, $4::uuid, $5::korrektur_art, $6::korrektur_grund, $7,
            to_jsonb(a), coalesce(to_jsonb(n), '{}'::jsonb),
            $8::uuid, $11::uuid, $9, $10::inet, 'mensch', $9
       from zeiteintrag a
       left join zeiteintrag n on n.id = $4::uuid
      where a.id = $3
     returning id`,
    [
      alt.mandant_id, alt.kette_id, alt.id, neueFassungId,
      eingabe.art, eingabe.grundKategorie, eingabe.begruendung,
      eingabe.ausgleichBewegungId ?? null, eingabe.durchgefuehrtVon,
      eingabe.ipAdresse ?? null,
      eingabe.zeitEinwandId ?? null,
    ],
  );
  if (korrektur === undefined) throw new Error('Die Korrekturzeile wurde nicht geschrieben.');

  await meldeDerMitarbeiterin(kontext, {
    personId: alt.person_id,
    zeiteintragId: neueFassungId ?? alt.id,
    art: eingabe.art,
    grundKategorie: eingabe.grundKategorie,
    begruendung: eingabe.begruendung,
  });

  return {
    korrekturId: korrektur.id,
    neueFassungId: neueFassungId ?? alt.id,
    version: storno ? alt.version : alt.version + 1,
  };
}

export interface KorrekturSpurZeile {
  readonly id: string;
  readonly art: KorrekturArt;
  readonly grundKategorie: KorrekturGrund;
  readonly begruendung: string;
  readonly durchgefuehrtVon: string;
  readonly durchgefuehrtAm: Date;
}

/** Die Geschichte eines Zeiteintrags — EIN indizierter Zugriff (`zk_kette_idx`). */
export async function leseKorrekturSpur(
  kontext: { abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]> },
  ketteId: string,
): Promise<readonly KorrekturSpurZeile[]> {
  const zeilen = await kontext.abfrage<{
    id: string; art: KorrekturArt; grund_kategorie: KorrekturGrund;
    begruendung: string; durchgefuehrt_von: string; durchgefuehrt_am: Date;
  }>(
    `select id, art, grund_kategorie, begruendung, durchgefuehrt_von, durchgefuehrt_am
       from zeiteintrag_korrektur
      where kette_id = $1
      order by durchgefuehrt_am asc`,
    [ketteId],
  );
  return zeilen.map((z) => ({
    id: z.id,
    art: z.art,
    grundKategorie: z.grund_kategorie,
    begruendung: z.begruendung,
    durchgefuehrtVon: z.durchgefuehrt_von,
    durchgefuehrtAm: z.durchgefuehrt_am,
  }));
}

/**
 * Sagt der Mitarbeiterin, dass ihre Zeit korrigiert wurde — und warum.
 *
 * **Der Befund, der das ausgeloest hat.** `/portal/[mandant]/zeiten/[id]/korrektur`
 * verlangt Art, Grund und Begruendung als PFLICHTFELDER. Der Dienst schrieb sie
 * sauber in `zeiteintrag_korrektur` — und schwieg. Der Mensch, dessen Stunden
 * sich aenderten, erfuhr davon nur, wenn er zufaellig nachsah. Der Mandant hat
 * es woertlich verlangt: „التعديل مع رسالة للموظف بتكون ليعرف ليش هيك صار."
 *
 * **In DERSELBEN Transaktion wie die Korrektur, und das ist die Entscheidung.**
 * Eine Korrektur, deren Nachricht scheitert, waere wieder genau der Zustand,
 * den dieser Code behebt — nur diesmal mit dem guten Gewissen, es versucht zu
 * haben. Entweder beides oder keines.
 *
 * **Das Recht wird VORHER geprueft, damit der Fehlschlag lesbar ist.**
 * `nachricht.versenden` haelt per Vorgabe jede Rolle, die auch korrigieren
 * darf (0008); eine Gesellschaft kann es ihr aber entziehen. Ohne diese
 * Pruefung meldete die Policy „new row violates row-level security" — ein
 * Satz, der auf die Zeiterfassung zeigt und die Ursache verschweigt.
 *
 * **`richtung = intern`, `kanal = portal`** (ueber `eroeffneFaden`): das
 * verlaesst die Plattform nicht und beruehrt Invariante 7 nicht. Was nach
 * draussen geht, laeuft ueber `sendeNachAussen` und die Freigabekette.
 */
async function meldeDerMitarbeiterin(
  kontext: SchreibKontext,
  eingabe: {
    readonly personId: string | null;
    readonly zeiteintragId: string;
    readonly art: KorrekturArt;
    readonly grundKategorie: KorrekturGrund;
    readonly begruendung: string;
  },
): Promise<void> {
  /* Ohne Menschen gibt es niemanden zu benachrichtigen. Die Spalte ist
     `not null` im Normalfall; die Zeile hier ist der Guertel dazu. */
  if (eingabe.personId === null) return;

  /**
   * Sprache und Tag in EINER Abfrage — und den Tag aus der DATENBANK.
   *
   * `(beginn_zeitpunkt at time zone 'Europe/Berlin')::date` ist Invariante 2:
   * eine Schicht, die um 23:30 UTC beginnt, gehoert in Berlin zum FOLGETAG,
   * und ein in JavaScript gebildetes Datum haette genau an den Naechten
   * gelogen, um die es bei Korrekturen am haeufigsten geht.
   */
  const [z] = await kontext.abfrage<{ sprache: string | null; tag: string }>(
    `select p.sprache,
            to_char((e.beginn_zeitpunkt at time zone 'Europe/Berlin')::date,
                    'DD.MM.YYYY') as tag
       from zeiteintrag e
       join person p on p.id = e.person_id
      where e.id = $1`,
    [eingabe.zeiteintragId],
  );
  if (z === undefined) return;

  const [recht] = await kontext.abfrage<{ hat: boolean }>(
    `select app.hat_recht('nachricht.versenden', app.aktiver_mandant()) as hat`);
  if (recht?.hat !== true) throw new KeinNachrichtenRechtFehler();

  const sprache: PortalSprache =
    typeof z.sprache === 'string' && istPortalSprache(z.sprache) ? z.sprache : 'de';

  const { betreff, koerper } = korrekturNachricht(sprache, {
    art: eingabe.art,
    grund: eingabe.grundKategorie,
    begruendung: eingabe.begruendung,
    datum: z.tag,
  });

  await eroeffneFaden(kontext, {
    betreff,
    koerper,
    empfaenger: [{ typ: 'person', id: eingabe.personId, art: 'an' }],
    bezugTyp: 'zeiteintrag',
    bezugId: eingabe.zeiteintragId,
  });
}
