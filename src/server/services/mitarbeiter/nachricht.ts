import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';

/**
 * Die Nachrichtenfäden EINES MENSCHEN — der Posteingang unter
 * `/portal/mein/nachrichten` (EMP-11, NOT-03, D-09, K-18).
 *
 * **Der Befund, der diese Datei nötig machte — ein Nutzerbericht aus dem
 * Betrieb.** Die Gruppenleitung schrieb aus `/portal/[mandant]/nachrichten`
 * eine interne Nachricht an eine Mitarbeiterin. Die Oberfläche meldete
 * „gesendet". In ihrem Konto kam nichts an.
 *
 * Der Grund war keine Policy und keine falsche Empfängerart, sondern eine
 * Verwechslung von TABELLEN: der Sendeweg schreibt `nachricht` +
 * `nachricht_empfaenger`, und der persönliche Posteingang las ausschliesslich
 * `benachrichtigung` — Wächter-, Ablauf- und Fristmeldungen (NOT-01). Zwei
 * verschiedene Tabellen mit zwei verschiedenen Zwecken. Der Bildschirm konnte
 * eine Nachricht gar nicht anzeigen. Das Kundenportal las über
 * `services/kundenportal/nachricht` die richtige Tabelle — der Weg zum KUNDEN
 * funktionierte, der zur KRAFT nicht.
 *
 * **Diese Datei liest `nachricht`, `benachrichtigung/posteingang.ts` liest
 * weiter `benachrichtigung`, und die Seite führt beides zusammen.** Nicht
 * zusammengelegt: eine Systemmeldung hat ein Ziel, einen Datensatz und keinen
 * Absender; ein Faden hat einen Absender, einen Verlauf und eine Antwort. Wer
 * sie in eine Tabelle zwänge, verlöre bei einer von beiden die Hälfte.
 *
 * **`benutzer` ist im Personen-Scope unlesbar — bis auf die eigene Zeile.**
 * `t_benutzer_lesen` (0007) hängt am aktiven Mandanten, und der ist hier NULL
 * (K-20). Ein `left join benutzer` lieferte deshalb stillschweigend NULL, und
 * auf dem Telefon stünde „Nachricht von —". Der Name kommt darum aus
 * `kern.nachricht_absender_name()` (0350): EIN TEXT an jemanden, der im Faden
 * steht — statt eines Lesepfades auf eine Tabelle mit E-Mail, Sperrfrist und
 * globaler Rolle darin (K-05).
 *
 * **Die Ungelesen-Zahl zählt nur, was MIR zugestellt ist**, und prüft dabei
 * `benutzer`-Id UND `person`-Id: eine Anmelde-Id und eine Personen-Id sind
 * zwei verschiedene Ids (D-09, §7.9 B11). Genau davor warnt der Kommentar am
 * Enum `nachricht_empfaenger_typ` in `0231` wörtlich — eine an `person`
 * adressierte Nachricht gegen die Anmelde-Id geprüft ist für ihren Empfänger
 * unsichtbar.
 */

/** Wie viele Fäden der Posteingang höchstens holt. Dieselbe Grenze wie NOT-01. */
export const FADEN_GRENZE = 100;

export interface MeinFadenkopf {
  readonly threadId: string;
  readonly betreff: string | null;
  /** Wie viele Zeilen dieses Fadens diese Sitzung sehen darf. */
  readonly anzahl: number;
  /** Wie viele davon MIR zugestellt und ungelesen sind. */
  readonly ungelesen: number;
  readonly letzteAktivitaet: Date;
  /** Der Anzeigename der letzten Absenderin — oder `null`, wenn unauflösbar. */
  readonly absender: string | null;
  /** Ist die letzte Zeile von mir selbst? Dann steht kein fremder Name davor. */
  readonly letzteVonMir: boolean;
  readonly auszug: string;
  readonly geschlossen: boolean;
  readonly mandantSlug: string | null;
  readonly mandantName: string | null;
}

