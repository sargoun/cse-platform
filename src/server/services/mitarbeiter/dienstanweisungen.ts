/**
 * Die eigenen Dienstanweisungen — lesend, ueber alle Beschaeftigungen
 * (EMP-09, EMP-12, SEC-06).
 *
 * **Dieser Dienst SCHREIBT NICHT.** Die Bestaetigung ist ein Schreibweg und
 * gehoert deshalb in den Fachdienst `security/dienstanweisung.ts`, der sein
 * Recht im Dienstregister nennt — genau wie der Zeit-Einwand, der Antrag und
 * die Abwesenheitsmeldung. Ein vierter, hier angelegter Schreibpfad waere der,
 * der an ihnen vorbeifuehrt (K-18).
 *
 * **Was die Wache ueberhaupt sieht, entscheidet die Zeilenpolitik, nicht diese
 * Abfrage.** `t_person` auf `dienstanweisung` und
 * `dienstanweisung_version` oeffnet genau die VEROEFFENTLICHTEN Fassungen der
 * Objekte, auf denen dieser Mensch laufend oder kommend eingesetzt ist
 * (`app.ist_eingesetzt_auf_objekt`, 0069). Ein `where` mit derselben
 * Bedingung waere eine zweite Fassung derselben Regel — und die erste
 * Abweichung zwischen beiden faellt niemandem auf.
 *
 * **Eine mandantenweite Anweisung ohne Objekt ist hier deshalb NICHT
 * sichtbar**, und das ist die Entscheidung von 0078 §12: die Decke traegt
 * `app.ist_eingesetzt_auf_objekt(objekt_id)`, und das Praedikat ist fuer NULL
 * ausdruecklich `false`. Eine Rahmenanweisung erreicht die Belegschaft heute
 * ueber ihr Objekt oder gar nicht.
 *
 * **„Veraltet" ist ein VERGLEICH, kein Stempel** (Abnahme 1): eine
 * Bestaetigung zeigt auf eine Fassung, und ob sie noch gilt, entscheidet
 * `dienstanweisung.aktive_version_id` — bei `neue_version_oeffnet_pflicht =
 * false` dagegen jede veroeffentlichte Fassung (O-153).
 */
import type { LeseKontext } from '../../kontext/index.js';
import { istDaSprache, type DaSprache } from '../security/dienstanweisung.js';

/** Eine Anweisung, wie das Telefon sie zeigt. */
export interface EigeneDienstanweisung {
  readonly id: string;
  readonly titel: string;
  /** Die Beschaeftigung, unter der bestaetigt wird (D-09) — nie die Person. */
  readonly anstellungId: string;
  readonly mandantSlug: string;
  readonly mandantName: string;
  readonly objektId: string | null;
  readonly objekt: string | null;

  readonly versionId: string;
  readonly version: number;
  /** Der Text in der Sprache des Lesenden, sonst die deutsche Fassung. */
  readonly inhalt: string | null;
  /** In welcher Sprache der Text oben WIRKLICH steht (EMP-12). */
  readonly angezeigteSprache: DaSprache;
  readonly uebersetzt: boolean;
  readonly dokumentId: string | null;
  /** `sha256(inhalt ‖ dokument)`, hex — der Digest, den die Bestätigung kopiert. */
  readonly inhaltHash: string;
  readonly gueltigAb: string;

  readonly pflicht: boolean;
  /** Offen heisst: noch nicht bestätigt — oder nur eine ältere Fassung. */
  readonly offen: boolean;
  readonly bestaetigteVersion: number | null;
  /** Berliner Ortszeit, fertig aus der Datenbank (Invariante 2). */
  readonly bestaetigtLokal: string | null;
  readonly bestaetigterHash: string | null;
  /** Die nächste eigene Schicht auf diesem Objekt, Berliner Ortszeit. */
  readonly naechsteSchichtLokal: string | null;
}

interface Roh {
  readonly id: string;
  readonly titel: string;
  readonly anstellung_id: string;
  readonly mandant_slug: string;
  readonly mandant_name: string;
  readonly objekt_id: string | null;
  readonly objekt: string | null;
  readonly version_id: string;
  readonly version: number;
  readonly inhalt: string | null;
  readonly angezeigte_sprache: string;
  readonly uebersetzt: boolean;
  readonly dokument_id: string | null;
  readonly inhalt_hash: string;
  readonly gueltig_ab: string;
  readonly pflicht: boolean;
  readonly offen: boolean;
  readonly bestaetigte_version: number | null;
  readonly bestaetigt_lokal: string | null;
  readonly bestaetigter_hash: string | null;
  readonly naechste_schicht_lokal: string | null;
}

