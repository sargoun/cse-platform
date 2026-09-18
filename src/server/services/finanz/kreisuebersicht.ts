import 'server-only';

/**
 * Nummernkreise lesen: die Kreise selbst und die Köpfe ihrer Hashketten
 * (`05-FINANZEN.md` §3.3, §5.6, §5.7; TEN-02, FIN-03, FIN-06, FIN-16, LEG-01).
 *
 * **Warum eine eigene Datei und nicht `nummernkreis.ts`.** Dort geht es um das
 * ZIEHEN einer Nummer, und die Schnittstelle dafür ist `unsafe` auf einer
 * `postgres.js`-Transaktion, weil die Sperre (`SELECT … FOR UPDATE`) am
 * Treiber hängt. Dieser Dienst liest, mit derselben `abfrage`-Form wie jede
 * andere Leseschicht, und er trägt kein Schreibrecht.
 *
 * **Der Zähler ist hier ANSICHT und nirgends Eingabefeld.** `naechste_nummer`
 * wird ausschliesslich unter Zeilensperre in der Festschreibungstransaktion
 * fortgezählt (§5.6). Ein Formular darauf wäre der kürzeste Weg zu zwei
 * Rechnungen mit derselben Nummer — und §14 UStG duldet weder Lücke noch
 * Doppelung.
 *
 * **Was der Dienst NICHT anbietet: einen Jahreswechsel.** Der Vorgang ist
 * beschrieben (Vorgänger schliessen, `letzter_hash` als `genesis_hash` des
 * Nachfolgers eintragen, Vorgänger verweisen) — aber wer ihn ausführt, ist
 * offen (O-352), und eine Funktion dafür wäre eine Rolle, die sich diese
 * Datei erfindet.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type KreisTyp =
  | 'ausgangsrechnung' | 'gutschrift' | 'eingangsrechnung_beleg' | 'mahnung'
  | 'angebot' | 'auftrag' | 'leistungsnachweis' | 'wachbuch' | 'kassenbuch';

export type Zuruecksetzung = 'nie' | 'jaehrlich';

/** Deutsche Beschriftung je Kreistyp. */
export const TYP_TEXT: Readonly<Record<KreisTyp, string>> = {
  ausgangsrechnung: 'Ausgangsrechnungen',
  gutschrift: 'Gutschriften',
  eingangsrechnung_beleg: 'Eingangsrechnungen (interne Belegnummer)',
  mahnung: 'Mahnungen',
  angebot: 'Angebote',
  auftrag: 'Aufträge',
  leistungsnachweis: 'Leistungsnachweise',
  wachbuch: 'Wachbuch',
  kassenbuch: 'Kassenbuch',
};

/**
 * Die Kreise, deren Nummer die ANWENDUNG nicht zieht (§5.6).
 *
 * Der Rechnungskreis läuft über `fin.rechnung_nummer_ziehen`
 * (SECURITY DEFINER), weil `cse_app` unter FORCE RLS keine Zeile trifft. Die
 * Übersicht sagt das, weil es erklärt, warum hier kein Knopf steht — und
 * weil der Platzhalterschutz für diese Kreise deshalb in der DB-Funktion
 * sitzt und nicht im Dienst.
 */
export const DEFINER_KREISE: readonly KreisTyp[] = ['ausgangsrechnung', 'gutschrift'];

