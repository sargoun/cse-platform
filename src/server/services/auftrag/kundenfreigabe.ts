/**
 * Die Kundenfreigabe am Auftrag (PRO-05) — die Erlaubnis, das Projekt
 * oeffentlich zu nennen.
 *
 * **Sie ist ein BELEG, keine Veroeffentlichung.** PRO-05 trennt zwei
 * Handlungen, und die Trennung ist der ganze Punkt: hier wird festgehalten,
 * dass der Kunde schriftlich zugestimmt hat; die oeffentliche `referenz`-Zeile
 * legt danach ein Mensch unter `/website/referenzen/neu` an (V-154 — der Weg
 * fehlte bis dahin), und zwar erst, wenn der Auftrag ABGESCHLOSSEN ist
 * (`referenzfaehig`, V-161). Er kopiert dabei nur, was freigegeben ist, und
 * die Referenz haelt fest, aus welchem Auftrag sie stammt (0410). Eine
 * automatische Uebernahme waere eine Veroeffentlichung, die niemand
 * entschieden hat (Invariante 7).
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
  /**
   * Der Zustand des Auftrags (`auftrag_status`) — seit V-161 Teil der Frage,
   * ob aus ihm eine Referenz entstehen darf (`referenzfaehig`, PRO-05: ein
   * ABGESCHLOSSENER Auftrag).
   */
  readonly status: string;
  readonly freigegeben: boolean;
  readonly freigabe_am: string | null;
  /**
   * Derselbe Zeitpunkt als Berliner KALENDERTAG `YYYY-MM-DD` (V-154) — die
   * Form, die ein `<input type="date">` als Vorgabe braucht.
   *
   * Die Referenz, die aus diesem Auftrag angelegt wird, schlägt ihn als Datum
   * ihrer eigenen Kundenfreigabe vor. Aus `freigabe_am` (`DD.MM.YYYY HH24:MI`)
   * zurückgeschnitten wäre er eine zweite Umrechnung derselben Uhrzeit — und
   * die zweite ist die, die um Mitternacht einen Tag daneben liegt.
   */
  readonly freigabe_tag: string | null;
  readonly freigabe_text: string | null;
  readonly freigabe_dokument_id: string | null;
  readonly freigabe_dokument: string | null;
  readonly ansprechpartner_id: string | null;
  readonly ansprechpartner: string | null;
  readonly widerrufen_am: string | null;
  /**
   * Eine Referenz mit DIESEM Kundennamen — kein Fremdschluessel, ein Vergleich.
   *
   * `referenz` traegt `kunde_name` als freien Text: die oeffentliche Zeile
   * ist eine Neuschoepfung, die nur uebernimmt, was freigegeben ist, und sie
   * nennt einen Kunden manchmal anders, als die Kundenakte ihn fuehrt. Der
   * Vergleich hier ist deshalb ein HINWEIS („es gibt schon eine Referenz mit
   * diesem Namen"), nie eine Zuordnung — und die Seite formuliert ihn so. Er
   * findet auch den Altbestand, der vor V-161 ohne Herkunft entstand.
   */
  readonly referenz_gleichnamig: string;
  /**
   * Die Referenzen, die aus DIESEM Auftrag angelegt wurden (V-161,
   * `referenz.auftrag_id`, 0410). Die Herkunft ist ein Beleg, keine Kopplung:
   * sie kaskadiert nicht, und ein Widerruf entfernt keine Zeile (O-735).
   */
  readonly referenzen_aus_auftrag: string;
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
 * Gilt die Freigabe HEUTE — erteilt UND nicht widerrufen?
 *
 * `freigegeben_vom_kunden` allein sagt das nicht: nach einem Widerruf bleibt
 * es auf `true` stehen (der CHECK verlangt es, solange die drei
 * Pflichtangaben da sind). Die Seite am Auftrag rechnet das seit je so; mit
 * der Referenzanlage aus dem Auftrag (V-154) fragen es zwei weitere Seiten,
 * und eine davon hätte sonst eine widerrufene Freigabe als Vorschlag in eine
 * neue Referenz getragen.
 */
