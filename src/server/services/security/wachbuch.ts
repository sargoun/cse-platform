/**
 * Das Wachbuch (SEC-05, TIM-08, TIM-09, TIM-10, LEG-01).
 *
 * **Die harten Zusagen stehen in der Datenbank, nicht hier** (0070): die
 * Serverzeit, die laufende Nummer, die Hashkette, die Unaenderbarkeit und das
 * Loeschverbot sind Ausloeser und Bedingungen. Das ist kein Misstrauen gegen
 * diesen Dienst, sondern die Antwort auf die Frage, was gilt, wenn ein Import,
 * ein Skript oder ein kuenftiger Dienst ihn nicht aufruft: dieselbe Regel.
 *
 * Was dieser Dienst dazugibt, ist das, was eine Datenbank schlecht kann:
 *
 *  - Er loest den URHEBER serverseitig auf. Wer schreibt, steht in der Sitzung
 *    — nie in der Anfrage. Ein `anstellung_id` aus dem Formular waere eine
 *    Wachbuchseite, die jemand einem Kollegen unterschiebt.
 *  - Er macht aus einer Korrektur ZWEI Vorgaenge in EINER Transaktion: den
 *    neuen Eintrag und die Stornierung des alten, die auf ihn zeigt. Eine
 *    Korrektur, bei der nur die Haelfte ankommt, ist schlimmer als keine.
 *  - Er uebersetzt die Kettenpruefung in einen Befund, den ein Mensch liest.
 */
import { randomUUID } from 'node:crypto';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

/** Die fuenf Arten aus SEC-05 — der Aufzaehlungstyp `wachbuch_art` (0070). */
export const WACHBUCH_ARTEN = [
  'rundgang', 'vorkommnis', 'uebergabe', 'schluessel', 'alarm',
] as const;
export type WachbuchArt = (typeof WACHBUCH_ARTEN)[number];

/** Die deutschen Bezeichnungen — die Oberflaeche ist deutsch (CLAUDE.md). */
export const ART_TEXT: Readonly<Record<WachbuchArt, string>> = {
  rundgang: 'Rundgang',
  vorkommnis: 'Vorkommnis',
  uebergabe: 'Übergabe',
  schluessel: 'Schlüssel',
  alarm: 'Alarm',
};

export function istWachbuchArt(wert: unknown): wert is WachbuchArt {
  return typeof wert === 'string' && (WACHBUCH_ARTEN as readonly string[]).includes(wert);
}

export class KeinUrheber extends Error {
  readonly code = 'kein_urheber';
  readonly status = 422;
  constructor() {
    super(
      'Ein Wachbucheintrag trägt seinen Urheber als Beschäftigung in dieser '
      + 'Gesellschaft (§10.5) — dieses Konto hat hier keine. Eintragen kann nur, '
      + 'wer angestellt ist; wer Einträge nur liest, braucht keine.',
    );
    this.name = 'KeinUrheber';
  }
}

export class WachbuchEingabeFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'WachbuchEingabeFehlt';
  }
}

