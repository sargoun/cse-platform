import { createHash, randomBytes } from 'node:crypto';
import type postgres from 'postgres';

/**
 * Betroffenenrechte und Widersprüche für die Vorführung (LEG-09, LEG-08).
 *
 * **Der Befund, der diese Datei gebracht hat.** Nachgezählt vor diesem PR:
 * NULL `betroffenenanfrage`-Zeilen und NULL Widersprüche (0 von 6
 * `ansprechpartner`, 0 von 7 `kunde`). Damit gab es keine `[id]`, die man
 * aufrufen konnte — die vier Vorgangsseiten waren weder klickbar noch
 * e2e-prüfbar, und `/datenschutz/widersprueche` hätte zwei leere Listen
 * gezeigt. Ein Bildschirm, der nichts zeigt, beweist nicht, dass er
 * funktioniert.
 *
 * **Nur mit `CSE_DEV_FLAECHEN`** — dieselbe Regel wie im Recruiting, und aus
 * demselben Grund: eine Betroffenenanfrage ist ein Mensch mit Namen und
 * E-Mail-Adresse. In einem echten Bau hat die nicht erfunden dazustehen. Die
 * Adressen liegen auf `@example.test` (RFC 6761), damit keine davon
 * versehentlich jemanden erreicht.
 *
 * **Jeder Zustand kommt einmal vor**, sonst sind die Filter leer und der
 * Fristbalken hat nur eine Farbe: ein frischer Eingang, einer in Arbeit mit
 * Zuordnung, einer ÜBERFÄLLIG, einer mit verlängerter Frist, einer
 * beantwortet — samt Auskunftsartefakt mit Prüfsumme.
 *
 * **Die Widersprüche entstehen auf dem ECHTEN Weg**, nicht als
 * Zeitstempel-Update: der Token wird ausgegeben, gehasht abgelegt und über
 * `app.werbewiderspruch_einloesen` verbraucht (K-09). Ein Seed, der die
 * Zeitstempel direkt setzte, liesse die Protokollzeile fehlen — und genau die
 * ist der Nachweis, um den es geht.
 */

export interface DatenschutzErgebnis {
  readonly anfragen: number;
  readonly loeschentscheidungen: number;
  readonly berichtigungsfelder: number;
  readonly auskuenfte: number;
  readonly werbewiderspruch: number;
  readonly art21: number;
  readonly uebersprungen: boolean;
}

const LEER: DatenschutzErgebnis = {
  anfragen: 0, loeschentscheidungen: 0, berichtigungsfelder: 0, auskuenfte: 0,
  werbewiderspruch: 0, art21: 0, uebersprungen: true,
};

interface Vorlage {
  readonly art: 'auskunft' | 'berichtigung' | 'loeschung' | 'einschraenkung'
    | 'uebertragbarkeit' | 'widerspruch';
  readonly name: string;
  readonly email: string;
  readonly rolle: string | null;
  readonly nachricht: string;
  /** Tage in der Vergangenheit — negativ gibt es nicht. */
  readonly vorTagen: number;
  readonly status: 'neu' | 'identitaet_offen' | 'in_bearbeitung' | 'beantwortet';
  readonly zuordnung: 'person' | 'ansprechpartner' | 'bewerbung' | 'keine';
  readonly verlaengert?: string;
  readonly entscheidung?: string;
}

