import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  ZugangFehler, aendereZugangsnummer, entsperreZugang, nummerOderFehler,
  richteZugangEin, sperreZugang,
} from '../../src/server/services/personal/zugang.js';
import { leseZugangsstand } from '../../src/server/services/personal/zugangscode.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';

/**
 * **Der Telefonzugang — einrichten, umschreiben, sperren, entsperren**
 * (V-014, EMP-01, EMP-14, AUT-08, D-09).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `0113` legt `mitarbeiter_zugang` an, `0114` meldet damit an, `0130` bremst
 * das Raten, `0143` stellt den Code durch die Einsatzleitung aus, `0144`
 * zeigt den Stand. Fünf Migrationen um eine Zeile herum — **und diese Zeile
 * entstand nirgends ausser im Seed.** Wer nach dem Seed eingestellt wurde,
 * hatte keine Anmeldenummer und keinen Weg zu einer.
 *
 * Dazu zwei Befunde in der Migration selbst, die dieser Lauf mitnimmt:
 *
 *  §4 `0113` begründet das fehlende Spaltenrecht auf `erstellt_von` mit
 *     „die schreibt der Audit-Trigger" — **den es nicht gab**. Die Tabelle
 *     trug keinen einzigen Ausloeser; AUT-08 war auf dem Schreibweg
 *     unerfüllt, auf dem es am meisten zählt.
 *  §5 `t_zugang_anlegen` prüfte NICHT, ob dieser Mensch in dieser
 *     Gesellschaft beschäftigt ist — anders als `t_zugang_lesen` und die
 *     beiden Definer-Funktionen daneben.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Gegen die ROLLE, nicht gegen den Dienst.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §4 und §5 laufen als `cse_app` mit rohem SQL. Ein Dienst, der die Regel
 * einhält, beweist nichts über die Regel — er beweist etwas über sich selbst.
 */

let f: Fixtur;
let personal = '';
let fremder = '';
/** Ein Mensch mit Anstellung in der Reinigung und ohne Zugang. */
let ohneZugang = '';
/** Ein Mensch, den die Reinigung NICHT beschäftigt. */
let fremdePerson = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(email: string, mandant: string, rolle: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, $2, 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

async function mensch(name: string, mandant: string | null): Promise<string> {
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into person (vorname, nachname) values ($1, $2) returning id`,
    ['Probe', name]);
  if (mandant !== null) {
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
       values ($1, $2, $3, current_date - 30)`,
      [mandant, p!.id, `P-${zufall()}`]);
  }
  return p!.id;
}

