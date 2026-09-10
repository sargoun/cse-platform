/**
 * PR 34 gegen die echte Datenbank — die sieben Abnahmekriterien, jedes als
 * eigener Fall, und jedes so gebaut, dass es OHNE die Umsetzung fehlschlaegt.
 *
 * Drei davon entscheiden diesen PR, und sie sind hier die ausfuehrlichsten:
 * eine manipulierte Geraetezeit, eine doppelt eingeloeste Marke und eine
 * Korrektur nach der Monatssperre. Alle drei sind Fehler, die in Produktion
 * NICHT auffallen — sie erzeugen plausible Zahlen, keine Ausnahmen.
 *
 * Der Test legt seine Stammdaten selbst an (Kunde, Objekt, Einsatz, Zuordnung,
 * Konto), weil der Seed sie noch nicht kennt.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { dauerMinuten } from '../../src/server/services/zeit/dauer.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/** Die K-11-Referenznaechte, woertlich — nicht umschrieben (§1.9). */
const NAECHTE = [
  { name: 'Normalnacht', von: '2026-03-27T21:00:00Z', bis: '2026-03-28T05:00:00Z', minuten: 480 },
  { name: 'Vorstellung', von: '2026-03-28T21:00:00Z', bis: '2026-03-29T04:00:00Z', minuten: 420 },
  { name: 'Rueckstellung', von: '2026-10-24T20:00:00Z', bis: '2026-10-25T05:00:00Z', minuten: 540 },
] as const;

interface Aufbau {
  readonly mandant: string;
  readonly objekt: string;
  readonly einsatz: string;
  readonly zuordnung: string;
  readonly anstellung: string;
  readonly person: string;
  readonly benutzer: string;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(email: string, personId: string | null = null): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId] as never[]);
  return u!.id;
}

async function mitglied(b: string, m: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [b, m, await rolleId(rolle)]);
}

/**
 * Eine Schicht mit einer Einteilung, in der Zukunft — der Check-in muss
 * innerhalb seines Fensters liegen, und `now()` ist die Uhr, gegen die die
 * bedingte Anweisung prueft.
 */
async function baueEinsatz(opts: {
  beginn?: string; ende?: string; person?: 'fatima' | 'jonas';
} = {}): Promise<Aufbau> {
  const mandant = f.reinigung;
  const person = opts.person === 'jonas' ? f.jonas : f.fatima;
  const anstellung = opts.person === 'jonas' ? f.jonasReinigung : f.fatimaReinigung;
  const beginn = opts.beginn ?? new Date(Date.now() + 10 * 60_000).toISOString();
  const ende = opts.ende ?? new Date(Date.now() + 8 * 3_600_000).toISOString();

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Testkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Buerohaus Nord','Teststr. 3','10115','Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  const [e] = await sql.unsafe<{ id: string }[]>(
    /**
     * Die Wanduhrspalten werden AUS den Zeitpunkten abgeleitet, nicht daneben
     * getippt — sonst behauptet die Fixtur eine Schicht, die es so nicht gibt,
     * und `einsatz_folgetag` weist sie zu Recht ab.
     */
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                          endet_am_folgetag, objekt_id, kunde_id, erstellt_von_art)
     values ($1,'manuell',$2, (($3::timestamptz) at time zone 'Europe/Berlin')::date,
             $3::timestamptz, $4::timestamptz,
             (($3::timestamptz) at time zone 'Europe/Berlin')::time,
             (($4::timestamptz) at time zone 'Europe/Berlin')::time,
             (($4::timestamptz) at time zone 'Europe/Berlin')::date
               > (($3::timestamptz) at time zone 'Europe/Berlin')::date,
             $5, $6, 'system')
     returning id`,
    [mandant, `manuell:${zufall()}${zufall()}`, beginn, ende, o!.id, k!.id] as never[]);
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                    beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
     values ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,'system') returning id`,
    [mandant, e!.id, anstellung, person, beginn, ende] as never[]);

  const benutzer = await konto(`kraft-${zufall()}@cse.test`, person);
  await mitglied(benutzer, mandant, 'mitarbeiter');
  return {
    mandant, objekt: o!.id, einsatz: e!.id, zuordnung: z!.id,
    anstellung, person, benutzer,
  };
}

/** Gibt eine Marke aus und liefert sie im Klartext — wie `app.checkin_ausgeben`. */
async function marke(zuordnung: string, zweck: 'checkin' | 'checkout',
                     planer: string): Promise<string> {
  const [zeile] = await alsApp(
    { scope: 'mandant', mandantId: f.reinigung, benutzerId: planer,
      portal: 'intern', readonly: false },
    async (tx) => tx.unsafe<{ marke: string }[]>(
      `select app.checkin_ausgeben($1::uuid, $2::token_zweck) as marke`,
      [zuordnung, zweck] as never[]),
  );
  return zeile!.marke;
}

