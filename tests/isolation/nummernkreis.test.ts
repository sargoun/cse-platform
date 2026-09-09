/**
 * PR 5 acceptance (1), (2), (3), (6) — Lückenlosigkeit gegen eine echte
 * Datenbank.
 *
 * Nichts davon lässt sich mocken. "200 gleichzeitige Transaktionen erzeugen
 * keine Lücke" ist eine Aussage über Zeilensperren, und ein Mock hätte keine.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { alsApp, DB_URL, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  formatiereNummer,
  NummernkreisFehler,
  vergebeNummer,
} from '../../src/server/services/finanz/nummernkreis.js';

let f: Fixtur;

/** Legt einen bestätigten Kreis an. Als Eigentümer — Kreise anlegen ist PR 6. */
async function kreis(
  mandantId: string,
  opts: {
    typ?: string; kontextId?: string | null; jahr?: number;
    maske?: string; zuruecksetzung?: string | null;
    platzhalter?: boolean; geschlossenAm?: string | null; naechste?: number;
  } = {},
): Promise<string> {
  const {
    typ = 'leistungsnachweis', kontextId = null, jahr = 2026,
    maske = 'LN-{jahr}-{nr:5}', zuruecksetzung = 'jaehrlich',
    platzhalter = false, geschlossenAm = null, naechste = 1,
  } = opts;
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, naechste_nummer, geoeffnet_am, geschlossen_am, ist_platzhalter,
        erstellt_von_art, erstellt_von_dienst)
     values ($1,$2::nummernkreis_typ,$3::uuid,$4,'Test',true,$5,
             $6::nummernkreis_zuruecksetzung,$7,'2026-01-01',$8::date,$9,'system','job:test')
     returning id`,
    [mandantId, typ, kontextId, jahr, maske, zuruecksetzung, naechste, geschlossenAm, platzhalter],
  );
  return z!.id;
}

async function stand(id: string): Promise<number> {
  const [z] = await sql.unsafe<{ naechste_nummer: string }[]>(
    `select naechste_nummer from nummernkreis where id = $1`, [id],
  );
  return Number(z!.naechste_nummer);
}

beforeEach(async () => {
  f = await seed();
});
afterAll(schliessen);

describe('(6) der Kreis wird auf dem OFFENEN Schlüssel gesucht, nie über das heutige Jahr', () => {
  it('ein fortlaufender Kreis (jahr = 0) vergibt eine Nummer', async () => {
    // `zuruecksetzung = 'nie'` heisst jahr = 0. Genau der Fall, in dem eine
    // Suche nach dem heutigen Jahr nichts findet.
    const id = await kreis(f.reinigung, {
      jahr: 0, maske: 'LN-{nr:5}', zuruecksetzung: 'nie',
    });

    const gezogen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false },
      (tx) => vergebeNummer(tx, { kreisTyp: 'leistungsnachweis' }),
    );

    expect(gezogen.nummer).toBe(1);
    expect(gezogen.formatiert).toBe('LN-00001');
    expect(gezogen.nummernkreisId).toBe(id);
    expect(await stand(id)).toBe(2);
  });

  it('und eine Suche über das heutige Jahr fände ihn NICHT — der Beweis, dass es die Falle gibt', async () => {
    await kreis(f.reinigung, { jahr: 0, maske: 'LN-{nr:5}', zuruecksetzung: 'nie' });

    const ueberJahr = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false },
      (tx) => tx.unsafe<unknown[]>(
        `select id from nummernkreis
          where mandant_id = app.aktiver_mandant()
            and kreis_typ = 'leistungsnachweis' and jahr = extract(year from now())::int`,
      ),
    );
    // Null Zeilen. Eine Festschreibung, die so sucht, scheitert dauerhaft für
    // jede Gesellschaft, die über Jahre durchnummeriert.
    expect(ueberJahr).toHaveLength(0);
  });

  it('ein geschlossener Kreis nennt sich geschlossen — nicht "nicht gefunden"', async () => {
    // Der Unterschied ist der ganze Grund, warum `d_kreis_lesen` innerhalb des
    // Mandanten unbeschränkt ist: "kein Kreis angelegt" und "der Kreis ist zu"
    // verlangen verschiedene Handlungen von verschiedenen Menschen.
    await kreis(f.reinigung, { geschlossenAm: '2026-06-30' });
    const fehler = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false },
      (tx) => vergebeNummer(tx, { kreisTyp: 'leistungsnachweis' }).catch((e: unknown) => e),
    );
    expect((fehler as NummernkreisFehler).grund).toBe('geschlossen');
    expect((fehler as Error).message).toMatch(/geschlossen \(seit 2026-06-30\)/u);
  });

  it('ein Platzhalter vergibt nichts — eine Nummer daraus wäre erfunden (O-134)', async () => {
    await kreis(f.reinigung, { platzhalter: true, zuruecksetzung: null });
    const fehler = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false },
      (tx) => vergebeNummer(tx, { kreisTyp: 'leistungsnachweis' }).catch((e: unknown) => e),
    );
    expect(fehler).toBeInstanceOf(NummernkreisFehler);
    expect((fehler as NummernkreisFehler).grund).toBe('platzhalter');
  });

  it('ein kontextbezogener Kreis (wachbuch je Objekt) steht neben dem gesellschaftsweiten', async () => {
    const objekt = '11111111-1111-1111-1111-111111111111';
    await kreis(f.reinigung, { maske: 'LN-{jahr}-{nr:5}' });
    await kreis(f.reinigung, {
      typ: 'wachbuch', kontextId: objekt, maske: 'WB-{jahr}-{nr:4}',
    });

    const [ln, wb] = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false },
      async (tx) => [
        await vergebeNummer(tx, { kreisTyp: 'leistungsnachweis' }),
        await vergebeNummer(tx, { kreisTyp: 'wachbuch', kontextId: objekt }),
      ],
    );
    expect(ln!.formatiert).toBe('LN-2026-00001');
    expect(wb!.formatiert).toBe('WB-2026-0001');
    expect(ln!.nummernkreisId).not.toBe(wb!.nummernkreisId);
  });
});

describe('(2) eine abgebrochene Transaktion lässt den Zähler stehen', () => {
  /**
   * Das ist der Grund für eine Zeile statt einer Sequenz. `nextval` rollt
   * nicht zurück — wer zieht und abbricht, hinterlässt dort eine Lücke, und
   * §14 UStG duldet keine. Diese Prüfung ist der Unterschied zwischen
   * "Lücken sind unwahrscheinlich" und "Lücken sind unmöglich".
   */
  it('rollback bewegt nichts', async () => {
    const id = await kreis(f.reinigung);
    expect(await stand(id)).toBe(1);

    await expect(
      alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false },
        async (tx) => {
          const g = await vergebeNummer(tx, { kreisTyp: 'leistungsnachweis' });
          expect(g.nummer).toBe(1);
          throw new Error('absichtlicher Abbruch');
        }),
    ).rejects.toThrow('absichtlicher Abbruch');

    expect(await stand(id)).toBe(1);
  });

  it('und die nächste erfolgreiche Vergabe bekommt dieselbe Nummer 1 — keine Lücke', async () => {
    const id = await kreis(f.reinigung);
    await alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false },
      async (tx) => {
        await vergebeNummer(tx, { kreisTyp: 'leistungsnachweis' });
        throw new Error('abbruch');
      }).catch(() => undefined);

    const g = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false },
      (tx) => vergebeNummer(tx, { kreisTyp: 'leistungsnachweis' }),
    );
    expect(g.nummer).toBe(1);
    expect(await stand(id)).toBe(2);
  });
});

describe('(3) zwei Gesellschaften zählen unabhängig — ein Kreis ist eine Zeile, kein Code', () => {
  it('TEN-02/TEN-08: derselbe Typ, zwei Mandanten, zwei Zähler', async () => {
    const r = await kreis(f.reinigung);
    const s = await kreis(f.security);

    await alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false },
      async (tx) => {
        await vergebeNummer(tx, { kreisTyp: 'leistungsnachweis' });
        await vergebeNummer(tx, { kreisTyp: 'leistungsnachweis' });
      });
    const beiSecurity = await alsApp(
      { scope: 'mandant', mandantId: f.security, portal: 'intern', readonly: false },
      (tx) => vergebeNummer(tx, { kreisTyp: 'leistungsnachweis' }),
    );

    expect(await stand(r)).toBe(3);
    expect(await stand(s)).toBe(2);
    // Security beginnt bei 1, unbeeindruckt von den zwei Zügen der Reinigung.
    expect(beiSecurity.nummer).toBe(1);
  });

  it('ein fünfter Kreis ist ein INSERT, keine Codeänderung', async () => {
    await kreis(f.bau, { typ: 'kassenbuch', maske: 'KB-{jahr}-{nr:4}' });
    const g = await alsApp(
      { scope: 'mandant', mandantId: f.bau, portal: 'intern', readonly: false },
      (tx) => vergebeNummer(tx, { kreisTyp: 'kassenbuch' }),
    );
    expect(g.formatiert).toBe('KB-2026-0001');
  });

  it('der Kreis einer anderen Gesellschaft ist unerreichbar (Invariante 3)', async () => {
    await kreis(f.security);
    const fehler = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false },
      (tx) => vergebeNummer(tx, { kreisTyp: 'leistungsnachweis' }).catch((e: unknown) => e),
    );
    // `kein_kreis`, nicht `geschlossen`: aus der Reinigung heraus ist der Kreis
    // der Security nicht "zu", sondern existiert nicht — und genau das darf
    // die Fehlermeldung auch nicht verraten (Invariante 3).
    expect((fehler as NummernkreisFehler).grund).toBe('kein_kreis');
  });
});

describe('(1) 200 gleichzeitige Transaktionen: 200 Nummern, keine doppelt, keine Lücke', () => {
  it('max − min + 1 === count', async () => {
    const id = await kreis(f.reinigung);

    // Ein eigener Pool: mit einer einzigen Verbindung gäbe es keine
    // Gleichzeitigkeit zu prüfen, und der Test wäre eine Schleife.
    const pool = postgres(DB_URL, { max: 20, onnotice: () => {} });
    try {
      const nummern = await Promise.all(
        Array.from({ length: 200 }, () =>
          pool.begin(async (tx) => {
            await tx.unsafe(`set local role cse_app`);
            await tx.unsafe(`select set_config('app.scope','mandant',true)`);
            await tx.unsafe(`select set_config('app.mandant_id',$1,true)`, [f.reinigung]);
            await tx.unsafe(`select set_config('app.portal','intern',true)`);
            await tx.unsafe(`select set_config('app.readonly','off',true)`);
            const g = await vergebeNummer(tx as never, { kreisTyp: 'leistungsnachweis' });
            return g.nummer;
          }) as Promise<number>,
        ),
      );

      const einzig = new Set(nummern);
      expect(einzig.size, 'keine Nummer doppelt').toBe(200);

      const min = Math.min(...nummern);
      const max = Math.max(...nummern);
      expect(min).toBe(1);
      // DIE Prüfung: die vergebenen Nummern sind ein lückenloses Intervall.
      expect(max - min + 1, 'keine Lücke').toBe(nummern.length);
      expect(await stand(id)).toBe(201);
    } finally {
      await pool.end({ timeout: 5 });
    }
  }, 60_000);
});

describe('der Trigger schützt den Zähler selbst (§3.3, review B19)', () => {
  it('der Zähler darf nur um genau 1 steigen', async () => {
    const id = await kreis(f.reinigung);
    await expect(
      sql.unsafe(`update nummernkreis set naechste_nummer = 50 where id = $1`, [id]),
    ).rejects.toThrow(/nur um genau 1 erhöht/u);
  });

  it('Maske und Geltungsbereich frieren nach der ersten Vergabe ein (LEG-01)', async () => {
    const id = await kreis(f.reinigung, { naechste: 2 });
    await expect(
      sql.unsafe(`update nummernkreis set format_maske = 'X-{nr:5}' where id = $1`, [id]),
    ).rejects.toThrow(/unveränderlich/u);
  });

  it('einem HANDELNDEN ohne nummernkreis.verwalten ist nur der Zähler erlaubt', async () => {
    /**
     * Die Rechteprüfung gilt für Handelnde, nicht für Migration und Seed
     * (0013): ohne angemeldeten Benutzer läuft kein Editor, sondern ein Seed,
     * der keine Rolle hat, deren Rechte man prüfen könnte. Geprüft wird sie
     * deshalb dort, wo sie greift — in einer echten Sitzung.
     */
    const [u] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ('nk@cse.test') returning id`,
    );
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1,'nk@cse.test','NK','aktiv')`,
      [u!.id],
    );
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
       values ($1,$2,(select id from rolle where schluessel='leitung' and mandant_id is null))`,
      [u!.id, f.reinigung],
    );
    const id = await kreis(f.reinigung, { platzhalter: true, zuruecksetzung: null, maske: 'LN-{nr:5}' });

    await expect(
      alsApp(
        { scope: 'mandant', mandantId: f.reinigung, benutzerId: u!.id, portal: 'intern', readonly: false },
        (tx) => tx.unsafe(
          `update nummernkreis set format_maske = 'X-{nr:5}' where id = $1`, [id],
        ),
      ),
    // Drei Schichten, und die ERSTE greift: `cse_app` hält auf
    // `nummernkreis` nur einen Spaltengrant für Zähler und Kettenkopf
    // (K-05-Muster), also scheitert der Versuch schon am Privileg — vor RLS
    // und vor dem Trigger. Genau so soll es sein.
    ).rejects.toThrow(/permission denied|nur der Zähler bewegt werden|row-level security/iu);
  });

  it('ein Seed dagegen darf bestätigen — sonst wäre nie eine Rechnung möglich', async () => {
    // Genau der Ausfall, den 0013 behebt: ohne diesen Weg liesse sich ein
    // Platzhalterkreis nie bestätigen, und damit nie eine Rechnung
    // festschreiben.
    const id = await kreis(f.reinigung, { platzhalter: true, zuruecksetzung: null });
    await sql.unsafe(
      `update nummernkreis set ist_platzhalter = false, zuruecksetzung = 'nie' where id = $1`,
      [id],
    );
    const [z] = await sql.unsafe<{ ist_platzhalter: boolean }[]>(
      `select ist_platzhalter from nummernkreis where id = $1`, [id],
    );
    expect(z!.ist_platzhalter).toBe(false);
  });

  it('ein geschlossener Kreis vergibt auch per direktem UPDATE nichts', async () => {
    const id = await kreis(f.reinigung, { geschlossenAm: '2026-06-30' });
    await expect(
      sql.unsafe(`update nummernkreis set naechste_nummer = naechste_nummer + 1 where id = $1`, [id]),
    ).rejects.toThrow(/geschlossener Kreis/u);
  });
});