export interface Kreis {
  readonly id: string;
  readonly kreisTyp: KreisTyp;
  readonly typText: string;
  readonly bezeichnung: string;
  /** `0` heisst: fortlaufend über Jahre hinweg, nicht „Jahr unbekannt". */
  readonly jahr: number;
  readonly kontextId: string | null;
  readonly formatMaske: string;
  readonly zuruecksetzung: Zuruecksetzung | null;
  readonly lueckenlos: boolean;
  readonly naechsteNummer: number;
  /** Wie die nächste Nummer aussähe — ohne sie zu ziehen. */
  readonly naechsteNummerFormatiert: string;
  readonly geoeffnetAm: string;
  readonly geschlossenAm: string | null;
  readonly istPlatzhalter: boolean;
  readonly genesisHash: string | null;
  readonly letzterHash: string | null;
  readonly vorgaengerId: string | null;
  readonly vorgaengerBezeichnung: string | null;
  /** Wie viele Kettenglieder hängen an diesem Kreis? */
  readonly kettenlaenge: number;
  /** Zieht die Anwendung diese Nummer selbst, oder eine Definer-Funktion? */
  readonly zugDurchDefiner: boolean;
  /**
   * Kann in diesem Kreis festgeschrieben werden?
   *
   * `false`, solange `ist_platzhalter` steht (Maske und Rücksetzung sind
   * unbestätigt — O-134) oder der Kreis geschlossen ist. Der Grund steht
   * daneben, weil ein fehlender Knopf ohne Grund wie ein Fehler aussieht.
   */
  readonly vergabeMoeglich: boolean;
  readonly vergabeGrund: string | null;
}

/**
 * Die Maske auflösen, ohne zu ziehen.
 *
 * Dieselbe Auflösung wie `formatiereNummer` in `nummernkreis.ts` — bewusst
 * ohne Wurf: dort ist eine unbrauchbare Maske ein Abbruch der Festschreibung,
 * hier ist sie das, was die Übersicht ANZEIGEN soll. Eine Seite, die an einer
 * kaputten Maske abbricht, verschweigt genau den Kreis, um dessen Maske es
 * geht.
 */
export function vorschau(maske: string, nummer: number, jahr: number): string {
  return maske.replace(/\{(jahr|nr)(?::(\d+))?\}/gu, (_treffer, feld: string, breite?: string) => {
    if (feld === 'jahr') {
      return jahr === 0 ? '{jahr — dieser Kreis führt keines}' : String(jahr);
    }
    const stellen = breite === undefined ? 0 : Number(breite);
    return String(nummer).padStart(stellen, '0');
  });
}

interface RohKreis {
  readonly id: string;
  readonly kreis_typ: KreisTyp;
  readonly bezeichnung: string;
  readonly jahr: number;
  readonly kontext_id: string | null;
  readonly format_maske: string;
  readonly zuruecksetzung: Zuruecksetzung | null;
  readonly lueckenlos: boolean;
  readonly naechste_nummer: string;
  readonly geoeffnet_am: string;
  readonly geschlossen_am: string | null;
  readonly ist_platzhalter: boolean;
  readonly genesis_hash: string | null;
  readonly letzter_hash: string | null;
  readonly vorgaenger_nummernkreis_id: string | null;
  readonly vorgaenger_bezeichnung: string | null;
  readonly kettenlaenge: string;
}

/**
 * Alle Nummernkreise des aktiven Mandanten.
 *
 * `app.aktiver_mandant()` steht NICHT in der Abfrage: die Policy `t_mandant`
 * auf `nummernkreis` bindet sie schon, und ein zweites Mal geschrieben wäre
 * es die Stelle, an der später eine Gruppensitzung leer ausgeht, weil dort
 * `aktiver_mandant()` per Konstruktion NULL ist (K-20).
 */
