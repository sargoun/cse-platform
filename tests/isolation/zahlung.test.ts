/**
 * PR 54.1 — Zahlungen und offene Posten gegen eine echte Datenbank (FIN-14).
 *
 * Die Arithmetik steht in `tests/kern/zahlung.test.ts`. Hier stehen die
 * Aussagen, die nur die Datenbank halten kann, und jede davon ist ein Fehler,
 * den sonst niemand bemerkt, bis Geld fehlt:
 *
 *  1. **Der offene Posten entsteht mit der Festschreibung — an der TABELLE.**
 *     Nicht in `fin.rechnung_nummer_ziehen`: ein Import, der `status` setzt,
 *     ginge daran vorbei, und die Rechnung stünde in keiner Forderungsliste.
 *  2. **Eine Teilzahlung lässt exakt den Rest offen.**
 *  3. **Eine Überzahlung wird NIE geschluckt.** Sie wird ein Guthaben — eine
 *     Verbindlichkeit gegenüber dem Kunden, die offen bleibt.
 *  4. **Ein Zahlungsstorno gibt den Posten wieder frei.** Sonst gälte eine
 *     zurückgebuchte Rechnung für immer als bezahlt.
 *  5. **Ein Storno wird gegen seine Gutschrift AUSGEGLICHEN**, ohne dass
 *     jemand eine Zahlung erfindet, die nie stattgefunden hat.
 *  6. **Der nächtliche Abgleich rechnet unabhängig nach** und findet eine
 *     Abweichung, die an den Auslösern vorbei entstanden ist.
 *  7. **Wer was schreiben darf, steht im Spaltenrecht** — nicht in einer
 *     Zusage dieses Codes.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import {
  bucheBauabzug, gleicheAus, legeBankkontoAn, offenePosten, ordneZu, postenZuRechnung,
  storniereZahlung, verbucheZahlungseingang, ZahlungFehler,
} from '../../src/server/services/finanz/zahlung/index.js';
import { gleicheOffenePostenAb } from '../../src/server/services/finanz/zahlung/abgleich.js';

let f: Fixtur;
let benutzer: string;
let kundeId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

function sitzung(mandantId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

/**
 * Eine Jobsitzung, wie `alsJobSitzung` sie bindet — Rolle `cse_job`, Mandant
 * gesetzt, und `app.readonly` aus, weil der Abgleich stempelt.
 *
 * Sie steht hier abgeschrieben und nicht importiert, weil der Test die
 * DATENBANK prüfen soll und nicht den Binder: würde er denselben Code
 * benutzen, prüfte er, ob eine Funktion mit sich selbst übereinstimmt.
 */
async function alsJob<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_job`);
    for (const [k, v] of [
      ['app.scope', 'mandant'], ['app.mandant_id', mandantId],
      ['app.mandant_ids', mandantId], ['app.benutzer_id', ''], ['app.person_id', ''],
      ['app.portal', 'intern'], ['app.akteur_typ', 'system'], ['app.readonly', 'off'],
    ]) {
      await tx.unsafe(`select set_config($1, $2, true)`, [k!, v!] as never[]);
    }
    return fn(tx);
  }) as Promise<T>;
}

/**
 * Der Eigentümer — mit gebundener Sitzung, aber ohne Dienst.
 *
 * Damit lässt sich der Weg nachstellen, den ein Import oder ein
 * Reparaturskript nimmt: `status` wird direkt gesetzt,
 * `fin.rechnung_nummer_ziehen` kommt nicht vor. Die Sitzungsvariablen stehen
 * trotzdem, weil `fin.op_eroeffnen` als `cse_definer` schreibt und dessen
 * Policy den Mandanten verlangt (D-388) — ein Schreibzugriff ganz ohne
 * Bindung wird abgewiesen, und das ist richtig so: er wäre nicht zuordenbar.
 */
async function alsEigentuemer<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    for (const [k, v] of [
      ['app.scope', 'mandant'], ['app.mandant_id', mandantId],
      ['app.mandant_ids', mandantId], ['app.portal', 'intern'],
      ['app.akteur_typ', 'mensch'], ['app.readonly', 'off'],
    ]) {
      await tx.unsafe(`select set_config($1, $2, true)`, [k!, v!] as never[]);
    }
    return fn(tx);
  }) as Promise<T>;
}

async function legeBenutzerAn(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  return u!.id;
}

async function macheFakturierfaehig(mandantId: string): Promise<void> {
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            telefon = '+49 30 5550100', email = 'rechnung@cse.test',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            iban = 'DE02120300000000202051'
      where id = $1`, [mandantId]);
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [mandantId]);
}

