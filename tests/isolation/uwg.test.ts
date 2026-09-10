/**
 * CRM-08 · § 7 UWG — das Tor, an der DATENBANK geprueft.
 *
 * Diese Datei prueft nicht, ob eine TypeScript-Funktion das Richtige
 * zurueckgibt. Sie prueft, was `app.darf_kontaktiert_werden` in Postgres
 * antwortet und was der Ausloeser auf dem Sendepfad zulaesst — denn genau dort
 * liegt die Zusage: **was nicht aufgezeichnet werden kann, kann nicht gesendet
 * werden.**
 *
 * § 7 UWG verbietet elektronische Werbung ohne vorherige ausdrueckliche
 * Einwilligung, auch im B2B. Ein System, das im Zweifel sendet, produziert
 * Abmahnungen; deshalb ist jede Antwort hier `false`, wo etwas unklar ist.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
/** Ein handelndes Konto. Das Tor selbst prueft kein Recht — es prueft den
 *  BEREICH —, aber `alsApp` bindet eine Sitzung, und die hat einen Benutzer. */
let chef = '';

async function konto(): Promise<string> {
  const email = `uwg-${String(Math.random()).slice(2, 10)}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email],
  );
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email],
  );
  return u!.id;
}

async function kunde(mandantId: string, felder: Partial<{
  rechtsgrundlage: string; quelle: string; werbewiderspruch: boolean;
  widerspruch: boolean; status: string;
}> = {}): Promise<string> {
  const grundlage = felder.rechtsgrundlage ?? 'bestandskunde';
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am,
                        werbewiderspruch_am, widerspruch_am, status)
     values ($1, $2, 'Testkunde', $3::rechtsgrundlage,
             $4, case when $3 = 'keine' then null else now() end,
             $5, $6, $7::kunde_status)
     returning id`,
    [mandantId, `K-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`,
     grundlage, grundlage === 'keine' ? null : (felder.quelle ?? 'Vertrag 2026-01'),
     felder.werbewiderspruch === true ? new Date() : null,
     felder.widerspruch === true ? new Date() : null,
     felder.status ?? 'aktiv'],
  );
  return z!.id;
}

async function kontakt(mandantId: string, kundeId: string | null, felder: Partial<{
  rechtsgrundlage: string; kanaele: readonly string[] | null;
  werbewiderspruch: boolean; widerspruch: boolean; archiviert: boolean;
}> = {}): Promise<string> {
  const grundlage = felder.rechtsgrundlage ?? 'bestandskunde';
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into ansprechpartner (mandant_id, kunde_id, nachname, email, rechtsgrundlage,
                                  rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am,
                                  einwilligung_kanaele, werbewiderspruch_am, widerspruch_am,
                                  archiviert_am)
     values ($1, $2, 'Muster', $3, $4::rechtsgrundlage,
             $5, case when $4 = 'keine' then null else now() end,
             $6, $7, $8, $9)
     returning id`,
    [mandantId, kundeId, `k${String(Math.random()).slice(2, 10)}@example.test`,
     grundlage, grundlage === 'keine' ? null : 'Vertrag 2026-01',
     felder.kanaele ?? null,
     felder.werbewiderspruch === true ? new Date() : null,
     felder.widerspruch === true ? new Date() : null,
     felder.archiviert === true ? new Date() : null],
  );
  return z!.id;
}

/** Das Tor, gefragt als `cse_app` im Bereich des Kontakts. */
async function darf(mandantId: string, kontaktId: string,
                    kanal = 'email', zweck = 'werbung'): Promise<boolean> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId: chef, portal: 'intern', readonly: false },
    async (tx) => {
      const [z] = await tx.unsafe<{ ok: boolean }[]>(
        `select app.darf_kontaktiert_werden($1, $2, $3) as ok`, [kontaktId, kanal, zweck],
      );
      return z!.ok;
    },
  );
}

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  /**
   * Eine Rolle, weil (6) wirklich SCHREIBT. Das Tor selbst prueft kein Recht
   * — es prueft den Bereich —, aber die Policy auf `lead_aktivitaet` verlangt
   * `crm.schreiben`, und ein Test, der schon an ihr scheitert, saehe wie ein
   * funktionierendes Tor aus, ohne eines zu pruefen.
   */
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = 'leitung' and mandant_id is null`);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [chef, f.reinigung, r!.id]);
});
afterAll(schliessen);

