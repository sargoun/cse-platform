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

const FELDER = `b.id, b.titel, b.text, b.art::text as art, b.status::text as status,
                b.geplant_fuer as "geplantFuer", b.veroeffentlicht_am as "veroeffentlichtAm",
                b.zurueckgezogen_am as "zurueckgezogenAm", b.freigabe_id as "freigabeId",
                b.projekt_id as "projektId", b.referenz_id as "referenzId",
                b.erstellt_am as "erstelltAm"`;

export async function listeBeitraege(
  kontext: LeseKontext, filter: { status?: BeitragStatus } = {},
): Promise<readonly BeitragZeile[]> {
  const status = filter.status ?? null;
  return kontext.abfrage<BeitragZeile>(
    `select ${FELDER}
       from beitrag b
      where ($1::text is null or b.status::text = $1)
      order by coalesce(b.veroeffentlicht_am, b.geplant_fuer, b.erstellt_am) desc, b.id`,
    [status]);
}

export async function ladeBeitrag(
  kontext: LeseZugriff, id: string,
): Promise<BeitragZeile | null> {
  const [z] = await kontext.abfrage<BeitragZeile>(
    `select ${FELDER} from beitrag b where b.id = $1::uuid`, [id]);
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
  await kontext.schreibe(
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
export async function legeVor(kontext: SchreibKontext, id: string): Promise<string> {
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

  await kontext.schreibe(
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
    await kontext.schreibe(
      `update beitrag set status = 'entwurf', freigabe_id = null, geaendert_von = $2::uuid
        where id = $1::uuid`, [id, kontext.benutzerId]);
    return;
  }
  await kontext.schreibe(
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
  await kontext.schreibe(
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
  kontext: SchreibZugriff, id: string, adresse: string | null,
): Promise<Veroeffentlichung> {
  const b = await ladeBeitrag(kontext, id);
  if (b === null) throw new SocialFehler('Diesen Beitrag gibt es nicht.', 'unbekannt');
  if (naechsterStatus(b.status, 'veroeffentlichen') === null) {
    throw new SocialFehler(
      'Veröffentlicht wird, was freigegeben oder geplant ist — nichts sonst (SOC-08).',
      'falscher_status');
  }

  const auftrag: BeitragAuftrag = {
    beitragId: b.id, titel: b.titel, text: b.text, adresse,
  };
  const zeilen = await kanaeleZuBeitrag(kontext, id);
  const ergebnisse: Veroeffentlichung['kanaele'][number][] = [];

  for (const z of zeilen) {
    if (z.ergebnis === 'veroeffentlicht') continue;
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
      const meldung = fehler instanceof Error ? fehler.message : String(fehler);
      const ergebnis = verbunden ? 'nicht_verbunden' as const : 'fehlgeschlagen' as const;
      await kontext.schreibe(
        `update beitrag_kanal
            set ergebnis = $3::kanal_ergebnis, meldung = $4, versuche = versuche + 1
          where beitrag_id = $1::uuid and kanal_id = $2::uuid`,
        [id, z.kanalId, ergebnis, meldung]);
      ergebnisse.push({ plattform: z.plattform, ergebnis, meldung });
    }
  }

  await kontext.schreibe(
    `update beitrag set status = 'veroeffentlicht', veroeffentlicht_am = now(),
                        geaendert_von = $2::uuid
      where id = $1::uuid`,
    [id, kontext.benutzerId]);

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

  const [dauer] = await kontext.abfrage<{ stunden: number | null }>(
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
      where f.freigegeben_am is not null`);

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
  };
}