async function legeKundeAn(mandantId: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'firma','Beispiel GmbH','Musterweg','7','10178','Berlin') returning id`,
    [mandantId, `K-${zufall()}`]);
  return k!.id;
}

/** Ein Entwurf über 1.000,00 € netto = 1.190,00 € brutto. */
async function entwurf(preisCent = 100_000n, mandantId?: string, kunde?: string): Promise<string> {
  return alsApp(sitzung(mandantId), async (tx) => {
    const d = alsDienst(tx);
    const id = await legeEntwurfAn(d, {
      kundeId: kunde ?? kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31',
      zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Unterhaltsreinigung August 2026',
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(preisCent), steuergruppe: 'ust_19',
      quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
    });
    await tx.unsafe(`update rechnung set zahlungsmittel_code = '58' where id = $1`,
      [id] as never[]);
    return id;
  });
}

async function festgeschrieben(preisCent = 100_000n): Promise<string> {
  const id = await entwurf(preisCent);
  await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));
  return id;
}

async function posten(rechnungId: string) {
  return alsApp(sitzung(), async (tx) => postenZuRechnung(alsDienst(tx), rechnungId));
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`buchhaltung-${zufall()}@cse.test`);
  await macheFakturierfaehig(f.reinigung);
  kundeId = await legeKundeAn(f.reinigung);
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(1) Der offene Posten entsteht mit der Festschreibung', () => {
  it('ein Entwurf fordert nichts — und ein Entwurf hat deshalb keinen Posten', async () => {
    const id = await entwurf();
    expect(await posten(id)).toBeNull();
  });

  it('das Festschreiben eröffnet genau einen, mit Betrag und Fälligkeit vom Beleg', async () => {
    const id = await festgeschrieben();
    const p = (await posten(id))!;
    const [r] = await sql.unsafe<{ zahlbetrag_cent: string; faellig_am: string }[]>(
      `select zahlbetrag_cent::text, faellig_am::text from rechnung where id = $1`, [id]);

    expect(p.art).toBe('debitor');
    expect(p.betragCent).toBe(BigInt(r!.zahlbetrag_cent));
    expect(p.betragCent).toBe(119_000n);
    expect(p.bezahltCent).toBe(0n);
    expect(p.offenCent).toBe(119_000n);
    expect(p.faelligAm).toBe(r!.faellig_am);
    expect(p.ausgeglichenAm).toBeNull();
  });

  it('eine Rechnung über 0,00 € eröffnet keinen — ein Posten ohne Forderung sagt nichts',
    async () => {
      /*
       * Der reale Fall ist eine Schlussrechnung, deren Abschläge sie
       * vollständig aufzehren (FIN-08): `zahlbetrag_cent = brutto_cent −
       * abzug_brutto_cent` wird null. Hier wird genau dieser Zustand am
       * Entwurf hergestellt — beide Spalten zusammen, weil
       * `rechnung_zahlbetrag_stimmig` sie aneinander bindet.
       *
       * Eine Rechnung mit Betrag 0 gänzlich ohne Positionen gibt es dagegen
       * nicht: die §14-Vorprüfung verlangt eine Steuerzeile und ließe sie gar
       * nicht erst festschreiben.
       */
      const id = await entwurf();
      await sql.unsafe(
        `update rechnung set abzug_brutto_cent = brutto_cent, zahlbetrag_cent = 0
          where id = $1`, [id]);
      await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));

      expect(await posten(id)).toBeNull();
    });

  /**
   * **Der Grund, warum der Auslöser an der TABELLE hängt.**
   *
   * Hier wird der Weg genommen, den `fin.rechnung_nummer_ziehen` nicht kennt:
   * ein Schreibzugriff, der `status` direkt setzt — ein Import, ein
   * Reparaturskript, eine spätere Route. Läge die Eröffnung in der Funktion,
   * stünde die Rechnung danach gestellt in den Büchern und in keiner
   * Forderungsliste. Genau das ist der Fehler, den niemand bemerkt.
   */
  /**
   * **Der Grund, warum der Auslöser an der TABELLE hängt.**
   *
   * Läge die Eröffnung in `fin.rechnung_nummer_ziehen`, ginge jeder zweite
   * Schreibweg daran vorbei — ein Import, ein Reparaturskript, eine spätere
   * Route — und die Rechnung stünde gestellt in den Büchern und in keiner
   * Forderungsliste.
   *
   * Nachstellen lässt sich dieser zweite Weg heute nicht: 0077 lässt keine
   * festgeschriebene Rechnung ohne Snapshot zu, und 0076 lässt den Status
   * überhaupt nur einmal wandern. Bewiesen wird die Eigenschaft deshalb dort,
   * wo sie steht — an der Tabelle und an der Funktion. Diese Prüfung ist
   * keine Formsache: sie schlägt an dem Tag an, an dem jemand den Auslöser in
   * die Funktion zurückholt, und das ist genau der Tag, an dem es niemandem
   * sonst auffiele.
   */
  it('der Auslöser hängt an der TABELLE, nicht in der Festschreibungsfunktion',
    async () => {
      const ausloeser = await sql.unsafe<{ tgname: string }[]>(
        `select tgname from pg_trigger
          where tgrelid = 'public.rechnung'::regclass and not tgisinternal`);
      expect(ausloeser.map((t) => t.tgname)).toContain('op_eroeffnen');

      const [fn] = await sql.unsafe<{ quelle: string }[]>(
        `select pg_get_functiondef(p.oid) as quelle
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'fin' and p.proname = 'rechnung_nummer_ziehen'`);
      expect(fn!.quelle).not.toContain('offener_posten');
    });

  it('und zweimal Festschreiben ergibt trotzdem genau einen Posten', async () => {
    const id = await festgeschrieben();
    /*
     * Derselbe Status noch einmal geschrieben. `trg_rechnung_unveraenderlich`
     * lässt das durch, weil sich nichts ändert — und `fin.op_eroeffnen` kehrt
     * an seiner ersten Zeile um, weil `new.status` nicht von `old.status`
     * abweicht. Ohne diese Umkehr stünde die Forderung zweimal in den Büchern.
     */
    await alsEigentuemer(f.reinigung, async (tx) => tx.unsafe(
      `update rechnung set status = 'festgeschrieben' where id = $1`, [id] as never[]));
    const [gezaehlt] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from offener_posten where rechnung_id = $1`, [id]);
    expect(gezaehlt!.anzahl).toBe('1');
  });
});

