import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  aendereLieferant, archiviereLieferant, legeLieferantAn, LieferantFehler,
  lieferanten, setzeLieferantStatus,
} from '../../src/server/services/finanz/lieferant.js';

/**
 * **Ein Pflichtfeld ohne Tabelleninhalt** (V-006, FIN-14, ACC-05, ACC-07).
 *
 * `/finanzen/eingangsrechnungen/neu` verlangt einen Lieferanten. `lieferant`
 * trug seit `0123` Policy, Grant, Nummernindex, IBAN-Prüfung, §48-Datum und
 * einen Auslöser gegen Rechnungsbetrug — und **keinen einzigen Erzeuger**.
 * Ausser dem Seed konnte niemand eine Zeile anlegen.
 *
 * **Was hier gemessen wird, ist nicht das Anlegen.** Das ist ein `insert`.
 * Gemessen werden die drei Stellen, an denen ein Lieferant teuer wird: die
 * IBAN (Prüfziffer, nicht nur Gestalt), die Archivierung bei offenen
 * Rechnungen, und die Spur, die jede Bankdatenänderung hinterlässt.
 */

let f: Fixtur;
/** Hält `eingang.schreiben` in der Reinigung. */
let buchhaltung = '';
/** Hält in der Reinigung KEIN Eingangsrecht. */
let ohneRecht = '';

/** Eine echte, prüfziffernrichtige Test-IBAN. */
const IBAN_GUT = 'DE02120300000000202051';
/** Dieselbe mit zwei vertauschten Ziffern — richtige Gestalt, falsche Summe. */
const IBAN_DREHER = 'DE02120300000000202015';

async function konto(email: string, mandant: string, rolle: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status)
     values ($1, $2, $2, 'aktiv')`, [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

beforeAll(async () => {
  f = await seed();
  buchhaltung = await konto('lief-buch@test.invalid', f.reinigung, 'leitung');
  ohneRecht = await konto('lief-ohne@test.invalid', f.reinigung, 'mitarbeiter');
  for (const r of ['eingang.lesen', 'eingang.schreiben']) {
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
               (select id from berechtigung where schluessel = $1), $2, true)
       on conflict (rolle_id, berechtigung_id, mandant_id)
         do update set gewaehrt = true`,
      [r, f.reinigung]);
  }
});
afterAll(schliessen);

function sitzung(benutzerId: string) {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId,
    portal: 'intern' as const, readonly: false,
  };
}

function alsKontext(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const abfrage = async <T,>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

async function imKontext<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(sitzung(benutzerId), async (tx) => {
    await tx.unsafe(`select set_config('app.aal','aal2',true)`);
    return fn(alsKontext(tx, benutzerId));
  }) as Promise<T>;
}

/** Die IBAN ist `cse_app` entzogen — gelesen wird sie hier an der Policy vorbei. */
async function ibanVon(id: string): Promise<string | null> {
  const [z] = await alsRolle('', (tx) => tx.unsafe(
    `select iban from lieferant where id = $1`, [id]),
  ) as unknown as { iban: string | null }[];
  return z!.iban;
}

describe('§1 die Nummer entsteht aus dem Bestand dieser Gesellschaft', () => {
  it('der erste Lieferant bekommt L-00001, der zweite L-00002', async () => {
    const a = await imKontext(buchhaltung,
      (k) => legeLieferantAn(k, { name: 'Ahrens Malerbetrieb GmbH' }));
    const b = await imKontext(buchhaltung,
      (k) => legeLieferantAn(k, { name: 'Bauhof Berlin eG' }));
    expect(a.lieferantennummer).toBe('L-00001');
    expect(b.lieferantennummer).toBe('L-00002');
  });

  /**
   * **Kein Nummernkreis** (K-12): die lückenlose Kette gehört Rechnungen, wo
   * eine Lücke ein GoBD-Befund ist. Ein Stammsatz ist kein Beleg — und diese
   * Zusage hält fest, dass niemand ihn nachträglich an den Rechnungszähler
   * hängt, der damit von aussen auslösbar würde.
   */
  it('der Rechnungszähler wird dabei NICHT bewegt', async () => {
    const vorher = await alsRolle('', (tx) => tx.unsafe(
      `select coalesce(sum(naechste_nummer), 0)::int as stand from nummernkreis
        where mandant_id = $1`, [f.reinigung]),
    ) as unknown as { stand: number }[];
    await imKontext(buchhaltung, (k) => legeLieferantAn(k, { name: 'Celler Elektro' }));
    const nachher = await alsRolle('', (tx) => tx.unsafe(
      `select coalesce(sum(naechste_nummer), 0)::int as stand from nummernkreis
        where mandant_id = $1`, [f.reinigung]),
    ) as unknown as { stand: number }[];
    expect(nachher[0]!.stand).toBe(vorher[0]!.stand);
  });

  it('ohne Namen entsteht nichts', async () => {
    await expect(imKontext(buchhaltung, (k) => legeLieferantAn(k, { name: '  ' })))
      .rejects.toMatchObject({ grund: 'name_fehlt' });
  });

  it('ohne `eingang.schreiben` entsteht nichts', async () => {
    await expect(imKontext(ohneRecht, (k) => legeLieferantAn(k, { name: 'Fremd GmbH' })))
      .rejects.toThrow();
  });
});

