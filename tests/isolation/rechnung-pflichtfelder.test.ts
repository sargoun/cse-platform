/**
 * PR 47 — Abnahme (1) bis (4) gegen eine ECHTE Datenbank mit FORCE RLS.
 *
 * Der reine Teil des Validators steht in `tests/kern/ustg14.test.ts`. Hier
 * steht, was sich nicht rein pruefen laesst:
 *
 *  · dass die Festschreibung wirklich abbricht und nicht bloss meldet;
 *  · dass die Grenze des §33 UStDV aus `kleinbetrag_grenze` kommt und nicht
 *    aus einer Zahl im Code — dieselbe Rechnung, eine andere Zeile, ein
 *    anderes Ergebnis;
 *  · dass ein Aufrufer, der den Validator UEBERSPRINGT, trotzdem nicht
 *    festschreiben kann (Abnahme 4). Das ist eine Aussage ueber einen
 *    Ausloeser, und ein Mock waere der uebergangene Aufrufer;
 *  · dass SQL und TypeScript den §33 UStDV GLEICH auslegen. Zwei Fassungen,
 *    die niemand vergleicht, sind zwei Auslegungen.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  fuegePositionHinzu, legeEntwurfAn, finalisiere, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import {
  kleinbetragLage, ladePruefEingabe, NICHT_GEPRUEFT, pruefeRechnung, REGELWERK_VERSION,
} from '../../src/server/services/finanz/ustg14.js';

let f: Fixtur;
let benutzer: string;
let kunde: string;

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

/** Eine Sitzung im internen Portal mit allen Finanzrechten. */
async function inSitzung<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_app`);
    await tx.unsafe(`select set_config('app.scope', 'mandant', true)`);
    await tx.unsafe(`select set_config('app.mandant_id', $1, true)`, [mandantId]);
    await tx.unsafe(`select set_config('app.mandant_ids', '', true)`);
    await tx.unsafe(`select set_config('app.person_id', '', true)`);
    await tx.unsafe(`select set_config('app.benutzer_id', $1, true)`, [benutzer]);
    await tx.unsafe(`select set_config('app.readonly', 'off', true)`);
    await tx.unsafe(`select set_config('app.portal', 'intern', true)`);
    await tx.unsafe(`select set_config('app.akteur_typ', 'mensch', true)`);
    return fn(tx);
  }) as Promise<T>;
}

async function legeBenutzerAn(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email],
  );
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email],
  );
  return u!.id;
}

/** Eine Gesellschaft, die §14 Abs. 4 Nr. 1 und Nr. 2 erfuellt, mit Kreis. */
async function macheFakturierfaehig(mandantId: string, praefix: string): Promise<void> {
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            ust_id = 'DE123456789', steuernummer = '30/123/45678'
      where id = $1`, [mandantId],
  );
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, $2, true, $3, 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [mandantId, `Rechnungen ${praefix}`, `${praefix}-{nr:5}`],
  );
}