describe('(1) fail closed — was unklar ist, ist verboten', () => {
  it('eine unbekannte id ist false, nicht NULL', async () => {
    /**
     * Der Unterschied ist der ganze Punkt: `IF NOT f(...) THEN RAISE` feuert
     * bei NULL NICHT, und ein `CHECK`, das zu NULL auswertet, besteht. Ein
     * Praedikat, dessen Ausfall Geld kostet, darf nicht offen ausfallen.
     */
    const erfunden = '00000000-0000-0000-0000-0000000000ff';
    expect(await darf(f.reinigung, erfunden)).toBe(false);
  });

  it('ein Kontakt aus einem FREMDEN Bereich ist false — und verraet nichts', async () => {
    // Als Definer erbt die Funktion die RLS des Aufrufers nicht. Ohne die
    // ausgeschriebene Mandantenpruefung koennte jemand aus der Reinigung eine
    // Security-id durchprobieren und aus der Antwort lernen, dass es sie gibt.
    const fremd = await kontakt(f.security, await kunde(f.security));
    expect(await darf(f.reinigung, fremd)).toBe(false);
    // Und im eigenen Bereich waere derselbe Kontakt erlaubt — sonst bestuende
    // dieser Test auch dann, wenn das Tor grundsaetzlich false saegt.
    expect(await darf(f.security, fremd)).toBe(true);
  });

  it('die Vorgabe ist die SPERRE: ein neuer Kontakt ohne Grundlage', async () => {
    const [z] = await sql.unsafe<{ rechtsgrundlage: string }[]>(
      `insert into ansprechpartner (mandant_id, nachname) values ($1, 'Ohne')
       returning rechtsgrundlage`, [f.reinigung],
    );
    expect(z!.rechtsgrundlage).toBe('keine');
  });
});

describe('(2) die beiden Widersprueche sind NICHT dasselbe (§5.1)', () => {
  it('Werbewiderspruch beendet die Werbung', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k, { werbewiderspruch: true });
    expect(await darf(f.reinigung, a, 'email', 'werbung')).toBe(false);
  });

  it('… aber NICHT die vertragliche Kommunikation', async () => {
    /**
     * Die Rechnung muss zugestellt werden koennen. Wer die beiden
     * Widersprueche zusammenwirft, bekommt entweder Werbung an
     * Widersprechende oder keine Rechnung an Bestandskunden.
     */
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k, { werbewiderspruch: true });
    expect(await darf(f.reinigung, a, 'email', 'vertraglich')).toBe(true);
  });

  it('Widerspruch gegen die VERARBEITUNG beendet beides', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k,
      { rechtsgrundlage: 'keine', widerspruch: true });
    expect(await darf(f.reinigung, a, 'email', 'werbung')).toBe(false);
    expect(await darf(f.reinigung, a, 'email', 'vertraglich')).toBe(false);
  });

  it('und er zwingt die Grundlage auf `keine` — auch wenn eine gesetzt war', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k, { rechtsgrundlage: 'einwilligung',
      kanaele: ['email'] });
    await sql.unsafe(`update ansprechpartner set widerspruch_am = now() where id = $1`, [a]);
    const [z] = await sql.unsafe<{ rechtsgrundlage: string }[]>(
      `select rechtsgrundlage from ansprechpartner where id = $1`, [a],
    );
    expect(z!.rechtsgrundlage).toBe('keine');
  });

  it('ein Widerspruch wird nicht zurueckgenommen — das waere Beweisvernichtung', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k, { rechtsgrundlage: 'keine', widerspruch: true });
    await expect(
      sql.unsafe(`update ansprechpartner set widerspruch_am = null where id = $1`, [a]),
    ).rejects.toThrow(/nicht zurueckgenommen/u);
  });
});

