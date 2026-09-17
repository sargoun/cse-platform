import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { CrmFehler } from './anlegen.js';

/**
 * Wiedervorlagen (CRM-04) — die Arbeitsliste des Vertriebs.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Eine Wiedervorlage liegt auf `lead_aktivitaet`, und das ist eine
 * Entscheidung mit einer Folge.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `lead_aktivitaet` trägt seit 0020 `faellig_am`, `erinnerung_am`,
 * `zustaendig_benutzer_id`, `erledigt_am` und den passenden Teilindex
 * `lead_aktivitaet_wiedervorlage_idx`. Das ist die Datengrundlage, und sie
 * trägt diese Seite vollständig.
 *
 * `04-SEITENKARTE.md` §5.2 sagt aber auch, CRM-04 erzeuge `aufgabe`- UND
 * `kalender_eintrag`-Zeilen. Beide Tabellen gibt es (0230, 0160), beide
 * haben ihre eigenen Rechte (`aufgabe.schreiben`, `kalender.schreiben`) und
 * ihre eigenen Listen. Eine Wiedervorlage, die nur auf `lead_aktivitaet`
 * steht, erscheint in `/portal/[mandant]/aufgaben` NICHT — und das ist der
 * stille Fehler, den diese Datei benennt statt ihn zu haben:
 *
 * `legeWiedervorlageAn` schreibt in ALLE DREI, und zwar in einer Transaktion.
 * Was in `aufgabe` fehlschlägt, weil das Recht fehlt, wird benannt
 * übersprungen — nicht verschwiegen: `Spiegel` sagt je Ziel, ob die Zeile
 * entstanden ist. Eine Wiedervorlage, die in der Aufgabenliste fehlt, ohne
 * dass jemand es weiss, ist schlimmer als eine, die nur an einer Stelle
 * steht.
 *
 * // TODO(client, O-663): Soll eine Wiedervorlage immer zugleich eine
 * `aufgabe` und einen `kalender_eintrag` erzeugen (so 04-SEITENKARTE §5.2),
 * oder bleibt sie eine reine Vertriebsnotiz auf `lead_aktivitaet`? Bis zur
 * Antwort werden alle drei geschrieben, soweit die Rechte reichen, und die
 * Oberfläche sagt, was entstanden ist.
 */

/** Die vier Fächer, in die eine Fälligkeit fällt. */
export const FAECHER = ['ueberfaellig', 'heute', 'diese_woche', 'spaeter'] as const;
export type Fach = (typeof FAECHER)[number];

export const FACH_TEXT: Readonly<Record<Fach, string>> = {
  ueberfaellig: 'Überfällig',
  heute: 'Heute',
  diese_woche: 'Diese Woche',
  spaeter: 'Später',
};

export interface WiedervorlageZeile {
  readonly id: string;
  readonly betreff: string;
  readonly typ: string;
  readonly kanal: string | null;
  readonly inhalt: string | null;
  readonly lead_id: string | null;
  readonly lead_betreff: string | null;
  readonly kunde_id: string | null;
  readonly kunde_name: string | null;
  readonly ansprechpartner_id: string | null;
  readonly ansprechpartner: string | null;
  readonly zustaendig_benutzer_id: string | null;
  readonly zustaendig: string | null;
  /** Der Berliner KALENDERTAG der Fälligkeit — aus der Datenbank, `YYYY-MM-DD`. */
  readonly faellig_tag: string;
  /** Die Fälligkeit in Berliner Zeit, fertig formatiert. */
  readonly faellig_text: string;
  readonly erinnerung_text: string | null;
}

/** Was die Datenbank über „heute" sagt — nie die Uhr des Node-Prozesses. */
export interface Zeitanker {
  /** `app.berlin_heute()`, `YYYY-MM-DD`. */
  readonly heute: string;
  /** Der Sonntag der laufenden Berliner Woche, `YYYY-MM-DD`. */
  readonly wochenende: string;
}

/**
 * In welches Fach gehört diese Fälligkeit?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Rein, und es vergleicht KALENDERTAGE als Zeichenketten.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Beide Seiten kommen als Berliner Kalendertag aus der Datenbank
 * (`(faellig_am at time zone 'Europe/Berlin')::date` und
 * `app.berlin_heute()`). Damit ist hier keine Zeitzonenrechnung mehr nötig —
 * und das ist der Punkt: `new Date(faellig).getDate()` läse die Uhr und die
 * Zone des Node-Prozesses, und eine Wiedervorlage, die um 00:30 Berliner Zeit
 * fällig wird, fiele in UTC noch auf gestern. Sie stünde dann unter
 * „Überfällig", bevor sie fällig war (Invariante 2, K-11).
 *
 * `YYYY-MM-DD` ist lexikographisch gleich chronologisch — deshalb genügt der
 * Vergleich zweier Zeichenketten, und deshalb gibt es hier keine `Date`.
 */