async function legeKundeAn(mandantId: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1, 'K-1001', 'Bezirksamt Mitte', 'Karl-Marx-Allee', '31', '10178', 'Berlin')
     returning id`, [mandantId],
  );
  return k!.id;
}

interface EntwurfWunsch {
  readonly netto?: bigint;
  readonly steuergruppe?: string;
  readonly leistungVon?: string | null;
  readonly leistungBis?: string | null;
  readonly rechnungsart?: 'standard' | 'abschlag' | 'anzahlung' | 'schluss';
  readonly zahlungszielTage?: number | null;
  readonly ohnePosition?: boolean;
}

/** Ein vollstaendiger Entwurf — jeder Test nimmt ihm genau eine Angabe. */
async function entwurf(
  tx: postgres.TransactionSql, wunsch: EntwurfWunsch = {},
): Promise<string> {
  const d = alsDienst(tx);
  const id = await legeEntwurfAn(d, {
    kundeId: kunde,
    rechnungsart: wunsch.rechnungsart ?? 'standard',
    leistungVon: wunsch.leistungVon === undefined ? '2026-08-01' : wunsch.leistungVon,
    leistungBis: wunsch.leistungBis === undefined ? '2026-08-31' : wunsch.leistungBis,
    zahlungszielTage: wunsch.zahlungszielTage === undefined ? 30 : wunsch.zahlungszielTage,
  });
  if (wunsch.ohnePosition !== true) {
    await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Unterhaltsreinigung August',
      menge: milliMenge(1_000n), einheit: 'm2',
      einzelpreisCent: cent(wunsch.netto ?? 100_00n),
      steuergruppe: wunsch.steuergruppe ?? 'ust_19',
      quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
    });
  }
  return id;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn('buchhaltung@pflichtfeld.test');
  await macheFakturierfaehig(f.reinigung, 'RE');
  kunde = await legeKundeAn(f.reinigung);
  /**
   * `kleinbetrag_grenze` ist eine GLOBALE Referenztabelle (§3.2) — sie hat
   * kein `mandant_id`, und `seed()` setzt sie deshalb nicht zurueck. Ohne
   * diese Zeile traegt jeder Test die Schwelle des vorigen weiter, und die
   * Faelle, die auf einer UNBESTAETIGTEN Grenze beruhen, wurden gruen, weil
   * ein frueherer Test sie bestaetigt hatte. Genau so sehen Tests aus, die
   * sich gegenseitig bestehen.
   */
  await sql.unsafe(
    `update kleinbetrag_grenze set grenze_brutto_cent = 25000, ist_platzhalter = true
      where gueltig_von = date '2017-01-01'`);
});

afterAll(schliessen);

// ---------------------------------------------------------------------------
// Abnahme 1 — die deutsche Feld-für-Feld-Liste blockiert
// ---------------------------------------------------------------------------

interface Mangelfall {
  readonly angabe: string;
  readonly feld: string;
  /** Der Defekt wird VOR dem Entwurf hergestellt (Stammdaten) … */
  readonly vorbereiten?: () => Promise<void>;
  /** … oder der Entwurf selbst traegt ihn. */
  readonly wunsch?: EntwurfWunsch;
}

const MAENGEL: readonly Mangelfall[] = [
  {
    angabe: 'Anschrift des Leistenden (§14 Abs. 4 Nr. 1)',
    feld: 'leistender.anschrift',
    vorbereiten: async () => {
      /**
       * `eigener_nummernkreis` faellt mit — `mandant_ustg14_vollstaendig`
       * (0001) liesse die Anschrift sonst gar nicht loeschen. Genau das ist
       * der Weg, auf dem eine Gesellschaft ihre Pflichtangaben verlieren
       * kann, waehrend ihr Kreis weiter Nummern vergibt.
       */
      await sql.unsafe(
        `update mandant set eigener_nummernkreis = false, plz = null, ort = null
          where id = $1`, [f.reinigung]);
    },
  },
  {
    angabe: 'Steuernummer oder USt-IdNr. des Leistenden (§14 Abs. 4 Nr. 2, O-24)',
    feld: 'leistender.steuernummer',
    vorbereiten: async () => {
      /**
       * `mandant_ustg14_vollstaendig` (0001) haelt dasselbe — aber NUR
       * solange `eigener_nummernkreis` gesetzt ist. Genau deshalb wird das
       * Haekchen hier mit entfernt: es ist der Weg, auf dem eine Gesellschaft
       * ihre Steuernummer verlieren kann, waehrend ihr Kreis weiter Nummern
       * vergibt. O-24 muss zum Zeitpunkt der FESTSCHREIBUNG greifen.
       */
      await sql.unsafe(
        `update mandant set eigener_nummernkreis = false, ust_id = null,
                            steuernummer = null where id = $1`, [f.reinigung]);
    },
  },
  {
    angabe: 'Name und Anschrift des Leistungsempfängers (§14 Abs. 4 Nr. 1)',
    feld: 'empfaenger.anschrift',
    vorbereiten: async () => {
      await sql.unsafe(`update kunde set strasse = null, plz = null, ort = null
                         where id = $1`, [kunde]);
    },
  },
  {
    angabe: 'Menge und Art der Leistung (§14 Abs. 4 Nr. 5)',
    feld: 'positionen',
    wunsch: { ohnePosition: true },
  },
  {
    angabe: 'Zeitpunkt der Leistung (§14 Abs. 4 Nr. 6)',
    feld: 'leistungszeitpunkt',
    wunsch: { leistungVon: null, leistungBis: null },
  },
  {
    angabe: 'Hinweis auf die Vorauszahlung (§14 Abs. 4 Nr. 6)',
    feld: 'vereinnahmung',
    wunsch: { rechnungsart: 'abschlag', leistungVon: null, leistungBis: null },
  },
  {
    angabe: 'Fälligkeit (§4.2, O-66)',
    feld: 'zahlungsziel',
    wunsch: { zahlungszielTage: null },
  },
  {
    angabe: 'fortlaufende Nummer aus einem bestätigten Kreis (§14 Abs. 4 Nr. 4)',
    feld: 'nummer',
    vorbereiten: async () => {
      await sql.unsafe(
        `update nummernkreis set ist_platzhalter = true
          where mandant_id = $1 and kreis_typ = 'ausgangsrechnung'`, [f.reinigung]);
    },
  },
];

describe('Abnahme 1 — §14 Abs. 4 UStG, Feld für Feld auf Deutsch', () => {
  for (const fall of MAENGEL) {
    it(`ohne ${fall.angabe} scheitert die Festschreibung`, async () => {
      if (fall.vorbereiten !== undefined) await fall.vorbereiten();

      const abgewiesen = await inSitzung(f.reinigung, async (tx) => {
        const id = await entwurf(tx, fall.wunsch ?? {});
        const bericht = await pruefeRechnung(alsDienst(tx), id);
        let meldung = '';
        try {
          await finalisiere(alsDienst(tx), id);
        } catch (fehler) {
          meldung = (fehler as Error).message;
        }
        return { bericht, meldung, id };
      });

      // Der Befund nennt GENAU dieses Feld …
      expect(abgewiesen.bericht.fehler.map((b) => b.feld)).toContain(fall.feld);
      // … auf Deutsch, mit Fundstelle und Sprungziel (DSH-04) …
      const befund = abgewiesen.bericht.fehler.find((b) => b.feld === fall.feld)!;
      expect(befund.textDe.length).toBeGreaterThan(20);
      expect(befund.regel).toMatch(/§|O-|Invariante/u);
      // … und die Festschreibung bricht ab, statt nur zu melden.
      expect(abgewiesen.meldung).not.toBe('');

      // Und es ist keine Nummer entstanden.
      const [zeile] = await sql.unsafe<{ status: string; nummer: string | null }[]>(
        `select status::text as status, nummer from rechnung where id = $1`,
        [abgewiesen.id]);
      expect(zeile?.status).toBe('entwurf');
      expect(zeile?.nummer).toBeNull();
    });
  }

  it('der vollständige Beleg schreibt sich fest', async () => {
    const nummer = await inSitzung(f.reinigung, async (tx) => {
      const id = await entwurf(tx);
      const bericht = await pruefeRechnung(alsDienst(tx), id);
      expect(bericht.fehler).toEqual([]);
      return (await finalisiere(alsDienst(tx), id)).nummer;
    });
    expect(nummer).toBe('RE-00001');
  });

  it('der Befund liegt im Snapshot — mit Regelwerksfassung, nicht doppelt kodiert',
    async () => {
      const id = await inSitzung(f.reinigung, async (tx) => {
        const neu = await entwurf(tx);
        await finalisiere(alsDienst(tx), neu);
        return neu;
      });

      const [s] = await sql.unsafe<{
        geprueft: string; version: string; fehler: string; kleinbetrag: string;
      }[]>(
        `select pflichtfeld_pruefung ->> 'geprueft'         as geprueft,
                pflichtfeld_pruefung ->> 'regelwerk_version' as version,
                (pflichtfeld_pruefung -> 'fehler')::text     as fehler,
                (pflichtfeld_pruefung -> 'kleinbetrag')::text as kleinbetrag
           from rechnung_snapshot where rechnung_id = $1`, [id]);

      /**
       * `->> 'geprueft'` ergibt NULL, wenn jemand `JSON.stringify(obj)` in
       * `$n::jsonb` schreibt — dann liegt dort eine JSON-ZEICHENKETTE. Genau
       * diese Falle prueft diese Zeile.
       */
      expect(s?.geprueft).toBe('true');
      expect(s?.version).toBe(REGELWERK_VERSION);
      expect(s?.fehler).toBe('[]');
      expect(s?.kleinbetrag).toMatch(/"greift"/u);
    });
});

// ---------------------------------------------------------------------------
// Abnahme 2 — der Leistungszeitraum, BEIDE Zweige
// ---------------------------------------------------------------------------

describe('Abnahme 2 — §14 Abs. 4 Nr. 6 UStG hat zwei Zweige', () => {
  it('eine festgeschriebene Rechnung trägt leistung_von und leistung_bis', async () => {
    const id = await inSitzung(f.reinigung, async (tx) => {
      const neu = await entwurf(tx);
      await finalisiere(alsDienst(tx), neu);
      return neu;
    });
    const [zeile] = await sql.unsafe<{ von: string | null; bis: string | null }[]>(
      `select leistung_von::text as von, leistung_bis::text as bis
         from rechnung where id = $1`, [id]);
    expect(zeile?.von).not.toBeNull();
    expect(zeile?.bis).not.toBeNull();
  });

  /**
   * Der ZWEITE Zweig, und er ist der Grund, warum die Bedingung nicht
   * unbedingt sein darf: eine Vorauszahlungsrechnung (FIN-08) geht hinaus,
   * bevor irgendetwas geleistet ist. Eine unbedingte Leistungszeitraum-Pflicht
   * machte sie unfestschreibbar.
   */
  it('eine Abschlagsrechnung OHNE Leistungszeitraum, aber MIT geplanter '
    + 'Vereinnahmung schreibt sich fest', async () => {
    const nummer = await inSitzung(f.reinigung, async (tx) => {
      const id = await entwurf(tx, {
        rechnungsart: 'abschlag', leistungVon: null, leistungBis: null,
      });
      await tx.unsafe(
        `update rechnung set vereinnahmung_geplant_am = date '2026-09-30' where id = $1`,
        [id]);
      const bericht = await pruefeRechnung(alsDienst(tx), id);
      expect(bericht.fehler).toEqual([]);
      return (await finalisiere(alsDienst(tx), id)).nummer;
    });
    expect(nummer).toBe('RE-00001');
  });

  /** Und die Bedingung steht in der DATENBANK, nicht nur im Dienst. */
  it('die CHECK-Bedingung kennt beide Zweige', async () => {
    const [c] = await sql.unsafe<{ def: string }[]>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'rechnung_leistungszeitpunkt'`);
    expect(c?.def).toMatch(/leistung_von/u);
    expect(c?.def).toMatch(/leistung_bis/u);
    expect(c?.def).toMatch(/vereinnahmung_geplant_am/u);
    expect(c?.def).toMatch(/abschlag/u);
    expect(c?.def).toMatch(/anzahlung/u);
  });
});