interface KopfRoh {
  readonly thread_id: string;
  readonly betreff: string | null;
  readonly anzahl: string;
  readonly ungelesen: string;
  readonly letzte_aktivitaet: Date | string;
  readonly absender: string | null;
  readonly letzte_von_mir: boolean | null;
  readonly auszug: string | null;
  readonly geschlossen: boolean | null;
  readonly mandant_slug: string | null;
  readonly mandant_name: string | null;
}

function alsInstant(wert: Date | string | null | undefined): Date | null {
  if (wert === null || wert === undefined) return null;
  return wert instanceof Date ? wert : new Date(wert);
}

/**
 * **Der Mandant kommt aus der ZEILE, nicht aus der Wurzel.**
 *
 * Die Fadenwurzel muss für diese Sitzung nicht sichtbar sein: die Leitung
 * kann einen Vorgang eröffnen und die Kraft erst in einer späteren Zeile
 * adressieren. Der Mandant der sichtbaren Zeilen ist trotzdem eindeutig —
 * `nachricht_thread_fk` ist zusammengesetzt, ein Faden liegt in genau einer
 * Gesellschaft. (`array_agg` und nicht `min`: für `uuid` gibt es in Postgres
 * keine Aggregatfunktion `min`, und der Fehler fällt erst zur Laufzeit.)
 *
 * Und `left join mandant`: fehlte die Gesellschaft, stünde die Zeile ohne
 * Zugehörigkeit da statt gar nicht (EMP-14, D-09 — ein Mensch, zwei GmbHs).
 */
const KOPF_CTE = `
  with f as (
    select n.thread_id,
           (array_agg(distinct n.mandant_id))[1] as mandant_id,
           count(distinct n.id) as anzahl,
           max(n.erstellt_am)   as letzte_aktivitaet,
           count(distinct n.id) filter (
             where e.id is not null and e.gelesen_am is null) as ungelesen
      from nachricht n
      left join nachricht_empfaenger e
             on e.mandant_id = n.mandant_id and e.nachricht_id = n.id
            and ((e.empfaenger_typ = 'benutzer'
                  and e.empfaenger_id = app.aktueller_benutzer())
              or (e.empfaenger_typ = 'person'
                  and e.empfaenger_id = app.aktuelle_person()))
     where n.geloescht_am is null
     group by n.thread_id
  )`;

/**
 * Ein Kopf je Faden, neueste Aktivität zuerst.
 *
 * Kein Filter auf den Mandanten: der Personen-Scope spannt über die lebenden
 * Beschäftigungen dieses Menschen (`app.sichtbare_mandanten()`, 0004), und
 * genau das ist der Posteingang — ein Mensch, ein Telefon, zwei
 * Gesellschaften.
 */
export async function listeMeineFaeden(
  kontext: LeseKontext, grenze: number = FADEN_GRENZE,
): Promise<readonly MeinFadenkopf[]> {
  const zeilen = await kontext.abfrage<KopfRoh>(
    `${KOPF_CTE}
     select f.thread_id,
            f.anzahl::text   as anzahl,
            f.ungelesen::text as ungelesen,
            f.letzte_aktivitaet,
            w.betreff,
            (w.geschlossen_am is not null) as geschlossen,
            m.slug as mandant_slug, m.name as mandant_name,
            left(l.koerper, 160) as auszug,
            l.von_mir as letzte_von_mir,
            kern.nachricht_absender_name(l.id) as absender
       from f
       left join mandant m on m.id = f.mandant_id
       /* Die Wurzel trägt Betreff und Abschluss — wenn sie sichtbar ist. */
       left join nachricht w
              on w.mandant_id = f.mandant_id and w.id = f.thread_id
             and w.geloescht_am is null
       /* Und die jüngste sichtbare Zeile trägt Auszug und Absender. */
       left join lateral (
         select x.id, x.koerper,
                (x.absender_benutzer_id = app.aktueller_benutzer()) as von_mir
           from nachricht x
          where x.mandant_id = f.mandant_id and x.thread_id = f.thread_id
            and x.geloescht_am is null
          order by x.erstellt_am desc, x.id
          limit 1) l on true
      order by f.letzte_aktivitaet desc, f.thread_id
      limit $1`,
    [Math.min(Math.max(grenze, 1), 500)],
  );

  return zeilen.map((z) => ({
    threadId: z.thread_id,
    betreff: z.betreff,
    anzahl: Number(z.anzahl),
    ungelesen: Number(z.ungelesen),
    letzteAktivitaet: alsInstant(z.letzte_aktivitaet) ?? new Date(0),
    absender: z.absender,
    letzteVonMir: z.letzte_von_mir === true,
    auszug: z.auszug ?? '',
    geschlossen: z.geschlossen === true,
    mandantSlug: z.mandant_slug,
    mandantName: z.mandant_name,
  }));
}