export function fachFuer(faelligTag: string, anker: Zeitanker): Fach {
  if (faelligTag < anker.heute) return 'ueberfaellig';
  if (faelligTag === anker.heute) return 'heute';
  if (faelligTag <= anker.wochenende) return 'diese_woche';
  return 'spaeter';
}

export interface Fachgruppe {
  readonly fach: Fach;
  readonly zeilen: readonly WiedervorlageZeile[];
}

/**
 * Die Zeilen in die vier Fächer, in der Reihenfolge der Dringlichkeit.
 *
 * Leere Fächer bleiben drin. Die Seite zeigt „Überfällig: keine" statt das
 * Fach weglassen — ein fehlendes Fach sieht aus wie ein fehlender Filter,
 * und „null überfällig" ist die Auskunft, auf die es ankommt.
 */
export function gruppiere(
  zeilen: readonly WiedervorlageZeile[], anker: Zeitanker,
): readonly Fachgruppe[] {
  return FAECHER.map((fach) => ({
    fach,
    zeilen: zeilen.filter((z) => fachFuer(z.faellig_tag, anker) === fach),
  }));
}

/* ------------------------------------------------------------------ Lesen */

/**
 * Der Sonntag DIESER Woche, in Berliner Zeit gerechnet.
 *
 * `date_trunc` auf `week` beginnt in Postgres am Montag — dieselbe Woche, die
 * der Dienstplan meint. Gerechnet wird in der Datenbank und nicht hier: die
 * Prozessuhr läuft in UTC (K-11).
 */
const ZEITANKER_SQL = `select app.berlin_heute()::text as heute,
         (date_trunc('week', app.berlin_heute()::timestamp)::date + 6)::text
           as wochenende`;

export async function leseZeitanker(kontext: LeseKontext): Promise<Zeitanker> {
  const [z] = await kontext.abfrage<Zeitanker>(ZEITANKER_SQL);
  if (z === undefined) {
    // Kein Rückfall auf die Prozessuhr: eine Antwort, die vielleicht stimmt,
    // ist hier schlechter als ein Fehler, den jemand sieht.
    throw new CrmFehler('Die Datenbank hat kein Datum zurückgegeben.', 'kein_datum', 500);
  }
  return z;
}

export interface WiedervorlageFilter {
  /** Nur die eigenen (Vorgabe) oder alle des Bereichs? */
  readonly nurMeine: boolean;
}

/**
 * Die offenen Wiedervorlagen dieses Bereichs.
 *
 * `benutzer` wird per LEFT JOIN gelesen und kann leer bleiben: die Tabelle
 * steht hinter `t_benutzer_lesen` und damit hinter `system.benutzer_lesen`.
 * Fehlt das Recht, ist `zustaendig` NULL — und die Seite schreibt dann
 * „Name nicht sichtbar" und nicht „niemand zuständig". Das ist der
 * Unterschied zwischen einer Aussage über die Berechtigung und einer über den
 * Vorgang.
 */
export async function listeWiedervorlagen(
  kontext: LeseKontext, filter: WiedervorlageFilter,
): Promise<readonly WiedervorlageZeile[]> {
  return kontext.abfrage<WiedervorlageZeile>(
    `select la.id, la.betreff, la.typ::text as typ, la.kanal, la.inhalt,
            la.lead_id, l.betreff as lead_betreff,
            la.kunde_id, k.name as kunde_name,
            la.ansprechpartner_id,
            case when la.ansprechpartner_id is null then null
                 else btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname) end
              as ansprechpartner,
            la.zustaendig_benutzer_id, b.name as zustaendig,
            (la.faellig_am at time zone 'Europe/Berlin')::date::text as faellig_tag,
            to_char(la.faellig_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as faellig_text,
            case when la.erinnerung_am is null then null
                 else to_char(la.erinnerung_am at time zone 'Europe/Berlin',
                              'DD.MM.YYYY HH24:MI') end as erinnerung_text
       from lead_aktivitaet la
       left join lead l on l.mandant_id = la.mandant_id and l.id = la.lead_id
       left join kunde k on k.mandant_id = la.mandant_id and k.id = la.kunde_id
       left join ansprechpartner ap
         on ap.mandant_id = la.mandant_id and ap.id = la.ansprechpartner_id
       left join benutzer b on b.id = la.zustaendig_benutzer_id
      where la.mandant_id = app.aktiver_mandant()
        and la.faellig_am is not null
        and la.erledigt_am is null
        and ($1::boolean is not true
             or la.zustaendig_benutzer_id = app.aktueller_benutzer())
      order by la.faellig_am`,
    [filter.nurMeine],
  );
}