// ---------------------------------------------------------------------------
// Abnahme 3 — §33 UStDV, beide Seiten der Grenze
// ---------------------------------------------------------------------------

/**
 * Die Schwelle wird BESTAETIGT — gesaet ist sie ein Platzhalter (O-175), und
 * ein Platzhalter greift nie. Dass die Zeile hier gesetzt wird und nicht im
 * Code steht, ist der Punkt der Abnahme.
 */
async function bestaetigeGrenze(cents: bigint): Promise<void> {
  await sql.unsafe(
    `update kleinbetrag_grenze
        set grenze_brutto_cent = $1, ist_platzhalter = false
      where gueltig_von = date '2017-01-01'`, [cents.toString()]);
}

/**
 * Ein Beleg, dem NUR die Empfaengeranschrift fehlt — §33 UStDV laesst genau
 * sie entfallen. Steuergruppe `ust_0_4nr12`: 0 %, also ist Brutto = Netto und
 * die Grenze laesst sich auf den Cent genau treffen. Mit 19 % laege der
 * Pruefpunkt zwischen zwei Nettobetraegen, und der Test pruefte die Rundung
 * statt die Grenze.
 */
async function kleinbetragsfall(bruttoCent: bigint): Promise<{
  fehler: readonly string[]; nummer: string | null; istKleinbetrag: boolean | null;
}> {
  await sql.unsafe(`update kunde set strasse = null, plz = null, ort = null where id = $1`,
    [kunde]);
  return inSitzung(f.reinigung, async (tx) => {
    const id = await entwurf(tx, { netto: bruttoCent, steuergruppe: 'ust_0_4nr12' });
    const bericht = await pruefeRechnung(alsDienst(tx), id);
    let nummer: string | null = null;
    try {
      nummer = (await finalisiere(alsDienst(tx), id)).nummer;
    } catch {
      nummer = null;
    }
    const [zeile] = await tx.unsafe<{ ist_kleinbetrag: boolean }[]>(
      `select ist_kleinbetrag from rechnung where id = $1`, [id]);
    return {
      fehler: bericht.fehler.map((b) => b.feld),
      nummer,
      istKleinbetrag: zeile?.ist_kleinbetrag ?? null,
    };
  });
}