describe('(3) Einwilligung ist KANALBEZOGEN (§7 UWG)', () => {
  it('wer per E-Mail eingewilligt hat, hat nicht per Telefon eingewilligt', async () => {
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k,
      { rechtsgrundlage: 'einwilligung', kanaele: ['email'] });
    expect(await darf(f.reinigung, a, 'email')).toBe(true);
    expect(await darf(f.reinigung, a, 'telefon')).toBe(false);
  });

  it('ein Vor-Ort-Termin ist keine elektronische Werbung — er bleibt erlaubt', async () => {
    // Ein pauschaler Kanaltest verbot den Besuch bei einem Kunden, der per
    // E-Mail eingewilligt hat. § 7 UWG nennt die elektronischen Kanaele.
    const k = await kunde(f.reinigung);
    const a = await kontakt(f.reinigung, k,
      { rechtsgrundlage: 'einwilligung', kanaele: ['email'] });
    expect(await darf(f.reinigung, a, 'vor_ort')).toBe(true);
  });

  it('Kanaele ohne Einwilligung sind gar nicht speicherbar', async () => {
    await expect(kontakt(f.reinigung, null,
      { rechtsgrundlage: 'bestandskunde', kanaele: ['email'] }),
    ).rejects.toThrow(/kanaele_nur_bei_einwilligung/u);
  });
});

describe('(4) der KUNDE sperrt seine Kontakte mit', () => {
  it('ein gesperrter Kunde macht jeden seiner Kontakte unansprechbar', async () => {
    const k = await kunde(f.reinigung, { status: 'gesperrt' });
    const a = await kontakt(f.reinigung, k);
    expect(await darf(f.reinigung, a)).toBe(false);
  });

  it('ein Werbewiderspruch des KUNDEN wirkt auf seine Kontakte', async () => {
    const k = await kunde(f.reinigung, { werbewiderspruch: true });
    const a = await kontakt(f.reinigung, k);
    expect(await darf(f.reinigung, a)).toBe(false);
  });

  it('ein Kontakt OHNE Kunden haengt nur an sich selbst', async () => {
    // Vor der Umwandlung eines Leads gibt es keinen Kunden, an dem er haengen
    // koennte — und das darf ihn nicht blockieren.
    const a = await kontakt(f.reinigung, null);
    expect(await darf(f.reinigung, a)).toBe(true);
  });
});

describe('(5) eine Grundlage OHNE Beleg ist keine Grundlage', () => {
  it('die Datenbank weist sie ab', async () => {
    await expect(sql.unsafe(
      `insert into ansprechpartner (mandant_id, nachname, rechtsgrundlage)
       values ($1, 'Unbelegt', 'einwilligung')`, [f.reinigung],
    )).rejects.toThrow(/grundlage_belegt/u);
  });
});

