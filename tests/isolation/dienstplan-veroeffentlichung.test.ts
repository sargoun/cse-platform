/**
 * Die Bekanntgabe des Dienstplans gegen echte Rechte, echte Policies und
 * echte Ausloeser (TIM-01, NOT-01, K-01, K-08, Invariante 3, Invariante 8,
 * Invariante 10).
 *
 * **Die Saetze, die diese Datei beweist:**
 *
 *  1. `cse_app` kann `benachrichtigung` NICHT beschreiben — und zwar LAUT:
 *     `permission denied for table benachrichtigung`, nicht still mit null
 *     Zeilen. Das ist der Grund, warum es `app.dienstplan_veroeffentlichung_
 *     anlegen` ueberhaupt gibt: der geplante Weg „die Route schreibt je Person
 *     eine Zeile" wäre ein 500er gewesen.
 *  2. Der Definer legt den Vorgang an, stellt je Person mit Zugang genau eine
 *     Meldung zu und ZAEHLT, wen er nicht erreicht hat (D-09). Eine
 *     Bekanntgabe, die die halbe Kolonne nicht erreicht, ist keine.
 *  3. Er stellt AUSSCHLIESSLICH `dienstplan.plan_veroeffentlicht` zu. Jeder
 *     andere Artschluessel wird abgewiesen — sonst waere das Argument `p_art`
 *     die Hintertuer, die der fehlende Grant verhindern soll.
 *  4. Ohne `dienstplan.veroeffentlichen`, in der Nur-Lese-Ansicht und
 *     ausserhalb des internen Portals antwortet er gleich: `nicht berechtigt`
 *     (42501). Fehlendes Recht und fremde Zeile sehen von aussen gleich aus
 *     (AUT-06).
 *  5. Die Zeile ist in der anderen Gesellschaft nicht sichtbar (Invariante 3),
 *     lesbar mit `dienstplan.lesen` (nicht erst mit dem Veroeffentlichungs-
 *     recht), nicht aenderbar und nicht loeschbar (Invariante 8).
 *  6. Die Zeit kommt aus der SERVERUHR (Invariante 5), und der Vorgang steht
 *     im Pruefprotokoll.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur, type Sitzung }
  from './harness.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

const VON = '2028-05-15';
const BIS = '2028-05-21';
const ART = 'dienstplan.plan_veroeffentlicht';

/** Ein Konto mit einer Rolle in genau einer Gesellschaft. */
async function konto(mandant: string, rolle = 'admin', personId: string | null = null):
Promise<string> {
  const email = `dv-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,(select id from rolle where schluessel = $3 and mandant_id is null),true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

function sitzung(mandant: string, benutzerId: string, mehr: Partial<Sitzung> = {}): Sitzung {
  return {
    scope: 'mandant', mandantId: mandant, mandantIds: [mandant],
    benutzerId, readonly: false, portal: 'intern', ...mehr,
  };
}

/** Entzieht einer Rolle ein Recht in genau einer Gesellschaft. */
async function entziehe(rolle: string, recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select r.id, b.id, $3, false
       from rolle r, berechtigung b
      where r.schluessel = $1 and r.mandant_id is null and b.schluessel = $2`,
    [rolle, recht, mandant]);
}

/** Der Aufruf des Definers — so, wie der Dienst ihn macht. */
const RUF = `select id, empfaenger_anzahl, ohne_zugang_anzahl
               from app.dienstplan_veroeffentlichung_anlegen(
                 $1::date, $2::date, $3, $4::integer, $5::integer, $6::integer, $7::integer,
                 $8::jsonb, $9, $10, $11::jsonb)`;

/**
 * Ein `type` und kein `interface`: nur ein Typalias bekommt in TypeScript die
 * implizite Indexsignatur, die `postgres.ParameterOrJSON` (JSONValue)
 * verlangt. Als `interface` scheitert schon die Uebergabe an `tx.unsafe`.
 */
type Meldung = {
  readonly person_id: string;
  readonly titel: string;
  readonly text: string;
  readonly ziel: string;
};

