/**
 * OPS-01/OPS-02/OPS-03 — Objekt, Raumbuch und Belagsart-Katalog, an der
 * DATENBANK geprueft.
 *
 * Drei Dinge stehen hier auf dem Spiel, und alle drei fallen leise aus:
 *
 *  1. **Die Marge.** `leistungswert_qm_pro_stunde` ist die Zahl, aus der ein
 *     Preis entsteht. Liegt sie im Kundenportal offen, rechnet der Kunde jedes
 *     Angebot nach — ohne dass irgendetwas kaputtgeht.
 *  2. **Der natuerliche Schluessel des Raumbuchs.** Faellt "101" im UG mit
 *     "101" im 1. OG zusammen, verschwinden Quadratmeter aus
 *     `Σ m² ÷ Leistungswert`. Das Angebot ist dann zu billig, die Rechnung
 *     dazu korrekt, und niemand merkt es.
 *  3. **Die Kundensicht.** Ein Objekt ohne Kundenbezug gehoert niemandem, und
 *     ein Kunde sieht die Objekte des Nachbarkunden derselben Gesellschaft
 *     nicht.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel],
  );
  return r!.id;
}

async function konto(opts: { faktor?: boolean } = {}): Promise<string> {
  const email = `objekt-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email],
  );
  // `super_admin` traegt erfordert_2fa; ohne Faktor weist der Ausloeser auf
  // `benutzer` das aktive Konto ab (AUT-02) — richtig so, also hier erfuellen.
  if (opts.faktor === true) {
    await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  }
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email],
  );
  return u!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, await rolleId(rolle)],
  );
}

async function belagsart(mandant: string, felder: Partial<{
  code: string; wert: number; ab: string; bis: string | null;
}> = {}): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                            quelle, gueltig_ab, gueltig_bis)
     values ($1,$2,$2,$3,'Platzhalter (O-17)',$4,$5) returning id`,
    [mandant, felder.code ?? `PVC-${zufall()}`, felder.wert ?? 250,
     felder.ab ?? '2026-01-01', felder.bis ?? null],
  );
  return z!.id;
}

async function kunde(mandant: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,'Testkunde','bestandskunde','Vertrag 2026-01', now(), 'aktiv')
     returning id`,
    [mandant, `K-${zufall()}`],
  );
  return z!.id;
}

async function objekt(mandant: string, kundeId: string | null, felder: Partial<{
  nummer: string; bemerkung: string; zutritt: string;
}> = {}): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung,
                         strasse, plz, ort, bemerkung, zutritt_hinweis)
     values ($1,$2,$3,'Buerohaus','Kurfuerstendamm 21','10719','Berlin',$4,$5)
     returning id`,
    [mandant, kundeId, felder.nummer ?? `OBJ-${zufall()}`,
     felder.bemerkung ?? 'Interne Notiz: zahlt schleppend',
     felder.zutritt ?? 'Schluessel beim Hausmeister, Code 4711'],
  );
  return z!.id;
}

async function raum(mandant: string, objektId: string, felder: Partial<{
  nummer: string | null; etage: string | null; flaeche: number; belagsartId: string | null;
  quelle: string | null; archiviert: boolean; bemerkung: string | null;
}> = {}): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into raum (mandant_id, objekt_id, raumnummer, etage, flaeche_qm,
                       belagsart_id, quell_schluessel, archiviert_am, bemerkung)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [mandant, objektId, felder.nummer === undefined ? '101' : felder.nummer,
     felder.etage === undefined ? 'EG' : felder.etage, felder.flaeche ?? 25,
     felder.belagsartId ?? null, felder.quelle ?? null,
     felder.archiviert === true ? new Date() : null,
     felder.bemerkung === undefined ? null : felder.bemerkung],
  );
  return z!.id;
}

/** Ein Kundenzugang: dieses Konto sieht genau diesen Kunden. */
async function kundenzugang(benutzer: string, mandant: string, kundeId: string): Promise<void> {
  await sql.unsafe(
    `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id) values ($1,$2,$3)`,
    [mandant, kundeId, benutzer],
  );
}

