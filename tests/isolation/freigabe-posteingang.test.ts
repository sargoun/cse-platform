/**
 * PR 62 — der Posteingang gegen eine echte Datenbank (APR-01 … APR-03, APR-07).
 *
 * Diff, Konfidenz und Kettenformel stehen ohne Datenbank in
 * `tests/kern/freigabe-*.test.ts`. Hier stehen die Saetze, die nur gegen
 * Postgres zu beweisen sind:
 *
 *  1. **Was ein Mensch gesehen hat, aendert sich nicht unter ihm.**
 *  2. **Ohne Ansicht keine Entscheidung** — und ohne Menschen erst recht nicht.
 *  3. **Die eingereichte Nutzlast ist die vorgelegte**, sonst nichts.
 *  4. **Die beiden Kettenrechnungen stimmen byte-genau ueberein** (der
 *     Golden-Vector-Satz: SQL schreibt, TypeScript prueft nach).
 *  5. **Jedes extrahierte Feld nennt eine Quelle**, und ein unsicheres Feld
 *     nimmt den Vorgang aus dem Stapel.
 *  6. **`pruefdauer_sek` ist `cse_app` entzogen** (K-05, § 87 BetrVG).
 *  7. **Ein `mitarbeiter` im selben Mandanten liest keine Freigabe** (EMP-13).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { kanonisiere } from '../../src/server/services/finanz/kanonisch.js';
import { gliedHash, pruefeKette } from '../../src/server/services/freigabe/kette.js';

let f: Fixtur;
let benutzer: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function sitzung(teil: Record<string, unknown> = {}) {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false, ...teil,
  };
}

/**
 * Ein Konto — mit globaler Rolle oder ohne.
 *
 * `benutzer.globale_rolle_id` nimmt NUR Rollen mit `geltungsbereich =
 * 'global'`; `leitung` ist eine Mandantsrolle und gehoert in
 * `benutzer_mandant`. Ein frueherer Entwurf hier schrieb sie in beide, und
 * der Riegel wies das zu Recht ab.
 */
async function legeBenutzerAn(email: string, global = true): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Freigeberin', 'aktiv',
             case when $3 then (select id from rolle
                                 where schluessel = 'super_admin' and mandant_id is null)
                  end)`,
    [u!.id, email, global]);
  return u!.id;
}

/** Die Nutzlast und ihre kanonischen Bytes — wie der Dienst sie liefert. */
function bytes(wert: Record<string, unknown>): Buffer {
  return Buffer.from(kanonisiere(wert as never));
}

async function legeFreigabeAn(
  teil: { status?: string; nutzlast?: Record<string, unknown> } = {},
): Promise<{ id: string; nutzlast: Record<string, unknown>; hash: string }> {
  const nutzlast = teil.nutzlast ?? { aktion: 'rechnung_senden', betrag_cent: 45_600 };
  const roh = bytes(nutzlast);
  const [h] = await sql.unsafe<{ hash: string }[]>(
    `select encode(digest($1::bytea, 'sha256'), 'hex') as hash`, [roh]);

  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, vorgang_typ, titel,
                           zusammenfassung, risiko, diff, vorschau_payload,
                           payload_hash, betrag_cent, erstellt_von)
     values ($1, 'rechnung_senden', $2, 'monatsrechnung_entwurf',
             'Monatsrechnung August', 'Wie im Juli, ausser +12 Nachtstunden',
             'mittel', '[]'::jsonb, $3::jsonb, $4, 45600, $5)
     returning id`,
    [f.reinigung, teil.status ?? 'offen', JSON.stringify(nutzlast), h!.hash, benutzer]);
  return { id: z!.id, nutzlast, hash: h!.hash };
}

async function ansichtSchreiben(id: string, wer = benutzer): Promise<void> {
  await alsApp(sitzung({ benutzerId: wer }), async (tx) => {
    await tx.unsafe(
      `insert into freigabe_ansicht (mandant_id, freigabe_id, benutzer_id, kanal)
       values ($1, $2, $3, 'web')`, [f.reinigung, id, wer]);
  });
}

interface Entscheidung { snapshot_id: string; kette_nr: string; hash: string }