/* --------------------------------------------------------------- Ein Faden */

export interface MeineZeile {
  readonly id: string;
  readonly betreff: string | null;
  readonly koerper: string;
  readonly erstelltAm: Date;
  readonly absender: string | null;
  readonly vonMir: boolean;
  /** Ist diese Zeile AN MICH gerichtet — oder lese ich nur mit? */
  readonly anMich: boolean;
  readonly gelesenAm: Date | null;
  /**
   * Wie viele Anlagen an dieser Zeile hängen — die ZAHL, nicht die Dateien.
   *
   * `t_anhang_eigene` (0231) gibt die Kindzeilen im Personen-Scope heraus;
   * die Datei selbst hängt an `dokument`, und dafür gibt es im
   * Mitarbeiterportal keinen Lesepfad. Die Zahl steht trotzdem da: eine
   * Nachricht mit einer Anlage, die auf dem Telefon aussieht wie eine ohne,
   * ist die schlechtere Antwort — dann sucht niemand nach der Datei, von der
   * die Nachricht spricht. Siehe `ANLAGEN_ABRUFBAR`.
   */
  readonly anhaenge: number;
}

export interface MeinFaden {
  readonly threadId: string;
  readonly betreff: string | null;
  readonly geschlossen: boolean;
  readonly ungelesen: number;
  readonly mandantSlug: string | null;
  readonly mandantName: string | null;
  readonly zeilen: readonly MeineZeile[];
}

interface ZeileRoh {
  readonly id: string;
  readonly betreff: string | null;
  readonly koerper: string;
  readonly erstellt_am: Date | string;
  readonly absender: string | null;
  readonly von_mir: boolean | null;
  readonly an_mich: boolean | null;
  readonly gelesen_am: Date | string | null;
  readonly anhaenge: number;
}

/**
 * Ein Faden in Zeitfolge — oder `null`.
 *
 * `null` heisst „gibt es nicht ODER darf diese Sitzung nicht sehen", und die
 * Seite antwortet darauf mit 404 und nie mit 403 (AUT-06). Ein eigener Code
 * bestätigte die Existenz eines Vorgangs, in dem dieser Mensch nicht steht.
 *
 * **Die Empfängerzeilen kommen als Unterabfrage, nicht als `join`.** Ein Mensch
 * kann in derselben Nachricht zweimal stehen — einmal über seine Anmelde-Id
 * und einmal über seine Personen-Id (D-09). Ein `left join` verdoppelte dann
 * die Zeile, und der Faden zeigte denselben Satz zweimal.
 */
