import 'server-only';
import { fehlendePflichtfelder } from '../finanz/xrechnung/index.js';
import { leseNutzlast, SnapshotZuAltFehler } from '../finanz/xrechnung/aus-snapshot.js';
import {
  GESELLSCHAFT_SPALTEN, GRENZE, gesellschaftAus,
  type Gesellschaft, type GesellschaftRoh, type KundenAbfrage,
} from './basis.js';

/**
 * Die Rechnungen eines Kunden — der Beleg, wie der Kunde ihn bekommt
 * (FIN-11, FIN-12, DOC-03, O-91, 04-SEITENKARTE §8).
 *
 * **Ein Entwurf ist hier strukturell unerreichbar, und das beantwortet O-91.**
 * `rechnung.t_kunde` UND `rechnung.p_rechnung_decke` (0075) verlangen beide
 * `status = 'festgeschrieben'`. Die Frage „darf der Kunde einen Entwurf
 * sehen" ist damit in der Datenbank konservativ entschieden, nicht in einer
 * `where`-Bedingung, die jemand vergessen kann. Die Bedingung steht unten
 * trotzdem noch einmal — zwei Linien, nie eine (AUT-05).
 *
 * **Was hier bewusst NICHT gelesen wird, und warum jede Auslassung eine
 * eigene Begruendung hat:**
 *
 *  · `nummernkreis_id`, `nummer_laufend` — der Nummernkreis ist die interne
 *    Lueckenlosigkeitspruefung (FIN-03, Invariante 4). Aus der laufenden
 *    Nummer liest der Kunde ab, wie viele Rechnungen die Gesellschaft
 *    insgesamt geschrieben hat.
 *  · `rechnung_hash`, `rechnungsausgangsbuch` — dieselbe Ueberlegung, und
 *    beide tragen `p_intern_ceiling`: ein Join darueber gaebe null Zeilen
 *    statt einer Fehlermeldung (K-18).
 *  · `rechnungsposition_quelle` — die Herkunft einer Position (welcher
 *    Zeiteintrag, welches Aufmass). `p_intern_ceiling`, und fachlich zeigt
 *    sie auf Schichten und damit auf Menschen (04-SEITENKARTE §8).
 *  · `verworfen_am` / `verworfen_grund` — der Weg eines Entwurfs, den es aus
 *    Kundensicht nie gegeben hat.
 *  · `festgeschrieben_von` — ein Benutzer, also ein Name.
 *
 * **Der Storno kommt aus `rechnung_beziehung`, nicht aus einer Spalte.**
 * `rechnung` fuehrt kein `storniert_am` und kein `storniert_durch`; die
 * Umkehrlesart wird nicht gespeichert, weil eine zweite Zeile eine zweite
 * Kopie derselben Tatsache waere. `rechnung_beziehung` traegt `t_kunde` plus
 * `p_kind_decke`, beide auf `status = 'festgeschrieben'` und
 * `app.aktuelle_kunden()` eingeschnuert — die Spalte ist im Kunden-Scope also
 * baubar, und zwar als Unterabfrage wie in der internen Liste.
 */

export interface Kundenrechnung extends Gesellschaft {
  readonly id: string;
  readonly nummer: string;
  readonly rechnungsart: string;
  readonly waehrung: string;
  readonly rechnungsdatumLokal: string | null;
  readonly leistungVonLokal: string | null;
  readonly leistungBisLokal: string | null;
  readonly faelligAmLokal: string | null;
  /** Ganzzahltext in Cent (Invariante 1) — die Seite formatiert, sie rechnet nicht. */
  readonly bruttoCent: string;
  readonly zahlbetragCent: string;
  /** Die Nummer der Rechnung, die diese aufhebt — oder `null`. */
  readonly storniertDurch: string | null;
  /** Gibt es den Snapshot, aus dem PDF und XRechnung entstehen (K-12)? */
  readonly hatSnapshot: boolean;
}

interface ListenZeile extends GesellschaftRoh {
  readonly id: string;
  readonly nummer: string;
  readonly rechnungsart: string;
  readonly waehrung: string;
  readonly rechnungsdatum_lokal: string | null;
  readonly leistung_von_lokal: string | null;
  readonly leistung_bis_lokal: string | null;
  readonly faellig_am_lokal: string | null;
  readonly brutto_cent: string;
  readonly zahlbetrag_cent: string;
  readonly storniert_durch: string | null;
  readonly hat_snapshot: boolean;
}