describe('Abnahme 3 — §33 UStDV (FIN-13)', () => {
  it('249,99 € schreibt sich fest — die Empfängerangaben entfallen', async () => {
    await bestaetigeGrenze(25_000n);
    const e = await kleinbetragsfall(24_999n);
    expect(e.fehler).toEqual([]);
    expect(e.nummer).toBe('RE-00001');
    expect(e.istKleinbetrag).toBe(true);
  });

  it('250,00 € schreibt sich NICHT fest — die Empfängeranschrift fehlt', async () => {
    await bestaetigeGrenze(25_000n);
    const e = await kleinbetragsfall(25_000n);
    expect(e.fehler).toEqual(['empfaenger.anschrift']);
    expect(e.nummer).toBeNull();
  });

  /**
   * **Die Grenze steht in `kleinbetrag_grenze`, nicht als Konstante im Code.**
   * Derselbe Betrag, eine andere Zeile, ein anderes Ergebnis — gegen eine
   * einkompilierte 25000 bliebe dieser Fall rot.
   */
  it('eine andere Zeile verschiebt die Grenze — 250,00 € geht dann durch',
    async () => {
      await bestaetigeGrenze(30_000n);
      const e = await kleinbetragsfall(25_000n);
      expect(e.fehler).toEqual([]);
      expect(e.nummer).toBe('RE-00001');
    });

  it('die UNBESTÄTIGTE Grenze greift nie (O-175)', async () => {
    // Kein `bestaetigeGrenze` — die gesaete Zeile bleibt Platzhalter.
    const e = await kleinbetragsfall(4_000n);
    expect(e.fehler).toEqual(['empfaenger.anschrift']);
    expect(e.nummer).toBeNull();
  });

  /**
   * SQL und TypeScript legen §33 UStDV GLEICH aus. Zwei Fassungen, die
   * niemand vergleicht, sind zwei Auslegungen — und die eine, die blockiert,
   * ist dann nicht die, die der Mensch auf dem Bildschirm gesehen hat.
   */
  /**
   * **Drei Stellen, nicht zwei.** Diese Prüfung verglich die beiden LESER —
   * `fin.kleinbetrag_greift` und `kleinbetragLage` — und liess den SCHREIBER
   * aus: `fin.rechnung_nummer_ziehen` friert `ist_kleinbetrag` auf dem Beleg
   * ein, und zwar mit einer eigenen Abschrift derselben Regel. Die stand auf
   * `<=` statt auf `<`.
   *
   * Bei GENAU der Schwelle liess die Vorprüfung den Beleg also nur mit
   * vollständiger Empfängeranschrift durch und schrieb ihm im selben Vorgang
   * dauerhaft „Kleinbetrag" auf. Ein unveränderlicher Beleg, der seiner
   * eigenen Prüfung widerspricht — korrigierbar nur durch Storno und
   * Neuausstellung. Behoben in `0110`; gefunden hat es der Copilot-Durchgang
   * auf PR #7, nicht diese Prüfung, weil sie eine Ebene neben der Stelle lag.
   *
   * `24_999n` und `25_000n` sind die beiden Cent-Werte, an denen sich die
   * Auslegungen trennen. Ohne sie misst die Schleife nur, dass 40 € und
   * 250,01 € unstrittig sind.
   */
  it('Leser, Leser und SCHREIBER legen §33 UStDV gleich aus', async () => {
    await bestaetigeGrenze(25_000n);
    for (const betrag of [4_000n, 24_999n, 25_000n, 25_001n]) {
      const gleich = await inSitzung(f.reinigung, async (tx) => {
        const id = await entwurf(tx, { netto: betrag, steuergruppe: 'ust_0_4nr12' });
        await finalisiere(alsDienst(tx), id);
        const [sqlSeite] = await tx.unsafe<{ greift: boolean }[]>(
          `select fin.kleinbetrag_greift($1::uuid) as greift`, [id]);
        const [eingefroren] = await tx.unsafe<{ ist_kleinbetrag: boolean }[]>(
          `select ist_kleinbetrag from rechnung where id = $1::uuid`, [id]);
        const tsSeite = kleinbetragLage(await ladePruefEingabe(alsDienst(tx), id));
        return {
          sql: sqlSeite?.greift, ts: tsSeite.greift,
          beleg: eingefroren?.ist_kleinbetrag, betrag,
        };
      });
      expect(gleich.ts).toBe(gleich.sql);
      expect(
        gleich.beleg,
        `bei ${gleich.betrag} Cent widerspricht der eingefrorene Beleg der Prüfung, `
        + 'die ihn durchgelassen hat',
      ).toBe(gleich.ts);
      expect(gleich.ts).toBe(betrag < 25_000n);
    }
  });
});