/** Der sitzungslose Einloesepfad — genau das, was die Route tut (K-08). */
async function loeseEin(token: string, opts: {
  geraeteZeit?: string | null; geo?: unknown; ip?: string;
} = {}): Promise<{ ergebnis: string; zeiteintrag_id: string | null;
                   beginn: Date | null; zeitabweichung_sek: number | null }> {
  const [zeile] = await alsRolle('cse_checkin', async (tx) =>
    tx.unsafe<{ ergebnis: string; zeiteintrag_id: string | null;
                beginn: Date | null; zeitabweichung_sek: number | null }[]>(
      `select ergebnis, zeiteintrag_id, beginn, zeitabweichung_sek
         from app.checkin_verbrauchen(
           encode(digest($1,'sha256'),'hex'), $2::timestamptz, $3::inet, $4, $5::jsonb)`,
      /**
       * `opts.geo` wird als OBJEKT uebergeben, nicht als Zeichenkette. Der
       * Treiber kodiert selbst; eine schon kodierte Zeichenkette wuerde ein
       * zweites Mal kodiert und landete als jsonb-ZEICHENKETTE — `->> 'lat'`
       * waere NULL, der Check-in gelaenge, und der Punkt fehlte lautlos.
       */
      [token, opts.geraeteZeit ?? null, opts.ip ?? '203.0.113.7', 'Testgeraet',
        opts.geo ?? null] as never[]));
  return zeile!;
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(1) die Serveruhr ist die Wahrheit, die Geraetezeit steht daneben', () => {
  it('eine um zwei Stunden nachgehende Telefonuhr wird GESPEICHERT, nie uebernommen', async () => {
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    const token = await marke(a.zuordnung, 'checkin', planer);

    // Genau zwei Stunden zurueck. Das ist die Zahl aus dem Abnahmekriterium.
    const geraet = new Date(Date.now() - 7200 * 1000);
    const ergebnis = await loeseEin(token, { geraeteZeit: geraet.toISOString() });

    expect(ergebnis.ergebnis).toBe('eingecheckt');

    const [zeile] = await sql.unsafe<{
      beginn_zeitpunkt: Date; geraete_zeit_beginn: Date;
      zeitabweichung_beginn_sek: number; quelle_beginn: string;
    }[]>(
      `select beginn_zeitpunkt, geraete_zeit_beginn, zeitabweichung_beginn_sek, quelle_beginn
         from zeiteintrag where id = $1`, [ergebnis.zeiteintrag_id!]);

    // Der massgebliche Zeitpunkt ist die Serveruhr — hier: nahe jetzt, nicht
    // zwei Stunden zurueck. Zehn Sekunden Spielraum fuer den Testlauf selbst.
    expect(Math.abs(zeile!.beginn_zeitpunkt.getTime() - Date.now())).toBeLessThan(10_000);
    // Und die Behauptung des Geraets steht daneben, unveraendert.
    expect(zeile!.geraete_zeit_beginn.toISOString()).toBe(geraet.toISOString());
    expect(zeile!.quelle_beginn).toBe('server_uhr');
    /**
     * Geraet MINUS Server, also negativ, wenn das Telefon nachgeht. Ein
     * Vorzeichenfehler faellt sonst nirgends auf: beide Zahlen sind plausibel,
     * und erst eine Auswertung „wessen Uhr geht vor" waere systematisch falsch.
     */
    expect(zeile!.zeitabweichung_beginn_sek).toBeGreaterThanOrEqual(-7205);
    expect(zeile!.zeitabweichung_beginn_sek).toBeLessThanOrEqual(-7195);
  });

  it('ohne Geraetezeit bleibt die Abweichung NULL statt 0 — nicht gemessen ist nicht null', async () => {
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    const ergebnis = await loeseEin(await marke(a.zuordnung, 'checkin', planer));

    const [zeile] = await sql.unsafe<{ zeitabweichung_beginn_sek: number | null }[]>(
      `select zeitabweichung_beginn_sek from zeiteintrag where id = $1`,
      [ergebnis.zeiteintrag_id!]);
    expect(zeile!.zeitabweichung_beginn_sek).toBeNull();
  });
});

