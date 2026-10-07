/**
 * Die Freistellungsbescheinigungen nach § 48b EStG pflegen — gegen echte
 * Policies, Rechte und Auslöser (FIN-10, LEG-06, V-283, O-604, D-845).
 *
 * **Der Befund.** `freistellungsbescheinigung` (0118) hatte keinen Schreibweg
 * ausser dem Seed: die Steuerseite der Eingangsrechnung zeigte, was es nicht
 * gab, und „ohne gültige Bescheinigung wird einbehalten" liess sich in keiner
 * Gesellschaft ohne Demodaten anders beantworten.
 *
 * **Die Sätze, die diese Datei beweist — jeder fällt ohne die Umsetzung:**
 *
 *  1. Erfassen für einen Lieferanten oder einen Kunden, unbeschränkt oder für
 *     EINEN Auftrag, mit Mensch und Protokollzeile. Jede unvollständige oder
 *     fremde Angabe wird mit ihrem Grund abgewiesen; eine Nummer gibt es je
 *     Gesellschaft einmal.
 *  2. Nach dem Erfassen steht sie fest (0530): Nummer, Finanzamt, Zeitraum,
 *     Umfang und Träger ändern sich nicht — auch nicht am Dienst vorbei.
 *  3. Widerrufen wird einmal, ab heute oder später, nie rückwirkend und nie
 *     nach ihrem Ablauf; eine künftige Bescheinigung ab ihrem ersten Tag.
 *  4. Der Beleg wird einmal verknüpft und nicht getauscht.
 *  5. Ohne `finanzen.schreiben`, in der Gruppenansicht und in einer fremden
 *     Gesellschaft ändert sich nichts.
 *  6. Die Liste nennt den Stand am Berliner Tag der Datenbank; die Auswahl
 *     des Formulars bietet nur Eigenes und Lebendes an.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { tagePlus } from '../../src/lib/datum/kalendertag.js';
import {
  FreistellungFehler, ladeFreistellungAuswahl, legeFreistellungAn, listeFreistellungen,
  verknuepfeFreistellungsbeleg, widerrufeFreistellung, type NeueFreistellung,
} from '../../src/server/services/finanz/freistellung.js';

let f: Fixtur;
let heute: string;
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(mandant: string, rolle = 'admin'): Promise<string> {
  const email = `freistellung-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId(rolle)]);
  return u!.id;
}

async function lieferant(mandant: string): Promise<string> {
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into lieferant (mandant_id, lieferantennummer, name, plz, ort, status,
                            erstellt_von_art, erstellt_von_dienst)
     values ($1, $2, 'Trockenbau Nord GmbH', '10115', 'Berlin', 'aktiv', 'system', 'job:test')
     returning id`, [mandant, `L-${zufall()}`]);
  return l!.id;
}

async function kunde(mandant: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Bauherr Süd GmbH') returning id`, [mandant, `K-${zufall()}`]);
  return k!.id;
}

async function auftrag(mandant: string, kundeId: string, benutzer: string): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,'projekt','aktiv','Rohbau Süd',$4,'2026-01-01') returning id`,
    [mandant, `AU-${zufall()}`, kundeId, benutzer] as never[]);
  return a!.id;
}

async function beleg(mandant: string): Promise<string> {
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument (mandant_id, kategorie, titel, mime_typ, mime_verifiziert,
                           groesse_bytes, bucket, objekt_schluessel, exif_entfernt)
     values ($1, 'buchhaltung', 'Freistellungsbescheinigung (Scan)', 'application/pdf', true,
             1024, 'dokumente', $2, true)
     returning id`, [mandant, `${mandant}/buchhaltung/${zufall()}`]);
  return d!.id;
}

function kontextAus(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
): SchreibKontext {
  const abfrage = async <T>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

async function als<T>(
  mandant: string, benutzer: string, fn: (k: SchreibKontext) => Promise<T>, readonly = false,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, mandantIds: [mandant], benutzerId: benutzer,
      portal: 'intern', readonly },
    async (tx) => fn(kontextAus(tx, mandant, benutzer)));
}

async function grund(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(FreistellungFehler);
  return (e as FreistellungFehler).grund;
}

async function sqlCode(p: Promise<unknown>): Promise<string | undefined> {
  const e = await p.then(() => null, (x: unknown) => x as { code?: string });
  expect(e).not.toBeNull();
  return e?.code;
}

interface Zeile {
  kunde_id: string | null; lieferant_id: string | null; bescheinigung_nummer: string;
  finanzamt: string; gueltig_von: string; gueltig_bis: string; widerrufen_am: string | null;
  umfang: string; auftrag_id: string | null; dokument_id: string | null;
  erstellt_von: string | null; geaendert_von: string | null;
}

async function zeile(id: string): Promise<Zeile> {
  const [z] = await sql.unsafe<Zeile[]>(
    `select kunde_id, lieferant_id, bescheinigung_nummer, finanzamt,
            to_char(gueltig_von, 'YYYY-MM-DD') as gueltig_von,
            to_char(gueltig_bis, 'YYYY-MM-DD') as gueltig_bis,
            to_char(widerrufen_am, 'YYYY-MM-DD') as widerrufen_am,
            umfang::text as umfang, auftrag_id, dokument_id, erstellt_von, geaendert_von
       from freistellungsbescheinigung where id = $1`, [id]);
  return z!;
}

/** Die Protokollzeilen DES DIENSTES — neben denen des allgemeinen Prüfprotokolls. */
async function protokoll(id: string): Promise<{ aktion: string; nachher: Record<string, unknown> }[]> {
  return sql.unsafe(
    `select aktion, nachher from audit_log
      where objekt_typ = 'freistellungsbescheinigung' and objekt_id = $1
        and aktion in ('freistellungsbescheinigung.angelegt',
                       'freistellungsbescheinigung.widerrufen',
                       'freistellungsbescheinigung.beleg_verknuepft')
      order by id`, [id]);
}