export class EintragNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    // 404 und nicht 403: dass es die Seite anderswo gibt, ist selbst eine
    // Auskunft (AUT-06).
    super(`Den Wachbucheintrag ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'EintragNichtGefunden';
  }
}

export class SchonStorniert extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor() {
    super(
      'Dieser Eintrag ist bereits storniert. Eine zweite Korrektur knüpft an den '
      + 'Eintrag an, der ihn ersetzt hat — nicht an diesen.',
    );
    this.name = 'SchonStorniert';
  }
}

export interface EintragEingabe {
  readonly objektId: string;
  readonly art: WachbuchArt;
  readonly betreff: string;
  readonly eintragstext: string;
  readonly einsatzId?: string | null;
  readonly postenId?: string | null;
  readonly veranstaltungId?: string | null;
  readonly kontrollpunktId?: string | null;
  readonly praesenzBestaetigt?: boolean;
  readonly polizeiInformiert?: boolean;
  /**
   * Die Uhr des Geraets, als BEHAUPTUNG (TIM-08). Sie wird gespeichert und
   * ihre Abweichung abgeleitet; massgeblich ist sie nie.
   */
  readonly geraeteZeit?: string | null;
  /** Der Eintrag lag offline in der Warteschlange (TIM-09). */
  readonly nachgetragen?: boolean;
}

interface UrheberZeile {
  readonly anstellung_id: string;
  readonly person_id: string;
}

/**
 * Wer schreibt — aus der SITZUNG, nie aus der Anfrage.
 *
 * `app.aktuelle_person()` ist die Person hinter der Anmeldung (K-02); die
 * Beschaeftigung dazu muss im aktiven Mandanten liegen, denn die Pflicht,
 * ein Wachbuch zu fuehren, ist die dieser einen Gesellschaft (§10.5).
 *
 * Mehrere aktive Beschaeftigungen im selben Mandanten sind nicht vorgesehen;
 * sollte es sie geben, gewinnt die aelteste — eine willkuerliche, aber
 * STABILE Wahl. Eine zufaellige waere die schlechtere: derselbe Mensch stuende
 * dann mal unter der einen, mal unter der anderen Nummer im Buch.
 */
async function urheber(kontext: SchreibKontext): Promise<UrheberZeile> {
  const [zeile] = await kontext.abfrage<UrheberZeile>(
    `select a.id as anstellung_id, a.person_id
       from anstellung a
      where a.person_id = app.aktuelle_person()
        and a.mandant_id = app.aktiver_mandant()
        and a.geloescht_am is null
        and a.status = 'aktiv'
      order by a.eintritt, a.id
      limit 1`,
  );
  if (zeile === undefined) throw new KeinUrheber();
  return zeile;
}

function pruefeText(eingabe: EintragEingabe): void {
  if (eingabe.betreff.trim() === '') {
    throw new WachbuchEingabeFehlt('Ein Eintrag braucht einen Betreff.');
  }
  if (eingabe.eintragstext.trim() === '') {
    throw new WachbuchEingabeFehlt(
      'Ein Eintrag ohne Text ist keine Dokumentation. Was ist passiert?',
    );
  }
  /**
   * **Keine Schein-Integration.** `schluessel` entsteht erst mit PR 42; bis
   * dahin gibt es keine Kennung, auf die `art = 'schluessel'` zeigen koennte.
   * Die Datenbank verlangt sie (`wachbuch_schluessel_genannt`), also weist der
   * Dienst die Art mit einer Meldung ab, die den Grund nennt, statt den
   * Aufrufer in eine Bedingungsverletzung laufen zu lassen.
   */
  if (eingabe.art === 'schluessel') {
    throw new WachbuchEingabeFehlt(
      'Schlüsselbewegungen werden mit der Schlüsselverwaltung erfasst, und die ist '
      + 'noch nicht gebaut (SEC-07). Bis dahin: als „Übergabe" eintragen und den '
      + 'Schlüssel im Text benennen.',
    );
  }
  if (eingabe.praesenzBestaetigt === true
      && (eingabe.kontrollpunktId ?? '') === '') {
    throw new WachbuchEingabeFehlt(
      'Ein Präsenznachweis braucht den Kontrollpunkt, an dem er entstanden ist.',
    );
  }
}

/**
 * Schreibt eine Seite. Serverzeit, Nummer und Kettenglied kommen aus der
 * Datenbank (0070) — dieser Dienst schickt sie nicht einmal mit.
 */
export async function schreibeEintrag(
  kontext: SchreibKontext, eingabe: EintragEingabe,
): Promise<string> {
  pruefeText(eingabe);
  const wer = await urheber(kontext);

  /**
   * **Die `id` entsteht in der Anwendung, und das ist nicht Geschmack.**
   *
   * `insert … returning id` zieht die SELECT-Policy der Tabelle mit hinein —
   * PostgreSQL wendet sie auf die zurueckgegebene Zeile an. `t_mandant`
   * verlangt zum Lesen `wachbuch.lesen`, und genau das haelt die Rolle
   * `mitarbeiter` NICHT (03-AUTH §12.7: sie haelt `wachbuch.schreiben`, weil
   * SEC-05 die Wache das Buch fuehren laesst, und liest ihre eigenen Seiten im
   * eigenen Portal ueber `t_person`). Mit `returning` schluege also ausgerechnet
   * der Schreibweg fehl, fuer den diese Tabelle gebaut ist — und zwar mit
   * „null Zeilen", also wie ein Rechtefehler, der keiner ist.
   *
   * Dieselbe Bauart wie beim Generator (`04-PLANUNG-ZEIT.md` §8.3): der Dienst
   * kennt die Kennung, bevor er schreibt.
   */
  const id = randomUUID();
  await kontext.schreibe(
    `insert into wachbuch_eintrag
       (id, mandant_id, objekt_id, posten_id, veranstaltung_id, einsatz_id,
        anstellung_id, person_id, art, betreff, eintragstext,
        kontrollpunkt_id, praesenz_bestaetigt, polizei_informiert,
        geraete_zeit, nachgetragen, erstellt_von_art, erstellt_von, erstellt_von_person_id)
     values ($17::uuid, $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
             $6::uuid, $7::uuid, $8::wachbuch_art, $9, $10,
             $11::uuid, $12::boolean, $13::boolean,
             $14::timestamptz, $15::boolean, 'mensch', $16::uuid, $7::uuid)`,
    [
      kontext.aktiverMandantId, eingabe.objektId,
      eingabe.postenId ?? null, eingabe.veranstaltungId ?? null, eingabe.einsatzId ?? null,
      wer.anstellung_id, wer.person_id, eingabe.art,
      eingabe.betreff.trim(), eingabe.eintragstext.trim(),
      eingabe.kontrollpunktId ?? null,
      eingabe.praesenzBestaetigt === true, eingabe.polizeiInformiert === true,
      eingabe.geraeteZeit ?? null, eingabe.nachgetragen === true,
      kontext.benutzerId, id,
    ],
  );
  return id;
}

export interface KorrekturEingabe {
  readonly eintragId: string;
  /** Warum der alte Eintrag falsch war — er bleibt lesbar stehen. */
  readonly grund: string;
  readonly betreff: string;
  readonly eintragstext: string;
}

/** So kurz darf ein Korrekturgrund sein: „Tippfehler" ist einer. */
const GRUND_MINDESTLAENGE = 5;

/**
 * Die Korrektur — EIN NEUER EINTRAG, nie eine Aenderung (Abnahme 3).
 *
 * Zwei Schritte in einer Transaktion, und die Reihenfolge ist nicht beliebig:
 * erst der neue Eintrag (er braucht seine eigene Nummer und sein eigenes
 * Kettenglied), dann das Storno des alten, das auf ihn zeigt. Andersherum
 * stuende zwischendurch ein `ersetzt_durch_id` auf einer Zeile, die es noch
 * nicht gibt.
 *
 * Der alte Eintrag bleibt LESBAR. Das ist der ganze Punkt: ein Wachbuch, aus
 * dem sich die falsche Seite entfernen laesst, beweist nichts — erst das
 * Nebeneinander von Irrtum und Richtigstellung tut es.
 */
export async function korrigiereEintrag(
  kontext: SchreibKontext, eingabe: KorrekturEingabe,
): Promise<string> {
  if (eingabe.grund.trim().length < GRUND_MINDESTLAENGE) {
    throw new WachbuchEingabeFehlt(
      'Eine Korrektur ohne Grund ist im Streitfall keine Auskunft. Warum war der '
      + 'Eintrag falsch?',
    );
  }

  const [alt] = await kontext.abfrage<{
    objekt_id: string; posten_id: string | null; veranstaltung_id: string | null;
    einsatz_id: string | null; art: WachbuchArt; storniert: boolean;
  }>(
    `select objekt_id, posten_id, veranstaltung_id, einsatz_id, art::text as art,
            (storniert_am is not null) as storniert
       from wachbuch_eintrag where id = $1::uuid`,
    [eingabe.eintragId],
  );
  if (alt === undefined) throw new EintragNichtGefunden(eingabe.eintragId);
  if (alt.storniert) throw new SchonStorniert();

  /**
   * Der Ersatz erbt den BEZUG des Originals — Objekt, Posten, Veranstaltung,
   * Schicht —, nicht seinen Inhalt. Ein Aufrufer, der den Bezug mitschicken
   * duerfte, koennte eine Korrektur an ein anderes Objekt haengen, und die
   * beiden Zeilen stuenden in zwei verschiedenen Buechern.
   *
   * Die ART wird ebenfalls uebernommen: eine Richtigstellung eines
   * Vorkommnisses ist ein Vorkommnis. `schluessel` kommt hier nicht vor — die
   * Art laesst sich heute gar nicht eintragen (siehe `pruefeText`).
   */
  const neu = await schreibeEintrag(kontext, {
    objektId: alt.objekt_id,
    art: alt.art,
    betreff: eingabe.betreff,
    eintragstext: eingabe.eintragstext,
    postenId: alt.posten_id,
    veranstaltungId: alt.veranstaltung_id,
    einsatzId: alt.einsatz_id,
  });

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update wachbuch_eintrag
        set storniert_am = now(), storniert_von = $2::uuid,
            storno_grund = $3, ersetzt_durch_id = $4::uuid
      where id = $1::uuid and storniert_am is null
      returning id`,
    [eingabe.eintragId, kontext.benutzerId, eingabe.grund.trim(), neu],
  );
  if (zeilen.length === 0) {
    /**
     * Null Zeilen heisst: zwischen Lesen und Schreiben hat jemand anderes
     * storniert. Werfen, damit die Transaktion zurueckrollt — sonst stuende
     * der neue Eintrag da, ohne dass der alte auf ihn zeigt, und das Buch
     * enthielte zwei widersprechende Seiten ohne Verbindung.
     */
    throw new SchonStorniert();
  }
  return neu;
}