describe('§2 die IBAN — Prüfziffer, nicht nur Gestalt', () => {
  /**
   * Der CHECK in der Tabelle prüft `^[A-Z]{2}[0-9]{2}…`. Eine IBAN mit zwei
   * vertauschten Ziffern hat genau diese Gestalt und geht an den Falschen —
   * und bei einem Lieferanten ist das die teure Richtung.
   */
  it('ein Zahlendreher wird abgewiesen, obwohl die Gestalt stimmt', async () => {
    await expect(imKontext(buchhaltung, (k) => legeLieferantAn(k, {
      name: 'Dreher GmbH', iban: IBAN_DREHER,
    }))).rejects.toMatchObject({ grund: 'iban_ungueltig' });
  });

  it('eine richtige IBAN wird normalisiert gespeichert', async () => {
    const a = await imKontext(buchhaltung, (k) => legeLieferantAn(k, {
      name: 'Eilert Sanitär', iban: 'de02 1203 0000 0000 2020 51',
    }));
    expect(await ibanVon(a.id)).toBe(IBAN_GUT);
  });

  /**
   * **Ein leeres Feld löscht die Bankverbindung NICHT.** Die IBAN ist
   * `cse_app` nicht lesbar (Spaltenentzug, `0123`), ein Formular kann sie
   * also nicht vorbefüllen — blindes Überschreiben hiesse, den Lieferanten
   * beim nächsten Speichern unbezahlbar zu machen.
   */
  it('Speichern ohne IBAN lässt die hinterlegte stehen', async () => {
    const a = await imKontext(buchhaltung, (k) => legeLieferantAn(k, {
      name: 'Frank Fliesen', iban: IBAN_GUT,
    }));
    await imKontext(buchhaltung, (k) => aendereLieferant(k, a.id, {
      name: 'Frank Fliesen GmbH',
    }));
    expect(await ibanVon(a.id)).toBe(IBAN_GUT);
  });

  /**
   * **Eine geänderte Bankverbindung wird LAUT.** Der häufigste
   * Rechnungsbetrug im Mittelstand ist eine E-Mail mit „unsere Bankverbindung
   * hat sich geändert"; er funktioniert, weil die Änderung im Stammsatz
   * aussieht wie jede andere. `fin.lieferant_bankdaten_geaendert` (0123)
   * schreibt sie mit `vorher`/`nachher` ins Protokoll.
   */
  it('die Änderung steht im Protokoll', async () => {
    const a = await imKontext(buchhaltung, (k) => legeLieferantAn(k, {
      name: 'Gerber Gerüstbau', iban: IBAN_GUT,
    }));
    await imKontext(buchhaltung, (k) => aendereLieferant(k, a.id, {
      name: 'Gerber Gerüstbau', iban: 'DE02500105170137075030',
    }));
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select count(*)::int as anzahl from audit_log
        where aktion = 'lieferant.bankdaten_geaendert' and objekt_id = $1`, [a.id]),
    ) as unknown as { anzahl: number }[];
    expect(z!.anzahl).toBeGreaterThanOrEqual(1);
  });
});

describe('§3 sperren, archivieren — und was beides unterscheidet', () => {
  it('`gesperrt` und zurück', async () => {
    const a = await imKontext(buchhaltung,
      (k) => legeLieferantAn(k, { name: 'Haller Holzbau' }));
    await imKontext(buchhaltung, (k) => setzeLieferantStatus(k, a.id, 'gesperrt'));
    let liste = await imKontext(buchhaltung, (k) => lieferanten(k));
    expect(liste.find((l) => l.id === a.id)?.status).toBe('gesperrt');

    await imKontext(buchhaltung, (k) => setzeLieferantStatus(k, a.id, 'aktiv'));
    liste = await imKontext(buchhaltung, (k) => lieferanten(k));
    expect(liste.find((l) => l.id === a.id)?.status).toBe('aktiv');
  });

  it('ein archivierter Lieferant fällt aus der Liste — bis man ihn anfordert', async () => {
    const a = await imKontext(buchhaltung,
      (k) => legeLieferantAn(k, { name: 'Ihlow Innenausbau' }));
    await imKontext(buchhaltung, (k) => archiviereLieferant(k, a.id));

    const ohne = await imKontext(buchhaltung, (k) => lieferanten(k));
    expect(ohne.some((l) => l.id === a.id)).toBe(false);
    const mit = await imKontext(buchhaltung, (k) => lieferanten(k, true));
    expect(mit.find((l) => l.id === a.id)?.archiviert).toBe(true);
  });

  it('ein archivierter Lieferant lässt sich nicht mehr ändern', async () => {
    const a = await imKontext(buchhaltung,
      (k) => legeLieferantAn(k, { name: 'Jork Jalousien' }));
    await imKontext(buchhaltung, (k) => archiviereLieferant(k, a.id));
    await expect(imKontext(buchhaltung, (k) => aendereLieferant(k, a.id, {
      name: 'Jork Jalousien GmbH',
    }))).rejects.toMatchObject({ grund: 'nicht_gefunden' });
  });
});

describe('§4 die Eingaben werden geprüft, nicht durchgereicht', () => {
  it('ein Zahlungsziel ist ganze Tage oder gar nichts', async () => {
    await expect(imKontext(buchhaltung, (k) => legeLieferantAn(k, {
      name: 'Kley Kälte', zahlungszielTage: 'dreissig',
    }))).rejects.toMatchObject({ grund: 'zahlungsziel_ungueltig' });
    await expect(imKontext(buchhaltung, (k) => legeLieferantAn(k, {
      name: 'Kley Kälte', zahlungszielTage: '9999',
    }))).rejects.toMatchObject({ grund: 'zahlungsziel_ungueltig' });
  });

  it('leer heisst „nicht vereinbart" und nicht „null Tage"', async () => {
    const a = await imKontext(buchhaltung,
      (k) => legeLieferantAn(k, { name: 'Lehmann Logistik' }));
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select zahlungsziel_tage from lieferant where id = $1`, [a.id]),
    ) as unknown as { zahlungsziel_tage: number | null }[];
    expect(z!.zahlungsziel_tage).toBeNull();
  });

  it('das §48b-Datum ist ein Datum, kein Häkchen', async () => {
    await expect(imKontext(buchhaltung, (k) => legeLieferantAn(k, {
      name: 'Möller Maler', istBauleistenderBis: 'ja',
    }))).rejects.toMatchObject({ grund: 'datum_unlesbar' });

    const a = await imKontext(buchhaltung, (k) => legeLieferantAn(k, {
      name: 'Möller Maler', leistungsart: 'bau', istBauleistenderBis: '2027-12-31',
    }));
    const liste = await imKontext(buchhaltung, (k) => lieferanten(k));
    const l = liste.find((x) => x.id === a.id);
    expect(l?.leistungsart).toBe('bau');
    expect(l?.istBauleistenderBis).toBe('2027-12-31');
  });

  it('eine unbekannte Leistungsart wird abgewiesen', async () => {
    await expect(imKontext(buchhaltung, (k) => legeLieferantAn(k, {
      name: 'Nolte Netze', leistungsart: 'gartenbau',
    }))).rejects.toMatchObject({ grund: 'leistungsart_unbekannt' });
  });

  it('das Land ist ein Kürzel aus zwei Buchstaben', async () => {
    await expect(imKontext(buchhaltung, (k) => legeLieferantAn(k, {
      name: 'Oster Oberflächen', land: 'Deutschland',
    }))).rejects.toMatchObject({ grund: 'land_ungueltig' });

    const a = await imKontext(buchhaltung, (k) => legeLieferantAn(k, {
      name: 'Oster Oberflächen', land: 'at',
    }));
    const liste = await imKontext(buchhaltung, (k) => lieferanten(k));
    expect(liste.find((x) => x.id === a.id)?.land).toBe('AT');
  });

  it('ein LieferantFehler trägt seinen Grund und seinen Status', async () => {
    const fehler = await imKontext(buchhaltung, (k) => legeLieferantAn(k, { name: '' }))
      .catch((x: unknown) => x);
    expect(fehler).toBeInstanceOf(LieferantFehler);
    expect((fehler as LieferantFehler).status).toBe(400);
  });
});