export async function ladeMeinenFaden(
  kontext: LeseKontext, threadId: string,
): Promise<MeinFaden | null> {
  const eigene = `
    from nachricht_empfaenger e
    where e.mandant_id = n.mandant_id and e.nachricht_id = n.id
      and ((e.empfaenger_typ = 'benutzer' and e.empfaenger_id = app.aktueller_benutzer())
        or (e.empfaenger_typ = 'person'   and e.empfaenger_id = app.aktuelle_person()))`;

  const zeilen = await kontext.abfrage<ZeileRoh>(
    `select n.id, n.betreff, n.koerper, n.erstellt_am,
            kern.nachricht_absender_name(n.id) as absender,
            (n.absender_benutzer_id = app.aktueller_benutzer()) as von_mir,
            exists (select 1 ${eigene}) as an_mich,
            /*
             * **Gelesen heisst: KEINE eigene Zeile mehr offen.** Ein Mensch
             * kann in derselben Nachricht zweimal stehen (Anmelde-Id UND
             * Personen-Id, D-09); ein min() über gelesen_am überginge die ungestempelte
             * und meldete „gelesen", während die Liste dieselbe Zeile weiter
             * als offen zählt. Zwei Bildschirme mit zwei Antworten auf
             * dieselbe Frage machen beide unglaubwürdig.
             *
             * (Keine Schraegstriche-Anfuehrungszeichen in diesem Kommentar: er
             * steht in einem Template-Literal, und ein Backtick darin beendet
             * die Zeichenkette.)
             */
            (select case when bool_or(e.gelesen_am is null) then null
                         else max(e.gelesen_am) end ${eigene}) as gelesen_am,
            (select count(*) from nachricht_anhang a
              where a.mandant_id = n.mandant_id and a.nachricht_id = n.id)::int as anhaenge
       from nachricht n
      where n.thread_id = $1::uuid and n.geloescht_am is null
      order by n.erstellt_am, n.id`,
    [threadId],
  );
  if (zeilen.length === 0) return null;

  const [kopf] = await kontext.abfrage<{
    betreff: string | null; geschlossen: boolean;
    mandant_slug: string | null; mandant_name: string | null;
  }>(
    `select w.betreff, (w.geschlossen_am is not null) as geschlossen,
            m.slug as mandant_slug, m.name as mandant_name
       from nachricht w
       left join mandant m on m.id = w.mandant_id
      where w.id = $1::uuid`,
    [threadId],
  );

  /*
   * Fällt die Wurzel unter der RLS weg — die Kraft kam erst in einer späteren
   * Zeile dazu —, trägt die Gesellschaft die erste sichtbare Zeile. Die
   * Alternative wäre eine Zeile ohne Zugehörigkeit, und die ist in einem
   * Portal mit zwei Arbeitsverhältnissen unbrauchbar (EMP-14).
   */
  const [ersatz] = kopf === undefined
    ? await kontext.abfrage<{ mandant_slug: string | null; mandant_name: string | null }>(
      `select m.slug as mandant_slug, m.name as mandant_name
         from nachricht n
         left join mandant m on m.id = n.mandant_id
        where n.thread_id = $1::uuid and n.geloescht_am is null
        order by n.erstellt_am
        limit 1`,
      [threadId],
    )
    : [undefined];

  const abgebildet = zeilen.map((z) => ({
    id: z.id,
    betreff: z.betreff,
    koerper: z.koerper,
    erstelltAm: alsInstant(z.erstellt_am) ?? new Date(0),
    absender: z.absender,
    vonMir: z.von_mir === true,
    anMich: z.an_mich === true,
    gelesenAm: alsInstant(z.gelesen_am),
    anhaenge: Number(z.anhaenge ?? 0),
  }));

  return {
    threadId,
    betreff: kopf?.betreff ?? zeilen[0]?.betreff ?? null,
    geschlossen: kopf?.geschlossen === true,
    ungelesen: abgebildet.filter((z) => z.anMich && z.gelesenAm === null).length,
    mandantSlug: kopf?.mandant_slug ?? ersatz?.mandant_slug ?? null,
    mandantName: kopf?.mandant_name ?? ersatz?.mandant_name ?? null,
    zeilen: abgebildet,
  };
}

