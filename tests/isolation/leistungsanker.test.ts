/**
 * Zeit aus neu geplanten Schichten erreicht die Abrechnung (V-191, TIM-12,
 * FIN-07).
 *
 * **Der Befund.** Ein Zeiteintrag erbt `auftrag_leistung_id` beim Anlegen
 * ausschliesslich von seiner Schicht (`z_erben`, 0034), und die Schicht
 * bekommt sie vom Träger oder beim Anlegen. Weder die Einzelschicht noch die
 * Turnus- noch die Posten-Anlage schrieben eine; nur der Seed tat es. Jede
 * Stunde aus einer über die Oberfläche geplanten Schicht landete dauerhaft in
 * `zeiteintrag_ohne_auftrag`.
 *
 * Geprüft wird gegen die echte Datenbank, unter der RLS der Planung:
 * Einzelschicht (anlegen, nachtragen, ändern, lösen), Turnus (anlegen,
 * ändern — der Generator trägt den Anker auf die künftigen Schichten ohne
 * erfasste Zeit), Posten (anlegen, ändern).
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  SchichtFehler, legeEinzelschichtAn, setzeLeistungsanker,
} from '../../src/server/services/dienstplan/einzelschicht.js';
import {
  ANKERBARE_AUFTRAGSZUSTAENDE, LeistungsankerFehler, listeAnkerbareLeistungen, pruefeLeistungsanker,
} from '../../src/server/services/dienstplan/leistungsanker.js';
import { legePlanungsserieAn, legeTurnusSerieAn } from '../../src/server/services/dienstplan/serie.js';
import {
  SeriePflegeFehler, aendereTurnus,
} from '../../src/server/services/dienstplan/serie-pflege.js';
import {
  legePostenAn, PostenArchiviert, PostenNichtGefunden, setzePostenLeistung,
} from '../../src/server/services/security/posten.js';
import { listeMitAuftrag, listeOhneAuftrag } from '../../src/server/services/zeit/auftrag.js';

let f: Fixtur;
let admin = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(mandant: string, rolle = 'admin'): Promise<string> {
  const email = `anker-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,(select id from rolle where schluessel = $3 and mandant_id is null),true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

function imKontext<T>(
  fn: (k: LeseKontext & SchreibKontext) => Promise<T>, wer = admin, mandant = f.reinigung,
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant' as const, mandantId: mandant, benutzerId: wer,
      portal: 'intern' as const, readonly: false,
    },
    async (tx: postgres.TransactionSql) => {
      const fuehre = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: wer,
        aktiverMandantId: mandant, mandantIds: [mandant],
        abfrage: fuehre, schreibe: fuehre,
      } satisfies LeseKontext & SchreibKontext);
    },
  ) as Promise<T>;
}

/** Kunde, Objekt, zwei Aufträge mit je einer Leistungszeile, eine davon beendet. */
interface Aufbau {
  readonly objekt: string;
  readonly auftragA: string; readonly zeileA: string;
  readonly auftragB: string; readonly zeileB: string;
  readonly beendet: string;
}

async function baue(mandant: string, verantwortlich = admin): Promise<Aufbau> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1,$2,'Ankerkunde') returning id`,
    [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Ankerobjekt','Teststr. 3','10115','Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  const auftrag = async (): Promise<string> => {
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                            bezeichnung, verantwortlich_benutzer_id, start_datum)
       values ($1,$2,$3,$4,'rahmenvertrag','aktiv','Unterhaltsreinigung',$5,'2026-01-01')
       returning id`,
      [mandant, `AU-${zufall()}`, k!.id, o!.id, verantwortlich] as never[]);
    return a!.id;
  };
  const zeile = async (auftragId: string, nr: number, bis: string | null): Promise<string> => {
    const [l] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, objekt_id,
                                     bezeichnung, menge, einheit, einzelpreis_cent,
                                     steuersatz_bp, gueltig_ab, gueltig_bis)
       values ($1,$2,$3,$4,'Unterhaltsreinigung',1,'Stunde',3200,1900,'2026-01-01',$5::date)
       returning id`,
      [mandant, auftragId, nr, o!.id, bis] as never[]);
    return l!.id;
  };
  const auftragA = await auftrag();
  const auftragB = await auftrag();
  return {
    objekt: o!.id,
    auftragA, zeileA: await zeile(auftragA, 1, null),
    auftragB, zeileB: await zeile(auftragB, 1, null),
    beendet: await zeile(auftragA, 2, '2026-01-31'),
  };
}

async function einsatzZeile(id: string): Promise<{ auftrag: string | null; anker: string | null }> {
  const [z] = await sql.unsafe<{ auftrag: string | null; anker: string | null }[]>(
    `select auftrag_id as auftrag, auftrag_leistung_id as anker from einsatz where id = $1`, [id]);
  return z!;
}

/** Ein abgeschlossener Zeiteintrag auf einer Schicht — OHNE eigene Leistungszeile. */
async function zeitAuf(einsatz: string, von: string, bis: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, einsatz_id,
        beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
        erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
        status, erstellt_von_art)
     values ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,0,
             'import','import','import','import','abgeschlossen','system')
     returning id`,
    [f.reinigung, f.jonasReinigung, f.jonas, einsatz, von, bis] as never[]);
  return z!.id;
}