describe('(2) Eine Teilzahlung lässt exakt den Rest offen', () => {
  it('500,00 € auf 1.190,00 € — offen bleiben 690,00 €', async () => {
    const id = await festgeschrieben();
    const ergebnis = await alsApp(sitzung(), async (tx) =>
      verbucheZahlungseingang(alsDienst(tx), {
        rechnungId: id, betragCent: cent(50_000n), zahlungsdatum: '2026-09-10',
        zahlungsmittel: 'ueberweisung',
      }));

    expect(ergebnis.angerechnetCent).toBe(50_000n);
    expect(ergebnis.ueberzahlungCent).toBe(0n);
    expect(ergebnis.offenCent).toBe(69_000n);
    expect(ergebnis.ausgeglichen).toBe(false);
    expect((await posten(id))!.ausgeglichenAm).toBeNull();
  });

  it('und der Rest schliesst ihn — mit dem Datum, an dem er zuging', async () => {
    const id = await festgeschrieben();
    await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
      rechnungId: id, betragCent: cent(50_000n), zahlungsdatum: '2026-09-10',
      zahlungsmittel: 'ueberweisung',
    }));
    const zweite = await alsApp(sitzung(), async (tx) =>
      verbucheZahlungseingang(alsDienst(tx), {
        rechnungId: id, betragCent: cent(69_000n), zahlungsdatum: '2026-09-20',
        zahlungsmittel: 'ueberweisung',
      }));

    expect(zweite.offenCent).toBe(0n);
    expect(zweite.ausgeglichen).toBe(true);
    const p = (await posten(id))!;
    expect(p.bezahltCent).toBe(119_000n);
    expect(p.ausgeglichenAm).not.toBeNull();
  });

  it('eine Zahlung auf eine ausgeglichene Rechnung wird benannt, nicht gebucht', async () => {
    const id = await festgeschrieben();
    await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
      rechnungId: id, betragCent: cent(119_000n), zahlungsdatum: '2026-09-10',
      zahlungsmittel: 'ueberweisung',
    }));
    await expect(alsApp(sitzung(), async (tx) =>
      verbucheZahlungseingang(alsDienst(tx), {
        rechnungId: id, betragCent: cent(100n), zahlungsdatum: '2026-09-11',
        zahlungsmittel: 'ueberweisung',
      })))
      .rejects.toThrow(ZahlungFehler);
  });

  it('und eine Zahlung auf einen ENTWURF ebenso — er fordert nichts', async () => {
    const id = await entwurf();
    await expect(alsApp(sitzung(), async (tx) =>
      verbucheZahlungseingang(alsDienst(tx), {
        rechnungId: id, betragCent: cent(100n), zahlungsdatum: '2026-09-11',
        zahlungsmittel: 'ueberweisung',
      })))
      .rejects.toThrow(expect.objectContaining({ grund: 'kein_posten' }) as Error);
  });
});