/* ------------------------------------------------------- Offene Fragen */

/**
 * **Darf eine Kraft von sich aus einen Faden ERÖFFNEN?** — heute nein, und
 * das ist keine technische Grenze.
 *
 * Antworten funktioniert vollständig: wer angeschrieben wird, darf zurück-
 * schreiben, und `antwortZiele` beantwortet die Frage „an wen" aus dem Faden
 * selbst. Beim ERSTEN Brief gibt es diese Antwort nicht — sie wäre eine
 * Empfängerliste, und die zusammenzustellen hiesse zu entscheiden, wen eine
 * Reinigungskraft anschreiben darf: ihre Einsatzleitung, jede Leitung ihrer
 * Gesellschaft, die Verwaltung, jedes Konto? Das ist eine betriebliche
 * Festlegung mit Folgen für die Erreichbarkeit der Leitung und nicht eine
 * Voreinstellung, die hier jemand rät.
 *
 * Die Datenbank stünde bereit: `nachricht.versenden` ist im Katalog (0008) an
 * die Rolle `mitarbeiter` gebunden, und `eroeffneFaden` in
 * `services/kern/nachricht.ts` schreibt intern und im Portal. Es fehlt allein
 * die Regel, wer in der Auswahlliste steht. Bis dahin sagt die Seite es als
 * Satz, statt einen Knopf zu zeigen, hinter dem eine leere Liste steht.
 *
 * // TODO(client, O-830): Darf eine Mitarbeiterin im Portal von sich aus eine Nachricht schreiben — und an wen (nur die Einsatzleitung des laufenden Einsatzes, jede Leitung ihrer Gesellschaft, die Verwaltung)?
 */
export const EIGENER_FADEN_MOEGLICH: boolean = false;

/**
 * **Sind Anlagen im Mitarbeiterportal abrufbar?** — heute nicht.
 *
 * Die ANZAHL ist lesbar (`t_anhang_eigene`, 0231), die Datei nicht: sie hängt
 * an `dokument`, und dort gibt es für den Personen-Scope keinen permissiven
 * Lesepfad. Einen zu setzen ist eine Entscheidung über Anlagen und nicht über
 * Policies — dieselbe Frage stellt O-671 für das Kundenportal, und sie gehört
 * je Portal beantwortet: ein Dienstplan-PDF an die Kraft ist etwas anderes als
 * eine Kalkulation an den Kunden.
 *
 * Die Seite zeigt deshalb die Zahl mit dem Satz, dass die Datei auf dem
 * bisherigen Weg kommt — statt eines Verweises, hinter dem 404 steht.
 *
 * // TODO(client, O-831): Darf eine Mitarbeiterin die Anlage einer internen Nachricht im Portal öffnen — also bekommt `dokument` einen permissiven Lesepfad für den Personen-Scope, und für welche Kategorien?
 */
export const ANLAGEN_ABRUFBAR: boolean = false;

/* ------------------------------------------------------- Der Weg zum Faden */

/**
 * Die Gesellschaft, in der dieser Faden liegt — oder `null`.
 *
 * **Der Umweg über zwei Scopes ist der Punkt** (K-18, wie
 * `api/mein/antraege`): im Personen-Scope ist `app.aktiver_mandant()` NULL,
 * und keine Schreibpolicy trifft zu. Also wird der Mandant ZUERST im
 * Personen-Scope aus dem Faden aufgelöst — eine fremde Id liefert dort null
 * Zeilen und damit 404 statt 403 (AUT-06) — und erst dann `withTenant` mit
 * genau diesem Mandanten betreten, mit `portal: 'mitarbeiter'`, damit die
 * K-04-Decke weiter gilt.
 *
 * Er kommt aus der DATENBANK und nie aus einem Feld der Anfrage (K-02,
 * Invariante 3).
 */