describe('TEN-02 — ein Rechnungskreis gehört einer eigenen Rechtseinheit', () => {
  it('ausgangsrechnung ohne eigener_nummernkreis wird abgelehnt', async () => {
    await expect(kreis(f.reinigung, { typ: 'ausgangsrechnung', maske: 'RE-{jahr}-{nr:5}' }))
      .rejects.toThrow(/eigener_nummernkreis/u);
  });

  it('wachbuch dagegen NICHT — ein Wachbuch ist keine Rechnung', async () => {
    // Die Bedingung wörtlich auf alle neun Typen angewandt hiesse: eine
    // Gesellschaft ohne eigenen Rechnungskreis könnte kein Wachbuch führen.
    const id = await kreis(f.reinigung, {
      typ: 'wachbuch', kontextId: '22222222-2222-2222-2222-222222222222',
      maske: 'WB-{jahr}-{nr:4}',
    });
    expect(id).toBeTruthy();
  });

  it('mit eigener_nummernkreis ist der Rechnungskreis erlaubt', async () => {
    await sql.unsafe(
      `update mandant set ist_rechtseinheit = true, eigener_nummernkreis = true,
              strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin', ust_id = 'DE123456789'
        where id = $1`, [f.security],
    );
    const id = await kreis(f.security, { typ: 'ausgangsrechnung', maske: 'RE-{jahr}-{nr:5}' });
    expect(id).toBeTruthy();
  });
});