export async function kreise(db: Abfrage): Promise<readonly Kreis[]> {
  const zeilen = await db.abfrage<RohKreis>(
    `select n.id::text as id, n.kreis_typ::text as kreis_typ, n.bezeichnung,
            n.jahr, n.kontext_id::text as kontext_id, n.format_maske,
            n.zuruecksetzung::text as zuruecksetzung, n.lueckenlos,
            n.naechste_nummer::text,
            to_char(n.geoeffnet_am, 'DD.MM.YYYY') as geoeffnet_am,
            to_char(n.geschlossen_am, 'DD.MM.YYYY') as geschlossen_am,
            n.ist_platzhalter, n.genesis_hash, n.letzter_hash,
            n.vorgaenger_nummernkreis_id::text as vorgaenger_nummernkreis_id,
            v.bezeichnung as vorgaenger_bezeichnung,
            (select count(*) from rechnung_hash h
              where h.mandant_id = n.mandant_id
                and h.nummernkreis_id = n.id)::text as kettenlaenge
       from nummernkreis n
       left join nummernkreis v
         on v.mandant_id = n.mandant_id and v.id = n.vorgaenger_nummernkreis_id
      order by n.kreis_typ, n.jahr desc, n.geoeffnet_am desc`);

  return zeilen.map((z) => {
    const nummer = Number(z.naechste_nummer);
    const geschlossen = z.geschlossen_am !== null;
    const grund = z.ist_platzhalter
      ? 'Maske und Rücksetzung sind unbestätigt (O-134) — eine Nummer daraus '
        + 'wäre eine erfundene. In diesem Kreis wird nicht festgeschrieben.'
      : geschlossen
        ? `Der Kreis ist seit ${String(z.geschlossen_am)} geschlossen und vergibt `
          + 'keine Nummern mehr. Ein Nachfolgekreis muss ihn fortsetzen.'
        : null;
    return {
      id: z.id,
      kreisTyp: z.kreis_typ,
      typText: TYP_TEXT[z.kreis_typ] ?? z.kreis_typ,
      bezeichnung: z.bezeichnung,
      jahr: z.jahr,
      kontextId: z.kontext_id,
      formatMaske: z.format_maske,
      zuruecksetzung: z.zuruecksetzung,
      lueckenlos: z.lueckenlos,
      naechsteNummer: nummer,
      naechsteNummerFormatiert: vorschau(z.format_maske, nummer, z.jahr),
      geoeffnetAm: z.geoeffnet_am,
      geschlossenAm: z.geschlossen_am,
      istPlatzhalter: z.ist_platzhalter,
      genesisHash: z.genesis_hash,
      letzterHash: z.letzter_hash,
      vorgaengerId: z.vorgaenger_nummernkreis_id,
      vorgaengerBezeichnung: z.vorgaenger_bezeichnung,
      kettenlaenge: Number(z.kettenlaenge),
      zugDurchDefiner: DEFINER_KREISE.includes(z.kreis_typ),
      vergabeMoeglich: grund === null,
      vergabeGrund: grund,
    };
  });
}

// ---------------------------------------------------------------------------
// Die Köpfe der Hashketten
// ---------------------------------------------------------------------------

export interface Kettenkopf {
  readonly nummernkreisId: string;
  readonly bezeichnung: string;
  readonly jahr: number;
  readonly geschlossenAm: string | null;
  /** Der Anfang der Linie — bei einem Folgekreis der letzte Hash des Vorgängers. */
  readonly genesisHash: string | null;
  /** Der Hash des letzten Gliedes, wie der Kreis ihn führt. */
  readonly letzterHash: string | null;
  readonly kettenlaenge: number;
  /** Die höchste Kettenposition — muss der Länge entsprechen. */
  readonly hoechstePosition: number | null;
  /** Der Hash, den das letzte Glied selbst trägt. */
  readonly letztesGliedHash: string | null;
  /**
   * Stimmt `nummernkreis.letzter_hash` mit dem Hash des letzten Gliedes?
   *
   * Eine Abweichung ist kein Rechenfehler, sondern eine gebrochene
   * Buchführung: entweder fehlt ein Glied, oder es wurde eines ausgetauscht.
   * Sie steht hier und nicht in einer Farbe.
   */
  readonly kopfStimmt: boolean;
  readonly vorgaengerId: string | null;
  readonly vorgaengerBezeichnung: string | null;
  /** Der `letzter_hash` des Vorgängers — muss `genesisHash` sein (§5.7 3b). */
  readonly vorgaengerLetzterHash: string | null;
  readonly uebergangStimmt: boolean;
}

