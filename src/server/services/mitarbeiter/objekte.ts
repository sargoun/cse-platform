/**
 * Die Objekte, auf denen dieser Mensch arbeitet (EMP-02, EMP-13, EMP-14,
 * OPS-01, K-05, K-18).
 *
 * **Die Liste kommt aus der EINTEILUNG, nicht aus dem Objektstamm.** Gelesen
 * wird im Personen-Scope, und dort gibt `objekt.t_person` (0028) genau die
 * Gebaeude heraus, auf die dieser Mensch eine lebende Zuordnung hat. Eine
 * Abfrage auf `objekt` ohne diesen Weg saehe im Personen-Scope null Zeilen —
 * ohne Fehler, ohne Meldung (AUT-05), und die Seite laese sich wie „Sie sind
 * nirgends eingesetzt".
 *
 * **Zwei verschiedene Fragen, zwei verschiedene Antworten.** „Auf welchen
 * Objekten habe ich gearbeitet?" ist die Liste hier: sie umfasst auch die
 * vergangenen, denn wer den Weg von vorletzter Woche nachsehen will, findet
 * ihn sonst nicht mehr. „Wo bin ich JETZT eingeteilt?" beantwortet
 * `app.ist_eingesetzt_auf_objekt` — dieselbe Funktion, an der die
 * Schichtseiten, `leistungsnachweis.p_portal_decke` und `objekt.t_selbst_m1`
 * haengen (0069, 0300). Sie steht als Feld in jeder Zeile, weil an ihr der
 * Zutrittshinweis haengt und nichts anderes daran haengen soll.
 *
 * **Kein Kunde, kein Auftrag, kein Preis** (EMP-13, K-05). Ein Objekt ist hier
 * ein ORT: Anschrift, Etagen, Gebaeudetyp. `kunde_id` steht nicht in der
 * Projektion, und `objekt.bemerkung`/`zutritt_hinweis` sind `cse_app` als
 * SPALTE entzogen (0021) — sie kaemen aus dieser Abfrage gar nicht heraus.
 * Der Zutrittshinweis hat seinen eigenen, engen Weg: `leseObjektZugang`.
 *
 * **Diese Datei LIEST nur.** `tests/kern/mitarbeiter.test.ts` haelt fest, dass
 * kein Dienst unter `mitarbeiter/` schreibt (EMP-07, K-18).
 */
import type { LeseKontext } from '../../kontext/index.js';

/** Ein Objekt, wie das Mitarbeiterportal es zeigt. */
export interface EigenesObjekt {
  readonly objektId: string;
  readonly mandantSlug: string;
  readonly mandantName: string;
  readonly objektnummer: string;
  readonly bezeichnung: string;
  readonly gebaeudetyp: string | null;
  readonly strasse: string;
  readonly hausnummer: string | null;
  readonly adresszusatz: string | null;
  readonly plz: string;
  readonly ort: string;
  readonly etagenAnzahl: number | null;
  /** Das Objekt ist aus dem Stamm genommen — die Schichten bleiben lesbar. */
  readonly archiviert: boolean;
  /**
   * Bin ich HIER und JETZT eingeteilt? — `app.ist_eingesetzt_auf_objekt`.
   *
   * Genau dieses Feld entscheidet, ob der Zutrittshinweis erscheint. Es wird
   * nicht in der Anwendung gerechnet: die Funktion in der Datenbank ist
   * dieselbe, die die Policies lesen, und eine zweite Fassung davon liefe
   * irgendwann auseinander.
   */
  readonly aktuellEingeteilt: boolean;
  /** Wie viele eigene Einteilungen auf diesem Objekt — Vergangenheit inbegriffen. */
  readonly anzahlEinteilungen: number;
  /** `TT.MM.JJJJ HH:MM` Berliner Ortszeit, oder `null` — fertig aus der Datenbank. */
  readonly naechsteSchichtLokal: string | null;
  readonly letzteSchichtLokal: string | null;
}