async function entscheide(
  id: string, nutzlast: Record<string, unknown>, art = 'genehmigt',
  begruendung: string | null = null, wer = benutzer,
): Promise<Entscheidung> {
  return alsApp(sitzung({ benutzerId: wer }), async (tx) => {
    const [z] = await tx.unsafe<Entscheidung[]>(
      `select * from app.freigabe_entscheiden(
         $1, $2::freigabe_art, $3::jsonb, $4::bytea,
         '[]'::jsonb, $5::bytea, '[]'::jsonb, $5::bytea,
         '{}'::jsonb, $6::bytea, '{}'::jsonb, $6::bytea,
         null, $7, null, null, 'test')`,
      [id, art, JSON.stringify(nutzlast), bytes(nutzlast),
        bytes([] as never), bytes({}), begruendung]);
    return z!;
  });
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`freigabe-${zufall()}@cse.test`);
});

afterAll(schliessen);

describe('(1) was ein Mensch gesehen hat, aendert sich nicht unter ihm', () => {
  it('vor der ersten Ansicht ist der Vorschlag noch beweglich', async () => {
    const fg = await legeFreigabeAn();
    await alsApp(sitzung(), async (tx) => {
      await tx.unsafe(`update freigabe set zusammenfassung = 'neu' where id = $1`, [fg.id]);
      await tx.unsafe(`update freigabe set diff = '[{"feld":"x"}]'::jsonb where id = $1`,
        [fg.id]);
    });
  });

  it('nach der ersten Ansicht ist der Diff fest', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(`update freigabe set diff = '[{"feld":"x"}]'::jsonb where id = $1`, [fg.id]),
    )).rejects.toThrow(/fest, seit sie jemand geoeffnet hat/u);
  });

  it('und die Vorschau ebenso', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(`update freigabe set vorschau_payload = '{"x":1}'::jsonb where id = $1`,
        [fg.id]),
    )).rejects.toThrow(/APR-02/u);
  });

  /**
   * Der Gegenbeweis, ohne den der Riegel zu breit waere: was NACH der
   * Entscheidung geschieht, muss sich weiter bewegen duerfen — sonst liesse
   * sich eine genehmigte Freigabe nie ausfuehren.
   */
  it('Status, Zuweisung und Ausfuehrung bleiben beweglich', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    await alsApp(sitzung(), async (tx) => {
      await tx.unsafe(
        `update freigabe set zugewiesen_an = $2, ausfuehrung_versuch = 1 where id = $1`,
        [fg.id, benutzer]);
    });
  });
});

describe('(2) ohne Ansicht keine Entscheidung (APR-08, §4.6)', () => {
  it('eine Freigabe, die niemand geoeffnet hat, wird nicht entschieden', async () => {
    const fg = await legeFreigabeAn();
    await expect(entscheide(fg.id, fg.nutzlast))
      .rejects.toThrow(/nie geoeffnet/u);
  });

  it('die Ansicht einer ANDEREN Person genuegt nicht', async () => {
    const fg = await legeFreigabeAn();
    const andere = await legeBenutzerAn(`andere-${zufall()}@cse.test`);
    await ansichtSchreiben(fg.id, andere);
    await expect(entscheide(fg.id, fg.nutzlast)).rejects.toThrow(/nie geoeffnet/u);
  });

  it('mit Ansicht geht es durch, und die Pruefdauer wird gemessen', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    const e = await entscheide(fg.id, fg.nutzlast);
    expect(e.kette_nr).toBe('1');

    const [s] = await sql.unsafe<{ pruefdauer_sek: number; art: string }[]>(
      `select pruefdauer_sek, art from freigabe_snapshot where id = $1`, [e.snapshot_id]);
    expect(s!.art).toBe('genehmigt');
    expect(s!.pruefdauer_sek).toBeGreaterThanOrEqual(0);
  });

  it('`geoeffnet_am_server` kommt vom SERVER, auch wenn der Aufrufer etwas schickt', async () => {
    const fg = await legeFreigabeAn();
    await alsApp(sitzung(), async (tx) => {
      await tx.unsafe(
        `insert into freigabe_ansicht (mandant_id, freigabe_id, benutzer_id,
                                       geoeffnet_am_server)
         values ($1, $2, $3, '1999-01-01T00:00:00Z')`, [f.reinigung, fg.id, benutzer]);
    });
    const [a] = await sql.unsafe<{ jahr: number }[]>(
      `select extract(year from geoeffnet_am_server)::int as jahr
         from freigabe_ansicht where freigabe_id = $1`, [fg.id]);
    expect(a!.jahr).toBeGreaterThan(2020);
  });

  /**
   * Zwei Riegel, einer genuegt: `cse_app` hat auf dieser Tabelle gar kein
   * UPDATE-Recht (0136 gibt nur `select, insert`), und darunter liegt noch
   * `trg_freigabe_ansicht_unveraenderlich`. Der Test nimmt beide an — welcher
   * zuerst greift, ist eine Frage der Reihenfolge in Postgres und keine
   * Zusage; DASS keiner fehlt, ist die Zusage.
   */
  it('eine Ansicht wird nicht nachtraeglich verschoben', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(`update freigabe_ansicht set kanal = 'mobil' where freigabe_id = $1`, [fg.id]),
    )).rejects.toThrow(/anfuegend|permission denied/u);
  });
});