async function grund(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (fehler) {
    if (fehler instanceof SchichtFehler || fehler instanceof LeistungsankerFehler
      || fehler instanceof SeriePflegeFehler) {
      return fehler.grund;
    }
    throw fehler;
  }
}

const tagePlus = async (n: number): Promise<string> => {
  const [z] = await sql.unsafe<{ t: string }[]>(
    `select to_char(app.berlin_heute() + $1::int, 'YYYY-MM-DD') as t`, [n]);
  return z!.t;
};

const EINZEL = {
  planDatum: '2026-10-12', beginnLokal: '06:00', endeLokal: '10:00',
  endetAmFolgetag: false, sollBesetzung: 1, minBesetzung: 1,
} as const;

beforeAll(async () => {
  f = await seed();
  admin = await konto(f.reinigung);
});
afterAll(schliessen);

describe('(1) Einzelschicht: die Zeit auf ihr erreicht die Abrechnung', () => {
  it('mit Leistungszeile angelegt — der Zeiteintrag erbt sie und steht im Auftrag', async () => {
    const bau = await baue(f.reinigung);
    const { einsatzId } = await imKontext((k) => legeEinzelschichtAn(k, {
      ...EINZEL, objektId: bau.objekt, auftragLeistungId: bau.zeileA,
    }));
    // Nur die Zeile genannt: der Auftrag folgt aus ihr (0050).
    expect(await einsatzZeile(einsatzId)).toEqual({ auftrag: bau.auftragA, anker: bau.zeileA });

    const zeit = await zeitAuf(einsatzId, '2026-10-12T04:00:00Z', '2026-10-12T08:00:00Z');
    const [mit, ohne] = await imKontext(async (k) => [
      await listeMitAuftrag(k), await listeOhneAuftrag(k),
    ] as const);
    const treffer = mit.filter((z) => z.zeiteintragId === zeit);
    expect(treffer).toHaveLength(1);
    expect(treffer[0]?.auftragLeistungId).toBe(bau.zeileA);
    expect(ohne.map((z) => z.zeiteintragId)).not.toContain(zeit);
  });

  it('VORHER: nur mit Auftrag angelegt — die Zeit steht ohne Auftrag (die Zusage stimmt nicht mehr)', async () => {
    const bau = await baue(f.reinigung);
    const { einsatzId } = await imKontext((k) => legeEinzelschichtAn(k, {
      ...EINZEL, objektId: bau.objekt, auftragId: bau.auftragA,
    }));
    const zeit = await zeitAuf(einsatzId, '2026-10-12T04:00:00Z', '2026-10-12T08:00:00Z');
    const ohne = await imKontext((k) => listeOhneAuftrag(k));
    expect(ohne.map((z) => z.zeiteintragId)).toContain(zeit);
  });

  it('eine fremde, beendete oder unbekannte Zeile wird mit Grund abgewiesen — und nichts geschrieben', async () => {
    const bau = await baue(f.reinigung);
    const vorher = await sql.unsafe<{ n: string }[]>(`select count(*)::text as n from einsatz`);
    expect(await grund(() => imKontext((k) => legeEinzelschichtAn(k, {
      ...EINZEL, objektId: bau.objekt, auftragId: bau.auftragB, auftragLeistungId: bau.zeileA,
    })))).toBe('leistung_anderer_auftrag');
    expect(await grund(() => imKontext((k) => legeEinzelschichtAn(k, {
      ...EINZEL, objektId: bau.objekt, auftragLeistungId: bau.beendet,
    })))).toBe('leistung_beendet');
    expect(await grund(() => imKontext((k) => legeEinzelschichtAn(k, {
      ...EINZEL, objektId: bau.objekt, auftragLeistungId: 'keine-kennung',
    })))).toBe('leistung_unbekannt');
    const nachher = await sql.unsafe<{ n: string }[]>(`select count(*)::text as n from einsatz`);
    expect(nachher[0]?.n).toBe(vorher[0]?.n);
  });

  it('ohne `auftrag.lesen` sieht die Planung keine Zeile — und kann keine setzen', async () => {
    const bau = await baue(f.reinigung);
    const ohneRecht = await konto(f.reinigung, 'mitarbeiter');
    const liste = await imKontext((k) => listeAnkerbareLeistungen(k), ohneRecht);
    expect(liste).toEqual([]);
    expect(await grund(() => imKontext((k) => pruefeLeistungsanker(k, bau.zeileA), ohneRecht)))
      .toBe('leistung_unbekannt');
    // Mit dem Recht: die lebenden Zeilen, die beendete nur als bisheriger Anker.
    const sichtbar = await imKontext((k) => listeAnkerbareLeistungen(k));
    expect(sichtbar.map((l) => l.id)).toEqual(expect.arrayContaining([bau.zeileA, bau.zeileB]));
    expect(sichtbar.map((l) => l.id)).not.toContain(bau.beendet);
    const mitBisher = await imKontext((k) => listeAnkerbareLeistungen(k, bau.beendet));
    expect(mitBisher.find((l) => l.id === bau.beendet)?.lebt).toBe(false);
  });
});