export async function mandantDesFadens(
  kontext: LeseKontext, threadId: string,
): Promise<string | null> {
  const [z] = await kontext.abfrage<{ mandant_id: string }>(
    `select n.mandant_id
       from nachricht n
      where n.thread_id = $1::uuid and n.geloescht_am is null
      order by n.erstellt_am
      limit 1`,
    [threadId],
  );
  return z?.mandant_id ?? null;
}

/**
 * An WEN die Antwort geht: an jeden, der mir in diesem Faden geschrieben hat.
 *
 * **Nicht `erbeEmpfaenger`** aus `services/kern/nachricht.ts`. Die Funktion
 * liest die Empfängerzeilen des Fadens, und unter der K-04-Decke
 * (`p_beteiligt`, 0231) sieht eine Kraft davon nur ihre EIGENEN. Geerbt
 * würde also die Zeile, die auf sie selbst zeigt — die Antwort landete in
 * ihrem eigenen Posteingang und nirgendwo sonst.
 *
 * Die Absenderseite ist dagegen lesbar: `nachricht` gibt ihr jede Zeile
 * heraus, in der sie steht, und `absender_benutzer_id` ist eine ihrer
 * Spalten. „Antworte denen, die mir geschrieben haben" ist ausserdem die
 * Regel, die ein Mensch erwartet.
 */
export async function antwortZiele(
  kontext: LeseKontext, threadId: string,
): Promise<readonly string[]> {
  const zeilen = await kontext.abfrage<{ id: string }>(
    `select distinct n.absender_benutzer_id as id
       from nachricht n
      where n.thread_id = $1::uuid and n.geloescht_am is null
        and n.absender_benutzer_id is not null
        and n.absender_benutzer_id <> app.aktueller_benutzer()`,
    [threadId],
  );
  return zeilen.map((z) => z.id);
}

/**
 * Darf in diesen Faden überhaupt geantwortet werden?
 *
 * Ein geschlossener Faden ist der Ersatz für eine Löschung (Invariante 8) —
 * er bleibt lesbar und nimmt nichts mehr auf. `schliesseFaden` in
 * `services/kern/nachricht.ts` wirft dafür; diese Funktion beantwortet die
 * Frage VOR dem Formular, damit die Seite den Knopf gar nicht erst zeigt.
 */
export async function fadenGeschlossen(
  kontext: LeseKontext, threadId: string,
): Promise<boolean> {
  const [z] = await kontext.abfrage<{ zu: boolean }>(
    `select (w.geschlossen_am is not null) as zu from nachricht w where w.id = $1::uuid`,
    [threadId],
  );
  return z?.zu === true;
}

/**
 * **Hier steht bewusst KEIN Schreibweg.**
 *
 * Geantwortet wird über `antworte` in `services/kern/nachricht.ts` — dem
 * Fachdienst, der den Faden ohnehin führt und im Dienstregister als
 * schreibend unter `nachricht.versenden` steht. Dieselbe Aufteilung wie beim
 * Antrag: `api/mein/antraege` löst die Beschäftigung im Portaldienst auf und
 * ruft dann `reicheAntragEin` aus `services/abwesenheit/antrag.ts`.
 *
 * Der Grund ist eine Zusage und keine Vorliebe: `tests/kern/mitarbeiter.test.ts`
 * verlangt, dass KEIN Dienst unter `services/mitarbeiter/` schreibt. Ein hier
 * angelegter vierter Schreibweg wäre genau der, der an den drei bekannten
 * vorbeiführt — und das Register, das die Gruppenansicht prüft (Invariante 10),
 * hätte ihn nie gesehen.
 *
 * Was diese Datei zum Antworten beiträgt, sind die zwei Fragen, die nur im
 * Personen-Scope beantwortbar sind: `mandantDesFadens` (K-18) und
 * `antwortZiele` (die K-04-Decke lässt die Empfängerliste nicht lesen).
 */