/**
 * Der GESPEICHERTE Stand je Nummernkreis — ohne die Kette nachzurechnen.
 *
 * Das ist die Trennung, auf die es hier ankommt: `pruefeKette()` liest jedes
 * Glied und rechnet jeden Hash nach; das ist die Prüfung und sie kostet mit
 * der Menge. Diese Funktion liest nur die Köpfe und die drei Zahlen, die sie
 * vergleichbar machen — sie ist der Bericht, nicht der Prüfer. Die Seite
 * zeigt zuerst diesen Bericht und rechnet erst auf ausdrücklichen Wunsch nach.
 *
 * Der Algorithmus steht nicht hier: er steht in `hash-chain.ts`
 * (`sha256-jcs-v1`) und wird von der Seite dort gelesen. Zwei Stellen mit
 * demselben Namen sind eine zu viel.
 */
export async function kettenkoepfe(db: Abfrage): Promise<readonly Kettenkopf[]> {
  const zeilen = await db.abfrage<{
    id: string; bezeichnung: string; jahr: number; geschlossen_am: string | null;
    genesis_hash: string | null; letzter_hash: string | null;
    kettenlaenge: string; hoechste_position: string | null;
    letztes_glied_hash: string | null;
    vorgaenger_id: string | null; vorgaenger_bezeichnung: string | null;
    vorgaenger_letzter_hash: string | null;
  }>(
    `select n.id::text as id, n.bezeichnung, n.jahr,
            to_char(n.geschlossen_am, 'DD.MM.YYYY') as geschlossen_am,
            n.genesis_hash, n.letzter_hash,
            (select count(*) from rechnung_hash h
              where h.mandant_id = n.mandant_id and h.nummernkreis_id = n.id)::text
              as kettenlaenge,
            (select max(h.kette_position) from rechnung_hash h
              where h.mandant_id = n.mandant_id and h.nummernkreis_id = n.id)::text
              as hoechste_position,
            (select h.hash from rechnung_hash h
              where h.mandant_id = n.mandant_id and h.nummernkreis_id = n.id
              order by h.kette_position desc limit 1) as letztes_glied_hash,
            v.id::text as vorgaenger_id, v.bezeichnung as vorgaenger_bezeichnung,
            v.letzter_hash as vorgaenger_letzter_hash
       from nummernkreis n
       left join nummernkreis v
         on v.mandant_id = n.mandant_id and v.id = n.vorgaenger_nummernkreis_id
      where n.kreis_typ in ('ausgangsrechnung', 'gutschrift')
      order by n.kreis_typ, n.jahr, n.geoeffnet_am`);

  return zeilen.map((z) => ({
    nummernkreisId: z.id,
    bezeichnung: z.bezeichnung,
    jahr: z.jahr,
    geschlossenAm: z.geschlossen_am,
    genesisHash: z.genesis_hash,
    letzterHash: z.letzter_hash,
    kettenlaenge: Number(z.kettenlaenge),
    hoechstePosition: z.hoechste_position === null ? null : Number(z.hoechste_position),
    letztesGliedHash: z.letztes_glied_hash,
    /*
     * Ein leerer Kreis „stimmt": es gibt kein Glied, dessen Hash abweichen
     * könnte. Ihn als Abweichung zu zeigen hiesse, jeden neu eröffneten Kreis
     * am ersten Tag als gebrochen zu melden — und eine Warnung, die immer
     * ansteht, wird nicht gelesen.
     */
    kopfStimmt: Number(z.kettenlaenge) === 0
      ? z.letzter_hash === null
      : z.letzter_hash === z.letztes_glied_hash,
    vorgaengerId: z.vorgaenger_id,
    vorgaengerBezeichnung: z.vorgaenger_bezeichnung,
    vorgaengerLetzterHash: z.vorgaenger_letzter_hash,
    /*
     * §5.7 Schritt 3b: der `genesis_hash` eines Nachfolgers IST der letzte
     * Hash seines Vorgängers. Ohne Vorgänger gibt es nichts zu vergleichen —
     * dann ist der Übergang nicht „falsch", sondern nicht vorhanden.
     */
    uebergangStimmt: z.vorgaenger_id === null
      || z.genesis_hash === z.vorgaenger_letzter_hash,
  }));
}