/* --------------------------------------------------------------- Schreiben */

/** Was beim Anlegen einer Wiedervorlage wirklich entstanden ist. */
export interface Spiegel {
  readonly aktivitaetId: string;
  readonly aufgabeId: string | null;
  readonly kalenderId: string | null;
  /** Deutsche Sätze für das, was NICHT entstanden ist — nie stillschweigend. */
  readonly nichtGespiegelt: readonly string[];
}

export interface NeueWiedervorlage {
  readonly betreff: string;
  readonly notiz?: string | undefined;
  /** ISO-Zeitpunkt aus dem Formular (`datetime-local` in Berliner Zeit). */
  readonly faelligAm: string;
  readonly erinnerungAm?: string | undefined;
  readonly leadId?: string | undefined;
  readonly kundeId?: string | undefined;
  readonly ansprechpartnerId?: string | undefined;
  readonly zustaendigBenutzerId?: string | undefined;
}

/**
 * Eine Wiedervorlage anlegen — in `lead_aktivitaet`, `aufgabe` und
 * `kalender_eintrag`.
 *
 * **Die Zeit kommt aus dem Formular und wird in Berliner Zeit gelesen.** Das
 * ist die eine Stelle, an der ein Mensch einen Zeitpunkt in der ZUKUNFT
 * bestimmt — Invariante 5 (Serverzeit) gilt für das, was GESCHEHEN ist, nicht
 * für eine Frist, die jemand setzt. `geschehen_am` bleibt deshalb die
 * Serverzeit (der Auslöser `kern.erzwinge_serverzeit_geschehen` erzwingt es),
 * `faellig_am` ist die Eingabe.
 */
