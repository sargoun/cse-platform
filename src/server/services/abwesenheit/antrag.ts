/**
 * Anträge — einreichen, entscheiden, zurückziehen (EMP-10, EMP-11, NOT-01).
 *
 * **Der Antrag ist der Vorgang, die Abwesenheit sein Ergebnis.** Beide bleiben
 * stehen: wer wann was beantragt hat und wer mit welchem Wort entschieden hat,
 * ist im Streit die Hälfte, die zählt — und sie verschwindet, wenn man den
 * Antrag nach der Umsetzung aufräumt.
 *
 * **Die Genehmigung schreibt die Abwesenheit HIER und nicht im Auslöser.** Die
 * angerechneten Tage sind eine Arbeitstagsrechnung mit Feiertagen und
 * Halbtagen (CLN-03); in SQL nachgebaut wäre sie eine zweite Wahrheit, die
 * genau dann von der ersten abweicht, wenn ein Feiertag nachgetragen wurde.
 * Der Auslöser `antrag_erzeugt_abwesenheit` (0074) ist trotzdem da — er fängt
 * den Fall ab, dass jemand den Antrag an diesem Dienst vorbei genehmigt, und
 * legt dann eine Abwesenheit OHNE Tage im Status `beantragt` an. Sichtbar
 * unfertig ist besser als spurlos verpufft.
 *
 * **Ohne hinterlegten Urlaubsanspruch wird nicht genehmigt** (O-18). Der
 * Auslöser des Urlaubskontos verlangt ein offenes Konto des Jahres; eines
 * stillschweigend mit null Tagen anzulegen hiesse, „kein Urlaub zugesagt" zu
 * behaupten, und der Resturlaub stünde danach im Minus, ohne dass jemand es
 * entschieden hätte.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { mengeNachPostgres } from '../finanz/menge.js';
import { rechneTage, type Wochentag } from './tage.js';
import { ArtUngeklaertFehler } from './index.js';

export type AntragStatus =
  'eingereicht' | 'in_pruefung' | 'genehmigt' | 'abgelehnt'
  | 'zurueckgezogen' | 'storniert';

export interface AntragZeile {
  readonly id: string;
  readonly anstellungId: string;
  readonly personName: string;
  readonly art: string;
  /**
   * Dieselbe Bezeichnung in den Sprachen, die `antragsart` führt (V-062).
   *
   * Leer, solange niemand übersetzt hat — dann gilt `art`. Die WAHL trifft
   * die Oberfläche, weil dieselbe Zeile im Arbeiterportal (vier Sprachen,
   * SPEC §10) und im Genehmigungsposteingang der Verwaltung (zwei) steht,
   * und die beiden Leser nicht dieselbe Sprache sprechen.
   */
  readonly artI18n: Readonly<Record<string, string>>;
  readonly artSchluessel: string;
  readonly status: AntragStatus;
  readonly vonDatum: string | null;
  readonly bisDatum: string | null;
  readonly nachricht: string | null;
  readonly eingereichtAm: Date;
  readonly entschiedenAm: Date | null;
  readonly entscheidungKommentar: string | null;
  readonly abwesenheitId: string | null;
  /**
   * Die Felder, an denen sich ein TAUSCHANTRAG von einem Abwesenheitsantrag
   * unterscheidet — und der Grund, warum sie hier stehen.
   *
   * `entscheideAntrag` behandelt nur den Abwesenheitszweig
   * (`antragsart.erzeugt_abwesenheit`). Ein Tauschantrag wuerde auf
   * `genehmigt` gesetzt, ohne dass im Dienstplan etwas geschieht und ohne das
   * SEC-04-Qualifikationstor, das 05-API-KARTE §C.8 fuer eine
   * Tauschgenehmigung ausdruecklich verlangt („a swap approval passes the same
   * SEC-04 gate as besetzen"). Eine Oberflaeche, die das nicht unterscheiden
   * kann, zeigt einen Genehmigen-Knopf, der eine Genehmigung OHNE Wirkung
   * erzeugt.
   */
  readonly erzeugtAbwesenheit: boolean;
  readonly einsatzId: string | null;
  readonly tauschPartnerAnstellungId: string | null;
  readonly abwesenheitsartId: string | null;
  /** `null` = keine Art gewaehlt; `false` = zaehlt nicht auf das Urlaubskonto. */
  readonly zaehltAufUrlaubskonto: boolean | null;
  readonly storniertAm: Date | null;
}

export class AntragNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Antrag ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'AntragNichtGefunden';
  }
}

export class KommentarFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor() {
    super('Eine Ablehnung ohne Wort ist keine Entscheidung.');
    this.name = 'KommentarFehlt';
  }
}