/**
 * Die Empfaenger als OBJEKT, nicht als JSON-Text (D-467).
 *
 * Bis 0315 stand hier `JSON.stringify(...)` und daneben in den uebrigen
 * Aufrufen `'[]'` und `'{}'`. Das war NICHT der Aufruf, den der Dienst macht:
 * `postgres.js` serialisiert eine JS-Zeichenkette in einem `::jsonb`-Parameter
 * als JSON-ZEICHENKETTE — aus `'[]'` wird der Skalar `"[]"`, `jsonb_typeof`
 * sagt dazu `string`, und `jsonb_array_elements` brach mit `cannot extract
 * elements from a scalar` ab. Vierzehn Faelle dieser Datei sind daran
 * gescheitert, drei davon, ohne ihren eigenen Riegel je zu erreichen.
 *
 * `src/server/services/dienstplan/veroeffentlichung.ts` uebergibt das Objekt
 * und war die ganze Zeit richtig. Diese Datei behauptet in `RUF`, den Aufruf
 * des Dienstes nachzubilden — also bildet sie ihn nach.
 */
function empfaenger(...personen: readonly string[]): readonly Meldung[] {
  return personen.map((p) => ({
    person_id: p,
    titel: 'Dienstplan veröffentlicht: 15.05.2028 bis 21.05.2028',
    text: 'Für Sie sind 1 Schicht eingeteilt.',
    ziel: '/portal/mein/schichten',
  }));
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('(1) cse_app hat auf benachrichtigung kein INSERT — und zwar LAUT', () => {
  it('ein direktes insert bricht mit permission denied ab, nicht still', async () => {
    const b = await konto(f.reinigung);
    await expect(alsApp(sitzung(f.reinigung, b), async (tx) => tx.unsafe(
      `insert into benachrichtigung
         (mandant_id, empfaenger_id, art, titel, text, ziel, objekt_typ, sammelbar)
       values ($1,$2,$3,'t','t','/portal/mein/schichten','x',false)`,
      [f.reinigung, b, ART],
    ))).rejects.toThrow(/permission denied for table benachrichtigung/u);
  });

  it('das Tabellenrecht fehlt, nicht bloss die Policy', async () => {
    const [z] = await sql.unsafe<{ ok: boolean }[]>(
      `select has_table_privilege('cse_app','benachrichtigung','insert') as ok`);
    expect(z?.ok).toBe(false);
  });
});

describe('(2) der Definer legt den Vorgang an und stellt genau einmal zu', () => {
  it('eine Person MIT Zugang bekommt eine Meldung, eine OHNE wird gezaehlt', async () => {
    const planer = await konto(f.reinigung);
    // Fatima bekommt ein Konto, Jonas nicht — der D-09-Fall.
    await konto(f.reinigung, 'mitarbeiter', f.fatima);

    const [r] = await alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 2, 1, 0, 0, { abgrenzung: 'test' },
        'Probelauf', ART, empfaenger(f.fatima, f.jonas)]) as Promise<
        { id: string; empfaenger_anzahl: number; ohne_zugang_anzahl: number }[]>);

    expect(Number(r?.empfaenger_anzahl)).toBe(1);
    expect(Number(r?.ohne_zugang_anzahl)).toBe(1);

    const zeilen = await sql.unsafe<{ art: string; ziel: string; sammelbar: boolean }[]>(
      `select art, ziel, sammelbar from benachrichtigung where objekt_id = $1`, [r!.id]);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.art).toBe(ART);
    expect(zeilen[0]?.ziel).toBe('/portal/mein/schichten');
    // Nicht sammelbar: am Einsatztag gelesen ist zu spaet gelesen.
    expect(zeilen[0]?.sammelbar).toBe(false);
  });

  it('die Zahlen des Fensters stehen in der Zeile — der Beleg im Streitfall', async () => {
    const planer = await konto(f.reinigung);
    const [r] = await alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 7, 3, 2, 1, {}, null, ART, []],
      ) as Promise<{ id: string }[]>);
    const [z] = await sql.unsafe<{
      schichten_anzahl: number; unbesetzt_anzahl: number;
      konflikte_offen: number; konflikte_blockierend: number; umfang: string;
    }[]>(
      `select schichten_anzahl, unbesetzt_anzahl, konflikte_offen,
              konflikte_blockierend, umfang
         from dienstplan_veroeffentlichung where id = $1`, [r!.id]);
    expect(Number(z?.schichten_anzahl)).toBe(7);
    expect(Number(z?.unbesetzt_anzahl)).toBe(3);
    expect(Number(z?.konflikte_offen)).toBe(2);
    expect(Number(z?.konflikte_blockierend)).toBe(1);
    expect(z?.umfang).toBe('woche');
  });

  it('der Zeitpunkt kommt aus der Serveruhr und der Urheber aus der Sitzung', async () => {
    const planer = await konto(f.reinigung);
    const [r] = await alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 0, 0, 0, 0, {}, null, ART, []],
      ) as Promise<{ id: string }[]>);
    const [z] = await sql.unsafe<{ frisch: boolean; von_wem: string }[]>(
      `select (veroeffentlicht_am > now() - interval '1 minute') as frisch,
              veroeffentlicht_von as von_wem
         from dienstplan_veroeffentlichung where id = $1`, [r!.id]);
    expect(z?.frisch).toBe(true);
    expect(z?.von_wem).toBe(planer);
  });

  it('der Vorgang steht im Pruefprotokoll', async () => {
    const planer = await konto(f.reinigung);
    const [r] = await alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 4, 0, 0, 0, {}, null, ART, []],
      ) as Promise<{ id: string }[]>);
    const [z] = await sql.unsafe<{ anzahl: number; schichten: string | null }[]>(
      `select count(*)::int as anzahl, max(nachher->>'schichten') as schichten
         from audit_log
        where aktion = 'dienstplan.veroeffentlicht' and objekt_id = $1`, [r!.id]);
    expect(Number(z?.anzahl)).toBe(1);
    // Das OBJEKT, nicht sein JSON-Text (D-467): ohne das greift jeder
    // spaetere `->>`-Zugriff ins Leere.
    expect(z?.schichten).toBe('4');
  });
});

