/**
 * PR 37 gegen die echte Datenbank — die vier Abnahmekriterien, jedes als
 * eigener Fall und jedes so gebaut, dass es OHNE die Umsetzung fehlschlaegt.
 *
 * Zwei davon entscheiden diesen PR und sind hier die ausfuehrlichsten: der
 * gesperrte Monat, der sich nicht mehr bewegt, und die Korrektur, die
 * stattdessen im ersten OFFENEN Monat ankommt (EMP-04, §12.2). Beides sind
 * Fehler, die in Produktion NICHT auffallen — sie erzeugen plausible Zahlen,
 * keine Ausnahmen: ein Monat, der sich nachtraeglich aendert, sieht genauso
 * aus wie einer, der stimmt, und eine Korrektur, die nirgends ankommt, fehlt
 * nur in einer Summe, die niemand nachrechnet.
 *
 * Der Test legt seine Stammdaten selbst an; der Seed kennt sie in dieser Form
 * nicht.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  bucheFreigegebeneZeiten, bucheKorrektur, eroeffneKonto, ersterOffenerMonat,
  kombiniereKonten, leseBewegungen, leseKonten, MonatGesperrtFehler, pruefeAbgleich,
  saldoMinuten, schliesseMonatAb, UnfreigegebeneZeitenFehler,
} from '../../src/server/services/zeit/stundenkonto.js';
import { eroeffneUrlaubskonto, leseUrlaubskonten }
  from '../../src/server/services/zeit/urlaubskonto.js';
import { korrigiereZeiteintrag } from '../../src/server/services/zeit/korrektur.js';
import { milliMenge, NULL_MENGE } from '../../src/server/services/finanz/menge.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/** Die Nacht, an der sich der Monatssplit entscheidet (K-11, §7.3). */
const OKT_NOV = { von: '2026-10-31T21:00:00Z', bis: '2026-11-01T05:00:00Z' } as const;

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
 * `zeit.konto_korrigieren` ist im Katalog nur an `super_admin` GEBUNDEN und
 * fuer `admin`/`leitung` bindbar — wer ueber den Lohn eines gesperrten Monats
 * entscheidet, bekommt das Recht ausdruecklich. Der Test bindet es, weil er
 * sonst genau daran scheitert; dass er ohne es scheitert, prueft ein eigener
 * Fall weiter unten.
 */
async function rechtBinden(schluessel: string, rolle = 'leitung'): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select r.id, b.id, null, true
       from rolle r, berechtigung b
      where r.schluessel = $1 and r.mandant_id is null and b.schluessel = $2
     on conflict do nothing`, [rolle, schluessel]);
}

/**
 * Ein abgeschlossener, FREIGEGEBENER Zeiteintrag mit historischen Zeitpunkten.
 *
 * `quelle_* = 'import'` und nicht `'server_uhr'`: `kern.stempel_feldzeit()`
 * ersetzt bei `server_uhr` den mitgeschickten Wert durch `now()` — voellig zu
 * Recht (Invariante 5), aber dann liesse sich kein Monat der Vergangenheit
 * pruefen.
 */
async function baueZeiteintrag(opts: {
  mandant: string; anstellung: string; person: string;
  von: string; bis: string; pause?: number; freigebenDurch?: string | null;
}): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, beginn_zeitpunkt, ende_zeitpunkt,
        pause_minuten, erfassungsart_beginn, erfassungsart_ende,
        quelle_beginn, quelle_ende, status, erstellt_von_art,
        freigegeben_am, freigegeben_von)
     values ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,
             'import','import','import','import','abgeschlossen','system',
             case when $7::uuid is null then null else now() end, $7::uuid)
     returning id`,
    [
      opts.mandant, opts.anstellung, opts.person, opts.von, opts.bis,
      opts.pause ?? 0, opts.freigebenDurch ?? null,
    ] as never[]);
  return z!.id;
}

function kontextAus(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
  portal: 'intern' | 'mitarbeiter' = 'intern',
): SchreibKontext {
  const abfrage = async <T>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal, benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant],
    abfrage, schreibe: abfrage,
  };
}

/** Derselbe Ausschnitt fuer die Personenansicht — ohne aktiven Mandanten. */
function personKontextAus(
  tx: postgres.TransactionSql, benutzer: string, mandanten: readonly string[],
): LeseKontext {
  const abfrage = async <T>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'person', portal: 'mitarbeiter', benutzerId: benutzer,
    aktiverMandantId: null, mandantIds: mandanten, abfrage,
  };
}

interface Buehne { readonly planer: string; readonly mandant: string }