/**
 * Die Spalten stehen einmal da und werden von Liste und Einzelblatt benutzt.
 * Zwei Fassungen derselben Auswahl gehen auseinander, sobald eine davon eine
 * Spalte dazubekommt — und das Einzelblatt zeigte dann etwas anderes als die
 * Zeile, aus der man es geoeffnet hat.
 *
 * `$1` ist die Sprache des Lesenden. `inhalt_i18n ->> $1` liefert NULL, wo
 * keine Uebersetzung hinterlegt ist; dann steht die deutsche Fassung da, und
 * `uebersetzt` sagt, dass es die deutsche ist. Ein stiller Rueckfall waere
 * fuer jemanden, der kein Deutsch liest, die schlechteste Auskunft: er
 * bestaetigte einen Text, von dem die Oberflaeche behauptet, er sei seiner.
 */
const SPALTEN = `
  d.id, d.titel,
  a.id                                     as anstellung_id,
  m.slug                                   as mandant_slug,
  m.name                                   as mandant_name,
  d.objekt_id, o.bezeichnung               as objekt,
  v.id                                     as version_id,
  v.version,
  coalesce(v.inhalt_i18n ->> $1::text, v.inhalt)        as inhalt,
  case when v.inhalt_i18n ->> $1::text is not null
       then $1::text else 'de' end         as angezeigte_sprache,
  (v.inhalt_i18n ->> $1::text is not null) as uebersetzt,
  v.dokument_id, v.inhalt_hash,
  to_char(v.gueltig_ab, 'YYYY-MM-DD')      as gueltig_ab,
  d.kenntnisnahme_pflicht                  as pflicht,
  (d.kenntnisnahme_pflicht and k.id is null) as offen,
  kv.version                               as bestaetigte_version,
  to_char(k.bestaetigt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                           as bestaetigt_lokal,
  k.bestaetigter_inhalt_hash               as bestaetigter_hash,
  to_char((select min(z.beginn_zeitpunkt)
             from einsatz_zuordnung z
             join einsatz e on e.id = z.einsatz_id and e.mandant_id = z.mandant_id
            where z.anstellung_id = a.id
              and z.entfernt_am is null
              and z.status <> 'abgesagt'
              and e.storniert_am is null
              and e.objekt_id = d.objekt_id
              and e.ende_zeitpunkt >= now()) at time zone 'Europe/Berlin',
          'DD.MM.YYYY HH24:MI')            as naechste_schicht_lokal`;

/**
 * Die Quelle.
 *
 * Der Verbund auf `anstellung` ist SEITLICH und nimmt die aelteste lebende
 * Beschaeftigung dieser Gesellschaft — dieselbe willkuerliche, aber STABILE
 * Wahl wie beim Wachbuch. Ohne `limit 1` erschiene die Anweisung doppelt,
 * sobald jemand in derselben Gesellschaft zwei Beschaeftigungen hat.
 *
 * Der Verbund auf `da_kenntnisnahme` ist ebenfalls seitlich und holt die
 * ZAEHLENDE Bestaetigung: die der aktiven Fassung, oder — wenn der Kopf bei
 * neuen Fassungen keine neue Bestaetigung verlangt — die neueste ueberhaupt.
 */
const QUELLE = `
  from dienstanweisung d
  join dienstanweisung_version v
       on v.id = d.aktive_version_id and v.mandant_id = d.mandant_id
  join mandant m on m.id = d.mandant_id
  left join objekt o on o.id = d.objekt_id and o.mandant_id = d.mandant_id
  join lateral (select aa.id from anstellung aa
                 where aa.mandant_id = d.mandant_id
                   and aa.person_id = app.aktuelle_person()
                   and aa.geloescht_am is null
                   and aa.status = 'aktiv'
                 order by aa.eintritt, aa.id limit 1) a on true
  left join lateral (select kk.* from da_kenntnisnahme kk
                     join dienstanweisung_version vv
                          on vv.id = kk.dienstanweisung_version_id
                    where kk.anstellung_id = a.id
                      and vv.dienstanweisung_id = d.id
                      and (kk.dienstanweisung_version_id = d.aktive_version_id
                           or not d.neue_version_oeffnet_pflicht)
                    order by vv.version desc limit 1) k on true
  left join dienstanweisung_version kv on kv.id = k.dienstanweisung_version_id`;

function abbilden(z: Roh): EigeneDienstanweisung {
  return {
    id: z.id,
    titel: z.titel,
    anstellungId: z.anstellung_id,
    mandantSlug: z.mandant_slug,
    mandantName: z.mandant_name,
    objektId: z.objekt_id,
    objekt: z.objekt,
    versionId: z.version_id,
    version: Number(z.version),
    inhalt: z.inhalt,
    angezeigteSprache: istDaSprache(z.angezeigte_sprache) ? z.angezeigte_sprache : 'de',
    uebersetzt: z.uebersetzt,
    dokumentId: z.dokument_id,
    inhaltHash: z.inhalt_hash,
    gueltigAb: z.gueltig_ab,
    pflicht: z.pflicht,
    offen: z.offen,
    bestaetigteVersion: z.bestaetigte_version === null ? null : Number(z.bestaetigte_version),
    bestaetigtLokal: z.bestaetigt_lokal,
    bestaetigterHash: z.bestaetigter_hash,
    naechsteSchichtLokal: z.naechste_schicht_lokal,
  };
}