describe('(3) genau eine Art, und keine andere', () => {
  it('ein fremder Artschluessel wird abgewiesen', async () => {
    const planer = await konto(f.reinigung);
    await expect(alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 0, 0, 0, 0, {}, null,
        'dienstplan.morgen_unbesetzt', []]),
    )).rejects.toThrow(/ausschliesslich dienstplan\.plan_veroeffentlicht/u);
  });

  it('eine Meldung ohne Ziel scheitert bei der Erzeugung (NOT-03)', async () => {
    const planer = await konto(f.reinigung);
    await konto(f.reinigung, 'mitarbeiter', f.fatima);
    await expect(alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 0, 0, 0, 0, {}, null, ART,
        [{ person_id: f.fatima, titel: 'T', text: 'X', ziel: '' }]]),
    )).rejects.toThrow(/NOT-03/u);
  });
});

describe('(4) Recht, Nur-Lesen und Portal antworten gleich (AUT-06)', () => {
  it('ohne dienstplan.veroeffentlichen: nicht berechtigt', async () => {
    const planer = await konto(f.reinigung);
    await entziehe('admin', 'dienstplan.veroeffentlichen', f.reinigung);
    await expect(alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 0, 0, 0, 0, {}, null, ART, []]),
    )).rejects.toThrow(/nicht berechtigt/u);
  });

  it('in der Nur-Lese-Ansicht: nicht berechtigt (Invariante 10)', async () => {
    const planer = await konto(f.reinigung);
    await expect(alsApp(sitzung(f.reinigung, planer, { readonly: true }), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 0, 0, 0, 0, {}, null, ART, []]),
    )).rejects.toThrow(/nicht berechtigt/u);
  });

  it('aus dem Mitarbeiterportal: nicht berechtigt (K-04)', async () => {
    const planer = await konto(f.reinigung);
    await expect(alsApp(sitzung(f.reinigung, planer, { portal: 'mitarbeiter' }), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 0, 0, 0, 0, {}, null, ART, []]),
    )).rejects.toThrow(/nicht berechtigt/u);
  });

  it('ein verkehrter Zeitraum wird abgewiesen, statt alles zu bedeuten', async () => {
    const planer = await konto(f.reinigung);
    await expect(alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [BIS, VON, 'woche', 0, 0, 0, 0, {}, null, ART, []]),
    )).rejects.toThrow(/verkehrt|leer/u);
  });
});

