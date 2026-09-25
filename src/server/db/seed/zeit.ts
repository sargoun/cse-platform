/**
 * Demodaten fuer Phase 5 — Einteilung und erfasste Zeit (TIM-05, TIM-08,
 * TIM-12, TIM-13, EMP-04).
 *
 * Ohne diese Datei zeigte der Plan Schichten, auf denen **niemand** stand, und
 * der ganze Zeitbereich — Wochenliste, Live-Brett, Korrekturbuch,
 * MiLoG-Aufzeichnung, Stundenkonto — blieb leer. Nicht mit einer Fehlermeldung,
 * sondern mit „0", und zwar auf jedem Bildschirm ueberzeugend gleich.
 *
 * **Die Einteilung laeuft ueber den ECHTEN Dienst** (`besetzeEinsatz`), nicht
 * ueber ein `insert`. Damit nehmen die Demodaten denselben Weg wie ein Planer:
 * Qualifikationssperre, Arbeitszeitpruefung, Besetzungszaehler,
 * ArbZG-Projektion, Konflikterkennung. Ein Seed, der die Tore umgeht, erzeugt
 * Zeilen, die es im Betrieb nie geben koennte — und verdeckt genau die Fehler,
 * fuer die er da waere.
 *
 * **Die Zeiteintraege dagegen entstehen als IMPORT**, und das ist kein
 * Schummeln, sondern die einzige ehrliche Form: `kern.stempel_feldzeit()`
 * ueberschreibt jeden Beginn mit `now()`, sobald die Quelle die Serveruhr ist
 * (Invariante 5, und richtig so). Eine Fixtur, die drei Wochen zurueckliegende
 * Schichten erfassen will, sagt deshalb, was sie ist: `erfassungsart_beginn =
 * 'import'`. In der Oberflaeche steht dann „importiert" — und das stimmt.
 *
 * **Idempotent durch LESEN ZUERST**, wie die uebrigen Seed-Dateien: der
 * natuerliche Schluessel eines Zeiteintrags ist hier die Einteilung, auf die
 * er zeigt.
 */
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import {
  ArbzgWarnungOffen, besetzeEinsatz,
} from '../../services/dienstplan/einteilung.js';
import { berlinHeute, type Abfrage } from '../../services/dienstplan/generator.js';
import { tagePlus } from '@/lib/datum/kalendertag';
import { alsPortalSitzung } from './sitzung.js';
import { gibCheckinAus } from '../../services/zeit/checkin.js';
import { nimmClaimAn } from '../../services/zeit/offline.js';
import { entscheideEinwand, reicheEinwandEin } from '../../services/zeit/einwand.js';
import { korrigiereZeiteintrag } from '../../services/zeit/korrektur.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface ZeitErgebnis {
  readonly einteilungen: number;
  readonly uebergangen: number;
  readonly zeiteintraege: number;
  readonly laufend: number;
  readonly abwesenheiten: number;
  /** Wartende Offline-Nachreichungen — die Warteschlange der Planung. */
  readonly ansprueche: number;
}

/** Wie weit zurueck und wie weit voraus besetzt wird. */
const RUECKBLICK_TAGE = 21;
const VORSCHAU_TAGE = 14;

interface SchichtZeile {
  readonly id: string;
  readonly beginn: Date;
  readonly ende: Date;
  readonly offen: number;
  readonly vergangen: boolean;
}