export function freigabeGilt(
  stand: Pick<Freigabestand, 'freigegeben' | 'widerrufen_am'>,
): boolean {
  return stand.freigegeben && stand.widerrufen_am === null;
}

/**
 * Die Zustände, aus denen eine Referenz entstehen darf — SPEC PRO-05: „a
 * reference is a COMPLETED `auftrag` with customer release on file, not a
 * marketing entry typed by hand" (V-161, D-654).
 *
 * **Eine Stelle, damit die Antwort austauschbar bleibt.** In der Reinigung und
 * im Objektschutz laufen Aufträge als Dauerauftrag oder Rahmenvertrag über
 * Jahre; „wir reinigen seit 2019 die Zentrale der X AG" ist dort DIE übliche
 * Referenz, und nach dieser Regel entsteht sie erst mit dem Abschluss. Ob ein
 * laufender Auftrag mit geltender Freigabe genügt, entscheidet der
 * Auftraggeber — bis dahin gilt die SPEC wörtlich.
 */
// TODO(client, O-914): Darf auch ein LAUFENDER Auftrag (aktiv oder pausiert — etwa ein Dauerauftrag der Reinigung oder des Objektschutzes) mit geltender Kundenfreigabe zur Referenz werden, oder nur ein abgeschlossener (SPEC PRO-05)?
export const REFERENZFAEHIGE_ZUSTAENDE: readonly string[] = ['abgeschlossen'];

/**
 * Warum aus einem Auftrag (noch) keine Referenz entstehen darf — oder `null`.
 *
 * `storniert` steht für sich: ein stornierter Vertrag ist kein „noch nicht",
 * sondern ein „nie" — er kommt nicht zustande (0389), und aus ihm entsteht
 * auch nach einer Antwort auf O-914 keine Referenz.
 */
export type ReferenzHindernis = 'ohne_freigabe' | 'storniert' | 'nicht_abgeschlossen';

export function referenzHindernis(
  stand: Pick<Freigabestand, 'freigegeben' | 'widerrufen_am' | 'status'>,
): ReferenzHindernis | null {
  if (!freigabeGilt(stand)) return 'ohne_freigabe';
  if (stand.status === 'storniert') return 'storniert';
  if (!REFERENZFAEHIGE_ZUSTAENDE.includes(stand.status)) return 'nicht_abgeschlossen';
  return null;
}

/** Darf aus diesem Auftrag eine Referenz entstehen (PRO-05, V-161)? */
export function referenzfaehig(
  stand: Pick<Freigabestand, 'freigegeben' | 'widerrufen_am' | 'status'>,
): boolean {
  return referenzHindernis(stand) === null;
}

/** Ein Auftrag mit Kundenfreigabe — die Auswahl unter `/website/referenzen/neu`. */
export interface AuftragMitFreigabe {
  readonly auftrag_id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly kunde: string;
  readonly status: string;
  readonly freigegeben: boolean;
  /** `DD.MM.YYYY HH24:MI` in Berlin, wie in `Freigabestand` — oder `null`. */
  readonly widerrufen_am: string | null;
  /** Der Berliner Kalendertag des Abschlusses, `DD.MM.YYYY` — oder `null`. */
  readonly abgeschlossen_am: string | null;
  /** Wie viele Referenzen schon aus ihm entstanden sind (0410). */
  readonly referenzen: number;
}

/**
 * Die Aufträge dieser Gesellschaft, deren Kunde der Veröffentlichung
 * zugestimmt hat und nicht widerrufen hat (V-161).
 *
 * Der Abschluss wird hier NICHT gefiltert: die Seite trennt mit
 * `referenzHindernis` in „bereit" und „läuft noch" — dieselbe Regel wie der
 * Dienst, der beim Anlegen prüft, und nicht eine zweite in SQL, die beim
 * ersten geänderten Zustand auseinanderliefe. Ohne `auftrag.lesen` gibt die
 * Policy nichts heraus; die Seite fragt das Recht deshalb vorher und sagt es.
 */