describe('(2) die Leistungszeile einer Einzelschicht nachtragen, ändern, lösen', () => {
  it('nachtragen leitet den Auftrag ab; ändern nimmt den neuen mit; lösen nimmt den abgeleiteten mit (V-192)', async () => {
    const bau = await baue(f.reinigung);
    const { einsatzId } = await imKontext((k) => legeEinzelschichtAn(k, {
      ...EINZEL, objektId: bau.objekt,
    }));
    await imKontext((k) => setzeLeistungsanker(k, einsatzId, bau.zeileA));
    expect(await einsatzZeile(einsatzId)).toEqual({ auftrag: bau.auftragA, anker: bau.zeileA });
    // Der Auftrag stammte aus der Zeile — eine neue Zeile bringt ihren eigenen mit.
    await imKontext((k) => setzeLeistungsanker(k, einsatzId, bau.zeileB));
    expect(await einsatzZeile(einsatzId)).toEqual({ auftrag: bau.auftragB, anker: bau.zeileB });
    // Lösen nimmt den ABGELEITETEN Auftrag mit (0431) — vorher blieb er stehen …
    await imKontext((k) => setzeLeistungsanker(k, einsatzId, null));
    expect(await einsatzZeile(einsatzId)).toEqual({ auftrag: null, anker: null });
    // … und galt beim nächsten Setzen als genannt: die Zeile eines anderen
    // Auftrags wurde abgewiesen, obwohl ihn nie ein Mensch genannt hatte.
    await imKontext((k) => setzeLeistungsanker(k, einsatzId, bau.zeileA));
    expect(await einsatzZeile(einsatzId)).toEqual({ auftrag: bau.auftragA, anker: bau.zeileA });
  });

  it('ein von Hand genannter Auftrag bleibt: die Zeile muss zu ihm gehören — auch nach dem Lösen', async () => {
    const bau = await baue(f.reinigung);
    const { einsatzId } = await imKontext((k) => legeEinzelschichtAn(k, {
      ...EINZEL, objektId: bau.objekt, auftragId: bau.auftragA,
    }));
    const [herkunft] = await sql.unsafe<{ von_hand: boolean }[]>(
      `select auftrag_von_hand as von_hand from einsatz where id = $1`, [einsatzId]);
    expect(herkunft?.von_hand).toBe(true);
    expect(await grund(() => imKontext((k) => setzeLeistungsanker(k, einsatzId, bau.zeileB))))
      .toBe('leistung_anderer_auftrag');
    await imKontext((k) => setzeLeistungsanker(k, einsatzId, bau.zeileA));
    expect(await einsatzZeile(einsatzId)).toEqual({ auftrag: bau.auftragA, anker: bau.zeileA });
    // Lösen lässt den GENANNTEN Auftrag stehen, und er bindet weiter.
    await imKontext((k) => setzeLeistungsanker(k, einsatzId, null));
    expect(await einsatzZeile(einsatzId)).toEqual({ auftrag: bau.auftragA, anker: null });
    expect(await grund(() => imKontext((k) => setzeLeistungsanker(k, einsatzId, bau.zeileB))))
      .toBe('leistung_anderer_auftrag');
  });

  it('eine Schicht ohne genannten Auftrag trägt `auftrag_von_hand = false`, und „von Hand" heisst: mit Auftrag (0431)', async () => {
    const bau = await baue(f.reinigung);
    const { einsatzId } = await imKontext((k) => legeEinzelschichtAn(k, {
      ...EINZEL, objektId: bau.objekt, auftragLeistungId: bau.zeileA,
    }));
    const [z] = await sql.unsafe<{ von_hand: boolean }[]>(
      `select auftrag_von_hand as von_hand from einsatz where id = $1`, [einsatzId]);
    expect(z?.von_hand).toBe(false);
    await expect(sql.unsafe(
      `update einsatz set auftrag_leistung_id = null, auftrag_id = null, auftrag_von_hand = true
        where id = $1`, [einsatzId])).rejects.toThrow(/einsatz_auftrag_von_hand_hat_auftrag/u);
  });

  it('nach der ersten erfassten Stunde bleibt der Anker', async () => {
    const bau = await baue(f.reinigung);
    const { einsatzId } = await imKontext((k) => legeEinzelschichtAn(k, {
      ...EINZEL, objektId: bau.objekt, auftragLeistungId: bau.zeileA,
    }));
    await zeitAuf(einsatzId, '2026-10-12T04:00:00Z', '2026-10-12T08:00:00Z');
    expect(await grund(() => imKontext((k) => setzeLeistungsanker(k, einsatzId, bau.zeileB))))
      .toBe('leistung_hat_zeiten');
    expect(await einsatzZeile(einsatzId)).toEqual({ auftrag: bau.auftragA, anker: bau.zeileA });
  });
});

