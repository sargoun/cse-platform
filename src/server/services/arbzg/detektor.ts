/**
 * Der Detektor — er macht aus Befunden Zeilen, die jemand sieht (TIM-05,
 * TIM-06, TIM-14).
 *
 * `pruefung.ts` beantwortet die Frage „ist diese Person ueberlastet?" fuer
 * einen Aufruf. Diese Datei stellt sie **fuer alle**, naechtlich, und schreibt
 * das Ergebnis nach `planungs_konflikt` — dorthin, wo der Plan und der
 * Konflikteingang es lesen.
 *
 * ## Warum nicht die Ansicht selbst rechnet
 *
 * Eine Seite, die beim Aufruf nachrechnet, zeigt im Zweifel etwas anderes als
 * die Konfliktliste: zwei Wahrheiten ueber denselben Verstoss, und die
 * Planerin sieht die, die zufaellig in ihrem Bildschirm steht. Erkannt wird
 * einmal, gespeichert einmal, gelesen ueberall.
 *
 * ## Der Fingerabdruck ist die ganze Idempotenz
 *
 * `sha256(mandant + person + art + berliner Tag)` fuer Arbeitszeitbefunde:
 * eine Tagesgrenze verletzt man **einmal am Tag**, gleichgueltig wie viele
 * Schichten beigetragen haben. Waere der Zeitraum Teil des Abdrucks, praegte
 * jede Verschiebung um eine Minute einen neuen Befund, waehrend der alte fuer
 * immer offen stehen bliebe — und der Eingang fuellte sich mit Karteileichen,
 * bis niemand mehr hinsieht.
 *
 * Fuer Ueberschneidungen dagegen zaehlt die einzelne Zuordnung: die Tagesform
 * faltete zwei betroffene Schichten in eine Zeile, der Planer repariert eine,
 * und die andere bleibt unzulaessig besetzt, ohne dass irgendetwas es sagt.
 */
import { createHash } from 'node:crypto';
import { berlinKalendertag } from '../zeit/dauer.js';
import { pruefeEinsatz, type Abfrage, schreibeBefund } from './pruefung.js';
import type { ArbzgBefund } from '../zeit/arbzg.js';

/** Die vier Konfliktarten der Datenbank. */
export type KonfliktArt =
  | 'ueberschneidung' | 'qualifikation_entfallen' | 'arbzg' | 'aufzeichnungsfrist';

export interface DetektorBericht {
  readonly geprueft: number;
  readonly neu: number;
  readonly bestaetigt: number;
  readonly hinfaellig: number;
}

interface Kandidat {
  readonly personId: string;
  readonly anstellungId: string;
  /**
   * Die frueheste EIGENE Schicht des Tages — der Anker des Konflikts.
   *
   * Der Befund gilt dem Tag, nicht dieser Schicht: elf Stunden entstehen aus
   * mehreren. Die Zeile braucht aber einen Weg hinein (`pk_anker` verlangt
   * ihn, und DSH-04 auch), und der einzige, den der Planer in seinem
   * Mandanten oeffnen kann, ist eine eigene Schicht. Die fremde zu nennen
   * waere ohnehin K-06-widrig — er darf sie nicht sehen.
   */
  readonly einsatzId: string;
  readonly beginn: Date;
  readonly ende: Date;
}

/**
 * Der Fingerabdruck eines Arbeitszeitbefundes.
 *
 * Exportiert, weil ein Abdruck, den nur der Schreiber kennt, sich nicht
 * pruefen laesst — und weil der Test genau das tun muss: zweimal erkennen,
 * einmal Zeile.
 */
export function arbzgFingerabdruck(
  mandantId: string, personId: string, art: KonfliktArt, berlinTag: string,
): string {
  return createHash('sha256')
    .update([mandantId, personId, art, berlinTag].join(''))
    .digest('hex');
}

/** Der Abdruck einer Ueberschneidung — je Zuordnung, nicht je Tag. */
export function ueberschneidungsFingerabdruck(
  mandantId: string, personId: string, zuordnungId: string,
): string {
  return createHash('sha256')
    .update([mandantId, personId, 'ueberschneidung', zuordnungId].join(''))
    .digest('hex');
}