const KOPF_SPALTEN = `
  r.id, r.nummer, r.rechnungsart::text as rechnungsart, r.waehrung,
  to_char(r.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum_lokal,
  to_char(r.leistung_von, 'DD.MM.YYYY') as leistung_von_lokal,
  to_char(r.leistung_bis, 'DD.MM.YYYY') as leistung_bis_lokal,
  to_char(r.faellig_am, 'DD.MM.YYYY') as faellig_am_lokal,
  r.brutto_cent::text as brutto_cent, r.zahlbetrag_cent::text as zahlbetrag_cent,
  ${GESELLSCHAFT_SPALTEN},
  (select s.nummer from rechnung_beziehung b
     join rechnung s on s.mandant_id = b.mandant_id and s.id = b.von_rechnung_id
    where b.mandant_id = r.mandant_id and b.zu_rechnung_id = r.id and b.art = 'storno'
    limit 1) as storniert_durch,
  exists (select 1 from rechnung_snapshot sn
           where sn.mandant_id = r.mandant_id and sn.rechnung_id = r.id) as hat_snapshot`;

const QUELLE = `
  from rechnung r
  join mandant m on m.id = r.mandant_id`;

/**
 * Die Liste, das jüngste Rechnungsdatum zuerst.
 *
 * `slug` filtert nach liefernder Gesellschaft — der Fall O-52 (ein Login,
 * zwei Gesellschaften). **Kein Mandantenwechsler**: der aktive Mandant lebt
 * im Kunden-Scope nicht (K-20), und ein Umschalter, der die Sitzung aendert,
 * waere genau der Weg, den Invariante 3 ausschliesst. Der Filter verengt nur
 * die Anzeige; was sichtbar IST, entscheidet RLS.
 */
export async function listeKundenrechnungen(
  kontext: KundenAbfrage, filter: { readonly mandantSlug?: string | null } = {},
): Promise<readonly Kundenrechnung[]> {
  const zeilen = await kontext.abfrage<ListenZeile>(
    `select ${KOPF_SPALTEN} ${QUELLE}
      where r.status = 'festgeschrieben'
        and ($1::text is null or m.slug = $1)
      order by r.rechnungsdatum desc nulls last, r.nummer desc
      limit ${GRENZE}`,
    [filter.mandantSlug ?? null],
  );
  return zeilen.map(alsZeile);
}

/**
 * Die Gesellschaften, die diesem Kunden überhaupt Rechnungen gestellt haben —
 * für den Filter.
 *
 * Aus den eigenen Rechnungen abgeleitet und nicht aus
 * `app.sichtbare_mandanten()`: eine Gesellschaft, von der es keinen Beleg
 * gibt, waere ein Filter, der immer eine leere Liste ergibt.
 */
export async function rechnungsGesellschaften(
  kontext: KundenAbfrage,
): Promise<readonly Gesellschaft[]> {
  const zeilen = await kontext.abfrage<GesellschaftRoh>(
    `select distinct ${GESELLSCHAFT_SPALTEN}
       from rechnung r join mandant m on m.id = r.mandant_id
      where r.status = 'festgeschrieben'
      order by 2`,
  );
  return zeilen.map(gesellschaftAus);
}

/* ---------------------------------------------------------------------------
 * Der einzelne Beleg
 * ------------------------------------------------------------------------ */

export interface Rechnungsposition {
  readonly nr: number;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  /** Postgres-`numeric` als Text — `formatiereMenge(mengeAusPostgres(...))` in der Seite. */
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly einzelpreisCent: string | null;
  readonly rabattBp: number | null;
  /**
   * NULLABLE, und zwar erzwungen: der CHECK `rp_ohne_leistung_ohne_betrag`
   * verlangt `netto_cent IS NULL` fuer jede Position mit
   * `positionsart <> 'leistung'` — also fuer `textzeile` und
   * `zwischensumme`. Gliederungs- und Textzeilen sind Darstellung und tragen
   * keinen Betrag. Die Seite faengt das ab wie bei `menge` und
   * `einzelpreisCent`.
   */
  readonly nettoCent: string | null;
  readonly satzBp: number;
  readonly leistungVonLokal: string | null;
  readonly leistungBisLokal: string | null;
}

export interface Steuerzeile {
  readonly kategorie: string;
  readonly satzBp: number;
  readonly nettoCent: string;
  readonly steuerCent: string;
  readonly befreiungsgrundText: string | null;
}

export interface Zuschlagzeile {
  readonly art: string;
  readonly bezeichnung: string;
  readonly betragCent: string;
  readonly satzBp: number | null;
}