export class UrlaubskontoFehlt extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(jahr: number) {
    super(
      `Für ${String(jahr)} ist kein Urlaubsanspruch hinterlegt (O-18). `
      + 'Er wird eingetragen, bevor Urlaub genehmigt wird — sonst stünde der '
      + 'Resturlaub im Minus, ohne dass jemand das entschieden hätte.',
    );
    this.name = 'UrlaubskontoFehlt';
  }
}

/**
 * Die eine Zeilenabfrage des Antrags.
 *
 * **`art_i18n` wird NICHT hier in einer Sprache ausgewählt** (V-062).
 * `antragsart.bezeichnung_i18n` liegt seit `0074` da; das Arbeiterportal
 * spricht vier Sprachen (SPEC §10) und zeigte die deutsche `bezeichnung` —
 * „Urlaubsantrag" auf einem Bildschirm, den jemand auf Arabisch eingestellt
 * hat, weil er kein Deutsch liest.
 *
 * Ausgewählt wird erst bei der Anzeige: DIESE Abfrage bedient auch den
 * Genehmigungsposteingang der Verwaltung, und der spricht eine andere Sprache
 * als die antragstellende Person. Ein `->> $1` hier hiesse eine Sprache je
 * Abfrage, also entweder zwei Abfragen oder die falsche Sprache auf einer der
 * beiden Seiten.
 *
 * (Kein Backtick in den SQL-Kommentaren darunter: die Anweisung steht in
 * einem Template-Literal, und ein Backtick darin beendet es.)
 */
const ZEILE = `
  select a.id, a.anstellung_id,
         (p.vorname || ' ' || p.nachname)          as person_name,
         art.bezeichnung                           as art,
         -- Die Uebersetzungen der Art als GANZE Karte, nicht in einer Sprache
         -- ausgewaehlt (V-062, Erklaerung darueber im Kommentar zu ZEILE).
         art.bezeichnung_i18n                      as art_i18n,
         art.schluessel                            as art_schluessel,
         a.status::text                            as status,
         to_char(a.von_datum, 'YYYY-MM-DD')        as von_datum,
         to_char(a.bis_datum, 'YYYY-MM-DD')        as bis_datum,
         a.nachricht, a.eingereicht_am, a.entschieden_am, a.entscheidung_kommentar,
         a.storniert_am,
         art.erzeugt_abwesenheit,
         a.einsatz_id, a.tausch_partner_anstellung_id, a.abwesenheitsart_id,
         aa.zaehlt_auf_urlaubskonto,
         (select ab.id from abwesenheit ab where ab.antrag_id = a.id limit 1) as abwesenheit_id
    from antrag a
    join antragsart art on art.id = a.antragsart_id
    left join abwesenheitsart aa on aa.id = a.abwesenheitsart_id
    join anstellung an on an.mandant_id = a.mandant_id and an.id = a.anstellung_id
    join person p on p.id = an.person_id`;

interface RohZeile {
  readonly id: string; readonly anstellung_id: string; readonly person_name: string;
  readonly art: string; readonly art_schluessel: string; readonly status: AntragStatus;
  readonly art_i18n: Readonly<Record<string, string>> | null;
  readonly von_datum: string | null; readonly bis_datum: string | null;
  readonly nachricht: string | null; readonly eingereicht_am: Date;
  readonly entschieden_am: Date | null; readonly entscheidung_kommentar: string | null;
  readonly abwesenheit_id: string | null; readonly erzeugt_abwesenheit: boolean;
  readonly einsatz_id: string | null;
  readonly tausch_partner_anstellung_id: string | null;
  readonly abwesenheitsart_id: string | null;
  readonly zaehlt_auf_urlaubskonto: boolean | null;
  readonly storniert_am: Date | null;
}

/**
 * Die Bezeichnung der Antragsart in DIESER Sprache — oder die deutsche
 * (V-062).
 *
 * **Warum ein Rückfall auf Deutsch und keine Lücke.** `bezeichnung_i18n` ist
 * gepflegt, nicht erzeugt: eine Art, die jemand heute anlegt, hat morgen noch
 * keine türkische Fassung. Ein leeres Feld wäre schlimmer als ein deutsches
 * Wort — der Mensch sähe nicht, worum es geht, und könnte auch niemanden
 * danach fragen.
 *
 * Eine Zeichenkette aus Leerzeichen zählt als nicht übersetzt: sie steht in
 * gepflegten Katalogen häufiger da, als man denkt.
 */
export function artInSprache(
  zeile: Pick<AntragZeile, 'art' | 'artI18n'>, sprache: string,
): string {
  const uebersetzt = zeile.artI18n[sprache];
  return uebersetzt !== undefined && uebersetzt.trim() !== '' ? uebersetzt : zeile.art;
}