async function planer(mandant: string): Promise<Buehne> {
  const id = await konto(`planung-${zufall()}@cse.test`);
  await mitglied(id, mandant, 'leitung');
  return { planer: id, mandant };
}

function sitzung(b: Buehne): Parameters<typeof alsApp>[0] {
  return {
    scope: 'mandant', mandantId: b.mandant, benutzerId: b.planer,
    portal: 'intern', readonly: false,
  };
}

/** Die ganze Zeile als Text — fuer „byte-gleich" gibt es keine bessere Probe. */
async function kontoAbbild(kontoId: string): Promise<string> {
  const [z] = await sql.unsafe<{ abbild: string }[]>(
    `select to_jsonb(k)::text as abbild from stundenkonto k where k.id = $1`, [kontoId]);
  return z!.abbild;
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

// ---------------------------------------------------------------------------

describe('(1) ein gesperrter Monat aendert sich nicht mehr', () => {
  /** Maerz 2026: eine freigegebene Acht-Stunden-Schicht, gebucht und gesperrt. */
  async function maerzSperren(): Promise<{
    b: Buehne; kontoId: string; zeiteintragId: string; abbild: string;
  }> {
    const b = await planer(f.reinigung);
    const zeiteintragId = await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-03-05T06:00:00Z', bis: '2026-03-05T14:00:00Z', freigebenDurch: b.planer,
    });
    const kontoId = await alsApp(sitzung(b), async (tx) => {
      const k = kontextAus(tx, f.reinigung, b.planer);
      await eroeffneKonto(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 3,
        sollMinuten: 400 });
      const abschluss = await schliesseMonatAb(
        k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 3 });
      return abschluss.kontoId;
    });
    return { b, kontoId, zeiteintragId, abbild: await kontoAbbild(kontoId) };
  }

  it('der Abschluss bucht, sperrt und praegt das Artefakt — in dieser Reihenfolge', async () => {
    const b = await planer(f.reinigung);
    await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-03-05T06:00:00Z', bis: '2026-03-05T14:00:00Z', freigebenDurch: b.planer });

    const ergebnis = await alsApp(sitzung(b), async (tx) => {
      const k = kontextAus(tx, f.reinigung, b.planer);
      await eroeffneKonto(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 3,
        sollMinuten: 400 });
      return schliesseMonatAb(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 3 });
    });

    expect(ergebnis.istMinuten).toBe(480);
    expect(ergebnis.sollMinuten).toBe(400);
    // Dieselbe Formel wie die GENERATED-Spalte — zwei Umsetzungen, eine Regel.
    expect(ergebnis.saldoMinuten).toBe(saldoMinuten(0, 480, 400));
    expect(ergebnis.saldoMinuten).toBe(80);
    // Das Artefakt (D-152) entsteht beim Sperren und nicht beim Abfragen.
    expect(ergebnis.nachweisHash).toMatch(/^[0-9a-f]{64}$/u);

    /**
     * Und der Sperrstempel steht auf dem Zeiteintrag. Ohne `z_monat_sperren`
     * bliebe `gesperrt_am` fuer immer NULL — und mit ihr feuerte
     * `zk_sperre_ausgleich` nie, der Lohnexport waehlte null Zeilen, und
     * beides ohne eine einzige Fehlermeldung.
     */
    const [z] = await sql.unsafe<{ gesperrt: Date | null }[]>(
      `select gesperrt_am as gesperrt from zeiteintrag where anstellung_id = $1`,
      [f.fatimaReinigung]);
    expect(z!.gesperrt).not.toBeNull();
  });

  it('jeder Schreibweg in den gesperrten Monat wird abgewiesen', async () => {
    const { b, kontoId, abbild } = await maerzSperren();

    // 1. Der Dienst: eine weitere Buchung in den Monat.
    await expect(alsApp(sitzung(b), async (tx) => bucheFreigegebeneZeiten(
      kontextAus(tx, f.reinigung, b.planer),
      { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 3 },
    ))).rejects.toThrow(MonatGesperrtFehler);

    // 2. Der Abschluss ein zweites Mal.
    await expect(alsApp(sitzung(b), async (tx) => schliesseMonatAb(
      kontextAus(tx, f.reinigung, b.planer),
      { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 3 },
    ))).rejects.toThrow(MonatGesperrtFehler);

    // 3. Die Datenbank, an jedem Dienst vorbei: eine Bewegung von Hand.
    await expect(sql.unsafe(
      `insert into stundenkonto_bewegung
         (mandant_id, stundenkonto_id, art, minuten, wirksam_am, quelle)
       values ($1,$2,'arbeitszeit',60,'2026-03-06','system')`,
      [f.reinigung, kontoId])).rejects.toThrow(/gesperrt/iu);

    // 4. Die Zahlen selbst.
    await expect(sql.unsafe(
      `update stundenkonto set soll_minuten = 1 where id = $1`, [kontoId]))
      .rejects.toThrow(/gesperrt/iu);

    /**
     * 5. **Entsperren ist kein Vorgang.** Das ist der bequeme Ausweg, den
     * EMP-04 ausschliesst: Monat auf, neu rechnen, Monat zu — danach zeigt die
     * Plattform andere Zahlen als der Nachweis in der Hand des Menschen.
     */
    await expect(sql.unsafe(
      `update stundenkonto set status = 'offen' where id = $1`, [kontoId]))
      .rejects.toThrow(/nicht zurueck|gesperrt/iu);

    // Und danach steht die Zeile Byte fuer Byte so da wie vorher.
    expect(await kontoAbbild(kontoId)).toBe(abbild);
  });

  it('die Korrektur landet im ERSTEN OFFENEN Monat, mit Verweis zurueck', async () => {
    const { b, kontoId, zeiteintragId, abbild } = await maerzSperren();
    await rechtBinden('zeit.konto_korrigieren');

    /**
     * April wird gar nicht erst angelegt. „Der Folgemonat" waere die falsche
     * Regel: gemeint ist der erste OFFENE (§12.2), und der ist hier der Mai.
     */
    const mai = await alsApp(sitzung(b), async (tx) => eroeffneKonto(
      kontextAus(tx, f.reinigung, b.planer),
      { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 5 }));

    const ausgleich = await alsApp(sitzung(b), async (tx) => bucheKorrektur(
      kontextAus(tx, f.reinigung, b.planer),
      {
        anstellungId: f.fatimaReinigung, jahr: 2026, monat: 3, minuten: 60,
        begruendung: 'Schicht ging eine Stunde laenger.', zeiteintragId,
      }));

    expect(ausgleich.kontoId).toBe(mai.id);
    expect(ausgleich.monat).toBe(5);
    // Der Verweis zurueck — er macht „die Differenz ist angekommen" beweisbar.
    expect(ausgleich.ausgleichFuerKontoId).toBe(kontoId);

    /**
     * Und erst jetzt laesst sich die Korrektur am Eintrag aufschreiben:
     * `zk_sperre_ausgleich` (0036) verlangt die Gegenbuchung, und sie ist
     * genau die eben gebuchte.
     */
    await alsApp(sitzung(b), async (tx) => korrigiereZeiteintrag(
      kontextAus(tx, f.reinigung, b.planer),
      {
        zeiteintragId, art: 'zeit_korrektur', grundKategorie: 'einwand_mitarbeiter',
        begruendung: 'Schicht ging eine Stunde laenger.', durchgefuehrtVon: b.planer,
        endeZeitpunkt: new Date('2026-03-05T15:00:00Z'),
        ausgleichBewegungId: ausgleich.bewegungId,
      }));

    // Der Maerz ist Byte fuer Byte derselbe geblieben.
    expect(await kontoAbbild(kontoId)).toBe(abbild);

    const maiDanach = await alsApp(sitzung(b), async (tx) => leseKonten(
      kontextAus(tx, f.reinigung, b.planer),
      { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 5 }));
    expect(maiDanach[0]?.istMinuten).toBe(60);
    expect(maiDanach[0]?.korrekturMinuten).toBe(60);

    const bewegungen = await alsApp(sitzung(b), async (tx) => leseBewegungen(
      kontextAus(tx, f.reinigung, b.planer), mai.id));
    expect(bewegungen).toHaveLength(1);
    expect(bewegungen[0]?.art).toBe('korrektur');
    expect(bewegungen[0]?.korrekturFuerStundenkontoId).toBe(kontoId);
  });

  it('ohne Gegenbuchung entsteht die Korrektur gar nicht', async () => {
    const { b, zeiteintragId } = await maerzSperren();
    /**
     * Der Fall, den `z_monat_sperren` erst moeglich macht: ohne den
     * Sperrstempel auf dem Zeiteintrag griffe `zk_sperre_ausgleich` nie, und
     * diese Korrektur ginge geraeuschlos durch — mit einer Differenz, die
     * nirgends ankommt.
     */
    await expect(alsApp(sitzung(b), async (tx) => korrigiereZeiteintrag(
      kontextAus(tx, f.reinigung, b.planer),
      {
        zeiteintragId, art: 'zeit_korrektur', grundKategorie: 'einwand_mitarbeiter',
        begruendung: 'Ohne Ausgleich.', durchgefuehrtVon: b.planer,
        endeZeitpunkt: new Date('2026-03-05T15:00:00Z'),
      },
    ))).rejects.toThrow(/gesperrt/iu);
  });

  it('ohne `zeit.konto_korrigieren` gibt es keine Korrekturbuchung', async () => {
    const { b } = await maerzSperren();
    await alsApp(sitzung(b), async (tx) => eroeffneKonto(
      kontextAus(tx, f.reinigung, b.planer),
      { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 5 }));

    // `leitung` haelt `zeit.schreiben`, aber nicht `zeit.konto_korrigieren`:
    // ueber den Lohn eines abgeschlossenen Monats entscheidet nicht jeder,
    // der Zeiten erfassen darf.
    await expect(alsApp(sitzung(b), async (tx) => bucheKorrektur(
      kontextAus(tx, f.reinigung, b.planer),
      {
        anstellungId: f.fatimaReinigung, jahr: 2026, monat: 3, minuten: 60,
        begruendung: 'Ohne Recht.',
      },
    ))).rejects.toThrow(/row-level security|policy/iu);
  });
});