describe('(3) die eingereichte Nutzlast ist die vorgelegte', () => {
  it('eine andere Nutzlast wird abgewiesen', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    await expect(entscheide(fg.id, { aktion: 'rechnung_senden', betrag_cent: 99_999 }))
      .rejects.toThrow(/nicht die vorgelegte/u);
  });

  it('dieselben Felder in anderer Reihenfolge sind DIESELBE Nutzlast', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    await entscheide(fg.id, { betrag_cent: 45_600, aktion: 'rechnung_senden' });
  });

  it('eine zweite Entscheidung ueber denselben Vorgang wird abgewiesen', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    await entscheide(fg.id, fg.nutzlast);
    await expect(entscheide(fg.id, fg.nutzlast)).rejects.toThrow(/bereits entschieden/u);
  });

  it('eine Ablehnung ohne Begruendung ist keine Auskunft', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    await expect(entscheide(fg.id, fg.nutzlast, 'abgelehnt'))
      .rejects.toThrow(/ohne Begruendung/u);
  });

  it('mit Begruendung geht die Ablehnung durch', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    const e = await entscheide(fg.id, fg.nutzlast, 'abgelehnt', 'Der Leistungszeitraum fehlt');
    const [s] = await sql.unsafe<{ art: string; begruendung: string }[]>(
      `select art, begruendung from freigabe_snapshot where id = $1`, [e.snapshot_id]);
    expect(s!.art).toBe('abgelehnt');
  });
});

