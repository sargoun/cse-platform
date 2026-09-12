/**
 * Was passiert, wenn EIN Beleg zwei datierte Fassungen desselben Steuersatzes
 * trägt — der Pfad, den `0087` möglich gemacht und den niemand je gefahren hat.
 *
 * **Warum es diese Datei gibt.** `0087` hat `ssg_schluessel_uk` fallen lassen,
 * damit `ust_19` eine Geschichte haben kann. Damit können die Positionen EINES
 * Entwurfs auf zwei datierte Zeilen desselben Schlüssels zeigen — und
 * `schreibeSummen` hat dafür eine Abweisung (`mehrdeutige_steuergruppe`), die
 * in keinem einzigen Test vorkam. Eine Abweisung, die nie gelaufen ist, ist
 * eine Behauptung: sie könnte genauso gut unerreichbar sein, und der Beleg
 * wiese dann eine datierte Gruppe für die Nettobeträge ZWEIER Sätze aus — nach
 * §14 Abs. 4 Nr. 8 UStG falsch, und nach dem Festschreiben unveränderlich.
 *
 * **Der Weg dorthin ist der normale Arbeitsablauf, keine Laborbedingung.**
 * Der Stichtag der Satzauflösung kommt aus dem KOPF (`rechnung.ts`:
 * `leistung_bis → leistung_von → vereinnahmung_geplant_am → heute`). Wer erst
 * Zeilen erfasst und den Leistungszeitraum danach einträgt — und so füllt man
 * ein Formular —, löst die erste Zeile gegen den einen und die zweite gegen
 * den anderen Satz auf.
 *
 * **Falsifizierbar:** ohne zweite datierte Zeile geht derselbe Ablauf durch.
 * Sonst prüfte diese Datei nur, dass Festschreiben schwierig ist.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  fuegePositionHinzu, legeEntwurfAn, finalisiere, RechnungFehler, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';

let f: Fixtur;
let benutzer: string;
let kunde: string;

/** Vor dem Schnitt und danach — beide innerhalb desselben Entwurfs. */
const VORHER = '2026-06-30';
const NACHHER = '2026-08-31';
const SCHNITT = '2026-07-01';

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

function sitzung() {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

beforeEach(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('satz@cse.test') returning id`,
  );
  benutzer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [benutzer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'satz@cse.test', 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [benutzer],
  );
  await sql.unsafe(
    `update mandant set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            ust_id = 'DE123456789'
      where id = $1`, [f.reinigung],
  );
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [f.reinigung],
  );
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1, 'K-3001', 'Bezirksamt Mitte', 'Karl-Marx-Allee', '31', '10178', 'Berlin')
     returning id`, [f.reinigung],
  );
  kunde = k!.id;
}, 120_000);

afterAll(schliessen);

/** Schneidet `ust_19` in zwei datierte Fassungen — 19 % bis, 20 % ab. */
async function satzAendern(): Promise<void> {
  await sql.unsafe(
    `update steuersatz_gruppe set gueltig_bis = $1::date
      where schluessel = 'ust_19' and gueltig_bis is null`, [VORHER],
  );
  await sql.unsafe(
    `insert into steuersatz_gruppe
       (schluessel, bezeichnung, satz_bp, kategorie, steuer_kennzeichen, gueltig_von)
     select schluessel, bezeichnung, 2000, kategorie, steuer_kennzeichen, $1::date
       from steuersatz_gruppe where schluessel = 'ust_19' and gueltig_bis = $2::date`,
    [SCHNITT, VORHER],
  );
}

/**
 * Ein Entwurf mit zwei Zeilen, dazwischen wandert der Leistungszeitraum über
 * den Schnitt. Genau die Reihenfolge, in der ein Mensch das Formular ausfüllt.
 */
async function belegUeberDenSchnitt(): Promise<string> {
  return alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    const id = await legeEntwurfAn(d, {
      kundeId: kunde, leistungVon: '2026-06-01', leistungBis: VORHER,
      zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Unterhaltsreinigung Juni',
      menge: milliMenge(1000n), einheit: 'stk', einzelpreisCent: cent(10_000n),
      steuergruppe: 'ust_19', quellen: vonHand('Testfixtur — von Hand erfasst'),
    });

    await tx.unsafe(
      `update rechnung set leistung_von = '2026-08-01', leistung_bis = $2::date
        where id = $1`, [id, NACHHER] as never[],
    );
    await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Unterhaltsreinigung August',
      menge: milliMenge(1000n), einheit: 'stk', einzelpreisCent: cent(10_000n),
      steuergruppe: 'ust_19', quellen: vonHand('Testfixtur — von Hand erfasst'),
    });
    return id;
  });
}

describe('ein Schlüssel mit zwei datierten Fassungen auf EINEM Beleg', () => {
  it('wird abgewiesen statt unter EINE Gruppe summiert', async () => {
    await satzAendern();
    const id = await belegUeberDenSchnitt();

    // Die beiden Zeilen zeigen wirklich auf ZWEI Gruppen — sonst prüfte der
    // Rest dieser Zusicherung einen Fall, den es gar nicht gab.
    const gruppen = await sql.unsafe<{ anzahl: string }[]>(
      `select count(distinct steuersatz_gruppe_id)::text as anzahl
         from rechnungsposition where rechnung_id = $1::uuid`, [id],
    );
    expect(gruppen[0]?.anzahl).toBe('2');

    await expect(
      alsApp(sitzung(), (tx) => finalisiere(alsDienst(tx), id)),
    ).rejects.toMatchObject({
      name: 'RechnungFehler', grund: 'mehrdeutige_steuergruppe',
    });
  });

  it('und der Beleg bleibt Entwurf — ohne Nummer aus dem Kreis', async () => {
    await satzAendern();
    const id = await belegUeberDenSchnitt();
    await alsApp(sitzung(), (tx) => finalisiere(alsDienst(tx), id)).catch(
      (fehler: unknown) => { expect(fehler).toBeInstanceOf(RechnungFehler); },
    );

    const [z] = await sql.unsafe<{ status: string; nummer: string | null }[]>(
      `select status::text, nummer from rechnung where id = $1::uuid`, [id],
    );
    expect(z?.status).toBe('entwurf');
    // Invariante 4: ein Entwurf hat keine Nummer, und ein gescheiterter
    // Versuch darf den Zähler nicht weitergerückt haben.
    expect(z?.nummer).toBeNull();
  });

  it('Gegenprobe: OHNE zweite datierte Fassung geht derselbe Ablauf durch', async () => {
    const id = await belegUeberDenSchnitt();
    const ergebnis = await alsApp(sitzung(), (tx) => finalisiere(alsDienst(tx), id));
    expect(ergebnis.nummer).toMatch(/^RE-\d{5}$/u);
  });
});