// ---------------------------------------------------------------------------

describe('(2) zwei Beschaeftigungen, zwei Konten, eine gerechnete Anzeige (EMP-15)', () => {
  it('ein Mensch, zwei Gesellschaften, zwei Zeilen — und keine dritte', async () => {
    const rein = await planer(f.reinigung);
    const sec = await planer(f.security);

    await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-04-06T06:00:00Z', bis: '2026-04-06T14:00:00Z', freigebenDurch: rein.planer });
    await baueZeiteintrag({
      mandant: f.security, anstellung: f.fatimaSecurity, person: f.fatima,
      von: '2026-04-07T18:00:00Z', bis: '2026-04-07T22:00:00Z', freigebenDurch: sec.planer });

    for (const [b, anstellung, soll] of [
      [rein, f.fatimaReinigung, 400], [sec, f.fatimaSecurity, 300],
    ] as const) {
      await alsApp(sitzung(b), async (tx) => {
        const k = kontextAus(tx, b.mandant, b.planer);
        await eroeffneKonto(k, { anstellungId: anstellung, jahr: 2026, monat: 4,
          sollMinuten: soll });
        return bucheFreigegebeneZeiten(k, { anstellungId: anstellung, jahr: 2026, monat: 4 });
      });
    }

    /**
     * Gelesen wird in der PERSONENANSICHT. In Mandanten-Scope lieferte
     * dieselbe Abfrage eine der beiden Gesellschaften — ohne Fehler und ohne
     * Hinweis (K-18). Genau das ist der Unterschied, den EMP-15 braucht.
     */
    const konten = await alsApp(
      {
        scope: 'person', mandantIds: [f.reinigung, f.security],
        personId: f.fatima, benutzerId: rein.planer, portal: 'mitarbeiter',
      },
      async (tx) => leseKonten(
        personKontextAus(tx, rein.planer, [f.reinigung, f.security]),
        { personId: f.fatima, jahr: 2026, monat: 4 }),
    );

    expect(konten).toHaveLength(2);
    expect(new Set(konten.map((k) => k.mandantId))).toEqual(new Set([f.reinigung, f.security]));
    expect(konten.map((k) => k.istMinuten).sort((x, y) => x - y)).toEqual([240, 480]);

    const zusammen = kombiniereKonten(konten);
    expect(zusammen.istMinuten).toBe(720);
    expect(zusammen.sollMinuten).toBe(700);
    expect(zusammen.saldoMinuten).toBe(20);
    // Die Einzelkonten bleiben getrennt — EMP-15 verlangt beides.
    expect(zusammen.konten).toHaveLength(2);
  });

  it('und die Gesamtsumme hat gar keinen Traeger in der Datenbank', async () => {
    /**
     * „Wird fuer die Anzeige gerechnet und nie gespeichert" laesst sich nicht
     * dadurch pruefen, dass man nicht hinsieht. Geprueft wird die einzige
     * Eigenschaft, die es strukturell unmoeglich macht: es gibt keine Zeile
     * ueber einen MENSCHEN, nur ueber Beschaeftigungen — `stundenkonto` traegt
     * `anstellung_id NOT NULL` und keine `person_id`.
     */
    const spalten = await sql.unsafe<{ column_name: string; is_nullable: string }[]>(
      `select column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'stundenkonto'`);
    const namen = spalten.map((s) => s.column_name);
    expect(namen).toContain('anstellung_id');
    expect(namen).not.toContain('person_id');
    expect(spalten.find((s) => s.column_name === 'anstellung_id')?.is_nullable).toBe('NO');

    /**
     * Und keine Geldspalte (§1.5, EMP-13): die Saetze der beiden
     * Beschaeftigungen sind verschieden, und sie stehen an der `anstellung`
     * hinter dem Spalten-GRANT von K-05 — nicht hier.
     */
    expect(namen.filter((n) => /betrag|preis|satz|entgelt|lohn|cent/u.test(n))).toEqual([]);
    const [saetze] = await sql.unsafe<{ verschieden: boolean }[]>(
      `select (select stundensatz_intern from anstellung where id = $1)
              <> (select stundensatz_intern from anstellung where id = $2) as verschieden`,
      [f.fatimaReinigung, f.fatimaSecurity]);
    expect(saetze!.verschieden).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('(3) der Vortrag ueber zwoelf Monate stimmt auf die Minute', () => {
  it('jeder Monat traegt den Saldo des vorigen, und der zwoelfte die Summe', async () => {
    const b = await planer(f.reinigung);
    const SOLL = 480;

    let vortrag = 0;
    const salden: number[] = [];
    for (let monat = 1; monat <= 12; monat += 1) {
      const mm = String(monat).padStart(2, '0');
      // Ist = 480 + Monat: der Saldo waechst jeden Monat um eine andere Zahl,
      // damit ein „ungefaehr richtiger" Vortrag auffaellt.
      const minuten = SOLL + monat;
      const bis = new Date(Date.parse(`2026-${mm}-05T06:00:00Z`) + minuten * 60_000);
      await baueZeiteintrag({
        mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
        von: `2026-${mm}-05T06:00:00Z`, bis: bis.toISOString(), freigebenDurch: b.planer });

      const vortragDiesesMonats = vortrag;
      const abschluss = await alsApp(sitzung(b), async (tx) => {
        const k = kontextAus(tx, f.reinigung, b.planer);
        await eroeffneKonto(k, {
          anstellungId: f.fatimaReinigung, jahr: 2026, monat,
          sollMinuten: SOLL, saldoVortragMinuten: vortragDiesesMonats,
        });
        return schliesseMonatAb(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat });
      });

      expect(abschluss.istMinuten).toBe(minuten);
      expect(abschluss.saldoMinuten).toBe(saldoMinuten(vortrag, minuten, SOLL));
      salden.push(abschluss.saldoMinuten);
      vortrag = abschluss.saldoMinuten;
    }

    // 1 + 2 + … + 12 = 78, exakt und ohne Rundung.
    expect(salden[11]).toBe(78);
    expect(salden).toEqual([1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78]);

    const konten = await alsApp(sitzung(b), async (tx) => leseKonten(
      kontextAus(tx, f.reinigung, b.planer), { anstellungId: f.fatimaReinigung, jahr: 2026 }));
    expect(konten).toHaveLength(12);
    // Der Vortrag jedes Monats IST der Saldo des vorigen — keine Naeherung.
    for (const [i, k] of konten.entries()) {
      expect(k.saldoVortragMinuten, `Monat ${String(k.monat)}`)
        .toBe(i === 0 ? 0 : salden[i - 1]);
    }
    const summeIst = konten.reduce((s, k) => s + k.istMinuten, 0);
    const summeSoll = konten.reduce((s, k) => s + k.sollMinuten, 0);
    expect(konten[11]?.saldoMinuten).toBe(summeIst - summeSoll);
  });
});

// ---------------------------------------------------------------------------

describe('(4) die Schicht ueber die Monatsgrenze wird nach tatsaechlichen Minuten geteilt', () => {
  it('31.10. 22:00 → 01.11. 06:00 bucht 112 und 338 Minuten — zusammen 450', async () => {
    const b = await planer(f.reinigung);
    const id = await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: OKT_NOV.von, bis: OKT_NOV.bis, pause: 30, freigebenDurch: b.planer });

    const ergebnis = await alsApp(sitzung(b), async (tx) => {
      const k = kontextAus(tx, f.reinigung, b.planer);
      const gebucht: Record<number, number> = {};
      for (const monat of [10, 11]) {
        await eroeffneKonto(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat });
        gebucht[monat] = (await bucheFreigegebeneZeiten(
          k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat })).minuten;
      }
      return gebucht;
    });

    /**
     * Brutto 120/360 (die Grenze ist 23:00Z, nicht UTC-Mitternacht — sonst
     * stuende hier 180/300). Die Pause von 30 Minuten wird nach groesstem Rest
     * verteilt: 7,5 und 22,5 werden 8 und 22, nie zweimal gerundet. Netto also
     * 112 und 338.
     */
    expect(ergebnis[10]).toBe(112);
    expect(ergebnis[11]).toBe(338);
    // Und zusammen genau die aufgezeichnete Nettodauer — keine Minute
    // erfunden, keine verloren.
    const [z] = await sql.unsafe<{ netto: number }[]>(
      `select dauer_netto_minuten as netto from zeiteintrag where id = $1`, [id]);
    expect(ergebnis[10]! + ergebnis[11]!).toBe(Number(z!.netto));
    expect(Number(z!.netto)).toBe(450);
  });

  it('ein zweiter Buchungslauf verdoppelt nichts', async () => {
    const b = await planer(f.reinigung);
    await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-10-12T05:00:00Z', bis: '2026-10-12T09:00:00Z', freigebenDurch: b.planer });

    const [erst, zweit] = await alsApp(sitzung(b), async (tx) => {
      const k = kontextAus(tx, f.reinigung, b.planer);
      await eroeffneKonto(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 10 });
      const a = await bucheFreigegebeneZeiten(
        k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 10 });
      const c = await bucheFreigegebeneZeiten(
        k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 10 });
      return [a, c];
    });

    expect(erst!.gebucht).toBe(1);
    // Der zweite Lauf findet dieselbe Zeile — und schreibt sie nicht noch
    // einmal. Ohne `bewegung_arbeitszeit_uk` stuenden hier 480 Minuten zu viel,
    // und die Zahl saehe plausibel aus.
    expect(zweit!.gebucht).toBe(0);
    expect(zweit!.bereitsGebucht).toBe(1);

    const konten = await alsApp(sitzung(b), async (tx) => leseKonten(
      kontextAus(tx, f.reinigung, b.planer),
      { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 10 }));
    expect(konten[0]?.istMinuten).toBe(240);
  });
});

