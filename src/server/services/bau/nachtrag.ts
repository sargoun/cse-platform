/**
 * Der Nachtrag nach § 2 VOB/B (BAU-04, BAU-05, 03-GEWERKE §7.10).
 *
 * Der Dienst tut drei Dinge und keines davon nebenbei:
 *
 *  1. **Er haelt Anmeldung und Einreichung auseinander.** `angemeldet_am` ist
 *     die Ankuendigung VOR Ausfuehrungsbeginn (§ 2 Abs. 6 Nr. 1 VOB/B) — sie
 *     entscheidet ueber den Anspruch. `eingereicht_am` ist die Uebergabe der
 *     Kalkulation — sie entscheidet ueber die Faelligkeit. Zwei Spalten, zwei
 *     Rechte (`bau.nachtrag_anmelden` / `bau.nachtrag_einreichen`), zwei
 *     Anzeigen. Wer beides in ein Feld legt, kann im Streit nicht mehr
 *     belegen, dass angekuendigt wurde, bevor gebaut wurde.
 *  2. **Er verlangt die Anspruchsgrundlage als AUSWAHL.** Sie kommt aus
 *     `nachtrag_grundlage` (K-17) und hat keinen Vorgabewert: eine
 *     vorbelegte Grundlage waere eine Rechtsfolge, die niemand gewaehlt hat.
 *     Solange O-23 offen ist, traegt jede Katalogzeile `ist_platzhalter`, und
 *     die Oberflaeche zeigt daneben die Pille „Unbestaetigter Wert".
 *  3. **Er stellt die Wachabfrage bereit, nicht den Job.** „Angemeldet, nach
 *     14 Tagen nicht eingereicht" ist eine SPEC-§14-Wache; der Lauf kommt mit
 *     PR 82. Die Abfrage steht hier, weil sie eine fachliche Aussage ist und
 *     kein Zeitplan — und weil sie EINMAL meldet: `ueberfaellig_gemeldet_am`
 *     ist ihr Gedaechtnis.
 *
 * **Was dieser Dienst NICHT tut: bepreisen.** `betrag_netto_cent` und
 * `beauftragter_betrag_netto_cent` sind fuer `cse_app` nicht einmal lesbar
 * (Spalten-GRANT, K-05); die Nachtragskalkulation ist PR 48.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { gate, type Freigabe, type Nutzlast } from '../../agent/policy.js';

/** `nachtrag_status` (03-GEWERKE §3.3). */
export type NachtragStatus =
  | 'angemeldet' | 'kalkuliert' | 'eingereicht' | 'beauftragt'
  | 'abgelehnt' | 'zurueckgezogen';

/** `nachtrag_anordnung_form` — `muendlich` ist ein Risikomerkmal. */
export type AnordnungForm = 'schriftlich' | 'muendlich' | 'e_mail' | 'unbekannt';

/**
 * Die SPEC-§14-Frist: angemeldet, nach 14 Tagen nicht eingereicht.
 *
 * Eine Konstante und keine Einstellung: SPEC §14 nennt die Zahl, sie ist
 * also nicht offen, und eine je Mandant verstellbare Frist waere die, die
 * irgendwann auf 90 steht, weil die Wache jemanden gestoert hat.
 */
export const NACHTRAG_WACHFRIST_TAGE = 14;

export class NachtragFehler extends Error {
  readonly status = 409 as const;
  constructor(
    readonly grund:
      | 'nicht_gefunden' | 'grundlage_fehlt' | 'bereits_angemeldet'
      | 'bereits_eingereicht' | 'nicht_anmeldbar' | 'ohne_freigabe' | 'ohne_anmeldung',
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'NachtragFehler';
  }
}

/* ---------------------------------------------------------------------------
 * 1. Der Katalog der Anspruchsgrundlagen (K-17)
 * ------------------------------------------------------------------------ */

export interface GrundlageZeile {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly fundstelle: string;
  readonly beschreibung: string;
  /** § 2 Abs. 6 Nr. 1 VOB/B: Ankuendigung vor Ausfuehrungsbeginn. */
  readonly ankuendigung_erforderlich: boolean;
  /** §1.16: unbestaetigt, solange O-23 offen ist. */
  readonly ist_platzhalter: boolean;
}