describe('die Anwendung zieht den Rechnungskreis gar nicht (§5.6)', () => {
  it('vergebeNummer verweigert ausgangsrechnung mit benanntem Grund', async () => {
    const fehler = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false },
      (tx) => vergebeNummer(tx, { kreisTyp: 'ausgangsrechnung' }).catch((e: unknown) => e),
    );
    expect((fehler as NummernkreisFehler).grund).toBe('definer_kreis');
  });

  it('und das ist keine Vorsichtsmassnahme: cse_app hält gar keine UPDATE-Policy dafür', async () => {
    await sql.unsafe(
      `update mandant set ist_rechtseinheit = true, eigener_nummernkreis = true,
              strasse = 'A', plz = '10719', ort = 'Berlin', ust_id = 'DE123456789'
        where id = $1`, [f.bau],
    );
    const id = await kreis(f.bau, { typ: 'ausgangsrechnung', maske: 'RE-{jahr}-{nr:5}' });
    // Der Zug als cse_app trifft null Zeilen — geräuschlos, was genau der
    // Grund ist, warum die Anwendung es erst gar nicht versucht.
    const betroffen = await alsApp(
      { scope: 'mandant', mandantId: f.bau, portal: 'intern', readonly: false },
      (tx) => tx.unsafe<unknown[]>(
        `update nummernkreis set naechste_nummer = naechste_nummer + 1
          where id = $1 returning id`, [id],
      ),
    );
    expect(betroffen).toHaveLength(0);
  });
});

describe('die Maske wird an EINER Stelle aufgelöst', () => {
  it('{nr:5} füllt links mit Nullen, {jahr} ist das Jahr DES KREISES', () => {
    expect(formatiereNummer('RE-{jahr}-{nr:5}', 42, 2026)).toBe('RE-2026-00042');
    expect(formatiereNummer('LN-{nr:3}', 7, 0)).toBe('LN-007');
    expect(formatiereNummer('{nr}', 1234, 0)).toBe('1234');
  });

  it('{jahr} in einem fortlaufenden Kreis ist ein Fehler, keine stille 0', () => {
    expect(() => formatiereNummer('RE-{jahr}-{nr:5}', 1, 0)).toThrow(/fortlaufend/u);
  });

  it('eine Maske ohne {nr} wird abgelehnt — jede Nummer wäre dieselbe', () => {
    expect(() => formatiereNummer('RE-{jahr}', 1, 2026)).toThrow(/kein \{nr\}/u);
  });

  it('ein unbekannter Platzhalter wird benannt, nicht durchgereicht', () => {
    expect(() => formatiereNummer('RE-{monat}-{nr:5}', 1, 2026)).toThrow(/\{monat\}/u);
  });
});