// ---------------------------------------------------------------------------

describe('(EMP-04) es fliesst nur, was freigegeben ist', () => {
  it('eine unfreigegebene Zeit wird nicht gebucht — und blockiert den Abschluss', async () => {
    const b = await planer(f.reinigung);
    await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-06-08T06:00:00Z', bis: '2026-06-08T14:00:00Z', freigebenDurch: b.planer });
    await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-06-09T06:00:00Z', bis: '2026-06-09T14:00:00Z', freigebenDurch: null });

    const gebucht = await alsApp(sitzung(b), async (tx) => {
      const k = kontextAus(tx, f.reinigung, b.planer);
      await eroeffneKonto(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 6 });
      return bucheFreigegebeneZeiten(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 6 });
    });
    // Nur die eine Schicht. Ohne den Filter liefe ungeprueft Erfasstes in den
    // Lohn, und die Freigabe waere ein Bildschirm ohne Wirkung.
    expect(gebucht.gebucht).toBe(1);
    expect(gebucht.minuten).toBe(480);

    /**
     * Und der Abschluss verweigert: nach der Sperre liesse sich die zweite
     * Schicht nie mehr buchen. Ihre Minuten waeren aus dem Lohnmonat
     * verschwunden — ohne Fehler, mit einer plausiblen Zahl auf dem Nachweis.
     */
    await expect(alsApp(sitzung(b), async (tx) => schliesseMonatAb(
      kontextAus(tx, f.reinigung, b.planer),
      { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 6 },
    ))).rejects.toThrow(UnfreigegebeneZeitenFehler);
  });
});