describe('(4) SQL schreibt die Kette, TypeScript rechnet sie nach (K-13)', () => {
  /**
   * **Der Golden-Vector-Satz.** Die Kette wird in `app.freigabe_entscheiden`
   * geschrieben und in `services/freigabe/kette.ts` geprueft. Weichen die
   * beiden um ein Trennzeichen ab, meldet der naechtliche Waechter an jedem
   * Glied einen Bruch — und der erste, der das sieht, schaltet ihn ab. Dieser
   * Test ist die einzige Stelle, an der das VORHER auffaellt.
   */
  it('der gespeicherte Hash ist der, den TypeScript berechnet', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    const e = await entscheide(fg.id, fg.nutzlast);

    const [s] = await sql.unsafe<Record<string, string | null>[]>(
      `select nutzlast_hash, artefakt_hash, diff_hash, felder_hash,
              ansicht_modell_hash, policy_ergebnis_hash, art,
              entschieden_von::text as entschieden_von,
              to_char(entschieden_am at time zone 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as entschieden_am,
              kette_nr::text as kette_nr, vorheriger_hash, hash
         from freigabe_snapshot where id = $1`, [e.snapshot_id]);

    const nachgerechnet = gliedHash({
      nutzlastHash: s!['nutzlast_hash']!,
      artefaktHash: s!['artefakt_hash'] ?? '',
      diffHash: s!['diff_hash']!,
      felderHash: s!['felder_hash']!,
      ansichtModellHash: s!['ansicht_modell_hash']!,
      policyErgebnisHash: s!['policy_ergebnis_hash']!,
      art: 'genehmigt',
      entschiedenVon: s!['entschieden_von']!,
      entschiedenAm: new Date(s!['entschieden_am']!),
      ketteNr: BigInt(s!['kette_nr']!),
      vorherHash: '',
    });

    expect(nachgerechnet).toBe(s!['hash']);
    expect(nachgerechnet).toBe(e.hash);
  });

  it('zwei Entscheidungen haengen Glied an Glied', async () => {
    const a = await legeFreigabeAn();
    const b = await legeFreigabeAn();
    await ansichtSchreiben(a.id);
    await ansichtSchreiben(b.id);
    const e1 = await entscheide(a.id, a.nutzlast);
    const e2 = await entscheide(b.id, b.nutzlast);

    expect(e2.kette_nr).toBe(String(Number(e1.kette_nr) + 1));
    const [s] = await sql.unsafe<{ vorheriger_hash: string }[]>(
      `select vorheriger_hash from freigabe_snapshot where id = $1`, [e2.snapshot_id]);
    expect(s!.vorheriger_hash).toBe(e1.hash);
  });

  it('der Schnappschuss ist unveraenderlich', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    const e = await entscheide(fg.id, fg.nutzlast);
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(`update freigabe_snapshot set begruendung = 'x' where id = $1`, [e.snapshot_id]),
    // Zwei Riegel, und der aeussere greift zuerst: 0137 nimmt `cse_app` das
    // tabellenweite Recht und gibt nur `select` je Spalte zurueck — ein
    // `update` scheitert also schon am Recht, noch vor
    // `trg_freigabe_snapshot_eingefroren`. Dass KEINER fehlt, ist die Zusage.
    )).rejects.toThrow(/unveraenderlich|permission denied/u);
  });

  it('ein wartender Vorgang wird NICHT durch einen direkten insert entschieden', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(
        `insert into freigabe_snapshot
           (mandant_id, freigabe_id, kette_nr, nutzlast, nutzlast_hash,
            vorheriger_hash, hash, entscheidung, entschieden_von)
         values ($1, $2, 99, '{}'::jsonb, repeat('a',64), repeat('0',64),
                 repeat('b',64), 'genehmigt', $3)`,
        [f.reinigung, fg.id, benutzer]),
    )).rejects.toThrow(/app\.freigabe_entscheiden/u);
  });
});