describe('(5) die Zeile gehoert genau einer Gesellschaft', () => {
  it('sie ist im Bau nicht sichtbar — auch nicht fuer eine Leitung (Invariante 3)', async () => {
    const planer = await konto(f.reinigung);
    await alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 1, 0, 0, 0, {}, null, ART, []]));

    const imBau = await konto(f.bau);
    const zeilen = await alsApp(sitzung(f.bau, imBau), async (tx) =>
      tx.unsafe(`select id from dienstplan_veroeffentlichung`));
    expect(zeilen).toHaveLength(0);
  });

  it('gelesen wird mit dienstplan.lesen, nicht erst mit dem Veroeffentlichungsrecht', async () => {
    const planer = await konto(f.reinigung);
    await alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 1, 0, 0, 0, {}, null, ART, []]));

    const leser = await konto(f.reinigung, 'leitung');
    await entziehe('leitung', 'dienstplan.veroeffentlichen', f.reinigung);
    const zeilen = await alsApp(sitzung(f.reinigung, leser), async (tx) =>
      tx.unsafe(`select id from dienstplan_veroeffentlichung`));
    expect(zeilen).toHaveLength(1);
  });

  it('ohne dienstplan.lesen ist die Liste LEER, nicht fehlerhaft', async () => {
    const planer = await konto(f.reinigung);
    await alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 1, 0, 0, 0, {}, null, ART, []]));

    const blind = await konto(f.reinigung, 'leitung');
    await entziehe('leitung', 'dienstplan.lesen', f.reinigung);
    const zeilen = await alsApp(sitzung(f.reinigung, blind), async (tx) =>
      tx.unsafe(`select id from dienstplan_veroeffentlichung`));
    expect(zeilen).toHaveLength(0);
  });

  it('ein Kundenzugang sieht nichts (K-04)', async () => {
    const planer = await konto(f.reinigung);
    await alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 1, 0, 0, 0, {}, null, ART, []]));

    const kunde = await konto(f.reinigung, 'kunde');
    const zeilen = await alsApp(
      sitzung(f.reinigung, kunde, { portal: 'kunde' }),
      async (tx) => tx.unsafe(`select id from dienstplan_veroeffentlichung`));
    expect(zeilen).toHaveLength(0);
  });
});

describe('(6) eine Bekanntgabe bleibt stehen', () => {
  it('cse_app hat kein UPDATE — eine Aussage laesst sich nicht umschreiben', async () => {
    const planer = await konto(f.reinigung);
    await alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 1, 0, 0, 0, {}, 'Erst so', ART, []]));
    await expect(alsApp(sitzung(f.reinigung, planer), async (tx) => tx.unsafe(
      `update dienstplan_veroeffentlichung set notiz = 'umgeschrieben'`,
    ))).rejects.toThrow(/permission denied for table dienstplan_veroeffentlichung/u);
  });

  it('geloescht wird nicht — auch nicht vom Eigentuemer (Invariante 8)', async () => {
    const planer = await konto(f.reinigung);
    await alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 1, 0, 0, 0, {}, null, ART, []]));
    await expect(alsRolle('', async (tx) =>
      tx.unsafe(`delete from dienstplan_veroeffentlichung`),
    )).rejects.toThrow(/gesperrt/u);
  });

  it('und TRUNCATE ebenso — es feuert keinen Zeilen-Ausloeser', async () => {
    await expect(alsRolle('', async (tx) =>
      tx.unsafe(`truncate dienstplan_veroeffentlichung`),
    )).rejects.toThrow(/gesperrt/u);
  });

  it('derselbe Zeitraum darf ein zweites Mal bekanntgegeben werden (O-712)', async () => {
    const planer = await konto(f.reinigung);
    for (let i = 0; i < 2; i += 1) {
      await alsApp(sitzung(f.reinigung, planer), async (tx) =>
        tx.unsafe(RUF, [VON, BIS, 'woche', 1, 0, 0, 0, {}, null, ART, []]));
    }
    const zeilen = await alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(`select id from dienstplan_veroeffentlichung`));
    // Zwei Zeilen und nicht eine: eine Aenderung ist eine zweite Bekanntgabe.
    expect(zeilen).toHaveLength(2);
  });
});

describe('(7) die Wachen der Tabelle', () => {
  it('ein Fenster ueber mehr als ein Jahr wird abgewiesen', async () => {
    const planer = await konto(f.reinigung);
    await expect(alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, ['2028-01-01', '2030-01-01', 'freier_zeitraum', 0, 0, 0, 0,
        {}, null, ART, []]),
    )).rejects.toThrow(/dv_zeitraum_begrenzt/u);
  });

  it('eine unbekannte Zeitraumart wird abgewiesen — O-710 ist offen, nicht beliebig', async () => {
    const planer = await konto(f.reinigung);
    await expect(alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'quartal', 0, 0, 0, 0, {}, null, ART, []]),
    )).rejects.toThrow(/dv_umfang_platzhalter/u);
  });

  /**
   * K-17: `einsatz_status` kennt kein `veroeffentlicht`, und das fehlt mit
   * Absicht. Der Test steht hier, damit die Absicht nicht versehentlich
   * aufgehoben wird.
   */
  it('einsatz_status kennt weiterhin kein `veroeffentlicht` (K-17)', async () => {
    const werte = await sql.unsafe<{ enumlabel: string }[]>(
      `select e.enumlabel from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'einsatz_status' order by e.enumsortorder`);
    expect(werte.map((w) => w.enumlabel))
      .toStrictEqual(['geplant', 'laufend', 'abgeschlossen', 'storniert']);
  });

  it('die Definer-Funktion gehoert cse_definer und nicht postgres (K-01)', async () => {
    const [z] = await sql.unsafe<{ owner: string; secdef: boolean }[]>(
      `select pg_get_userbyid(p.proowner) as owner, p.prosecdef as secdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'dienstplan_veroeffentlichung_anlegen'`);
    expect(z?.secdef).toBe(true);
    expect(z?.owner).toBe('cse_definer');
  });
});