export async function legeWiedervorlageAn(
  kontext: SchreibKontext, eingabe: NeueWiedervorlage,
): Promise<Spiegel> {
  const betreff = eingabe.betreff.trim();
  if (betreff === '') {
    throw new CrmFehler('Eine Wiedervorlage braucht einen Betreff — er steht später '
      + 'allein in der Liste.', 'betreff_fehlt');
  }
  if (eingabe.leadId === undefined && eingabe.kundeId === undefined) {
    // `lead_aktivitaet_hat_bezug` verlangt es ohnehin; hier steht der Satz,
    // den ein Mensch lesen kann.
    throw new CrmFehler('Eine Wiedervorlage hängt an einem Lead oder an einem Kunden.',
      'ohne_bezug');
  }
  if (eingabe.faelligAm.trim() === '') {
    throw new CrmFehler('Ohne Fälligkeit ist es eine Notiz und keine Wiedervorlage.',
      'ohne_frist');
  }

  const [akt] = await kontext.schreibe<{ id: string }>(
    `insert into lead_aktivitaet
       (mandant_id, lead_id, kunde_id, ansprechpartner_id, typ, richtung, zweck,
        kanal, betreff, inhalt, akteur_art, benutzer_id, rechtsgrundlage_snapshot,
        faellig_am, erinnerung_am, zustaendig_benutzer_id)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::uuid, 'aufgabe', 'intern',
             'intern', 'portal', $4, $5, 'mensch', app.aktueller_benutzer(), 'keine',
             ($6::timestamp at time zone 'Europe/Berlin'),
             case when $7::text is null then null
                  else ($7::timestamp at time zone 'Europe/Berlin') end,
             coalesce($8::uuid, app.aktueller_benutzer()))
     returning id`,
    [eingabe.leadId ?? null, eingabe.kundeId ?? null, eingabe.ansprechpartnerId ?? null,
      betreff, eingabe.notiz ?? null, eingabe.faelligAm, eingabe.erinnerungAm ?? null,
      eingabe.zustaendigBenutzerId ?? null],
  );
  if (akt === undefined) {
    throw new CrmFehler('Die Wiedervorlage wurde nicht angelegt — fehlt `crm.schreiben`?',
      'kein_schreibrecht', 403);
  }

  const nicht: string[] = [];
  const [rechte] = await kontext.abfrage<{ aufgabe: boolean; kalender: boolean }>(
    `select app.hat_recht('aufgabe.schreiben', app.aktiver_mandant()) as aufgabe,
            app.hat_recht('kalender.schreiben', app.aktiver_mandant()) as kalender`);

  let aufgabeId: string | null = null;
  if (rechte?.aufgabe === true) {
    const [a] = await kontext.schreibe<{ id: string }>(
      `insert into aufgabe
         (mandant_id, titel, beschreibung, status, prioritaet, faellig_am,
          zugewiesen_an, lead_id, bezug_typ, bezug_id, quelle, erstellt_von)
       values (app.aktiver_mandant(), $1, $2, 'offen', 'normal',
               ($3::timestamp at time zone 'Europe/Berlin'),
               coalesce($4::uuid, app.aktueller_benutzer()), $5::uuid,
               'lead_aktivitaet', $6::uuid, 'mensch', app.aktueller_benutzer())
       returning id`,
      [betreff, eingabe.notiz ?? null, eingabe.faelligAm,
        eingabe.zustaendigBenutzerId ?? null, eingabe.leadId ?? null, akt.id]);
    aufgabeId = a?.id ?? null;
  }
  if (aufgabeId === null) {
    nicht.push('In der Aufgabenliste erscheint sie nicht — dafür fehlt '
      + '`aufgabe.schreiben`. Die Wiedervorlage selbst steht.');
  }

  let kalenderId: string | null = null;
  if (rechte?.kalender === true) {
    const [e] = await kontext.schreibe<{ id: string }>(
      `insert into kalender_eintrag
         (mandant_id, art, titel, beschreibung, beginn, ende, besitzer_benutzer_id,
          teilnehmer, bezug_typ, bezug_id, erstellt_von)
       values (app.aktiver_mandant(), 'wiedervorlage', $1, $2,
               ($3::timestamp at time zone 'Europe/Berlin'),
               ($3::timestamp at time zone 'Europe/Berlin') + interval '30 minutes',
               coalesce($4::uuid, app.aktueller_benutzer()),
               array[coalesce($4::uuid, app.aktueller_benutzer())],
               'lead_aktivitaet', $5::uuid, app.aktueller_benutzer())
       returning id`,
      [betreff, eingabe.notiz ?? null, eingabe.faelligAm,
        eingabe.zustaendigBenutzerId ?? null, akt.id]);
    kalenderId = e?.id ?? null;
  }
  if (kalenderId === null) {
    nicht.push('Im Kalender erscheint sie nicht — dafür fehlt `kalender.schreiben`.');
  }

  return { aktivitaetId: akt.id, aufgabeId, kalenderId, nichtGespiegelt: nicht };
}

/**
 * Erledigt — mit der SERVERZEIT.
 *
 * `erledigt_am` ist ein Ereignis und keine Frist: es ist GESCHEHEN, und damit
 * gilt Invariante 5. Ein Zeitstempel aus dem Browser wäre hier die
 * Geräteuhr, und die läuft auf Baustellentelefonen regelmässig um Minuten bis
 * Tage falsch.
 *
 * Die gespiegelte `aufgabe` wird mitgeschlossen — sonst stünde derselbe
 * Vorgang an einer Stelle offen und an der anderen erledigt.
 */
