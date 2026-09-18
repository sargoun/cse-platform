/**
 * Die Kundenfreigabe am Auftrag (PRO-05) — die Erlaubnis, das Projekt
 * oeffentlich zu nennen.
 *
 * **Sie ist ein BELEG, keine Veroeffentlichung.** PRO-05 trennt zwei
 * Handlungen, und die Trennung ist der ganze Punkt: hier wird festgehalten,
 * dass der Kunde schriftlich zugestimmt hat; die oeffentliche `referenz`-Zeile
 * legt danach ein Mensch unter `/website/referenzen` an und kopiert dabei nur,
 * was freigegeben ist. Eine automatische Uebernahme waere eine
 * Veroeffentlichung, die niemand entschieden hat (Invariante 7).
 *
 * **Drei Angaben sind PFLICHT, sobald die Freigabe gilt** — nicht aus
 * Formstrenge, sondern weil der CHECK `auftrag_referenzfreigabe_vollstaendig`
 * es verlangt: `freigabe_am`, `freigabe_durch_ansprechpartner_id` und
 * `freigabe_dokument_id`. Das hinterlegte Schreiben ist also kein Beiwerk;
 * ohne es scheitert das UPDATE. Und `freigabe_am` gibt niemand ein: der
 * Ausloeser `kern.auftrag_freigabe_stempeln` setzt es aus der Serveruhr.
 *
 * **Was die Datenbank NICHT faengt.** `freigabe_dokument_id` hat keinen
 * Fremdschluessel auf `dokument` — nur der Ansprechpartner ist ueber
 * `auftrag_freigabe_ansprechpartner_fk` an (mandant_id, kunde_id) gebunden.
 * Ob das Schreiben zu DIESEM Kunden gehoert, muss deshalb dieser Dienst
 * pruefen. Tut er es nicht, laesst sich die Erlaubnis eines Kunden mit dem
 * Schreiben eines anderen belegen, und nichts daran sieht falsch aus.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class KundenfreigabeFehler extends Error {
  constructor(nachricht: string, readonly grund:
    | 'nicht_gefunden' | 'unvollstaendig' | 'fremder_ansprechpartner'
    | 'fremdes_dokument' | 'schon_freigegeben' | 'nicht_freigegeben'
    | 'schon_widerrufen' | 'kein_recht') {
    super(nachricht);
    this.name = 'KundenfreigabeFehler';
  }
}

export interface Freigabestand {
  readonly auftrag_id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly kunde_id: string;
  readonly kunde: string;
  readonly objekt: string | null;
  readonly freigegeben: boolean;
  readonly freigabe_am: string | null;
  readonly freigabe_text: string | null;
  readonly freigabe_dokument_id: string | null;
  readonly freigabe_dokument: string | null;
  readonly ansprechpartner_id: string | null;
  readonly ansprechpartner: string | null;
  readonly widerrufen_am: string | null;
  /**
   * Eine Referenz mit DIESEM Kundennamen — kein Fremdschluessel, ein Vergleich.
   *
   * `referenz` traegt `kunde_name` als freien Text und KEIN `auftrag_id`.
   * Das ist nicht vergessen, sondern PRO-05: die oeffentliche Zeile ist eine
   * Neuschoepfung, die nur uebernimmt, was freigegeben ist, und sie nennt
   * einen Kunden manchmal anders, als die Kundenakte ihn fuehrt. Der
   * Vergleich hier ist deshalb ein HINWEIS („es gibt schon eine Referenz mit
   * diesem Namen"), nie eine Zuordnung — und die Seite formuliert ihn so.
   */
  readonly referenz_gleichnamig: string;
  /**
   * Zwei Rechte, die das Tor dieser Seite NICHT verlangt.
   *
   * `referenz` hat eine eigene Policy mit `referenz.lesen`, `dokument` eine
   * mit `dokument.lesen`. Ohne diese Merker haette die Seite aus null Zeilen
   * „es gibt keine Referenz" und „es gibt kein Schreiben" gemacht — eine
   * Aussage ueber die Daten statt ueber die Berechtigung (AUT-05, D-581).
   */
  readonly darf_referenz_lesen: boolean;
  readonly darf_dokument_lesen: boolean;
}

/**
 * Der Name eines Ansprechpartners — aus den Spalten, die es gibt.
 *
 * `ansprechpartner` traegt `anrede`, `titel`, `vorname`, `nachname` und
 * KEINE Spalte `name`. Ein `select ap.name` waere hier kein Tippfehler,
 * sondern ein 42703 auf einer Seite, die sonst laeuft.
 */
export const ANSPRECHPARTNER_NAME =
  `nullif(btrim(concat_ws(' ', ap.titel, ap.vorname, ap.nachname)), '')`;