/** Eine Buchseite, wie die Liste und das Einzelblatt sie zeigen. */
export interface EintragZeile {
  readonly id: string;
  readonly jahr: number;
  readonly laufnummer: number;
  readonly nummer: string;
  readonly art: WachbuchArt;
  readonly betreff: string;
  readonly eintragstext: string;
  readonly objektId: string;
  readonly objekt: string;
  /** Berliner Ortszeit, fertig aus der Datenbank (Invariante 2). */
  readonly erfasstLokal: string;
  readonly urheber: string;
  readonly zeitabweichungSek: number | null;
  readonly nachgetragen: boolean;
  readonly polizeiInformiert: boolean;
  readonly kontrollpunkt: string | null;
  readonly praesenzBestaetigt: boolean;
  readonly storniert: boolean;
  readonly stornoGrund: string | null;
  readonly ersetztDurchId: string | null;
  readonly ersetztId: string | null;
}

interface RohEintrag {
  readonly id: string;
  readonly jahr: number;
  readonly laufnummer: string;
  readonly art: WachbuchArt;
  readonly betreff: string;
  readonly eintragstext: string;
  readonly objekt_id: string;
  readonly objekt: string;
  readonly erfasst_lokal: string;
  readonly urheber: string;
  readonly zeitabweichung_sek: number | null;
  readonly nachgetragen: boolean;
  readonly polizei_informiert: boolean;
  readonly kontrollpunkt: string | null;
  readonly praesenz_bestaetigt: boolean;
  readonly storniert: boolean;
  readonly storno_grund: string | null;
  readonly ersetzt_durch_id: string | null;
  readonly ersetzt_id: string | null;
}