/**
 * Die festgeschriebene Feldliste (K-05, EMP-13).
 *
 * Sie steht in `MITARBEITER_NUTZLASTEN`; die Abnahme vergleicht die Schluessel
 * der Antwort Feld fuer Feld gegen diese Liste. Ein spaeter hinzugefuegtes
 * `kundeName` faellt damit auf, bevor es ausgeliefert wird.
 */
export const EIGENES_OBJEKT_FELDER = [
  'objektId', 'mandantSlug', 'mandantName', 'objektnummer', 'bezeichnung',
  'gebaeudetyp', 'strasse', 'hausnummer', 'adresszusatz', 'plz', 'ort',
  'etagenAnzahl', 'archiviert', 'aktuellEingeteilt', 'anzahlEinteilungen',
  'naechsteSchichtLokal', 'letzteSchichtLokal',
] as const;

/**
 * Was ausser der Anschrift nur der bekommt, der dort eingeteilt IST
 * (0360, SEC-05, SEC-06).
 *
 * Vier Texte, keine Zeile einer Tabelle. Der Weg dahin ist
 * `app.mein_objekt_zugang` — ein Definer mit genau der Bedingung, die auch
 * `objekt.t_selbst_m1` traegt.
 */
export interface EigenerObjektZugang {
  readonly zutrittHinweis: string | null;
  readonly ansprechpartnerName: string | null;
  readonly ansprechpartnerTelefon: string | null;
  readonly ansprechpartnerMobil: string | null;
}

export const OBJEKT_ZUGANG_FELDER = [
  'zutrittHinweis', 'ansprechpartnerName', 'ansprechpartnerTelefon',
  'ansprechpartnerMobil',
] as const;

interface ObjektRoh {
  readonly objekt_id: string;
  readonly mandant_slug: string;
  readonly mandant_name: string;
  readonly objektnummer: string;
  readonly bezeichnung: string;
  readonly gebaeudetyp: string | null;
  readonly strasse: string;
  readonly hausnummer: string | null;
  readonly adresszusatz: string | null;
  readonly plz: string;
  readonly ort: string;
  readonly etagen_anzahl: number | null;
  readonly archiviert: boolean;
  readonly aktuell_eingeteilt: boolean;
  readonly anzahl_einteilungen: number;
  readonly naechste_lokal: string | null;
  readonly letzte_lokal: string | null;
}

/**
 * Die Spalten stehen EINMAL da — Liste und Einzelansicht lesen dieselben.
 *
 * Drei Fassungen derselben Auswahl gehen auseinander, sobald eine davon eine
 * Spalte dazubekommt; die Einzelansicht zeigte dann etwas anderes als die
 * Zeile, aus der man sie geoeffnet hat.
 *
 * **`o.zutritt_hinweis` und `o.bemerkung` stehen hier NICHT und koennen hier
 * nicht stehen**: 0021 entzieht `cse_app` beide Spalten. Eine Abfrage darauf
 * scheitert an „permission denied for column" — hart und sichtbar, und das
 * ist die richtige Antwort auf einen Versuch, sie hier mitzunehmen.
 *
 * `now()` kommt aus der DATENBANK (Invariante 5): dieselbe Uhr, die
 * `app.ist_eingesetzt_auf_objekt` benutzt. Aus dem Node-Prozess gerechnet
 * koennten Seite und Policy um Sekunden auseinanderliegen.
 */
const SPALTEN = `
  o.id                                        as objekt_id,
  m.slug                                      as mandant_slug,
  m.name                                      as mandant_name,
  o.objektnummer,
  o.bezeichnung,
  o.gebaeudetyp,
  o.strasse,
  o.hausnummer,
  o.adresszusatz,
  o.plz,
  o.ort,
  o.etagen_anzahl,
  (o.archiviert_am is not null)               as archiviert,
  app.ist_eingesetzt_auf_objekt(o.id)         as aktuell_eingeteilt,
  count(*)::int                               as anzahl_einteilungen,
  to_char(min(z.beginn_zeitpunkt) filter (where z.ende_zeitpunkt >= now())
            at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                              as naechste_lokal,
  to_char(max(z.ende_zeitpunkt) filter (where z.ende_zeitpunkt < now())
            at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                              as letzte_lokal`;