describe('(2) einmal ist einmal — der bedingte Schreibvorgang (K-09)', () => {
  it('zweimal eingeloest: der zweite Versuch wird abgelehnt und es bleibt EIN Eintrag', async () => {
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    const token = await marke(a.zuordnung, 'checkin', planer);

    const erst = await loeseEin(token);
    const zweit = await loeseEin(token);

    expect(erst.ergebnis).toBe('eingecheckt');
    // Null Zeilen aus der bedingten Anweisung SIND die Ablehnung — sie traegt
    // keinen Grund, weil ein Grund ein Orakel waere (AUT-06).
    expect(zweit.ergebnis).toBe('abgelehnt');
    expect(zweit.zeiteintrag_id).toBeNull();

    const [zahl] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text n from zeiteintrag where einsatz_zuordnung_id = $1`,
      [a.zuordnung]);
    expect(zahl!.n).toBe('1');
  });

  it('90 Minuten vor dem Fenster: abgelehnt — 59 Minuten davor: angenommen (TIM-07 ±1 h)', async () => {
    // Schicht in zwei Stunden. Das Fenster beginnt eine Stunde vorher (TIM-07
    // woertlich), also ist JETZT 120 Minuten davor — ausserhalb.
    const zuFrueh = await baueEinsatz({
      beginn: new Date(Date.now() + 120 * 60_000).toISOString(),
      ende: new Date(Date.now() + 8 * 3_600_000).toISOString(),
    });
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    expect((await loeseEin(await marke(zuFrueh.zuordnung, 'checkin', planer))).ergebnis)
      .toBe('abgelehnt');

    // Und dieselbe Marke 59 Minuten vor Schichtbeginn: angenommen. Ohne diesen
    // Gegenfall bestuende der obere auch dann, wenn NICHTS je angenommen wird.
    const passt = await baueEinsatz({
      beginn: new Date(Date.now() + 59 * 60_000).toISOString(),
      ende: new Date(Date.now() + 8 * 3_600_000).toISOString(),
      person: 'jonas',
    });
    expect((await loeseEin(await marke(passt.zuordnung, 'checkin', planer))).ergebnis)
      .toBe('eingecheckt');
  });

  it('jede Ablehnung wird protokolliert — der Zaehler gegen das Durchprobieren', async () => {
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    const token = await marke(a.zuordnung, 'checkin', planer);
    await loeseEin(token);
    await loeseEin(token, { ip: '203.0.113.9' });

    const [versuche] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text n from kern.anmeldeversuch
        where art = 'checkin' and not erfolg`);
    expect(Number(versuche!.n)).toBeGreaterThanOrEqual(1);

    // Und die Zeile der Marke zaehlt ihre eigenen Fehlversuche mit (§9.2).
    const [zeile] = await sql.unsafe<{ versuche: number }[]>(
      `select versuche from checkin_token where einsatz_zuordnung_id = $1 and zweck='checkin'`,
      [a.zuordnung]);
    expect(zeile!.versuche).toBeGreaterThanOrEqual(1);
  });

  it('NEBENLAEUFIG: acht gleichzeitige Anfragen auf eine Marke ergeben EINEN Zeiteintrag', async () => {
    /**
     * Der Fall, an dem sich K-09 entscheidet. Ein doppelt getipptes Feld auf
     * einer langsamen Verbindung ist kein Randfall, und ein doppelter Eintrag
     * ist doppelt abgerechnete Zeit und ein doppelter § 17-Nachweis.
     *
     * Acht ECHTE parallele Verbindungen, kein `for`-Lauf: nacheinander
     * bestuende auch eine Pruef-dann-schreib-Fassung.
     */
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    const token = await marke(a.zuordnung, 'checkin', planer);

    const ergebnisse = await Promise.all(
      Array.from({ length: 8 }, async () => loeseEin(token)));

    expect(ergebnisse.filter((e) => e.ergebnis === 'eingecheckt')).toHaveLength(1);
    const [zahl] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text n from zeiteintrag where einsatz_zuordnung_id = $1`,
      [a.zuordnung]);
    expect(zahl!.n).toBe('1');
  });

  it('eine verschobene Schicht widerruft ihre Marke — der alte Link wird abgelehnt', async () => {
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    const alt = await marke(a.zuordnung, 'checkin', planer);

    await sql.unsafe(
      `update einsatz set beginn_zeitpunkt = beginn_zeitpunkt + interval '3 hours',
                          ende_zeitpunkt = ende_zeitpunkt + interval '3 hours'
        where id = $1`, [a.einsatz]);

    expect((await loeseEin(alt)).ergebnis).toBe('abgelehnt');
    const [zeile] = await sql.unsafe<{ widerruf_grund: string }[]>(
      `select widerruf_grund from checkin_token where einsatz_zuordnung_id = $1`,
      [a.zuordnung]);
    expect(zeile!.widerruf_grund).toBe('einsatz_verschoben');
  });

  it('genau EINE app.checkin_verbrauchen, und sie hat fuenf Argumente (K-08)', async () => {
    /**
     * Postgres loest Rechte je exakter Signatur auf. Eine dreiargumentige
     * Zweitfassung daneben liesse den `GRANT` ins Leere gehen, und der
     * Endpunkt faellt zur Laufzeit mit „function does not exist" geschlossen —
     * ein Fehler, den kein Schematest sonst findet.
     */
    const fassungen = await sql.unsafe<{ args: string; n: number }[]>(
      `select pg_get_function_arguments(p.oid) as args, p.pronargs as n
         from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'app' and p.proname = 'checkin_verbrauchen'`);
    expect(fassungen).toHaveLength(1);
    expect(fassungen[0]!.n).toBe(5);
    expect(fassungen[0]!.args).toContain('p_geraete_zeit');
    expect(fassungen[0]!.args).toContain('p_user_agent');
    expect(fassungen[0]!.args).toContain('p_geo');

    // Und der Grant loest auf DIESE Signatur auf.
    const [darf] = await sql.unsafe<{ darf: boolean }[]>(
      `select has_function_privilege('cse_checkin',
         'app.checkin_verbrauchen(text,timestamptz,inet,text,jsonb)', 'execute') as darf`);
    expect(darf!.darf).toBe(true);
  });
});

describe('(3) Korrektur ist eine neue Fassung mit Spur (TIM-11)', () => {
  /**
   * `quelle_* = 'import'` und nicht `'server_uhr'` — und das ist keine
   * Bequemlichkeit, sondern die Regel aus §1.8.
   *
   * `kern.stempel_feldzeit()` ERSETZT bei `server_uhr` den mitgeschickten Wert
   * durch `now()`; genau dafuer gibt es sie. Eine von Hand gebaute historische
   * Zeile ist damit keine Serveruhr-Zeile: sie stammt aus einem Import, und
   * das ist eine der drei erlaubten Quellen. Wer hier `server_uhr` schriebe,
   * bekaeme eine Schicht der Laenge null — was der Test bemerkt, die
   * Produktion aber nicht.
   */
  async function abgeschlossenerEintrag(): Promise<{ a: Aufbau; id: string }> {
    const a = await baueEinsatz();
    const [z] = await sql.unsafe<{ id: string }[]>(
      `insert into zeiteintrag (mandant_id, anstellung_id, person_id, einsatz_id,
                                einsatz_zuordnung_id, beginn_zeitpunkt, ende_zeitpunkt,
                                pause_minuten, erfassungsart_beginn, erfassungsart_ende,
                                quelle_beginn, quelle_ende, status, erstellt_von_art)
       values ($1,$2,$3,$4,$5, now() - interval '9 hours', now() - interval '1 hour',
               30,'import','import','import','import',
               'abgeschlossen','system') returning id`,
      [a.mandant, a.anstellung, a.person, a.einsatz, a.zuordnung] as never[]);
    return { a, id: z!.id };
  }

  it('der Beleg selbst laesst sich nicht mehr aendern', async () => {
    const { id } = await abgeschlossenerEintrag();
    await expect(sql.unsafe(
      `update zeiteintrag set beginn_zeitpunkt = now() where id = $1`, [id]),
    ).rejects.toThrow(/unveraenderlich/iu);
  });

  it('die Korrektur praegt Fassung 2, die erste bleibt Wort fuer Wort stehen', async () => {
    const { a, id } = await abgeschlossenerEintrag();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');

    const [vorher] = await sql.unsafe<{ pause_minuten: number; kette_id: string;
                                        version: number; beginn_zeitpunkt: Date }[]>(
      `select pause_minuten, kette_id, version, beginn_zeitpunkt
         from zeiteintrag where id = $1`, [id]);

    const [neu] = await sql.unsafe<{ id: string; beginn_zeitpunkt: Date }[]>(
      `insert into zeiteintrag (mandant_id, kette_id, version, ersetzt_zeiteintrag_id,
                                anstellung_id, person_id, einsatz_id, einsatz_zuordnung_id,
                                beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
                                erfassungsart_beginn, erfassungsart_ende,
                                quelle_beginn, quelle_ende, behauptet_ende, nacherfasst,
                                status, erstellt_von_art)
       select mandant_id, kette_id, version + 1, id, anstellung_id, person_id, einsatz_id,
              einsatz_zuordnung_id, beginn_zeitpunkt, ende_zeitpunkt, 45,
              'nacherfassung','nacherfassung','planer_entscheidung','planer_entscheidung',
              ende_zeitpunkt, true, status, 'system'
         from zeiteintrag where id = $1 returning id, beginn_zeitpunkt`, [id]);

    await sql.unsafe(
      `insert into zeiteintrag_korrektur (mandant_id, kette_id, ursprung_zeiteintrag_id,
                                          ersatz_zeiteintrag_id, art, grund_kategorie,
                                          begruendung, vorher, nachher, durchgefuehrt_von,
                                          erstellt_von_art, erstellt_von)
       select $1, $2, $3, $4, 'pause_korrektur','sonstiges','Pause nachgetragen',
              to_jsonb(a), to_jsonb(n), $5, 'mensch', $5
         from zeiteintrag a join zeiteintrag n on n.id = $4 where a.id = $3`,
      [a.mandant, vorher!.kette_id, id, neu!.id, planer] as never[]);

    const [alt] = await sql.unsafe<{ pause_minuten: number; ersetzt_am: Date | null;
                                     ersetzt_durch_zeiteintrag_id: string | null;
                                     beginn_zeitpunkt: Date }[]>(
      `select pause_minuten, ersetzt_am, ersetzt_durch_zeiteintrag_id, beginn_zeitpunkt
         from zeiteintrag where id = $1`, [id]);

    // Die alte Fassung ist unangetastet — nur als abgeloest markiert.
    expect(alt!.pause_minuten).toBe(vorher!.pause_minuten);
    expect(alt!.beginn_zeitpunkt.toISOString()).toBe(vorher!.beginn_zeitpunkt.toISOString());
    expect(alt!.ersetzt_am).not.toBeNull();
    expect(alt!.ersetzt_durch_zeiteintrag_id).toBe(neu!.id);

    /**
     * Und die neue Fassung traegt DENSELBEN Beginn. Ohne die
     * `version = 1`-Bedingung in `kern.stempel_feldzeit()` zoege eine
     * Pausenkorrektur den Schichtbeginn auf den Zeitpunkt der Korrektur — der
     * § 17-Nachweis waere danach falsch, und beide Werte saehen plausibel aus.
     */
    expect(neu!.beginn_zeitpunkt.toISOString()).toBe(vorher!.beginn_zeitpunkt.toISOString());

    const [spur] = await sql.unsafe<{ begruendung: string; durchgefuehrt_von: string;
                                      durchgefuehrt_am: Date; vorher: unknown }[]>(
      `select begruendung, durchgefuehrt_von, durchgefuehrt_am, vorher
         from zeiteintrag_korrektur where kette_id = $1`, [vorher!.kette_id]);
    expect(spur!.begruendung).toBe('Pause nachgetragen');
    expect(spur!.durchgefuehrt_von).toBe(planer);
    expect(spur!.durchgefuehrt_am).toBeInstanceOf(Date);
    expect((spur!.vorher as { pause_minuten: number }).pause_minuten).toBe(30);
  });

  it('niemand korrigiert seinen eigenen Zeiteintrag (EMP-07)', async () => {
    const { a, id } = await abgeschlossenerEintrag();
    const [kette] = await sql.unsafe<{ kette_id: string }[]>(
      `select kette_id from zeiteintrag where id = $1`, [id]);
    await expect(sql.unsafe(
      `insert into zeiteintrag_korrektur (mandant_id, kette_id, ursprung_zeiteintrag_id,
                                          art, grund_kategorie, begruendung, vorher, nachher,
                                          durchgefuehrt_von, erstellt_von_art, erstellt_von)
       values ($1,$2,$3,'storno','sonstiges','Selbst',' {}'::jsonb,'{}'::jsonb,$4,'mensch',$4)`,
      [a.mandant, kette!.kette_id, id, a.benutzer] as never[]),
    ).rejects.toThrow(/eigenen Zeiteintrag/iu);
  });

  it('die Spur laesst sich weder aendern noch loeschen — auch nicht als Eigentuemer', async () => {
    const { a, id } = await abgeschlossenerEintrag();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    const [kette] = await sql.unsafe<{ kette_id: string }[]>(
      `select kette_id from zeiteintrag where id = $1`, [id]);
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into zeiteintrag_korrektur (mandant_id, kette_id, ursprung_zeiteintrag_id,
                                          art, grund_kategorie, begruendung, vorher, nachher,
                                          durchgefuehrt_von, erstellt_von_art, erstellt_von)
       values ($1,$2,$3,'storno','sonstiges','Doppelt erfasst','{}'::jsonb,'{}'::jsonb,
               $4,'mensch',$4) returning id`,
      [a.mandant, kette!.kette_id, id, planer] as never[]);

    await expect(sql.unsafe(
      `update zeiteintrag_korrektur set begruendung = 'anders' where id = $1`, [k!.id]),
    ).rejects.toThrow(/unveraenderlich/iu);
    /**
     * Zwei Ausloeser weisen dieses DELETE ab, und beide sollen es: der
     * erzeugte `kein_hard_delete` (Invariante 8) und `zk_write_once` (§5.7).
     * Welcher zuerst feuert, entscheidet die Namensreihenfolge — die Zusage
     * ist, dass es NICHT durchgeht, nicht welcher Satz dabei herauskommt.
     */
    await expect(sql.unsafe(
      `delete from zeiteintrag_korrektur where id = $1`, [k!.id]),
    ).rejects.toThrow(/unveraenderlich|hard delete/iu);
  });

  it('und der Zeiteintrag selbst laesst sich nicht loeschen (Invariante 8)', async () => {
    const { id } = await abgeschlossenerEintrag();
    await expect(sql.unsafe(`delete from zeiteintrag where id = $1`, [id]))
      .rejects.toThrow();
    for (const rolle of ['cse_app', 'cse_job']) {
      await expect(alsRolle(rolle, async (tx) =>
        tx.unsafe(`delete from zeiteintrag where id = $1`, [id])),
      ).rejects.toThrow();
    }
  });

  it('eine Korrektur nach der MONATSSPERRE verlangt ihre Gegenbuchung (EMP-04)', async () => {
    /**
     * Der dritte der drei entscheidenden Faelle. Ohne diese Bedingung liesse
     * sich eine Korrektur an einem abgerechneten Monat aufschreiben, deren
     * Wirkung nirgends ankommt: der gesperrte Monat bleibt richtig, der offene
     * weiss nichts davon, und die Differenz ist weg — ohne Fehlermeldung.
     */
    const { a, id } = await abgeschlossenerEintrag();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    const [kette] = await sql.unsafe<{ kette_id: string }[]>(
      `select kette_id from zeiteintrag where id = $1`, [id]);

    // `z_monat_sperren` kommt mit PR 37; hier wird die Spalte gesetzt, die er
    // setzen wird — die Bedingung haengt an ihr, nicht an ihrem Schreiber.
    await sql.unsafe(`update zeiteintrag set gesperrt_am = now() where id = $1`, [id]);

    const korrektur = (ausgleich: string | null): Promise<unknown> => sql.unsafe(
      `insert into zeiteintrag_korrektur (mandant_id, kette_id, ursprung_zeiteintrag_id,
                                          art, grund_kategorie, begruendung, vorher, nachher,
                                          ausgleich_bewegung_id, durchgefuehrt_von,
                                          erstellt_von_art, erstellt_von)
       values ($1,$2,$3,'storno','sonstiges','Nachtraeglich','{}'::jsonb,'{}'::jsonb,
               $4::uuid,$5,'mensch',$5)`,
      [a.mandant, kette!.kette_id, id, ausgleich, planer] as never[]);

    await expect(korrektur(null)).rejects.toThrow(/gesperrt/iu);
    // Mit Gegenbuchung geht sie durch — sonst bestuende der obere Fall auch
    // dann, wenn ueberhaupt keine Korrektur mehr moeglich waere.
    await expect(korrektur('11111111-1111-1111-1111-111111111111')).resolves.toBeDefined();
  });
});