export async function ladeGrundlagen(
  kontext: LeseKontext,
): Promise<readonly GrundlageZeile[]> {
  return kontext.abfrage<GrundlageZeile>(
    `select g.id, g.schluessel, g.bezeichnung, g.fundstelle, g.beschreibung,
            g.ankuendigung_erforderlich, g.ist_platzhalter
       from nachtrag_grundlage g
      where g.archiviert_am is null
      order by g.reihenfolge, g.schluessel`,
  );
}

/**
 * Die Auswahl ist PFLICHT, und zwar hier und nicht erst in der Datenbank.
 *
 * `grundlage_id` ist `not null` und traegt einen Fremdschluessel — die harte
 * Kante steht also. Diese Pruefung existiert fuer den MENSCHEN: ein
 * Formular, das ohne Auswahl abgeschickt wird, soll einen deutschen Satz
 * zurueckbekommen und keinen Fremdschluesselfehler. Und sie nimmt der
 * Oberflaeche die Versuchung, „die erste Zeile" vorzubelegen.
 */
export function pruefeGrundlage(grundlageId: string | null | undefined): string {
  const wert = (grundlageId ?? '').trim();
  if (wert === '') {
    throw new NachtragFehler(
      'grundlage_fehlt',
      'Die Anspruchsgrundlage nach § 2 VOB/B ist eine Pflichtauswahl — sie wird '
      + 'gewählt, nie vorbelegt und nie frei eingegeben.',
    );
  }
  return wert;
}

/* ---------------------------------------------------------------------------
 * 2. Lesen
 * ------------------------------------------------------------------------ */

export interface NachtragZeile {
  readonly id: string;
  readonly nummer: string;
  readonly titel: string;
  readonly status: NachtragStatus;
  readonly projekt_id: string;
  readonly projekt: string;
  readonly projekt_nummer: string;
  readonly grundlage: string;
  readonly grundlage_fundstelle: string;
  readonly grundlage_platzhalter: boolean;
  readonly begruendung: string;
  /** `YYYY-MM-DD`, fuer Formularfelder. */
  readonly angemeldet_am: string | null;
  readonly eingereicht_am: string | null;
  /** `DD.MM.YYYY`, fertig aus der Datenbank (Invariante 2). */
  readonly angemeldet_lokal: string | null;
  readonly eingereicht_lokal: string | null;
  readonly beauftragt_lokal: string | null;
  readonly anordnung_form: AnordnungForm;
  readonly angeordnet_von: string | null;
  readonly ausgefuehrt_ohne_beauftragung: boolean;
  readonly freigabe_id: string | null;
  /** Wie viele Tage die Anmeldung schon offen ist — NULL, wenn eingereicht. */
  readonly offen_seit_tagen: number | null;
  readonly ueberfaellig: boolean;
  readonly storniert: boolean;
}

const NACHTRAG_SPALTEN = `
  n.id, n.nummer, n.titel, n.status::text as status,
  n.projekt_id, p.bezeichnung as projekt, p.nummer as projekt_nummer,
  g.bezeichnung as grundlage, g.fundstelle as grundlage_fundstelle,
  g.ist_platzhalter as grundlage_platzhalter,
  n.begruendung,
  to_char(n.angemeldet_am, 'YYYY-MM-DD') as angemeldet_am,
  to_char(n.eingereicht_am, 'YYYY-MM-DD') as eingereicht_am,
  to_char(n.angemeldet_am, 'DD.MM.YYYY') as angemeldet_lokal,
  to_char(n.eingereicht_am, 'DD.MM.YYYY') as eingereicht_lokal,
  to_char(n.beauftragt_am, 'DD.MM.YYYY') as beauftragt_lokal,
  n.anordnung_form::text as anordnung_form, n.angeordnet_von,
  n.ausgefuehrt_ohne_beauftragung, n.freigabe_id,
  case when n.eingereicht_am is null and n.angemeldet_am is not null
       then (app.berlin_heute() - n.angemeldet_am)::int end as offen_seit_tagen,
  (n.eingereicht_am is null and n.angemeldet_am is not null
   and n.status = 'angemeldet' and n.storniert_am is null
   and n.angemeldet_am <= app.berlin_heute() - $WACHFRIST) as ueberfaellig,
  (n.storniert_am is not null) as storniert`;