let chef = '';      // leitung in reinigung — haelt objekt.lesen und objekt.schreiben
let arbeiter = '';  // mitarbeiter in reinigung — haelt objekt.lesen NICHT
let kundeKonto = '';

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  await mitglied(chef, f.reinigung, 'leitung');
  arbeiter = await konto();
  await mitglied(arbeiter, f.reinigung, 'mitarbeiter');
  kundeKonto = await konto();
  await mitglied(kundeKonto, f.reinigung, 'kunde');
});
afterAll(schliessen);

/** Eine Sitzung im internen Portal des Reinigungsmandanten. */
const alsChef = <T>(fn: (tx: Parameters<Parameters<typeof alsApp>[1]>[0]) => Promise<T>,
                    mandant = ''): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: mandant === '' ? f.reinigung : mandant,
           benutzerId: chef, portal: 'intern', readonly: false }, fn);

describe('(1) Mandantentrennung — die erste Linie', () => {
  it('ein Objekt der Reinigung ist im Bereich Security nicht da', async () => {
    const o = await objekt(f.reinigung, null);
    await mitglied(chef, f.security, 'leitung');
    const gesehen = await alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: chef, portal: 'intern' },
      async (tx) => tx.unsafe(`select id from objekt where id = $1`, [o]),
    );
    expect(gesehen).toHaveLength(0);
  });

  it('und der Raum darin genauso wenig', async () => {
    const o = await objekt(f.reinigung, null);
    const r = await raum(f.reinigung, o);
    await mitglied(chef, f.security, 'leitung');
    const gesehen = await alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: chef, portal: 'intern' },
      async (tx) => tx.unsafe(`select id from raum where id = $1`, [r]),
    );
    expect(gesehen).toHaveLength(0);
  });

  it('ein Objekt mit FREMDER mandant_id laesst sich nicht anlegen', async () => {
    await expect(alsChef(async (tx) => tx.unsafe(
      `insert into objekt (mandant_id, objektnummer, bezeichnung, strasse, plz, ort)
       values ($1,'X-1','Fremd','Strasse 1','10719','Berlin')`, [f.security],
    ))).rejects.toThrow(/row-level security/u);
  });

  it('wer objekt.lesen nicht haelt, sieht KEINE Objekte — auch im eigenen Bereich', async () => {
    const o = await objekt(f.reinigung, null);
    const gesehen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: arbeiter, portal: 'mitarbeiter' },
      async (tx) => tx.unsafe(`select id from objekt where id = $1`, [o]),
    );
    expect(gesehen).toHaveLength(0);
  });

  it('und wer objekt.schreiben nicht haelt, legt keines an', async () => {
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: arbeiter,
        portal: 'mitarbeiter', readonly: false },
      async (tx) => tx.unsafe(
        `insert into objekt (mandant_id, objektnummer, bezeichnung, strasse, plz, ort)
         values ($1,'X-2','Neu','Strasse 1','10719','Berlin')`, [f.reinigung]),
    )).rejects.toThrow(/row-level security/u);
  });

  it('eine readonly-Sitzung schreibt nicht, auch mit vollem Recht', async () => {
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: chef,
        portal: 'intern', readonly: true },
      async (tx) => tx.unsafe(
        `insert into objekt (mandant_id, objektnummer, bezeichnung, strasse, plz, ort)
         values ($1,'X-3','Neu','Strasse 1','10719','Berlin')`, [f.reinigung]),
    )).rejects.toThrow(/row-level security/u);
  });
});