function zeile(z: RohZeile): AntragZeile {
  return {
    id: z.id,
    anstellungId: z.anstellung_id,
    personName: z.person_name,
    art: z.art,
    artI18n: z.art_i18n ?? {},
    artSchluessel: z.art_schluessel,
    status: z.status,
    vonDatum: z.von_datum,
    bisDatum: z.bis_datum,
    nachricht: z.nachricht,
    eingereichtAm: z.eingereicht_am,
    entschiedenAm: z.entschieden_am,
    entscheidungKommentar: z.entscheidung_kommentar,
    abwesenheitId: z.abwesenheit_id,
    erzeugtAbwesenheit: z.erzeugt_abwesenheit,
    einsatzId: z.einsatz_id,
    tauschPartnerAnstellungId: z.tausch_partner_anstellung_id,
    abwesenheitsartId: z.abwesenheitsart_id,
    zaehltAufUrlaubskonto: z.zaehlt_auf_urlaubskonto,
    storniertAm: z.storniert_am,
  };
}

/** Der Genehmigungsposteingang — das Älteste oben (NOT-01). */
export async function listeOffeneAntraege(
  kontext: LeseKontext,
): Promise<readonly AntragZeile[]> {
  const roh = await kontext.abfrage<RohZeile>(
    `${ZEILE} where a.status in ('eingereicht','in_pruefung')
      order by a.eingereicht_am asc`,
  );
  return roh.map(zeile);
}

export async function listeAntraege(
  kontext: LeseKontext, anstellungId: string,
): Promise<readonly AntragZeile[]> {
  const roh = await kontext.abfrage<RohZeile>(
    `${ZEILE} where a.anstellung_id = $1::uuid order by a.eingereicht_am desc`,
    [anstellungId],
  );
  return roh.map(zeile);
}

export async function findeAntrag(
  kontext: LeseKontext, id: string,
): Promise<AntragZeile | null> {
  const [z] = await kontext.abfrage<RohZeile>(`${ZEILE} where a.id = $1::uuid`, [id]);
  return z === undefined ? null : zeile(z);
}

export interface AntragEingabe {
  readonly anstellungId: string;
  readonly antragsartId: string;
  readonly vonDatum?: string | null;
  readonly bisDatum?: string | null;
  readonly abwesenheitsartId?: string | null;
  readonly einsatzId?: string | null;
  readonly tauschPartnerAnstellungId?: string | null;
  readonly nachricht?: string | null;
}

/**
 * Reicht einen Antrag ein.
 *
 * Die Pflichtfelder prüft der Auslöser `antrag_pflichtfelder` (0074) — nicht,
 * weil der Dienst es nicht könnte, sondern damit auch der Weg an ihm vorbei
 * daran scheitert. Was der Dienst hinzufügt, ist die Person hinter der
 * Anmeldung: `eingereicht_von_benutzer_id` ist NOT NULL, und ein Antrag ohne
 * Absender wäre wertlos.
 */
export async function reicheAntragEin(
  kontext: SchreibKontext, eingabe: AntragEingabe,
): Promise<AntragZeile> {
  const [neu] = await kontext.schreibe<{ id: string }>(
    `insert into antrag
       (mandant_id, anstellung_id, antragsart_id, von_datum, bis_datum,
        abwesenheitsart_id, einsatz_id, tausch_partner_anstellung_id,
        nachricht, eingereicht_von_benutzer_id)
     values ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::date,
             $6::uuid, $7::uuid, $8::uuid, $9, $10::uuid)
     returning id`,
    [
      kontext.aktiverMandantId, eingabe.anstellungId, eingabe.antragsartId,
      eingabe.vonDatum ?? null, eingabe.bisDatum ?? null,
      eingabe.abwesenheitsartId ?? null, eingabe.einsatzId ?? null,
      eingabe.tauschPartnerAnstellungId ?? null,
      eingabe.nachricht ?? null, kontext.benutzerId,
    ],
  );
  const gelesen = await findeAntrag(kontext, neu!.id);
  if (gelesen === null) throw new AntragNichtGefunden(neu!.id);
  return gelesen;
}

interface EntscheidungsZeile {
  readonly id: string;
  readonly anstellung_id: string;
  readonly antragsart_id: string;
  readonly abwesenheitsart_id: string | null;
  readonly von_datum: string | null;
  readonly bis_datum: string | null;
  readonly status: AntragStatus;
  readonly erzeugt_abwesenheit: boolean;
  readonly zaehlt_auf_urlaubskonto: boolean | null;
  readonly bezahlt: boolean | null;
  readonly art_bezeichnung: string | null;
}

export interface Entscheidung {
  readonly antragId: string;
  readonly entscheidung: 'genehmigt' | 'abgelehnt';
  readonly kommentar?: string | null;
  readonly arbeitstage?: readonly Wochentag[];
}

export interface EntscheidungsErgebnis {
  readonly antragId: string;
  readonly abwesenheitId: string | null;
  /** `numeric(12,3)` als Text — `null`, wenn keine Abwesenheit entstand. */
  readonly tageAngerechnet: string | null;
}