const VORLAGEN: readonly Vorlage[] = [
  {
    art: 'auskunft',
    name: 'Amira Said',
    email: 'amira.said@example.test',
    rolle: 'Beschäftigte',
    nachricht: 'Bitte teilen Sie mir mit, welche Daten Sie über mich gespeichert '
      + 'haben — insbesondere zu meinen Arbeitszeiten.',
    vorTagen: 4,
    status: 'in_bearbeitung',
    zuordnung: 'person',
  },
  {
    art: 'loeschung',
    name: 'Bogdan Nowak',
    email: 'b.nowak@example.test',
    rolle: 'Kunde',
    nachricht: 'Ich möchte, dass Sie alle meine Daten löschen.',
    vorTagen: 9,
    status: 'in_bearbeitung',
    zuordnung: 'ansprechpartner',
  },
  {
    art: 'berichtigung',
    name: 'Clara Weiss',
    email: 'clara.weiss@example.test',
    rolle: 'Bewerberin',
    nachricht: 'Mein Nachname ist falsch geschrieben, und die Telefonnummer '
      + 'stimmt nicht mehr.',
    vorTagen: 12,
    status: 'in_bearbeitung',
    zuordnung: 'bewerbung',
  },
  {
    art: 'widerspruch',
    name: 'Dmitri Petrow',
    email: 'd.petrow@example.test',
    rolle: null,
    nachricht: 'Ich widerspreche der Verarbeitung meiner Daten.',
    /*
     * ÜBERFÄLLIG, mit Absicht: die Frist des Art. 12 Abs. 3 ist ein Monat, und
     * nur eine überschrittene Zeile zeigt, dass die Liste rot werden kann.
     */
    vorTagen: 41,
    status: 'neu',
    zuordnung: 'keine',
  },
  {
    art: 'auskunft',
    name: 'Eleni Papadaki',
    email: 'e.papadaki@example.test',
    rolle: 'Besucherin der Website',
    nachricht: 'Welche Daten haben Sie über mich aus dem Kontaktformular?',
    vorTagen: 25,
    status: 'in_bearbeitung',
    zuordnung: 'keine',
    verlaengert: 'Der Antrag betrifft vier Datenklassen und zwei Gesellschaften; '
      + 'die Zusammenstellung braucht mehr Zeit (Art. 12 Abs. 3 Satz 3).',
  },
  {
    art: 'auskunft',
    name: 'Farid Haddad',
    email: 'f.haddad@example.test',
    rolle: 'Beschäftigter',
    nachricht: 'Bitte um Auskunft nach Art. 15 DSGVO.',
    vorTagen: 60,
    status: 'beantwortet',
    zuordnung: 'person',
    entscheidung: 'Auskunft nach Art. 15 am Tag der Entscheidung vollständig '
      + 'erteilt und als Markdown ausgehändigt; Prüfsumme im Nachweis.',
  },
];

interface Ziele {
  readonly personId: string | null;
  readonly ansprechpartnerId: string | null;
  readonly kundeId: string | null;
  readonly bewerbungId: string | null;
}

async function zieleFuer(
  sql: postgres.Sql, mandantId: string,
): Promise<Ziele> {
  const [p] = await sql<{ id: string }[]>`
    select a.person_id as id from anstellung a
     where a.mandant_id = ${mandantId} and a.geloescht_am is null
     order by a.eintritt limit 1`;
  const [ap] = await sql<{ id: string; kunde_id: string | null }[]>`
    select id, kunde_id from ansprechpartner
     where mandant_id = ${mandantId} and archiviert_am is null
       and anonymisiert_am is null and email is not null
     order by nachname limit 1`;
  const [b] = await sql<{ id: string }[]>`
    select id from bewerbung
     where mandant_id = ${mandantId} and geloescht_am is null
     order by eingegangen_am limit 1`;
  return {
    personId: p?.id ?? null,
    ansprechpartnerId: ap?.id ?? null,
    kundeId: ap?.kunde_id ?? null,
    bewerbungId: b?.id ?? null,
  };
}

/**
 * Wer die Vorgänge entschieden hat — das Administrationskonto.
 *
 * Eine Entscheidung ohne benannten Menschen weist der CHECK
 * `betroffenenanfrage_beantwortung_belegt` ab, und zu Recht: eine Auskunft, von
 * der niemand sagen kann, wer sie erteilt hat, ist im Streitfall keine.
 */
async function bearbeiterId(sql: postgres.Sql): Promise<string | null> {
  const [b] = await sql<{ id: string }[]>`
    select id from benutzer where email = 'admin@cse-gruppe.de' limit 1`;
  return b?.id ?? null;
}