export async function listeAuftraegeMitFreigabe(
  db: Abfrage,
): Promise<readonly AuftragMitFreigabe[]> {
  return db.abfrage<AuftragMitFreigabe>(
    `select a.id as auftrag_id, a.auftragsnummer, a.bezeichnung, k.name as kunde,
            a.status::text as status, a.freigegeben_vom_kunden as freigegeben,
            to_char(a.freigabe_widerrufen_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as widerrufen_am,
            to_char(a.abgeschlossen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY')
              as abgeschlossen_am,
            (select count(*) from referenz r
              where r.auftrag_id = a.id and r.geloescht_am is null)::int as referenzen
       from auftrag a
       join kunde k on k.id = a.kunde_id
      where a.mandant_id = app.aktiver_mandant()
        and a.freigegeben_vom_kunden and a.freigabe_widerrufen_am is null
      order by a.abgeschlossen_am desc nulls last, a.auftragsnummer`);
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
            a.status::text as status,
            a.freigegeben_vom_kunden as freigegeben,
            to_char(a.freigabe_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as freigabe_am,
            to_char(a.freigabe_am at time zone 'Europe/Berlin', 'YYYY-MM-DD')
              as freigabe_tag,
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
            (select count(*) from referenz r
              where r.geloescht_am is null and r.auftrag_id = a.id)::text
              as referenzen_aus_auftrag,
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
    widerrufen_am: Date | null;
  }>(
    `select auftragsnummer, kunde_id, freigegeben_vom_kunden as freigegeben,
            freigabe_widerrufen_am as widerrufen_am
       from auftrag where id = $1 for update`, [auftragId]);
  if (auftrag === undefined) {
    throw new KundenfreigabeFehler('Auftrag nicht gefunden', 'nicht_gefunden');
  }
  /**
   * Der Waechter fragt BEIDES — und das ist der Unterschied zwischen einer
   * geltenden und einer widerrufenen Freigabe.
   *
   * `freigegeben_vom_kunden` bleibt nach einem Widerruf auf `true` stehen (der
   * CHECK `auftrag_referenzfreigabe_vollstaendig` verlangt es, solange die
   * drei Pflichtangaben da sind). Ein Waechter, der nur dieses Kennzeichen
   * liest, wies deshalb auch die ERNEUTE Erfassung ab — mit dem Satz „liegt
   * bereits vor", was fuer eine widerrufene Freigabe schlicht falsch ist. Und
   * weil niemand mehr hierher kam, war `freigabe_widerrufen_am = null` unten
   * toter Code. Der Kunde darf seine Meinung ein zweites Mal aendern; der
   * Widerruf ist kein Urteil, sondern ein Stand.
   */
  if (auftrag.freigegeben && auftrag.widerrufen_am === null) {
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
  }>(
    `select auftragsnummer, freigegeben_vom_kunden as freigegeben,
            freigabe_widerrufen_am as widerrufen_am
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
            freigabe_widerrufen_am = now()
      where id = $1`,
    [auftragId]);
  /**
   * Der Grund geht ins PRUEFPROTOKOLL, nicht in den Beleg.
   *
   * `freigabe_text` traegt den festgehaltenen WORTLAUT der Kundenerklaerung —
   * das ist die Zeile, auf die sich PRO-05 im Streitfall beruft, und die Seite
   * zeigt sie unter der Ueberschrift „Wortlaut". Ein Beleg, an den man etwas
   * anhaengt, ist kein unveraenderter Beleg mehr: danach stuenden Kundensatz
   * und interne Notiz in einer Spalte und niemand koennte sie noch trennen.
   *
   * `app.protokolliere` haelt denselben Grund MIT Akteur, Zeit, Sitzung und IP
   * fest — mehr, als das Anhaengen je konnte, und an der Stelle, an der man
   * im Nachhinein danach sucht.
   */
  await db.abfrage(
    `select app.protokolliere('auftrag.kundenfreigabe_widerrufen', 'auftrag',
                              $1, null, $2::jsonb, app.aktiver_mandant())`,
    [auftragId, JSON.stringify({ grund: grund.trim() })]);
  return { auftragsnummer: auftrag.auftragsnummer };
}
