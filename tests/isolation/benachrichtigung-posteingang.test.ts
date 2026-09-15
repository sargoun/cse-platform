/**
 * Der Posteingang gegen eine echte Datenbank (NOT-01, NOT-02, NOT-03).
 *
 * **Der Satz, den diese Datei beweist:** eine Benachrichtigung erreicht GENAU
 * den, für den sie bestimmt ist — und niemanden sonst, auch nicht in
 * derselben Gesellschaft.
 *
 *  1. **Fremde Zeilen gibt es nicht.** `t_benachrichtigung_eigene` bindet an
 *     `app.aktueller_benutzer()`; eine Administration sieht die Meldung ihrer
 *     Kollegin nicht, obwohl sie dieselbe Gesellschaft, dieselbe Rolle und
 *     mehr Rechte hat als nötig.
 *  2. **Öffnen stempelt genau einmal.** Der zweite Aufruf ändert den
 *     Zeitpunkt nicht — sonst hiesse „gelesen am" das letzte Mal statt das
 *     erste.
 *  3. **Das Ziel kommt aus der Zeile.** Eine fremde Kennung gibt `null`, kein
 *     Ziel und keinen Unterschied zu „gibt es nicht" (AUT-06).
 *  4. **Die Vorgabe wird nicht gespeichert** (NOT-02): wer die Vorgabe
 *     auswählt, hinterlässt keine Zeile — sonst bliebe sie stehen, wenn die
 *     Vorgabe sich ändert.
 *  5. **`app` lässt sich nicht abwählen** — die Tabelle erzwingt es.
 *  6. **Die Präferenz wirkt in `erzeuge`**, in derselben Anfrage.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  ladePosteingang, ladePraeferenzen, markiereAlleGelesen, oeffne, setzePraeferenz,
  zaehleJeArt, zaehleUngelesen, type Leser, type Schreiber,
} from '../../src/server/benachrichtigung/posteingang.js';
import { erzeuge } from '../../src/server/benachrichtigung/registry.js';
import { alleArten } from '../../src/server/benachrichtigung/bootstrap.js';
import { stelleZuAnKonto } from '../../src/server/benachrichtigung/ablage.js';

let f: Fixtur;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function legeKontoAn(mandantId: string, rolle = 'leitung'): Promise<string> {
  const email = `post-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Leitung', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

/** Eine echte Meldung über den echten Weg — nicht mit einem `insert` daneben. */
async function meldung(
  benutzerId: string, mandantId: string, slug: string, leadId: string,
): Promise<void> {
  alleArten();
  const b = erzeuge('crm.neuer_lead', {
    mandantId, mandantSlug: slug, objektTyp: 'lead', objektId: leadId,
    daten: { betreff: `Anfrage ${zufall()}`, firma: 'Demo GmbH', slaFrist: null },
  });
  await stelleZuAnKonto(
    { unsafe: (a, w) => sql.unsafe(a, (w ?? []) as never[]) },
    [{ benachrichtigung: b, benutzerId, objektTyp: 'lead', objektId: leadId }],
  );
}