// ---------------------------------------------------------------------------

describe('(Reparatur) eine reine Pausenkorrektur laesst sich aufschreiben', () => {
  it('nur die Pause zu berichtigen erzeugt eine Fassung — vorher ging das nicht', async () => {
    const b = await planer(f.reinigung);
    const id = await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-07-06T06:00:00Z', bis: '2026-07-06T14:00:00Z', pause: 30,
      freigebenDurch: b.planer });

    /**
     * Der Fall, der vor 0062 an `z_anspruch_je_ereignis` scheiterte:
     * `korrigiereZeiteintrag` setzt jede Ersatzfassung auf
     * `quelle_* = 'planer_entscheidung'` und damit `nacherfasst`, und die
     * Bedingung verlangte dann einen behaupteten ZEITPUNKT — den eine
     * Pausenkorrektur nicht hat. Der haeufigste Einwand ueberhaupt
     * (`einwand_art = 'pause_falsch'`) endete damit im Nichts.
     */
    const ergebnis = await alsApp(sitzung(b), async (tx) => korrigiereZeiteintrag(
      kontextAus(tx, f.reinigung, b.planer),
      {
        zeiteintragId: id, art: 'pause_korrektur', grundKategorie: 'einwand_mitarbeiter',
        begruendung: 'Die Pause war eine Stunde, nicht eine halbe.',
        durchgefuehrtVon: b.planer, pauseMinuten: 60,
      }));

    const [neu] = await sql.unsafe<{
      pause: number; netto: number; version: number;
      behauptet_beginn: Date | null; behauptet_ende: Date | null;
    }[]>(
      `select pause_minuten as pause, dauer_netto_minuten as netto, version,
              behauptet_beginn, behauptet_ende
         from zeiteintrag where id = $1`, [ergebnis.neueFassungId]);
    expect(Number(neu!.pause)).toBe(60);
    // Die Nettodauer folgt daraus — und sie ist es, die auf das Konto geht.
    expect(Number(neu!.netto)).toBe(420);
    expect(Number(neu!.version)).toBe(2);
    // Kein behaupteter Zeitpunkt: es gibt keinen. Der Beleg ist die
    // Korrekturzeile, und die ist staerker als eine Spalte.
    expect(neu!.behauptet_beginn).toBeNull();
    expect(neu!.behauptet_ende).toBeNull();

    const [spur] = await sql.unsafe<{ art: string; ersatz: string }[]>(
      `select art, ersatz_zeiteintrag_id as ersatz from zeiteintrag_korrektur
        where ursprung_zeiteintrag_id = $1`, [id]);
    expect(spur!.art).toBe('pause_korrektur');
    expect(spur!.ersatz).toBe(ergebnis.neueFassungId);
  });

  it('eine ERSTFASSUNG ohne Behauptung bleibt verboten', async () => {
    /**
     * Die Bedingung wurde geweitet, nicht abgeschafft. Ein nacherfasster
     * Datensatz, der KEINE Fassung abloest, muss weiterhin sagen, was
     * behauptet wurde — genau dafuer wurde sie geschrieben (TIM-09).
     */
    await expect(sql.unsafe(
      `insert into zeiteintrag
         (mandant_id, anstellung_id, person_id, beginn_zeitpunkt, ende_zeitpunkt,
          erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
          nacherfasst, status, erstellt_von_art)
       values ($1,$2,$3,'2026-07-07T06:00:00Z','2026-07-07T14:00:00Z',
               'nacherfassung','nacherfassung','planer_entscheidung',
               'planer_entscheidung', true, 'abgeschlossen','system')`,
      [f.reinigung, f.fatimaReinigung, f.fatima] as never[]))
      .rejects.toThrow(/z_anspruch_je_ereignis/u);
  });
});