/**
 * Die Quelle ist die ZUORDNUNG, nicht der Objektstamm.
 *
 * `join` und nicht `left join` auf `objekt`: eine Schicht ohne Objekt
 * (Veranstaltung, Springerdienst) gehoert nicht in eine Objektliste, und sie
 * traegt `einsatz.objekt_id` NULL.
 */
const QUELLE = `
  from einsatz_zuordnung z
  join einsatz e  on e.mandant_id = z.mandant_id and e.id = z.einsatz_id
  join objekt  o  on o.mandant_id = e.mandant_id and o.id = e.objekt_id
  join mandant m  on m.id = o.mandant_id`;

/**
 * Eine entfernte oder abgesagte Einteilung zaehlt nicht mit.
 *
 * `entfernt_am is null` ist wortgleich mit `objekt.t_person` (0028) — waere es
 * das nicht, zaehlte die Zeile eine Einteilung mit, deren Objekt die Policy
 * gar nicht herausgibt, und die Liste haette eine Zeile ohne Anschrift.
 * `status <> 'abgesagt'` und `storniert_am is null` kommen aus
 * `app.eigene_einsatz_objekte` (0069): abgesagt ist nicht eingeteilt.
 */
const LEBEND = `z.entfernt_am is null
                and z.status <> 'abgesagt'
                and e.storniert_am is null`;

/**
 * `group by o.id, m.id` — die Primaerschluessel, nicht die Spaltenliste.
 *
 * Postgres laesst jede weitere Spalte einer Tabelle zu, deren
 * Primaerschluessel gruppiert ist (funktionale Abhaengigkeit). Achtzehn
 * Spalten in der `group by`-Zeile waeren achtzehn Stellen, an denen die
 * naechste vergessen wird.
 */
const GRUPPE = `group by o.id, m.id`;

const SORTIERUNG = `
  order by app.ist_eingesetzt_auf_objekt(o.id) desc,
           min(z.beginn_zeitpunkt) filter (where z.ende_zeitpunkt >= now())
             asc nulls last,
           max(z.ende_zeitpunkt) desc,
           o.bezeichnung asc`;

function abbilden(o: ObjektRoh): EigenesObjekt {
  return {
    objektId: o.objekt_id,
    mandantSlug: o.mandant_slug,
    mandantName: o.mandant_name,
    objektnummer: o.objektnummer,
    bezeichnung: o.bezeichnung,
    gebaeudetyp: o.gebaeudetyp,
    strasse: o.strasse,
    hausnummer: o.hausnummer,
    adresszusatz: o.adresszusatz,
    plz: o.plz,
    ort: o.ort,
    etagenAnzahl: o.etagen_anzahl === null ? null : Number(o.etagen_anzahl),
    archiviert: o.archiviert,
    aktuellEingeteilt: o.aktuell_eingeteilt,
    anzahlEinteilungen: Number(o.anzahl_einteilungen),
    naechsteSchichtLokal: o.naechste_lokal,
    letzteSchichtLokal: o.letzte_lokal,
  };
}

/**
 * Alle Objekte dieses Menschen — die laufenden zuerst.
 *
 * Ohne Fenster und ohne Grenze: ein Mensch arbeitet auf einer Handvoll
 * Objekten, nicht auf tausend, und eine Seitenzahl auf einem Diensttelefon
 * ist ein zweiter Bedienschritt fuer eine Liste, die auf einen Bildschirm
 * passt.
 */
export async function listeEigeneObjekte(
  kontext: LeseKontext,
): Promise<readonly EigenesObjekt[]> {
  const roh = await kontext.abfrage<ObjektRoh>(
    `select ${SPALTEN} ${QUELLE} where ${LEBEND} ${GRUPPE} ${SORTIERUNG}`,
  );
  return roh.map(abbilden);
}