describe('(3) Eine Überzahlung wird ein Guthaben, nie ein verschwundener Rest', () => {
  it('1.500,00 € auf 1.190,00 €: die Rechnung ist bezahlt, 310,00 € stehen dem Kunden zu',
    async () => {
      const id = await festgeschrieben();
      const e = await alsApp(sitzung(), async (tx) =>
        verbucheZahlungseingang(alsDienst(tx), {
          rechnungId: id, betragCent: cent(150_000n), zahlungsdatum: '2026-09-10',
          zahlungsmittel: 'ueberweisung',
        }));

      expect(e.angerechnetCent).toBe(119_000n);
      expect(e.ueberzahlungCent).toBe(31_000n);
      expect(e.ausgeglichen).toBe(true);
      expect(e.guthabenPostenId).not.toBeNull();

      const alle = await alsApp(sitzung(), async (tx) =>
        offenePosten(alsDienst(tx), { nurOffene: true }));
      const guthaben = alle.find((p) => p.id === e.guthabenPostenId)!;
      expect(guthaben.art).toBe('debitor_guthaben');
      expect(guthaben.betragCent).toBe(31_000n);
      /*
       * OFFEN, nicht ausgeglichen. Ein Guthaben, das im selben Atemzug als
       * bezahlt gälte, wäre keines — der Kunde bekäme sein Geld nie zurück.
       */
      expect(guthaben.offenCent).toBe(31_000n);
      expect(guthaben.ausgeglichenAm).toBeNull();
    });

  it('die Datenbank weist eine Zuordnung über den Rest hinaus ab — auch direkt', async () => {
    const id = await festgeschrieben();
    const p = (await posten(id))!;
    await expect(alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      const [z] = await tx.unsafe<{ id: string }[]>(
        `insert into zahlung (mandant_id, richtung, betrag_cent, zahlungsdatum,
                              zahlungsmittel, erstellt_von_art, erstellt_von)
         values (app.aktiver_mandant(), 'eingang', 200000, date '2026-09-10',
                 'ueberweisung', 'mensch', app.aktueller_benutzer())
         returning id`);
      return ordneZu(d, {
        zahlungId: z!.id, offenerPostenId: p.id, art: 'zahlung',
        betragCent: cent(200_000n),
      });
    })).rejects.toThrow(/Ueberzahlung wird als Guthaben/u);
  });

  it('und die Zuordnungen einer Zahlung dürfen sie nicht übersteigen', async () => {
    const eins = await festgeschrieben();
    const zwei = await festgeschrieben();
    const p1 = (await posten(eins))!;
    const p2 = (await posten(zwei))!;

    await expect(alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      const [z] = await tx.unsafe<{ id: string }[]>(
        `insert into zahlung (mandant_id, richtung, betrag_cent, zahlungsdatum,
                              zahlungsmittel, erstellt_von_art, erstellt_von)
         values (app.aktiver_mandant(), 'eingang', 100000, date '2026-09-10',
                 'ueberweisung', 'mensch', app.aktueller_benutzer())
         returning id`);
      await ordneZu(d, {
        zahlungId: z!.id, offenerPostenId: p1.id, art: 'zahlung', betragCent: cent(60_000n),
      });
      return ordneZu(d, {
        zahlungId: z!.id, offenerPostenId: p2.id, art: 'zahlung', betragCent: cent(60_000n),
      });
    })).rejects.toThrow(/Zuordnungen dieser Zahlung ergeben/u);
  });

  it('eine abgeschriebene Differenz braucht einen Grund — und schliesst dann ab', async () => {
    const id = await festgeschrieben();
    const p = (await posten(id))!;

    await expect(alsApp(sitzung(), async (tx) => ordneZu(alsDienst(tx), {
      zahlungId: null, offenerPostenId: p.id, art: 'differenz', betragCent: cent(119_000n),
    }))).rejects.toThrow();

    await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      const [z] = await tx.unsafe<{ id: string }[]>(
        `insert into zahlung (mandant_id, richtung, betrag_cent, zahlungsdatum,
                              zahlungsmittel, erstellt_von_art, erstellt_von)
         values (app.aktiver_mandant(), 'eingang', 118900, date '2026-09-10',
                 'ueberweisung', 'mensch', app.aktueller_benutzer())
         returning id`);
      await ordneZu(d, {
        zahlungId: z!.id, offenerPostenId: p.id, art: 'zahlung', betragCent: cent(118_900n),
      });
      await ordneZu(d, {
        zahlungId: z!.id, offenerPostenId: p.id, art: 'differenz', betragCent: cent(100n),
        notiz: 'Bankgebühr des Kunden, unter der Verfolgungsgrenze.',
      });
    });
    expect((await posten(id))!.offenCent).toBe(0n);
  });
});