describe('(5) ohne Schalter kein Punkt — LEG-10 auf O-06', () => {
  it('Koordinaten bei ausgeschalteter Geolokalisierung: die Datenbank weist sie ab', async () => {
    const a = await baueEinsatz();
    await expect(sql.unsafe(
      `insert into zeiteintrag (mandant_id, anstellung_id, person_id, beginn_zeitpunkt,
                                erfassungsart_beginn, quelle_beginn,
                                geo_beginn_lat, geo_beginn_lon, geo_beginn_status,
                                erstellt_von_art)
       values ($1,$2,$3, now(), 'portal','server_uhr', 52.520008, 13.404954,'erfasst','system')`,
      [a.mandant, a.anstellung, a.person] as never[]),
    ).rejects.toThrow(/Geolokalisierung/iu);
  });

  it('und der Check-in speichert auch dann keinen Punkt, wenn das Telefon einen schickt', async () => {
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    const ergebnis = await loeseEin(await marke(a.zuordnung, 'checkin', planer), {
      geo: { lat: 52.520008, lon: 13.404954, genauigkeit_m: 12, status: 'erfasst' },
    });

    expect(ergebnis.ergebnis).toBe('eingecheckt');
    const [zeile] = await sql.unsafe<{
      geo_beginn_lat: string | null; geo_beginn_lon: string | null;
      geo_beginn_genauigkeit_m: string | null; geo_beginn_status: string;
      geo_ende_status: string;
    }[]>(
      `select geo_beginn_lat, geo_beginn_lon, geo_beginn_genauigkeit_m,
              geo_beginn_status, geo_ende_status
         from zeiteintrag where id = $1`, [ergebnis.zeiteintrag_id!]);
    // Nirgends erfasst, nirgends gespeichert — nicht einmal die Genauigkeit.
    expect(zeile!.geo_beginn_lat).toBeNull();
    expect(zeile!.geo_beginn_lon).toBeNull();
    expect(zeile!.geo_beginn_genauigkeit_m).toBeNull();
    expect(zeile!.geo_beginn_status).toBe('deaktiviert');
    expect(zeile!.geo_ende_status).toBe('deaktiviert');
  });

  it('mit eingeschaltetem Schalter wird der Punkt gespeichert — das Tor ist echt, keine Konstante',
    async () => {
      const a = await baueEinsatz();
      /**
       * `insert … on conflict` und kein blosses `update`: der Seed der Fixtur
       * laeuft unter `session_replication_role = replica`, also feuert der
       * Vorbelegungsausloeser dort NICHT, und ein `update` traefe null Zeilen.
       * Es liefe grün durch und pruefte nichts — der Schalter waere weiter aus,
       * der Punkt weiter NULL, und die Zusage „das Tor ist echt" bewiese
       * nichts.
       */
      await sql.unsafe(
        `insert into mandant_einstellung (mandant_id, schluessel, wert, gesetzt_von_grundlage)
         values ($1,'zeit.geolokalisierung','true'::jsonb,'Testfall')
         on conflict (mandant_id, schluessel) do update set wert = 'true'::jsonb`,
        [a.mandant]);
      // Erst nachweisen, dass der Schalter WIRKLICH an ist: sonst bewiese ein
      // fehlender Punkt unten nur, dass die Vorbereitung nicht gegriffen hat.
      const [an] = await sql.unsafe<{ an: boolean }[]>(
        `select coalesce((app.einstellung($1::uuid,'zeit.geolokalisierung'))::boolean,false) an`,
        [a.mandant]);
      expect(an!.an).toBe(true);

      const planer = await konto(`planer-${zufall()}@cse.test`);
      await mitglied(planer, f.reinigung, 'leitung');
      const ergebnis = await loeseEin(await marke(a.zuordnung, 'checkin', planer), {
        geo: { lat: 52.520008, lon: 13.404954, genauigkeit_m: 12, status: 'erfasst' },
      });
      const [zeile] = await sql.unsafe<{ geo_beginn_lat: string | null;
                                         geo_beginn_status: string }[]>(
        `select geo_beginn_lat, geo_beginn_status from zeiteintrag where id = $1`,
        [ergebnis.zeiteintrag_id!]);
      expect(Number(zeile!.geo_beginn_lat)).toBeCloseTo(52.520008, 5);
      expect(zeile!.geo_beginn_status).toBe('erfasst');
    });

  it('die sieben O-06-Schalter entstehen mit jeder Gesellschaft, alle auf false', async () => {
    const [m] = await sql.unsafe<{ id: string }[]>(
      `insert into mandant (slug, name, firma) values ($1,'Neu','Neu GmbH') returning id`,
      [`neu-${zufall()}`]);
    const zeilen = await sql.unsafe<{ schluessel: string; wert: unknown }[]>(
      `select schluessel, wert from mandant_einstellung where mandant_id = $1 order by 1`,
      [m!.id]);
    expect(zeilen.map((z) => z.schluessel)).toEqual([
      'geo.erfassung_erlaubt', 'wachbuch.uebergabe_fenster',
      'zeit.abweichungsauswertung', 'zeit.geolokalisierung', 'zeit.geraetekennung',
      'zeit.korrekturstatistik', 'zeit.nichterschienen_auswertung',
    ]);
    // Die fuenf Ueberwachungsschalter stehen auf false — ausgeliefert, nicht
    // fehlend: der Unterschied zwischen „bewusst aus" und „nie entschieden".
    for (const z of zeilen) {
      if (z.schluessel.startsWith('zeit.') || z.schluessel === 'geo.erfassung_erlaubt') {
        expect(z.wert, z.schluessel).toBe(false);
      }
    }
  });
});