describe('(5) jedes Feld nennt seine Quelle (APR-03)', () => {
  it('ein Feld ohne jede Quellangabe wird abgewiesen', async () => {
    const fg = await legeFreigabeAn();
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(
        `insert into freigabe_feld (mandant_id, freigabe_id, feld_pfad, bezeichnung)
         values ($1, $2, '/betrag', 'Betrag')`, [f.reinigung, fg.id]),
    )).rejects.toThrow(/ff_hat_eine_quelle/u);
  });

  it('ein Zitat genuegt als Quelle', async () => {
    const fg = await legeFreigabeAn();
    await alsApp(sitzung(), async (tx) => {
      await tx.unsafe(
        `insert into freigabe_feld (mandant_id, freigabe_id, feld_pfad, bezeichnung,
                                    quelle_zitat, konfidenz)
         values ($1, $2, '/betrag', 'Betrag', 'Gesamtbetrag 456,00 EUR', 0.990)`,
        [f.reinigung, fg.id]);
    });
  });

  it('eine Warnung ohne Grund ist eine, die niemand aufloesen kann', async () => {
    const fg = await legeFreigabeAn();
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(
        `insert into freigabe_feld (mandant_id, freigabe_id, feld_pfad, bezeichnung,
                                    quelle_zitat, unsicher)
         values ($1, $2, '/betrag', 'Betrag', 'x', true)`, [f.reinigung, fg.id]),
    )).rejects.toThrow(/ff_unsicher_hat_grund/u);
  });

  it('derselbe Pfad steht nur einmal je Freigabe', async () => {
    const fg = await legeFreigabeAn();
    await alsApp(sitzung(), async (tx) => {
      await tx.unsafe(
        `insert into freigabe_feld (mandant_id, freigabe_id, feld_pfad, bezeichnung, quelle_zitat)
         values ($1, $2, '/betrag', 'Betrag', 'x')`, [f.reinigung, fg.id]);
    });
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(
        `insert into freigabe_feld (mandant_id, freigabe_id, feld_pfad, bezeichnung, quelle_zitat)
         values ($1, $2, '/betrag', 'Betrag nochmal', 'y')`, [f.reinigung, fg.id]),
    )).rejects.toThrow(/ff_uk/u);
  });

  /**
   * APR-04 in der Datenbank, und der Zaehler wird GEFUEHRT, nicht gemeldet:
   * ein Dienst, der die Zahl mitschickt, schickt irgendwann die falsche.
   */
  it('ein unsicheres Feld zaehlt sich selbst und nimmt den Vorgang aus dem Stapel', async () => {
    const fg = await legeFreigabeAn();
    await alsApp(sitzung(), async (tx) => {
      await tx.unsafe(`update freigabe set stapel_faehig = true where id = $1`, [fg.id]);
      await tx.unsafe(
        `insert into freigabe_feld (mandant_id, freigabe_id, feld_pfad, bezeichnung,
                                    quelle_zitat, konfidenz, unsicher, grund)
         values ($1, $2, '/ust', 'USt', 'x', 0.400, true, 'USt-Summe weicht um 0,02 € ab')`,
        [f.reinigung, fg.id]);
    });
    const [z] = await sql.unsafe<
    { unsichere_felder_anzahl: number; stapel_faehig: boolean; min_konfidenz: string }[]>(
      `select unsichere_felder_anzahl, stapel_faehig, min_konfidenz
         from freigabe where id = $1`, [fg.id]);
    expect(z!.unsichere_felder_anzahl).toBe(1);
    expect(z!.stapel_faehig).toBe(false);
    expect(Number(z!.min_konfidenz)).toBeCloseTo(0.4, 3);
  });

  it('ein Feld wird nicht geloescht — es ist der Nachweis', async () => {
    const fg = await legeFreigabeAn();
    await alsApp(sitzung(), async (tx) => {
      await tx.unsafe(
        `insert into freigabe_feld (mandant_id, freigabe_id, feld_pfad, bezeichnung, quelle_zitat)
         values ($1, $2, '/betrag', 'Betrag', 'x')`, [f.reinigung, fg.id]);
    });
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(`delete from freigabe_feld where freigabe_id = $1`, [fg.id]),
    )).rejects.toThrow();
  });
});