export async function erledige(kontext: SchreibKontext, id: string): Promise<void> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update lead_aktivitaet
        set erledigt_am = now()
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and erledigt_am is null
      returning id`, [id]);
  if (zeilen[0] === undefined) {
    throw new CrmFehler('Diese Wiedervorlage gibt es nicht — oder sie ist schon '
      + 'erledigt.', 'nicht_gefunden', 404);
  }
  const [recht] = await kontext.abfrage<{ darf: boolean }>(
    `select app.hat_recht('aufgabe.schreiben', app.aktiver_mandant()) as darf`);
  if (recht?.darf !== true) return;
  await kontext.schreibe(
    `update aufgabe
        set status = 'erledigt', erledigt_am = now(),
            erledigt_von = app.aktueller_benutzer()
      where mandant_id = app.aktiver_mandant()
        and bezug_typ = 'lead_aktivitaet' and bezug_id = $1::uuid
        and status in ('offen', 'in_arbeit')`, [id]);
}

/**
 * Verschieben — mit Pflichtnotiz.
 *
 * **Warum die Notiz Pflicht ist.** Eine Wiedervorlage, die dreimal ohne
 * Grund verschoben wird, ist von einer, die einmal aus gutem Grund verschoben
 * wurde, nicht zu unterscheiden — und der Vertriebsleiter sieht in beiden
 * Fällen dasselbe Datum. Der Grund kostet einen Satz und beantwortet später
 * die einzige Frage, die gestellt wird.
 *
 * Die Verschiebung wird als eigene Notizzeile festgehalten. Ein `update` auf
 * `faellig_am` allein liesse die Kette verschwinden: dann stünde nur noch das
 * letzte Datum da, und dass es das vierte war, wüsste niemand.
 */
export async function verschiebe(
  kontext: SchreibKontext, id: string, neuFaellig: string, grund: string,
): Promise<void> {
  const text = grund.trim();
  if (text === '') {
    throw new CrmFehler('Ein Verschieben trägt einen Grund — sonst ist später nicht zu '
      + 'sehen, ob einmal aus gutem Grund oder viermal aus Gewohnheit verschoben '
      + 'wurde.', 'ohne_grund');
  }
  if (neuFaellig.trim() === '') {
    throw new CrmFehler('Ohne neues Datum ist nichts verschoben.', 'ohne_datum');
  }

  /**
   * **Der ALTE Stand wird VORHER gelesen, mit `for update`.**
   *
   * `RETURNING` auf einem `update` liefert in Postgres die NEUE Zeile. Der
   * erste Entwurf schrieb damit „Von 05.10. verschoben" in die Notiz und
   * meinte damit das neue Datum — ein Verlauf, der jede Verschiebung mit dem
   * Ziel statt mit der Herkunft beschriftet, und den niemand mehr geradebiegt,
   * weil er plausibel aussieht.
   *
   * `for update` hält die Zeile für die Dauer der Transaktion: zwei
   * gleichzeitige Verschiebungen schrieben sonst zwei Notizen mit demselben
   * „von", und eine der beiden wäre falsch.
   */
  const [z] = await kontext.abfrage<{
    id: string; alt: string; lead_id: string | null; kunde_id: string | null;
    ansprechpartner_id: string | null;
  }>(
    `select id,
            to_char(faellig_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as alt,
            lead_id, kunde_id, ansprechpartner_id
       from lead_aktivitaet
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and faellig_am is not null and erledigt_am is null
        for update`,
    [id]);
  if (z === undefined) {
    throw new CrmFehler('Diese Wiedervorlage gibt es nicht — oder sie ist schon '
      + 'erledigt.', 'nicht_gefunden', 404);
  }

  await kontext.schreibe(
    `update lead_aktivitaet
        set faellig_am = ($2::timestamp at time zone 'Europe/Berlin'),
            -- Die Erinnerung wandert mit: eine Erinnerung, die vor dem alten
            -- Termin liegt und nach dem neuen, erinnert an nichts.
            erinnerung_am = case
              when erinnerung_am is null then null
              else ($2::timestamp at time zone 'Europe/Berlin')
                   - (faellig_am - erinnerung_am) end
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and erledigt_am is null`,
    [id, neuFaellig]);

  await kontext.schreibe(
    `insert into lead_aktivitaet
       (mandant_id, lead_id, kunde_id, ansprechpartner_id, typ, richtung, zweck,
        kanal, betreff, inhalt, akteur_art, benutzer_id, rechtsgrundlage_snapshot)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::uuid, 'notiz', 'intern',
             'intern', 'portal', 'Wiedervorlage verschoben', $4, 'mensch',
             app.aktueller_benutzer(), 'keine')`,
    [z.lead_id, z.kunde_id, z.ansprechpartner_id,
      `Von ${z.alt} verschoben. Grund: ${text}`]);

  const [recht] = await kontext.abfrage<{ darf: boolean }>(
    `select app.hat_recht('aufgabe.schreiben', app.aktiver_mandant()) as darf`);
  if (recht?.darf !== true) return;
  await kontext.schreibe(
    `update aufgabe
        set faellig_am = ($2::timestamp at time zone 'Europe/Berlin'),
            geaendert_von = app.aktueller_benutzer()
      where mandant_id = app.aktiver_mandant()
        and bezug_typ = 'lead_aktivitaet' and bezug_id = $1::uuid
        and status in ('offen', 'in_arbeit')`, [id, neuFaellig]);
}