export interface KundenrechnungVoll extends Kundenrechnung {
  readonly nettoGesamtCent: string;
  readonly steuerGesamtCent: string;
  readonly abzugBruttoCent: string;
  readonly kopftext: string | null;
  readonly fusstext: string | null;
  readonly steuerhinweis: string | null;
  readonly zahlungsbedingungText: string | null;
  readonly zahlungszielTage: number | null;
  readonly skontoBp: number | null;
  readonly skontoTage: number | null;
  readonly reverseCharge: boolean;
  readonly bestellnummerKunde: string | null;
  readonly leitwegId: string | null;
  readonly festgeschriebenLokal: string | null;
  readonly positionen: readonly Rechnungsposition[];
  readonly steuern: readonly Steuerzeile[];
  readonly zuschlaege: readonly Zuschlagzeile[];
}

interface VollZeile extends ListenZeile {
  readonly netto_gesamt_cent: string;
  readonly steuer_gesamt_cent: string;
  readonly abzug_brutto_cent: string;
  readonly kopftext: string | null;
  readonly fusstext: string | null;
  readonly steuerhinweis: string | null;
  readonly zahlungsbedingung_text: string | null;
  readonly zahlungsziel_tage: number | null;
  readonly skonto_bp: number | null;
  readonly skonto_tage: number | null;
  readonly reverse_charge: boolean;
  readonly bestellnummer_kunde: string | null;
  readonly leitweg_id: string | null;
  readonly festgeschrieben_lokal: string | null;
}

/**
 * Der Beleg mit Positionen, Steuerzeilen und Zuschlaegen.
 *
 * **Eine eigene Ladefunktion und nicht `ladeRechnungVollstaendig`.** Die
 * interne Fassung liest zusaetzlich die Herkunftszeilen
 * (`rechnungsposition_quelle`, im Kunden-Scope null Zeilen), den
 * Nummernkreis, den Kleinbetragsschwellenwert und die vollstaendigen
 * Stammdaten beider Parteien fuer die XRechnung — Arbeit, deren Ergebnis die
 * Kundenseite nicht zeigt, plus zwei Abfragen, die still leer
 * zurueckkommen. Eine Seite, die eine leere Liste rendert, weil eine Policy
 * sie leer macht, sieht aus wie eine Seite ohne Daten (K-18).
 *
 * **Es wird nichts addiert.** `netto_gesamt_cent`, `steuer_gesamt_cent`,
 * `brutto_cent` und `zahlbetrag_cent` stehen am Beleg, und die Steuer steht je
 * Steuersatzgruppe in `rechnung_steuer` — nach Invariante 1 wird die
 * Umsatzsteuer je Gruppe gerechnet und nie aus einem Bruttobetrag
 * zurueckgerechnet. Diese Funktion liest sie; sie rechnet keine Summe nach,
 * und die Seite erst recht nicht.
 */