beforeAll(async () => {
  f = await seed();
  personal = await konto('zug-personal@test.invalid', f.reinigung, 'leitung');
  fremder = await konto('zug-fremd@test.invalid', f.reinigung, 'mitarbeiter');
  for (const r of ['personal.zugang_verwalten', 'personal.lesen']) {
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
               (select id from berechtigung where schluessel = $1), $2, true)
       on conflict (rolle_id, berechtigung_id, mandant_id)
         do update set gewaehrt = true`,
      [r, f.reinigung]);
  }
  ohneZugang = await mensch(`Ohne-${zufall()}`, f.reinigung);
  fremdePerson = await mensch(`Fremd-${zufall()}`, f.security);
});
afterAll(schliessen);

/**
 * Ein Kontext, der auf DERSELBEN Transaktion arbeitet wie `alsApp`.
 *
 * Die Dienste nehmen `LeseKontext`/`SchreibKontext`, die Harness gibt eine
 * `postgres.TransactionSql`. Ohne diese Brücke müsste der Test die Abfragen
 * der Dienste abschreiben — und prüfte dann eine Kopie statt der Abfrage.
 */
function imKontext<T>(
  fn: (k: LeseKontext & SchreibKontext) => Promise<T>, benutzer = personal,
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
      portal: 'intern' as const, readonly: false,
    },
    async (tx: postgres.TransactionSql) => {
      const fuehre = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: benutzer,
        aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
        abfrage: fuehre, schreibe: fuehre,
      } satisfies LeseKontext & SchreibKontext);
    },
  ) as Promise<T>;
}

async function zeile(personId: string): Promise<{
  telefon: string | null; gesperrt: string | null; grund: string | null;
  erstellt_von: string | null; geaendert_von: string | null; geaendert_am: string | null;
} | undefined> {
  const [z] = await sql.unsafe<{
    telefon: string | null; gesperrt: string | null; grund: string | null;
    erstellt_von: string | null; geaendert_von: string | null; geaendert_am: string | null;
  }[]>(
    `select telefon_e164 as telefon, gesperrt_am::text as gesperrt,
            gesperrt_grund as grund, erstellt_von::text as erstellt_von,
            geaendert_von::text as geaendert_von, geaendert_am::text as geaendert_am
       from mitarbeiter_zugang where person_id = $1`, [personId]);
  return z;
}

/** Eine Nummer, die in diesem Lauf noch niemandem gehört. */
let laufendeNummer = 1_000_000;
const neueNummer = (): string => `0170 ${String((laufendeNummer += 1)).slice(-7)}`;

describe('§1 einrichten — die Zeile, die es bis V-014 nur im Seed gab', () => {
  it('legt den Zugang an und normalisiert die Nummer auf E.164', async () => {
    const person = await mensch(`Neu-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, '0170 4455667'));
    const z = await zeile(person);
    expect(z?.telefon).toBe('+491704455667');
  });

  /**
   * **Die drei Schreibweisen sind EINE Nummer.** Ohne Normalisierung legte
   * jede von ihnen einen eigenen Zugang an, und `unique (telefon_e164)`
   * hielte nichts mehr zusammen — zwei Zugänge, ein Telefon, und die Frage
   * „welcher gilt?" hat keine Antwort, die jemanden interessieren sollte.
   */
  it('`0170 …`, `+49 170 …` und `0049170…` sind dieselbe Nummer', () => {
    expect(nummerOderFehler('0170 1234567')).toBe('+491701234567');
    expect(nummerOderFehler('+49 170 1234567')).toBe('+491701234567');
    expect(nummerOderFehler('0049-170-1234567')).toBe('+491701234567');
    expect(nummerOderFehler('(0170) 123 45 67')).toBe('+491701234567');
  });

  it('was weder national noch international geschrieben ist, wird nicht geraten', async () => {
    expect(() => nummerOderFehler('170 1234567')).toThrow(ZugangFehler);
    expect(() => nummerOderFehler('keine nummer')).toThrow(ZugangFehler);
    await expect(imKontext((k) => richteZugangEin(k, ohneZugang, '170 1234567')))
      .rejects.toMatchObject({ grund: 'keine_nummer' });
  });

  it('ein Mensch, ein Login — der zweite Zugang wird abgewiesen (EMP-14)', async () => {
    const person = await mensch(`Doppelt-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, neueNummer()));
    await expect(imKontext((k) => richteZugangEin(k, person, neueNummer())))
      .rejects.toMatchObject({ grund: 'schon_vorhanden', status: 409 });
  });

  it('eine Nummer, ein Mensch — die vergebene Nummer wird abgewiesen', async () => {
    const nummer = neueNummer();
    const a = await mensch(`Nummer-A-${zufall()}`, f.reinigung);
    const b = await mensch(`Nummer-B-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, a, nummer));
    await expect(imKontext((k) => richteZugangEin(k, b, nummer)))
      .rejects.toMatchObject({ grund: 'nummer_vergeben', status: 409 });
  });

  it('`erstellt_von` kommt aus der Sitzung, nicht aus dem Formular', async () => {
    const person = await mensch(`Wer-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, neueNummer()));
    expect((await zeile(person))?.erstellt_von).toBe(personal);
  });

  it('für einen Menschen, den diese Gesellschaft nicht beschäftigt, gibt es keinen Zugang',
    async () => {
      await expect(imKontext((k) => richteZugangEin(k, fremdePerson, neueNummer())))
        .rejects.toMatchObject({ grund: 'keine_anstellung', status: 403 });
    });
});

describe('§2 die Nummer umschreiben — der teuerste Knopf der Seite', () => {
  it('schreibt um und setzt `geaendert_von` und `geaendert_am`', async () => {
    const person = await mensch(`Wechsel-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, '0170 1112223'));
    expect((await zeile(person))?.geaendert_am).toBeNull();

    await imKontext((k) => aendereZugangsnummer(k, person, '0171 3332221'));
    const z = await zeile(person);
    expect(z?.telefon).toBe('+491713332221');
    expect(z?.geaendert_von).toBe(personal);
    /* Den Zeitpunkt setzt `trg_mitarbeiter_zugang_geaendert_am` (0384) — bis
       dahin trug die Tabelle keinen einzigen Ausloeser. */
    expect(z?.geaendert_am).not.toBeNull();
  });

  it('dieselbe Nummer noch einmal ist keine Änderung', async () => {
    const person = await mensch(`Gleich-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, '0170 9998887'));
    await expect(imKontext((k) => aendereZugangsnummer(k, person, '+49 170 9998887')))
      .rejects.toMatchObject({ grund: 'unveraendert', status: 409 });
  });

  it('auf eine fremde Nummer lässt sich nicht umschreiben', async () => {
    const nummer = neueNummer();
    const a = await mensch(`Fremd-A-${zufall()}`, f.reinigung);
    const b = await mensch(`Fremd-B-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, a, nummer));
    await imKontext((k) => richteZugangEin(k, b, neueNummer()));
    await expect(imKontext((k) => aendereZugangsnummer(k, b, nummer)))
      .rejects.toMatchObject({ grund: 'nummer_vergeben', status: 409 });
  });

  it('ohne Zugang gibt es nichts umzuschreiben', async () => {
    const person = await mensch(`Leer-${zufall()}`, f.reinigung);
    await expect(imKontext((k) => aendereZugangsnummer(k, person, neueNummer())))
      .rejects.toMatchObject({ grund: 'kein_zugang', status: 404 });
  });
});