/**
 * Die laufende Nummer, wie sie im Buch steht.
 *
 * Sie wird HIER gebildet und nicht aus `nummernkreis.format_maske` geholt: die
 * Maske ist fuer Dokumente da, die ihre Nummer als TEXT tragen (eine
 * Rechnung). Das Wachbuch speichert Jahr und Nummer als Zahlen, und die
 * Anzeige ist eine Anzeigeentscheidung — an EINER Stelle.
 */
function nummer(jahr: number, laufnummer: number): string {
  return `${String(jahr)}/${String(laufnummer).padStart(4, '0')}`;
}

function ausEintrag(z: RohEintrag): EintragZeile {
  const lfd = Number(z.laufnummer);
  return {
    id: z.id,
    jahr: Number(z.jahr),
    laufnummer: lfd,
    nummer: nummer(Number(z.jahr), lfd),
    art: z.art,
    betreff: z.betreff,
    eintragstext: z.eintragstext,
    objektId: z.objekt_id,
    objekt: z.objekt,
    erfasstLokal: z.erfasst_lokal,
    urheber: z.urheber,
    zeitabweichungSek: z.zeitabweichung_sek === null ? null : Number(z.zeitabweichung_sek),
    nachgetragen: z.nachgetragen,
    polizeiInformiert: z.polizei_informiert,
    kontrollpunkt: z.kontrollpunkt,
    praesenzBestaetigt: z.praesenz_bestaetigt,
    storniert: z.storniert,
    stornoGrund: z.storno_grund,
    ersetztDurchId: z.ersetzt_durch_id,
    ersetztId: z.ersetzt_id,
  };
}