/**
 * Die Nachtraege — je Projekt oder ueber alle, wahlweise nur die offenen.
 *
 * **Die Tagesdifferenz rechnet Postgres**, gegen `app.berlin_heute()`: der
 * Kalendertag ist der BERLINER (K-11), und ein Node-Prozess in UTC saehe um
 * 00:30 Berliner Zeit noch den Vortag — die Wachfrist waere dann einen Tag
 * zu lang, jede Nacht.
 */
export async function listeNachtraege(
  kontext: LeseKontext,
  filter: {
    readonly projektId?: string | null;
    /** Nur angemeldet-und-nicht-eingereicht (die BAU-04-Ansicht). */
    readonly nurOffen?: boolean;
  } = {},
): Promise<readonly NachtragZeile[]> {
  return kontext.abfrage<NachtragZeile>(
    `select ${NACHTRAG_SPALTEN.replace('$WACHFRIST', String(NACHTRAG_WACHFRIST_TAGE))}
       from nachtrag n
       join projekt p on p.id = n.projekt_id and p.mandant_id = n.mandant_id
       join nachtrag_grundlage g on g.id = n.grundlage_id and g.mandant_id = n.mandant_id
      where ($1::uuid is null or n.projekt_id = $1::uuid)
        and (not $2::boolean
             or (n.status = 'angemeldet' and n.eingereicht_am is null
                 and n.storniert_am is null))
      order by n.angemeldet_am desc nulls last, n.nummer desc`,
    [filter.projektId ?? null, filter.nurOffen === true],
  );
}

export async function findeNachtrag(
  kontext: LeseKontext, id: string,
): Promise<NachtragZeile | null> {
  const [zeile] = await kontext.abfrage<NachtragZeile>(
    `select ${NACHTRAG_SPALTEN.replace('$WACHFRIST', String(NACHTRAG_WACHFRIST_TAGE))}
       from nachtrag n
       join projekt p on p.id = n.projekt_id and p.mandant_id = n.mandant_id
       join nachtrag_grundlage g on g.id = n.grundlage_id and g.mandant_id = n.mandant_id
      where n.id = $1`,
    [id],
  );
  return zeile ?? null;
}

/* ---------------------------------------------------------------------------
 * 3. Anmelden — § 2 Abs. 6 Nr. 1 VOB/B
 * ------------------------------------------------------------------------ */

export interface NachtragEingabe {
  readonly projektId: string;
  readonly titel: string;
  readonly grundlageId: string;
  readonly begruendung: string;
  /** Berliner Kalendertag `YYYY-MM-DD`; `null` = noch nicht angemeldet. */
  readonly angemeldetAm: string | null;
  readonly anordnungForm?: AnordnungForm;
  readonly angeordnetVon?: string | null;
  readonly ausgefuehrtOhneBeauftragung?: boolean;
  readonly auftragLeistungId?: string | null;
}

/**
 * Legt den Nachtrag an — im Zustand `angemeldet`, MIT Anspruchsgrundlage.
 *
 * `auftrag_id` kommt aus dem Projekt und nicht vom Aufrufer: das Projekt IST
 * der Auftrag (§7.1), und ein mitgeschickter Auftrag waere die Gelegenheit,
 * einen Nachtrag an einen fremden Vorgang zu haengen.
 *
 * Die Nummer entsteht je Projekt fortlaufend aus dem, was schon da ist — wie
 * beim Aufmassblatt und aus demselben Grund: sie ordnet, sie beweist nichts,
 * und eine Luecke darin hat keine steuerliche Bedeutung (§ 14 UStG gilt der
 * Rechnungsnummer, nicht dieser).
 */