export interface EigeneFilter {
  /** Nur dieses Objekt — der Weg von der Schicht zur Anweisung (EMP-09). */
  readonly objektId?: string | null;
  /** Nur, was noch offen ist. */
  readonly nurOffene?: boolean;
}

/**
 * Die Anweisungen, die diesen Menschen betreffen — offene zuerst.
 *
 * Die Sortierung ist die ganze Aussage von Abnahme 2: wer um 05:55 auf das
 * Telefon sieht, soll die unbestaetigte Anweisung seiner naechsten Schicht
 * OBEN finden und nicht unter drei erledigten.
 */
export async function listeEigeneDienstanweisungen(
  kontext: LeseKontext, sprache: DaSprache, filter: EigeneFilter = {},
): Promise<readonly EigeneDienstanweisung[]> {
  const roh = await kontext.abfrage<Roh>(
    `select ${SPALTEN} ${QUELLE}
      where ($2::uuid is null or d.objekt_id = $2::uuid)
        and ($3::boolean is false or (d.kenntnisnahme_pflicht and k.id is null))
      order by (d.kenntnisnahme_pflicht and k.id is null) desc,
               v.gueltig_ab desc, d.titel`,
    [sprache, filter.objektId ?? null, filter.nurOffene === true],
  );
  return roh.map(abbilden);
}

/** Ein einzelnes Blatt — oder `null`, wenn es diesen Menschen nichts angeht. */
export async function findeEigeneDienstanweisung(
  kontext: LeseKontext, sprache: DaSprache, id: string,
): Promise<EigeneDienstanweisung | null> {
  const [z] = await kontext.abfrage<Roh>(
    `select ${SPALTEN} ${QUELLE} where d.id = $2::uuid`,
    [sprache, id],
  );
  // Kein 403: eine fremde Anweisung ist fuer diese Anmeldung nicht vorhanden
  // (AUT-06). Der Unterschied waere die Auskunft, dass es sie gibt.
  return z === undefined ? null : abbilden(z);
}

/**
 * Wie viele Anweisungen noch offen sind — die Zahl fuer „Heute".
 *
 * Sie kommt aus derselben Abfrage wie die Liste und nicht aus einer zweiten,
 * kuerzeren: zwei Zaehlungen derselben Sache gehen beim ersten Eingriff
 * auseinander, und dann zeigt die Kachel eine andere Zahl als die Seite
 * dahinter.
 */
export async function zaehleOffene(
  kontext: LeseKontext, sprache: DaSprache,
): Promise<number> {
  const offene = await listeEigeneDienstanweisungen(kontext, sprache, { nurOffene: true });
  return offene.length;
}

/**
 * Wohin eine Bestaetigung gehoert — aufgeloest im PERSONEN-Scope.
 *
 * **Der Mandant kommt aus der Anweisung, nie aus der Anfrage** (K-02,
 * Invariante 3). Im Personen-Scope ist `app.aktiver_mandant()` NULL, und keine
 * Schreibpolicy traefe zu; der Schreibweg betritt deshalb anschliessend genau
 * den Mandanten, den diese Auskunft nennt. Eine fremde Anweisung liefert hier
 * null Zeilen — also 404 und nicht 403 (AUT-06).
 *
 * **`istAktiv` ist die Antwort auf ein altes Formular.** Wird waehrend des
 * Lesens Fassung 3 freigegeben, zeigt der Knopf im Browser noch auf Fassung 2;
 * sie zu bestaetigen waere eine Unterschrift unter einen Text, der nicht mehr
 * gilt — und die Ableitung wiese sie im selben Atemzug als veraltet aus.
 */
export interface Bestaetigungsziel {
  readonly mandantId: string;
  readonly versionId: string;
  readonly version: number;
  readonly istAktiv: boolean;
}

export async function findeBestaetigungsziel(
  kontext: LeseKontext, anweisungId: string, versionId: string,
): Promise<Bestaetigungsziel | null> {
  const [z] = await kontext.abfrage<{
    mandant_id: string; version_id: string; version: number; ist_aktiv: boolean;
  }>(
    `select d.mandant_id, v.id as version_id, v.version,
            (v.id = d.aktive_version_id) as ist_aktiv
       from dienstanweisung_version v
       join dienstanweisung d
            on d.id = v.dienstanweisung_id and d.mandant_id = v.mandant_id
      where d.id = $1::uuid and v.id = $2::uuid`,
    [anweisungId, versionId],
  );
  if (z === undefined) return null;
  return {
    mandantId: z.mandant_id,
    versionId: z.version_id,
    version: Number(z.version),
    istAktiv: z.ist_aktiv,
  };
}