export async function seedDatenschutz(
  sql: postgres.Sql,
  ids: ReadonlyMap<string, string>,
  demodaten: boolean,
): Promise<DatenschutzErgebnis> {
  if (!demodaten) return LEER;

  const bearbeiter = await bearbeiterId(sql);
  let anfragen = 0;
  let loeschentscheidungen = 0;
  let berichtigungsfelder = 0;
  let auskuenfte = 0;
  let werbewiderspruch = 0;
  let art21 = 0;

  /*
   * Zwei Gesellschaften bekommen die vollen Vorgänge: ein Posteingang mit
   * sechs Zeilen je Bereich wäre eine Demo, die nach Datenmüll aussieht. Die
   * Widersprüche entstehen dagegen in ALLEN vier, weil das Nachweisblatt je
   * Gesellschaft gelesen wird.
   */
  for (const bereich of ['reinigung', 'security'] as const) {
    const mandantId = ids.get(bereich);
    if (mandantId === undefined) continue;
    const ziele = await zieleFuer(sql, mandantId);

    for (const v of VORLAGEN) {
      const zielId = v.zuordnung === 'person' ? ziele.personId
        : v.zuordnung === 'ansprechpartner' ? ziele.ansprechpartnerId
          : v.zuordnung === 'bewerbung' ? ziele.bewerbungId : null;
      /* Ohne Zielzeile wird die Anfrage OHNE Zuordnung angelegt, nicht
         übersprungen: der Posteingang soll auch den unzugeordneten Fall
         zeigen, und eine fehlende Bewerbung ist kein Grund, die Berichtigung
         ganz zu verschweigen. */
      const zuordnung = zielId === null ? 'keine' : v.zuordnung;

      const [zeile] = await sql<{ id: string }[]>`
        insert into betroffenenanfrage
          (mandant_id, art, status, name, email, nachricht, rolle_angabe,
           eingegangen_am, verlaengert_bis, verlaengert_grund,
           person_id, ansprechpartner_id, bewerbung_id,
           beantwortet_am, beantwortet_von, entscheidung)
        values (
          ${mandantId}, ${v.art}::betroffenenanfrage_art,
          ${v.status}::betroffenenanfrage_status,
          ${v.name}, ${v.email}, ${v.nachricht}, ${v.rolle},
          now() - ${`${String(v.vorTagen)} days`}::interval,
          ${v.verlaengert === undefined ? null
            : sql`((now() - ${`${String(v.vorTagen)} days`}::interval) + interval '3 months')`},
          ${v.verlaengert ?? null},
          ${zuordnung === 'person' ? zielId : null},
          ${zuordnung === 'ansprechpartner' ? zielId : null},
          ${zuordnung === 'bewerbung' ? zielId : null},
          ${v.entscheidung === undefined ? null : sql`now() - interval '30 days'`},
          ${v.entscheidung === undefined ? null : bearbeiter},
          ${v.entscheidung ?? null})
        returning id`;
      if (zeile === undefined) continue;
      anfragen += 1;

      /* Die Löschprüfung mit zwei Zeilen: eine überlagert, eine offen. */
      if (v.art === 'loeschung' && bearbeiter !== null) {
        await sql`
          insert into loeschentscheidung
            (mandant_id, anfrage_id, tabelle, feld, zeilen, ergebnis,
             rechtsgrundlage, sperre_faellt_am, entschieden_von)
          values (${mandantId}, ${zeile.id}, 'ansprechpartner', null, 1,
                  'ueberlagert',
                  '§ 7 UWG — der Widerspruch IST der Beweis; Löschung über anonymisiert_am',
                  null, ${bearbeiter})`;
        await sql`
          insert into loeschentscheidung
            (mandant_id, anfrage_id, tabelle, feld, zeilen, ergebnis,
             offene_frage, bemerkung, entschieden_von)
          values (${mandantId}, ${zeile.id}, 'werbewiderspruch', null, 1, 'offen',
                  'O-71',
                  'Welcher Beleg-Rumpf aus GoBD-/§-7-UWG-Gründen bleibt, ist nicht entschieden.',
                  ${bearbeiter})`;
        loeschentscheidungen += 2;
      }

      /* Die Berichtigung mit zwei Feldern: eines offen, eines berichtigt und
         nach Art. 19 unterrichtet. */
      if (v.art === 'berichtigung' && bearbeiter !== null) {
        await sql`
          insert into berichtigung_feld
            (mandant_id, anfrage_id, tabelle, feld, wert_gespeichert,
             wert_behauptet, quelle, ergebnis, erfasst_von)
          values (${mandantId}, ${zeile.id}, 'bewerbung', 'name',
                  'Clara Weiss', 'Clara Weiß', 'Selbstauskunft im Formular',
                  'offen', ${bearbeiter})`;
        await sql`
          insert into berichtigung_feld
            (mandant_id, anfrage_id, tabelle, feld, wert_gespeichert,
             wert_behauptet, quelle, ergebnis, begruendung,
             berichtigt_am, berichtigt_von,
             art19_empfaenger, art19_unterrichtet_am, erfasst_von)
          values (${mandantId}, ${zeile.id}, 'bewerbung', 'telefon',
                  '+49 30 111111', '+49 30 222222', 'Telefonat vom Vortag',
                  'berichtigt', 'Die neue Nummer wurde vom Anrufer bestätigt.',
                  now() - interval '2 days', ${bearbeiter},
                  'Interne Personalakte — keine externen Empfänger',
                  now() - interval '2 days', ${bearbeiter})`;
        berichtigungsfelder += 2;
      }

      /* Das Auskunftsartefakt zum beantworteten Vorgang — mit Prüfsumme. */
      if (v.entscheidung !== undefined && bearbeiter !== null) {
        const umfang = {
          betroffener: zuordnung,
          fehlendeRechte: [] as string[],
          abschnitte: [{ schluessel: 'stammdaten', zeilen: 1, gesperrt: false, offen: null }],
        };
        const sha = createHash('sha256')
          .update(`${zeile.id}:${JSON.stringify(umfang)}`, 'utf8').digest('hex');
        await sql`
          insert into datenschutz_auskunft
            (mandant_id, anfrage_id, format, umfang, abschnitte, zeilen,
             vollstaendig, sha256, erzeugt_am, erzeugt_von)
          values (${mandantId}, ${zeile.id}, 'md', ${sql.json(umfang)}::jsonb,
                  13, 47, true, ${sha}, now() - interval '30 days', ${bearbeiter})`;
        auskuenfte += 1;
      }
    }
  }

  /*
   * Die Widersprüche — auf dem echten Weg, in jeder Gesellschaft, die einen
   * Kontakt hat.
   */
  for (const bereich of ['reinigung', 'security', 'bau', 'operations'] as const) {
    const mandantId = ids.get(bereich);
    if (mandantId === undefined) continue;
    const ziele = await zieleFuer(sql, mandantId);
    if (ziele.ansprechpartnerId === null) continue;

    /*
     * Token ausgeben und einlösen — mit gebundener Sitzung, weil
     * `app.werbewiderspruch_einloesen` `app.aktiver_mandant()` liest. Der
     * Klartext wird hier weggeworfen: was bleibt, ist der Abdruck (K-08).
     */
    const klartext = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(klartext, 'utf8').digest('hex');
    await sql`
      insert into werbewiderspruch_token
        (mandant_id, ansprechpartner_id, kunde_id, kanal, token_hash,
         ausgegeben_am)
      values (${mandantId}, ${ziele.ansprechpartnerId}, ${ziele.kundeId},
              'email', ${hash}, now() - interval '6 days')`;

    await sql.begin(async (tx) => {
      await tx`select set_config('app.scope', 'mandant', true)`;
      await tx`select set_config('app.mandant_id', ${mandantId}, true)`;
      await tx`select set_config('app.portal', 'intern', true)`;
      await tx`select set_config('app.readonly', 'off', true)`;
      await tx`select set_config('app.akteur_typ', 'system', true)`;
      await tx`select zustand from app.werbewiderspruch_einloesen(${hash})`;
    });
    werbewiderspruch += 1;

    /*
     * Und in EINER Gesellschaft der stärkere Fall: Art. 21. Er zwingt
     * `rechtsgrundlage = 'keine'` und ist unwiderruflich — deshalb genau
     * einmal, damit die zweite Liste des Nachweisblatts eine Zeile hat und
     * die CRM-Vorführung ihre Kontakte behält.
     */
    if (bereich === 'operations' && bearbeiter !== null) {
      await sql`
        update ansprechpartner
           set widerspruch_am = now() - interval '3 days'
         where mandant_id = ${mandantId} and id = ${ziele.ansprechpartnerId}`;
      await sql`
        insert into werbewiderspruch
          (mandant_id, art, ansprechpartner_id, quelle, bemerkung,
           eingegangen_am, erfasst_von)
        values (${mandantId}, 'verarbeitung', ${ziele.ansprechpartnerId},
                'manuell',
                'Am Telefon erklärt und im Vorgang festgehalten; die Grundlage fällt damit auf „keine".',
                now() - interval '3 days', ${bearbeiter})`;
      art21 += 1;
    }
  }

  return {
    anfragen, loeschentscheidungen, berichtigungsfelder, auskuenfte,
    werbewiderspruch, art21, uebersprungen: false,
  };
}