/**
 * Ein einzelnes Objekt — oder `null`, wenn dieser Mensch dort nicht
 * eingeteilt ist oder war.
 *
 * Kein 403: ein fremdes Objekt ist fuer diese Anmeldung nicht vorhanden
 * (AUT-06). Der Unterschied waere die Auskunft, dass es das Objekt gibt.
 */
export async function findeEigenesObjekt(
  kontext: LeseKontext, objektId: string,
): Promise<EigenesObjekt | null> {
  const [o] = await kontext.abfrage<ObjektRoh>(
    `select ${SPALTEN} ${QUELLE}
      where ${LEBEND} and o.id = $1::uuid ${GRUPPE}`,
    [objektId],
  );
  return o === undefined ? null : abbilden(o);
}

interface ZugangRoh {
  readonly zutritt_hinweis: string | null;
  readonly ansprechpartner_name: string | null;
  readonly ansprechpartner_telefon: string | null;
  readonly ansprechpartner_mobil: string | null;
}

/**
 * Zutrittshinweis und Ansprechpartner — oder `null`.
 *
 * `null` heisst hier **„nicht (mehr) eingeteilt"**, und die Seite sagt das
 * ausdruecklich: ein Schluessel- oder Alarmcode gehoert dem, der dort
 * eingeteilt IST, und nur, solange er es ist. Sind alle vier Felder leer, gibt
 * es schlicht nichts zu hinterlegen — auch das ist eine eigene Auskunft und
 * nicht dieselbe (AUT-05).
 *
 * Die Bedingung steht NICHT hier, sondern in `app.mein_objekt_zugang` (0360),
 * und sie ist dort wortgleich mit der der Schichtseiten. Eine Pruefung in
 * dieser Datei waere die zweite Sichtbarkeitsregel, die irgendwann etwas
 * anderes sagt als die Policy.
 */
export async function leseObjektZugang(
  kontext: LeseKontext, objektId: string,
): Promise<EigenerObjektZugang | null> {
  const [z] = await kontext.abfrage<ZugangRoh>(
    `select zutritt_hinweis, ansprechpartner_name,
            ansprechpartner_telefon, ansprechpartner_mobil
       from app.mein_objekt_zugang($1::uuid)`,
    [objektId],
  );
  if (z === undefined) return null;
  return {
    zutrittHinweis: z.zutritt_hinweis,
    ansprechpartnerName: z.ansprechpartner_name,
    ansprechpartnerTelefon: z.ansprechpartner_telefon,
    ansprechpartnerMobil: z.ansprechpartner_mobil,
  };
}

/** Steht in diesem Zugang ueberhaupt etwas? */
export function zugangIstLeer(z: EigenerObjektZugang): boolean {
  return z.zutrittHinweis === null
    && z.ansprechpartnerName === null
    && z.ansprechpartnerTelefon === null
    && z.ansprechpartnerMobil === null;
}

/**
 * Die Anschrift als EIN Satz, so wie sie auf einen Briefumschlag gehoert.
 *
 * Sie steht hier und nicht in der Seite: CLAUDE.md laesst in einer Komponente
 * keine Rechnung zu, und das Zusammensetzen einer Adresse ist genau die Art
 * kleiner Regel, die sonst jede Seite ein bisschen anders trifft — einmal mit
 * Komma, einmal ohne Hausnummer, einmal mit doppeltem Leerzeichen, wenn
 * `hausnummer` NULL ist (und das ist sie oft: ein Gelaende hat keine).
 */
export function anschriftZeile(o: EigenesObjekt): string {
  const strasse = [o.strasse, o.hausnummer].filter((t) => t !== null && t !== '').join(' ');
  const ort = [o.plz, o.ort].filter((t) => t !== '').join(' ');
  return [strasse, o.adresszusatz, ort]
    .filter((t): t is string => t !== null && t.trim() !== '')
    .join(', ');
}