describe('(6) „Aktuell im Einsatz" zaehlt genau die offenen Eintraege (DSH-05)', () => {
  it('die Kachel und die direkte Zaehlung sagen dasselbe — auch nach dem Ausstempeln', async () => {
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    const a = await baueEinsatz();
    const b = await baueEinsatz({ person: 'jonas' });

    await loeseEin(await marke(a.zuordnung, 'checkin', planer));
    await loeseEin(await marke(b.zuordnung, 'checkin', planer));

    const zaehle = async (): Promise<{ sicht: number; direkt: number }> => {
      const [z] = await alsApp(
        { scope: 'mandant', mandantId: f.reinigung, benutzerId: planer,
          portal: 'intern', readonly: true },
        async (tx) => tx.unsafe<{ sicht: string; direkt: string }[]>(
          `select (select count(*) from zeiteintrag_offen)::text as sicht,
                  (select count(*) from zeiteintrag
                    where ende_zeitpunkt is null and storniert_am is null
                      and ersetzt_am is null and status = 'laufend')::text as direkt`),
      );
      return { sicht: Number(z!.sicht), direkt: Number(z!.direkt) };
    };

    expect(await zaehle()).toEqual({ sicht: 2, direkt: 2 });

    // Ausstempeln — und die Kachel faellt live mit.
    const [ausgestempelt] = [await loeseEin(await marke(a.zuordnung, 'checkout', planer))];
    expect(ausgestempelt!.ergebnis).toBe('ausgecheckt');
    expect(await zaehle()).toEqual({ sicht: 1, direkt: 1 });
  });

  it('zwei gleichzeitig offene Eintraege je Beschaeftigung sind unmoeglich (z_offen_uk)', async () => {
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    await loeseEin(await marke(a.zuordnung, 'checkin', planer));

    await expect(sql.unsafe(
      `insert into zeiteintrag (mandant_id, anstellung_id, person_id, beginn_zeitpunkt,
                                erfassungsart_beginn, quelle_beginn, erstellt_von_art)
       values ($1,$2,$3, now(), 'portal','server_uhr','system')`,
      [a.mandant, a.anstellung, a.person] as never[]),
    ).rejects.toThrow(/z_offen_uk|duplicate key/iu);
  });
});