// ---------------------------------------------------------------------------

describe('(Abgleich) das Konto ist die Summe seines Journals — und meldet, wenn nicht', () => {
  it('eine Summe, die das Journal nicht hergibt, wird abgewiesen', async () => {
    const b = await planer(f.reinigung);
    const konten = await alsApp(sitzung(b), async (tx) => {
      const k = kontextAus(tx, f.reinigung, b.planer);
      await eroeffneKonto(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 8 });
      return leseKonten(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 8 });
    });
    const kontoId = konten[0]!.id;

    // Nicht „wird stillschweigend korrigiert" — abgewiesen. Eine Abweichung,
    // die verschwindet, gibt keine Auskunft mehr.
    await expect(sql.unsafe(
      `update stundenkonto set ist_minuten = 999 where id = $1`, [kontoId]))
      .rejects.toThrow(/Journal/u);
  });

  it('und eine Drift am Ausloeser vorbei wird GEMELDET, nicht geheilt', async () => {
    const b = await planer(f.reinigung);
    await baueZeiteintrag({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima,
      von: '2026-09-07T06:00:00Z', bis: '2026-09-07T14:00:00Z', freigebenDurch: b.planer });
    const kontoId = await alsApp(sitzung(b), async (tx) => {
      const k = kontextAus(tx, f.reinigung, b.planer);
      const konto2 = await eroeffneKonto(
        k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 9 });
      await bucheFreigegebeneZeiten(k, { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 9 });
      return konto2.id;
    });

    // Was ein Wartungszugang oder eine kuenftige Migration anrichten kann:
    // `session_replication_role = replica` stellt jeden Ausloeser ab.
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(`update stundenkonto set ist_minuten = 300 where id = $1`, [kontoId]);
    });

    const befunde = await alsApp(sitzung(b), async (tx) => pruefeAbgleich(
      kontextAus(tx, f.reinigung, b.planer), { anstellungId: f.fatimaReinigung }));
    expect(befunde).toHaveLength(1);
    expect(befunde[0]?.kontoId).toBe(kontoId);
    expect(befunde[0]?.istMinutenKonto).toBe(300);
    expect(befunde[0]?.istMinutenJournal).toBe(480);

    // Und der Lauf hat nichts geradegezogen: der Befund steht noch.
    const [danach] = await sql.unsafe<{ ist: number }[]>(
      `select ist_minuten as ist from stundenkonto where id = $1`, [kontoId]);
    expect(Number(danach!.ist)).toBe(300);
  });
});