describe('(6) die Riegel auf der Freigabe selbst', () => {
  /**
   * Der Riegel haengt an `vorgang_typ`: wer sich als Agentenvorschlag
   * ausweist, gehoert in den Posteingang und muss vorzeigbar sein.
   */
  it('wer wartet, muss lesbar sein', async () => {
    await expect(sql.unsafe(
      `insert into freigabe (mandant_id, aktion, status, vorgang_typ)
       values ($1, 'x', 'offen', 'monatsrechnung_entwurf')`,
      [f.reinigung],
    )).rejects.toThrow(/freigabe_offen_ist_vorzeigbar/u);
  });

  /**
   * Und die Gegenprobe: eine Domaenenfreigabe ohne Vorgangsart — die
   * Behinderungsanzeige (BAU-06) legt genau so eine an — bleibt moeglich.
   * Sie wartet auch auf einen Menschen, wird aber von ihrem eigenen
   * Bildschirm vorgelegt, nicht von diesem.
   */
  it('eine Domaenenfreigabe ohne Vorgangsart darf offen sein', async () => {
    await sql.unsafe(
      `insert into freigabe (mandant_id, aktion, status) values ($1, 'behinderung', 'offen')`,
      [f.reinigung]);
  });

  it('eine bereits entschiedene Freigabe braucht das nicht', async () => {
    await sql.unsafe(
      `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am)
       values ($1, 'eingangsrechnung_buchen', 'genehmigt', $2, now())`,
      [f.reinigung, benutzer]);
  });

  it('ein unbekannter Rechteschluessel faellt beim Schreiben auf (K-19)', async () => {
    await expect(sql.unsafe(
      `insert into freigabe (mandant_id, aktion, status, freigegeben_von,
                             freigegeben_am, erforderliches_recht)
       values ($1, 'x', 'genehmigt', $2, now(), 'freigabe.entschieden')`,
      [f.reinigung, benutzer],
    )).rejects.toThrow(/kein Schluessel im Rechtekatalog/u);
  });

  it('ein bekannter geht durch', async () => {
    await sql.unsafe(
      `insert into freigabe (mandant_id, aktion, status, freigegeben_von,
                             freigegeben_am, erforderliches_recht)
       values ($1, 'x', 'genehmigt', $2, now(), 'freigabe.entscheiden')`,
      [f.reinigung, benutzer]);
  });

  /**
   * APR-05 woertlich: verzoegerte Freigabe gilt fuer NIEDRIGES Risiko — und
   * `externer_versand` ist auch dann keines, wenn eine Richtlinie es
   * behauptet. Ohne diesen Riegel liesse sich Invariante 7 ueber eine
   * Konfigurationszeile aushebeln.
   */
  it('externer_versand bekommt keine verzoegerte Freigabe', async () => {
    await expect(sql.unsafe(
      `insert into freigabe (mandant_id, aktion, status, vorgang_typ, titel,
                             zusammenfassung, risiko, vorschau_payload, payload_hash,
                             verzoegerte_freigabe_bis)
       values ($1, 'x', 'offen', 'externer_versand', 'T', 'Z', 'niedrig',
               '{}'::jsonb, repeat('a',64), now() + interval '2 hours')`,
      [f.reinigung],
    )).rejects.toThrow(/freigabe_verzoegerung_nur_niedrig/u);
  });

  it('ein interner Hinweis mit niedrigem Risiko darf sie haben', async () => {
    await sql.unsafe(
      `insert into freigabe (mandant_id, aktion, status, vorgang_typ, titel,
                             zusammenfassung, risiko, vorschau_payload, payload_hash,
                             verzoegerte_freigabe_bis)
       values ($1, 'x', 'offen', 'interner_hinweis', 'T', 'Z', 'niedrig',
               '{}'::jsonb, repeat('a',64), now() + interval '2 hours')`,
      [f.reinigung]);
  });

  it('das Undo-Fenster haengt an der Ausfuehrung, nicht am Vorschlag', async () => {
    await expect(sql.unsafe(
      `insert into freigabe (mandant_id, aktion, status, freigegeben_von,
                             freigegeben_am, undo_bis)
       values ($1, 'x', 'genehmigt', $2, now(), now() + interval '1 hour')`,
      [f.reinigung, benutzer],
    )).rejects.toThrow(/freigabe_undo_nach_ausfuehrung/u);
  });
});

describe('(7) wer die Freigaben NICHT sieht', () => {
  /**
   * EMP-13. „Freigaben sind Mandantszeilen" ist keine Policy: ein
   * `mitarbeiter` der Reinigung sitzt INNERHALB des Mandanten `reinigung` und
   * laese sonst jeden Diff mit Kundennamen, Preisen und Margen.
   */
  it('ein mitarbeiter-Portal im selben Mandanten liest nichts', async () => {
    const fg = await legeFreigabeAn();
    const zeilen = await alsApp(
      sitzung({ portal: 'mitarbeiter' }),
      async (tx) => tx.unsafe(`select id from freigabe where id = $1`, [fg.id]));
    expect(zeilen).toHaveLength(0);
  });

  it('die Gruppenansicht liest, entscheidet aber nicht (Invariante 10)', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    await expect(alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung], benutzerId: benutzer,
        portal: 'intern', readonly: true },
      async (tx) => tx.unsafe(
        `select * from app.freigabe_entscheiden($1, 'genehmigt'::freigabe_art,
           '{}'::jsonb, ''::bytea, '[]'::jsonb, ''::bytea, '[]'::jsonb, ''::bytea,
           '{}'::jsonb, ''::bytea, '{}'::jsonb, ''::bytea, null, null, null, null, 't')`,
        [fg.id]),
    )).rejects.toThrow(/Gruppenansicht/u);
  });

  it('ein anderer Mandant sieht die Freigabe nicht', async () => {
    const fg = await legeFreigabeAn();
    const zeilen = await alsApp(
      sitzung({ mandantId: f.security }),
      async (tx) => tx.unsafe(`select id from freigabe where id = $1`, [fg.id]));
    expect(zeilen).toHaveLength(0);
  });
});