describe('(7) die Abweichung wird gespeichert, auch wenn sie nicht ausgewertet werden darf', () => {
  it('zeit.abweichungsauswertung ist aus — und zeitabweichung_sek steht trotzdem da', async () => {
    /**
     * Invariante 5 verlangt die TATSACHE; § 87 Abs. 1 Nr. 6 BetrVG betrifft
     * ihre AUSWERTUNG je Person. Zwei verschiedene Handlungen, und nur die
     * zweite ist mitbestimmungspflichtig (§1.15). Wer die Ableitung an den
     * Schalter haengte, verloere die Tatsache — und koennte sie nachtraeglich
     * nicht mehr herstellen.
     */
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');

    /**
     * Gefragt wird ueber `app.einstellung`, nicht ueber die Zeile: fehlt sie,
     * ist die Antwort NULL, und JEDER Aufrufer nennt seinen eigenen
     * Vorgabewert — hier `false`. Beides bedeutet „aus", und beide Wege
     * muessen dasselbe ergeben, sonst haengt die Auswertungssperre daran, ob
     * jemand eine Zeile angelegt hat.
     */
    const [schalter] = await sql.unsafe<{ an: boolean }[]>(
      `select coalesce((app.einstellung($1::uuid,'zeit.abweichungsauswertung'))::boolean,
                       false) as an`, [a.mandant]);
    expect(schalter!.an).toBe(false);

    const ergebnis = await loeseEin(await marke(a.zuordnung, 'checkin', planer), {
      geraeteZeit: new Date(Date.now() + 900_000).toISOString(),
    });
    const [zeile] = await sql.unsafe<{ zeitabweichung_beginn_sek: number }[]>(
      `select zeitabweichung_beginn_sek from zeiteintrag where id = $1`,
      [ergebnis.zeiteintrag_id!]);
    // Geraet geht 15 Minuten VOR — also positiv.
    expect(zeile!.zeitabweichung_beginn_sek).toBeGreaterThan(890);
    expect(zeile!.zeitabweichung_beginn_sek).toBeLessThan(910);
  });
});