function eingabe(traegerId: string, mehr: Partial<NeueFreistellung> = {}): NeueFreistellung {
  return {
    traeger: 'lieferant', traegerId, nummer: `FB-${zufall()}`,
    finanzamt: 'Finanzamt Berlin Mitte/Tiergarten',
    gueltigVon: tagePlus(heute, -30), gueltigBis: tagePlus(heute, 300),
    umfang: 'unbeschraenkt', ...mehr,
  };
}

beforeEach(async () => {
  f = await seed();
  const [t] = await sql.unsafe<{ heute: string }[]>(
    `select to_char(app.berlin_heute(), 'YYYY-MM-DD') as heute`);
  heute = t!.heute;
});
afterAll(schliessen);

describe('(1) Erfassen', () => {
  it('für einen Lieferanten, unbeschränkt, mit Beleg — Mensch und Protokoll stehen da', async () => {
    const admin = await konto(f.bau);
    const l = await lieferant(f.bau);
    const d = await beleg(f.bau);
    const neu = eingabe(l, { nummer: '  FB-2026-0042 ', dokumentId: d });
    const { id } = await als(f.bau, admin, (k) => legeFreistellungAn(k, neu));

    expect(await zeile(id)).toMatchObject({
      kunde_id: null, lieferant_id: l, bescheinigung_nummer: 'FB-2026-0042',
      finanzamt: 'Finanzamt Berlin Mitte/Tiergarten', gueltig_von: neu.gueltigVon,
      gueltig_bis: neu.gueltigBis, widerrufen_am: null, umfang: 'unbeschraenkt',
      auftrag_id: null, dokument_id: d, erstellt_von: admin,
    });
    expect(await protokoll(id)).toEqual([{ aktion: 'freistellungsbescheinigung.angelegt',
      nachher: { traeger: 'lieferant', nummer: 'FB-2026-0042',
        finanzamt: 'Finanzamt Berlin Mitte/Tiergarten', gueltig_von: neu.gueltigVon,
        gueltig_bis: neu.gueltigBis, umfang: 'unbeschraenkt' } }]);
  });

  it('für einen Kunden, für EINEN Auftrag', async () => {
    const admin = await konto(f.bau);
    const k = await kunde(f.bau);
    const a = await auftrag(f.bau, k, admin);
    const { id } = await als(f.bau, admin, (kx) => legeFreistellungAn(kx,
      eingabe(k, { traeger: 'kunde', umfang: 'auftragsbezogen', auftragId: a })));
    expect(await zeile(id)).toMatchObject({
      kunde_id: k, lieferant_id: null, umfang: 'auftragsbezogen', auftrag_id: a,
    });
  });

  it('jede unvollständige oder fremde Angabe wird mit ihrem Grund abgewiesen', async () => {
    const admin = await konto(f.bau);
    const l = await lieferant(f.bau);
    const k = await kunde(f.bau);
    const fremderLieferant = await lieferant(f.reinigung);
    const fremderKunde = await kunde(f.reinigung);
    const fremderAuftrag = await auftrag(f.reinigung, fremderKunde, await konto(f.reinigung));
    const fremderBeleg = await beleg(f.reinigung);
    const versuch = (e: NeueFreistellung): Promise<string> =>
      grund(als(f.bau, admin, (kx) => legeFreistellungAn(kx, e)));

    expect(await versuch(eingabe(l, { traeger: 'bank' }))).toBe('traeger_fehlt');
    expect(await versuch(eingabe(''))).toBe('traeger_fehlt');
    expect(await versuch(eingabe(fremderLieferant))).toBe('traeger_unbekannt');
    // Die Kennung eines Kunden als Lieferant: es gibt keinen solchen Lieferanten.
    expect(await versuch(eingabe(k))).toBe('traeger_unbekannt');
    expect(await versuch(eingabe(fremderKunde, { traeger: 'kunde' }))).toBe('traeger_unbekannt');
    expect(await versuch(eingabe(l, { nummer: ' ab ' }))).toBe('nummer_fehlt');
    expect(await versuch(eingabe(l, { finanzamt: '' }))).toBe('finanzamt_fehlt');
    expect(await versuch(eingabe(l, { gueltigVon: '2026-02-30' }))).toBe('zeitraum_ungueltig');
    expect(await versuch(eingabe(l, { gueltigVon: heute, gueltigBis: tagePlus(heute, -1) })))
      .toBe('zeitraum_ungueltig');
    expect(await versuch(eingabe(l, { umfang: 'auftragsbezogen' }))).toBe('auftrag_fehlt');
    expect(await versuch(eingabe(l, { umfang: 'auftragsbezogen', auftragId: fremderAuftrag })))
      .toBe('auftrag_unbekannt');
    expect(await versuch(eingabe(l, { dokumentId: fremderBeleg }))).toBe('beleg_unbekannt');

    const [anzahl] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from freistellungsbescheinigung where mandant_id = $1`, [f.bau]);
    expect(anzahl?.n).toBe(0);
  });

  it('eine Nummer gibt es je Gesellschaft einmal — in einer anderen darf sie wieder stehen', async () => {
    const admin = await konto(f.bau);
    const l = await lieferant(f.bau);
    await als(f.bau, admin, (k) => legeFreistellungAn(k, eingabe(l, { nummer: 'FB-777' })));
    expect(await grund(als(f.bau, admin, (k) =>
      legeFreistellungAn(k, eingabe(l, { nummer: 'FB-777' }))))).toBe('nummer_vergeben');

    const andere = await konto(f.reinigung);
    const l2 = await lieferant(f.reinigung);
    await als(f.reinigung, andere, (k) => legeFreistellungAn(k, eingabe(l2, { nummer: 'FB-777' })));
  });
});

describe('(2) erfasst steht sie fest (0530)', () => {
  it('Kernfelder ändern sich nicht — auch nicht am Dienst vorbei', async () => {
    const admin = await konto(f.bau);
    const l = await lieferant(f.bau);
    const k = await kunde(f.bau);
    const { id } = await als(f.bau, admin, (kx) => legeFreistellungAn(kx, eingabe(l)));
    for (const aenderung of [
      `bescheinigung_nummer = 'FB-ANDERS'`,
      `finanzamt = 'Finanzamt Neukölln'`,
      `gueltig_bis = gueltig_bis + 365`,
      `gueltig_von = gueltig_von - 1`,
      `lieferant_id = null, kunde_id = '${k}'`,
    ]) {
      await expect(sql.unsafe(
        `update freistellungsbescheinigung set ${aenderung} where id = $1`, [id]),
      aenderung).rejects.toThrow(/aendert sich nach dem Anlegen nicht/u);
    }
    // Die Geändert-Spalten bleiben frei.
    await sql.unsafe(
      `update freistellungsbescheinigung set geaendert_am = now() where id = $1`, [id]);
  });
});

describe('(3) Widerrufen', () => {
  it('ab heute — einmal, nie rückwirkend, nie nach dem Ablauf', async () => {
    const admin = await konto(f.bau);
    const l = await lieferant(f.bau);
    const { id } = await als(f.bau, admin, (k) => legeFreistellungAn(k, eingabe(l)));
    const bis = (await zeile(id)).gueltig_bis;

    expect(await grund(als(f.bau, admin, (k) => widerrufeFreistellung(k, id, tagePlus(heute, -1)))))
      .toBe('widerruf_rueckwirkend');
    expect(await grund(als(f.bau, admin, (k) => widerrufeFreistellung(k, id, 'gestern'))))
      .toBe('widerruf_rueckwirkend');
    expect(await grund(als(f.bau, admin, (k) => widerrufeFreistellung(k, id, tagePlus(bis, 1)))))
      .toBe('widerruf_nach_ablauf');
    expect((await zeile(id)).widerrufen_am).toBeNull();

    await als(f.bau, admin, (k) => widerrufeFreistellung(k, id, heute));
    expect(await zeile(id)).toMatchObject({ widerrufen_am: heute, geaendert_von: admin });
    expect((await protokoll(id)).at(-1)).toEqual({ aktion: 'freistellungsbescheinigung.widerrufen',
      nachher: { nummer: (await zeile(id)).bescheinigung_nummer, widerrufen_am: heute } });

    expect(await grund(als(f.bau, admin, (k) => widerrufeFreistellung(k, id, tagePlus(heute, 5)))))
      .toBe('schon_widerrufen');
    // Am Dienst vorbei: ein Widerruf wird weder verschoben noch zurückgenommen.
    await expect(sql.unsafe(
      `update freistellungsbescheinigung set widerrufen_am = null where id = $1`, [id]))
      .rejects.toThrow(/nicht geaendert und nicht zurueckgenommen/u);
  });

  it('eine künftige Bescheinigung wird ab ihrem ersten Tag widerrufen', async () => {
    const admin = await konto(f.bau);
    const l = await lieferant(f.bau);
    const von = tagePlus(heute, 10);
    const { id } = await als(f.bau, admin, (k) => legeFreistellungAn(k,
      eingabe(l, { gueltigVon: von, gueltigBis: tagePlus(heute, 400) })));
    await als(f.bau, admin, (k) => widerrufeFreistellung(k, id, heute));
    expect((await zeile(id)).widerrufen_am).toBe(von);
  });

  it('rückwirkend auch nicht am Dienst vorbei (0530)', async () => {
    const admin = await konto(f.bau);
    const l = await lieferant(f.bau);
    const { id } = await als(f.bau, admin, (k) => legeFreistellungAn(k, eingabe(l)));
    await expect(sql.unsafe(
      `update freistellungsbescheinigung set widerrufen_am = app.berlin_heute() - 1
        where id = $1`, [id])).rejects.toThrow(/nicht rueckwirkend/u);
  });
});

describe('(4) der Beleg', () => {
  it('wird einmal verknüpft und nicht getauscht', async () => {
    const admin = await konto(f.bau);
    const l = await lieferant(f.bau);
    const d1 = await beleg(f.bau);
    const d2 = await beleg(f.bau);
    const { id } = await als(f.bau, admin, (k) => legeFreistellungAn(k, eingabe(l)));

    expect(await grund(als(f.bau, admin, (k) => verknuepfeFreistellungsbeleg(k, id, 'kein-beleg'))))
      .toBe('beleg_unbekannt');
    await als(f.bau, admin, (k) => verknuepfeFreistellungsbeleg(k, id, d1));
    expect((await zeile(id)).dokument_id).toBe(d1);
    expect((await protokoll(id)).at(-1)).toEqual({
      aktion: 'freistellungsbescheinigung.beleg_verknuepft',
      nachher: { nummer: (await zeile(id)).bescheinigung_nummer, dokument: d1 } });

    expect(await grund(als(f.bau, admin, (k) => verknuepfeFreistellungsbeleg(k, id, d2))))
      .toBe('beleg_vorhanden');
    await expect(sql.unsafe(
      `update freistellungsbescheinigung set dokument_id = $2 where id = $1`, [id, d2]))
      .rejects.toThrow(/nicht getauscht/u);
    expect((await zeile(id)).dokument_id).toBe(d1);
  });
});

describe('(5) ohne Recht, in der Gruppenansicht, in fremder Gesellschaft: nichts', () => {
  it('Leitung liest, schreibt aber ohne finanzen.schreiben nichts (O-604)', async () => {
    const admin = await konto(f.bau);
    const leitung = await konto(f.bau, 'leitung');
    // Den Kunden sieht die Leitung (crm.lesen) — es fehlt nur das Schreibrecht.
    const k = await kunde(f.bau);
    expect(await sqlCode(als(f.bau, leitung, (kx) =>
      legeFreistellungAn(kx, eingabe(k, { traeger: 'kunde' }))))).toBe('42501');

    const { id } = await als(f.bau, admin, (kx) =>
      legeFreistellungAn(kx, eingabe(k, { traeger: 'kunde' })));
    const liste = await als(f.bau, leitung, (k) => listeFreistellungen(k));
    expect(liste.zeilen.map((z) => z.id)).toEqual([id]);
    expect(await sqlCode(als(f.bau, leitung, (k) => widerrufeFreistellung(k, id, heute))))
      .toBe('42501');
    expect((await zeile(id)).widerrufen_am).toBeNull();
  });

  it('mit gebundenem finanzen.schreiben darf die Leitung — Lieferanten erst mit eingang.lesen', async () => {
    const leitung = await konto(f.bau, 'leitung');
    const binde = async (recht: string): Promise<void> => {
      await sql.unsafe(
        `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
         select $1, b.id, $2, true from berechtigung b where b.schluessel = $3`,
        [await rolleId('leitung'), f.bau, recht]);
    };
    await binde('finanzen.schreiben');
    const k = await kunde(f.bau);
    const fuerKunde = await als(f.bau, leitung, (kx) =>
      legeFreistellungAn(kx, eingabe(k, { traeger: 'kunde' })));
    expect((await zeile(fuerKunde.id)).erstellt_von).toBe(leitung);

    /*
     * Den Lieferanten zeigt die Policy auf `lieferant` nur mit `eingang.lesen`
     * (0123, für die Leitung bindbar): ohne es gibt es ihn für diese Sitzung
     * nicht — und die Bescheinigung wird nicht an einem Unsichtbaren erfasst.
     */
    const l = await lieferant(f.bau);
    expect(await grund(als(f.bau, leitung, (kx) => legeFreistellungAn(kx, eingabe(l)))))
      .toBe('traeger_unbekannt');
    await binde('eingang.lesen');
    const fuerLieferant = await als(f.bau, leitung, (kx) => legeFreistellungAn(kx, eingabe(l)));
    expect((await zeile(fuerLieferant.id)).lieferant_id).toBe(l);
  });

  it('in der Gruppenansicht (nur lesend) wird nichts erfasst oder widerrufen', async () => {
    const admin = await konto(f.bau);
    const l = await lieferant(f.bau);
    expect(await sqlCode(als(f.bau, admin, (k) => legeFreistellungAn(k, eingabe(l)), true)))
      .toBe('42501');
    const { id } = await als(f.bau, admin, (k) => legeFreistellungAn(k, eingabe(l)));
    expect(await sqlCode(als(f.bau, admin, (k) => widerrufeFreistellung(k, id, heute), true)))
      .toBe('42501');
    expect((await zeile(id)).widerrufen_am).toBeNull();
  });

  it('die Bescheinigung einer anderen Gesellschaft gibt es hier nicht', async () => {
    const admin = await konto(f.bau);
    const andere = await konto(f.reinigung);
    const l = await lieferant(f.reinigung);
    const { id } = await als(f.reinigung, andere, (k) => legeFreistellungAn(k, eingabe(l)));
    expect(await grund(als(f.bau, admin, (k) => widerrufeFreistellung(k, id, heute))))
      .toBe('nicht_gefunden');
    expect(await grund(als(f.bau, admin, (k) =>
      verknuepfeFreistellungsbeleg(k, id, '00000000-0000-4000-8000-000000000000'))))
      .toBe('nicht_gefunden');
    expect((await als(f.bau, admin, (k) => listeFreistellungen(k))).zeilen).toEqual([]);
    expect((await zeile(id)).widerrufen_am).toBeNull();
  });
});

describe('(6) die Liste', () => {
  it('nennt den Stand am Berliner Tag der Datenbank', async () => {
    const admin = await konto(f.bau);
    const l = await lieferant(f.bau);
    const gueltig = await als(f.bau, admin, (k) => legeFreistellungAn(k, eingabe(l)));
    const kuenftig = await als(f.bau, admin, (k) => legeFreistellungAn(k,
      eingabe(l, { gueltigVon: tagePlus(heute, 1), gueltigBis: tagePlus(heute, 30) })));
    const abgelaufen = await als(f.bau, admin, (k) => legeFreistellungAn(k,
      eingabe(l, { gueltigVon: tagePlus(heute, -400), gueltigBis: tagePlus(heute, -1) })));
    const widerrufen = await als(f.bau, admin, (k) => legeFreistellungAn(k, eingabe(l)));
    await als(f.bau, admin, (k) => widerrufeFreistellung(k, widerrufen.id, heute));

    const liste = await als(f.bau, admin, (k) => listeFreistellungen(k));
    expect(liste.heute).toBe(heute);
    const stand = Object.fromEntries(liste.zeilen.map((z) => [z.id, z.stand]));
    expect(stand).toEqual({
      [gueltig.id]: 'gueltig', [kuenftig.id]: 'kuenftig',
      [abgelaufen.id]: 'abgelaufen', [widerrufen.id]: 'widerrufen',
    });
    const z = liste.zeilen.find((x) => x.id === gueltig.id);
    expect(z).toMatchObject({ traeger: 'lieferant', traegerId: l,
      traegerName: 'Trockenbau Nord GmbH', belege: 0, dokumentId: null });
    // Die am längsten gültigen zuerst.
    expect(liste.zeilen.at(-1)?.id).toBe(abgelaufen.id);
  });
});

describe('(6) und die Auswahl des Formulars', () => {
  it('nur Eigenes und Lebendes: kein archivierter Lieferant, kein fremder Beleg', async () => {
    const admin = await konto(f.bau);
    const l = await lieferant(f.bau);
    const alt = await lieferant(f.bau);
    await sql.unsafe(`update lieferant set archiviert_am = now() where id = $1`, [alt]);
    const k = await kunde(f.bau);
    const a = await auftrag(f.bau, k, admin);
    const d = await beleg(f.bau);
    const fremd = await beleg(f.reinigung);

    const auswahl = await als(f.bau, admin, (kx) => ladeFreistellungAuswahl(kx));
    const ids = (xs: readonly { id: string }[]): string[] => xs.map((x) => x.id);
    expect(ids(auswahl.lieferanten)).toContain(l);
    expect(ids(auswahl.lieferanten)).not.toContain(alt);
    expect(ids(auswahl.kunden)).toContain(k);
    expect(ids(auswahl.auftraege)).toContain(a);
    expect(ids(auswahl.belege)).toContain(d);
    expect(ids(auswahl.belege)).not.toContain(fremd);
    expect(auswahl.auftraege.find((x) => x.id === a)?.name).toContain('Rohbau Süd');
  });
});