/** Revier und Katalogposition für einen Turnus. */
async function revierUndPosition(objekt: string): Promise<{ revier: string; position: string }> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into revier (mandant_id, objekt_id, bezeichnung, sollzeit_minuten, aktiv_ab,
                         erstellt_von_art, erstellt_von)
     values ($1,$2,'Revier Anker',120,'2020-01-01','mensch',$3) returning id`,
    [f.reinigung, objekt, admin]);
  const [kat] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, gueltig_ab)
     values ($1,$2,'Ankerkatalog','2020-01-01') returning id`, [f.reinigung, `kat-${zufall()}`]);
  const [pos] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog_position (mandant_id, katalog_id, oz, kurztext, einheit,
                                            gueltig_ab, zeitwert_minuten)
     values ($1,$2,'01.01','Unterhaltsreinigung','m2','2020-01-01',5) returning id`,
    [f.reinigung, kat!.id]);
  return { revier: r!.id, position: pos!.id };
}

async function schichtenDerSerie(serie: string): Promise<readonly {
  id: string; auftrag: string | null; anker: string | null; kuenftig: boolean;
}[]> {
  return sql.unsafe(
    `select id, auftrag_id as auftrag, auftrag_leistung_id as anker,
            (beginn_zeitpunkt > now()) as kuenftig
       from einsatz where planungsserie_id = $1 and storniert_am is null
      order by beginn_zeitpunkt`, [serie]);
}

describe('(3) Turnus: der Generator trägt den Anker auf die Schichten', () => {
  it('anlegen mit Zeile, ändern auf eine andere — künftige Schichten ohne Zeit folgen, die mit Zeit nicht', async () => {
    const bau = await baue(f.reinigung);
    const { revier, position } = await revierUndPosition(bau.objekt);
    const ergebnis = await imKontext(async (k) => legeTurnusSerieAn(k, {
      revierId: revier, leistungskatalogPositionId: position, bezeichnung: 'Abendreinigung',
      wochentage: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'],
      beginnLokal: '18:00', dauerMinuten: 120, gueltigAb: await tagePlus(1),
      feiertagsregel: 'unveraendert', auftragLeistungId: bau.zeileA,
    }));
    const erste = await schichtenDerSerie(ergebnis.planungsserieId);
    expect(erste.length).toBeGreaterThan(3);
    for (const s of erste) expect(s).toMatchObject({ auftrag: bau.auftragA, anker: bau.zeileA });
    // Eine Serienschicht trägt den Anker ihres Trägers — geändert wird er dort.
    expect(await grund(() => imKontext((k) => setzeLeistungsanker(k, erste[1]!.id, bau.zeileB))))
      .toBe('nicht_manuell');

    // Auf der ersten Schicht ist schon Zeit erfasst — sie behält ihren Anker.
    const mitZeit = erste[0]!.id;
    await zeitAuf(mitZeit, '2026-10-12T16:00:00Z', '2026-10-12T18:00:00Z');

    // Ohne das Feld (keine Leserechte in der Maske) bleibt der Anker.
    await imKontext((k) => aendereTurnus(k, ergebnis.planungsserieId, { dauerMinuten: 150 }));
    for (const s of await schichtenDerSerie(ergebnis.planungsserieId)) {
      expect(s.anker).toBe(bau.zeileA);
    }

    await imKontext((k) => aendereTurnus(k, ergebnis.planungsserieId, {
      auftragLeistungId: bau.zeileB,
    }));
    const danach = await schichtenDerSerie(ergebnis.planungsserieId);
    expect(danach.find((s) => s.id === mitZeit)).toMatchObject({
      auftrag: bau.auftragA, anker: bau.zeileA,
    });
    for (const s of danach.filter((x) => x.id !== mitZeit)) {
      expect(s).toMatchObject({ auftrag: bau.auftragB, anker: bau.zeileB });
    }
    const [turnus] = await sql.unsafe<{ anker: string }[]>(
      `select t.auftrag_leistung_id as anker from turnus t
         join planungsserie ps on ps.turnus_id = t.id where ps.id = $1`,
      [ergebnis.planungsserieId]);
    expect(turnus?.anker).toBe(bau.zeileB);
  });

  it('eine beendete Zeile wird beim Ändern abgewiesen — mit dem Grund der Pflege', async () => {
    const bau = await baue(f.reinigung);
    const { revier, position } = await revierUndPosition(bau.objekt);
    const ergebnis = await imKontext(async (k) => legeTurnusSerieAn(k, {
      revierId: revier, leistungskatalogPositionId: position, bezeichnung: 'Frühreinigung',
      wochentage: ['MO'], beginnLokal: '06:00', dauerMinuten: 120,
      gueltigAb: await tagePlus(1), feiertagsregel: 'unveraendert',
    }));
    expect(await grund(() => imKontext((k) => aendereTurnus(k, ergebnis.planungsserieId, {
      auftragLeistungId: bau.beendet,
    })))).toBe('leistung_beendet');
  });
});

describe('(4) Posten: anlegen mit Zeile, später ändern', () => {
  it('die Schichten des Postens tragen den Anker, und das Lösen erreicht die künftigen', async () => {
    const adminS = await konto(f.security);
    const bau = await baue(f.security, adminS);
    const postenId = await imKontext(async (k) => {
      const id = await legePostenAn(k, {
        objektId: bau.objekt, bezeichnung: 'Pforte', minBesetzung: 1, sollBesetzung: 1,
        abdeckungRrule: 'FREQ=DAILY', dtstartLokal: `${await tagePlus(1)}T22:00`,
        dauerMinuten: 480, gueltigAb: await tagePlus(1), auftragLeistungId: bau.zeileA,
      });
      await legePlanungsserieAn(k, { quelle: 'posten', traegerId: id, feiertageUeberspringen: false });
      return id;
    }, adminS, f.security);
    const [serie] = await sql.unsafe<{ id: string }[]>(
      `select id from planungsserie where posten_id = $1`, [postenId]);
    const vorher = await schichtenDerSerie(serie!.id);
    expect(vorher.length).toBeGreaterThan(3);
    for (const s of vorher) expect(s).toMatchObject({ auftrag: bau.auftragA, anker: bau.zeileA });

    await imKontext((k) => setzePostenLeistung(k, postenId, bau.zeileB), adminS, f.security);
    for (const s of await schichtenDerSerie(serie!.id)) {
      expect(s).toMatchObject({ auftrag: bau.auftragB, anker: bau.zeileB });
    }
    await imKontext((k) => setzePostenLeistung(k, postenId, null), adminS, f.security);
    for (const s of await schichtenDerSerie(serie!.id)) {
      expect(s).toMatchObject({ auftrag: null, anker: null });
    }
  });
});

describe('(5) der bisherige Anker bleibt in der Auswahl — auch jenseits der Obergrenze (V-192)', () => {
  /**
   * Die erste Fassung kappte NACH dem `or al.id = bisher` mit `limit`. Bei
   * mehr lebenden Zeilen als der Obergrenze fiel der bisherige Anker aus der
   * Liste, die Maske wählte „ohne", und das nächste Speichern löste ihn.
   * Geprüft mit der Obergrenze 1, statt 300 Zeilen anzulegen — dieselbe Abfrage.
   */
  it('die gekappte Liste bringt die bisherige Zeile trotzdem mit — lebend oder beendet, und nur einmal', async () => {
    const bau = await baue(f.reinigung);
    // Ein Auftrag, der in der absteigenden Sortierung ganz hinten steht.
    const [alt] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                            bezeichnung, verantwortlich_benutzer_id, start_datum)
       select mandant_id, $2, kunde_id, id, 'rahmenvertrag', 'aktiv', 'Altvertrag', $3, '2020-01-01'
         from objekt where id = $1
       returning id`,
      [bau.objekt, `0000-ALT-${zufall()}`, admin] as never[]);
    const [altZeile] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, bezeichnung,
                                     steuersatz_bp, gueltig_ab)
       values ($1, $2, 1, 'Unterhaltsreinigung Altbau', 1900, '2020-01-01') returning id`,
      [f.reinigung, alt!.id]);

    const gekappt = await imKontext((k) => listeAnkerbareLeistungen(k, null, 1));
    expect(gekappt).toHaveLength(1);
    expect(gekappt.map((l) => l.id)).not.toContain(altZeile!.id);

    const mitBisher = await imKontext((k) => listeAnkerbareLeistungen(k, altZeile!.id, 1));
    expect(mitBisher).toHaveLength(2);
    expect(mitBisher.find((l) => l.id === altZeile!.id)).toMatchObject({
      lebt: true, auftragId: alt!.id,
    });

    // Ist die bisherige zugleich die erste der Liste, steht sie genau einmal da.
    const erste = gekappt[0]!.id;
    const einmal = await imKontext((k) => listeAnkerbareLeistungen(k, erste, 1));
    expect(einmal.map((l) => l.id)).toEqual([erste]);

    // Auch eine beendete bisherige kommt gekappt mit — als nicht lebend.
    const beendet = await imKontext((k) => listeAnkerbareLeistungen(k, bau.beendet, 1));
    expect(beendet).toHaveLength(2);
    expect(beendet.find((l) => l.id === bau.beendet)?.lebt).toBe(false);
  });
});

/**
 * Ein Konto mit GENAU diesen Rechten in der Gesellschaft — eine eigene Rolle,
 * wie sie eine Administration anlegen darf. Die Standardrollen halten
 * `dienstplan.schreiben` und `auftrag.lesen` zusammen; eine eigene nicht.
 */
async function eigeneRolle(mandant: string, rechte: readonly string[]): Promise<string> {
  const email = `anker-rolle-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, $2, 'mandant', 'intern') returning id`, [mandant, `planung_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = any($3::text[])`,
    [r!.id, mandant, [...rechte]]);
  // `gueltig_ab` auf gestern: der Berliner Tag gegen `current_date` (wie `kennzahlen-listen`).
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard, gueltig_ab)
     values ($1, $2, $3, true, current_date - 1)`, [u!.id, mandant, r!.id]);
  return u!.id;
}