export async function meldeNachtragAn(
  kontext: SchreibKontext, eingabe: NachtragEingabe,
): Promise<{ readonly id: string; readonly nummer: string }> {
  const grundlageId = pruefeGrundlage(eingabe.grundlageId);
  if (eingabe.titel.trim() === '') {
    throw new NachtragFehler('nicht_anmeldbar', 'Der Nachtrag braucht einen Titel.');
  }
  if (eingabe.begruendung.trim() === '') {
    throw new NachtragFehler(
      'nicht_anmeldbar',
      'Der Nachtrag braucht eine Begründung — sie ist im § 2-Streit das Erste, '
      + 'wonach gefragt wird.',
    );
  }

  const [kopf] = await kontext.schreibe<{ id: string; nummer: string }>(
    `insert into nachtrag (mandant_id, projekt_id, auftrag_id, auftrag_leistung_id,
                           nummer, titel, grundlage_id, begruendung, status,
                           angemeldet_am, anordnung_form, angeordnet_von,
                           ausgefuehrt_ohne_beauftragung, erstellt_von)
     select $1, p.id, p.auftrag_id, $9::uuid,
            'N' || lpad((coalesce(
              (select max(nullif(regexp_replace(n2.nummer, '\\D', '', 'g'), '')::bigint)
                 from nachtrag n2 where n2.projekt_id = p.id), 0) + 1)::text, 3, '0'),
            $3, $4::uuid, $5, 'angemeldet', $6::date,
            $7::nachtrag_anordnung_form, $8, $10, app.aktueller_benutzer()
       from projekt p
      where p.id = $2 and p.mandant_id = $1
     returning id, nummer`,
    [
      kontext.aktiverMandantId, eingabe.projektId, eingabe.titel.trim(), grundlageId,
      eingabe.begruendung.trim(), eingabe.angemeldetAm,
      eingabe.anordnungForm ?? 'unbekannt',
      eingabe.angeordnetVon === undefined || eingabe.angeordnetVon === ''
        ? null : eingabe.angeordnetVon,
      eingabe.auftragLeistungId ?? null,
      eingabe.ausgefuehrtOhneBeauftragung === true,
    ],
  );
  if (kopf === undefined) {
    // AUT-06: ein fremdes Projekt ist nicht vorhanden, nicht verboten.
    throw new NachtragFehler('nicht_gefunden', 'Projekt nicht gefunden.');
  }
  return kopf;
}

/**
 * Traegt die Ankuendigung nach — fuer den Fall, dass sie beim Anlegen fehlte.
 *
 * **Write-once.** Ein bereits gesetztes Anmeldedatum wird nicht verschoben:
 * es ist genau die Angabe, ueber die im § 2-Abs.-6-Streit gestritten wird,
 * und ein nachtraeglich vorverlegtes Datum waere in einem auditierten
 * Datensatz kein Versehen mehr.
 */
export async function traegeAnmeldungNach(
  kontext: SchreibKontext, id: string, angemeldetAm: string,
): Promise<void> {
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `update nachtrag
        set angemeldet_am = $2::date, geaendert_von = app.aktueller_benutzer()
      where id = $1 and angemeldet_am is null and storniert_am is null
     returning id`,
    [id, angemeldetAm],
  );
  if (zeile === undefined) {
    throw new NachtragFehler(
      'bereits_angemeldet',
      'Dieser Nachtrag trägt bereits ein Anmeldedatum. Es wird nicht verschoben — '
      + 'die Ankündigung ist das, worüber im Streit um § 2 Abs. 6 VOB/B gestritten wird.',
    );
  }
}

/**
 * Die Einreichung — der Uebergang, an dem etwas das Haus verlaesst.
 *
 * **Invariante 7 ist hier eine Bedingung, keine Absprache.** Ohne
 * `freigabeId` ist der Zustand `eingereicht` in der Datenbank nicht
 * darstellbar (`nachtrag_eingereicht_freigegeben`); die Pruefung hier ist die
 * lesbare erste Linie.
 *
 * **Ohne Anmeldung keine Einreichung.** Nicht Formalismus: § 2 Abs. 6 Nr. 1
 * VOB/B knuepft den Anspruch an die Ankuendigung, und ein eingereichter
 * Nachtrag ohne sie sagt dem Auftraggeber, es habe keine gegeben.
 */
/**
 * Die Nutzlast, ueber die die Freigabe erteilt wird — und ihr Hash ist die
 * Bindung.
 *
 * Was hier hineingeht, entscheidet, was eine Freigabe deckt. Nummer, Projekt,
 * Titel und Begruendung stehen drin, weil genau sie den Nachtrag ausmachen:
 * wer nach der Freigabe die Begruendung umschreibt, hat einen anderen
 * Nachtrag, und die Freigabe gilt dafuer nicht mehr.
 *
 * **Der Betrag steht NICHT drin** — nicht aus Nachlaessigkeit: `cse_app` darf
 * `betrag_netto_cent` gar nicht lesen (K-05, siehe Kopfkommentar). Ihn hier
 * aufzunehmen hiesse, ihn aus einer Rolle heraus zu lesen, der er entzogen
 * ist. Die Bindung traegt stattdessen die Kennung des Nachtrags, und die ist
 * eindeutig.
 */
