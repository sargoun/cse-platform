import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { jcsDigest } from '../freigabe/kette.js';
import { plattformKanal } from '../../versand/social-plattform.js';
import {
  type BeitragAuftrag, KanalNichtVerbundenFehler, PLATTFORM_NAME, type Plattform,
} from './port.js';
import {
  type BeitragStatus, type Schritt, PLAN_FEHLER_TEXT, darfBearbeiten, naechsterStatus,
  planFehler,
} from './weg.js';

/**
 * Das Social Media Center — der Teil, der die Datenbank anfasst (SOC-01…08).
 *
 * **Der Weg entscheidet hier nichts.** Die Regel steht in `weg.ts` und ist
 * ohne Datenbank prüfbar; diese Datei fragt sie und führt aus. Dieselbe
 * Trennung wie bei `zeit/` und `finanz/`: eine Regel, die nur im SQL steht,
 * lässt sich nicht gegen die Umstellungsnacht prüfen.
 */

/**
 * **Der schmale Zugriff, den auch ein Lauf hat.**
 *
 * `veroeffentliche` wird von zwei Seiten gerufen: von einem Menschen, der
 * „Jetzt veröffentlichen" drückt, und vom Lauf, der einen geplanten Beitrag
 * zu seiner Zeit hinausgibt (SOC-03). Der Lauf hat keine Sitzung und keinen
 * Mandanten im Kontext — er hat eine Verbindung.
 *
 * Deshalb verlangt der Weg nach draussen NICHT `SchreibKontext`, sondern nur
 * das, was er wirklich benutzt. Die Alternative wäre eine zweite Fassung des
 * Veröffentlichens im Lauf gewesen — zwei Wege nach draussen, und der eine
 * würde beim nächsten Umbau vergessen. `SchreibKontext` erfüllt diesen Vertrag
 * ohnehin; der Aufrufer merkt nichts davon.
 */