describe('(6) die Ableitung des Auftrags braucht kein `auftrag.lesen` (V-192, 0430)', () => {
  /**
   * `kern.einsatz_auftrag_ableiten` las die Leistungszeile unter der RLS des
   * Aufrufers. Der Generator läuft nach jeder Pflege über ALLE Serien der
   * Gesellschaft, und sein Upsert feuert den Auslöser für jede vorgeschlagene
   * Zeile; ohne `auftrag.lesen` warf er 23503, sobald eine einzige Serie
   * verankert war — auch beim Ändern einer fremden, unverankerten.
   */
  it('eine Planung ohne Auftragsrecht ändert Serien neben einer verankerten — und neue Schichten bekommen ihren Auftrag', async () => {
    const bau = await baue(f.reinigung);
    const { revier, position } = await revierUndPosition(bau.objekt);
    const verankert = await imKontext(async (k) => legeTurnusSerieAn(k, {
      revierId: revier, leistungskatalogPositionId: position, bezeichnung: 'Verankert',
      wochentage: ['MO'], beginnLokal: '18:00', dauerMinuten: 120,
      gueltigAb: await tagePlus(1), feiertagsregel: 'unveraendert', auftragLeistungId: bau.zeileA,
    }));
    const fremd = await imKontext(async (k) => legeTurnusSerieAn(k, {
      revierId: revier, leistungskatalogPositionId: position, bezeichnung: 'Ohne Anker',
      wochentage: ['TU'], beginnLokal: '06:00', dauerMinuten: 120,
      gueltigAb: await tagePlus(1), feiertagsregel: 'unveraendert',
    }));
    const planung = await eigeneRolle(f.reinigung, [
      'dienstplan.lesen', 'dienstplan.schreiben', 'reinigung.lesen', 'reinigung.schreiben',
      'objekt.lesen', 'katalog.lesen',
    ]);
    // Die Planung sieht keine Leistungszeile — die Voraussetzung dieses Falls.
    expect(await imKontext((k) => listeAnkerbareLeistungen(k), planung)).toEqual([]);

    // (a) eine FREMDE, unverankerte Serie ändern: der Lauf geht über alle Serien.
    await imKontext((k) => aendereTurnus(k, fremd.planungsserieId, { dauerMinuten: 150 }), planung);

    // (b) die verankerte selbst: neue Wochentage heissen NEUE Schichten, die ihren
    // Auftrag aus der Zeile ableiten, die die Planung nicht lesen darf.
    const vorher = (await schichtenDerSerie(verankert.planungsserieId)).length;
    await imKontext((k) => aendereTurnus(k, verankert.planungsserieId, {
      wochentage: ['MO', 'WE', 'FR'],
    }), planung);
    const danach = await schichtenDerSerie(verankert.planungsserieId);
    expect(danach.length).toBeGreaterThan(vorher);
    for (const s of danach) expect(s).toMatchObject({ auftrag: bau.auftragA, anker: bau.zeileA });
  });

  it('die Ableitung gehört `cse_definer` und steht niemandem sonst zum Aufruf offen', async () => {
    const [f0] = await sql.unsafe<{ definer: boolean; eigentuemer: string; oeffentlich: boolean }[]>(
      `select p.prosecdef as definer, pg_get_userbyid(p.proowner) as eigentuemer,
              has_function_privilege('public', p.oid, 'execute') as oeffentlich
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kern' and p.proname = 'einsatz_auftrag_ableiten'`);
    expect(f0).toEqual({ definer: true, eigentuemer: 'cse_definer', oeffentlich: false });
  });
});