const FELDER = `
  w.id, w.jahr, w.laufnummer, w.art::text as art, w.betreff, w.eintragstext,
  w.objekt_id, o.bezeichnung as objekt,
  to_char(w.erfasst_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as erfasst_lokal,
  (p.vorname || ' ' || p.nachname) as urheber,
  w.zeitabweichung_sek, w.nachgetragen, w.polizei_informiert,
  k.bezeichnung as kontrollpunkt, w.praesenz_bestaetigt,
  (w.storniert_am is not null) as storniert, w.storno_grund, w.ersetzt_durch_id,
  -- „Welche Seite stellt DIESE richtig?" — mit limit 1, und das ist kein
  -- Zufall: ersetzt_durch_id traegt keine Eindeutigkeit, und ein zweiter
  -- Verweis auf dieselbe Richtigstellung (von Hand geschrieben, nicht ueber
  -- den Dienst) liesse eine SKALARE Unterabfrage werfen. Ein Buch, das sich
  -- wegen einer Verweisdoppelung nicht mehr oeffnen laesst, ist die
  -- schlechtere Antwort als ein Verweis, der einen von zweien zeigt.
  (select v.id from wachbuch_eintrag v
    where v.ersetzt_durch_id = w.id order by v.laufnummer limit 1) as ersetzt_id
  from wachbuch_eintrag w
  join person p on p.id = w.person_id
  join objekt o on o.id = w.objekt_id and o.mandant_id = w.mandant_id
  left join kontrollpunkt k on k.id = w.kontrollpunkt_id and k.mandant_id = w.mandant_id`;

export interface BuchFilter {
  readonly objektId?: string | null;
  readonly art?: WachbuchArt | null;
  /** Berliner Kalendertage, beide einschliessend. */
  readonly von?: string | null;
  readonly bis?: string | null;
  readonly grenze?: number;
}

/** Das Buch ueber alle Objekte, gefiltert (SEITENKARTE §5.8). */
export async function leseBuch(
  kontext: LeseKontext, filter: BuchFilter = {},
): Promise<readonly EintragZeile[]> {
  const zeilen = await kontext.abfrage<RohEintrag>(
    `select ${FELDER}
      where ($1::uuid is null or w.objekt_id = $1::uuid)
        and ($2::text is null or w.art::text = $2::text)
        and ($3::date is null
             or w.erfasst_am >= ($3::date) at time zone 'Europe/Berlin')
        and ($4::date is null
             or w.erfasst_am <  (($4::date) + 1) at time zone 'Europe/Berlin')
      order by w.erfasst_am desc
      limit $5::integer`,
    [
      filter.objektId ?? null, filter.art ?? null,
      filter.von ?? null, filter.bis ?? null,
      filter.grenze ?? 200,
    ],
  );
  return zeilen.map(ausEintrag);
}

/** Eine einzelne Seite. */
export async function leseEintrag(
  kontext: LeseKontext, id: string,
): Promise<EintragZeile | null> {
  const [zeile] = await kontext.abfrage<RohEintrag>(
    `select ${FELDER} where w.id = $1::uuid`, [id],
  );
  return zeile === undefined ? null : ausEintrag(zeile);
}

/** Was die Kettenpruefung ueber ein Objekt sagt. */
export interface Kettenbefund {
  readonly geprueft: number;
  readonly intakt: boolean;
  readonly brueche: readonly {
    readonly eintragId: string;
    readonly nummer: string;
    readonly befund: 'hash_falsch' | 'kette_falsch';
  }[];
}

/**
 * Prueft die Kette eines Objekts (§1.15, FIN-06-Bauart).
 *
 * Die Rechnung selbst steht in `app.wachbuch_kette_pruefen` (0070) und damit
 * an EINER Stelle: dieselbe kanonische Nutzlast, die der Einfuegeausloeser
 * hasht. Eine zweite Fassung in TypeScript meldete beim ersten Unterschied im
 * Umgang mit Sonderzeichen einen Bruch, den es nicht gibt.
 */
export async function pruefeKette(
  kontext: LeseKontext, objektId: string,
): Promise<Kettenbefund> {
  const zeilen = await kontext.abfrage<{
    eintrag_id: string; jahr: number; laufnummer: string; befund: string;
  }>(
    `select eintrag_id, jahr, laufnummer, befund
       from app.wachbuch_kette_pruefen($1::uuid)`,
    [objektId],
  );
  const brueche = zeilen
    .filter((z) => z.befund !== 'intakt')
    .map((z) => ({
      eintragId: z.eintrag_id,
      nummer: nummer(Number(z.jahr), Number(z.laufnummer)),
      befund: z.befund as 'hash_falsch' | 'kette_falsch',
    }));
  return { geprueft: zeilen.length, intakt: brueche.length === 0, brueche };
}
