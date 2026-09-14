import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { cent, type Cent } from '../finanz/geld.js';
import { diffAusJson } from './diff-json.js';
import type { Diff } from './diff.js';
import {
  dringlichkeit, dringlichkeitText, sortierePosteingang, sortSchluessel,
  type Dringlichkeit, type PosteingangZeile, type Risiko, type VorgangTyp,
} from './posteingang.js';

/**
 * Lesen fuer die zwei Bildschirme des Posteingangs (APR-01 … APR-03, D-472).
 *
 * **Nichts wird hier gerechnet.** Die Ordnung kommt aus `sortierePosteingang`,
 * die Einstufung steht in der Zeile, seit der Vorschlag geschrieben wurde,
 * und die Zahl der unsicheren Felder fuehrt die Datenbank
 * (`trg_freigabe_felder_zaehlen`). Die Seite formatiert.
 *
 * **Die Ansicht wird HIER vermerkt und nicht im Bildschirm** —
 * `oeffneFreigabe` ist der eine Weg, eine Freigabe zu lesen, und er
 * schreibt die `freigabe_ansicht`-Zeile, auf der APR-08 misst. Ein
 * Bildschirm, der den Vermerk vergisst, gaebe es dann nicht: der Vermerk
 * haengt am Lesen.
 */

export type FreigabeStatus =
  | 'offen' | 'genehmigt' | 'abgelehnt' | 'zurueckgezogen' | 'widerrufen'
  | 'korrigiert' | 'automatisch_freigegeben';

export interface PosteingangEintrag extends PosteingangZeile {
  /**
   * Der Bereich, dem der Vorgang gehoert. Im Mandanten-Scope immer der aktive;
   * in der Gruppenansicht der Weg zur Entscheidung — dort wird nur gelesen,
   * gehandelt wird im Bereich (Invariante 10, SEITENKARTE §6).
   */
  readonly mandantId: string;
  readonly mandantSlug: string;
  readonly mandantName: string;
  readonly titel: string;
  readonly zusammenfassung: string;
  readonly vorgangTyp: VorgangTyp;
  readonly aktion: string;
  readonly unsichereFelder: number;
  readonly stapelFaehig: boolean;
  /** Warum diese Zeile NICHT in den Stapel darf — der Satz steht in der Liste. */
  readonly stapelSperreGrund: string | null;
  readonly dringlichkeit: Dringlichkeit;
  readonly dringlichkeitText: string;
  readonly sortSchluessel: string;
}

interface PosteingangRoh {
  readonly id: string;
  readonly mandant_id: string;
  readonly mandant_slug: string;
  readonly mandant_name: string;
  readonly titel: string;
  readonly zusammenfassung: string;
  readonly vorgang_typ: string;
  readonly aktion: string;
  readonly risiko: string;
  readonly frist: Date | null;
  readonly betrag_cent: string | null;
  readonly erstellt_am: Date;
  readonly unsichere_felder_anzahl: number;
  readonly stapel_faehig: boolean;
  readonly stapel_sperre_grund: string | null;
}

/**
 * Der Posteingang: alles, was WARTET und VORZEIGBAR ist (`vorgang_typ`
 * gesetzt, D-468) — sortiert nach Frist, Risiko, Betrag, Alter.
 */
export async function ladePosteingang(
  kontext: LeseKontext, jetzt: Date,
): Promise<readonly PosteingangEintrag[]> {
  const roh = await kontext.abfrage<PosteingangRoh>(
    `select f.id, f.mandant_id, m.slug as mandant_slug, m.name as mandant_name,
            f.titel, f.zusammenfassung, f.vorgang_typ::text as vorgang_typ,
            f.aktion, f.risiko::text as risiko, f.frist, f.betrag_cent::text as betrag_cent,
            f.erstellt_am, f.unsichere_felder_anzahl, f.stapel_faehig, f.stapel_sperre_grund
       from freigabe f
       join mandant m on m.id = f.mandant_id
      where f.status = 'offen' and f.vorgang_typ is not null
      order by f.frist nulls last, f.risiko desc, f.erstellt_am
      limit 500`);
  const zeilen = roh.map((z) => ({
    id: z.id,
    mandantId: z.mandant_id,
    mandantSlug: z.mandant_slug,
    mandantName: z.mandant_name,
    titel: z.titel,
    zusammenfassung: z.zusammenfassung,
    vorgangTyp: z.vorgang_typ as VorgangTyp,
    aktion: z.aktion,
    risiko: z.risiko as Risiko,
    frist: z.frist,
    betragCent: z.betrag_cent === null ? null : cent(BigInt(z.betrag_cent)),
    erstelltAm: z.erstellt_am,
    unsichereFelder: z.unsichere_felder_anzahl,
    stapelFaehig: z.stapel_faehig,
    stapelSperreGrund: z.stapel_sperre_grund,
  }));
  return sortierePosteingang(zeilen, jetzt).map((z) => {
    const stufe = dringlichkeit(z.frist, jetzt);
    return {
      ...z,
      dringlichkeit: stufe,
      dringlichkeitText: dringlichkeitText(stufe),
      sortSchluessel: sortSchluessel(z, jetzt),
    };
  });
}