describe('(2) Gruppensicht — sichtbar, aber nur lesend (Invariante 10)', () => {
  it('die Gruppensicht sieht Objekte mehrerer Gesellschaften', async () => {
    const a = await objekt(f.reinigung, null);
    const b = await objekt(f.security, null);
    const chefGlobal = await konto({ faktor: true });
    await sql.unsafe(`update benutzer set globale_rolle_id = $1 where id = $2`,
                     [await rolleId('super_admin'), chefGlobal]);
    const gesehen = await alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung, f.security], benutzerId: chefGlobal },
      async (tx) => tx.unsafe<{ id: string }[]>(
        `select id from objekt where id = any($1::uuid[]) order by objektnummer`, [[a, b]]),
    );
    expect(gesehen).toHaveLength(2);
  });

  it('und schreibt dort nichts', async () => {
    const chefGlobal = await konto({ faktor: true });
    await sql.unsafe(`update benutzer set globale_rolle_id = $1 where id = $2`,
                     [await rolleId('super_admin'), chefGlobal]);
    await expect(alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung], benutzerId: chefGlobal, readonly: false },
      async (tx) => tx.unsafe(
        `insert into objekt (mandant_id, objektnummer, bezeichnung, strasse, plz, ort)
         values ($1,'G-1','Gruppe','Strasse 1','10719','Berlin')`, [f.reinigung]),
    )).rejects.toThrow(/row-level security/u);
  });

  it('ohne gruppe.objekt.lesen bleibt die Gruppensicht leer', async () => {
    const o = await objekt(f.reinigung, null);
    // `leitung` haelt objekt.lesen, aber kein gruppe.* — die Gruppensicht ist
    // ein eigenes Recht, kein Nebeneffekt des Mandantenrechts.
    const gesehen = await alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung], benutzerId: chef },
      async (tx) => tx.unsafe(`select id from objekt where id = $1`, [o]),
    );
    expect(gesehen).toHaveLength(0);
  });
});