// ---------------------------------------------------------------------------
// Abnahme 4 — wer den Validator überspringt, kommt trotzdem nicht durch
// ---------------------------------------------------------------------------

describe('Abnahme 4 — die Bedingung hält die Datenbank', () => {
  /**
   * Der Weg eines Aufrufers, der den Dienst umgeht: `cse_app` darf
   * `fin.rechnung_nummer_ziehen` unmittelbar rufen — ein Skript, ein Job, ein
   * spaeterer Dienst. Ohne den aufgeschobenen Ausloeser aus `0085` entstuende
   * hier eine Rechnung ohne Empfaengerangaben, mit Nummer und Kettenglied.
   */
  it('ein Aufruf von fin.rechnung_nummer_ziehen ohne Vorprüfung scheitert beim COMMIT',
    async () => {
      await sql.unsafe(`update kunde set strasse = null, plz = null, ort = null
                         where id = $1`, [kunde]);

      await expect(inSitzung(f.reinigung, async (tx) => {
        const id = await entwurf(tx);
        await tx.unsafe(
          `select * from fin.rechnung_nummer_ziehen($1::uuid, '{}'::jsonb)`, [id]);
        return id;
      })).rejects.toThrow(/Leistungsempfaenger/u);
    });

  it('dasselbe für O-24: ohne Steuernummer und USt-IdNr. hält die Datenbank',
    async () => {
      await sql.unsafe(
        `update mandant set eigener_nummernkreis = false, ust_id = null,
                            steuernummer = null where id = $1`, [f.reinigung]);

      await expect(inSitzung(f.reinigung, async (tx) => {
        const id = await entwurf(tx);
        await tx.unsafe(
          `select * from fin.rechnung_nummer_ziehen($1::uuid, '{}'::jsonb)`, [id]);
        return id;
      })).rejects.toThrow(/weder Steuernummer noch USt-IdNr/u);
    });

  it('und nichts davon bleibt stehen — die Transaktion ist zurückgerollt',
    async () => {
      await sql.unsafe(`update kunde set strasse = null, plz = null, ort = null
                         where id = $1`, [kunde]);
      await inSitzung(f.reinigung, async (tx) => {
        const id = await entwurf(tx);
        await tx.unsafe(
          `select * from fin.rechnung_nummer_ziehen($1::uuid, '{}'::jsonb)`, [id]);
        return id;
      }).catch(() => null);

      const [zaehler] = await sql.unsafe<{ n: string }[]>(
        `select count(*)::text as n from rechnung where status = 'festgeschrieben'`);
      expect(zaehler?.n).toBe('0');
      const [kreis] = await sql.unsafe<{ naechste: string }[]>(
        `select naechste_nummer::text as naechste from nummernkreis
          where mandant_id = $1 and kreis_typ = 'ausgangsrechnung'`, [f.reinigung]);
      expect(kreis?.naechste).toBe('1');
    });

  /** Die Regelliste hat GENAU EINE Fassung — die Wache prüft es, hier steht warum. */
  it('der Validator ist ein reiner Dienst: Vorschau und Festschreibung sehen dasselbe',
    async () => {
      await sql.unsafe(`update kunde set plz = null where id = $1`, [kunde]);
      const beide = await inSitzung(f.reinigung, async (tx) => {
        const id = await entwurf(tx);
        const vorschau = await pruefeRechnung(alsDienst(tx), id);
        let meldung = '';
        try {
          await finalisiere(alsDienst(tx), id);
        } catch (fehler) {
          meldung = (fehler as Error).message;
        }
        return { vorschau, meldung };
      });
      expect(beide.vorschau.fehler.map((b) => b.feld)).toEqual(['empfaenger.anschrift']);
      // Dieselben Sätze, nicht bloss derselbe Ausgang.
      expect(beide.meldung).toContain(beide.vorschau.fehler[0]!.textDe);
    });
});