export interface FreigabeKopf {
  readonly id: string;
  readonly titel: string | null;
  readonly zusammenfassung: string | null;
  readonly vorgangTyp: VorgangTyp | null;
  readonly aktion: string;
  readonly status: FreigabeStatus;
  /** APR-05: läuft ein Einspruchsfenster, und bis wann? */
  readonly verzoegertBis: Date | null;
  /** APR-06: läuft ein Rücknahmefenster, und bis wann? */
  readonly undoBis: Date | null;
  readonly ausfuehrungStatus: string;
  readonly risiko: Risiko | null;
  readonly risikoPunkte: number | null;
  readonly frist: Date | null;
  readonly betragCent: Cent | null;
  readonly erstelltAm: Date;
  readonly unsichereFelder: number;
  readonly minKonfidenz: string | null;
  readonly stapelFaehig: boolean;
  readonly stapelSperreGrund: string | null;
  readonly erforderlichesRecht: string | null;
  readonly bezugTyp: string | null;
  readonly bezugId: string | null;
  readonly richtlinieId: string | null;
  readonly freigegebenVon: string | null;
  readonly freigegebenVonName: string | null;
  readonly freigegebenAm: Date | null;
  readonly begruendung: string | null;
  readonly payloadHash: string | null;
  readonly ersetztDurch: string | null;
}

export interface FeldNachweis {
  readonly id: string;
  readonly feldPfad: string;
  readonly bezeichnung: string;
  readonly wertVorher: string | null;
  readonly wertNachher: string | null;
  /** Die Zeichenkette der Datenbank (`numeric(4,3)`), nie eine Gleitkommazahl. */
  readonly konfidenz: string | null;
  readonly unsicher: boolean;
  readonly grund: string | null;
  readonly quelle: {
    readonly dokumentId: string | null;
    readonly dokumentTitel: string | null;
    readonly seite: number | null;
    readonly tabelle: string | null;
    readonly zelle: string | null;
    readonly zitat: string | null;
  };
  readonly extraktionModell: string | null;
}

export interface Schnappschuss {
  readonly id: string;
  readonly ketteNr: bigint;
  readonly hash: string;
  readonly art: string;
  readonly entschiedenAm: Date;
  readonly entschiedenVon: string | null;
  readonly rolle: string | null;
  readonly begruendung: string | null;
  readonly codeVersion: string | null;
}

export interface FreigabeAnsicht {
  readonly freigabe: FreigabeKopf;
  readonly diff: Diff | null;
  /**
   * `freigabe.diff`, wie es in der Datenbank steht. Die Entscheidung reicht
   * GENAU diese Bytes weiter (kanonisiert), nicht eine Neuschreibung aus
   * `diff` — sonst kaeme der Waechter, der den Schnappschuss nachrechnet, an
   * anderen Bytes an als die Entscheidung.
   */
  readonly diffRoh: unknown;
  readonly felder: readonly FeldNachweis[];
  /** `vorschau_payload`, wie sie in der Datenbank steht — die Nutzlast der Entscheidung. */
  readonly vorschau: unknown;
  readonly risiko: Risiko | null;
  /** APR-04: stapelfaehig UND ohne unsichere Felder — vom Server bestimmt. */
  readonly routineFaehig: boolean;
  readonly schnappschuss: Schnappschuss | null;
}