describe('(3) Kundenportal — die Decke (K-04, K-18 Scope 4)', () => {
  it('der Kunde sieht SEIN Objekt', async () => {
    const k = await kunde(f.reinigung);
    const o = await objekt(f.reinigung, k);
    await kundenzugang(kundeKonto, f.reinigung, k);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto },
      async (tx) => tx.unsafe(`select id from objekt where id = $1`, [o]),
    );
    expect(gesehen).toHaveLength(1);
  });

  it('nicht das des Nachbarkunden derselben Gesellschaft', async () => {
    const meiner = await kunde(f.reinigung);
    const fremder = await kunde(f.reinigung);
    const o = await objekt(f.reinigung, fremder);
    await kundenzugang(kundeKonto, f.reinigung, meiner);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto },
      async (tx) => tx.unsafe(`select id from objekt where id = $1`, [o]),
    );
    expect(gesehen).toHaveLength(0);
  });

  it('und ein Objekt OHNE Kundenbezug gehoert niemandem — auch ihm nicht', async () => {
    const k = await kunde(f.reinigung);
    const herrenlos = await objekt(f.reinigung, null);
    await kundenzugang(kundeKonto, f.reinigung, k);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto },
      async (tx) => tx.unsafe(`select id from objekt where id = $1`, [herrenlos]),
    );
    expect(gesehen).toHaveLength(0);
  });

  it('er sieht die Raeume SEINES Objekts', async () => {
    const k = await kunde(f.reinigung);
    const o = await objekt(f.reinigung, k);
    const r = await raum(f.reinigung, o);
    await kundenzugang(kundeKonto, f.reinigung, k);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto },
      async (tx) => tx.unsafe(`select id from raum where id = $1`, [r]),
    );
    expect(gesehen).toHaveLength(1);
  });

  it('nicht die eines fremden Objekts', async () => {
    const meiner = await kunde(f.reinigung);
    const fremder = await kunde(f.reinigung);
    const o = await objekt(f.reinigung, fremder);
    const r = await raum(f.reinigung, o);
    await kundenzugang(kundeKonto, f.reinigung, meiner);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto },
      async (tx) => tx.unsafe(`select id from raum where id = $1`, [r]),
    );
    expect(gesehen).toHaveLength(0);
  });

  /**
   * Der Schreibversuch aus dem Kundenportal trifft NULL Zeilen statt zu
   * werfen — und das ist die richtige Form, nicht die schwaechere.
   *
   * `t_kunde` ist eine reine SELECT-Policy; fuer ein UPDATE zaehlt `t_mandant`,
   * und `app.aktiver_mandant()` ist im Kundenbereich NULL (K-20). Die Zeile ist
   * fuer das UPDATE also gar nicht sichtbar. Postgres aendert dann nichts und
   * meldet nichts — genau die 404-Antwort, die AUT-06/SEC-A3 verlangt: ein
   * Fehler verriete, dass die Zeile existiert. Geprueft wird deshalb beides:
   * null betroffene Zeilen UND ein unveraenderter Wert.
   */
  it('das Raumbuch ist fuer ihn LESBAR, und ein Schreibversuch trifft NICHTS', async () => {
    const k = await kunde(f.reinigung);
    const o = await objekt(f.reinigung, k);
    const r = await raum(f.reinigung, o, { flaeche: 25 });
    await kundenzugang(kundeKonto, f.reinigung, k);
    const betroffen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto, readonly: false },
      async (tx) => (await tx.unsafe(
        `update raum set flaeche_qm = 999 where id = $1`, [r])).count,
    );
    expect(betroffen).toBe(0);
    const [z] = await sql.unsafe<{ flaeche_qm: string }[]>(
      `select flaeche_qm from raum where id = $1`, [r]);
    expect(Number(z!.flaeche_qm)).toBe(25);
  });

  /** Ein INSERT dagegen hat keine USING-Klausel, an der er sich vorbeidruecken
   *  koennte — er trifft die WITH CHECK und wird abgewiesen. */
  it('und ein INSERT aus dem Kundenportal wird abgewiesen', async () => {
    const k = await kunde(f.reinigung);
    const o = await objekt(f.reinigung, k);
    await kundenzugang(kundeKonto, f.reinigung, k);
    await expect(alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto, readonly: false },
      async (tx) => tx.unsafe(
        `insert into raum (mandant_id, objekt_id, raumnummer, etage, flaeche_qm)
         values ($1,$2,'999','EG',10)`, [f.reinigung, o]),
    )).rejects.toThrow(/row-level security/u);
  });

  it('der Belagsart-Katalog ist im Kundenportal GAR nicht da', async () => {
    const k = await kunde(f.reinigung);
    const b = await belagsart(f.reinigung);
    await kundenzugang(kundeKonto, f.reinigung, k);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto },
      async (tx) => tx.unsafe(`select id from belagsart where id = $1`, [b]),
    );
    expect(gesehen).toHaveLength(0);
  });

  it('und die Reinigungsklassen ebenso wenig', async () => {
    const k = await kunde(f.reinigung);
    const [rk] = await sql.unsafe<{ id: string }[]>(
      `insert into reinigungsklasse (mandant_id, code, bezeichnung)
       values ($1,'RK1','Bueroraum') returning id`, [f.reinigung],
    );
    await kundenzugang(kundeKonto, f.reinigung, k);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto },
      async (tx) => tx.unsafe(`select id from reinigungsklasse where id = $1`, [rk!.id]),
    );
    expect(gesehen).toHaveLength(0);
  });

  /**
   * Der Beweis, dass die DECKE haelt — und nicht nur das fehlende Recht.
   *
   * Ohne diesen Fall waere `p_intern_decke` unpruefbar: die Mitarbeiterrolle
   * traegt `objekt.lesen` ohnehin nicht, und jede Ablehnung liesse sich auf
   * das fehlende Recht schieben. Hier bekommt sie das Recht ausdruecklich —
   * und der Katalog bleibt trotzdem zu, weil das Mitarbeiterportal ihn nicht
   * sehen darf.
   */
  it('auch MIT objekt.lesen bleibt der Katalog ausserhalb des internen Portals zu', async () => {
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, gewaehrt)
       select $1, b.id, true from berechtigung b where b.schluessel = 'objekt.lesen'`,
      [await rolleId('mitarbeiter')]);
    const b = await belagsart(f.reinigung);
    const o = await objekt(f.reinigung, null);

    const sitzung = { scope: 'mandant' as const, mandantId: f.reinigung,
                      benutzerId: arbeiter, portal: 'mitarbeiter' as const };
    // Das Recht wirkt: das Objekt ist jetzt sichtbar …
    const objekte = await alsApp(sitzung,
      async (tx) => tx.unsafe(`select id from objekt where id = $1`, [o]));
    expect(objekte).toHaveLength(1);
    // … der Katalog aber nicht.
    const katalog = await alsApp(sitzung,
      async (tx) => tx.unsafe(`select id from belagsart where id = $1`, [b]));
    expect(katalog).toHaveLength(0);
  });

  it('ein ENTZOGENER Zugang sieht nichts mehr', async () => {
    const k = await kunde(f.reinigung);
    const o = await objekt(f.reinigung, k);
    await kundenzugang(kundeKonto, f.reinigung, k);
    await sql.unsafe(`update kunde_zugang set entzogen_am = now() where benutzer_id = $1`,
                     [kundeKonto]);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto },
      async (tx) => tx.unsafe(`select id from objekt where id = $1`, [o]),
    );
    expect(gesehen).toHaveLength(0);
  });
});

describe('(4) K-05 — die Spalten, die die Zeile mitbringt und nicht jeder liest', () => {
  it('der Leistungswert ist fuer cse_app nicht SELECT-bar', async () => {
    await belagsart(f.reinigung);
    await expect(alsChef(async (tx) =>
      tx.unsafe(`select leistungswert_qm_pro_stunde from belagsart`),
    )).rejects.toThrow(/permission denied/u);
  });

  it('auch nicht ueber eine WHERE-Bedingung — der Umweg, der sonst bleibt', async () => {
    await belagsart(f.reinigung, { wert: 250 });
    await expect(alsChef(async (tx) =>
      tx.unsafe(`select id from belagsart where leistungswert_qm_pro_stunde > 100`),
    )).rejects.toThrow(/permission denied/u);
  });

  it('auch nicht per select *', async () => {
    await belagsart(f.reinigung);
    await expect(alsChef(async (tx) => tx.unsafe(`select * from belagsart`)))
      .rejects.toThrow(/permission denied/u);
  });

  it('die uebrigen Katalogspalten bleiben lesbar', async () => {
    const b = await belagsart(f.reinigung, { code: 'PVC-A' });
    const zeilen = await alsChef(async (tx) => tx.unsafe<{ code: string }[]>(
      `select code, bezeichnung, gueltig_ab from belagsart where id = $1`, [b]));
    expect(zeilen[0]?.code).toBe('PVC-A');
  });

  it('interne Objektnotizen sind entzogen — bemerkung wie zutritt_hinweis', async () => {
    await objekt(f.reinigung, null);
    await expect(alsChef(async (tx) => tx.unsafe(`select bemerkung from objekt`)))
      .rejects.toThrow(/permission denied/u);
    await expect(alsChef(async (tx) => tx.unsafe(`select zutritt_hinweis from objekt`)))
      .rejects.toThrow(/permission denied/u);
  });

  it('und die Raumbemerkung ebenso', async () => {
    const o = await objekt(f.reinigung, null);
    await raum(f.reinigung, o, { bemerkung: 'Schluessel im Kasten' });
    await expect(alsChef(async (tx) => tx.unsafe(`select bemerkung from raum`)))
      .rejects.toThrow(/permission denied/u);
  });

  it('app.leistungswerte_lesen gibt den Katalog — intern, mit objekt.lesen', async () => {
    await belagsart(f.reinigung, { code: 'PVC-B', wert: 250 });
    const zeilen = await alsChef(async (tx) => tx.unsafe<{ code: string; wert: string }[]>(
      `select code, leistungswert_qm_pro_stunde as wert from app.leistungswerte_lesen()`));
    expect(zeilen).toHaveLength(1);
    expect(Number(zeilen[0]?.wert)).toBe(250);
  });

  it('sie beachtet den Stichtag — ein abgeloester Wert kommt nicht zurueck', async () => {
    await belagsart(f.reinigung, { code: 'ALT', ab: '2020-01-01', bis: '2025-12-31' });
    await belagsart(f.reinigung, { code: 'ALT', ab: '2026-01-01' });
    const heute = await alsChef(async (tx) => tx.unsafe<{ wert: string }[]>(
      `select leistungswert_qm_pro_stunde as wert from app.leistungswerte_lesen('2026-06-01')`));
    expect(heute).toHaveLength(1);
    const frueher = await alsChef(async (tx) => tx.unsafe<{ wert: string }[]>(
      `select leistungswert_qm_pro_stunde as wert from app.leistungswerte_lesen('2021-06-01')`));
    expect(frueher).toHaveLength(1);
  });

  it('sie sieht NUR den eigenen Mandanten', async () => {
    await belagsart(f.security, { code: 'FREMD' });
    const zeilen = await alsChef(async (tx) => tx.unsafe(
      `select code from app.leistungswerte_lesen()`));
    expect(zeilen).toHaveLength(0);
  });

  it('im Kundenportal wirft sie — der Definer erbt die Decke nicht, er prueft sie', async () => {
    const k = await kunde(f.reinigung);
    await belagsart(f.reinigung);
    await kundenzugang(kundeKonto, f.reinigung, k);
    await expect(alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto },
      async (tx) => tx.unsafe(`select * from app.leistungswerte_lesen()`),
    )).rejects.toThrow(/nicht lesbar/u);
  });

  it('ohne objekt.lesen wirft sie ebenfalls', async () => {
    await belagsart(f.reinigung);
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: arbeiter, portal: 'intern' },
      async (tx) => tx.unsafe(`select * from app.leistungswerte_lesen()`),
    )).rejects.toThrow(/objekt\.lesen fehlt/u);
  });

  it('app.objekt_notiz_lesen gibt beide Notizen zurueck', async () => {
    const o = await objekt(f.reinigung, null,
                           { bemerkung: 'zahlt schleppend', zutritt: 'Code 4711' });
    const [z] = await alsChef(async (tx) =>
      tx.unsafe<{ bemerkung: string; zutritt_hinweis: string }[]>(
        `select * from app.objekt_notiz_lesen($1)`, [o]));
    expect(z?.bemerkung).toBe('zahlt schleppend');
    expect(z?.zutritt_hinweis).toBe('Code 4711');
  });

  it('fuer ein FREMDES Objekt gibt sie nichts zurueck — 404, nicht 403 (SEC-A3)', async () => {
    const fremd = await objekt(f.security, null);
    const zeilen = await alsChef(async (tx) =>
      tx.unsafe(`select * from app.objekt_notiz_lesen($1)`, [fremd]));
    expect(zeilen).toHaveLength(0);
  });

  it('und im Kundenportal wirft sie', async () => {
    const k = await kunde(f.reinigung);
    const o = await objekt(f.reinigung, k);
    await kundenzugang(kundeKonto, f.reinigung, k);
    await expect(alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto },
      async (tx) => tx.unsafe(`select * from app.objekt_notiz_lesen($1)`, [o]),
    )).rejects.toThrow(/nicht lesbar/u);
  });

  it('app.raum_notizen_lesen liefert ein Ergebnis je Objekt, nicht je Raum', async () => {
    const o = await objekt(f.reinigung, null);
    await raum(f.reinigung, o, { nummer: '101', bemerkung: 'A' });
    await raum(f.reinigung, o, { nummer: '102', bemerkung: 'B' });
    await raum(f.reinigung, o, { nummer: '103' });
    const zeilen = await alsChef(async (tx) => tx.unsafe<{ bemerkung: string }[]>(
      `select bemerkung from app.raum_notizen_lesen($1) order by bemerkung`, [o]));
    expect(zeilen.map((z) => z.bemerkung)).toEqual(['A', 'B']);
  });
});

describe('(5) Der natuerliche Schluessel des Raumbuchs — der teure Fehler', () => {
  it('zweimal derselbe Raum auf derselben Etage geht nicht', async () => {
    const o = await objekt(f.reinigung, null);
    await raum(f.reinigung, o, { nummer: '101', etage: 'EG' });
    await expect(raum(f.reinigung, o, { nummer: '101', etage: 'EG' }))
      .rejects.toThrow(/raum_natuerlich_uk/u);
  });

  it('ABER "101" im UG und "101" im 1. OG sind zwei Raeume', async () => {
    const o = await objekt(f.reinigung, null);
    await raum(f.reinigung, o, { nummer: '101', etage: 'UG', flaeche: 30 });
    await raum(f.reinigung, o, { nummer: '101', etage: '1', flaeche: 40 });
    const [z] = await sql.unsafe<{ summe: string }[]>(
      `select sum(flaeche_qm)::text as summe from raum where objekt_id = $1`, [o]);
    expect(Number(z!.summe)).toBe(70);
  });

  it('und zweimal dieselbe Nummer OHNE Etage ist ebenfalls ein Duplikat', async () => {
    // Ohne `coalesce(etage,'')` waeren zwei NULL-Etagen fuer den Index
    // verschieden, und der Flur kaeme bei jedem Import erneut hinein.
    const o = await objekt(f.reinigung, null);
    await raum(f.reinigung, o, { nummer: 'Flur', etage: null });
    await expect(raum(f.reinigung, o, { nummer: 'Flur', etage: null }))
      .rejects.toThrow(/raum_natuerlich_uk/u);
  });

  it('ein Raum OHNE Nummer ist erlaubt — Flure haben keine', async () => {
    const o = await objekt(f.reinigung, null);
    await raum(f.reinigung, o, { nummer: null, etage: 'EG' });
    await raum(f.reinigung, o, { nummer: null, etage: 'EG' });
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from raum where objekt_id = $1`, [o]);
    expect(Number(z!.n)).toBe(2);
  });

  it('ein archivierter Raum gibt seinen Schluessel frei', async () => {
    const o = await objekt(f.reinigung, null);
    await raum(f.reinigung, o, { nummer: '101', etage: 'EG', archiviert: true });
    await raum(f.reinigung, o, { nummer: '101', etage: 'EG' });
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from raum where objekt_id = $1`, [o]);
    expect(Number(z!.n)).toBe(2);
  });

  it('derselbe Quellschluessel kommt kein zweites Mal herein — Import ist idempotent', async () => {
    const o = await objekt(f.reinigung, null);
    await raum(f.reinigung, o, { nummer: '201', quelle: 'zeile-7' });
    await expect(raum(f.reinigung, o, { nummer: '202', quelle: 'zeile-7' }))
      .rejects.toThrow(/raum_quelle_uk/u);
  });

  it('eine Flaeche von 0 ist kein Raum', async () => {
    const o = await objekt(f.reinigung, null);
    await expect(raum(f.reinigung, o, { flaeche: 0 }))
      .rejects.toThrow(/raum_flaeche_positiv/u);
  });
});

describe('(6) Struktur: die Fremdschluessel tragen den Mandanten mit', () => {
  it('ein Raum kann keine Belagsart einer ANDEREN Gesellschaft tragen', async () => {
    const o = await objekt(f.reinigung, null);
    const fremd = await belagsart(f.security);
    await expect(raum(f.reinigung, o, { belagsartId: fremd }))
      .rejects.toThrow(/raum_belagsart_fk/u);
  });

  it('ein Objekt kann keinen Kunden einer anderen Gesellschaft tragen', async () => {
    const fremd = await kunde(f.security);
    await expect(objekt(f.reinigung, fremd)).rejects.toThrow(/objekt_kunde_fk/u);
  });

  it('und keinen Ansprechpartner eines ANDEREN Kunden desselben Mandanten', async () => {
    const meiner = await kunde(f.reinigung);
    const fremder = await kunde(f.reinigung);
    const [ap] = await sql.unsafe<{ id: string }[]>(
      `insert into ansprechpartner (mandant_id, kunde_id, nachname, rechtsgrundlage,
                                    rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am)
       values ($1,$2,'Fremd','bestandskunde','Vertrag', now()) returning id`,
      [f.reinigung, fremder],
    );
    await expect(sql.unsafe(
      `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort,
                           ansprechpartner_id)
       values ($1,$2,'OBJ-AP','Haus','Strasse 1','10719','Berlin',$3)`,
      [f.reinigung, meiner, ap!.id],
    )).rejects.toThrow(/objekt_ansprechpartner_fk/u);
  });

  it('Geokoordinaten gibt es ganz oder gar nicht', async () => {
    await expect(sql.unsafe(
      `insert into objekt (mandant_id, objektnummer, bezeichnung, strasse, plz, ort, geo_lat)
       values ($1,'GEO-1','Haus','Strasse 1','10719','Berlin', 52.5)`, [f.reinigung],
    )).rejects.toThrow(/objekt_geo_vollstaendig/u);
  });

  it('zwei ueberlappende Gueltigkeiten derselben Belagsart schliessen sich aus', async () => {
    await belagsart(f.reinigung, { code: 'LINO', ab: '2026-01-01', bis: null });
    await expect(belagsart(f.reinigung, { code: 'LINO', ab: '2026-06-01' }))
      .rejects.toThrow(/belagsart_zeitraum_eindeutig/u);
  });

  it('auch am WECHSELTAG — gueltig_bis ist einschliesslich', async () => {
    await belagsart(f.reinigung, { code: 'LINO2', ab: '2026-01-01', bis: '2026-03-01' });
    await expect(belagsart(f.reinigung, { code: 'LINO2', ab: '2026-03-01' }))
      .rejects.toThrow(/belagsart_zeitraum_eindeutig/u);
    // Der Tag DANACH ist die richtige Fortsetzung — und die geht.
    await belagsart(f.reinigung, { code: 'LINO2', ab: '2026-03-02' });
  });

  it('ein negativer Leistungswert ist keiner', async () => {
    await expect(belagsart(f.reinigung, { wert: 0 }))
      .rejects.toThrow(/belagsart_leistungswert_positiv/u);
  });
});

describe('(7) Loeschsperre, geaendert_am und Audit', () => {
  it('kein DELETE auf objekt, raum, belagsart, reinigungsklasse', async () => {
    const o = await objekt(f.reinigung, null);
    const r = await raum(f.reinigung, o);
    const b = await belagsart(f.reinigung);
    for (const [tabelle, id] of [['objekt', o], ['raum', r], ['belagsart', b]] as const) {
      await expect(sql.unsafe(`delete from ${tabelle} where id = $1`, [id]))
        .rejects.toThrow(/Hard delete .* ist gesperrt/u);
    }
  });

  it('geaendert_am setzt die Datenbank, nicht der Aufrufer', async () => {
    const o = await objekt(f.reinigung, null);
    await sql.unsafe(
      `update objekt set bezeichnung = 'Neu', geaendert_am = '2000-01-01T00:00:00Z' where id = $1`,
      [o],
    );
    const [z] = await sql.unsafe<{ geaendert_am: Date }[]>(
      `select geaendert_am from objekt where id = $1`, [o]);
    expect(z!.geaendert_am.getUTCFullYear()).toBeGreaterThan(2020);
  });

  /** Gezaehlt wird VORHER und NACHHER: das Protokoll selbst ist append-only,
   *  es laesst sich fuer einen Test nicht leeren (Invariante 8). */
  const auditZeilen = async (typ: string): Promise<number> => {
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log where objekt_typ = $1`, [typ]);
    return Number(z!.n);
  };

  it('eine Aenderung am Leistungswert steht im Audit', async () => {
    const b = await belagsart(f.reinigung);
    const vorher = await auditZeilen('belagsart');
    await sql.unsafe(
      `update belagsart set leistungswert_qm_pro_stunde = 300 where id = $1`, [b]);
    expect(await auditZeilen('belagsart')).toBe(vorher + 1);
  });

  it('ein importiertes Raumbuch dagegen NICHT — sonst ertraenkt es das Protokoll', async () => {
    const o = await objekt(f.reinigung, null);
    const vorher = await auditZeilen('raum');
    for (let i = 0; i < 5; i += 1) await raum(f.reinigung, o, { nummer: `R${String(i)}` });
    expect(await auditZeilen('raum')).toBe(vorher);
  });
});