export async function findeKundenrechnung(
  kontext: KundenAbfrage, id: string,
): Promise<KundenrechnungVoll | null> {
  const [kopf] = await kontext.abfrage<VollZeile>(
    `select ${KOPF_SPALTEN},
            r.netto_gesamt_cent::text as netto_gesamt_cent,
            r.steuer_gesamt_cent::text as steuer_gesamt_cent,
            r.abzug_brutto_cent::text as abzug_brutto_cent,
            r.kopftext, r.fusstext, r.steuerhinweis,
            r.zahlungsbedingung_text, r.zahlungsziel_tage, r.skonto_bp, r.skonto_tage,
            r.reverse_charge, r.bestellnummer_kunde, r.leitweg_id,
            to_char(r.festgeschrieben_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as festgeschrieben_lokal
       ${QUELLE}
      where r.id = $1::uuid and r.status = 'festgeschrieben'`,
    [id],
  );
  if (kopf === undefined) return null;

  const positionen = await kontext.abfrage<{
    position_nr: number; bezeichnung: string; beschreibung: string | null;
    menge: string | null; einheit: string | null; einzelpreis_cent: string | null;
    rabatt_bp: number | null; netto_cent: string | null; satz_bp: number;
    leistung_von_lokal: string | null; leistung_bis_lokal: string | null;
  }>(
    /*
     * `positionsart` und `kategorie` bleiben weg: die eine unterscheidet
     * Sammel- von Einzelzeilen fuer die interne Gliederung, die andere ist
     * der UStG-Schluessel, den die XRechnung traegt. Auf dem Papierbeleg
     * steht der SATZ, und der steht hier.
     */
    `select p.position_nr, p.bezeichnung, p.beschreibung,
            p.menge::text as menge, p.einheit,
            p.einzelpreis_cent::text as einzelpreis_cent, p.rabatt_bp,
            p.netto_cent::text as netto_cent, p.satz_bp,
            to_char(p.leistung_von, 'DD.MM.YYYY') as leistung_von_lokal,
            to_char(p.leistung_bis, 'DD.MM.YYYY') as leistung_bis_lokal
       from rechnungsposition p
      where p.rechnung_id = $1::uuid
      order by p.position_nr`,
    [id],
  );

  const steuern = await kontext.abfrage<{
    kategorie: string; satz_bp: number; netto_cent: string; steuer_cent: string;
    befreiungsgrund_text: string | null;
  }>(
    `select s.kategorie::text as kategorie, s.satz_bp,
            s.netto_cent::text as netto_cent, s.steuer_cent::text as steuer_cent,
            s.befreiungsgrund_text
       from rechnung_steuer s
      where s.rechnung_id = $1::uuid
      order by s.satz_bp desc`,
    [id],
  );

  const zuschlaege = await kontext.abfrage<{
    art: string; bezeichnung: string; betrag_cent: string; satz_bp: number | null;
  }>(
    `select z.art::text as art, z.bezeichnung,
            z.betrag_cent::text as betrag_cent, z.satz_bp
       from rechnung_zuschlag z
      where z.rechnung_id = $1::uuid
      order by z.art, z.bezeichnung`,
    [id],
  );

  return {
    ...alsZeile(kopf),
    nettoGesamtCent: kopf.netto_gesamt_cent,
    steuerGesamtCent: kopf.steuer_gesamt_cent,
    abzugBruttoCent: kopf.abzug_brutto_cent,
    kopftext: kopf.kopftext,
    fusstext: kopf.fusstext,
    steuerhinweis: kopf.steuerhinweis,
    zahlungsbedingungText: kopf.zahlungsbedingung_text,
    zahlungszielTage: kopf.zahlungsziel_tage,
    skontoBp: kopf.skonto_bp,
    skontoTage: kopf.skonto_tage,
    reverseCharge: kopf.reverse_charge,
    bestellnummerKunde: kopf.bestellnummer_kunde,
    leitwegId: kopf.leitweg_id,
    festgeschriebenLokal: kopf.festgeschrieben_lokal,
    positionen: positionen.map((p) => ({
      nr: Number(p.position_nr),
      bezeichnung: p.bezeichnung,
      beschreibung: p.beschreibung,
      menge: p.menge,
      einheit: p.einheit,
      einzelpreisCent: p.einzelpreis_cent,
      rabattBp: p.rabatt_bp,
      nettoCent: p.netto_cent,
      satzBp: p.satz_bp,
      leistungVonLokal: p.leistung_von_lokal,
      leistungBisLokal: p.leistung_bis_lokal,
    })),
    steuern: steuern.map((s) => ({
      kategorie: s.kategorie,
      satzBp: s.satz_bp,
      nettoCent: s.netto_cent,
      steuerCent: s.steuer_cent,
      befreiungsgrundText: s.befreiungsgrund_text,
    })),
    zuschlaege: zuschlaege.map((z) => ({
      art: z.art,
      bezeichnung: z.bezeichnung,
      betragCent: z.betrag_cent,
      satzBp: z.satz_bp,
    })),
  };
}

/*
 * `prozentText` steht seit V-134 in `finanz/prozent.ts` — das Rechnungsblatt
 * (ZUGFeRD-PDF) braucht denselben Text wie diese Seite, und zwei Formatierer
 * für einen Beleg sind zwei Wahrheiten. Hier weitergereicht, damit die Seiten
 * des Kundenportals ihren Import behalten.
 */
export { prozentText } from '../finanz/prozent.js';

/* ---------------------------------------------------------------------------
 * Kann aus diesem Beleg überhaupt eine Datei entstehen?
 * ------------------------------------------------------------------------ */

export type Ausgabezustand =
  /** PDF und XRechnung entstehen. */
  | { readonly art: 'moeglich' }
  /** Kein Snapshot — ohne ihn entsteht nach K-12 gar nichts. */
  | { readonly art: 'kein_snapshot' }
  /** Der Snapshot ist zu alt (Nutzlast v1) und trägt die Felder nicht. */
  | { readonly art: 'zu_alt' }
  /** Eine Pflichtangabe der EN 16931 fehlt — die Zahl, nicht die Liste. */
  | { readonly art: 'unvollstaendig'; readonly anzahl: number };