interface KopfRoh {
  readonly id: string;
  readonly titel: string | null;
  readonly zusammenfassung: string | null;
  readonly vorgang_typ: string | null;
  readonly aktion: string;
  readonly status: string;
  readonly verzoegerte_freigabe_bis: Date | null;
  readonly undo_bis: Date | null;
  readonly ausfuehrung_status: string;
  readonly risiko: string | null;
  readonly risiko_punkte: number | null;
  readonly frist: Date | null;
  readonly betrag_cent: string | null;
  readonly erstellt_am: Date;
  readonly unsichere_felder_anzahl: number;
  readonly min_konfidenz: string | null;
  readonly stapel_faehig: boolean;
  readonly stapel_sperre_grund: string | null;
  readonly erforderliches_recht: string | null;
  readonly bezug_typ: string | null;
  readonly bezug_id: string | null;
  readonly richtlinie_id: string | null;
  readonly freigegeben_von: string | null;
  readonly freigegeben_von_name: string | null;
  readonly freigegeben_am: Date | null;
  readonly begruendung: string | null;
  readonly payload_hash: string | null;
  readonly ersetzt_durch_freigabe_id: string | null;
  readonly diff: unknown;
  readonly vorschau_payload: unknown;
}

interface FeldRoh {
  readonly id: string;
  readonly feld_pfad: string;
  readonly bezeichnung: string;
  readonly wert_vorher: string | null;
  readonly wert_nachher: string | null;
  readonly konfidenz: string | null;
  readonly unsicher: boolean;
  readonly grund: string | null;
  readonly quelle_dokument_id: string | null;
  readonly quelle_dokument_titel: string | null;
  readonly quelle_seite: number | null;
  readonly quelle_tabelle: string | null;
  readonly quelle_zelle: string | null;
  readonly quelle_zitat: string | null;
  readonly extraktion_modell: string | null;
}

interface SchnappschussRoh {
  readonly id: string;
  readonly kette_nr: string;
  readonly hash: string;
  readonly art: string;
  readonly entschieden_am: Date;
  readonly entschieden_von: string | null;
  readonly rolle: string | null;
  readonly begruendung: string | null;
  readonly code_version: string | null;
}