// ---------------------------------------------------------------------------
// Der letzte Lauf des Nachtprüfers
// ---------------------------------------------------------------------------

export interface Kettenlauf {
  readonly laufId: string;
  readonly gestartetAm: string;
  readonly beendetAm: string | null;
  readonly ergebnis: string;
  /**
   * Die volle Meldung DIESES Mandanten.
   *
   * Sie kommt aus `job_lauf_mandant.fehlertext`, wo der Lauf für diese
   * Gesellschaft schiefging — und `kennzahlen.meldung` aus `job_lauf`, wo er
   * gelang: `pruefeKette` gibt bei Erfolg `meldung` in die Kennzahlen und bei
   * Bruch in den Fehlertext (`kettenpruefer.ts`). Nur eine der beiden Stellen
   * zu lesen hiesse, entweder den Bruch oder das „geprüft, keine Abweichung"
   * zu verschweigen.
   */
  readonly meldung: string | null;
  readonly mandantErgebnis: string | null;
  readonly geprueft: number | null;
}

/**
 * Der zuletzt gespeicherte Lauf `kette_pruefen` — oder `null`.
 *
 * **`null` heisst „noch nie gelaufen", nicht „alles in Ordnung".** Der
 * Nachtlauf steht mit `20 3 * * *` im Jobregister; in einer frischen
 * Datenbank hat er nie gelaufen, und `job_lauf` ist leer. Die Seite muss das
 * benennen — ein leerer Berichtsblock, der aussieht wie „keine Befunde", ist
 * die gefährlichste Darstellung dieser Seite.
 */
export async function letzterKettenlauf(db: Abfrage): Promise<Kettenlauf | null> {
  const [z] = await db.abfrage<{
    lauf_id: string; gestartet_am: string; beendet_am: string | null;
    ergebnis: string; meldung: string | null; mandant_ergebnis: string | null;
    geprueft: string | null;
  }>(
    `select l.id::text as lauf_id,
            to_char(l.gestartet_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as gestartet_am,
            to_char(l.beendet_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as beendet_am,
            l.ergebnis::text as ergebnis,
            coalesce(lm.fehlertext, l.fehlertext,
                     l.kennzahlen->>'meldung') as meldung,
            lm.ergebnis::text as mandant_ergebnis,
            l.kennzahlen->>'geprueft' as geprueft
       from job_lauf l
       left join job_lauf_mandant lm
         on lm.job_lauf_id = l.id and lm.mandant_id = app.aktiver_mandant()
      where l.job = 'kette_pruefen'
      order by l.gestartet_am desc
      limit 1`);
  if (z === undefined) return null;
  return {
    laufId: z.lauf_id,
    gestartetAm: z.gestartet_am,
    beendetAm: z.beendet_am,
    ergebnis: z.ergebnis,
    meldung: z.meldung,
    mandantErgebnis: z.mandant_ergebnis,
    geprueft: z.geprueft === null ? null : Number(z.geprueft),
  };
}

// TODO(client, O-606): Die drei `ausgangsrechnung`-Kreise der Demofläche heissen „Ausgangsrechnungen (DEMO — Maske unbestätigt, O-134)" und tragen `ist_platzhalter = false`; der Name behauptet den Schutz, die Spalte hebt ihn auf, und für Rechnungskreise sitzt der Platzhalterschutz ausschliesslich in `fin.rechnung_nummer_ziehen` und prüft genau diese Spalte. Gehört sie auf `true` — und mit welcher Wirkung auf bereits festgeschriebene Belege? `kreise()` stellt beides nebeneinander und löst es nicht auf.