describe('(4) Der §48-EStG-Einbehalt schliesst den Rest, ohne dass Geld kommt', () => {
  it('der Kunde überweist 85 %, der Einbehalt löscht die restlichen 15 %', async () => {
    const id = await entwurf();
    // Was PR 51 rechnet, hier gesetzt: 15 % von 119.000 = 17.850.
    await sql.unsafe(
      `update rechnung
          set bauabzugsteuer_pflichtig = true, bauabzugsteuer_satz_bp = 1500,
              bauabzugsteuer_grundlage_cent = 119000,
              einbehalt_bauabzugsteuer_cent = 17850
        where id = $1`, [id]);
    await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));

    /*
     * Der Posten trägt den VOLLEN Zahlbetrag (§7.3) — der Einbehalt ist kein
     * Nachlass, sondern eine Zahlung an eine andere Stelle.
     */
    expect((await posten(id))!.betragCent).toBe(119_000n);

    await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
      rechnungId: id, betragCent: cent(101_150n), zahlungsdatum: '2026-09-10',
      zahlungsmittel: 'ueberweisung',
    }));
    expect((await posten(id))!.offenCent).toBe(17_850n);

    const gebucht = await alsApp(sitzung(), async (tx) => bucheBauabzug(alsDienst(tx), id));
    expect(gebucht.betragCent).toBe(17_850n);
    expect(gebucht.offenCent).toBe(0n);
  });

  it('und auf einer Rechnung ohne Einbehalt wird nichts gebucht', async () => {
    const id = await festgeschrieben();
    await expect(alsApp(sitzung(), async (tx) => bucheBauabzug(alsDienst(tx), id)))
      .rejects.toThrow(/keinen Bauabzugsteuer-Einbehalt/u);
  });
});

describe('(5) Ein Zahlungsstorno gibt den Posten wieder frei', () => {
  it('die Rückbuchung öffnet die Forderung, statt sie bezahlt zu lassen', async () => {
    const id = await festgeschrieben();
    const e = await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
      rechnungId: id, betragCent: cent(119_000n), zahlungsdatum: '2026-09-10',
      zahlungsmittel: 'lastschrift',
    }));
    expect((await posten(id))!.ausgeglichenAm).not.toBeNull();

    await alsApp(sitzung(), async (tx) =>
      storniereZahlung(alsDienst(tx), e.zahlungId, 'Lastschrift vom Kunden zurückgegeben.'));

    const p = (await posten(id))!;
    expect(p.bezahltCent).toBe(0n);
    expect(p.offenCent).toBe(119_000n);
    expect(p.ausgeglichenAm).toBeNull();
  });

  it('ein Storno ohne Grund wird abgewiesen — er steht später allein in den Büchern',
    async () => {
      const id = await festgeschrieben();
      const e = await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
        rechnungId: id, betragCent: cent(100n), zahlungsdatum: '2026-09-10',
        zahlungsmittel: 'ueberweisung',
      }));
      await expect(alsApp(sitzung(), async (tx) =>
        storniereZahlung(alsDienst(tx), e.zahlungId, ' ')))
        .rejects.toThrow(ZahlungFehler);
    });

  it('eine gebundene Zahlung lässt sich nicht mehr umschreiben', async () => {
    const id = await festgeschrieben();
    const e = await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
      rechnungId: id, betragCent: cent(50_000n), zahlungsdatum: '2026-09-10',
      zahlungsmittel: 'ueberweisung',
    }));
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(`update zahlung set betrag_cent = 1 where id = $1`, [e.zahlungId] as never[])))
      .rejects.toThrow(/bereits zugeordnet/u);

    // Die Notiz dagegen schon — sie ist der eine bewegliche Teil.
    await alsApp(sitzung(), async (tx) =>
      tx.unsafe(`update zahlung set notiz = 'Beleg nachgereicht' where id = $1`,
        [e.zahlungId] as never[]));
  });
});