export function nachtragNutzlast(mandantId: string, zeile: NachtragZeile): Nutzlast {
  return {
    aktion: 'nachtrag_einreichen',
    mandantId,
    inhalt: {
      nachtrag_id: zeile.id,
      nummer: zeile.nummer,
      titel: zeile.titel,
      projekt: `${zeile.projekt_nummer} · ${zeile.projekt}`,
      grundlage: zeile.grundlage,
      grundlage_fundstelle: zeile.grundlage_fundstelle,
      begruendung: zeile.begruendung,
    },
  };
}

export async function reicheEin(
  kontext: SchreibKontext,
  eingabe: {
    readonly id: string;
    readonly eingereichtAm: string;
    readonly freigabeId: string;
  },
): Promise<void> {
  const vorher = await findeNachtrag(kontext, eingabe.id);
  if (vorher === null) throw new NachtragFehler('nicht_gefunden', 'Nachtrag nicht gefunden.');
  if (vorher.eingereicht_am !== null) {
    throw new NachtragFehler(
      'bereits_eingereicht',
      `Dieser Nachtrag ist am ${vorher.eingereicht_lokal ?? ''} eingereicht worden. `
      + 'Eine Änderung ist ein neuer Nachtrag, keine zweite Einreichung.',
    );
  }
  if (vorher.angemeldet_am === null) {
    throw new NachtragFehler(
      'ohne_anmeldung',
      'Der Nachtrag ist nicht angemeldet. § 2 Abs. 6 Nr. 1 VOB/B verlangt die '
      + 'Ankündigung vor Ausführungsbeginn — ohne sie wird nichts eingereicht.',
    );
  }
  if (eingabe.freigabeId.trim() === '') {
    throw new NachtragFehler(
      'ohne_freigabe',
      'Die Einreichung geht an den Auftraggeber und verlangt eine menschliche '
      + 'Freigabe (Invariante 7, APR-07).',
    );
  }

  /**
   * **Durch DASSELBE Tor wie alles andere, was hinausgeht.**
   *
   * Hier stand ein blosser `update … from freigabe f where f.status =
   * 'genehmigt' and f.freigegeben_von is not null`. Geprueft wurde damit nur,
   * DASS irgendein Mensch irgendetwas genehmigt hat — nicht, dass er DIESEN
   * Nachtrag genehmigt hat, und nicht einmal, dass die Freigabe ueberhaupt
   * eine Einreichung meinte.
   *
   * Konkret hiess das: eine Freigabe fuer ein Angebot, erteilt am Vortag,
   * reichte aus, um einen beliebigen Nachtrag einzureichen — beliebig oft,
   * denn verbraucht wurde sie auch nicht. Invariante 7 sagt „nichts verlaesst
   * das System ohne menschliche Freigabe"; eine Freigabe fuer etwas anderes
   * ist keine.
   *
   * `gate()` prueft die Bindung, die zaehlt: Aktion UND Nutzlast-Hash. Der
   * Hash traegt Nummer, Projekt, Betrag und Begruendung — wer den Nachtrag
   * nach der Freigabe aendert, bekommt einen anderen Hash und damit eine
   * abgelaufene Freigabe. Genau denselben Weg nimmt die Behinderungsanzeige
   * (BAU-06).
   */
  const [freigabeZeile] = await kontext.abfrage<{
    id: string; aktion: string; status: string; freigegeben_von: string | null;
    nutzlast_hash: string | null;
  }>(
    `select f.id, f.aktion, f.status::text as status, f.freigegeben_von,
            (select s.nutzlast_hash from freigabe_snapshot s
              where s.freigabe_id = f.id and s.mandant_id = f.mandant_id
              order by s.kette_nr desc limit 1) as nutzlast_hash
       from freigabe f
      where f.id = $1::uuid and f.mandant_id = $2::uuid`,
    [eingabe.freigabeId, kontext.aktiverMandantId],
  );

  const [richtlinieZeile] = await kontext.abfrage<{
    auto_erlaubt: boolean; max_betrag_cent: string | null; ist_aktiv: boolean;
  }>(
    `select auto_erlaubt, max_betrag_cent::text as max_betrag_cent, ist_aktiv
       from agent_richtlinie
      where mandant_id = $1::uuid and aktion = 'nachtrag_einreichen'`,
    [kontext.aktiverMandantId],
  );

  const entscheidung = gate(
    nachtragNutzlast(kontext.aktiverMandantId, vorher),
    freigabeZeile === undefined ? null : {
      id: freigabeZeile.id,
      aktion: freigabeZeile.aktion as Freigabe['aktion'],
      mandantId: kontext.aktiverMandantId,
      status: freigabeZeile.status as Freigabe['status'],
      freigegebenVon: freigabeZeile.freigegeben_von,
      nutzlastHash: freigabeZeile.nutzlast_hash ?? '',
    },
    richtlinieZeile === undefined ? null : {
      mandantId: kontext.aktiverMandantId,
      aktion: 'nachtrag_einreichen',
      autoErlaubt: richtlinieZeile.auto_erlaubt,
      maxBetragCent: richtlinieZeile.max_betrag_cent === null
        ? null : BigInt(richtlinieZeile.max_betrag_cent),
      ist_aktiv: richtlinieZeile.ist_aktiv,
    },
  );
  // Der Fehler des Tors WOERTLICH weiter: er sagt, was fehlt.
  if (!entscheidung.erlaubt) throw entscheidung.fehler;

  await kontext.schreibe(
    `update nachtrag
        set status = 'eingereicht', eingereicht_am = $2::date, freigabe_id = $3::uuid,
            freigegeben_am = f.freigegeben_am, freigegeben_von = f.freigegeben_von,
            geaendert_von = app.aktueller_benutzer()
       from freigabe f
      where nachtrag.id = $1 and f.id = $3::uuid
        and f.mandant_id = nachtrag.mandant_id
        and f.status = 'genehmigt' and f.freigegeben_von is not null`,
    [eingabe.id, eingabe.eingereichtAm, eingabe.freigabeId],
  );

  const danach = await findeNachtrag(kontext, eingabe.id);
  if (danach === null || danach.eingereicht_am === null) {
    throw new NachtragFehler(
      'ohne_freigabe',
      'Zu diesem Nachtrag liegt keine genehmigte Freigabe mit benanntem Menschen vor. '
      + 'Es wurde nichts eingereicht (Invariante 7).',
    );
  }
}