export interface LeseZugriff {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface SchreibZugriff extends LeseZugriff {
  schreibe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  /** `null` im Lauf — dort hat keine Änderung einen Menschen dahinter. */
  readonly benutzerId: string | null;
}

export class SocialFehler extends Error {
  constructor(nachricht: string, readonly grund: string) {
    super(nachricht);
    this.name = 'SocialFehler';
  }
}

export interface BeitragZeile {
  readonly id: string;
  /** Der URL-Schluessel unter `/unternehmen/<bereich>/news/` (0170). */
  readonly slug: string;
  readonly titel: string;
  readonly text: string;
  readonly art: string;
  readonly status: BeitragStatus;
  readonly geplantFuer: string | null;
  readonly veroeffentlichtAm: string | null;
  readonly zurueckgezogenAm: string | null;
  readonly freigabeId: string | null;
  readonly projektId: string | null;
  readonly referenzId: string | null;
  readonly erstelltAm: string;
}

export interface KanalZeile {
  readonly id: string;
  readonly plattform: Plattform;
  readonly anzeigename: string;
  readonly handle: string | null;
  readonly verbunden: boolean;
  readonly hinweis: string | null;
  readonly aktiv: boolean;
}

export interface BeitragKanalZeile {
  readonly kanalId: string;
  readonly plattform: Plattform;
  readonly ergebnis: 'offen' | 'veroeffentlicht' | 'nicht_verbunden' | 'fehlgeschlagen';
  readonly veroeffentlichtAm: string | null;
  readonly externeRef: string | null;
  readonly meldung: string | null;
  readonly versuche: number;
}

const FELDER = `b.id, b.slug, b.titel, b.text, b.art::text as art, b.status::text as status,
                b.geplant_fuer as "geplantFuer", b.veroeffentlicht_am as "veroeffentlichtAm",
                b.zurueckgezogen_am as "zurueckgezogenAm", b.freigabe_id as "freigabeId",
                b.projekt_id as "projektId", b.referenz_id as "referenzId",
                b.erstellt_am as "erstelltAm"`;

/**
 * Die Beitraege — gefiltert nach Stand und, wo gewuenscht, nach ART.
 *
 * **Warum der Artenfilter nachgereicht wurde.** `/website/news` zeigt, was auf
 * `/unternehmen/<bereich>/news` erscheint, und das ist nicht alles: die Grenze
 * zieht `NEUIGKEITS_ARTEN` (O-548). Ohne diesen Filter haette die
 * Website-Redaktion dieselbe Liste wie `/social/posts` gesehen — vier
 * Projektschauen darunter, die auf der Newsseite nie auftauchen. Eine Liste,
 * die mehr zeigt, als die Seite dahinter fuehrt, ist keine Vorschau.
 *
 * `arten` ist absichtlich eine Liste und kein einzelner Wert: die Grenze steht
 * in EINER Konstante, und die ist mehrelementig.
 *
 * **Und warum `mandant_id = app.aktiver_mandant()` hier im DIENST steht und
 * nicht nur in der Policy.** `beitrag` traegt zwei erlaubende Lesepolicies:
 * `t_beitrag_lesen` (aktiver Mandant + `social.lesen`) und
 * `t_beitrag_oeffentlich` (`status = 'veroeffentlicht'`, ohne Mandanten-
 * bedingung, weil die oeffentliche Seite ohne Sitzung laeuft). Erlaubende
 * Policies werden ver-ODER-t; eine restriktive SELECT-Decke gibt es auf dieser
 * Tabelle bewusst nicht (`p_beitrag_decke_*` gilt nur fuer INSERT/UPDATE,
 * siehe 0163). Eine Abfrage ohne eigene Mandantenbedingung sah damit JEDE
 * veroeffentlichte Neuigkeit ALLER vier Gesellschaften — gemessen, nicht
 * vermutet. Invariante 3 sagt dazu den Satz, der hier gilt: RLS ist die
 * zweite Linie, nie die einzige.
 */
export async function listeBeitraege(
  kontext: LeseKontext,
  filter: { status?: BeitragStatus; arten?: readonly string[] } = {},
): Promise<readonly BeitragZeile[]> {
  const status = filter.status ?? null;
  const arten = filter.arten === undefined ? null : [...filter.arten];
  return kontext.abfrage<BeitragZeile>(
    `select ${FELDER}
       from beitrag b
      where b.mandant_id = app.aktiver_mandant()
        and ($1::text is null or b.status::text = $1)
        and ($2::text[] is null or b.art::text = any($2::text[]))
      order by coalesce(b.veroeffentlicht_am, b.geplant_fuer, b.erstellt_am) desc, b.id`,
    [status, arten]);
}

/**
 * Ein Beitrag DIESER Gesellschaft — und nur ihrer.
 *
 * Die Mandantenbedingung steht aus demselben Grund hier wie in
 * `listeBeitraege`: `t_beitrag_oeffentlich` liesse jede veroeffentlichte Zeile
 * durch, gleich welcher Gesellschaft. Eine fremde Kennung ist damit wieder
 * das, was sie sein muss — `null`, also 404 auf der Seite darueber (AUT-06).
 *
 * Der Lauf (`jobs/socialPlan.ts`) faellt nicht darunter: `alsJobSitzung`
 * bindet `app.mandant_id` auf den Mandanten DES Beitrags, bevor er
 * `veroeffentliche` ruft.
 */
export async function ladeBeitrag(
  kontext: LeseZugriff, id: string,
): Promise<BeitragZeile | null> {
  const [z] = await kontext.abfrage<BeitragZeile>(
    `select ${FELDER}
       from beitrag b
      where b.id = $1::uuid and b.mandant_id = app.aktiver_mandant()`, [id]);
  return z ?? null;
}

export async function listeKanaele(kontext: LeseKontext): Promise<readonly KanalZeile[]> {
  return kontext.abfrage<KanalZeile>(
    `select k.id, k.plattform::text as plattform, k.anzeigename, k.handle,
            k.verbunden, k.hinweis, k.aktiv
       from social_kanal k
      order by k.sortierung, k.plattform`);
}

export async function kanaeleZuBeitrag(
  kontext: LeseZugriff, beitragId: string,
): Promise<readonly BeitragKanalZeile[]> {
  return kontext.abfrage<BeitragKanalZeile>(
    `select bk.kanal_id as "kanalId", k.plattform::text as plattform,
            bk.ergebnis::text as ergebnis, bk.veroeffentlicht_am as "veroeffentlichtAm",
            bk.externe_ref as "externeRef", bk.meldung, bk.versuche
       from beitrag_kanal bk
       join social_kanal k on k.mandant_id = bk.mandant_id and k.id = bk.kanal_id
      where bk.beitrag_id = $1::uuid
      order by k.sortierung, k.plattform`,
    [beitragId]);
}

export interface NeuerBeitrag {
  readonly titel: string;
  readonly text: string;
  readonly art: 'beitrag' | 'projektschau' | 'neuigkeit' | 'aktualisierung';
  readonly projektId: string | null;
  readonly referenzId: string | null;
  readonly kanalIds: readonly string[];
}

export async function legeBeitragAn(
  kontext: SchreibKontext, neu: NeuerBeitrag,
): Promise<string> {
  /*
   * **Die Quelle wird NOCH EINMAL geprueft — hier, nicht nur im Formular.**
   *
   * `quellenFuerBeitrag` filtert die Auswahlliste: Referenzen nur, wenn sie
   * nicht geloescht sind UND der Kunde sie freigegeben hat; Projekte nur, wenn
   * sie nicht abgelegt sind. Das ist die ANZEIGE. Der Server nahm dagegen jede
   * Kennung, die als UUID durchging.
   *
   * Der Unterschied ist kein Schoenheitsfehler: eine untergeschobene
   * `referenz_id` haengt an den Beitrag eine Kundenreferenz, die der Kunde
   * gerade NICHT freigegeben hat — und der Beitrag geht danach auf die eigene
   * Seite und in die verbundenen Kanaele. Die Freigabe des Kunden ist eine
   * Einwilligung; sie am Formular zu pruefen und am Server nicht heisst, sie
   * gar nicht zu pruefen.
   *
   * Die Bedingungen stehen deshalb WOERTLICH so wie in `quellenFuerBeitrag`.
   * Gelesen wird unter der Mandantensitzung, also faellt eine fremde Kennung
   * schon an der RLS — und eine eigene, aber nicht freigegebene hier.
   */
  if (neu.referenzId !== null) {
    const [r] = await kontext.abfrage<{ id: string }>(
      `select id from referenz
        where id = $1::uuid and geloescht_am is null and freigegeben_vom_kunden`,
      [neu.referenzId]);
    if (r === undefined) {
      throw new SocialFehler(
        'Diese Referenz lässt sich nicht anhängen: Sie ist gelöscht oder vom Kunden '
        + 'nicht freigegeben. Was ein Kunde nicht freigegeben hat, geht nicht hinaus.',
        'quelle_unzulaessig');
    }
  }
  if (neu.projektId !== null) {
    const [p] = await kontext.abfrage<{ id: string }>(
      `select id from projekt where id = $1::uuid and archiviert_am is null`,
      [neu.projektId]);
    if (p === undefined) {
      throw new SocialFehler(
        'Dieses Projekt lässt sich nicht anhängen: Es gibt es hier nicht oder es ist '
        + 'abgelegt.', 'quelle_unzulaessig');
    }
  }

  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into beitrag (mandant_id, titel, text, art, projekt_id, referenz_id, erstellt_von)
     values ($1::uuid, $2, $3, $4::beitrag_art, $5::uuid, $6::uuid, $7::uuid)
     returning id`,
    [kontext.aktiverMandantId, neu.titel.trim(), neu.text.trim(), neu.art,
      neu.projektId, neu.referenzId, kontext.benutzerId]);
  if (z === undefined) throw new SocialFehler('Der Beitrag wurde nicht angelegt.', 'kein_schreibrecht');
  await setzeKanaele(kontext, z.id, neu.kanalIds);
  return z.id;
}

/**
 * **Kanäle ändert man nur am Entwurf.**
 *
 * Ein Kanal, der nach der Freigabe dazukommt, ginge an einen Empfängerkreis
 * hinaus, den niemand geprüft hat — dieselbe Lücke wie ein nachträglich
 * geänderter Text, nur schwerer zu sehen. Und eine Zeile mit einem Ergebnis
 * wird nicht gelöscht: sie ist die Auskunft darüber, was geschehen ist.
 */
export async function setzeKanaele(
  kontext: SchreibKontext, beitragId: string, kanalIds: readonly string[],
): Promise<void> {
  const b = await ladeBeitrag(kontext, beitragId);
  if (b === null) throw new SocialFehler('Diesen Beitrag gibt es nicht.', 'unbekannt');
  if (!darfBearbeiten(b.status)) {
    throw new SocialFehler(
      'Kanäle lassen sich nur am Entwurf ändern. Nach der Freigabe ginge ein neuer '
      + 'Kanal an einen Empfängerkreis, den niemand geprüft hat (SOC-08).',
      'nicht_bearbeitbar');
  }
  /*
   * **Und jetzt noch einmal, diesmal mit Sperre.**
   *
   * Der Rest dieser Datei riegelt den Spalt zwischen Lesen und Schreiben mit
   * `schreibeWennNoch` ab — der Bedingung IM `update`. Hier geht das nicht:
   * geschrieben wird `beitrag_kanal`, und der Stand, gegen den geprueft wird,
   * steht in `beitrag`. Zwei Anfragen, die gleichzeitig ankommen, laesen
   * beide `entwurf`; die eine legt vor, die andere haengt danach einen Kanal
   * an — und der ginge an einen Empfaengerkreis, den niemand geprueft hat.
   * Genau das, was der Satz ueber dieser Funktion verbietet.
   *
   * `for update` sperrt die Beitragszeile fuer die Dauer dieser Transaktion.
   * Wer gleichzeitig vorlegt, wartet auf sie und prueft seinen Stand danach
   * noch einmal (`schreibeWennNoch`); wer danach hierherkommt, liest
   * `vorgelegt` und wird abgewiesen. Dieselbe Sperre, mit der der
   * Nummernkreis seine Luecken verhindert (Invariante 4).
   *
   * **Das setzt eine Transaktion voraus** — `fuehreSocialAus` haelt eine
   * (`db().begin(...)`), und ohne sie waere die Sperre mit der Anweisung
   * wieder weg. Deshalb steht es hier und nicht nur im Aufrufer.
   */
  const [gesperrt] = await kontext.abfrage<{ status: BeitragStatus }>(
    `select status from beitrag where id = $1::uuid for update`, [beitragId]);
  if (gesperrt === undefined || !darfBearbeiten(gesperrt.status)) {
    throw new SocialFehler(
      'Der Beitrag wurde inzwischen vorgelegt — Kanäle lassen sich nur am Entwurf '
      + 'ändern. Nach der Freigabe ginge ein neuer Kanal an einen Empfängerkreis, '
      + 'den niemand geprüft hat (SOC-08).',
      'gleichzeitig');
  }

  const eindeutig = [...new Set(kanalIds)];
  await kontext.schreibe(
    `delete from beitrag_kanal
      where beitrag_id = $1::uuid and ergebnis = 'offen'
        and not (kanal_id = any ($2::uuid[]))`,
    [beitragId, eindeutig]);
  if (eindeutig.length > 0) {
    await kontext.schreibe(
      `insert into beitrag_kanal (mandant_id, beitrag_id, kanal_id)
       select $1::uuid, $2::uuid, k.id
         from social_kanal k
        where k.id = any ($3::uuid[]) and k.mandant_id = $1::uuid and k.aktiv
       on conflict (mandant_id, beitrag_id, kanal_id) do nothing`,
      [kontext.aktiverMandantId, beitragId, eindeutig]);
  }
}

export async function bearbeiteBeitrag(
  kontext: SchreibKontext, id: string,
  felder: { titel: string; text: string; art: NeuerBeitrag['art'] },
): Promise<void> {
  const b = await ladeBeitrag(kontext, id);
  if (b === null) throw new SocialFehler('Diesen Beitrag gibt es nicht.', 'unbekannt');
  if (!darfBearbeiten(b.status)) {
    throw new SocialFehler(
      'Bearbeitet wird nur der Entwurf. Die Freigabe hängt am Text, der vorlag — '
      + 'wer ihn danach ändert, hat keine Freigabe mehr für das, was hinausgeht.',
      'nicht_bearbeitbar');
  }
  /*
   * **`schreibeWennNoch` und nicht ein nacktes `update`.**
   *
   * Der Status wurde oben gelesen, geschrieben wurde hier — und dazwischen
   * liegt der Spalt. Legt jemand in diesem Augenblick vor, entsteht die
   * Freigabe mit dem Abdruck des ALTEN Textes, und gleich danach ueberschreibt
   * dieses `update` den Text: was spaeter hinausgeht, hat nie jemand
   * freigegeben (SOC-08). Die Bedingung `status = 'entwurf'` steht deshalb IM
   * `update`; wer sie verliert, bekommt `gleichzeitig` und nicht stillschweigend
   * Erfolg. Gemeldet hat das die Copilot-Runde auf PR 16.
   */
  await schreibeWennNoch(kontext, id, b.status,
    `update beitrag set titel = $2, text = $3, art = $4::beitrag_art, geaendert_von = $5::uuid
      where id = $1::uuid`,
    [id, felder.titel.trim(), felder.text.trim(), felder.art, kontext.benutzerId]);
}

/**
 * **Vorlegen heisst: eine Freigabe entsteht** (SOC-08, Invariante 7).
 *
 * Der Abdruck (`payload_hash`) bindet die Entscheidung an genau diesen Text.
 * Wer danach etwas ändert, muss über `ueberarbeiten` zurück in den Entwurf —
 * und die Freigabe fällt dabei weg. Das ist derselbe Mechanismus wie im
 * Ausgangs-Gate (`agent/policy.ts`), nur eine Ebene früher.
 */
/**
 * **Zwischen Lesen und Schreiben liegt ein Spalt** — und in ihm passiert der
 * zweite Klick.
 *
 * Jede Handlung hier las erst den Stand (`ladeBeitrag`), prueft ihn gegen
 * `weg.ts` und schrieb dann `where id = $1`. Zwei Anfragen, die gleichzeitig
 * ankommen — ein doppelter Klick auf „Jetzt veroeffentlichen" reicht —, lesen
 * BEIDE `freigegeben`, finden beide den Weg erlaubt und schreiben beide. Beim
 * Vorlegen entstehen so zwei Freigaben zu einem Beitrag; beim Veroeffentlichen
 * zwei Ausgaenge nach draussen. Das ist kein theoretischer Fall: die Knoepfe
 * sind gewoehnliche Formulare, und ein langsamer Bildschirm laedt zum zweiten
 * Klick ein.
 *
 * Der Riegel ist die Bedingung IM `update`: geschrieben wird nur, solange der
 * Stand noch der ist, gegen den geprueft wurde. Wer verliert, bekommt keinen
 * stillen Erfolg, sondern denselben Satz wie beim falschen Zustand — denn
 * genau das ist es: als sein Schreiben ankam, war der Beitrag woanders.
 */
async function schreibeWennNoch(
  kontext: SchreibZugriff, id: string, stand: BeitragStatus,
  satz: string, werte: readonly unknown[],
): Promise<void> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `${satz} and status = $${String(werte.length + 1)}::beitrag_status returning id`,
    [...werte, stand]);
  if (zeilen.length === 0) {
    /**
     * **Null Zeilen hat ZWEI Ursachen, und sie verlangen zwei Sätze.**
     *
     * Entweder der Beitrag steht nicht mehr im erwarteten Zustand — dann war
     * jemand schneller. Oder die Schreibpolicy hat abgewiesen: `beitrag`
     * kennt genau eine Schreibpolicy, und die verlangt `social.schreiben`,
     * während die Planungs- und Versandschritte an `social.planen` hängen
     * (`RECHT` in der Schritt-Route). Beides sind eigene Rechte, je
     * Gesellschaft einzeln widerrufbar.
     *
     * Wer planen darf und nicht schreiben, bekam deshalb „jemand anderes war
     * schneller" — eine Erklärung, die in die Irre führt: er lädt neu, sieht
     * denselben Zustand und versucht es wieder. Die Grundmatrix (`0008`)
     * vergibt beide Rechte zusammen, ein Mandanten-Override kann sie trennen.
     * Gemeldet von der Copilot-Runde auf PR 16 (D-585).
     *
     * Die Rückfrage kostet eine Abfrage — aber nur auf dem Fehlerweg, und sie
     * liest mit derselben Lesepolicy, die den Beitrag ohnehin sichtbar macht.
     */
    const [noch] = await kontext.abfrage<{ status: string }>(
      `select status::text as status from beitrag where id = $1::uuid`, [id]);
    if (noch !== undefined && noch.status === stand) {
      throw new SocialFehler(
        'Dieser Schritt verlangt zusätzlich das Recht, Beiträge zu bearbeiten '
        + '(social.schreiben). Der Beitrag steht unverändert da.', 'kein_recht');
    }
    throw new SocialFehler(
      'Der Beitrag hat sich inzwischen geändert — jemand anderes war schneller. '
      + 'Bitte die Seite neu laden und noch einmal ansehen.', 'gleichzeitig');
  }
}

export async function legeVor(kontext: SchreibKontext, id: string): Promise<string> {
  /*
   * **Erst sperren, dann den Abdruck nehmen.**
   *
   * Der Abdruck bindet die Entscheidung an genau diesen Text. Er entsteht
   * unten aus `b.titel` und `b.text` — und zwischen diesem Lesen und dem
   * `update` weiter unten lag ein Spalt, in den eine gleichzeitige Bearbeitung
   * passte: die Freigabe traegt dann den Abdruck des alten Textes, und beim
   * Entscheiden vergleicht `app.freigabe_entscheiden` ihn mit dem neuen. Das
   * faellt nicht durch — es faellt AUF, und zwar dem Menschen im Posteingang,
   * mit „die eingereichte Nutzlast ist nicht die vorgelegte". Eine Freigabe,
   * die niemand mehr entscheiden kann, ist ein Beitrag, der feststeckt.
   *
   * `for update` haelt die Zeile fuer die Dauer der Transaktion. Dieselbe
   * Sperre wie in `setzeKanaele`, und aus demselben Grund; `fuehreSocialAus`
   * haelt die Transaktion.
   */
  await kontext.abfrage(`select id from beitrag where id = $1::uuid for update`, [id]);
  const b = await ladeBeitrag(kontext, id);
  if (b === null) throw new SocialFehler('Diesen Beitrag gibt es nicht.', 'unbekannt');
  const ziel = naechsterStatus(b.status, 'vorlegen');
  if (ziel === null) {
    throw new SocialFehler('Vorgelegt wird ein Entwurf.', 'falscher_status');
  }

  const kanaele = await kanaeleZuBeitrag(kontext, id);
  const nutzlast = {
    beitrag_id: b.id,
    titel: b.titel,
    text: b.text,
    art: b.art,
    kanaele: kanaele.map((k) => k.plattform),
  };
  /*
   * **Der Abdruck MUSS kanonisch sein (RFC 8785)** -- `JSON.stringify` genuegt
   * nicht.
   *
   * `app.freigabe_entscheiden` (0136) bildet den Digest beim Entscheiden aus
   * `kanonisiere(vorschau)` und vergleicht ihn mit dieser Spalte.
   * Kanonisierung sortiert Objektschluessel; die Einfuegereihenfolge von
   * `JSON.stringify` tut das nicht. Beide Byte-Folgen sind verschieden, und
   * die Datenbank weist JEDE Entscheidung mit
   * "die eingereichte Nutzlast ist nicht die vorgelegte" ab -- also jede
   * Social-Freigabe, ausnahmslos.
   *
   * Kein Test hatte den Weg gegangen; gefunden hat es die Browsersuite, weil
   * der Freigabe-Posteingang seit dem Seed einen Social-Vorschlag enthaelt.
   * `jcsDigest` ist dieselbe Funktion, die die Kette benutzt -- eine zweite
   * Fassung waere genau der Fehler noch einmal.
   */
  const abdruck = jcsDigest(nutzlast);

  /*
   * **Wer hier schreibt, braucht heute `freigabe.entscheiden`** — und das ist
   * ein Zustand, keine Absicht.
   *
   * Die Schreibpolicy auf `freigabe` (`t_mandant`, 0136) unterscheidet nicht
   * zwischen „eine Freigabe anlegen" und „eine Freigabe entscheiden". Heute
   * faellt das nicht auf: `social.schreiben` und `freigabe.entscheiden` liegen
   * bei denselben drei Rollen. Es faellt auf, sobald jemand eine schmale
   * Marketingrolle anlegt, die vorlegt und nichts entscheidet — also genau
   * das, wofuer Invariante 7 da ist.
   *
   * `tests/isolation/social-job.test.ts` haelt die Kopplung fest, damit sie
   * beim Festschreiben rot wird und nicht im Betrieb.
   *
   * // TODO(client, O-369): Darf jemand eine Freigabe ERBITTEN, ohne sie
   * erteilen zu duerfen? Die Policy hier zu weiten gilt fuer JEDE Freigabe
   * dieser Plattform — das ist keine Social-Entscheidung.
   */
  const [f] = await kontext.schreibe<{ id: string }>(
    `insert into freigabe
       (mandant_id, aktion, status, vorgang_typ, titel, zusammenfassung, risiko,
        diff, vorschau_payload, payload_hash, bezug_typ, bezug_id, erstellt_von,
        erforderliches_recht)
     values ($1::uuid, 'social_veroeffentlichen', 'offen', 'beitrag_veroeffentlichen',
             $2, $3, 'mittel'::risiko_stufe, '[]'::jsonb, $4::jsonb, $5,
             'beitrag', $6::uuid, $7::uuid, 'social.freigeben')
     returning id`,
    [kontext.aktiverMandantId, `Beitrag: ${b.titel}`, zusammenfassung(b, kanaele),
      nutzlast, abdruck, b.id, kontext.benutzerId]);
  if (f === undefined) {
    throw new SocialFehler('Die Freigabe wurde nicht angelegt.', 'kein_schreibrecht');
  }

  await schreibeWennNoch(kontext, id, b.status,
    `update beitrag set status = $2::beitrag_status, freigabe_id = $3::uuid,
                        geaendert_von = $4::uuid
      where id = $1::uuid`,
    [id, ziel, f.id, kontext.benutzerId]);
  return f.id;
}

/**
 * Der Satz, den ein Mensch im Posteingang liest.
 *
 * **Er nennt die Kanäle beim Namen, auch die nicht verbundenen.** Wer
 * freigibt, soll wissen, wohin es geht — und wohin es heute eben nicht geht.
 */
function zusammenfassung(b: BeitragZeile, kanaele: readonly BeitragKanalZeile[]): string {
  const namen = kanaele.map((k) => PLATTFORM_NAME[k.plattform]);
  const wohin = namen.length === 0
    ? 'nur auf die eigene Gesellschaftsseite'
    : `auf die eigene Gesellschaftsseite und an ${namen.join(', ')}`;
  return `Der Beitrag „${b.titel}" soll ${wohin} gehen. `
    + `${b.text.slice(0, 200)}${b.text.length > 200 ? '…' : ''}`;
}

export async function schrittGehen(
  kontext: SchreibKontext, id: string, schritt: Schritt, grund: string | null = null,
): Promise<void> {
  const b = await ladeBeitrag(kontext, id);
  if (b === null) throw new SocialFehler('Diesen Beitrag gibt es nicht.', 'unbekannt');
  const ziel = naechsterStatus(b.status, schritt);
  if (ziel === null) {
    throw new SocialFehler(
      `Aus „${b.status}" führt kein Schritt „${schritt}".`, 'falscher_status');
  }
  if (schritt === 'zuruecknehmen' && (grund === null || grund.trim() === '')) {
    throw new SocialFehler(
      'Ein Rückzug ohne Grund ist keine Auskunft — er steht im Protokoll und '
      + 'jemand wird danach fragen.', 'grund_fehlt');
  }
  if (schritt === 'ueberarbeiten') {
    /*
     * **Die Freigabe faellt weg.** Sie galt fuer den Text, der vorlag; ein
     * Entwurf mit einer alten Freigabe daran waere genau der Weg, auf dem
     * ungeprueftes hinausgeht.
     */
    await schreibeWennNoch(kontext, id, b.status,
      `update beitrag set status = 'entwurf', freigabe_id = null, geaendert_von = $2::uuid
        where id = $1::uuid`, [id, kontext.benutzerId]);
    /*
     * **Und sie faellt auch IM POSTEINGANG weg** — hier stand nur die Zeile
     * darueber.
     *
     * `freigabe_id = null` loeste den Beitrag von seiner Freigabe; die
     * Freigabe selbst blieb `offen` liegen. Der Beitrag war damit sicher (der
     * Trigger `freigabe_zieht_beitrag_nach`, 0163, greift nur auf
     * `status = 'vorgelegt'`), der Posteingang nicht: dort wartete weiter eine
     * Bitte um Freigabe auf einen Text, den es so nicht mehr gibt. Wer sie
     * oeffnet, liest eine alte Vorschau, entscheidet, und diese Entscheidung
     * geht als Glied in die Hashkette (K-13) — eine bezeugte Freigabe fuer
     * einen zurueckgezogenen Antrag. Gemeldet hat das die Copilot-Runde auf
     * PR 16.
     *
     * `and status = 'offen'` ist der ganze Riegel: aus `abgelehnt` heraus
     * ueberarbeiten trifft eine ENTSCHIEDENE Freigabe, und die wird nicht
     * umgeschrieben — Entscheidungen sind Tatsachen, kein Zustand (APR-07).
     * Genau deshalb steht hier `zurueckgezogen` und nicht `abgelehnt`: den
     * Antrag nimmt der Antragsteller zurueck, abgelehnt haette ihn jemand.
     */
    if (b.freigabeId !== null) {
      await kontext.schreibe(
        `update freigabe
          set status = 'zurueckgezogen', geaendert_am = now(),
              begruendung = coalesce(begruendung,
                'Der Beitrag wurde zur Überarbeitung zurückgeholt; '
                || 'der vorgelegte Text steht nicht mehr.')
        where id = $1::uuid and status = 'offen'`,
        [b.freigabeId]);
    }
    return;
  }
  await schreibeWennNoch(kontext, id, b.status,
    `update beitrag
        set status = $2::beitrag_status,
            geplant_fuer = case when $2 = 'freigegeben' then null else geplant_fuer end,
            zurueckgezogen_am = case when $2 = 'zurueckgezogen' then now()
                                     else zurueckgezogen_am end,
            zurueckgezogen_grund = case when $2 = 'zurueckgezogen' then $3
                                        else zurueckgezogen_grund end,
            geaendert_von = $4::uuid
      where id = $1::uuid`,
    [id, ziel, grund, kontext.benutzerId]);
}

export async function plane(
  kontext: SchreibKontext, id: string, geplantFuer: Date, jetzt: Date,
): Promise<void> {
  const b = await ladeBeitrag(kontext, id);
  if (b === null) throw new SocialFehler('Diesen Beitrag gibt es nicht.', 'unbekannt');
  const fehler = planFehler(b.status, geplantFuer, jetzt);
  if (fehler !== null) throw new SocialFehler(PLAN_FEHLER_TEXT[fehler], fehler);
  await schreibeWennNoch(kontext, id, b.status,
    `update beitrag set status = 'geplant', geplant_fuer = $2::timestamptz,
                        geaendert_von = $3::uuid
      where id = $1::uuid`,
    [id, geplantFuer.toISOString(), kontext.benutzerId]);
}

export interface Veroeffentlichung {
  readonly beitragId: string;
  readonly aufWebsite: true;
  readonly kanaele: readonly {
    readonly plattform: Plattform;
    readonly ergebnis: 'veroeffentlicht' | 'nicht_verbunden' | 'fehlgeschlagen';
    readonly meldung: string | null;
  }[];
}

/**
 * Sendet an die uebergebenen Kanaele und schreibt je Kanal das Ergebnis.
 *
 * Herausgezogen, weil `veroeffentliche` und `sendeErneut` denselben Weg nach
 * draussen gehen muessen. Zwei Abschriften waeren zwei Wege, und der eine
 * bliebe beim naechsten Umbau zurueck — mit dem Unterschied, dass niemand ihn
 * drueckt und deshalb niemand merkt, dass er anders geworden ist.
 */
async function sendeKanaele(
  kontext: SchreibZugriff, id: string, auftrag: BeitragAuftrag,
  zeilen: readonly BeitragKanalZeile[],
): Promise<Veroeffentlichung['kanaele'][number][]> {
  const ergebnisse: Veroeffentlichung['kanaele'][number][] = [];

  for (const z of zeilen) {
    const kanal = plattformKanal(z.plattform);
    try {
      const { externeRef } = await kanal.veroeffentliche(auftrag);
      await kontext.schreibe(
        `update beitrag_kanal
            set ergebnis = 'veroeffentlicht', veroeffentlicht_am = now(),
                externe_ref = $3, meldung = null, versuche = versuche + 1
          where beitrag_id = $1::uuid and kanal_id = $2::uuid`,
        [id, z.kanalId, externeRef]);
      ergebnisse.push({ plattform: z.plattform, ergebnis: 'veroeffentlicht', meldung: null });
    } catch (fehler: unknown) {
      /*
       * **Ein nicht verbundener Kanal bricht den Lauf nicht ab.** Er ist ein
       * bekannter Zustand, kein Vorfall -- und die uebrigen Kanaele haben mit
       * ihm nichts zu tun. Nur die Meldung aendert sich.
       */
      const verbunden = fehler instanceof KanalNichtVerbundenFehler;
      const ergebnis = verbunden ? 'nicht_verbunden' as const : 'fehlgeschlagen' as const;
      /*
       * **Ein unerwarteter Fehler wird NICHT zur Meldung eingedampft.**
       *
       * `fehler.message` allein verschweigt den Stapel — und bei einem
       * Programmfehler (ein `undefined`, ein Tippfehler im Adapter) steht dann
       * auf dem Bildschirm „Cannot read properties of undefined", waehrend im
       * Protokoll nichts steht, was jemanden zur Zeile fuehrt. Ein
       * `KanalNichtVerbunden` ist ein bekannter Zustand und gehoert nicht ins
       * Fehlerprotokoll; alles andere gehoert genau dorthin.
       */
      if (!verbunden) {
        console.error('[social] Kanal %s fuer Beitrag %s fehlgeschlagen',
          z.plattform, id, fehler);
      }
      const meldung = verbunden && fehler instanceof Error
        ? fehler.message
        : `Unerwarteter Fehler beim Kanal ${PLATTFORM_NAME[z.plattform]}: `
          + `${fehler instanceof Error ? fehler.message : String(fehler)}`;
      await kontext.schreibe(
        `update beitrag_kanal
            set ergebnis = $3::kanal_ergebnis, meldung = $4, versuche = versuche + 1
          where beitrag_id = $1::uuid and kanal_id = $2::uuid`,
        [id, z.kanalId, ergebnis, meldung]);
      ergebnisse.push({ plattform: z.plattform, ergebnis, meldung });
    }
  }
  return ergebnisse;
}

/**
 * **Die Adresse, unter der der Beitrag WIRKLICH steht** (SOC-05).
 *
 * Hier stand an zwei Stellen `${basis}/beitrag/${id}` — eine Route, die es im
 * ganzen Baum nicht gibt. Gemeldet hat das die Copilot-Runde auf PR 16, und
 * der Befund wog schwerer, als er aussah: dieser Link geht an FREMDE
 * Plattformen. Ein toter Link im eigenen Portal ärgert; ein toter Link unter
 * einem Instagram-Beitrag steht dort, bis ihn jemand von Hand entfernt.
 *
 * Die eigene Gesellschaftsseite ist der Ort: `/unternehmen/<slug>` zeigt die
 * veröffentlichten Beiträge dieser Gesellschaft (`oeffentlicheBeitraege`), und
 * der Anker springt auf den einen. Die Adresse entsteht deshalb HIER, im
 * Dienst, der den Mandanten kennt — nicht zweimal daneben, in einer Route und
 * in einem Nachtlauf, die beide raten müssten.
 *
 * `null` heisst „kein absoluter Link möglich" und ist kein Fehler: die eigene
 * Seite braucht keinen (D-532), und ein geratener Wirt wäre schlimmer als
 * keiner.
 */
async function beitragsadresse(
  kontext: SchreibZugriff, id: string, basis: string | null,
): Promise<string | null> {
  if (basis === null || basis === '') return null;
  const [m] = await kontext.abfrage<{ slug: string }>(
    `select m.slug from beitrag b join mandant m on m.id = b.mandant_id
      where b.id = $1::uuid`, [id]);
  if (m === undefined) return null;
  return `${basis.replace(/\/+$/u, '')}/unternehmen/${m.slug}#beitrag-${id}`;
}

/**
 * **Veröffentlichen — und was dabei ehrlich bleiben muss** (SOC-05, SOC-07).
 *
 * Die eigene Gesellschaftsseite bekommt den Beitrag IMMER: `status =
 * 'veroeffentlicht'` ist dort die ganze Handlung, die öffentliche Policy tut
 * den Rest. Deshalb steht `aufWebsite: true` im Ergebnis und nicht als Frage.
 *
 * Jeder fremde Kanal wird EINZELN gefragt, und sein Ergebnis steht einzeln da.
 * Ein nicht verbundener Kanal ist `nicht_verbunden` — nie `veroeffentlicht`,
 * nie stillschweigend übersprungen. Ein Beitrag, der auf der eigenen Seite
 * steht und bei Instagram liegen blieb, sagt genau das.
 */
export async function veroeffentliche(
  kontext: SchreibZugriff, id: string, basis: string | null,
): Promise<Veroeffentlichung> {
  const b = await ladeBeitrag(kontext, id);
  if (b === null) throw new SocialFehler('Diesen Beitrag gibt es nicht.', 'unbekannt');
  if (naechsterStatus(b.status, 'veroeffentlichen') === null) {
    throw new SocialFehler(
      'Veröffentlicht wird, was freigegeben oder geplant ist — nichts sonst (SOC-08).',
      'falscher_status');
  }

  /*
   * **Der Stand wird ZUERST genommen, vor dem ersten Gang nach draussen.**
   *
   * Vorher stand dieses `update` am Ende: zwei gleichzeitige Anfragen (ein
   * doppelter Klick genuegt) lasen beide „freigegeben", riefen beide jeden
   * Adapter und setzten danach beide denselben Status. Was dabei doppelt
   * geschieht, ist nicht der Datenbankschreibvorgang — es ist die AUSSENDUNG.
   * Ein zweiter Beitrag auf LinkedIn nimmt kein `update` zurueck.
   *
   * Wer die Bedingung nicht mehr erfuellt, faellt hier heraus, bevor
   * irgendein Kanal gefragt wurde. Und der Status ist ab diesem Punkt
   * ehrlich: auf der eigenen Gesellschaftsseite STEHT der Beitrag jetzt — die
   * fremden Kanaele tragen ihr Ergebnis einzeln daneben.
   */
  await schreibeWennNoch(kontext, id, b.status,
    `update beitrag set status = 'veroeffentlicht', veroeffentlicht_am = now(),
                        geaendert_von = $2::uuid
      where id = $1::uuid`,
    [id, kontext.benutzerId]);

  const adresse = await beitragsadresse(kontext, id, basis);
  const zeilen = await kanaeleZuBeitrag(kontext, id);
  const ergebnisse = await sendeKanaele(
    kontext, id,
    { beitragId: b.id, titel: b.titel, text: b.text, adresse },
    zeilen.filter((z) => z.ergebnis !== 'veroeffentlicht'));

  return { beitragId: id, aufWebsite: true, kanaele: ergebnisse };
}

/**
 * **Fehlgeschlagene Kanaele erneut senden** (SOC-07, Copilot-Befund auf PR 16).
 *
 * Der Befund stimmte: ein Kanal mit `ergebnis = 'fehlgeschlagen'` wurde nie
 * wieder versucht. Der Planlauf holt nur `geplant`e Beitraege, und der Beitrag
 * ist danach `veroeffentlicht` — im ganzen Baum gab es keine Stelle, die ihn
 * wiederholt.
 *
 * **Der Status bleibt, und `veroeffentlicht_am` bleibt.** Die eigene
 * Gesellschaftsseite ist kein Kanal: dort STEHT der Beitrag, seit der Status
 * es sagt. Ihn wegen Instagram zurueckzuhalten hiesse, die eigene Seite von
 * einer fremden Plattform abhaengig zu machen.
 *
 * **`nicht_verbunden` wird NICHT wiederholt.** Das ist kein Fehlschlag,
 * sondern ein bekannter Zustand (O-10) — ein Knopf, der ihn jede Woche neu
 * versucht, erzeugt Rauschen und kein Ergebnis.
 */
export async function sendeErneut(
  kontext: SchreibZugriff, id: string, basis: string | null,
): Promise<Veroeffentlichung> {
  const b = await ladeBeitrag(kontext, id);
  if (b === null) throw new SocialFehler('Diesen Beitrag gibt es nicht.', 'unbekannt');
  if (naechsterStatus(b.status, 'erneut_senden') === null) {
    throw new SocialFehler(
      'Erneut gesendet wird nur, was veröffentlicht ist.', 'falscher_status');
  }

  /*
   * **Die Kanaele werden BEANSPRUCHT, bevor irgendetwas hinausgeht.**
   *
   * Vorher las diese Funktion die `fehlgeschlagen`en Zeilen und sendete
   * danach. Zwei gleichzeitige Klicks — ein doppelter genuegt — lasen beide
   * dieselben Zeilen und riefen beide den Adapter: ein zweiter Beitrag auf
   * LinkedIn, den kein `update` zurueckholt. `veroeffentliche` hatte diesen
   * Riegel von Anfang an (dort ueber `beitrag.status`); hier fehlte er, weil
   * der Status sich absichtlich NICHT aendert. Gemeldet hat das die
   * Copilot-Runde auf PR 16.
   *
   * Der Anspruch ist das `update … where ergebnis = 'fehlgeschlagen'
   * returning`: PostgreSQL entscheidet, wer die Zeile bekommt, und der
   * Zweite bekommt sie nicht. `offen` ist der Zwischenzustand, den es
   * ohnehin gibt — eine Zeile, die gesendet werden soll und noch keine
   * Antwort hat.
   */
  const beansprucht = await kontext.schreibe<{ kanalId: string }>(
    `update beitrag_kanal set ergebnis = 'offen', meldung = null
      where beitrag_id = $1::uuid and mandant_id = app.aktiver_mandant()
        and ergebnis = 'fehlgeschlagen'
      returning kanal_id as "kanalId"`,
    [id]);
  if (beansprucht.length === 0) {
    throw new SocialFehler(
      'Kein Kanal ist fehlgeschlagen. Ein nicht verbundener Kanal ist kein '
      + 'Fehlschlag, sondern ein bekannter Zustand (O-10) — ihn zu wiederholen '
      + 'änderte nichts.', 'nichts_zu_tun');
  }
  const gehoertMir = new Set(beansprucht.map((z) => z.kanalId));
  const offen = (await kanaeleZuBeitrag(kontext, id))
    .filter((z) => gehoertMir.has(z.kanalId));

  const adresse = await beitragsadresse(kontext, id, basis);
  const ergebnisse = await sendeKanaele(
    kontext, id, { beitragId: b.id, titel: b.titel, text: b.text, adresse }, offen);
  return { beitragId: id, aufWebsite: true, kanaele: ergebnisse };
}

/** Was die öffentliche Gesellschaftsseite zeigt (SOC-05). */
export async function oeffentlicheBeitraege(
  kontext: LeseKontext, mandantId: string, grenze = 6,
): Promise<readonly BeitragZeile[]> {
  return kontext.abfrage<BeitragZeile>(
    `select ${FELDER}
       from beitrag b
      where b.mandant_id = $1::uuid and b.status = 'veroeffentlicht'
        and b.zurueckgezogen_am is null
      order by b.veroeffentlicht_am desc
      limit $2::int`,
    [mandantId, grenze]);
}

/**
 * Die vier Arten, nach denen `/beitraege` und `/news` sich unterscheiden
 * (SOC-02, SEITENKARTE §2.2).
 *
 * **Warum es zwei Listen gibt und nicht eine.** Die Karte führt beide Adressen
 * getrennt, und sie meinen Verschiedenes: `/news` ist das, was eine
 * Gesellschaft ankündigt — eine Neuigkeit oder eine Aktualisierung, die Sorte
 * Eintrag, die in eine Pressemitteilung gehört. `/beitraege` ist alles, was
 * sie öffentlich geschrieben hat, Projektschauen eingeschlossen. Die Trennung
 * steht deshalb an der ART, die `beitrag_art` ohnehin führt, und nicht an
 * einer zweiten Spalte, die jemand pflegen müsste.
 *
 * // TODO(client, O-548): Zählt eine `projektschau` für den Kunden zu den
 * // „Neuigkeiten"? Hier NICHT — sie hat ihre eigene Liste unter `/projekte`.
 * // Wenn die Gruppe das anders sieht, ist es diese eine Zeile.
 */
export const NEUIGKEITS_ARTEN: readonly string[] = ['neuigkeit', 'aktualisierung'];

/**
 * Welches der beiden Segmente die KANONISCHE Adresse eines Beitrags traegt.
 *
 * **Warum das eine Funktion ist und nicht zweimal derselbe Vergleich.**
 * `/unternehmen/<b>/news/<slug>` und `/unternehmen/<b>/beitraege/<slug>`
 * liefern dieselbe Zeile — `oeffentlicherBeitragNachSlug` kennt keinen
 * Artenfilter. Ohne EINE Regel erklaerte die Sitemap die eine Adresse zur
 * kanonischen und die Seite die andere, und beide waeren indexierbar: genau
 * die Doppelung, wegen der die kurzen Gesellschaftsadressen einmal geloescht
 * worden sind (§2.2). Gefragt wird deshalb an einer Stelle, und Sitemap wie
 * `generateMetadata` fragen dieselbe.
 */
export function beitragSegment(art: string): 'news' | 'beitraege' {
  return NEUIGKEITS_ARTEN.includes(art) ? 'news' : 'beitraege';
}

/**
 * Die Neuigkeiten EINER Gesellschaft — `/unternehmen/<bereich>/news`.
 *
 * Dieselben drei Bedingungen wie überall auf dem öffentlichen Weg:
 * veröffentlicht, nicht zurückgezogen, dieser Mandant. Sie stehen hier UND in
 * `t_beitrag_oeffentlich`; eine vergessene Bedingung im Code zeigt sonst einen
 * Entwurf, den niemand freigegeben hat.
 */
export async function oeffentlicheNeuigkeiten(
  kontext: LeseKontext, mandantId: string, grenze = 24,
): Promise<readonly BeitragZeile[]> {
  return kontext.abfrage<BeitragZeile>(
    `select ${FELDER}
       from beitrag b
      where b.mandant_id = $1::uuid and b.status = 'veroeffentlicht'
        and b.zurueckgezogen_am is null
        and b.art::text = any($2::text[])
      order by b.veroeffentlicht_am desc, b.id
      limit $3::int`,
    [mandantId, NEUIGKEITS_ARTEN, grenze]);
}

/** Ein einzelner Beitrag unter seiner kanonischen Adresse (SEITENKARTE §2.2). */
export async function oeffentlicherBeitragNachSlug(
  kontext: LeseKontext, mandantId: string, slug: string,
): Promise<BeitragZeile | null> {
  const [z] = await kontext.abfrage<BeitragZeile>(
    `select ${FELDER}
       from beitrag b
      where b.mandant_id = $1::uuid and b.slug = $2
        and b.status = 'veroeffentlicht' and b.zurueckgezogen_am is null`,
    [mandantId, slug]);
  return z ?? null;
}

/** Ein Beitrag MIT seiner Gesellschaft — für die Gruppenliste `/news`. */
export interface BeitragMitBereich extends BeitragZeile {
  readonly bereichSlug: string;
  readonly bereichName: string;
}

/**
 * Die Gruppenliste `/news` — über alle Gesellschaften, nach Datum.
 *
 * **Jeder Eintrag zeigt auf die Gesellschaftsadresse**, nicht auf sich selbst:
 * §2.2 macht `/unternehmen/<bereich>/news/<slug>` zur kanonischen Adresse, und
 * diese Liste setzt `rel=canonical` darauf. Deshalb reist der Bereichs-Slug
 * mit, statt im Code nachgeschlagen zu werden.
 */
export async function neuigkeitenDerGruppe(
  kontext: LeseKontext, grenze = 24,
): Promise<readonly BeitragMitBereich[]> {
  return kontext.abfrage<BeitragMitBereich>(
    `select ${FELDER},
            m.slug as "bereichSlug", m.name as "bereichName"
       from beitrag b
       join mandant m on m.id = b.mandant_id
      where b.status = 'veroeffentlicht' and b.zurueckgezogen_am is null
        and b.art::text = any($1::text[])
        and m.archiviert_am is null
      order by b.veroeffentlicht_am desc, b.id
      limit $2::int`,
    [NEUIGKEITS_ARTEN, grenze]);
}

export interface Quelle {
  readonly id: string;
  readonly titel: string;
  readonly hinweis: string | null;
}

export interface Quellen {
  readonly projekte: readonly Quelle[];
  readonly referenzen: readonly Quelle[];
}

/**
 * **Woraus ein Beitrag entstehen darf** (SOC-04, PRO-05).
 *
 * Projekte dieser Gesellschaft, und Referenzen — aber nur die mit einer
 * Kundenfreigabe. Die Bedingung steht hier UND in der Policy von `referenz`
 * (0015): ein Kundenname auf einer Website ohne dessen Zustimmung ist kein
 * Anzeigefehler, sondern ein Problem, das man durch Löschen nicht ungeschehen
 * macht. Wer keine freigegebene Referenz hat, bekommt hier eine leere Liste
 * und einen Satz dazu — nicht die Auswahl aller Referenzen mit einem Haken,
 * den jemand später wegklickt.
 */
export async function quellenFuerBeitrag(kontext: LeseKontext): Promise<Quellen> {
  const projekte = await kontext.abfrage<Quelle>(
    /*
     * `bezeichnung`, nicht `name` -- und `archiviert_am`, nicht
     * `geloescht_am`: die Spalte heisst hier so, weil ein Projekt nicht
     * geloescht, sondern abgelegt wird. Kein `auftragssumme_netto_cent` in
     * der Auswahl: die Spalte ist geschuetzt und wird nur als Aggregat
     * gelesen (K-05) -- ein Beitragsentwurf braucht sie ohnehin nicht.
     */
    `select p.id, p.nummer || ' · ' || p.bezeichnung as titel,
            p.status::text as hinweis
       from projekt p
      where p.archiviert_am is null
      order by coalesce(p.geaendert_am, p.erstellt_am) desc
      limit 50`);
  const referenzen = await kontext.abfrage<Quelle>(
    `select r.id, r.titel, r.kunde_name as hinweis
       from referenz r
      where r.geloescht_am is null and r.freigegeben_vom_kunden
      order by r.sortierung, r.titel
      limit 50`);
  return { projekte, referenzen };
}

export interface KanalBilanz {
  readonly plattform: Plattform;
  readonly verbunden: boolean;
  readonly veroeffentlicht: number;
  readonly nichtVerbunden: number;
  readonly fehlgeschlagen: number;
  readonly offen: number;
}

export interface SocialStatistik {
  readonly jeStatus: Readonly<Record<string, number>>;
  readonly jeKanal: readonly KanalBilanz[];
  readonly aufWebsite: number;
  /** Median der Stunden von „vorgelegt" bis zur Entscheidung — oder null. */
  readonly pruefdauerStunden: number | null;
  /**
   * **`null` hat zwei Bedeutungen, und der Bildschirm muss sie trennen.**
   *
   * Entweder es wurde noch nie etwas entschieden — oder dieser Mensch darf die
   * Zahl nicht sehen. „Wie schnell entscheidet jemand" ist eine Aussage ueber
   * eine PERSON und traegt deshalb ein eigenes Recht
   * (`freigabe.pruefdauer_lesen`, gebunden an `super_admin`); die Seite
   * `/freigaben/pruefdauer` haelt sich daran, diese hier tat es nicht.
   */
  readonly pruefdauerVerdeckt: boolean;
}

/**
 * Was diese Plattform über ihre eigenen Beiträge WEISS (SOC-01).
 *
 * **Reichweite und Interaktionen stehen bewusst nicht dabei.** Die kennt nur
 * die Plattform, auf der ein Beitrag steht, und solange kein Kanal verbunden
 * ist (O-10), gibt es sie nicht. Eine Zahl dafür zu zeigen — und sei es eine
 * Null — liest sich wie eine Messung; „nicht verbunden" ist die Wahrheit.
 *
 * Was hier steht, ist deshalb das Eigene: wie viel wartet, wie viel ging
 * hinaus, wo es liegen blieb, und wie lange eine Freigabe im Schnitt braucht.
 */
export async function statistik(kontext: LeseKontext): Promise<SocialStatistik> {
  const stand = await kontext.abfrage<{ status: string; anzahl: string }>(
    `select status::text as status, count(*)::text as anzahl from beitrag group by status`);
  const jeStatus: Record<string, number> = {};
  for (const z of stand) jeStatus[z.status] = Number(z.anzahl);

  const kanaele = await kontext.abfrage<{
    plattform: Plattform; verbunden: boolean;
    veroeffentlicht: string; nichtVerbunden: string; fehlgeschlagen: string; offen: string;
  }>(
    `select k.plattform::text as plattform, k.verbunden,
            count(*) filter (where bk.ergebnis = 'veroeffentlicht')::text as veroeffentlicht,
            count(*) filter (where bk.ergebnis = 'nicht_verbunden')::text as "nichtVerbunden",
            count(*) filter (where bk.ergebnis = 'fehlgeschlagen')::text as fehlgeschlagen,
            count(*) filter (where bk.ergebnis = 'offen')::text as offen
       from social_kanal k
       left join beitrag_kanal bk on bk.mandant_id = k.mandant_id and bk.kanal_id = k.id
      group by k.plattform, k.verbunden, k.sortierung
      order by k.sortierung, k.plattform`);

  /*
   * Die Pruefdauer wird nur BERECHNET, wenn sie auch gezeigt werden darf —
   * nicht berechnet und dann verworfen. Eine Zahl, die der Server ermittelt
   * und der Bildschirm verschweigt, ist eine Zahl, die beim naechsten Umbau
   * jemand versehentlich wieder hinschreibt.
   */
  const [recht] = await kontext.abfrage<{ ja: boolean }>(
    `select app.hat_recht('freigabe.pruefdauer_lesen', app.aktiver_mandant()) as ja`);
  const darfPruefdauer = recht?.ja ?? false;

  const [dauer] = darfPruefdauer
    ? await kontext.abfrage<{ stunden: number | null }>(
      /*
       * Der Median, nicht das Mittel: eine einzige Freigabe, die ueber den
       * Urlaub liegen blieb, zoege ein Mittel um Tage hoch und behauptete
       * damit einen Zustand, den es nie gab.
       */
      `select percentile_cont(0.5) within group (
                order by extract(epoch from (f.freigegeben_am - f.erstellt_am)) / 3600.0
              ) as stunden
         from freigabe f
         join beitrag b on b.freigabe_id = f.id
        where f.freigegeben_am is not null`)
    : [];

  const [website] = await kontext.abfrage<{ anzahl: string }>(
    `select count(*)::text as anzahl from beitrag
      where status = 'veroeffentlicht' and zurueckgezogen_am is null`);

  return {
    jeStatus,
    jeKanal: kanaele.map((k) => ({
      plattform: k.plattform,
      verbunden: k.verbunden,
      veroeffentlicht: Number(k.veroeffentlicht),
      nichtVerbunden: Number(k.nichtVerbunden),
      fehlgeschlagen: Number(k.fehlgeschlagen),
      offen: Number(k.offen),
    })),
    aufWebsite: Number(website?.anzahl ?? '0'),
    pruefdauerStunden: dauer?.stunden ?? null,
    pruefdauerVerdeckt: !darfPruefdauer,
  };
}