describe('§3 sperren und entsperren — beendet wird mit einem Zustand, nie mit DELETE', () => {
  it('sperrt mit Grund, und der Stand nennt beides', async () => {
    const person = await mensch(`Sperre-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, neueNummer()));
    await imKontext((k) => sperreZugang(k, person, 'Diensttelefon verloren'));

    const z = await zeile(person);
    expect(z?.gesperrt).not.toBeNull();
    expect(z?.grund).toBe('Diensttelefon verloren');

    const stand = await imKontext((k) => leseZugangsstand(k, person));
    expect(stand.gesperrt).toBe(true);
    expect(stand.sperrgrund).toBe('Diensttelefon verloren');
    expect(stand.gesperrtAm).not.toBeNull();
  });

  it('eine Sperre ohne Grund ist keine Auskunft', async () => {
    const person = await mensch(`Grundlos-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, neueNummer()));
    await expect(imKontext((k) => sperreZugang(k, person, '  ')))
      .rejects.toMatchObject({ grund: 'grund_fehlt' });
    expect((await zeile(person))?.gesperrt).toBeNull();
  });

  it('zweimal sperren ist kein zweiter Vorgang', async () => {
    const person = await mensch(`Zweimal-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, neueNummer()));
    await imKontext((k) => sperreZugang(k, person, 'Austritt'));
    await expect(imKontext((k) => sperreZugang(k, person, 'Austritt')))
      .rejects.toMatchObject({ grund: 'schon_gesperrt', status: 409 });
  });

  it('entsperrt und leert beide Spalten — `zugang_sperre_stimmig` verlangt es', async () => {
    const person = await mensch(`Zurueck-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, neueNummer()));
    await imKontext((k) => sperreZugang(k, person, 'Verdacht'));
    await imKontext((k) => entsperreZugang(k, person));
    const z = await zeile(person);
    expect(z?.gesperrt).toBeNull();
    expect(z?.grund).toBeNull();
  });

  it('was nicht gesperrt ist, lässt sich nicht entsperren', async () => {
    const person = await mensch(`Offen-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, neueNummer()));
    await expect(imKontext((k) => entsperreZugang(k, person)))
      .rejects.toMatchObject({ grund: 'nicht_gesperrt', status: 409 });
  });

  /**
   * **Die Sperre wirkt sofort und auch auf schon ausgestellte Codes.**
   * `app.zugang_code_ausstellen` (0143) weist mit `gesperrt` ab, und
   * `app.zugang_code_einloesen` (0114) findet den Zugang gar nicht mehr. Das
   * ist der Grund, warum das Sperren kein zweites Augenpaar braucht: es ist
   * der Notknopf, und er muss sofort greifen.
   */
  it('ein gesperrter Zugang bekommt keinen Code mehr — und löst keinen ein', async () => {
    const person = await mensch(`Notaus-${zufall()}`, f.reinigung);
    const nummer = neueNummer();
    await imKontext((k) => richteZugangEin(k, person, nummer));

    const hash = 'a'.repeat(64);
    const vorher = await imKontext((k) => k.abfrage<{ ok: boolean; grund: string }>(
      `select ok, grund from app.zugang_code_ausstellen($1::uuid, $2, now() + interval '10 minutes')`,
      [person, hash]));
    expect(vorher[0]?.ok).toBe(true);

    await imKontext((k) => sperreZugang(k, person, 'Telefon weg'));

    const nachher = await imKontext((k) => k.abfrage<{ ok: boolean; grund: string }>(
      `select ok, grund from app.zugang_code_ausstellen($1::uuid, $2, now() + interval '10 minutes')`,
      [person, hash]));
    expect(nachher[0]?.ok).toBe(false);
    expect(nachher[0]?.grund).toBe('gesperrt');

    /* Und der vorher ausgestellte Code läuft ins Leere — die Einlösung sucht
       den Zugang nur, solange er nicht gesperrt ist. */
    const [eingeloest] = await sql.unsafe<{ person_id: string | null }[]>(
      `select app.zugang_code_einloesen($1, $2) as person_id`,
      [normalisiert(nummer), hash]);
    expect(eingeloest?.person_id).toBeNull();
  });
});

function normalisiert(roh: string): string {
  return nummerOderFehler(roh);
}

describe('§4 die Rolle, nicht der Dienst — Spaltenrechte und Ausloeser', () => {
  /**
   * `person_id` steht in keinem Spaltenrecht (0113): ein Zugang, der den
   * Menschen wechselt, ist kein geänderter Zugang, sondern ein fremder.
   */
  it('`cse_app` darf `person_id` nicht umhängen', async () => {
    const person = await mensch(`Umhaengen-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, neueNummer()));
    await expect(imKontext((k) => k.abfrage(
      `update mitarbeiter_zugang set person_id = $2 where person_id = $1`,
      [person, ohneZugang]))).rejects.toThrow(/permission denied|Berechtigung/iu);
  });

  /**
   * §5 des Befunds: `t_zugang_anlegen` prüfte die Beschäftigung nicht. Der
   * Dienst prüft sie jetzt — und die POLICY auch, was diese Zeile beweist:
   * hier gibt es keinen Dienst, nur rohes SQL.
   */
  it('die Policy weist einen Zugang für einen Fremden ab, auch ohne Dienst', async () => {
    await expect(imKontext((k) => k.abfrage(
      `insert into mitarbeiter_zugang (person_id, telefon_e164)
       values ($1::uuid, $2)`, [fremdePerson, '+491999888777'])))
      .rejects.toThrow(/row-level security|row level security/iu);
  });

  it('gelöscht wird nichts — die Sperre aus 0384 hält, auch für den Eigentümer', async () => {
    const person = await mensch(`Unloeschbar-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, neueNummer()));
    await expect(sql.unsafe(
      `delete from mitarbeiter_zugang where person_id = $1`, [person]))
      .rejects.toThrow(/Invariante 8|gesperrt/iu);
  });

  it('in der Gruppenansicht entsteht und ändert sich kein Zugang (Invariante 10)', async () => {
    const person = await mensch(`Gruppe-${zufall()}`, f.reinigung);
    await expect(alsApp(
      {
        scope: 'gruppe' as const, mandantIds: [f.reinigung, f.security],
        benutzerId: personal, readonly: true,
      },
      async (tx: postgres.TransactionSql) => tx.unsafe(
        `insert into mitarbeiter_zugang (person_id, telefon_e164) values ($1::uuid, $2)`,
        [person, '+491999111222']),
    )).rejects.toThrow();
  });

  /**
   * **AUT-08 — und der Grund, warum `0384` überhaupt entstanden ist.** Bis
   * dahin trug `mitarbeiter_zugang` keinen einzigen Ausloeser: wer die Nummer
   * eines Zugangs umschrieb, empfing ab dem nächsten Code dessen Anmeldungen,
   * und es stand nirgends. Der Eintrag trägt Vorher UND Nachher — ohne die
   * alte Nummer beantwortete er die eine Frage nicht, für die es ihn gibt.
   */
  it('jede Änderung steht im Protokoll, mit alter und neuer Nummer', async () => {
    const person = await mensch(`Protokoll-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, '0170 2223334'));
    await imKontext((k) => aendereZugangsnummer(k, person, '0171 4443332'));

    const zeilen = await sql.unsafe<{
      aktion: string; vorher: { telefon_e164?: string } | null;
      nachher: { telefon_e164?: string } | null;
    }[]>(
      `select aktion, vorher, nachher from audit_log
        where objekt_typ = 'mitarbeiter_zugang'
          and objekt_id = (select id::text from mitarbeiter_zugang where person_id = $1)
        order by id`, [person]);

    expect(zeilen.map((z) => z.aktion))
      .toEqual(['mitarbeiter_zugang.insert', 'mitarbeiter_zugang.update']);
    expect(zeilen[0]?.nachher?.telefon_e164).toBe('+491702223334');
    expect(zeilen[1]?.vorher?.telefon_e164).toBe('+491702223334');
    expect(zeilen[1]?.nachher?.telefon_e164).toBe('+491714443332');
  });

  it('auch die Sperre und ihr Grund stehen im Protokoll', async () => {
    const person = await mensch(`Sperrspur-${zufall()}`, f.reinigung);
    await imKontext((k) => richteZugangEin(k, person, neueNummer()));
    await imKontext((k) => sperreZugang(k, person, 'Ausweis eingezogen'));
    await imKontext((k) => entsperreZugang(k, person));

    const zeilen = await sql.unsafe<{ nachher: { gesperrt_grund?: string | null } | null }[]>(
      `select nachher from audit_log
        where objekt_typ = 'mitarbeiter_zugang' and aktion = 'mitarbeiter_zugang.update'
          and objekt_id = (select id::text from mitarbeiter_zugang where person_id = $1)
        order by id`, [person]);
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]?.nachher?.gesperrt_grund).toBe('Ausweis eingezogen');
    /* Der Grund ist nach dem Entsperren leer — und genau deshalb steht er im
       Protokoll und nicht nur in der Spalte. */
    expect(zeilen[1]?.nachher?.gesperrt_grund).toBeNull();
  });
});

describe('§5 ohne das Recht geht nichts', () => {
  it('wer `personal.zugang_verwalten` nicht hält, liest den Stand nicht', async () => {
    await expect(imKontext((k) => leseZugangsstand(k, ohneZugang), fremder))
      .rejects.toThrow(/personal.zugang_verwalten/u);
  });
});