describe('(6) Posten gegen Posten, ohne eine Zahlung zu erfinden (§7.4)', () => {
  it('eine Forderung und ein Guthaben gleichen sich aus — beide gehen auf null', async () => {
    const id = await festgeschrieben();
    const e = await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
      rechnungId: id, betragCent: cent(150_000n), zahlungsdatum: '2026-09-10',
      zahlungsmittel: 'ueberweisung',
    }));
    // Eine zweite Rechnung, gegen die das Guthaben verwendet wird.
    const zwei = await festgeschrieben(26_050n); // 260,50 netto → 310,00 brutto
    const p2 = (await posten(zwei))!;
    expect(p2.offenCent).toBe(31_000n);

    await alsApp(sitzung(), async (tx) => gleicheAus(alsDienst(tx), {
      sollPostenId: p2.id, habenPostenId: e.guthabenPostenId!,
      betragCent: cent(31_000n), grund: 'guthaben_verwendung',
    }));

    expect((await posten(zwei))!.offenCent).toBe(0n);
    const alle = await alsApp(sitzung(), async (tx) =>
      offenePosten(alsDienst(tx), { nurOffene: false }));
    expect(alle.find((p) => p.id === e.guthabenPostenId)!.offenCent).toBe(0n);
  });

  it('ein Ausgleich über mehr, als offen ist, wird abgewiesen', async () => {
    const id = await festgeschrieben();
    const e = await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
      rechnungId: id, betragCent: cent(150_000n), zahlungsdatum: '2026-09-10',
      zahlungsmittel: 'ueberweisung',
    }));
    const zwei = await festgeschrieben();
    const p2 = (await posten(zwei))!;

    await expect(alsApp(sitzung(), async (tx) => gleicheAus(alsDienst(tx), {
      sollPostenId: p2.id, habenPostenId: e.guthabenPostenId!,
      betragCent: cent(119_000n), grund: 'guthaben_verwendung',
    }))).rejects.toThrow(/Habenposten hat nur/u);
  });
});

describe('(7) Wer was schreiben darf, steht im Spaltenrecht', () => {
  it('`cse_app` kann `bezahlt_cent` nicht anfassen — auch mit `zahlung.schreiben` nicht',
    async () => {
      const id = await festgeschrieben();
      const p = (await posten(id))!;
      await expect(alsApp(sitzung(), async (tx) =>
        tx.unsafe(`update offener_posten set bezahlt_cent = 119000 where id = $1`,
          [p.id] as never[])))
        .rejects.toThrow(/permission denied|Berechtigung/u);
    });

  it('aber die Mahnsperre schon — sie ist eine Entscheidung, kein Rechenwert', async () => {
    const id = await festgeschrieben();
    const p = (await posten(id))!;
    await alsApp(sitzung(), async (tx) =>
      tx.unsafe(`update offener_posten set mahnsperre_bis = date '2026-12-31' where id = $1`,
        [p.id] as never[]));
    const [z] = await sql.unsafe<{ mahnsperre_bis: string }[]>(
      `select mahnsperre_bis::text from offener_posten where id = $1`, [p.id]);
    expect(z!.mahnsperre_bis).toBe('2026-12-31');
  });

  it('`cse_job` stempelt `neu_berechnet_am` — und kommt an `bezahlt_cent` nicht heran',
    async () => {
      const id = await festgeschrieben();
      const p = (await posten(id))!;

      await alsJob(f.reinigung, async (tx) =>
        tx.unsafe(`update offener_posten set neu_berechnet_am = now() where id = $1`,
          [p.id] as never[]));
      const [z] = await sql.unsafe<{ gestempelt: boolean }[]>(
        `select neu_berechnet_am is not null as gestempelt
           from offener_posten where id = $1`, [p.id]);
      expect(z!.gestempelt).toBe(true);

      await expect(alsJob(f.reinigung, async (tx) =>
        tx.unsafe(`update offener_posten set bezahlt_cent = 0 where id = $1`,
          [p.id] as never[])))
        .rejects.toThrow(/permission denied|Berechtigung/u);
    });

  it('und gelöscht wird hier gar nichts (Invariante 8)', async () => {
    const id = await festgeschrieben();
    const p = (await posten(id))!;
    await expect(alsApp(sitzung(), async (tx) =>
      tx.unsafe(`delete from offener_posten where id = $1`, [p.id] as never[])))
      .rejects.toThrow();
    await expect(alsRolle('cse_definer', async (tx) =>
      tx.unsafe(`delete from offener_posten where id = $1`, [p.id] as never[])))
      .rejects.toThrow();
  });
});