describe('die Dauer ist die Differenz zweier UTC-Zeitpunkte (K-11, §7.1)', () => {
  it.each(NAECHTE)('$name: $minuten Minuten — in SQL und in TypeScript dieselbe Zahl',
    async ({ von, bis, minuten }) => {
      const [z] = await sql.unsafe<{ n: number }[]>(
        `select app.dauer_minuten($1::timestamptz, $2::timestamptz) n`, [von, bis]);
      expect(z!.n).toBe(minuten);
      // Und `services/zeit/dauer.ts` sagt dasselbe. Zwei Rechnungen fuer eine
      // Tatsache waeren zwei Antworten auf die Frage, wie lang die Schicht war.
      expect(dauerMinuten(new Date(von), new Date(bis))).toBe(minuten);
    });

  it('der Ausloeser rechnet Brutto und Netto mit derselben Funktion', async () => {
    const a = await baueEinsatz();
    const [z] = await sql.unsafe<{ dauer_brutto_minuten: number;
                                   dauer_netto_minuten: number }[]>(
      `insert into zeiteintrag (mandant_id, anstellung_id, person_id, beginn_zeitpunkt,
                                ende_zeitpunkt, pause_minuten, erfassungsart_beginn,
                                erfassungsart_ende, quelle_beginn, quelle_ende, status,
                                erstellt_von_art)
       values ($1,$2,$3,'2026-10-24T20:00:00Z','2026-10-25T05:00:00Z',45,
               'planer_manuell','planer_manuell','import','import','abgeschlossen','system')
       returning dauer_brutto_minuten, dauer_netto_minuten`,
      [a.mandant, a.anstellung, a.person] as never[]);
    // Die Rueckstellungsnacht: 540 brutto, 495 netto. Eine Wanduhrrechnung
    // ergaebe 480 — eine Stunde Lohn, zweimal im Jahr.
    expect(z!.dauer_brutto_minuten).toBe(540);
    expect(z!.dauer_netto_minuten).toBe(495);
  });

  it('eine Pause laenger als die Schicht wird abgewiesen', async () => {
    const a = await baueEinsatz();
    await expect(sql.unsafe(
      `insert into zeiteintrag (mandant_id, anstellung_id, person_id, beginn_zeitpunkt,
                                ende_zeitpunkt, pause_minuten, erfassungsart_beginn,
                                quelle_beginn, status, erstellt_von_art)
       values ($1,$2,$3, now() - interval '2 hours', now(), 200,
               'planer_manuell','import','abgeschlossen','system')`,
      [a.mandant, a.anstellung, a.person] as never[]),
    ).rejects.toThrow(/Pause/iu);
  });
});