/**
 * Entscheidet — und schreibt bei einer Genehmigung die Abwesenheit gleich mit.
 *
 * Reihenfolge mit Absicht: erst die Abwesenheit, dann der Status. Der Auslöser
 * auf dem Antrag sieht die Zeile dann schon und legt keine zweite an; liefe es
 * andersherum, entstünde die Abwesenheit zweimal — einmal ohne Tage.
 */
export async function entscheideAntrag(
  kontext: SchreibKontext, eingabe: Entscheidung,
): Promise<EntscheidungsErgebnis> {
  if (eingabe.entscheidung === 'abgelehnt'
      && (eingabe.kommentar ?? '').trim() === '') {
    throw new KommentarFehlt();
  }

  const [a] = await kontext.abfrage<EntscheidungsZeile>(
    `select a.id, a.anstellung_id, a.antragsart_id, a.abwesenheitsart_id,
            to_char(a.von_datum, 'YYYY-MM-DD') as von_datum,
            to_char(a.bis_datum, 'YYYY-MM-DD') as bis_datum,
            a.status::text as status,
            art.erzeugt_abwesenheit,
            aa.zaehlt_auf_urlaubskonto, aa.bezahlt, aa.bezeichnung as art_bezeichnung
       from antrag a
       join antragsart art on art.id = a.antragsart_id
       left join abwesenheitsart aa on aa.id = a.abwesenheitsart_id
      where a.id = $1::uuid`,
    [eingabe.antragId],
  );
  if (a === undefined) throw new AntragNichtGefunden(eingabe.antragId);

  let abwesenheitId: string | null = null;
  let tageText: string | null = null;

  if (eingabe.entscheidung === 'genehmigt'
      && a.erzeugt_abwesenheit
      && a.abwesenheitsart_id !== null
      && a.von_datum !== null && a.bis_datum !== null) {
    if (a.bezahlt === null) {
      throw new ArtUngeklaertFehler(a.art_bezeichnung ?? 'unbekannt');
    }

    const tage = rechneTage({
      von: a.von_datum,
      bis: a.bis_datum,
      ...(eingabe.arbeitstage === undefined ? {} : { arbeitstage: eingabe.arbeitstage }),
    });
    tageText = mengeNachPostgres(tage);

    if (a.zaehlt_auf_urlaubskonto === true) {
      const jahr = Number(a.von_datum.slice(0, 4));
      const [konto] = await kontext.abfrage<{ id: string }>(
        `select id from urlaubskonto
          where anstellung_id = $1::uuid and jahr = $2 and abgeschlossen_am is null`,
        [a.anstellung_id, jahr],
      );
      if (konto === undefined) throw new UrlaubskontoFehlt(jahr);
    }

    const [neu] = await kontext.schreibe<{ id: string }>(
      `insert into abwesenheit
         (mandant_id, anstellung_id, abwesenheitsart_id, von, bis,
          tage_angerechnet, status, antrag_id, genehmigt_von, genehmigt_am,
          erstellt_von)
       values ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::date,
               $6::numeric, 'genehmigt', $7::uuid, $8::uuid, now(), $8::uuid)
       returning id`,
      [
        kontext.aktiverMandantId, a.anstellung_id, a.abwesenheitsart_id,
        a.von_datum, a.bis_datum, tageText, a.id, kontext.benutzerId,
      ],
    );
    abwesenheitId = neu!.id;
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update antrag
        set status = $2::antrag_status, entschieden_von = $3::uuid,
            entscheidung_kommentar = $4, geaendert_am = now()
      where id = $1::uuid and status in ('eingereicht','in_pruefung')
      returning id`,
    [
      eingabe.antragId, eingabe.entscheidung, kontext.benutzerId,
      (eingabe.kommentar ?? '').trim() === '' ? null : (eingabe.kommentar ?? '').trim(),
    ],
  );
  if (zeilen.length === 0) throw new AntragNichtGefunden(eingabe.antragId);

  return { antragId: eingabe.antragId, abwesenheitId, tageAngerechnet: tageText };
}

/**
 * Zieht einen eigenen Antrag zurück — solange niemand entschieden hat.
 *
 * Danach ist es keine Rücknahme mehr, sondern die stille Entwertung einer
 * getroffenen Entscheidung. Wer eine genehmigte Abwesenheit loswerden will,
 * storniert sie — mit Grund und Spur.
 */
export async function zieheAntragZurueck(
  kontext: SchreibKontext, antragId: string,
): Promise<void> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update antrag
        set status = 'zurueckgezogen', geaendert_am = now()
      where id = $1::uuid and status in ('eingereicht','in_pruefung')
      returning id`,
    [antragId],
  );
  if (zeilen.length === 0) throw new AntragNichtGefunden(antragId);
}