export async function seedZeit(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<ZeitErgebnis> {
  const mandantId = ids.get('reinigung');
  if (mandantId === undefined) throw new Error('Bereich reinigung fehlt');

  /* Unter mehreren Administrationen zuerst eine ohne Modulliste, dann die
     E-Mail — nie die Reihenfolge der Tabelle (V-168). */
  const [planer] = await sql<{ id: string }[]>`
    select b.id from benutzer b
     join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
     join rolle r on r.id = bm.rolle_id
    where r.schluessel in ('admin', 'leitung') and b.status = 'aktiv'
      and bm.entzogen_am is null
    order by r.schluessel, bm.module is not null, b.email limit 1`;
  if (planer === undefined) return leer();

  const anstellungen = (await sql<{ id: string }[]>`
    select a.id from anstellung a
     where a.mandant_id = ${mandantId} and a.status = 'aktiv' and a.geloescht_am is null
     order by a.personalnummer`).map((a) => a.id);
  if (anstellungen.length === 0) return leer();

  const heute = await berlinHeute(sql as unknown as Abfrage);
  const lauf = await besetzeUndErfasse(sql, mandantId, planer.id, anstellungen, heute);
  const { einteilungen, uebergangen, erfasst, laufend } = lauf;

  const abwesenheiten = await seedAbwesenheiten(sql, mandantId, planer.id, anstellungen, heute);
  const konflikt = await seedRuhezeitkonflikt(sql, mandantId, planer.id, heute);
  const teildienst = await seedGeteilterDienst(sql, mandantId, planer.id, heute);
  const ansprueche = await seedOfflineAnspruch(sql, mandantId, planer.id);

  /*
   * Beides NACH der Erfassung: die Einwaende haengen an geschlossenen
   * Zeiteintraegen, die es vorher nicht gibt. Gezaehlt wird hier und nicht in
   * `ZeitErgebnis` — die Kennzahlen dort werden an einer zentralen Stelle
   * ausgegeben, und ein zusaetzliches Feld waere eine Aenderung an einer
   * Datei, die allen gehoert.
   */
  const einwaende = await seedEinwaende(sql, mandantId, planer.id);
  const teilbesetzt = await seedTeilbesetzteSchicht(
    sql, mandantId, planer.id, anstellungen, heute);
  process.stdout.write(
    `  ${String(einwaende)} Zeit-Einwand/-Einwände (offen und entschieden), `
    + `${String(teilbesetzt)} teilbesetzte Schicht(en), `
    + `${String(teildienst)} geteilter Dienst ohne §-5-Befund\n`,
  );

  return {
    einteilungen: einteilungen + konflikt + teildienst,
    uebergangen: uebergangen + konflikt,
    zeiteintraege: erfasst,
    laufend,
    abwesenheiten,
    ansprueche,
  };
}

export interface BesetzungsLauf {
  readonly einteilungen: number;
  readonly uebergangen: number;
  readonly erfasst: number;
  readonly laufend: number;
}

/**
 * Der Besetzungslauf — reihum durch die Belegschaft, dann die Zeiterfassung.
 *
 * Er stand als Rumpf in `seedZeit` und galt deshalb nur fuer die Reinigung.
 * Die Security braucht denselben Lauf auf ihren Posten, und eine zweite
 * Abschrift waere die Stelle, an der die eine Fassung eine Sperre respektiert
 * und die andere sie vergisst.
 */
export async function besetzeUndErfasse(
  sql: Sql, mandantId: string, planerId: string,
  anstellungen: readonly string[], heute: string,
): Promise<BesetzungsLauf> {
  const von = tagePlus(heute, -RUECKBLICK_TAGE);
  const bis = tagePlus(heute, VORSCHAU_TAGE);

  const schichten = await sql<SchichtZeile[]>`
    select e.id, e.beginn_zeitpunkt as beginn, e.ende_zeitpunkt as ende,
           (e.soll_besetzung - e.besetzt_anzahl)::int as offen,
           (e.ende_zeitpunkt < now())                 as vergangen
      from einsatz e
     where e.mandant_id = ${mandantId}
       and e.storniert_am is null
       and e.beginn_zeitpunkt >= (${von}::date::timestamp) at time zone 'Europe/Berlin'
       and e.beginn_zeitpunkt <  ((${bis}::date + 1)::timestamp) at time zone 'Europe/Berlin'
       and e.besetzt_anzahl < e.soll_besetzung
     order by e.beginn_zeitpunkt`;

  let einteilungen = 0;
  let uebergangen = 0;
  /**
   * GENAU EIN uebergangener Befund.
   *
   * Der Konflikteingang soll etwas zeigen — aber eine Demo, in der jede zweite
   * Schicht einen quittierpflichtigen Verstoss traegt, sieht nicht nach
   * Betrieb aus, sondern nach einem kaputten Plan. Alles Weitere bleibt
   * unbesetzt und faellt damit als Unterbesetzung auf, was es auch ist.
   */
  const UEBERGEHEN_HOECHSTENS = 1;
  const zugeteilt: { einsatzId: string; zuordnungId: string; vergangen: boolean }[] = [];

  let naechster = 0;
  for (const s of schichten) {
    for (let n = 0; n < s.offen; n += 1) {
      let gesetzt = false;
      // Reihum durch die Belegschaft — und bei einem Arbeitszeitbefund zur
      // naechsten Person, statt ihn wegzudruecken.
      for (let versuch = 0; versuch < anstellungen.length && !gesetzt; versuch += 1) {
        const anstellungId = anstellungen[(naechster + versuch) % anstellungen.length]!;
        try {
          const befund = await alsPortalSitzung(sql, mandantId, planerId, (k) =>
            besetzeEinsatz(k, { einsatzId: s.id, anstellungId }));
          zugeteilt.push({
            einsatzId: s.id, zuordnungId: befund.zuordnungId, vergangen: s.vergangen,
          });
          einteilungen += 1;
          gesetzt = true;
          naechster += 1;
        } catch (fehler) {
          if (!(fehler instanceof ArbzgWarnungOffen)) {
            // Eine Qualifikationssperre oder ein Doppeleintrag ist kein Grund,
            // den Seed abzubrechen — aber auch keiner, ihn zu verschweigen.
            if (versuch === anstellungen.length - 1) {
              process.stdout.write(
                `  · Schicht ${s.id.slice(0, 8)} bleibt offen: `
                + `${fehler instanceof Error ? fehler.message : String(fehler)}\n`,
              );
            }
            continue;
          }
          if (uebergangen < UEBERGEHEN_HOECHSTENS) {
            const befund = await alsPortalSitzung(sql, mandantId, planerId, (k) =>
              besetzeEinsatz(k, { einsatzId: s.id, anstellungId, bestaetigt: true }));
            zugeteilt.push({
              einsatzId: s.id, zuordnungId: befund.zuordnungId, vergangen: s.vergangen,
            });
            einteilungen += 1;
            uebergangen += 1;
            gesetzt = true;
            naechster += 1;
          }
        }
      }
    }
  }

  const { erfasst, laufend } = await erfasseZeiten(sql, mandantId, zugeteilt);
  return { einteilungen, uebergangen, erfasst, laufend };
}

/**
 * EIN wartender Offline-Anspruch — das Telefon im Treppenhaus ohne Netz.
 *
 * Er entsteht auf dem ECHTEN Weg: eine Check-in-Marke wird ausgegeben
 * (`app.checkin_ausgeben`), und die Nachreichung laeuft durch
 * `app.offline_ereignis_annehmen` als `cse_checkin` — dieselbe
 * Definer-Funktion, die das Telefon aufruft, mit demselben K-08-Register
 * dahinter. Ein direktes `insert into offline_ereignis` erzeugte eine Zeile,
 * die es im Betrieb nicht geben koennte, und verdeckte genau den Weg, den die
 * Warteschlange abbildet.
 *
 * **Er bleibt OFFEN.** Die Planung entscheidet auf
 * `zeiten/nacherfassung`; ein Seed, der die Entscheidung gleich mitliefert,
 * zeigte eine leere Warteschlange und damit einen Bildschirm, den niemand je
 * mit Inhalt sieht.
 */
async function seedOfflineAnspruch(
  sql: Sql, mandantId: string, planerId: string,
): Promise<number> {
  const [da] = await sql<{ anzahl: string }[]>`
    select count(*)::text as anzahl from offline_ereignis where mandant_id = ${mandantId}`;
  if (Number(da?.anzahl ?? '0') > 0) return 0;

  // Eine vergangene Einteilung OHNE Zeiteintrag — genau der Fall, den die
  // Nachreichung fuellt.
  const [offen] = await sql<{ zuordnung: string; beginn: Date }[]>`
    select zo.id as zuordnung, e.beginn_zeitpunkt as beginn
      from einsatz_zuordnung zo
      join einsatz e on e.mandant_id = zo.mandant_id and e.id = zo.einsatz_id
     where zo.mandant_id = ${mandantId} and zo.entfernt_am is null
       and e.ende_zeitpunkt < now()
       and not exists (select 1 from zeiteintrag z where z.einsatz_zuordnung_id = zo.id)
     order by e.beginn_zeitpunkt desc
     limit 1`;
  if (offen === undefined) return 0;

  const marke = await alsPortalSitzung(sql, mandantId, planerId, (k) =>
    gibCheckinAus(k, offen.zuordnung, 'checkin', 'seed'));

  await sql.begin(async (tx) => {
    await nimmClaimAn(tx as unknown as Parameters<typeof nimmClaimAn>[0], {
      token: marke,
      ereignisse: [{
        clientEreignisId: randomUUID(),
        art: 'checkin',
        // Die Behauptung: „ich habe puenktlich angefangen." Ob das stimmt,
        // entscheidet ein Mensch — hier steht nur, was das Geraet sagt.
        behaupteteZeit: offen.beginn,
        geraetId: 'demo-telefon-01',
      }],
      ip: null,
      userAgent: 'Demodaten (Seed)',
    });
  });
  return 1;
}

/**
 * EIN echter Arbeitszeitbefund — die Sonderreinigung nach der Veranstaltung.
 *
 * **Warum der Seed ihn ausdruecklich herstellt.** Der Turnusplan erzeugt
 * Schichten, die brav zwanzig Stunden auseinanderliegen; damit findet die
 * Pruefung nichts, und Konflikteingang, Kennzahl und Warnfeld stehen in der
 * Demo leer da — als waere das Modul nicht gebaut. Frueher fuellte sie ein
 * FALSCHER Befund: die Vorschau nahm fuer die geplante Schicht „null Minuten
 * Pause" an und meldete auf jeder Schicht ueber sechs Stunden § 4. Der Fehler
 * ist behoben (O-168), und mit ihm verschwand die Fuellung.
 *
 * Stattdessen steht hier ein Fall, den es wirklich gibt: eine Kraft raeumt
 * abends nach einer Veranstaltung bis 02:00 auf und steht am selben Morgen um
 * 06:00 wieder im Treppenhaus. Das sind vier Stunden Ruhe statt elf (§ 5
 * ArbZG) — kein erfundener Befund, sondern eine erfundene SCHICHT, die einen
 * echten Befund ausloest. Die Einteilung laeuft durch den normalen Dienst, und
 * die Planung bestaetigt den Befund mit Grund, so wie sie es im Betrieb taete.
 */
async function seedRuhezeitkonflikt(
  sql: Sql, mandantId: string, planerId: string, heute: string,
): Promise<number> {
  // Eine bereits besetzte FRUEHSCHICHT der vergangenen Tage — an sie haengt
  // sich der Konflikt. Ohne sie gaebe es keinen zweiten Zeitraum zum Messen.
  const [frueh] = await sql<{
    einsatz: string; anstellung: string; objekt: string; kunde: string | null;
    tag: string; beginn_lokal: string;
  }[]>`
    select e.id as einsatz, zo.anstellung_id as anstellung, e.objekt_id as objekt,
           e.kunde_id as kunde,
           to_char(e.plan_datum, 'YYYY-MM-DD') as tag,
           to_char(e.beginn_lokal, 'HH24:MI')  as beginn_lokal
      from einsatz e
      join einsatz_zuordnung zo
        on zo.mandant_id = e.mandant_id and zo.einsatz_id = e.id and zo.entfernt_am is null
     where e.mandant_id = ${mandantId}
       and e.storniert_am is null
       and e.beginn_lokal < time '09:00'
       and e.plan_datum between (${heute}::date - 14) and (${heute}::date - 1)
     order by e.plan_datum desc, e.beginn_lokal
     limit 1`;
  if (frueh === undefined) return 0;

  const vortag = tagePlus(frueh.tag, -1);
  const schluessel = `seed:sonderreinigung:${vortag}`;

  const [schon] = await sql<{ id: string }[]>`
    select id from einsatz
     where mandant_id = ${mandantId} and quell_schluessel = ${schluessel}`;
  if (schon !== undefined) return 0;

  /**
   * 22:00–02:00 ueber Mitternacht, mit `app.loese_ortszeit`: aus Ortszeit
   * einen Zeitpunkt zu machen ist die Aufgabe der Datenbank (Invariante 2),
   * und ueber die Sommerzeitgrenze rechnet sie richtig, wo `new Date()`
   * daneben laege.
   */
  const [neuerEinsatz] = await sql<{ id: string }[]>`
    insert into einsatz (
      mandant_id, quelle, quell_schluessel, plan_datum,
      beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
      beginn_lokal, ende_lokal, endet_am_folgetag,
      objekt_id, kunde_id, soll_besetzung, min_besetzung,
      pause_geplant_minuten, erstellt_von_art, status, notiz
    )
    select ${mandantId}, 'manuell', ${schluessel}, ${vortag}::date,
           (select zeitpunkt from app.loese_ortszeit(${vortag}::date, time '22:00', 'Europe/Berlin')),
           (select zeitpunkt from app.loese_ortszeit((${vortag}::date + 1), time '02:00', 'Europe/Berlin')),
           'Europe/Berlin', time '22:00', time '02:00', true,
           ${frueh.objekt}, ${frueh.kunde}, 1, 1,
           30, 'system', 'geplant',
           'Sonderreinigung nach Veranstaltung — Demodaten (Seed)'
    returning id`;
  if (neuerEinsatz === undefined) return 0;

  try {
    await alsPortalSitzung(sql, mandantId, planerId, (k) =>
      besetzeEinsatz(k, {
        einsatzId: neuerEinsatz.id,
        anstellungId: frueh.anstellung,
        // Der Befund IST der Punkt. Bestaetigt, weil eine Planung, die ihn
        // wegklickt, ihn auch begruenden muss — und genau diese Begruendung
        // soll in der Demo lesbar sein.
        bestaetigt: true,
      }));
    return 1;
  } catch (fehler) {
    process.stdout.write(
      `  · Ruhezeitkonflikt nicht angelegt: `
      + `${fehler instanceof Error ? fehler.message : String(fehler)}\n`,
    );
    return 0;
  }
}

/**
 * Ein GETEILTER Dienst — früh und abends am selben Tag, ohne § 5-Befund
 * (V-193, D-684).
 *
 * Das Grundmuster der Gebäudereinigung: morgens das Büro, abends noch einmal.
 * § 5 Abs. 1 ArbZG verlangt die elf Stunden Ruhe „nach Beendigung der
 * täglichen Arbeitszeit"; die Unterbrechung zwischen den Teilen ist keine
 * Ruhezeit. Bis V-190 meldete die Prüfung sie trotzdem als Verstoss, und die
 * Demo zeigte den Fall nie. Hier steht er: eine besetzte Frühschicht
 * (06:00–09:30) und am SELBEN Tag ein zweiter Teil 17:00–18:30 für dieselbe
 * Kraft, eingeteilt über den echten Dienst OHNE Bestätigung — geht das nur
 * mit einem Befund, bleibt er aus und der Seed sagt es.
 *
 * Gewählt wird eine Frühschicht, um die herum die Kraft von 20:00 am Vortag
 * bis 08:00 am übernächsten Tag nichts anderes hat: dann liegt vor dem ersten
 * und nach dem zweiten Teil mehr als elf Stunden Ruhe, und der Fall zeigt
 * genau EINE Sache — den geteilten Dienst. Zusammen sind es fünf Stunden;
 * § 3 und § 4 haben nichts zu melden. Der Ruhezeitkonflikt oben (22:00–02:00
 * vor einer Frühschicht) bleibt, was er ist: ein Verstoss.
 */
async function seedGeteilterDienst(
  sql: Sql, mandantId: string, planerId: string, heute: string,
): Promise<number> {
  const [frueh] = await sql<{
    anstellung: string; objekt: string; kunde: string | null; tag: string;
  }[]>`
    select zo.anstellung_id as anstellung, e.objekt_id as objekt, e.kunde_id as kunde,
           to_char(e.plan_datum, 'YYYY-MM-DD') as tag
      from einsatz e
      join einsatz_zuordnung zo
        on zo.mandant_id = e.mandant_id and zo.einsatz_id = e.id and zo.entfernt_am is null
     where e.mandant_id = ${mandantId}
       and e.storniert_am is null
       and e.beginn_lokal = time '06:00'
       and not e.endet_am_folgetag
       and e.plan_datum between (${heute}::date - 14) and (${heute}::date - 2)
       and not exists (
             select 1
               from einsatz_zuordnung z2
               join einsatz e2 on e2.mandant_id = z2.mandant_id and e2.id = z2.einsatz_id
              where z2.person_id = zo.person_id
                and z2.entfernt_am is null
                and e2.storniert_am is null
                and e2.id <> e.id
                and e2.beginn_zeitpunkt
                    < ((e.plan_datum + 2)::timestamp + time '08:00') at time zone 'Europe/Berlin'
                and e2.ende_zeitpunkt
                    > ((e.plan_datum - 1)::timestamp + time '20:00') at time zone 'Europe/Berlin')
       -- Und an diesem Tag nicht abgemeldet: eine Abwesenheit wäre ein
       -- anderer Befund als der, den dieser Fall zeigen soll.
       and not exists (
             select 1 from abwesenheit ab
              where ab.anstellung_id = zo.anstellung_id
                and ab.status::text not in ('abgelehnt', 'storniert')
                and e.plan_datum between ab.von and ab.bis)
     order by e.plan_datum, e.id
     limit 1`;
  if (frueh === undefined) return 0;

  const schluessel = `seed:teildienst:${frueh.tag}`;
  const [schon] = await sql<{ id: string }[]>`
    select id from einsatz
     where mandant_id = ${mandantId} and quell_schluessel = ${schluessel}`;
  if (schon !== undefined) return 0;

  const [abend] = await sql<{ id: string }[]>`
    insert into einsatz (
      mandant_id, quelle, quell_schluessel, plan_datum,
      beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
      beginn_lokal, ende_lokal, endet_am_folgetag,
      objekt_id, kunde_id, soll_besetzung, min_besetzung,
      pause_geplant_minuten, erstellt_von_art, status, notiz
    )
    select ${mandantId}, 'manuell', ${schluessel}, ${frueh.tag}::date,
           (select zeitpunkt from app.loese_ortszeit(${frueh.tag}::date, time '17:00', 'Europe/Berlin')),
           (select zeitpunkt from app.loese_ortszeit(${frueh.tag}::date, time '18:30', 'Europe/Berlin')),
           'Europe/Berlin', time '17:00', time '18:30', false,
           ${frueh.objekt}, ${frueh.kunde}, 1, 1,
           0, 'system', 'geplant',
           'Abendreinigung, zweiter Teil eines geteilten Dienstes — Demodaten (Seed)'
    returning id`;
  if (abend === undefined) return 0;

  try {
    await alsPortalSitzung(sql, mandantId, planerId, (k) =>
      // OHNE `bestaetigt`: ein geteilter Dienst ist kein Befund, der quittiert wird.
      besetzeEinsatz(k, { einsatzId: abend.id, anstellungId: frueh.anstellung }));
    return 1;
  } catch (fehler) {
    process.stdout.write(
      `  · Geteilter Dienst nicht eingeteilt — die Prüfung meldet einen Befund, den es `
      + `nach § 5 nicht gibt: ${fehler instanceof Error ? fehler.message : String(fehler)}\n`,
    );
    return 0;
  }
}

/**
 * Zwei Abwesenheiten und ein offener Antrag — damit die Personalseiten nicht
 * leer sind und der Dienstplan zeigt, was er bei einer Abmeldung tut.
 *
 * **Der Urlaubsanspruch wird VORHER eingetragen**, weil die Genehmigung sonst
 * mit „kein Urlaubsanspruch hinterlegt (O-18)" abbricht — und genau das soll
 * sie: eine Demo, die diesen Halt umgeht, zeigt eine Plattform, die es nicht
 * gibt. 30 Tage sind hier ein DEMOWERT und keine Zusage; die Frage steht
 * offen.
 */
async function seedAbwesenheiten(
  sql: Sql, mandantId: string, planerId: string,
  anstellungen: readonly string[], heute: string,
): Promise<number> {
  const [krank] = await sql<{ id: string }[]>`
    select id from abwesenheitsart where schluessel = 'krankheit' and mandant_id is null`;
  const [urlaub] = await sql<{ id: string }[]>`
    select id from abwesenheitsart where schluessel = 'urlaub' and mandant_id is null`;
  const [urlaubsantrag] = await sql<{ id: string }[]>`
    select id from antragsart where schluessel = 'urlaub' and mandant_id is null`;
  const ersteAnstellung = anstellungen[0];
  const zweiteAnstellung = anstellungen[1] ?? anstellungen[0];
  if (krank === undefined || urlaub === undefined || urlaubsantrag === undefined
      || ersteAnstellung === undefined || zweiteAnstellung === undefined) {
    return 0;
  }

  /**
   * Die Lohnfrage der beiden benutzten Arten wird hier beantwortet — und zwar
   * SICHTBAR als Demowert. Ohne Antwort verweigert der Dienst die Verwendung
   * (O-139), und das ist richtig so; ein Seed, der die Verweigerung umgeht,
   * ohne es zu sagen, waere die schlechtere Haelfte.
   */
  await sql`
    update abwesenheitsart set bezahlt = true
     where id in (${krank.id}, ${urlaub.id}) and bezahlt is null`;

  const [da] = await sql<{ anzahl: string }[]>`
    select count(*)::text as anzahl from abwesenheit where mandant_id = ${mandantId}`;
  if (Number(da?.anzahl ?? '0') > 0) return 0;

  let angelegt = 0;
  // Eine laufende Krankmeldung — der Fall, den der Dienstplan kennzeichnen soll.
  await sql`
    insert into abwesenheit
      (mandant_id, anstellung_id, abwesenheitsart_id, von, bis, tage_angerechnet,
       status, erstellt_von)
    values (${mandantId}, ${ersteAnstellung}, ${krank.id},
            ${tagePlus(heute, -1)}::date, ${tagePlus(heute, 2)}::date, 4,
            'erfasst', ${planerId})`;
  angelegt += 1;

  // Und ein offener Urlaubsantrag im Posteingang der Planung.
  const jahr = Number(tagePlus(heute, 30).slice(0, 4));
  await sql`
    insert into urlaubskonto (mandant_id, anstellung_id, jahr, anspruch_tage, erstellt_von)
    values (${mandantId}, ${zweiteAnstellung}, ${jahr}, 30, ${planerId})
    on conflict (anstellung_id, jahr) do nothing`;
  /*
   * Die Konten, die die DETAILSEITEN brauchen — und zwar bevor die Zeilen
   * entstehen, die darauf zeigen.
   *
   * Das Detailblatt einer Abwesenheit zeigt den Stand des Jahres daneben, und
   * „kein Anspruch hinterlegt" ist dort eine Warnung: im Seed soll der
   * Normalfall zu sehen sein. Und eine Genehmigung verlangt ein OFFENES Konto
   * des Jahres, in dem der Urlaub beginnt (O-18) — liegt der beantragte
   * Zeitraum im naechsten Kalenderjahr, braucht auch DAS Jahr ein Konto,
   * sonst bricht die Genehmigung mit `no_data_found` ab.
   */
  const jahrBeantragt = Number(tagePlus(heute, 60).slice(0, 4));
  for (const [anstellung, j] of [
    [ersteAnstellung, Number(heute.slice(0, 4))],
    [zweiteAnstellung, jahrBeantragt],
  ] as const) {
    await sql`
      insert into urlaubskonto (mandant_id, anstellung_id, jahr, anspruch_tage, erstellt_von)
      values (${mandantId}, ${anstellung}, ${j}, 30, ${planerId})
      on conflict (anstellung_id, jahr) do nothing`;
  }

  /**
   * **Eine BEANTRAGTE Abwesenheit — sonst ist die Entscheidung nicht
   * vorfuehrbar.**
   *
   * Der Seed hatte `erfasst` (eine Krankmeldung, die zur Kenntnis genommen
   * wird) und `storniert`, aber keine einzige Zeile im Status `beantragt`.
   * Genau die ist die Voraussetzung fuer „Genehmigen" und „Ablehnen" auf
   * `/personal/abwesenheiten/[id]`: der Dienst laesst beide nur aus
   * `beantragt` heraus zu. Ohne diese Zeile zeigt die Seite ihre Entscheidung
   * nie, und „seed data exercises it" (CLAUDE.md, Definition of done) waere
   * fuer die Route nicht erfuellt.
   */
  await sql`
    insert into abwesenheit
      (mandant_id, anstellung_id, abwesenheitsart_id, von, bis, tage_angerechnet,
       status, erstellt_von)
    values (${mandantId}, ${zweiteAnstellung}, ${urlaub.id},
            ${tagePlus(heute, 60)}::date, ${tagePlus(heute, 64)}::date, 5,
            'beantragt', ${planerId})`;
  angelegt += 1;

  await sql`
    insert into antrag
      (mandant_id, anstellung_id, antragsart_id, von_datum, bis_datum,
       abwesenheitsart_id, nachricht, eingereicht_von_benutzer_id)
    values (${mandantId}, ${zweiteAnstellung}, ${urlaubsantrag.id},
            ${tagePlus(heute, 30)}::date, ${tagePlus(heute, 34)}::date,
            ${urlaub.id}, 'Kurzurlaub — Demodaten (Seed)', ${planerId})`;
  angelegt += 1;

  return angelegt;
}

/**
 * Zwei Einwaende — einer offen, einer entschieden und korrigiert (EMP-07,
 * TIM-11).
 *
 * **Der Befund, der diese Funktion gebracht hat.** Der Seed legte KEINEN
 * einzigen `zeit_einwand` an. Der Einwandeingang
 * (`/portal/[mandant]/zeiten/einwaende`) und das Einwandblatt daneben waren
 * damit auf jedem Bildschirm leer — nicht mit einer Meldung, sondern mit „0",
 * und zwar ueberzeugend. Die eine Zeile, die eine Pruefung in `cse_dev` fand,
 * stammte aus einem Browserlauf (`tests/e2e/mitarbeiter.spec.ts`), nicht aus
 * dem Seed: sie verschwindet mit dem naechsten Neuaufbau.
 *
 * **Zwei Zustaende und nicht einer.** Ein einziger offener Einwand liesse die
 * HAELFTE des Blattes ungeuebt: die Entscheidung mit Urheber, Serverzeitpunkt
 * und Begruendung, und daneben die Frage, ob eine Korrektur gefolgt ist. Der
 * zweite Einwand geht deshalb den ganzen Weg — gemeldet, anerkannt,
 * korrigiert — und die Korrektur traegt `zeit_einwand_id`, damit auf dem Blatt
 * steht, dass sie gefolgt ist.
 *
 * **Jeder Schritt mit der Sitzung, der ihn im Betrieb macht.** Die Meldung
 * schreibt die betroffene PERSON (`t_selbst_einreichen` prueft
 * `app.aktuelle_person()`), Entscheidung und Korrektur die PLANUNG — ueber den
 * eigenen Einwand entscheidet man nicht (EMP-07), und den eigenen Zeiteintrag
 * korrigiert man nicht (`zk_nicht_selbst`). Ein Seed, der beides aus einer
 * Sitzung schriebe, zeigte einen Weg, den es nicht gibt.
 */
async function seedEinwaende(
  sql: Sql, mandantId: string, planerId: string,
): Promise<number> {
  const [da] = await sql<{ anzahl: string }[]>`
    select count(*)::text as anzahl from zeit_einwand where mandant_id = ${mandantId}`;
  if (Number(da?.anzahl ?? '0') > 0) return 0;

  /*
   * Zwei ABGESCHLOSSENE Eintraege, deren Person ein eigenes Konto hat — ohne
   * Konto gaebe es keine Sitzung, aus der die Meldung kommen koennte. Das
   * Planerkonto ist ausgeschlossen: es muss danach entscheiden.
   */
  const kandidaten = await sql<{
    id: string; anstellung_id: string; person_id: string; benutzer_id: string; tag: string;
  }[]>`
    select z.id, z.anstellung_id, z.person_id, b.id as benutzer_id,
           to_char((z.beginn_zeitpunkt at time zone 'Europe/Berlin'), 'YYYY-MM-DD') as tag
      from zeiteintrag z
      join anstellung a on a.mandant_id = z.mandant_id and a.id = z.anstellung_id
      join benutzer b on b.person_id = a.person_id and b.status = 'aktiv'
                     and b.deaktiviert_am is null
     where z.mandant_id = ${mandantId} and z.status = 'abgeschlossen'
       and z.ersetzt_am is null and z.storniert_am is null
       and b.id <> ${planerId}
     order by z.beginn_zeitpunkt desc
     limit 2`;
  if (kandidaten.length === 0) return 0;

  let angelegt = 0;

  /* 1. Der OFFENE — der Eingang der Planung soll etwas zu tun haben. */
  const offen = kandidaten[0];
  if (offen !== undefined) {
    await alsPortalSitzung(sql, mandantId, offen.benutzer_id, (k) =>
      reicheEinwandEin(k, {
        anstellungId: offen.anstellung_id,
        zeiteintragId: offen.id,
        art: 'pause_falsch',
        betrifftDatum: offen.tag,
        begruendung:
          'Die Pause war kürzer — im Objekt kam ein Anruf, ich war nach 15 Minuten zurück.',
        eingereichtVonBenutzerId: offen.benutzer_id,
      }), { personId: offen.person_id });
    angelegt += 1;
  }

  /* 2. Der ENTSCHIEDENE, mit Korrektur — der Weg zu Ende gegangen. */
  const erledigt = kandidaten[1];
  if (erledigt !== undefined) {
    const einwandId = await alsPortalSitzung(sql, mandantId, erledigt.benutzer_id, (k) =>
      reicheEinwandEin(k, {
        anstellungId: erledigt.anstellung_id,
        zeiteintragId: erledigt.id,
        art: 'zeit_falsch',
        betrifftDatum: erledigt.tag,
        begruendung:
          'Ich habe eine halbe Stunde vor dem Stempeln angefangen — das Tor war zu.',
        eingereichtVonBenutzerId: erledigt.benutzer_id,
      }), { personId: erledigt.person_id });

    await alsPortalSitzung(sql, mandantId, planerId, (k) =>
      entscheideEinwand(k, {
        einwandId,
        status: 'anerkannt',
        begruendung: 'Die Objektleitung bestätigt den frühen Beginn; der Schlüsseldienst kam später.',
        entschiedenVon: planerId,
      }));

    /*
     * Die Korrektur verlegt den Beginn um 30 Minuten vor — die MENGE kommt
     * aus der Behauptung der Person und wird hier nicht gerechnet, sondern
     * als Entscheidung eines Menschen geschrieben (Invariante 6). Der Beginn
     * kommt als Instant aus der DATENBANK: 30 Minuten vor einem gespeicherten
     * Zeitpunkt ist eine Differenz von Instants und keine Wanduhrrechnung
     * (Invariante 2).
     */
    const [vor] = await sql<{ beginn: Date }[]>`
      select (beginn_zeitpunkt - interval '30 minutes') as beginn
        from zeiteintrag where id = ${erledigt.id}`;
    if (vor !== undefined) {
      await alsPortalSitzung(sql, mandantId, planerId, (k) =>
        korrigiereZeiteintrag(k, {
          zeiteintragId: erledigt.id,
          art: 'zeit_korrektur',
          grundKategorie: 'einwand_mitarbeiter',
          begruendung: 'Beginn um 30 Minuten vorverlegt, wie gemeldet und bestätigt.',
          durchgefuehrtVon: planerId,
          zeitEinwandId: einwandId,
          beginnZeitpunkt: vor.beginn,
        }));
    }
    angelegt += 1;
  }

  return angelegt;
}

/**
 * Eine Schicht, die besetzt ist — aber nicht voll (TIM-05, O-210).
 *
 * **Der Befund, der diese Funktion gebracht hat.** Ueber alle 169 geseedeten
 * Einsaetze galt `unter_min == unter_soll`: es gab keinen einzigen Fall, in
 * dem die Mindestbesetzung steht und die Sollbesetzung fehlt. Genau dieser
 * Fall ist aber die schwaechere der beiden Markierungen auf
 * `/dienstplan/offene-schichten` — und eine Markierung, die von keiner Zeile
 * ausgeloest wird, ist eine Behauptung ueber eine Oberflaeche, die niemand je
 * gesehen hat.
 *
 * `soll_besetzung = 3`, `min_besetzung = 1`, eine Person eingeteilt: der
 * Einsatz laeuft (die Mindestbesetzung steht), und es fehlen zwei. Die Zahlen
 * sind DEMOWERTE und keine Regel — ob eine vereinbarte Staerke zugleich
 * Mindestbesetzung ist, ist offen (O-210).
 */
async function seedTeilbesetzteSchicht(
  sql: Sql, mandantId: string, planerId: string,
  anstellungen: readonly string[], heute: string,
): Promise<number> {
  const schluessel = 'seed:teilbesetzt:tagdienst';
  const [schon] = await sql<{ id: string }[]>`
    select id from einsatz
     where mandant_id = ${mandantId} and quell_schluessel = ${schluessel}`;
  if (schon !== undefined) return 0;

  const erste = anstellungen[0];
  if (erste === undefined) return 0;

  // Im Vorgabefenster der Seite: die naechsten 14 Tage, also uebermorgen.
  const tag = tagePlus(heute, 2);

  const [ort] = await sql<{ objekt: string; kunde: string | null }[]>`
    select e.objekt_id as objekt, e.kunde_id as kunde
      from einsatz e
     where e.mandant_id = ${mandantId} and e.kunde_id is not null
       and e.storniert_am is null
     order by e.plan_datum limit 1`;
  if (ort === undefined) return 0;

  const [neu] = await sql<{ id: string }[]>`
    insert into einsatz (
      mandant_id, quelle, quell_schluessel, plan_datum,
      beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
      beginn_lokal, ende_lokal, endet_am_folgetag,
      objekt_id, kunde_id, soll_besetzung, min_besetzung,
      pause_geplant_minuten, erstellt_von_art, status, notiz
    )
    select ${mandantId}, 'manuell', ${schluessel}, ${tag}::date,
           (select zeitpunkt from app.loese_ortszeit(${tag}::date, time '08:00', 'Europe/Berlin')),
           (select zeitpunkt from app.loese_ortszeit(${tag}::date, time '16:00', 'Europe/Berlin')),
           'Europe/Berlin', time '08:00', time '16:00', false,
           ${ort.objekt}, ${ort.kunde}, 3, 1,
           30, 'system', 'geplant',
           'Grundreinigung, drei Kräfte vorgesehen — Demodaten (Seed)'
    returning id`;
  if (neu === undefined) return 0;

  try {
    await alsPortalSitzung(sql, mandantId, planerId, (k) =>
      besetzeEinsatz(k, { einsatzId: neu.id, anstellungId: erste, bestaetigt: true }));
    return 1;
  } catch (fehler) {
    process.stdout.write(
      '  · Teilbesetzte Schicht nicht besetzt: '
      + `${fehler instanceof Error ? fehler.message : String(fehler)}\n`,
    );
    return 0;
  }
}

function leer(): ZeitErgebnis {
  return {
    einteilungen: 0, uebergangen: 0, zeiteintraege: 0,
    laufend: 0, abwesenheiten: 0, ansprueche: 0,
  };
}

/**
 * Die Zeit zu den vergangenen Schichten.
 *
 * Ein bisschen Streuung gehoert dazu: eine Demo, in der jede Schicht auf die
 * Sekunde ihrem Plan folgt, zeigt die Differenz nicht, um derentwillen es die
 * Zeiterfassung gibt. Die Streuung ist deterministisch aus der Kennung
 * abgeleitet — ein Seed, der bei jedem Lauf andere Zahlen erzeugt, ist als
 * Vergleichsgrundlage wertlos.
 */
async function erfasseZeiten(
  sql: Sql, mandantId: string,
  zugeteilt: readonly { einsatzId: string; zuordnungId: string; vergangen: boolean }[],
): Promise<{ erfasst: number; laufend: number }> {
  let erfasst = 0;
  let laufend = 0;
  let nacherfasstGesetzt = false;
  let geraeteAbweichungGesetzt = false;

  for (const z of zugeteilt) {
    if (!z.vergangen) continue;

    const [da] = await sql<{ id: string }[]>`
      select id from zeiteintrag where einsatz_zuordnung_id = ${z.zuordnungId}`;
    if (da !== undefined) continue;

    // Deterministisch: die ersten beiden Hexstellen der Zuordnungskennung.
    const streu = Number.parseInt(z.zuordnungId.slice(0, 2), 16);
    const beginnVersatz = (streu % 11) - 5;          // -5 … +5 Minuten
    const endeVersatz = ((streu >> 3) % 13) - 4;     // -4 … +8 Minuten
    const nacherfasst = !nacherfasstGesetzt && streu % 7 === 3;
    /**
     * Die Uhr des Telefons geht gut zwei Minuten nach — mehr sagt dieser Wert
     * nicht, und mehr darf er nicht sagen (TIM-08, Invariante 5).
     *
     * Er wird unten auf den ERFASSTEN Beginn gesetzt und nicht mehr auf den
     * geplanten. Vorher stand die Geraetezeit am Planbeginn, der Eintrag aber
     * am Planbeginn PLUS `beginnVersatz` — der Ausloeser schrieb in
     * `zeitabweichung_beginn_sek` also die Summe aus Uhrenversatz und
     * Verspaetung. Genau die beiden Groessen, die TIM-08 in getrennte Spalten
     * legt, standen in derselben. Sichtbar wurde es nicht: `beginnVersatz`
     * haengt an der Zuordnungskennung, also an einer zufaelligen UUID, und
     * lag zwischen −5 und +5 Minuten. Die angezeigte Geraeteabweichung war
     * damit je Seed eine andere Zahl zwischen −427 und +173 Sekunden — bei
     * positivem Versatz ginge das Telefon ploetzlich VOR, und die eine Zeile,
     * an der sich die Trennung vorfuehren laesst, zeigte das Gegenteil dessen,
     * was hier steht.
     */
    const geraeteVersatz = !geraeteAbweichungGesetzt && streu % 5 === 2 ? -127 : null;
    if (nacherfasst) nacherfasstGesetzt = true;
    if (geraeteVersatz !== null) geraeteAbweichungGesetzt = true;

    await sql`
      insert into zeiteintrag
        (mandant_id, anstellung_id, person_id, einsatz_id, einsatz_zuordnung_id,
         objekt_id, revier_id,
         beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
         erfassungsart_beginn, quelle_beginn, erfassungsart_ende, quelle_ende,
         geraete_zeit_beginn, nacherfasst, behauptet_beginn,
         status, notiz, erstellt_von_art)
      select ${mandantId}, zo.anstellung_id, zo.person_id, e.id, zo.id,
             e.objekt_id, e.revier_id,
             e.beginn_zeitpunkt + make_interval(mins => ${beginnVersatz}),
             e.ende_zeitpunkt   + make_interval(mins => ${endeVersatz}),
             /**
              * Die Pause nach § 4 ArbZG: 30 Minuten ueber sechs Stunden, 45
              * ueber neun. Das ist die gesetzliche MINDESTPAUSE und keine
              * Aussage darueber, was die Gruppe vereinbart hat — die Frage
              * steht offen (O-168), und dieser Seed erfindet sie nicht,
              * sondern nimmt den Wert, unter den niemand darf.
              */
             case
               when extract(epoch from (e.ende_zeitpunkt - e.beginn_zeitpunkt)) > 9 * 3600
                 then 45
               when extract(epoch from (e.ende_zeitpunkt - e.beginn_zeitpunkt)) > 6 * 3600
                 then 30
               else 0
             end,
             ${nacherfasst ? 'nacherfassung' : 'import'}::erfassungs_art, 'import'::zeitquelle,
             'import'::erfassungs_art, 'import'::zeitquelle,
             case when ${geraeteVersatz}::int is null then null
                  else e.beginn_zeitpunkt
                       + make_interval(mins => ${beginnVersatz})
                       + make_interval(secs => ${geraeteVersatz}::int) end,
             ${nacherfasst},
             case when ${nacherfasst} then e.beginn_zeitpunkt else null end,
             'abgeschlossen', 'Demodaten (Seed)', 'system'
        from einsatz e
        join einsatz_zuordnung zo on zo.id = ${z.zuordnungId}
       where e.id = ${z.einsatzId}`;
    erfasst += 1;
  }

  /**
   * Und EIN laufender Eintrag, damit das Live-Brett nicht leer ist.
   *
   * Er haengt an der naechsten Einteilung, die schon begonnen hat — gibt es
   * keine, bleibt das Brett leer, und das ist die richtige Antwort: erfunden
   * wird hier nichts.
   */
  const [offen] = await sql<{ zuordnung: string; einsatz: string }[]>`
    select zo.id as zuordnung, e.id as einsatz
      from einsatz_zuordnung zo
      join einsatz e on e.mandant_id = zo.mandant_id and e.id = zo.einsatz_id
     where zo.mandant_id = ${mandantId} and zo.entfernt_am is null
       and e.beginn_zeitpunkt <= now() and e.ende_zeitpunkt > now()
       and not exists (select 1 from zeiteintrag z where z.einsatz_zuordnung_id = zo.id)
     order by e.beginn_zeitpunkt limit 1`;
  if (offen !== undefined) {
    await sql`
      insert into zeiteintrag
        (mandant_id, anstellung_id, person_id, einsatz_id, einsatz_zuordnung_id,
         objekt_id, revier_id, beginn_zeitpunkt, pause_minuten,
         erfassungsart_beginn, quelle_beginn, status, notiz, erstellt_von_art)
      select ${mandantId}, zo.anstellung_id, zo.person_id, e.id, zo.id,
             e.objekt_id, e.revier_id, e.beginn_zeitpunkt, 0,
             'import'::erfassungs_art, 'import'::zeitquelle,
             'laufend', 'Demodaten (Seed) — laufender Eintrag', 'system'
        from einsatz_zuordnung zo
        join einsatz e on e.mandant_id = zo.mandant_id and e.id = zo.einsatz_id
       where zo.id = ${offen.zuordnung}`;
    laufend = 1;
  }

  /**
   * Laeuft gerade keine Schicht, entsteht ein Eintrag OHNE Schicht — und das
   * ist keine Notluege, sondern der zweite echte Fall: ungeplante Arbeit auf
   * Abruf. Er hat keine Leistungszeile und taucht damit dort auf, wo FIN-18
   * ihn haben will (`zeiteintrag_ohne_auftrag`) — die Gegenliste, ohne die
   * eine geleistete Stunde still verschwaende.
   *
   * Zwei Stunden zurueck, damit auf dem Live-Brett eine Dauer steht und nicht
   * „0:00 h".
   */
  if (laufend === 0) {
    const [zeile] = await sql<{ anstellung: string; person: string; objekt: string }[]>`
      select a.id as anstellung, a.person_id as person, o.id as objekt
        from anstellung a
        cross join lateral (
          select id from objekt
           where mandant_id = ${mandantId} and archiviert_am is null
           order by objektnummer limit 1) o
       where a.mandant_id = ${mandantId} and a.status = 'aktiv' and a.geloescht_am is null
         and not exists (
           select 1 from zeiteintrag z
            where z.anstellung_id = a.id and z.ende_zeitpunkt is null
              and z.storniert_am is null and z.ersetzt_am is null)
       order by a.personalnummer limit 1`;
    if (zeile !== undefined) {
      await sql`
        insert into zeiteintrag
          (mandant_id, anstellung_id, person_id, objekt_id,
           beginn_zeitpunkt, pause_minuten,
           erfassungsart_beginn, quelle_beginn, status, notiz, erstellt_von_art)
        values (${mandantId}, ${zeile.anstellung}, ${zeile.person}, ${zeile.objekt},
                now() - interval '2 hours', 0,
                'import', 'import', 'laufend',
                'Demodaten (Seed) — Abrufeinsatz ohne Planung', 'system')`;
      laufend = 1;
    }
  }

  return { erfasst, laufend };
}