describe('app.einsatz_hat_zeiterfassung — der Rumpf aus 0032 ist ersetzt', () => {
  it('sie antwortet jetzt aus zeiteintrag statt konstant false', async () => {
    /**
     * 0032 hat die Funktion mit `select false` angelegt und die Ersetzung
     * ausdruecklich an PR 34 verwiesen. Bliebe der Rumpf stehen, liefe der
     * Generator weiter, meldete keinen Fehler — und ueberschriebe eine
     * Schicht, auf der schon jemand gearbeitet hat. Dieser Test ist die
     * Quittung, die 0032 verlangt hat.
     */
    const a = await baueEinsatz();
    const [vorher] = await sql.unsafe<{ hat: boolean }[]>(
      `select app.einsatz_hat_zeiterfassung($1) hat`, [a.einsatz]);
    expect(vorher!.hat).toBe(false);

    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    await loeseEin(await marke(a.zuordnung, 'checkin', planer));

    const [nachher] = await sql.unsafe<{ hat: boolean }[]>(
      `select app.einsatz_hat_zeiterfassung($1) hat`, [a.einsatz]);
    expect(nachher!.hat).toBe(true);

    // Und der Rumpf nennt die Tabelle — ein `select false` mit richtigem
    // Ergebnis waere kein Ersatz, sondern ein Zufall.
    const [quelle] = await sql.unsafe<{ src: string }[]>(
      `select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='app' and p.proname='einsatz_hat_zeiterfassung'`);
    expect(quelle!.src).toContain('zeiteintrag');
    expect(quelle!.src).not.toMatch(/^\s*select false\s*;?\s*$/u);
  });

  it('eine stornierte Erfassung zaehlt nicht — sonst blockierte ein Irrtum die Schicht fuer immer',
    async () => {
      const a = await baueEinsatz();
      const planer = await konto(`planer-${zufall()}@cse.test`);
      await mitglied(planer, f.reinigung, 'leitung');
      const e = await loeseEin(await marke(a.zuordnung, 'checkin', planer));
      await sql.unsafe(
        `update zeiteintrag set status = 'storniert', storniert_am = now(),
                                storno_grund = 'Irrtum' where id = $1`,
        [e.zeiteintrag_id!]);
      const [z] = await sql.unsafe<{ hat: boolean }[]>(
        `select app.einsatz_hat_zeiterfassung($1) hat`, [a.einsatz]);
      expect(z!.hat).toBe(false);
    });
});

describe('der Zeiteintrag ist keine Kundenzeile und keine Selbstbedienung (§1.3, §1.4)', () => {
  it('der Mensch LIEST seine eigenen Stunden im Personen-Scope', async () => {
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    await loeseEin(await marke(a.zuordnung, 'checkin', planer));

    const zeilen = await alsApp(
      { scope: 'person', mandantIds: [f.reinigung], personId: a.person,
        benutzerId: a.benutzer, portal: 'mitarbeiter', readonly: true },
      async (tx) => tx.unsafe<{ id: string }[]>(`select id from zeiteintrag`),
    );
    expect(zeilen).toHaveLength(1);
  });

  it('und er SCHREIBT keinen — auch nicht seinen eigenen (EMP-07)', async () => {
    const a = await baueEinsatz();
    await expect(alsApp(
      { scope: 'person', mandantIds: [f.reinigung], personId: a.person,
        benutzerId: a.benutzer, portal: 'mitarbeiter', readonly: false },
      async (tx) => tx.unsafe(
        `insert into zeiteintrag (mandant_id, anstellung_id, person_id, beginn_zeitpunkt,
                                  erfassungsart_beginn, quelle_beginn, erstellt_von_art)
         values ($1,$2,$3, now(),'portal','server_uhr','system')`,
        [a.mandant, a.anstellung, a.person] as never[]),
    )).rejects.toThrow(/row-level security/iu);
  });

  it('der Markenspeicher haelt fuer cse_app kein Leserecht auf token_hash', async () => {
    /**
     * Ein Tabellen-Grant gefolgt von einem Spalten-`revoke` bewirkt in
     * Postgres NICHTS. Die Spalte darf nie Teil des Grants sein — und genau
     * das wird hier geprueft, nicht die Absicht.
     */
    const [darf] = await sql.unsafe<{ darf: boolean }[]>(
      `select has_column_privilege('cse_app','checkin_token','token_hash','select') darf`);
    expect(darf!.darf).toBe(false);
    const [rest] = await sql.unsafe<{ darf: boolean }[]>(
      `select has_column_privilege('cse_app','checkin_token','eingeloest_am','select') darf`);
    expect(rest!.darf).toBe(true);
  });

  it('und der Klartext der Marke steht nirgends in der Datenbank', async () => {
    const a = await baueEinsatz();
    const planer = await konto(`planer-${zufall()}@cse.test`);
    await mitglied(planer, f.reinigung, 'leitung');
    const klartext = await marke(a.zuordnung, 'checkin', planer);

    const [zeile] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text n from checkin_token
        where token_hash = $1 or coalesce(widerruf_grund,'') = $1`, [klartext]);
    expect(zeile!.n).toBe('0');
    // Auch nicht im Audit.
    const [audit] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text n from audit_log where nachher::text like $1`,
      [`%${klartext}%`]);
    expect(audit!.n).toBe('0');
  });
});