export async function ladeFreigabestand(
  db: Abfrage, auftragId: string,
): Promise<Freigabestand | null> {
  const [z] = await db.abfrage<Freigabestand>(
    `select a.id as auftrag_id, a.auftragsnummer, a.bezeichnung,
            a.kunde_id, k.name as kunde, o.bezeichnung as objekt,
            a.freigegeben_vom_kunden as freigegeben,
            to_char(a.freigabe_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as freigabe_am,
            a.freigabe_text, a.freigabe_dokument_id,
            d.titel as freigabe_dokument,
            a.freigabe_durch_ansprechpartner_id as ansprechpartner_id,
            ${ANSPRECHPARTNER_NAME} as ansprechpartner,
            to_char(a.freigabe_widerrufen_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as widerrufen_am,
            (select count(*) from referenz r
              where r.geloescht_am is null
                and lower(btrim(r.kunde_name)) = lower(btrim(k.name)))::text
              as referenz_gleichnamig,
            (select app.hat_recht('referenz.lesen', app.aktiver_mandant()))
              as darf_referenz_lesen,
            (select app.hat_recht('dokument.lesen', app.aktiver_mandant()))
              as darf_dokument_lesen
       from auftrag a
       join kunde k on k.id = a.kunde_id
       left join objekt o on o.id = a.objekt_id
       left join ansprechpartner ap on ap.id = a.freigabe_durch_ansprechpartner_id
       left join dokument d on d.id = a.freigabe_dokument_id
      where a.id = $1`, [auftragId]);
  return z ?? null;
}

/** Die Ansprechpartner DIESES Kunden — die Auswahl des Formulars. */
export async function listeAnsprechpartner(
  db: Abfrage, kundeId: string,
): Promise<readonly { readonly id: string; readonly name: string | null;
                      readonly rolle: string | null }[]> {
  return db.abfrage(
    `select ap.id, ${ANSPRECHPARTNER_NAME} as name, ap.position as rolle
       from ansprechpartner ap
      where ap.kunde_id = $1 and ap.archiviert_am is null
        /**
         * Kein Ausgeschiedener und kein Anonymisierter.
         *
         * Wer die Firma verlassen hat, erklaert keine Erlaubnis mehr, und
         * eine anonymisierte Zeile traegt keinen Namen, der als Beleg
         * taugte — ihn anzubieten waere eine Auswahl, die im Streitfall
         * leer ist.
         */
        and ap.ausgeschieden_am is null and ap.anonymisiert_am is null
      order by ap.nachname, ap.vorname`, [kundeId]);
}

/**
 * Die Schreiben DIESES Kunden — die Auswahl fuer `freigabe_dokument_id`.
 *
 * Nach `kunde_id` gefiltert und nicht ueber alle Dokumente: der CHECK
 * verlangt ein Dokument, dieser Dienst verlangt das RICHTIGE. Eine
 * Auswahlliste, die fremde Schreiben anbietet, laedt zum Fehler ein, den
 * `pruefeDokument` unten abweist — und ein Formular, das anbietet, was es
 * hinterher zurueckweist, ist eine Falle.
 */
export async function listeKundendokumente(
  db: Abfrage, kundeId: string,
): Promise<readonly { readonly id: string; readonly titel: string;
                      readonly kategorie: string; readonly entstanden: string }[]> {
  return db.abfrage(
    `select id, titel, kategorie::text as kategorie,
            to_char(entstanden_am, 'DD.MM.YYYY') as entstanden
       from dokument
      where kunde_id = $1 and geloescht_am is null
      order by entstanden_am desc, titel`, [kundeId]);
}

export interface FreigabeEingabe {
  readonly ansprechpartnerId: string;
  readonly dokumentId: string;
  readonly text: string;
}