/**
 * Prueft alle Personen mit Schichten im Fenster und schreibt die Befunde.
 *
 * Das Fenster ist bewusst klein zu halten: `app.arbzg_belastung` laesst
 * hoechstens 35 Tage zu, und der Detektor ist ein Waechter, kein Export.
 */
export async function erkenneKonflikte(
  db: Abfrage, mandantId: string, vonUtc: Date, bisUtc: Date,
  /**
   * `true` heisst: dieser Lauf ist der NACHTLAUF und verbindet sich als
   * `cse_job`, nicht als `cse_app`.
   *
   * Die Unterscheidung muss hier stehen und kann nicht erraten werden: die
   * beiden Rollen haben verschiedene Leser fuer dieselbe Belastung, weil ein
   * Job keinen aktiven Mandanten hat (§6.4). Ohne dieses Kennzeichen las der
   * Nachtlauf `app.arbzg_belastung` — die nur `cse_app` gewaehrt ist — und
   * scheiterte mit `42501`, bevor ein Befund entstehen konnte.
   */
  alsJob = false,
): Promise<DetektorBericht> {
  const kandidaten = await ladeKandidaten(db, mandantId, vonUtc, bisUtc);
  let neu = 0;
  let bestaetigt = 0;
  const gesehen = new Set<string>();

  for (const k of kandidaten) {
    const ergebnis = await pruefeEinsatz(db, k.personId, k.beginn, k.ende,
      alsJob ? { jobMandantId: mandantId } : {});
    /**
     * **Jeder Befund wird AUFGEZEICHNET, aber nur einer bekommt eine Karte.**
     *
     * Elf Stunden an einem Tag verletzen § 3 ArbZG zweimal — die Acht-Stunden-
     * Grenze und die Zehn-Stunden-Grenze. Beide gehoeren in
     * `arbeitszeit_verstoss`: die zweite ist die schwerere, und wer spaeter
     * fragt, wie oft die harte Grenze fiel, findet sie sonst nicht.
     *
     * Der EINGANG dagegen soll je Person und Tag EINE Karte zeigen und nicht
     * fuenf; deshalb bleibt die Entdoppelung dort, und die Karte bekommt den
     * schwersten Befund. Vorher galt die Entdoppelung fuer beides — und der
     * Zehn-Stunden-Befund wurde nie aufgezeichnet.
     */
    const nachSchwere = [...ergebnis.befunde].sort(
      (a, b) => (a.schwere === b.schwere ? 0 : a.schwere === 'verstoss' ? -1 : 1));

    /**
     * **Erst ALLE Befunde eines Abdrucks sammeln, dann die eine Karte.**
     *
     * Die Entdoppelung stand vorher MITTEN in der Schleife: `continue` sprang
     * ab dem zweiten Befund desselben Tages heraus — und warf die gerade
     * erhaltene `arbeitszeit_verstoss`-Kennung weg. `raeumeAuf` ueberholt
     * ausschliesslich, worauf eine ueberholte Karte ZEIGT, und die Karte zeigte
     * nur auf den erstgenannten. Der Zehn-Stunden-Befund — die HAERTERE
     * gesetzliche Grenze — blieb damit fuer immer `status = 'offen'` und
     * `hinfaellig_am is null`, auch wenn der Tag laengst entzerrt war: die
     * Gewerbeaufsicht las einen offenen Verstoss zu einem umgeplanten Tag, und
     * `av_fingerprint_uk` (partiell auf `hinfaellig_am is null`) hielt seinen
     * Abdruck besetzt, so dass jeder spaetere Lauf per `on conflict … do
     * update` in dieselbe alte Zeile mitsamt ihrem `erkannt_am` von damals
     * schrieb.
     *
     * Die Karte bleibt EINE je Person und Tag; sie traegt jetzt die Belege
     * ALLER Befunde dieses Tages.
     */
    const jeAbdruck = new Map<string, { befund: ArbzgBefund; belege: string[] }>();
    for (const befund of nachSchwere) {
      const beleg = await schreibeBefund(
        db, k.personId, befund, ergebnis.fenster, mandantId,
      );
      const abdruck = arbzgFingerabdruck(mandantId, k.personId, 'arbzg', befund.kalendertag);
      const vorhanden = jeAbdruck.get(abdruck);
      if (vorhanden === undefined) {
        jeAbdruck.set(abdruck, { befund, belege: beleg === null ? [] : [beleg] });
      } else if (beleg !== null && !vorhanden.belege.includes(beleg)) {
        vorhanden.belege.push(beleg);
      }
    }

    for (const [abdruck, eintrag] of jeAbdruck) {
      if (gesehen.has(abdruck)) continue;
      gesehen.add(abdruck);
      /**
       * Die Karte traegt den BELEG des Befunds, den sie zeigt
       * (`arbeitszeit_verstoss_id`): ihren Regeltext, den Istwert und den
       * Grenzwert liest der Eingang ueber diese Verbindung. Ohne sie stand
       * dort „Arbeitszeit" und sonst nichts.
       */
      const war = await schreibeKonflikt(
        db, mandantId, k, eintrag.befund, abdruck, eintrag.belege,
      );
      if (war === 'neu') neu += 1;
      else bestaetigt += 1;
    }
  }

  const hinfaellig = await raeumeAuf(db, mandantId, vonUtc, bisUtc, gesehen);
  return { geprueft: kandidaten.length, neu, bestaetigt, hinfaellig };
}