/**
 * **Warum die Seite das VORHER wissen muss.**
 *
 * `ublZurRechnung` und `zugferdZurRechnung` werfen
 * `XRechnungUnvollstaendigFehler`, wenn eine Pflichtangabe der EN 16931 fehlt
 * — die Route antwortet dann 422 mit der Feldliste. Das ist intern richtig:
 * dort sitzt jemand, der die Felder pflegen kann. Im Kundenportal waere es
 * ein Knopf, der eine JSON-Fehlermeldung mit BT-Nummern herunterlaedt.
 *
 * Nachgemessen am Demobestand: fuer JEDE der 19 Rechnungen des Portalkunden
 * fehlen BT-49 (elektronische Adresse des Leistungsempfaengers) und BT-10
 * (Kaeuferreferenz beziehungsweise Leitweg-ID, O-22). Ein Knopf waere dort
 * neunzehnmal ein Fehler.
 *
 * **Geprueft wird mit DERSELBEN Funktion, die das Dokument prueft**
 * (`fehlendePflichtfelder`), nicht mit einer zweiten Fassung der Regeln: zwei
 * Fassungen derselben Pruefung sind zwei Gelegenheiten, eine davon zu
 * lockern. Die ZAHL kommt heraus, nicht die Liste — welche Felder fehlen, ist
 * eine Auskunft fuer das Haus und nicht fuer den Kunden.
 *
 * Nur fuer den EINZELNEN Beleg: die Nutzlast wird dafuer gelesen und
 * geparst, und das 200-mal fuer eine Liste zu tun waere teuer ohne Nutzen —
 * die Liste verweist deshalb auf den Beleg.
 */
export async function belegAusgabe(
  kontext: KundenAbfrage, rechnungId: string,
): Promise<Ausgabezustand> {
  const [z] = await kontext.abfrage<{
    nutzlast_bytes: Uint8Array | null; ist_pflicht: boolean;
  }>(
    `select s.nutzlast_bytes,
            (k.xrechnung_pflicht or k.ist_oeffentlicher_auftraggeber) as ist_pflicht
       from rechnung r
       join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
       left join rechnung_snapshot s on s.mandant_id = r.mandant_id and s.rechnung_id = r.id
      where r.id = $1::uuid and r.status = 'festgeschrieben'`,
    [rechnungId],
  );
  if (z === undefined || z.nutzlast_bytes === null) return { art: 'kein_snapshot' };

  try {
    const fehlend = fehlendePflichtfelder(
      leseNutzlast(z.nutzlast_bytes), { leitwegPflicht: z.ist_pflicht },
    );
    return fehlend.length === 0
      ? { art: 'moeglich' }
      : { art: 'unvollstaendig', anzahl: fehlend.length };
  } catch (fehler) {
    /*
     * `SnapshotZuAltFehler` ist die einzige erwartete Ausnahme: eine Nutzlast
     * der Gestalt v1 traegt die Felder der EN 16931 nicht. Alles andere wird
     * weitergeworfen — ein stiller `false` machte aus einem Programmfehler
     * einen fehlenden Knopf, und niemand saehe warum.
     */
    if (fehler instanceof SnapshotZuAltFehler) return { art: 'zu_alt' };
    throw fehler;
  }
}

/**
 * Der Bereich einer Rechnung — für das Tor der Ausgaberouten.
 *
 * `authorize` prueft `app.hat_recht(recht, mandantId)`, und im Kunden-Scope
 * antwortet die Funktion mit `mandantId = null` auf ALLES `false`
 * (nachgemessen gegen eine echte Kundensitzung). Die Route braucht also den
 * Bereich der angefragten Rechnung, und den holt sie hier — unter derselben
 * RLS wie die Seite, also nur fuer die eigenen festgeschriebenen Belege. Eine
 * fremde Rechnung liefert `null`, und daraus wird 404 (AUT-06).
 */
export async function mandantZurRechnung(
  kontext: KundenAbfrage, id: string,
): Promise<string | null> {
  const [z] = await kontext.abfrage<{ mandant_id: string }>(
    `select r.mandant_id from rechnung r
      where r.id = $1::uuid and r.status = 'festgeschrieben'`,
    [id],
  );
  return z?.mandant_id ?? null;
}

function alsZeile(z: ListenZeile): Kundenrechnung {
  return {
    id: z.id,
    nummer: z.nummer,
    rechnungsart: z.rechnungsart,
    waehrung: z.waehrung,
    rechnungsdatumLokal: z.rechnungsdatum_lokal,
    leistungVonLokal: z.leistung_von_lokal,
    leistungBisLokal: z.leistung_bis_lokal,
    faelligAmLokal: z.faellig_am_lokal,
    bruttoCent: z.brutto_cent,
    zahlbetragCent: z.zahlbetrag_cent,
    storniertDurch: z.storniert_durch,
    hatSnapshot: z.hat_snapshot,
    ...gesellschaftAus(z),
  };
}