/** Eine Freigabe mit Diff, Nachweisen und — wenn entschieden — ihrem Schnappschuss. */
export async function ladeFreigabe(
  kontext: LeseKontext, id: string,
): Promise<FreigabeAnsicht | null> {
  const [k] = await kontext.abfrage<KopfRoh>(
    `select f.id, f.titel, f.zusammenfassung, f.vorgang_typ::text as vorgang_typ, f.aktion,
            f.status::text as status, f.verzoegerte_freigabe_bis, f.undo_bis,
            f.ausfuehrung_status::text as ausfuehrung_status,
            f.risiko::text as risiko, f.risiko_punkte, f.frist,
            f.betrag_cent::text as betrag_cent, f.erstellt_am, f.unsichere_felder_anzahl,
            f.min_konfidenz::text as min_konfidenz, f.stapel_faehig, f.stapel_sperre_grund,
            f.erforderliches_recht, f.bezug_typ, f.bezug_id, f.richtlinie_id,
            f.freigegeben_von, b.name as freigegeben_von_name, f.freigegeben_am,
            f.begruendung, f.payload_hash, f.ersetzt_durch_freigabe_id,
            f.diff, f.vorschau_payload
       from freigabe f
       left join benutzer b on b.id = f.freigegeben_von
      where f.id = $1`,
    [id]);
  if (k === undefined) return null;

  const felder = await kontext.abfrage<FeldRoh>(
    `select ff.id, ff.feld_pfad, ff.bezeichnung, ff.wert_vorher, ff.wert_nachher,
            ff.konfidenz::text as konfidenz, ff.unsicher, ff.grund,
            ff.quelle_dokument_id, d.titel as quelle_dokument_titel,
            ff.quelle_seite, ff.quelle_tabelle, ff.quelle_zelle, ff.quelle_zitat,
            ff.extraktion_modell
       from freigabe_feld ff
       left join dokument d on d.id = ff.quelle_dokument_id and d.mandant_id = ff.mandant_id
      where ff.freigabe_id = $1
      order by ff.feld_pfad`,
    [id]);

  /*
   * `pruefdauer_sek` steht NICHT in dieser Liste — `cse_app` haelt kein
   * Spaltenrecht darauf (0137 §2, D-470), und ein `select *` fiele daran.
   */
  const [s] = await kontext.abfrage<SchnappschussRoh>(
    `select s.id, s.kette_nr::text as kette_nr, s.hash, s.art::text as art, s.entschieden_am,
            s.entschieden_von, s.rolle, s.begruendung, s.code_version
       from freigabe_snapshot s
      where s.freigabe_id = $1
        and s.art in ('genehmigt', 'abgelehnt', 'automatisch_nach_frist')
      order by s.kette_nr desc
      limit 1`,
    [id]);

  const freigabe: FreigabeKopf = {
    id: k.id,
    titel: k.titel,
    zusammenfassung: k.zusammenfassung,
    vorgangTyp: k.vorgang_typ as VorgangTyp | null,
    aktion: k.aktion,
    status: k.status as FreigabeStatus,
    verzoegertBis: k.verzoegerte_freigabe_bis,
    undoBis: k.undo_bis,
    ausfuehrungStatus: k.ausfuehrung_status,
    risiko: k.risiko as Risiko | null,
    risikoPunkte: k.risiko_punkte,
    frist: k.frist,
    betragCent: k.betrag_cent === null ? null : cent(BigInt(k.betrag_cent)),
    erstelltAm: k.erstellt_am,
    unsichereFelder: k.unsichere_felder_anzahl,
    minKonfidenz: k.min_konfidenz,
    stapelFaehig: k.stapel_faehig,
    stapelSperreGrund: k.stapel_sperre_grund,
    erforderlichesRecht: k.erforderliches_recht,
    bezugTyp: k.bezug_typ,
    bezugId: k.bezug_id,
    richtlinieId: k.richtlinie_id,
    freigegebenVon: k.freigegeben_von,
    freigegebenVonName: k.freigegeben_von_name,
    freigegebenAm: k.freigegeben_am,
    begruendung: k.begruendung,
    payloadHash: k.payload_hash,
    ersetztDurch: k.ersetzt_durch_freigabe_id,
  };

  return {
    freigabe,
    diff: diffAusJson(k.diff),
    diffRoh: k.diff,
    felder: felder.map((f) => ({
      id: f.id,
      feldPfad: f.feld_pfad,
      bezeichnung: f.bezeichnung,
      wertVorher: f.wert_vorher,
      wertNachher: f.wert_nachher,
      konfidenz: f.konfidenz,
      unsicher: f.unsicher,
      grund: f.grund,
      quelle: {
        dokumentId: f.quelle_dokument_id,
        dokumentTitel: f.quelle_dokument_titel,
        seite: f.quelle_seite,
        tabelle: f.quelle_tabelle,
        zelle: f.quelle_zelle,
        zitat: f.quelle_zitat,
      },
      extraktionModell: f.extraktion_modell,
    })),
    vorschau: k.vorschau_payload,
    risiko: freigabe.risiko,
    routineFaehig: freigabe.stapelFaehig && freigabe.unsichereFelder === 0,
    schnappschuss: s === undefined ? null : {
      id: s.id,
      ketteNr: BigInt(s.kette_nr),
      hash: s.hash,
      art: s.art,
      entschiedenAm: s.entschieden_am,
      entschiedenVon: s.entschieden_von,
      rolle: s.rolle,
      begruendung: s.begruendung,
      codeVersion: s.code_version,
    },
  };
}

/**
 * Der Vermerk „geoeffnet" — `geoeffnet_am_server` setzt die Datenbank, was
 * hier steht, ist nur WER und WORUEBER (K-13). Anfuegend: jedes Oeffnen ist
 * eine Zeile.
 */
export async function vermerkeAnsicht(
  kontext: SchreibKontext, freigabeId: string, kanal: 'web' | 'mobil',
): Promise<void> {
  await kontext.schreibe(
    `insert into freigabe_ansicht (mandant_id, freigabe_id, benutzer_id, kanal)
     values ($1, $2, $3, $4)`,
    [kontext.aktiverMandantId, freigabeId, kontext.benutzerId, kanal]);
}

/**
 * Lesen UND vermerken — der eine Weg fuer den Bildschirm und fuer
 * `GET /api/freigaben/[id]`. Vermerkt wird nur, was noch wartet: das Oeffnen
 * einer entschiedenen Freigabe ist Nachlesen, keine Pruefung.
 */
export async function oeffneFreigabe(
  kontext: SchreibKontext, id: string, kanal: 'web' | 'mobil',
): Promise<FreigabeAnsicht | null> {
  const ansicht = await ladeFreigabe(kontext, id);
  if (ansicht === null) return null;
  if (ansicht.freigabe.status === 'offen') await vermerkeAnsicht(kontext, id, kanal);
  return ansicht;
}