export async function erfasseKundenfreigabe(
  db: Abfrage, auftragId: string, eingabe: FreigabeEingabe,
): Promise<{ readonly auftragsnummer: string }> {
  const [auftrag] = await db.abfrage<{
    auftragsnummer: string; kunde_id: string; freigegeben: boolean;
  }>(
    `select auftragsnummer, kunde_id, freigegeben_vom_kunden as freigegeben
       from auftrag where id = $1 for update`, [auftragId]);
  if (auftrag === undefined) {
    throw new KundenfreigabeFehler('Auftrag nicht gefunden', 'nicht_gefunden');
  }
  if (auftrag.freigegeben) {
    throw new KundenfreigabeFehler(
      `Für ${auftrag.auftragsnummer} liegt die Freigabe bereits vor`, 'schon_freigegeben');
  }
  if (eingabe.ansprechpartnerId.trim() === '' || eingabe.dokumentId.trim() === ''
      || eingabe.text.trim() === '') {
    throw new KundenfreigabeFehler(
      'Ansprechpartner, hinterlegtes Schreiben und Wortlaut sind Pflicht — der CHECK '
      + 'auftrag_referenzfreigabe_vollstaendig verlangt alle drei',
      'unvollstaendig');
  }

  /**
   * Der Ansprechpartner: den Fremdschluessel gibt es, und er wuerde greifen.
   * Hier steht er trotzdem, weil `auftrag_freigabe_ansprechpartner_fk` als
   * `23503` meldet und dieser Satz erklaert, WAS nicht passt.
   */
  const [ap] = await db.abfrage<{ id: string }>(
    `select id from ansprechpartner where id = $1 and kunde_id = $2`,
    [eingabe.ansprechpartnerId, auftrag.kunde_id]);
  if (ap === undefined) {
    throw new KundenfreigabeFehler(
      'Dieser Ansprechpartner gehört nicht zum Kunden dieses Auftrags',
      'fremder_ansprechpartner');
  }

  /**
   * Und das Schreiben — die Pruefung, die die DATENBANK NICHT HAT.
   *
   * `freigabe_dokument_id` traegt keinen Fremdschluessel. Ohne diese Zeile
   * liesse sich die Erlaubnis von Kunde A mit dem Schreiben von Kunde B
   * belegen, und im Streit stuende ein Verweis auf ein Dokument, das nichts
   * mit diesem Kunden zu tun hat.
   */
  const [dok] = await db.abfrage<{ id: string }>(
    `select id from dokument
      where id = $1 and kunde_id = $2 and geloescht_am is null`,
    [eingabe.dokumentId, auftrag.kunde_id]);
  if (dok === undefined) {
    throw new KundenfreigabeFehler(
      'Das hinterlegte Schreiben gehört nicht zu diesem Kunden — oder es ist Ihnen '
      + 'nicht sichtbar', 'fremdes_dokument');
  }

  await db.abfrage(
    `update auftrag
        set freigegeben_vom_kunden = true,
            /**
             * freigabe_am fehlt hier mit Absicht:
             * kern.auftrag_freigabe_stempeln setzt es aus der Serveruhr,
             * sobald das Kennzeichen von false auf true geht (Invariante 5).
             * Ein Datum aus dem Formular waere das, was jemand getippt hat.
             */
            freigabe_durch_ansprechpartner_id = $2,
            freigabe_dokument_id = $3,
            freigabe_text = $4,
            /** Eine neue Freigabe hebt einen alten Widerruf auf. */
            freigabe_widerrufen_am = null
      where id = $1`,
    [auftragId, eingabe.ansprechpartnerId, eingabe.dokumentId, eingabe.text.trim()]);
  return { auftragsnummer: auftrag.auftragsnummer };
}

/**
 * Der Widerruf.
 *
 * `freigegeben_vom_kunden` bleibt `true` und die drei Pflichtangaben bleiben
 * stehen — das muss so sein: der CHECK verlangt sie, solange das Kennzeichen
 * gilt, und der Beleg, DASS einmal freigegeben wurde, ist im Streit genauso
 * wichtig wie der Widerruf. `freigabe_widerrufen_am` ist deshalb das Feld,
 * das zaehlt, und `auftrag_referenz_idx` liest es genau so: der Index deckt
 * `freigegeben_vom_kunden AND freigabe_widerrufen_am IS NULL`.
 *
 * Was ein Widerruf fuer eine BEREITS veroeffentlichte Referenz bedeutet, ist
 * offen (O-735) — diese Funktion entfernt deshalb keine `referenz`-Zeile.
 */
export async function widerrufeKundenfreigabe(
  db: Abfrage, auftragId: string, grund: string,
): Promise<{ readonly auftragsnummer: string }> {
  const [auftrag] = await db.abfrage<{
    auftragsnummer: string; freigegeben: boolean; widerrufen_am: Date | null;
    freigabe_text: string | null;
  }>(
    `select auftragsnummer, freigegeben_vom_kunden as freigegeben,
            freigabe_widerrufen_am as widerrufen_am, freigabe_text
       from auftrag where id = $1 for update`, [auftragId]);
  if (auftrag === undefined) {
    throw new KundenfreigabeFehler('Auftrag nicht gefunden', 'nicht_gefunden');
  }
  if (!auftrag.freigegeben) {
    throw new KundenfreigabeFehler(
      'Zu diesem Auftrag liegt keine Freigabe vor, die zu widerrufen wäre',
      'nicht_freigegeben');
  }
  if (auftrag.widerrufen_am !== null) {
    throw new KundenfreigabeFehler(
      'Diese Freigabe ist schon widerrufen', 'schon_widerrufen');
  }
  if (grund.trim() === '') {
    throw new KundenfreigabeFehler(
      'Ein Widerruf nennt seinen Grund — sonst steht später nur da, dass er geschah',
      'unvollstaendig');
  }
  await db.abfrage(
    `update auftrag
        set /*
             * now() steht hier UND im Ausloeser; der Ausloeser gewinnt
             * (kern.auftrag_freigabe_stempeln ueberschreibt es mit der
             * Serverzeit). Der Wert hier ist nur das Signal "von null auf
             * gesetzt", das der Ausloeser braucht.
             */
            freigabe_widerrufen_am = now(),
            freigabe_text = coalesce(freigabe_text, '')
                            || E'\n\nWiderrufen: ' || $2
      where id = $1`,
    [auftragId, grund.trim()]);
  return { auftragsnummer: auftrag.auftragsnummer };
}