/**
 * **Die Form der beiden jsonb-Argumente — benannt, nicht erlitten (0315).**
 *
 * Ein `jsonb`-Argument traegt seine Form nicht im Typ: `'[]'` und `"[]"` sind
 * beide gueltiges jsonb, und nur eines davon ist eine Liste. Bis 0315 endete
 * der falsche Fall in `jsonb_array_elements` mit `cannot extract elements from
 * a scalar` — einer Meldung, die weder das Argument nennt noch sagt, was
 * erwartet wurde. Diese Gruppe haelt fest, dass die Funktion stattdessen
 * antwortet.
 */
describe('(8) die Form der jsonb-Argumente wird benannt', () => {
  it('p_empfaenger als JSON-TEXT wird benannt abgewiesen — der D-467-Fall', async () => {
    const planer = await konto(f.reinigung);
    await expect(alsApp(sitzung(f.reinigung, planer), async (tx) =>
      // Genau der Aufruf, an dem diese Datei vierzehnmal gescheitert ist.
      tx.unsafe(RUF, [VON, BIS, 'woche', 0, 0, 0, 0, {}, null, ART, '[]']),
    )).rejects.toThrow(/p_empfaenger ist eine Liste von Meldungen .*erhalten: string/u);
  });

  it('p_empfaenger als Objekt ebenso — und nennt die vorgefundene Form', async () => {
    const planer = await konto(f.reinigung);
    await expect(alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 0, 0, 0, 0, {}, null, ART,
        { person_id: f.fatima }]),
    )).rejects.toThrow(/p_empfaenger ist eine Liste von Meldungen .*erhalten: object/u);
  });

  it('p_umfang_daten als JSON-TEXT auch — dort waere der Schaden STILL', async () => {
    const planer = await konto(f.reinigung);
    // Ohne diese Pruefung landete der Skalar `"{}"` in der Beleg-Spalte, ohne
    // eine Bedingung zu verletzen; jeder spaetere `->>`-Zugriff griffe ins
    // Leere, und nichts waere rot geworden.
    await expect(alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 0, 0, 0, 0, '{}', null, ART, []]),
    )).rejects.toThrow(/p_umfang_daten ist die Abgrenzung als jsonb-Objekt/u);
  });

  it('die Abgrenzung steht danach als OBJEKT in der Zeile, nicht als Text', async () => {
    const planer = await konto(f.reinigung);
    const [r] = await alsApp(sitzung(f.reinigung, planer), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 1, 0, 0, 0,
        { abgrenzung: 'lebende Einteilung im Fenster (O-711)', personen: 1 },
        null, ART, []]) as Promise<{ id: string }[]>);
    const [z] = await sql.unsafe<{ typ: string; abgrenzung: string | null }[]>(
      `select jsonb_typeof(umfang_daten) as typ,
              umfang_daten->>'abgrenzung' as abgrenzung
         from dienstplan_veroeffentlichung where id = $1`, [r!.id]);
    expect(z?.typ).toBe('object');
    expect(z?.abgrenzung).toBe('lebende Einteilung im Fenster (O-711)');
  });

  it('fehlendes Recht antwortet weiter ZUERST — auch bei falscher Form (AUT-06)', async () => {
    const planer = await konto(f.reinigung);
    await expect(alsApp(sitzung(f.reinigung, planer, { readonly: true }), async (tx) =>
      tx.unsafe(RUF, [VON, BIS, 'woche', 0, 0, 0, 0, '{}', null, ART, '[]']),
    )).rejects.toThrow(/nicht berechtigt/u);
  });
});