describe('(6) Das Sendetor haengt WIRKLICH an lead_aktivitaet', () => {
  /**
   * Bis zur Durchsicht war `kern.uwg_sendetor` eine Funktion, die niemand
   * aufruft: definiert, kommentiert — und an kein Ereignis gehaengt. Die
   * Regel stand da, und jede Zeile ging daran vorbei.
   *
   * Diese Tests pruefen deshalb nicht die Funktion, sondern das INSERT. Ein
   * Test gegen `app.darf_kontaktiert_werden` waere weiterhin gruen gewesen,
   * waehrend der Sendepfad offen stand.
   */
  async function schreibe(mandantId: string, kundeId: string, zeile: {
    ansprechpartnerId?: string | null; typ?: string; richtung?: string;
    zweck?: string; kanal?: string | null;
  }): Promise<readonly { rechtsgrundlage_snapshot: string | null }[]> {
    return alsApp(
      { scope: 'mandant', mandantId, benutzerId: chef, portal: 'intern', readonly: false },
      async (tx) => tx.unsafe(
        `insert into lead_aktivitaet
           (mandant_id, kunde_id, ansprechpartner_id, typ, richtung, zweck, kanal, betreff)
         values ($1, $2, $3, $4::aktivitaet_typ, $5::aktivitaet_richtung,
                 $6::kommunikationszweck, $7, 'Test')
         returning rechtsgrundlage_snapshot::text`,
        [mandantId, kundeId, zeile.ansprechpartnerId ?? null, zeile.typ ?? 'email',
         zeile.richtung ?? 'ausgehend', zeile.zweck ?? 'werbung',
         zeile.kanal === undefined ? 'email' : zeile.kanal]),
    );
  }

  it('eine Werbemail an einen Kontakt OHNE Grundlage wird abgewiesen', async () => {
    const kd = await kunde(f.reinigung);
    const ap = await kontakt(f.reinigung, kd, { rechtsgrundlage: 'keine' });
    await expect(schreibe(f.reinigung, kd, { ansprechpartnerId: ap }))
      .rejects.toThrow(/§ ?7 UWG/u);
  });

  it('dieselbe Mail an einen Bestandskunden geht — und traegt die Grundlage', async () => {
    const kd = await kunde(f.reinigung);
    const ap = await kontakt(f.reinigung, kd, { rechtsgrundlage: 'bestandskunde' });
    const [z] = await schreibe(f.reinigung, kd, { ansprechpartnerId: ap });
    // Der Beleg wird vom Ausloeser gezogen, nicht vom Aufrufer behauptet.
    expect(z!.rechtsgrundlage_snapshot).toBe('bestandskunde');
  });

  it('ein Werbewiderspruch nach der Einwilligung stoppt den Versand SOFORT', async () => {
    const kd = await kunde(f.reinigung);
    const ap = await kontakt(f.reinigung, kd, {
      rechtsgrundlage: 'einwilligung', kanaele: ['email'],
    });
    // Erst geht sie.
    await schreibe(f.reinigung, kd, { ansprechpartnerId: ap });
    await sql.unsafe(
      `update ansprechpartner set werbewiderspruch_am = now() where id = $1`, [ap]);
    // Und danach nicht mehr — gegen den LEBENDEN Kontakt, nicht gegen einen
    // Wert, den jemand Minuten vorher gelesen hat.
    await expect(schreibe(f.reinigung, kd, { ansprechpartnerId: ap }))
      .rejects.toThrow(/§ ?7 UWG/u);
  });

  it('ohne Ansprechpartner ist ein ausgehender Kontakt nicht belegbar', async () => {
    const kd = await kunde(f.reinigung);
    await expect(schreibe(f.reinigung, kd, { ansprechpartnerId: null }))
      .rejects.toThrow(/ohne Ansprechpartner/u);
  });

  /**
   * Die beiden Umgehungen, die die Durchsicht benannt hat. Beide waren
   * gefaehrlich, WEIL sie plausibel aussehen: ein Zweck und eine leere Spalte.
   */
  it('`zweck = intern` ist kein Freibrief fuer eine ausgehende Mail', async () => {
    const kd = await kunde(f.reinigung);
    const ap = await kontakt(f.reinigung, kd, { rechtsgrundlage: 'keine' });
    // `app.darf_kontaktiert_werden` sagt zu 'intern' ausdruecklich true …
    expect(await darf(f.reinigung, ap, 'email', 'intern')).toBe(true);
    // … und das Sendetor laesst die Zeile trotzdem nicht durch.
    await expect(schreibe(f.reinigung, kd, { ansprechpartnerId: ap, zweck: 'intern' }))
      .rejects.toThrow(/nie 'intern'/u);
  });

  it('eine weggelassene Kanalspalte umgeht das Tor nicht', async () => {
    const kd = await kunde(f.reinigung);
    const ap = await kontakt(f.reinigung, kd, { rechtsgrundlage: 'keine' });
    await expect(schreibe(f.reinigung, kd, { ansprechpartnerId: ap, kanal: null }))
      .rejects.toThrow(/ohne Kanal/u);
  });

  it('eine interne Notiz und ein eingehender Anruf bleiben frei', async () => {
    const kd = await kunde(f.reinigung);
    const ap = await kontakt(f.reinigung, kd, { rechtsgrundlage: 'keine' });
    await schreibe(f.reinigung, kd, {
      ansprechpartnerId: ap, typ: 'notiz', richtung: 'intern', zweck: 'intern', kanal: null,
    });
    await schreibe(f.reinigung, kd, {
      ansprechpartnerId: ap, typ: 'anruf', richtung: 'eingehend',
    });
    // Ein Termin ohne Kanal ist kein elektronischer Kontakt.
    await schreibe(f.reinigung, kd, {
      ansprechpartnerId: ap, typ: 'termin', zweck: 'vertraglich', kanal: null,
    });
  });
});