/**
 * Eine Zeile je Person und Tag — nicht je Schicht.
 *
 * Zehn Schichten derselben Person an einem Tag ergaeben sonst zehn identische
 * Pruefungen, und `app.arbzg_belastung` schriebe zehn Auditzeilen fuer
 * dieselbe Frage. Der Uebertritt ueber die Mandantengrenze soll selten sein
 * und sichtbar bleiben.
 */
async function ladeKandidaten(
  db: Abfrage, mandantId: string, vonUtc: Date, bisUtc: Date,
): Promise<readonly Kandidat[]> {
  const zeilen = (await db.unsafe(
    `select z.person_id,
            min(z.anstellung_id::text)                       as anstellung_id,
            (array_agg(e.id order by e.beginn_zeitpunkt))[1] as einsatz_id,
            min(e.beginn_zeitpunkt)                          as beginn,
            max(e.ende_zeitpunkt)                            as ende
       from einsatz_zuordnung z
       join einsatz e on e.mandant_id = z.mandant_id and e.id = z.einsatz_id
      where z.mandant_id = $1
        and z.entfernt_am is null
        and e.storniert_am is null
        and e.ende_zeitpunkt   > $2::timestamptz
        and e.beginn_zeitpunkt < $3::timestamptz
      group by z.person_id, (e.beginn_zeitpunkt at time zone 'Europe/Berlin')::date`,
    [mandantId, vonUtc.toISOString(), bisUtc.toISOString()],
  )) as Record<string, unknown>[];

  return zeilen.map((z) => ({
    personId: z['person_id'] as string,
    anstellungId: z['anstellung_id'] as string,
    einsatzId: z['einsatz_id'] as string,
    beginn: new Date(z['beginn'] as string),
    ende: new Date(z['ende'] as string),
  }));
}

/**
 * Schreibt oder bestaetigt einen Konflikt.
 *
 * `on conflict … do update` auf dem partiellen Index: derselbe Befund am
 * naechsten Abend ist **dieselbe** Zeile, nicht die zweite. Der Status wird
 * dabei NICHT zurueckgesetzt — sonst waere jede Quittung bis zum naechsten
 * Lauf gueltig, und der Eingang haette am Morgen dieselben Karten wie am
 * Abend.
 */