/** Ein Auftrag am Objekt des Aufbaus in einem Zustand, mit einer Leistungszeile. */
async function zeileImZustand(objekt: string, status: string): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                          status_grund, abgeschlossen_am, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     select mandant_id, $2, kunde_id, id, 'rahmenvertrag', $3::auftrag_status,
            case when $3 in ('pausiert', 'storniert') then 'Objekt geschlossen' end,
            case when $3 = 'abgeschlossen' then now() end,
            'Zustandsauftrag', $4, '2026-01-01'
       from objekt where id = $1
     returning id`,
    [objekt, `AU-Z-${zufall()}`, status, admin] as never[]);
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, bezeichnung,
                                   steuersatz_bp, gueltig_ab)
     select mandant_id, id, 1, 'Unterhaltsreinigung', 1900, '2026-01-01'
       from auftrag where id = $1
     returning id`, [a!.id]);
  return l!.id;
}

describe('(7) nur ein laufender Auftrag nimmt neue Zeit an — EINE Liste für beide Felder (V-192, O-927)', () => {
  it('Zeilen eines angelegten, abgeschlossenen oder stornierten Auftrags stehen nicht zur Wahl und werden abgewiesen', async () => {
    const bau = await baue(f.reinigung);
    const zeile = {
      angelegt: await zeileImZustand(bau.objekt, 'angelegt'),
      pausiert: await zeileImZustand(bau.objekt, 'pausiert'),
      abgeschlossen: await zeileImZustand(bau.objekt, 'abgeschlossen'),
      storniert: await zeileImZustand(bau.objekt, 'storniert'),
    };
    // Der Platzhalter: dieselbe Menge wie die Auftragsauswahl der Einzelschicht.
    expect(ANKERBARE_AUFTRAGSZUSTAENDE).toEqual(['aktiv', 'pausiert']);

    const ids = (await imKontext((k) => listeAnkerbareLeistungen(k))).map((l) => l.id);
    expect(ids).toContain(zeile.pausiert);
    expect(ids).toContain(bau.zeileA);
    for (const nicht of [zeile.angelegt, zeile.abgeschlossen, zeile.storniert]) {
      expect(ids).not.toContain(nicht);
      expect(await grund(() => imKontext((k) => pruefeLeistungsanker(k, nicht))))
        .toBe('leistung_beendet');
    }
    expect(await grund(() => imKontext((k) => pruefeLeistungsanker(k, zeile.pausiert)))).toBeNull();

    // Als bisheriger Anker steht sie weiter da — nicht wählbar, nicht gelöscht.
    const mitBisher = await imKontext((k) => listeAnkerbareLeistungen(k, zeile.abgeschlossen));
    expect(mitBisher.find((l) => l.id === zeile.abgeschlossen)?.lebt).toBe(false);
  });
});