describe('(8) Der nächtliche Abgleich rechnet unabhängig nach', () => {
  it('eine stimmige Buchhaltung meldet nichts — sonst prüfte alles Weitere nichts', async () => {
    const id = await festgeschrieben();
    await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
      rechnungId: id, betragCent: cent(50_000n), zahlungsdatum: '2026-09-10',
      zahlungsmittel: 'ueberweisung',
    }));

    const befund = await alsJob(f.reinigung, async (tx) =>
      gleicheOffenePostenAb(alsDienst(tx)));
    expect(befund.ok).toBe(true);
    expect(befund.geprueft).toBeGreaterThan(0);
    expect(befund.abweichungen).toEqual([]);
  });

  it('eine an den Auslösern vorbei verstellte Zahl wird namentlich benannt', async () => {
    const id = await festgeschrieben();
    const p = (await posten(id))!;
    // Der Eigentümer umgeht Policy und Spaltenrecht — genau der Fall, für den
    // es diesen Lauf gibt.
    await sql.unsafe(
      `update offener_posten set bezahlt_cent = 40000 where id = $1`, [p.id]);

    const befund = await alsJob(f.reinigung, async (tx) =>
      gleicheOffenePostenAb(alsDienst(tx)));
    expect(befund.ok).toBe(false);
    expect(befund.abweichungen).toHaveLength(1);
    expect(befund.abweichungen[0]!.postenId).toBe(p.id);
    expect(befund.abweichungen[0]!.gefuehrtCent).toBe(40_000n);
    expect(befund.abweichungen[0]!.berechnetCent).toBe(0n);
    expect(befund.abweichungen[0]!.abweichungCent).toBe(40_000n);
  });

  /**
   * **Der Fall, den die erste Fassung dieser Datei nicht prüfte.**
   *
   * Eine `ueberzahlung`-Zeile ERZEUGT ein Guthaben, sie gleicht es nicht aus
   * (§7.2) — `bezahlt_cent` bleibt deshalb null. Zählte die Sicht sie mit,
   * meldete der Lauf auf JEDEM Guthabenposten eine Abweichung, jede Nacht,
   * ohne dass irgendetwas falsch wäre. Eine Wache, die täglich dasselbe
   * falsch meldet, wird abgeschaltet — und dann meldet sie auch das Richtige
   * nicht mehr.
   *
   * Ohne diesen Fall lief der Sabotagetest (Ausschluss aus der Sicht
   * entfernt) grün durch: die übrigen Prüfungen buchen nie eine Überzahlung.
   */
  it('und ein Guthaben aus einer Überzahlung ist KEINE Abweichung', async () => {
    const id = await festgeschrieben();
    const e = await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
      rechnungId: id, betragCent: cent(150_000n), zahlungsdatum: '2026-09-10',
      zahlungsmittel: 'ueberweisung',
    }));
    expect(e.guthabenPostenId).not.toBeNull();

    const befund = await alsJob(f.reinigung, async (tx) =>
      gleicheOffenePostenAb(alsDienst(tx)));
    expect(befund.abweichungen).toEqual([]);
    expect(befund.ok).toBe(true);
  });

  it('und eine STORNIERTE Zahlung zählt in beiden Rechnungen gleich', async () => {
    const id = await festgeschrieben();
    const e = await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
      rechnungId: id, betragCent: cent(50_000n), zahlungsdatum: '2026-09-10',
      zahlungsmittel: 'ueberweisung',
    }));
    await alsApp(sitzung(), async (tx) =>
      storniereZahlung(alsDienst(tx), e.zahlungId, 'Falsche Rechnung getroffen.'));

    const befund = await alsJob(f.reinigung, async (tx) =>
      gleicheOffenePostenAb(alsDienst(tx)));
    expect(befund.abweichungen).toEqual([]);
  });
});