/**
 * Hängt eine Aufmasszeile ausserhalb des LV an den Nachtrag, den die Warnung
 * angeboten hat (BAU-05).
 *
 * **Ohne diesen Weg verschwindet die Warnung nie.** `ladeAusserhalbLv` waehlt
 * genau `ausserhalb_lv and nachtrag_id is null`; ein Nachtrag, der neben der
 * Zeile entsteht, ohne sie zu erfassen, laesst dieselbe Warnung stehen — und
 * eine Warnung, die nach der Abhilfe weiter dasteht, liest nach der dritten
 * Woche niemand mehr.
 *
 * `nachtrag_id` steht bewusst NICHT in `kern.aufmass_zeile_einfrieren()`: ein
 * gegengezeichnetes Blatt ist in Menge, Formel und Bezeichnung unveraenderlich,
 * aber die Zuordnung zu einem Nachtrag entsteht typischerweise SPAETER — der
 * Streit ueber die Vergueetung beginnt, wenn die Menge laengst festgestellt ist.
 * Die Zuordnung wird deshalb nur GESETZT, nie umgehaengt: `nachtrag_id is null`
 * steht in der Bedingung.
 *
 * Der Grosselternschluessel (`az_nachtrag_fk`, 0080) haelt Zeile und Nachtrag
 * im selben Projekt; die Bedingung hier sagt es noch einmal lesbar, damit der
 * Fehlschlag ein deutscher Satz ist und kein Fremdschluesselfehler.
 */