describe('(8) jede Zeile nennt Kunde und Objekt — ohne das Recht bleibt die Angabe leer, nicht die Zeile (V-192)', () => {
  it('mit den Rechten: Kunde und Objekt; ohne `crm.lesen` und `objekt.lesen`: dieselbe Zeile ohne sie', async () => {
    const bau = await baue(f.reinigung);
    const voll = (await imKontext((k) => listeAnkerbareLeistungen(k)))
      .find((l) => l.id === bau.zeileA);
    expect(voll).toMatchObject({ kunde: 'Ankerkunde', objekt: 'Ankerobjekt', lebt: true });

    const nurAuftrag = await eigeneRolle(f.reinigung, ['auftrag.lesen', 'dienstplan.lesen']);
    const knapp = (await imKontext((k) => listeAnkerbareLeistungen(k), nurAuftrag))
      .find((l) => l.id === bau.zeileA);
    expect(knapp).toMatchObject({ kunde: null, objekt: null, lebt: true });
  });
});

describe('(9) ein archivierter Posten behält seine Leistungszeile — mit Grund abgewiesen (V-192)', () => {
  it('archiviert: `PostenArchiviert` und keine Änderung; unbekannt: nicht vorhanden', async () => {
    const adminS = await konto(f.security);
    const bau = await baue(f.security, adminS);
    const postenId = await imKontext(async (k) => legePostenAn(k, {
      objektId: bau.objekt, bezeichnung: 'Tor Süd', minBesetzung: 1, sollBesetzung: 1,
      gueltigAb: await tagePlus(1), auftragLeistungId: bau.zeileA,
    }), adminS, f.security);
    await sql.unsafe(`update posten set archiviert_am = now() where id = $1`, [postenId]);

    await expect(imKontext((k) => setzePostenLeistung(k, postenId, bau.zeileB), adminS, f.security))
      .rejects.toBeInstanceOf(PostenArchiviert);
    const [p] = await sql.unsafe<{ anker: string | null }[]>(
      `select auftrag_leistung_id as anker from posten where id = $1`, [postenId]);
    expect(p?.anker).toBe(bau.zeileA);

    await expect(imKontext((k) => setzePostenLeistung(
      k, '00000000-0000-4000-8000-00000000abcd', bau.zeileB), adminS, f.security))
      .rejects.toBeInstanceOf(PostenNichtGefunden);
  });
});