describe('(8) pruefdauer_sek ist keine Spalte, die jeder liest (K-05)', () => {
  it('`cse_app` kommt nicht an sie heran', async () => {
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(`select pruefdauer_sek from freigabe_snapshot limit 1`),
    )).rejects.toThrow(/permission denied|pruefdauer_sek/u);
  });

  it('die uebrigen Spalten bleiben lesbar — `select *` ist nicht gesperrt', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    const e = await entscheide(fg.id, fg.nutzlast);
    const zeilen = await alsApp(sitzung(), async (tx) =>
      tx.unsafe(`select id, hash, art from freigabe_snapshot where id = $1`, [e.snapshot_id]));
    expect(zeilen).toHaveLength(1);
  });

  it('mit dem Recht liefert die Definer-Funktion die Zahl', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    const e = await entscheide(fg.id, fg.nutzlast);
    const [z] = await alsApp(sitzung(), async (tx) =>
      tx.unsafe<{ wert: number | null }[]>(
        `select app.freigabe_pruefdauer_lesen($1) as wert`, [e.snapshot_id]));
    expect(z!.wert).toBeGreaterThanOrEqual(0);
  });

  /**
   * Ohne das Recht: NULL, keine Ausnahme. Eine Ausnahme unterschiede „kein
   * Recht" von „keine Zeile" und waere damit selbst die Auskunft.
   */
  it('ohne das Recht: NULL, nicht eine Ausnahme', async () => {
    const fg = await legeFreigabeAn();
    await ansichtSchreiben(fg.id);
    const e = await entscheide(fg.id, fg.nutzlast);

    const leitung = await legeBenutzerAn(`leitung-${zufall()}@cse.test`, false);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle where schluessel = 'leitung' and mandant_id is null),
               true)`, [leitung, f.reinigung]);

    const [z] = await alsApp(sitzung({ benutzerId: leitung }), async (tx) =>
      tx.unsafe<{ wert: number | null }[]>(
        `select app.freigabe_pruefdauer_lesen($1) as wert`, [e.snapshot_id]));
    expect(z!.wert).toBeNull();
  });

  it('eine unbekannte Kennung ergibt NULL, keine Ausnahme', async () => {
    const [z] = await alsApp(sitzung(), async (tx) =>
      tx.unsafe<{ wert: number | null }[]>(
        `select app.freigabe_pruefdauer_lesen('00000000-0000-4000-8000-000000000000') as wert`));
    expect(z!.wert).toBeNull();
  });
});

describe('(9) die Kette haelt ueber mehrere Glieder', () => {
  it('drei Entscheidungen ergeben eine intakte Kette', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const fg = await legeFreigabeAn({ nutzlast: { nr: i } });
      await ansichtSchreiben(fg.id);
      const e = await entscheide(fg.id, { nr: i });
      ids.push(e.snapshot_id);
    }

    const glieder = await sql.unsafe<Record<string, string | null>[]>(
      `select nutzlast_hash, artefakt_hash, diff_hash, felder_hash,
              ansicht_modell_hash, policy_ergebnis_hash, art::text as art,
              entschieden_von::text as entschieden_von,
              to_char(entschieden_am at time zone 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as entschieden_am,
              kette_nr::text as kette_nr, vorheriger_hash, hash
         from freigabe_snapshot where mandant_id = $1 order by kette_nr`, [f.reinigung]);

    const befund = pruefeKette(glieder.map((s) => ({
      nutzlastHash: s['nutzlast_hash']!,
      artefaktHash: s['artefakt_hash'] ?? '',
      diffHash: s['diff_hash']!,
      felderHash: s['felder_hash']!,
      ansichtModellHash: s['ansicht_modell_hash']!,
      policyErgebnisHash: s['policy_ergebnis_hash']!,
      art: s['art'] as 'genehmigt',
      entschiedenVon: s['entschieden_von'] ?? '',
      entschiedenAm: new Date(s['entschieden_am']!),
      ketteNr: BigInt(s['kette_nr']!),
      vorherHash: s['kette_nr'] === '1' ? '' : s['vorheriger_hash']!,
      hash: s['hash']!,
    })));

    expect(befund).toEqual({ intakt: true, bruchBei: null, grund: null });
  });
});