async function schreibeKonflikt(
  db: Abfrage, mandantId: string, k: Kandidat, befund: ArbzgBefund,
  abdruck: string,
  /**
   * Die Belege ALLER Befunde dieses Abdrucks, der schwerste zuerst.
   *
   * `arbeitszeit_verstoss_id` nimmt den ersten — er traegt die Anzeige. Die
   * uebrigen stehen in `details.belege`, damit `raeumeAuf` sie beim Ueberholen
   * wiederfindet; eine Spalte haelt nur einen Zeiger, ein Tag hat aber
   * mehrere Befunde.
   */
  belege: readonly string[],
): Promise<'neu' | 'bestaetigt'> {
  const zeilen = (await db.unsafe(
    `insert into planungs_konflikt (
       mandant_id, art, person_id, anstellung_id, einsatz_id,
       zeitraum_beginn, zeitraum_ende, schwere, blockiert,
       betrifft_fremden_mandant, details, fingerprint, erkannt_durch, erstellt_von_art,
       arbeitszeit_verstoss_id
     ) values (
       $1, 'arbzg', $2, $3, $10, $4::timestamptz, $5::timestamptz, $6::verstoss_schwere, false,
       $7, $8::jsonb, $9, 'detektor_job', 'system', $11::uuid
     )
     on conflict (mandant_id, fingerprint) where hinfaellig_am is null
     do update set zeitraum_beginn = excluded.zeitraum_beginn,
                   zeitraum_ende   = excluded.zeitraum_ende,
                   schwere         = excluded.schwere,
                   einsatz_id      = excluded.einsatz_id,
                   -- Die Spalte wurde beim Bestaetigen NICHT nachgefuehrt: wurde
                   -- aus einem einzelgesellschaftlichen Befund am naechsten Abend
                   -- einer ueber Gesellschaften hinweg, blieb die Zeile auf
                   -- false stehen. Der Dienstplan sagte dann "Arbeitszeit
                   -- ueberschritten" statt "ueber Gesellschaften hinweg" -- genau
                   -- die Unterscheidung, fuer die 0064 geschrieben wurde, und der
                   -- Fall, den eine Leitung am dringendsten sehen muss (TIM-14).
                   -- Derselbe Fehler stand in app.arbzg_befund_schreiben; 0085
                   -- hat ihn dort auf demselben Weg behoben.
                   betrifft_fremden_mandant = excluded.betrifft_fremden_mandant,
                   details         = excluded.details,
                   arbeitszeit_verstoss_id = coalesce(
                     excluded.arbeitszeit_verstoss_id,
                     planungs_konflikt.arbeitszeit_verstoss_id)
     returning (xmax = 0) as neu`,
    [
      mandantId, k.personId, k.anstellungId,
      k.beginn.toISOString(), k.ende.toISOString(), befund.schwere,
      /**
       * Das Kennzeichen des BEFUNDS, nicht das des Fensters.
       *
       * Hier stand `ergebnis.ueberGesellschaften` — wahr, sobald IRGENDEIN
       * fremdes Fenster in den ±24 h der Belastungsabfrage lag. Ein rein
       * hauseigener Zehn-Stunden-Tag bekam damit das Etikett „Anderer
       * Bereich", nur weil die Person am Folgetag anderswo eingeteilt war,
       * waehrend die Zeile in `arbeitszeit_verstoss`, auf die dieselbe Karte
       * zeigt, korrekt `false` trug (0085). Der Eingang zeigt beide
       * nebeneinander; zwei Bedeutungen in einer Zeile entwerten genau die
       * Unterscheidung, fuer die 0064 geschrieben wurde.
       */
      befund.ueberMandanten,
      /**
       * Das OBJEKT, nicht sein JSON-Text.
       *
       * `JSON.stringify(...)` in einem `::jsonb`-Parameter schreibt eine
       * JSON-ZEICHENKETTE in die Spalte: `jsonb_typeof(details)` ist dann
       * `string`, und `details->>'regel'` liefert NULL. Kein Fehler, keine
       * Meldung — die Zeile steht da und sieht vollstaendig aus. Der Treiber
       * serialisiert selbst; ihm zuvorzukommen kodiert zweimal.
       */
      {
        regel: befund.regel,
        kalendertag: befund.kalendertag,
        minuten: befund.minuten,
        begruendung: befund.begruendung,
        belege: [...belege],
      },
      abdruck, k.einsatzId, belege[0] ?? null,
    ],
  )) as { neu: boolean }[];
  return zeilen[0]?.neu === true ? 'neu' : 'bestaetigt';
}