describe('„kommt mit PR nn" bleibt wahr — sonst lügt ein eingefrorener Beleg', () => {
  /**
   * **Der Fall, aus dem diese Prüfung kommt.** Zwei Einträge in
   * `NICHT_GEPRUEFT` sagten „Kommt mit PR 49", nachdem PR 49 sie gebracht
   * hatte. Der Pflichtfeldbericht wird mit dem Snapshot EINGEFROREN: jede ab
   * dann festgeschriebene Rechnung hätte dauerhaft behauptet, ihre Herkunft
   * sei nicht geprüft worden — obwohl beides in derselben Transaktion
   * geprüft wurde. Eine falsche Angabe in einem unveränderlichen Beleg ist
   * teurer als eine fehlende, und niemand kann sie später korrigieren.
   *
   * Auffallen konnte das nicht: die Einträge sind Fließtext, den kein
   * Typprüfer liest, und der Bericht wurde nur auf seine FEHLER geprüft.
   *
   * **Die erste Fassung dieser Prüfung las die Namen mit einem Ausdruck aus
   * dem Fließtext — und fand zwei von sechs**, weil sie dort in Klammern
   * stehen und nicht in Backticks. Gemeldet hat das die Gegenprobe unten,
   * nicht ich. Eine Wache, die aus Prosa liest, prüft am Ende die Prosa;
   * deshalb trägt jeder Eintrag seine Tabellen jetzt in `solangeOhne`.
   */
  it('keine der Tabellen, deren Fehlen einen Eintrag begründet, gibt es schon', async () => {
    const genannt = NICHT_GEPRUEFT.flatMap((n) => n.solangeOhne ?? []);

    // Gegenprobe gegen die leere Messung: vier Einträge nennen zusammen
    // sieben Tabellen (1 + 2 + 2 + 2). Fällt das auf null, prüfte der Rest
    // nichts — und wer einen Eintrag ergänzt, kommt hier vorbei.
    expect(genannt).toHaveLength(7);

    const vorhanden = await sql.unsafe<{ table_name: string }[]>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name = any($1::text[])`,
      [genannt] as never[],
    );
    expect(vorhanden.map((z) => z.table_name)).toEqual([]);
  });
});
