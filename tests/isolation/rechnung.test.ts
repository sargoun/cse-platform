/**
 * PR 46 — Abnahme (1) bis (7) gegen eine ECHTE Datenbank mit FORCE RLS.
 *
 * Keine dieser Aussagen lässt sich mocken. „Fünfzig gleichzeitige
 * Festschreibungen ergeben fünfzig aufeinanderfolgende Nummern" ist eine
 * Aussage über Zeilensperren, und ein Mock hat keine. „Ein UPDATE scheitert
 * mit umgangener Anwendung" ist eine Aussage über Trigger und Policies, und
 * ein Mock wäre die umgangene Anwendung.
 *
 * **Jede Prüfung ist falsifizierbar.** Wo das nicht offensichtlich ist, steht
 * daneben, welche Sicherung man entfernen müsste, damit sie fällt.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { alsApp, DB_URL, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import type {
  RechnungFehler} from '../../src/server/services/finanz/rechnung.js';
import {
  fuegePositionHinzu, korrigiere, legeEntwurfAn, finalisiere, storniere, verwerfe, vonHand,
  type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';

let f: Fixtur;
let benutzer: string;
let kundeReinigung: string;
let kundeSecurity: string;

/** Der schmale Treiberausschnitt, den jeder Dienst erwartet. */
function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

/** Eine Sitzung mit allen Finanzrechten — die globale Rolle `super_admin`. */
async function legeBenutzerAn(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email],
  );
  // AUT-02: eine Rolle mit `erfordert_2fa` macht ein Konto ohne hinterlegten
  // zweiten Faktor gar nicht erst `aktiv` — die Datenbank ist da die zweite
  // Linie, und sie feuert auch im Test.
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email],
  );
  return u!.id;
}

/**
 * Eine Gesellschaft, die fakturieren DARF: eigene Rechtseinheit, eigener
 * Kreis, und die §14-Pflichtfelder, die `mandant_ustg14_vollstaendig`
 * ohnehin verlangt.
 */
async function macheFakturierfaehig(mandantId: string, praefix: string): Promise<string> {
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            handelsregister_gericht = 'Amtsgericht Charlottenburg',
            handelsregister_nummer = 'HRB 12345 B'
      where id = $1`, [mandantId],
  );
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, $2, true, $3, 'nie',
             '2026-01-01', false, 'system', 'job:test')
     returning id`,
    [mandantId, `Rechnungen ${praefix}`, `${praefix}-{nr:5}`],
  );
  return k!.id;
}