/**
 * Was der Lauf nicht mehr findet, wird **hinfaellig** — nicht geloescht.
 *
 * Ein Konflikt, den jemand durch Umplanen aufgeloest hat, verschwindet nicht
 * spurlos: er bekommt `hinfaellig_am` und faellt aus dem partiellen Index, so
 * dass derselbe Fehler spaeter wieder erkannt werden kann. Geloescht waere er
 * die Behauptung, es habe ihn nie gegeben (Invariante 8).
 *
 * **Und der BELEG geht mit.** Ueberholt wurde vorher nur die Karte; der Befund
 * in `arbeitszeit_verstoss`, auf den sie zeigt, blieb fuer immer `offen` —
 * `hinfaellig_am` hatte dort ueberhaupt keinen Schreiber, obwohl §6.7 genau
 * diesen Dienst dafuer benennt. Die Karte verschwand also aus dem Eingang,
 * waehrend die gesetzlich gefuehrte Verstossliste den umgeplanten Tag weiter
 * als offenen Verstoss auswies — und der partielle Abdruckindex
 * (`av_fingerprint_uk … where hinfaellig_am is null`) blieb von einer Zeile
 * belegt, die niemand mehr meint.
 *
 * Ueberholt wird ausschliesslich, worauf eine gerade ueberholte Karte ZEIGT —
 * und zwar auf ALLE Befunde, die sie traegt: die Spalte
 * `arbeitszeit_verstoss_id` fuer den angezeigten, `details.belege` fuer die
 * uebrigen desselben Tages. Solange nur die Spalte gelesen wurde, blieb der
 * Zehn-Stunden-Befund neben dem Acht-Stunden-Befund fuer immer offen stehen.
 * Ein Fenster-Kriterium waere hier nicht dasselbe wie oben: der Zeitraum eines
 * Befundes umfasst den Vorlauf und den Nachlauf der Belastungsabfrage und
 * reicht damit ueber den geprueften Tag hinaus — er ueberlappte das Fenster
 * eines schmalen Laufs (die Einteilung prueft nur ±24 h um eine Schicht) auch
 * dann, wenn dieser Lauf den zugehoerigen Tag nie nachgerechnet hat. Ein
 * faelschlich ueberholter Befund ist ein geloeschter Nachweis; ein stehen
 * gebliebener ist bloss einer zu viel.
 */
async function raeumeAuf(
  db: Abfrage, mandantId: string, vonUtc: Date, bisUtc: Date, gesehen: ReadonlySet<string>,
): Promise<number> {
  const zeilen = (await db.unsafe(
    `update planungs_konflikt
        set hinfaellig_am = now()
      where mandant_id = $1
        and art = 'arbzg'
        and hinfaellig_am is null
        and status = 'offen'
        and zeitraum_ende   > $2::timestamptz
        and zeitraum_beginn < $3::timestamptz
        and not (fingerprint = any($4::text[]))
      returning id, arbeitszeit_verstoss_id,
                coalesce(details->'belege', '[]'::jsonb) as belege`,
    [mandantId, vonUtc.toISOString(), bisUtc.toISOString(), [...gesehen]],
  )) as { id: string; arbeitszeit_verstoss_id: string | null; belege: unknown }[];

  /**
   * Die Spalte UND die Liste in `details` — ein Tag hat mehrere Befunde.
   *
   * `arbeitszeit_verstoss_id` haelt den, den die Karte anzeigt; `details.belege`
   * haelt alle. Karten aus der Zeit vor dieser Aenderung haben kein `belege`,
   * deshalb `coalesce(… , '[]')` und die Pruefung auf `typeof === 'string'`
   * hier: ein `as string[]` prueft NICHTS, und eine Kennung, die keine ist,
   * liefe als `null` in `uuid[]` und liesse `app.arbzg_befund_ueberholen` mit
   * `22P02` abbrechen — also einen Aufraeumlauf, der an einer alten Zeile
   * stirbt.
   */
  const belege = [...new Set(
    zeilen.flatMap((z) => [
      z.arbeitszeit_verstoss_id,
      ...(Array.isArray(z.belege) ? (z.belege as unknown[]) : []),
    ]).filter((id): id is string => typeof id === 'string' && id.length > 0),
  )];
  if (belege.length > 0) {
    /**
     * Ueber die Definer-Funktion und **nur** so: `arbeitszeit_verstoss` hat
     * fuer `cse_app` keine UPDATE-Policy (K-06). Ein direktes UPDATE traefe
     * null Zeilen und meldete Erfolg — dieselbe lautlose Nulloperation, gegen
     * die 0040 die Policy bewusst weggelassen hat.
     */
    await db.unsafe(
      `select app.arbzg_befund_ueberholen($1::uuid[]) as anzahl`,
      [belege],
    );
  }
  return zeilen.length;
}

/** Der Berliner Kalendertag eines Instants — fuer den Abdruck. */
export function tagFuerAbdruck(instant: Date): string {
  return berlinKalendertag(instant);
}