export async function ordneAufmasszeileZu(
  kontext: SchreibKontext,
  eingabe: { readonly zeileId: string; readonly nachtragId: string },
): Promise<void> {
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `update aufmass_zeile z
        set nachtrag_id = $2::uuid, geaendert_von = app.aktueller_benutzer()
       from nachtrag n
      where z.id = $1::uuid
        and n.id = $2::uuid
        and n.mandant_id = z.mandant_id
        and n.projekt_id = z.projekt_id
        and z.ausserhalb_lv
        and z.nachtrag_id is null
     returning z.id`,
    [eingabe.zeileId, eingabe.nachtragId],
  );
  if (zeile === undefined) {
    throw new NachtragFehler(
      'nicht_gefunden',
      'Diese Aufmaßzeile gehört nicht zu diesem Projekt, steht nicht außerhalb des '
      + 'Leistungsverzeichnisses oder hängt bereits an einem Nachtrag. Es wurde nichts '
      + 'umgehängt.',
    );
  }
}

/* ---------------------------------------------------------------------------
 * 4. Die Wache aus SPEC §14 — die ABFRAGE, nicht der Lauf
 * ------------------------------------------------------------------------ */

export interface UeberfaelligerNachtrag {
  readonly id: string;
  readonly nummer: string;
  readonly titel: string;
  readonly projekt_id: string;
  readonly projekt: string;
  readonly angemeldet_lokal: string;
  readonly tage_offen: number;
  /** NOT-03: ohne Ziel gibt es keine Benachrichtigung. */
  readonly ziel: string;
  /** Wer fuer das Projekt verantwortlich ist — der Empfaenger der Meldung. */
  readonly verantwortlich_benutzer_id: string | null;
}

/**
 * „Angemeldet, nach 14 Tagen nicht eingereicht" (SPEC §14, BAU-04).
 *
 * **Sie meldet EINMAL.** `ueberfaellig_gemeldet_am is null` steht in der
 * Abfrage und im Indexpraedikat; wer gemeldet hat, ruft anschliessend
 * `markiereUeberfaelligGemeldet` auf. Ohne dieses Gedaechtnis meldete ein
 * taeglicher Lauf denselben Nachtrag jeden Tag — und eine Wache, die jeden
 * Tag dasselbe sagt, liest nach einer Woche niemand mehr.
 *
 * **Der Stichtag kommt aus der Datenbank** (`app.berlin_heute()`, K-11,
 * Invariante 5): ein Job laeuft irgendwo, und die Uhr dieses Prozesses ist
 * nicht die Wahrheit.
 */
export async function waehleUeberfaelligeNachtraege(
  kontext: LeseKontext,
  fristTage: number = NACHTRAG_WACHFRIST_TAGE,
): Promise<readonly UeberfaelligerNachtrag[]> {
  return kontext.abfrage<UeberfaelligerNachtrag>(
    `select n.id, n.nummer, n.titel, n.projekt_id, p.bezeichnung as projekt,
            to_char(n.angemeldet_am, 'DD.MM.YYYY') as angemeldet_lokal,
            (app.berlin_heute() - n.angemeldet_am)::int as tage_offen,
            '/portal/' || m.slug || '/bau/projekte/' || n.projekt_id::text
              || '/nachtraege/' || n.id::text as ziel,
            p.verantwortlich_benutzer_id
       from nachtrag n
       join projekt p on p.id = n.projekt_id and p.mandant_id = n.mandant_id
       join mandant m on m.id = n.mandant_id
      where n.status = 'angemeldet'
        and n.eingereicht_am is null
        and n.storniert_am is null
        and n.ueberfaellig_gemeldet_am is null
        and n.angemeldet_am is not null
        and n.angemeldet_am <= app.berlin_heute() - $1::int
      order by n.angemeldet_am, n.nummer`,
    [fristTage],
  );
}

/**
 * Setzt das Gedaechtnis der Wache — der Server stempelt, nicht der Aufrufer.
 *
 * Die Bedingung `ueberfaellig_gemeldet_am is null` steht im UPDATE und nicht
 * nur in der Abfrage davor: zwei gleichzeitige Laeufe (ein Wiederholungslauf
 * nach einem Netzfehler ist auch ein Lauf) meldeten sonst beide.
 */
export async function markiereUeberfaelligGemeldet(
  kontext: SchreibKontext, ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update nachtrag set ueberfaellig_gemeldet_am = now()
      where id = any ($1::uuid[]) and ueberfaellig_gemeldet_am is null
     returning id`,
    [ids],
  );
  return zeilen.length;
}