describe('(9) Die Mandantengrenze und das Kundenportal', () => {
  it('ein fremder Mandant sieht den Posten nicht', async () => {
    const id = await festgeschrieben();
    expect(await posten(id)).not.toBeNull();

    const fremd = await alsApp(
      { ...sitzung(f.security), mandantId: f.security },
      async (tx) => tx.unsafe(`select id from offener_posten`));
    expect(fremd).toHaveLength(0);
  });

  it('der Kunde sieht die eigene Forderung — nicht das Guthaben und nichts Fremdes',
    async () => {
      const id = await festgeschrieben();
      const e = await alsApp(sitzung(), async (tx) => verbucheZahlungseingang(alsDienst(tx), {
        rechnungId: id, betragCent: cent(150_000n), zahlungsdatum: '2026-09-10',
        zahlungsmittel: 'ueberweisung',
      }));
      const fremderKunde = await legeKundeAn(f.reinigung);
      await festgeschrieben(); // gehört `kundeId`
      const konto = await legeBenutzerAn(`kunde-${zufall()}@extern.test`);
      await sql.unsafe(
        `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id) values ($1,$2,$3)`,
        [f.reinigung, fremderKunde, konto]);

      const gesehen = await alsApp(
        { scope: 'kunde', mandantId: f.reinigung, benutzerId: konto, portal: 'kunde' },
        async (tx) => tx.unsafe(`select id from offener_posten`));
      expect(gesehen).toHaveLength(0);

      // Und mit Zugang zum RICHTIGEN Kunden: die Forderung, nicht das Guthaben.
      const eigenes = await legeBenutzerAn(`kunde-${zufall()}@extern.test`);
      await sql.unsafe(
        `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id) values ($1,$2,$3)`,
        [f.reinigung, kundeId, eigenes]);
      const seine = await alsApp(
        { scope: 'kunde', mandantId: f.reinigung, benutzerId: eigenes, portal: 'kunde' },
        async (tx) => tx.unsafe<{ id: string; art: string }[]>(
          `select id, art from offener_posten`));
      expect(seine.map((z) => z.art)).not.toContain('debitor_guthaben');
      expect(seine.map((z) => z.id)).not.toContain(e.guthabenPostenId);
      expect(seine.length).toBeGreaterThan(0);
    });
});

describe('(10) Das Bankkonto — Prüfziffer und K-12', () => {
  it('eine IBAN mit Zahlendreher kommt nicht in die Datenbank', async () => {
    await expect(alsApp(sitzung(), async (tx) => legeBankkontoAn(alsDienst(tx), {
      bezeichnung: 'Geschäftskonto', iban: 'DE02120300000000200251',
      kontoinhaber: 'CSE Dienstleistungen GmbH',
    }))).rejects.toThrow(/Pruefziffer/u);
  });

  it('IBAN, BIC und Kontoinhaber sind fest, sobald eine gestellte Rechnung sie nennt',
    async () => {
      const kontoId = await alsApp(sitzung(), async (tx) =>
        legeBankkontoAn(alsDienst(tx), {
          bezeichnung: 'Geschäftskonto', iban: 'DE02 1203 0000 0000 2020 51',
          bic: 'BYLADEM1001', kontoinhaber: 'CSE Dienstleistungen GmbH', istStandard: true,
        }));

      const id = await entwurf();
      await sql.unsafe(`update rechnung set bankkonto_id = $2 where id = $1`, [id, kontoId]);

      // Solange sie ein Entwurf ist, darf sich der Stammsatz noch ändern.
      await alsApp(sitzung(), async (tx) =>
        tx.unsafe(`update bankkonto set kontoinhaber = 'CSE GmbH' where id = $1`,
          [kontoId] as never[]));

      await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));

      await expect(alsApp(sitzung(), async (tx) =>
        tx.unsafe(`update bankkonto set iban = 'DE89370400440532013000' where id = $1`,
          [kontoId] as never[])))
        .rejects.toThrow(/unveraenderlich/u);

      // Die Bezeichnung dagegen bleibt beweglich — sie steht auf keinem Beleg.
      await alsApp(sitzung(), async (tx) =>
        tx.unsafe(`update bankkonto set bezeichnung = 'Hauptkonto' where id = $1`,
          [kontoId] as never[]));
    });
});