// ---------------------------------------------------------------------------

describe('(EMP-05) der Urlaubsanspruch wird eingetragen, nicht geraten', () => {
  it('ein neues Konto steht auf 0 — und sagt, dass das keine Auskunft ist', async () => {
    const b = await planer(f.reinigung);
    const konto3 = await alsApp(sitzung(b), async (tx) => eroeffneUrlaubskonto(
      kontextAus(tx, f.reinigung, b.planer), { anstellungId: f.fatimaReinigung, jahr: 2026 }));

    expect(konto3.anspruchTage).toBe(NULL_MENGE);
    expect(konto3.restTage).toBe(NULL_MENGE);
    // Der Unterschied, auf den es ankommt: „nicht hinterlegt" ist keine Null.
    expect(konto3.anspruchOffen).toBe(true);
    expect(konto3.uebertragVerfaelltAm).toBeNull();
  });

  it('eingetragene Tage rechnen exakt — halbe Tage inklusive', async () => {
    const b = await planer(f.reinigung);
    const konto4 = await alsApp(sitzung(b), async (tx) => {
      const k = kontextAus(tx, f.reinigung, b.planer);
      await eroeffneUrlaubskonto(k, {
        anstellungId: f.fatimaReinigung, jahr: 2026,
        anspruchTage: milliMenge(28_000n), uebertragTage: milliMenge(2_500n),
        uebertragVerfaelltAm: '2026-03-31',
      });
      return leseUrlaubskonten(k, { anstellungId: f.fatimaReinigung, jahr: 2026 });
    });
    expect(konto4[0]?.anspruchTage).toBe(28_000n);
    // 28 + 2,5 = 30,5 — in Tausendsteln, nie als Fliesskommawert.
    expect(konto4[0]?.restTage).toBe(30_500n);
    expect(konto4[0]?.anspruchOffen).toBe(false);
    expect(konto4[0]?.uebertragVerfaelltAm).toBe('2026-03-31');
  });

  it('genommene Tage lassen sich nicht von Hand buchen', async () => {
    const b = await planer(f.reinigung);
    await alsApp(sitzung(b), async (tx) => eroeffneUrlaubskonto(
      kontextAus(tx, f.reinigung, b.planer), { anstellungId: f.fatimaReinigung, jahr: 2026 }));
    // Sie folgen aus genehmigten Abwesenheiten (PR 38). Ein Resturlaub, zu dem
    // sich keine Abwesenheit finden laesst, ist im Streit die schlechtere
    // Haelfte.
    await expect(sql.unsafe(
      `update urlaubskonto set genommen_tage = 5 where anstellung_id = $1`,
      [f.fatimaReinigung])).rejects.toThrow(/Abwesenheiten/u);
  });
});

// ---------------------------------------------------------------------------

describe('(Mandantentrennung) das Konto der einen Gesellschaft ist in der anderen unsichtbar',
  () => {
    it('und der erste offene Monat wird je Beschaeftigung gesucht', async () => {
      const rein = await planer(f.reinigung);
      const sec = await planer(f.security);
      await alsApp(sitzung(rein), async (tx) => eroeffneKonto(
        kontextAus(tx, f.reinigung, rein.planer),
        { anstellungId: f.fatimaReinigung, jahr: 2026, monat: 2 }));

      const fremd = await alsApp(sitzung(sec), async (tx) => leseKonten(
        kontextAus(tx, f.security, sec.planer), { personId: f.fatima }));
      expect(fremd).toEqual([]);

      const eigener = await alsApp(sitzung(rein), async (tx) => ersterOffenerMonat(
        kontextAus(tx, f.reinigung, rein.planer), f.fatimaReinigung, 2026, 1));
      expect(eigener.monat).toBe(2);
    });
  });