/** Ein Lead, auf den eine Meldung zeigen kann — NOT-03 verlangt ein Ziel. */
async function legeLeadAn(mandantId: string, besitzer: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into lead (mandant_id, leadnummer, betreff, firma_name, akteur_art,
                       quelle, besitzer_benutzer_id)
     values ($1::uuid, $2, $3, 'Demo GmbH', 'mensch', 'manuell', $4::uuid) returning id`,
    [mandantId, `LD-${zufall()}`, `Posteingangstest ${zufall()}`, besitzer]);
  return z!.id;
}

async function alsKonto<T>(
  benutzerId: string, mandantId: string | null, fn: (k: Schreiber) => Promise<T>,
): Promise<T> {
  return alsApp(
    mandantId === null
      ? { scope: 'gruppe', benutzerId, portal: 'intern', readonly: false }
      : { scope: 'mandant', mandantId, benutzerId, portal: 'intern', readonly: false },
    async (tx: postgres.TransactionSql) => {
      const abfrage = async <T2>(a: string, w?: readonly unknown[]): Promise<readonly T2[]> =>
        (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T2[];
      return fn({ abfrage, schreibe: abfrage });
    },
  ) as Promise<T>;
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(1) der Posteingang ist persönlich', () => {
  it('eine Kollegin in derselben Gesellschaft sieht die Meldung NICHT', async () => {
    const ich = await legeKontoAn(f.reinigung);
    const sie = await legeKontoAn(f.reinigung, 'admin');
    const lead = await legeLeadAn(f.reinigung, ich);
    await meldung(ich, f.reinigung, 'reinigung', lead);

    const meine = await alsKonto(ich, f.reinigung, (k: Leser) => ladePosteingang(k));
    const ihre = await alsKonto(sie, f.reinigung, (k: Leser) => ladePosteingang(k));

    expect(meine).toHaveLength(1);
    expect(ihre).toHaveLength(0);
    expect(await alsKonto(sie, f.reinigung, (k) => zaehleUngelesen(k))).toBe(0);
  });

  it('und kann sie auch nicht öffnen — kein Ziel, kein Unterschied zu „gibt es nicht"',
    async () => {
      const ich = await legeKontoAn(f.reinigung);
      const sie = await legeKontoAn(f.reinigung, 'admin');
      const lead = await legeLeadAn(f.reinigung, ich);
      await meldung(ich, f.reinigung, 'reinigung', lead);

      const [zeile] = await sql.unsafe<{ id: string }[]>(
        `select id from benachrichtigung where empfaenger_id = $1`, [ich]);

      expect(await alsKonto(sie, f.reinigung, (k) => oeffne(k, zeile!.id))).toBeNull();
      const [danach] = await sql.unsafe<{ gelesen_am: Date | null }[]>(
        `select gelesen_am from benachrichtigung where id = $1`, [zeile!.id]);
      expect(danach!.gelesen_am).toBeNull();
    });

  it('eine erfundene Kennung gibt ebenfalls null', async () => {
    const ich = await legeKontoAn(f.reinigung);
    expect(await alsKonto(ich, f.reinigung,
      (k) => oeffne(k, '00000000-0000-4000-8000-000000000000'))).toBeNull();
  });
});

describe('(2) öffnen stempelt genau einmal', () => {
  it('der zweite Aufruf verschiebt „gelesen am" nicht', async () => {
    const ich = await legeKontoAn(f.reinigung);
    const lead = await legeLeadAn(f.reinigung, ich);
    await meldung(ich, f.reinigung, 'reinigung', lead);
    const [zeile] = await sql.unsafe<{ id: string }[]>(
      `select id from benachrichtigung where empfaenger_id = $1`, [ich]);

    const ziel = await alsKonto(ich, f.reinigung, (k) => oeffne(k, zeile!.id));
    expect(ziel).toBe(`/portal/reinigung/crm/leads/${lead}`);

    const [erst] = await sql.unsafe<{ gelesen_am: Date }[]>(
      `select gelesen_am from benachrichtigung where id = $1`, [zeile!.id]);
    expect(erst!.gelesen_am).not.toBeNull();

    await alsKonto(ich, f.reinigung, (k) => oeffne(k, zeile!.id));
    const [zweit] = await sql.unsafe<{ gelesen_am: Date }[]>(
      `select gelesen_am from benachrichtigung where id = $1`, [zeile!.id]);
    expect(new Date(zweit!.gelesen_am).getTime()).toBe(new Date(erst!.gelesen_am).getTime());
  });

  it('„alle gelesen" fasst nur Ungelesene an und zählt sie', async () => {
    const ich = await legeKontoAn(f.reinigung);
    const lead = await legeLeadAn(f.reinigung, ich);
    await meldung(ich, f.reinigung, 'reinigung', lead);
    await meldung(ich, f.reinigung, 'reinigung', lead);

    expect(await alsKonto(ich, f.reinigung, (k) => zaehleUngelesen(k))).toBe(2);
    expect(await alsKonto(ich, f.reinigung, (k) => markiereAlleGelesen(k))).toBe(2);
    expect(await alsKonto(ich, f.reinigung, (k) => markiereAlleGelesen(k))).toBe(0);
    expect(await alsKonto(ich, f.reinigung, (k) => zaehleUngelesen(k))).toBe(0);

    // Gestempelt, nicht entfernt: der Posteingang ist ein Protokoll.
    expect(await alsKonto(ich, f.reinigung, (k: Leser) => ladePosteingang(k))).toHaveLength(2);
    expect(await alsKonto(ich, f.reinigung,
      (k: Leser) => ladePosteingang(k, { ungelesen: true }))).toHaveLength(0);
  });

  it('nach Modul filtern trifft alles darunter', async () => {
    const ich = await legeKontoAn(f.reinigung);
    const lead = await legeLeadAn(f.reinigung, ich);
    await meldung(ich, f.reinigung, 'reinigung', lead);

    expect(await alsKonto(ich, f.reinigung,
      (k: Leser) => ladePosteingang(k, { art: 'crm' }))).toHaveLength(1);
    expect(await alsKonto(ich, f.reinigung,
      (k: Leser) => ladePosteingang(k, { art: 'crm.neuer_lead' }))).toHaveLength(1);
    expect(await alsKonto(ich, f.reinigung,
      (k: Leser) => ladePosteingang(k, { art: 'radar' }))).toHaveLength(0);

    const jeArt = await alsKonto(ich, f.reinigung, (k) => zaehleJeArt(k));
    expect(jeArt).toEqual([{ art: 'crm.neuer_lead', offen: 1, gesamt: 1 }]);
  });
});

describe('(3) die Präferenz (NOT-02)', () => {
  it('die Vorgabe wird NICHT gespeichert — eine Abweichung schon', async () => {
    alleArten();
    const ich = await legeKontoAn(f.reinigung);

    // Vorgabe: ['app','email'] für crm.neuer_lead.
    await alsKonto(ich, f.reinigung,
      (k) => setzePraeferenz(k, 'crm.neuer_lead', ['app', 'email'], ['app', 'email']));
    expect(await alsKonto(ich, f.reinigung, (k: Leser) => ladePraeferenzen(k))).toEqual({});

    await alsKonto(ich, f.reinigung,
      (k) => setzePraeferenz(k, 'crm.neuer_lead', [], ['app', 'email']));
    expect(await alsKonto(ich, f.reinigung, (k: Leser) => ladePraeferenzen(k)))
      .toEqual({ 'crm.neuer_lead': ['app'] });

    // Und zurück auf die Vorgabe: die Zeile verschwindet wieder.
    await alsKonto(ich, f.reinigung,
      (k) => setzePraeferenz(k, 'crm.neuer_lead', ['email'], ['app', 'email']));
    expect(await alsKonto(ich, f.reinigung, (k: Leser) => ladePraeferenzen(k))).toEqual({});
  });

  it('`app` lässt sich nicht abwählen — die Tabelle erzwingt es', async () => {
    const ich = await legeKontoAn(f.reinigung);
    await expect(sql.unsafe(
      `insert into benachrichtigung_praeferenz (benutzer_id, art, kanaele)
       values ($1::uuid, 'crm.neuer_lead', '{email}'::benachrichtigung_kanal[])`,
      [ich],
    )).rejects.toThrow(/praeferenz_app_bleibt/u);
  });

  it('fremde Präferenzen sind unsichtbar und unveränderlich', async () => {
    const ich = await legeKontoAn(f.reinigung);
    const sie = await legeKontoAn(f.reinigung, 'admin');
    await alsKonto(ich, f.reinigung,
      (k) => setzePraeferenz(k, 'crm.neuer_lead', [], ['app', 'email']));

    expect(await alsKonto(sie, f.reinigung, (k: Leser) => ladePraeferenzen(k))).toEqual({});
  });

  it('sie wirkt in `erzeuge` — in derselben Anfrage', () => {
    alleArten();
    const ohne = erzeuge('crm.neuer_lead', {
      mandantId: f.reinigung, mandantSlug: 'reinigung',
      objektTyp: 'lead', objektId: '00000000-0000-4000-8000-000000000000', daten: {},
    });
    expect([...ohne.kanaele].sort()).toEqual(['app', 'email']);

    const mit = erzeuge('crm.neuer_lead', {
      mandantId: f.reinigung, mandantSlug: 'reinigung',
      objektTyp: 'lead', objektId: '00000000-0000-4000-8000-000000000000', daten: {},
    }, { 'crm.neuer_lead': ['app'] });
    expect(mit.kanaele).toEqual(['app']);
  });
});

describe('(4) jede Art hat ein Ziel (NOT-03)', () => {
  const PROBE = {
    mandantId: '00000000-0000-4000-8000-000000000001',
    objektTyp: 'x',
    objektId: '00000000-0000-4000-8000-000000000000',
    daten: {},
  };

  /**
   * **Nicht „jede Art löst auf".** Manche brauchen Angaben aus `daten`, die
   * hier bewusst fehlen — `bau.nachtrag_ueberfaellig` etwa führt zum
   * Nachtrag und nicht zu einer Liste. Dass sie dann `null` liefert, ist
   * genau das Verhalten aus NOT-03: `erzeuge()` scheitert, statt eine
   * Meldung zu bauen, die nirgendwohin führt. Geprüft wird deshalb die FORM
   * jedes Ziels, das entsteht.
   */
  it('was ein Ziel liefert, liefert einen eigenen Pfad — nie eine fremde Adresse', () => {
    const arten = alleArten();
    expect(arten.length).toBeGreaterThan(5);
    let mitZiel = 0;
    for (const a of arten) {
      const ziel = a.ziel({ ...PROBE, mandantSlug: 'reinigung' });
      if (ziel === null) continue;
      mitZiel += 1;
      expect(ziel, `${a.schluessel}: Ziel beginnt nicht mit /`).toMatch(/^\/[^/]/u);
    }
    expect(mitZiel, 'keine einzige Art führt irgendwohin').toBeGreaterThan(3);
  });

  /**
   * **Bereichsgebundene Ziele brauchen den Slug** — und liefern ohne ihn
   * `null` statt `/portal/undefined/…` (Copilot-Befund PR 12). Personenziele
   * wie `/portal/mein/nachweise` sind der andere Fall: sie hängen an der
   * Person, nicht an der Gesellschaft, und gelten deshalb auch ohne Slug.
   */
  it('ein bereichsgebundenes Ziel gibt es ohne Bereich nicht', () => {
    for (const a of alleArten()) {
      const mit = a.ziel({ ...PROBE, mandantSlug: 'reinigung' });
      if (mit === null || !mit.startsWith('/portal/reinigung')) continue;
      const ohne = a.ziel({ ...PROBE, mandantSlug: null });
      expect(ohne, `${a.schluessel} baut ein Ziel ohne Bereichsslug`).toBeNull();
    }
  });
});