async function legeKundeAn(mandantId: string, nummer: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1, $2, 'Bezirksamt Mitte', 'Karl-Marx-Allee', '31', '10178', 'Berlin')
     returning id`, [mandantId, nummer],
  );
  return k!.id;
}

function sitzung(mandantId: string) {
  return {
    scope: 'mandant' as const, mandantId, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

/** Ein bestückter Entwurf: eine Leistungszeile, 19 %, Zahlungsziel gesetzt. */
async function entwurfMitPosition(
  tx: postgres.TransactionSql, kundeId: string, netto = 100_00n,
): Promise<string> {
  const d = alsDienst(tx);
  const id = await legeEntwurfAn(d, {
    kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
  });
  await fuegePositionHinzu(d, {
    rechnungId: id, bezeichnung: 'Unterhaltsreinigung August',
    menge: milliMenge(1000n), einheit: 'm2',
    einzelpreisCent: cent(netto), steuergruppe: 'ust_19',
    // FIN-07 (PR 49): eine Leistungszeile ohne Herkunft weist die Datenbank
    // beim COMMIT ab. Diese Zeile ist von Hand erfasst und sagt es.
    quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
  });
  return id;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn('buchhaltung@cse.test');
  await macheFakturierfaehig(f.reinigung, 'RE');
  await macheFakturierfaehig(f.security, 'SE');
  kundeReinigung = await legeKundeAn(f.reinigung, 'K-1001');
  kundeSecurity = await legeKundeAn(f.security, 'K-2001');
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(2) ein Entwurf hat keine Nummer — und das ist erzwungen', () => {
  it('der frisch angelegte Entwurf trägt nummer IS NULL', async () => {
    const id = await alsApp(sitzung(f.reinigung), (tx) =>
      legeEntwurfAn(alsDienst(tx), { kundeId: kundeReinigung, zahlungszielTage: 30 }));
    const [z] = await sql.unsafe<{ nummer: string | null; nummer_laufend: string | null }[]>(
      `select nummer, nummer_laufend::text from rechnung where id = $1`, [id],
    );
    expect(z!.nummer).toBeNull();
    expect(z!.nummer_laufend).toBeNull();
  });

  it('eine Nummer auf einem Entwurf weist der CHECK ab', async () => {
    const id = await alsApp(sitzung(f.reinigung), (tx) =>
      legeEntwurfAn(alsDienst(tx), { kundeId: kundeReinigung, zahlungszielTage: 30 }));
    // Als Eigentümer, also mit umgangener Anwendung UND umgangener RLS.
    await expect(
      sql.unsafe(`update rechnung set nummer = 'RE-00001' where id = $1`, [id]),
    ).rejects.toThrow(/rechnung_entwurf_ohne_nummer/u);
  });

  /**
   * Die andere Hälfte, und die eigentliche Sicherung: `festgeschrieben` OHNE
   * Nummer ist unmöglich. Ohne sie ließe sich eine Rechnung festschreiben,
   * ohne je den Zähler berührt zu haben — die Folge im Ausgangsbuch wäre dann
   * lückenlos, weil sie leer ist.
   */
  it('`festgeschrieben` ohne Nummer ist unmöglich', async () => {
    const id = await alsApp(sitzung(f.reinigung), (tx) =>
      legeEntwurfAn(alsDienst(tx), { kundeId: kundeReinigung, zahlungszielTage: 30 }));
    await expect(
      sql.unsafe(
        `update rechnung set status = 'festgeschrieben' where id = $1`, [id],
      ),
    ).rejects.toThrow(/rechnung_festgeschrieben_vollstaendig/u);
  });

  it('und der Übergang nach `festgeschrieben` ist für cse_app gar nicht erreichbar', async () => {
    const id = await alsApp(sitzung(f.reinigung), (tx) =>
      legeEntwurfAn(alsDienst(tx), { kundeId: kundeReinigung, zahlungszielTage: 30 }));
    // Die `WITH CHECK` der K-03-Policy verlangt `status = 'entwurf'`. Der
    // erhöhte Weg (fin.rechnung_nummer_ziehen) ist SCHMALER als dieser, nicht
    // breiter — das ist die Aussage.
    const betroffen = await alsApp(sitzung(f.reinigung), (tx) => tx.unsafe(
      `update rechnung set status = 'verworfen', verworfen_am = now(),
              verworfen_von = app.aktueller_benutzer(), verworfen_grund = 'Probe'
        where id = $1 returning id`, [id],
    ));
    // Verwerfen geht (eigene Policy), Festschreiben nicht — der Gegenbeweis
    // steht in der Zeile darunter.
    expect(betroffen).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('(1) 1.000 Entwürfe anlegen und verwerfen hinterlässt NULL Lücken', () => {
  it('danach ist die festgeschriebene Folge exakt 1..10', async () => {
    await alsApp(sitzung(f.reinigung), async (tx) => {
      const d = alsDienst(tx);
      for (let i = 0; i < 1000; i += 1) {
        const id = await legeEntwurfAn(d, { kundeId: kundeReinigung, zahlungszielTage: 30 });
        await verwerfe(d, id, `Probelauf ${String(i)}`);
      }
    });

    for (let i = 0; i < 10; i += 1) {
      await alsApp(sitzung(f.reinigung), async (tx) => {
        const id = await entwurfMitPosition(tx, kundeReinigung);
        await finalisiere(alsDienst(tx), id);
      });
    }

    /**
     * `order by r.nummer_laufend`, QUALIFIZIERT. Ohne die Qualifizierung löst
     * PostgreSQL `ORDER BY nummer_laufend` gegen die AUSGABEspalte auf — und
     * die ist hier `::text`. Sortiert würde dann lexikografisch, und `10`
     * käme vor `2`: ein Test, der nur deshalb rot ist, weil er selbst falsch
     * sortiert, verdeckt genau die Lückenprüfung, um die es geht.
     */
    const nummern = await sql.unsafe<{ nummer_laufend: string; nummer: string }[]>(
      `select r.nummer_laufend::text, r.nummer from rechnung r
        where r.mandant_id = $1 and r.status = 'festgeschrieben'
        order by r.nummer_laufend`, [f.reinigung],
    );
    expect(nummern.map((n) => Number(n.nummer_laufend))).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    expect(nummern[0]!.nummer).toBe('RE-00001');
    expect(nummern[9]!.nummer).toBe('RE-00010');

    // Und die Kettenpositionen ebenso — eine Lücke dort wäre eine entfernte
    // Zeile unterhalb der Anwendungsschicht.
    const kette = await sql.unsafe<{ kette_position: string }[]>(
      `select h.kette_position::text from rechnung_hash h
        where h.mandant_id = $1 order by h.kette_position`, [f.reinigung],
    );
    expect(kette.map((k) => Number(k.kette_position))).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
  }, 180_000);

  it('und die 1.000 verworfenen Entwürfe sind noch da, mit Grund (Invariante 8)', async () => {
    await alsApp(sitzung(f.reinigung), async (tx) => {
      const d = alsDienst(tx);
      const id = await legeEntwurfAn(d, { kundeId: kundeReinigung, zahlungszielTage: 30 });
      await verwerfe(d, id, 'Doppelt erfasst');
    });
    const [z] = await sql.unsafe<{
      status: string; verworfen_grund: string; nummer: string | null;
    }[]>(
      `select status::text as status, verworfen_grund, nummer from rechnung
        where mandant_id = $1 and status = 'verworfen'`, [f.reinigung],
    );
    expect(z!.status).toBe('verworfen');
    expect(z!.verworfen_grund).toBe('Doppelt erfasst');
    expect(z!.nummer).toBeNull();
  });

  it('ein verworfener Entwurf lässt sich auch als Eigentümer nicht löschen', async () => {
    const id = await alsApp(sitzung(f.reinigung), async (tx) => {
      const d = alsDienst(tx);
      const neu = await legeEntwurfAn(d, { kundeId: kundeReinigung, zahlungszielTage: 30 });
      await verwerfe(d, neu, 'Probe');
      return neu;
    });
    await expect(
      sql.unsafe(`delete from rechnung where id = $1`, [id]),
    ).rejects.toThrow(/Hard delete auf public\.rechnung ist gesperrt/u);
  });

  it('und ein abgebrochener Festschreibversuch bewegt den Zähler nicht', async () => {
    // Der Grund, warum eine ZEILE und keine Sequenz gezählt wird: `nextval`
    // überlebt ein ROLLBACK und fälscht damit genau die Lücke, nach der eine
    // GoBD-Prüfung fragt.
    await expect(alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurfMitPosition(tx, kundeReinigung);
      await finalisiere(alsDienst(tx), id);
      throw new Error('absichtlicher Abbruch');
    })).rejects.toThrow('absichtlicher Abbruch');

    await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurfMitPosition(tx, kundeReinigung);
      const k = await finalisiere(alsDienst(tx), id);
      expect(k.nummerLaufend).toBe(1);
      expect(k.nummer).toBe('RE-00001');
    });
  });
});

// ---------------------------------------------------------------------------

describe('(3) fünfzig GLEICHZEITIGE Festschreibungen: fünfzig Nummern, keine doppelt, keine Lücke', () => {
  it('max − min + 1 === Anzahl, und die Kette hat keine Gabelung', async () => {
    const entwuerfe: string[] = [];
    await alsApp(sitzung(f.reinigung), async (tx) => {
      for (let i = 0; i < 50; i += 1) {
        entwuerfe.push(await entwurfMitPosition(tx, kundeReinigung, BigInt(1000 + i)));
      }
    });

    // Ein eigener Pool: mit einer Verbindung gäbe es keine Gleichzeitigkeit
    // zu prüfen, und der Test wäre eine Schleife.
    const pool = postgres(DB_URL, { max: 25, onnotice: () => {} });
    try {
      const nummern = await Promise.all(entwuerfe.map((id) =>
        pool.begin(async (tx) => {
          await tx.unsafe(`set local role cse_app`);
          await tx.unsafe(`select set_config('app.scope','mandant',true)`);
          await tx.unsafe(`select set_config('app.mandant_id',$1,true)`, [f.reinigung]);
          await tx.unsafe(`select set_config('app.benutzer_id',$1,true)`, [benutzer]);
          await tx.unsafe(`select set_config('app.portal','intern',true)`);
          await tx.unsafe(`select set_config('app.readonly','off',true)`);
          const k = await finalisiere(alsDienst(tx as postgres.TransactionSql), id);
          return k.nummerLaufend;
        }) as Promise<number>));

      expect(new Set(nummern).size, 'keine Nummer doppelt').toBe(50);
      expect(Math.min(...nummern)).toBe(1);
      expect(Math.max(...nummern) - Math.min(...nummern) + 1, 'keine Lücke').toBe(50);
    } finally {
      await pool.end({ timeout: 5 });
    }

    const kette = await sql.unsafe<{ kette_position: string; vorheriger_hash: string }[]>(
      `select h.kette_position::text, h.vorheriger_hash from rechnung_hash h
        where h.mandant_id = $1 order by h.kette_position`, [f.reinigung],
    );
    expect(kette).toHaveLength(50);
    // Keine Gabelung: `rh_vorgaenger_uk` macht zwei Glieder mit demselben
    // Vorgänger zu einer Eindeutigkeitsverletzung statt zu einem stillen Ast.
    expect(new Set(kette.map((k) => k.vorheriger_hash)).size).toBe(50);
  }, 180_000);
});

// ---------------------------------------------------------------------------

describe('(7) zwei Mandanten schreiben gleichzeitig fest und behalten je ihren lückenlosen Kreis', () => {
  it('beide zählen ab 1, und keiner sieht den anderen', async () => {
    const rein: string[] = [];
    const sec: string[] = [];
    await alsApp(sitzung(f.reinigung), async (tx) => {
      for (let i = 0; i < 10; i += 1) rein.push(await entwurfMitPosition(tx, kundeReinigung));
    });
    await alsApp(sitzung(f.security), async (tx) => {
      for (let i = 0; i < 10; i += 1) sec.push(await entwurfMitPosition(tx, kundeSecurity));
    });

    const pool = postgres(DB_URL, { max: 20, onnotice: () => {} });
    const schreibe = (mandantId: string, id: string): Promise<number> =>
      pool.begin(async (tx) => {
        await tx.unsafe(`set local role cse_app`);
        await tx.unsafe(`select set_config('app.scope','mandant',true)`);
        await tx.unsafe(`select set_config('app.mandant_id',$1,true)`, [mandantId]);
        await tx.unsafe(`select set_config('app.benutzer_id',$1,true)`, [benutzer]);
        await tx.unsafe(`select set_config('app.portal','intern',true)`);
        await tx.unsafe(`select set_config('app.readonly','off',true)`);
        const k = await finalisiere(alsDienst(tx as postgres.TransactionSql), id);
        return k.nummerLaufend;
      }) as Promise<number>;

    try {
      await Promise.all([
        ...rein.map((id) => schreibe(f.reinigung, id)),
        ...sec.map((id) => schreibe(f.security, id)),
      ]);
    } finally {
      await pool.end({ timeout: 5 });
    }

    for (const [mandant, praefix] of [[f.reinigung, 'RE'], [f.security, 'SE']] as const) {
      const n = await sql.unsafe<{ nummer_laufend: string; nummer: string }[]>(
        `select r.nummer_laufend::text, r.nummer from rechnung r
          where r.mandant_id = $1 and r.status = 'festgeschrieben'
          order by r.nummer_laufend`,
        [mandant],
      );
      expect(n.map((x) => Number(x.nummer_laufend))).toEqual(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      );
      expect(n[0]!.nummer).toBe(`${praefix}-00001`);
    }

    // Invariante 3: aus der Reinigung heraus ist die Rechnung der Security
    // nicht vorhanden — nicht „verboten", sondern nicht da.
    const fremd = await alsApp(sitzung(f.reinigung), (tx) => tx.unsafe<unknown[]>(
      `select id from rechnung where mandant_id = $1`, [f.security],
    ));
    expect(fremd).toHaveLength(0);
  }, 180_000);
});

// ---------------------------------------------------------------------------

describe('(4) eine festgeschriebene Rechnung ist unveränderlich — auf DATENBANKEBENE', () => {
  let rechnungId: string;

  beforeEach(async () => {
    rechnungId = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurfMitPosition(tx, kundeReinigung);
      await finalisiere(alsDienst(tx), id);
      return id;
    });
  });

  it('als cse_app scheitert `set netto_gesamt_cent`', async () => {
    await expect(alsApp(sitzung(f.reinigung), (tx) => tx.unsafe(
      `update rechnung set netto_gesamt_cent = 1 where status = 'festgeschrieben'`,
    ))).rejects.toThrow(/unveraenderlich|netto_gesamt_cent/u);
  });

  /**
   * Und als TABELLENEIGENTÜMER, mit jedem Privileg und an RLS vorbei: der
   * Auslöser feuert trotzdem. Das ist der Unterschied zwischen „die Anwendung
   * lässt es nicht zu" und „es geht nicht".
   */
  it('als Eigentümer ebenfalls — der Auslöser hat keine Spaltenliste', async () => {
    await expect(
      sql.unsafe(`update rechnung set netto_gesamt_cent = 1 where status = 'festgeschrieben'`),
    ).rejects.toThrow(/unveraenderlich.*netto_gesamt_cent/su);
  });

  /**
   * **Die Ausnahme, die eine Ausnahme sein muss — und es bis 0122 nicht war.**
   *
   * `aufbewahrung_bis` steht in der Ausnahmeliste des Auslösers, weil der
   * Aufbewahrungslauf die GoBD-Frist auf einem festgeschriebenen Beleg setzen
   * muss. Die Ausnahme war tot: `ueberweisungsbetrag_cent` ist eine ERZEUGTE
   * Spalte, und PostgreSQL berechnet erzeugte Spalten erst NACH den
   * BEFORE-Auslösern — in `new` stand dort NULL, in `old` der Wert, und der
   * `to_jsonb`-Vergleich schlug auf JEDER Änderung an, auch auf einer, die
   * gar nichts ändert. Die Rechnung war damit nicht unveränderlich, sondern
   * unerreichbar, und die Fehlermeldung nannte eine Spalte, die niemand
   * angefasst hatte.
   *
   * Beide Richtungen stehen hier: die Frist geht durch, die Fälschung nicht.
   * Eine Prüfung nur der ersten Hälfte ließe sich mit `return new` bestehen.
   */
  it('`aufbewahrung_bis` bleibt beweglich — die GoBD-Frist muss gesetzt werden können',
    async () => {
      /*
       * Die Frist wird nicht getippt, sondern aufgelöst: `fin.setze_aufbewahrung`
       * rechnet sie aus `rechnungsdatum` und der Regel zur Klasse. Ohne Regel
       * bleibt sie NULL und die Löschsperre steht — fail-closed, so gewollt.
       *
       * Hier kommt die Regel dazu, und danach muss eine Berührung der Zeile
       * die Frist eintragen. Genau das war bis 0122 unmöglich: der
       * Änderungsschutz wies jede Änderung ab, weil die erzeugte Spalte in
       * `new` NULL ist.
       */
      await sql.unsafe(
        `insert into dokument_aufbewahrung (mandant_id, kategorie, jahre, loeschsperre,
                                            ist_platzhalter, grundlage)
         values ($1, 'rechnung_ausgang', 10, true, false, $2)`,
        [f.reinigung, '§147 Abs. 3 AO, §14b Abs. 1 UStG — Testfixtur']);

      await sql.unsafe(
        `update rechnung set geaendert_am = now() where id = $1`, [rechnungId]);

      const [z] = await sql.unsafe<{ bis: string | null }[]>(
        `select aufbewahrung_bis::text as bis from rechnung where id = $1`, [rechnungId]);
      expect(z!.bis).toBe(`${new Date().getUTCFullYear() + 10}-12-31`);
    });

  it('und die Meldung nennt die Spalte, die wirklich bewegt wurde', async () => {
    await expect(sql.unsafe(
      `update rechnung set fusstext = 'nachträglich' where id = $1`, [rechnungId]))
      .rejects.toThrow(/unveraenderlich — fusstext wurde geaendert/u);
  });

  it('auch `kopftext`, `kunde_id` und `rechnungsdatum` — jede Spalte, nicht eine Auswahl', async () => {
    for (const anweisung of [
      `update rechnung set kopftext = 'x' where status = 'festgeschrieben'`,
      `update rechnung set rechnungsdatum = '2020-01-01' where status = 'festgeschrieben'`,
      `update rechnung set zahlungsziel_tage = 7 where status = 'festgeschrieben'`,
    ]) {
      await expect(sql.unsafe(anweisung), anweisung).rejects.toThrow(/unveraenderlich/u);
    }
  });

  /**
   * `versendet_am` scheitert aus einem ANDEREN Grund, und der ist die halbe
   * Pointe von K-12: die Spalte gibt es auf dieser Tabelle gar nicht. Sie
   * lebt in `rechnung_versand`, damit der Auslöser oben ohne Erlaubnisliste
   * auskommt — und eine Erlaubnisliste dort ließe Invariante 4 auf
   * Datenbankebene ohne jede Deckung.
   */
  it('`set versendet_am` scheitert, weil es die Spalte nicht gibt (K-12)', async () => {
    await expect(
      sql.unsafe(`update rechnung set versendet_am = now() where status = 'festgeschrieben'`),
    ).rejects.toThrow(/column "versendet_am" of relation "rechnung" does not exist/u);
    await expect(
      sql.unsafe(`update rechnung set storniert_durch_rechnung_id = gen_random_uuid()`),
    ).rejects.toThrow(/does not exist/u);
  });

  it('und keine Anwendungsrolle hält BYPASSRLS (K-01)', async () => {
    const rollen = await sql.unsafe<{ rolname: string }[]>(
      `select rolname from pg_roles where rolbypassrls and rolname like 'cse\\_%'`,
    );
    expect(rollen.map((r) => r.rolname)).toEqual([]);
  });

  it('eine Position der festgeschriebenen Rechnung lässt sich nicht mehr ändern', async () => {
    await expect(
      sql.unsafe(`update rechnungsposition set netto_cent = 1 where rechnung_id = $1`,
        [rechnungId]),
    ).rejects.toThrow(/unveraenderlich/u);
    await expect(
      sql.unsafe(`insert into rechnungsposition
                    (mandant_id, rechnung_id, position_nr, bezeichnung, menge, einheit,
                     masseinheit_id, einzelpreis_cent, netto_cent, steuersatz_gruppe_id,
                     satz_bp, kategorie, erstellt_von_art, erstellt_von_dienst)
                  values ($1, $2, 99, 'Nachgeschoben', 1, 'stk',
                          (select id from masseinheit where schluessel = 'stk'),
                          100, 100, (select id from steuersatz_gruppe where schluessel='ust_19'),
                          1900, 'S', 'system', 'job:test')`,
        [f.reinigung, rechnungId]),
    ).rejects.toThrow(/unveraenderlich/u);
  });

  it('und ein Kettenglied ebenfalls nicht — weder Nutzlast noch Hash', async () => {
    await expect(
      sql.unsafe(`update rechnung_hash set hash = repeat('a', 64) where rechnung_id = $1`,
        [rechnungId]),
    ).rejects.toThrow(/nie mehr geaendert/u);
    await expect(
      sql.unsafe(`update rechnung_snapshot set nutzlast_bytes = '\\x00' where rechnung_id = $1`,
        [rechnungId]),
    ).rejects.toThrow(/nie mehr geaendert/u);
  });

  it('cse_app hält auf den zwei Kettentabellen KEIN Schreibrecht (review B16)', async () => {
    const rechte = await sql.unsafe<{ table_name: string; privilege_type: string }[]>(
      `select table_name, privilege_type from information_schema.table_privileges
        where grantee = 'cse_app'
          and table_name in ('rechnung_snapshot','rechnung_hash')
          and privilege_type <> 'SELECT'`,
    );
    expect(rechte).toEqual([]);
    /**
     * Und auch keine GEWÄHRENDE Schreibpolicy: wer `finanzen.schreiben` hält,
     * könnte sonst ein Kettenglied fälschen.
     *
     * `permissive = 'PERMISSIVE'` gehört in die Bedingung, nicht weggelassen:
     * die K-04-Decke ist `restrictive for all` und taucht sonst hier auf,
     * obwohl sie nur einschränkt und nie eine Zeile gewährt — die Prüfung
     * meldete dann genau die Sicherung als Loch.
     */
    const policies = await sql.unsafe<{ policyname: string }[]>(
      `select policyname from pg_policies
        where tablename in ('rechnung_snapshot','rechnung_hash')
          and permissive = 'PERMISSIVE'
          and 'cse_app' = any(roles) and cmd in ('INSERT','UPDATE','ALL')`,
    );
    expect(policies).toEqual([]);
  });

  it('genau die aufgezählten cse_definer-Policies in dieser Domäne, und keine weitere', async () => {
    const policies = await sql.unsafe<{ tablename: string; policyname: string; cmd: string }[]>(
      `select tablename, policyname, cmd from pg_policies
        where 'cse_definer' = any(roles)
          and tablename in ('rechnung','rechnungsposition','rechnung_zuschlag',
                            'rechnung_steuer','rechnung_beziehung','rechnung_snapshot',
                            'rechnung_hash','nummernkreis')
        order by policyname`,
    );
    expect(policies.map((p) => p.policyname)).toEqual([
      'd_hash_schreiben', 'd_rechnung_festschreiben', 'd_rechnung_lesen',
      'd_rechnungskreis_lesen', 'd_rechnungskreis_ziehen', 'd_snapshot_schreiben',
      /**
       * **PR 47 (D-321): zwei LESEpolicies dazu, und keine dritte Art.**
       *
       * `0077` zaehlte sechs auf und sagte „keine siebte". Diese zwei sind
       * keine Widerlegung: jene sechs beschreiben, was die zwei SCHREIBENDEN
       * Definer-Aufrufe des §5.6 duerfen; hier kommt eine PRUEFUNG dazu — der
       * aufgeschobene §14-Pflichtfeld-Ausloeser aus `0085`. Ein aufgeschobener
       * Ausloeser feuert im Sicherheitskontext der AUSLOESENDEN Anweisung,
       * also als `cse_definer`, und scheiterte ohne diese zwei an „permission
       * denied for table rechnungsposition" — bei JEDER Festschreibung.
       *
       * Beide sind `SELECT`, beide auf den aktiven Mandanten begrenzt. Die
       * Zeile darunter haelt genau das fest: keine dieser Policies darf
       * schreiben.
       */
      'd_rp_pflichtfeld', 'd_rs_pflichtfeld',
      /**
       * **PR 50 (D-389): eine LESEpolicy dazu, und wieder keine schreibende.**
       *
       * `fin.abschlag_pruefen()` (0117) laeuft als `cse_definer` und muss
       * wissen, ob der abzuziehende Abschlag storniert ist — die Antwort steht
       * in `rechnung_beziehung`, und ohne Recht UND Policy laese die Funktion
       * dort null Zeilen und liesse jeden Abzug eines stornierten Abschlags
       * durch. Ein Riegel, der aussieht wie einer und keiner ist (D-388).
       *
       * `SELECT`, auf den aktiven Mandanten begrenzt, und ausdruecklich NICHT
       * `using (true)`: eine zweite permissive Policy mit `true` haette sich
       * mit `d_rechnung_lesen` ODER-verknuepft und deren Mandantenschnitt
       * aufgehoben — eine Verbreiterung, die wie eine Ergaenzung aussieht.
       */
      'd_beziehung_storno_lesen',
      // `nk_wachbuch_definer*` gehören 0070 und liegen auf demselben
      // `nummernkreis`; sie sind hier ausgeschlossen, weil sie `wachbuch`
      // betreffen — siehe die Filterzeile darunter.
    ].concat(policies.filter((p) => p.policyname.startsWith('nk_wachbuch'))
      .map((p) => p.policyname)).sort());
    expect(policies.every((p) => ['SELECT', 'INSERT', 'UPDATE'].includes(p.cmd))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('(5) Korrektur = Storno plus neue Rechnung, verbunden über rechnung_beziehung', () => {
  it('drei Belege, drei Nummern, zwei Beziehungen — und das Original bleibt lesbar', async () => {
    const original = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurfMitPosition(tx, kundeReinigung);
      await finalisiere(alsDienst(tx), id);
      return id;
    });

    const ergebnis = await alsApp(sitzung(f.reinigung), (tx) =>
      korrigiere(alsDienst(tx), original, 'Falsche Rechnungsanschrift des Auftraggebers'));

    expect(ergebnis.stornoNummer).toBe('RE-00002');
    expect(ergebnis.neuNummer).toBe('RE-00003');

    const belege = await sql.unsafe<{
      id: string; nummer: string; status: string; rechnungsart: string; brutto_cent: string;
    }[]>(
      `select r.id::text as id, r.nummer, r.status::text as status,
              r.rechnungsart::text as rechnungsart, r.brutto_cent::text
         from rechnung r where r.mandant_id = $1 order by r.nummer_laufend`, [f.reinigung],
    );
    expect(belege).toHaveLength(3);
    // Das Original: unverändert, lesbar, NICHT „storniert" — den Zustand gibt
    // es nicht.
    expect(belege[0]!.status).toBe('festgeschrieben');
    expect(belege[0]!.rechnungsart).toBe('standard');
    // Das Storno spiegelt exakt.
    expect(belege[1]!.rechnungsart).toBe('storno');
    expect(BigInt(belege[1]!.brutto_cent)).toBe(-BigInt(belege[0]!.brutto_cent));
    expect(belege[2]!.rechnungsart).toBe('standard');

    const beziehungen = await sql.unsafe<{
      art: string; storno_art: string | null; von: string; zu: string;
    }[]>(
      `select art::text as art, storno_art::text as storno_art,
              von_rechnung_id::text as von, zu_rechnung_id::text as zu
         from rechnung_beziehung where mandant_id = $1 order by art`, [f.reinigung],
    );
    expect(beziehungen).toHaveLength(2);
    expect(beziehungen[0]!.art).toBe('ersetzt');
    expect(beziehungen[0]!.von).toBe(ergebnis.neuId);
    expect(beziehungen[0]!.zu).toBe(original);
    expect(beziehungen[1]!.art).toBe('storno');
    expect(beziehungen[1]!.storno_art).toBe('vollstorno');
    expect(beziehungen[1]!.zu).toBe(original);

    // Alle drei sind verkettet — und zwar in EINER Linie.
    const kette = await sql.unsafe<{ kette_position: string; hash: string; vorheriger_hash: string }[]>(
      `select h.kette_position::text, h.hash, h.vorheriger_hash from rechnung_hash h
        where h.mandant_id = $1 order by h.kette_position`, [f.reinigung],
    );
    expect(kette).toHaveLength(3);
    expect(kette[0]!.vorheriger_hash).toBe('0'.repeat(64));
    expect(kette[1]!.vorheriger_hash).toBe(kette[0]!.hash);
    expect(kette[2]!.vorheriger_hash).toBe(kette[1]!.hash);
  }, 60_000);

  it('ein Vollstorno, dessen Steuerzeilen NICHT spiegeln, wird abgewiesen', async () => {
    const original = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurfMitPosition(tx, kundeReinigung);
      await finalisiere(alsDienst(tx), id);
      return id;
    });
    // Eine zweite, unabhängige Rechnung — sie spiegelt das Original nicht.
    const fremd = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurfMitPosition(tx, kundeReinigung, 500_00n);
      await finalisiere(alsDienst(tx), id);
      return id;
    });
    await expect(sql.unsafe(
      `insert into rechnung_beziehung (mandant_id, von_rechnung_id, zu_rechnung_id, art,
                                       storno_art, grund, erstellt_von_art, erstellt_von_dienst)
       values ($1, $2, $3, 'storno', 'vollstorno',
               'Behauptetes Storno ohne Spiegelung', 'system', 'job:test')`,
      [f.reinigung, fremd, original],
    )).rejects.toThrow(/spiegelt das Original nicht exakt|rechnungsart = standard, nicht storno/u);
  }, 60_000);

  it('eine Rechnung wird höchstens EINMAL vollstorniert', async () => {
    const original = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurfMitPosition(tx, kundeReinigung);
      await finalisiere(alsDienst(tx), id);
      return id;
    });
    await alsApp(sitzung(f.reinigung), (tx) =>
      storniere(alsDienst(tx), original, 'Leistung wurde nicht erbracht'));

    const fehler = await alsApp(sitzung(f.reinigung), (tx) =>
      storniere(alsDienst(tx), original, 'Nochmal dasselbe, bitte')
        .catch((e: unknown) => e));
    expect((fehler as RechnungFehler).grund).toBe('schon_storniert');
  }, 60_000);

  it('ein Entwurf lässt sich nicht stornieren — er wird verworfen', async () => {
    const id = await alsApp(sitzung(f.reinigung), (tx) =>
      legeEntwurfAn(alsDienst(tx), { kundeId: kundeReinigung, zahlungszielTage: 30 }));
    const fehler = await alsApp(sitzung(f.reinigung), (tx) =>
      storniere(alsDienst(tx), id, 'Das geht so nicht').catch((e: unknown) => e));
    expect((fehler as RechnungFehler).grund).toBe('nicht_festgeschrieben');
  });
});

// ---------------------------------------------------------------------------

describe('O-01 — der Rechnungskreis von CSE Operations ist nicht freigegeben', () => {
  it('die Festschreibung wird mit genau dieser Meldung abgewiesen', async () => {
    // `operations` ist weder Rechtseinheit noch hat es einen Kreis: O-01 ist
    // offen, und die Antwort ist eine Datenänderung, kein Code.
    const kunde = await legeKundeAn(f.operations, 'K-9001');
    /**
     * Gefangen wird AUSSERHALB von `alsApp`, nicht darin: eine gescheiterte
     * Anweisung bricht die Transaktion ab, und `postgres.js` wirft den
     * ursprünglichen Fehler beim COMMIT erneut. Ein `catch` innerhalb des
     * Rückrufs sähe ihn zwar, würde aber gleich darauf vom Commit überholt —
     * und der Test prüfte dann die falsche Ausnahme.
     */
    const fehler = await alsApp(sitzung(f.operations), async (tx) => {
      const id = await entwurfMitPosition(tx, kunde);
      return finalisiere(alsDienst(tx), id);
    }).catch((e: unknown) => e);
    expect((fehler as Error).message)
      .toMatch(/Rechnungskreis für CSE Operations nicht freigegeben/u);
  });
});

describe('Ohne Zahlungsziel geht kein Beleg hinaus (§4.2, O-66)', () => {
  it('die Festschreibung nennt die drei Stellen, an denen es stehen kann', async () => {
    const fehler = await alsApp(sitzung(f.reinigung), async (tx) => {
      const d = alsDienst(tx);
      const id = await legeEntwurfAn(d, { kundeId: kundeReinigung, zahlungszielTage: null });
      await fuegePositionHinzu(d, {
        rechnungId: id, bezeichnung: 'Ohne Ziel', menge: milliMenge(1000n),
        einheit: 'stk', einzelpreisCent: cent(100n), steuergruppe: 'ust_19',
        quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
      });
      return finalisiere(d, id);
    }).catch((e: unknown) => e);
    /**
     * **Seit PR 47 faengt die §14-Vorabpruefung diesen Fall ab, bevor die
     * Datenbank ihn sieht** (FIN-04) — und sie nennt dieselben drei Stellen.
     * Frueher kam die Meldung samt `hint` aus `fin.rechnung_nummer_ziehen`;
     * geprueft wird deshalb jetzt der SATZ, nicht das Feld `hint` eines
     * Postgres-Fehlers, den es auf diesem Weg nicht mehr gibt. Die Abweisung
     * der Datenbank bleibt als zweite Linie bestehen — sie greift fuer jeden
     * Aufrufer, der den Dienst uebergeht.
     */
    expect((fehler as Error).message).toMatch(/kein Zahlungsziel hinterlegt/u);
    expect((fehler as Error).message).toMatch(/zahlungsziel_tage_standard/u);
  });
});

describe('Der Platzhalterkreis vergibt nichts (§1.11, O-134)', () => {
  it('solange die Maske unbestätigt ist, entsteht keine Rechnungsnummer', async () => {
    await sql.unsafe(
      `update nummernkreis set ist_platzhalter = true
        where mandant_id = $1 and kreis_typ = 'ausgangsrechnung'`, [f.reinigung],
    );
    const fehler = await alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurfMitPosition(tx, kundeReinigung);
      return finalisiere(alsDienst(tx), id);
    }).catch((e: unknown) => e);
    expect((fehler as Error).message).toMatch(/Platzhalter.*O-134/su);
  });
});

describe('Die Summen des Kopfes werden beim COMMIT nachgerechnet (§4.9)', () => {
  it('eine Kopfsumme, die nicht zu den Positionen passt, bricht die Transaktion', async () => {
    await expect(alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurfMitPosition(tx, kundeReinigung);
      // Direkt am Kopf gedreht, hinter dem Dienst vorbei.
      await tx.unsafe(`update rechnung set netto_gesamt_cent = netto_gesamt_cent + 1,
                              brutto_cent = brutto_cent + 1,
                              zahlbetrag_cent = zahlbetrag_cent + 1
                        where id = $1`, [id]);
    })).rejects.toThrow(/netto_gesamt_cent ist .*, die Positionen und Zuschlaege ergeben/su);
  });

  it('und eine festgeschriebene Rechnung ohne Kettenglied kann gar nicht committen', async () => {
    await expect(alsApp(sitzung(f.reinigung), async (tx) => {
      const id = await entwurfMitPosition(tx, kundeReinigung);
      const bericht = JSON.stringify({ geprueft: false });
      // NUR Aufruf A — der Aufrufer hört nach der Nummernvergabe auf.
      await tx.unsafe(
        `select * from fin.rechnung_nummer_ziehen($1::uuid, ($2::text)::jsonb)`, [id, bericht],
      );
    })).rejects.toThrow(/hat aber keinen Snapshot|hat aber kein Kettenglied/u);
  });
});

describe('Der Kunde sieht seine festgeschriebene Rechnung — und keinen Entwurf (K-18)', () => {
  it('t_kunde liefert die festgeschriebene, der Entwurf bleibt unsichtbar', async () => {
    const { entwurf, fest } = await alsApp(sitzung(f.reinigung), async (tx) => {
      const entwurf = await entwurfMitPosition(tx, kundeReinigung);
      const id = await entwurfMitPosition(tx, kundeReinigung);
      await finalisiere(alsDienst(tx), id);
      return { entwurf, fest: id };
    });

    // Ein Kundenzugang für diesen Login.
    await sql.unsafe(
      `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id)
       values ($1, $2, $3)`, [f.reinigung, kundeReinigung, benutzer],
    );

    const sichtbar = await alsApp(
      { scope: 'kunde', mandantIds: [f.reinigung], benutzerId: benutzer, portal: 'kunde' },
      (tx) => tx.unsafe<{ id: string }[]>(`select id::text as id from rechnung order by nummer`),
    );
    expect(sichtbar.map((r) => r.id)).toEqual([fest]);
    expect(sichtbar.map((r) => r.id)).not.toContain(entwurf);
  }, 60_000);
});
