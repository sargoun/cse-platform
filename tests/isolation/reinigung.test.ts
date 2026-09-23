/**
 * PR 40 gegen die echte Datenbank — die vier Abnahmekriterien, jedes als
 * eigener Fall und jedes so gebaut, dass es OHNE die Umsetzung fehlschlägt.
 *
 * Zwei davon entscheiden diesen PR, und sie sind hier die ausführlichsten:
 *
 *  - **Der Schnappschuss überlebt eine Änderung am Revier.** Der Fehler, den
 *    dieser Test fängt, sieht in Produktion nach nichts aus: die Oberfläche
 *    lädt die Positionen nach, zeigt den heutigen Stand und nennt ihn
 *    „unterschrieben". Erst im Streitfall fällt auf, dass niemand mehr sagen
 *    kann, was der Kunde gesehen hat.
 *  - **`Σ revier_raum.sollzeit_minuten = revier.sollzeit_minuten`.** Ein
 *    doppeltes Runden erzeugt keine Ausnahme, sondern einen Preis, der um
 *    Minuten danebenliegt — und zwar jedes Mal in dieselbe Richtung.
 *
 * Der Test legt seine Stammdaten selbst an (Kunde, Objekt, Belagsart, Räume,
 * Revier, Auftrag), weil der Seed sie in dieser Form nicht kennt.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { setzeRaeume, RaumNichtEntfernbar } from '../../src/server/services/reinigung/revier.js';
import {
  bereiteUnterschriftVor, erstelleEntwurf, ladeSignaturen, legeVor, signiere,
  AnzeigeVeraltet, BezugPasstNichtZumObjekt, FalscherZustand,
} from '../../src/server/services/reinigung/leistungsnachweis.js';
import {
  alsSchnappschuss, pruefeSchnappschuss, schnappschussHash,
} from '../../src/server/services/reinigung/schnappschuss.js';
import {
  erstelleReklamation, schreibeAbstellung, findeReklamation, NachweisPasstNicht,
  BezugPasstNicht,
} from '../../src/server/services/reinigung/reklamation.js';
import { berechneRevierSollzeit } from '../../src/server/services/reinigung/sollzeit.js';
import {
  erfassePruefung, listePruefverfahren, schwellenBewertung,
} from '../../src/server/services/reinigung/qualitaet.js';
import { legeMediumAb, signierteMedienAdresse } from '../../src/server/services/zeit/medien.js';
import { LokalerSpeicher, NichtVerbundenFehler, SupabaseSpeicher }
  from '../../src/server/storage/adapter.js';
import type { MilliMenge } from '../../src/server/services/finanz/menge.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/** Ein winziges, gültiges PNG — Magic Bytes, mehr braucht die Prüfkette nicht. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

interface Aufbau {
  readonly mandant: string;
  readonly kunde: string;
  readonly objekt: string;
  readonly revier: string;
  readonly auftrag: string;
  readonly leistung: string;
  readonly leitung: string;
  readonly raeume: readonly string[];
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(email: string, personId: string | null = null): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId] as never[]);
  return u!.id;
}

async function mitglied(b: string, m: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [b, m, await rolleId(rolle)]);
}

/** Der Kontext, den ein Dienst erwartet — auf der Transaktion der Sitzung. */
function kontextAus(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
  portal: 'intern' | 'mitarbeiter' | 'kunde' = 'intern',
): SchreibKontext {
  const abfrage = async <T>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal, benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant],
    abfrage, schreibe: abfrage,
  };
}

/**
 * Kunde, Objekt, Belagsart, Räume, Revier, Auftrag — die CLN-01-Kette.
 *
 * Die Flächen sind absichtlich krumm: `12.345 m²` bei `137 m²/h` ergibt keine
 * runde Minute, und genau daran misst K-16(c) seine Begründung.
 */
async function baueRevier(mandant: string, anzahlRaeume = 5): Promise<Aufbau> {
  const leitung = await konto(`reinigung-${zufall()}@cse.test`);
  await mitglied(leitung, mandant, 'leitung');

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Bezirksamt Mitte') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Rathaus Mitte','Karl-Marx-Allee 31','10178','Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                            quelle, gueltig_ab)
     values ($1,$2,$2,137,'Platzhalter (O-17)','2020-01-01') returning id`,
    [mandant, `PVC-${zufall()}`]);

  const raeume: string[] = [];
  for (let i = 0; i < anzahlRaeume; i += 1) {
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into raum (mandant_id, objekt_id, raumnummer, bezeichnung, flaeche_qm,
                         belagsart_id, sortierung)
       values ($1,$2,$3,'Büro',$4::numeric,$5,$6) returning id`,
      [mandant, o!.id, `R-${String(i)}-${zufall()}`,
        String(12.345 + i * 0.017), b!.id, i] as never[]);
    raeume.push(r!.id);
  }

  const [rv] = await sql.unsafe<{ id: string }[]>(
    `insert into revier (mandant_id, objekt_id, bezeichnung, kurzzeichen,
                         sollzeit_minuten, aktiv_ab, erstellt_von_art)
     values ($1,$2,$3,$4,1,'2026-01-01','system') returning id`,
    [mandant, o!.id, `EG-Nord ${zufall()}`, `EGN${zufall().slice(0, 3)}`] as never[]);

  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                          bezeichnung, verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,$4,'rahmenvertrag','aktiv','Unterhaltsreinigung',$5,'2026-01-01')
     returning id`,
    [mandant, `AU-${zufall()}`, k!.id, o!.id, leitung] as never[]);
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, objekt_id,
                                   bezeichnung, menge, einheit, einzelpreis_cent,
                                   steuersatz_bp, gueltig_ab)
     values ($1,$2,1,$3,'Unterhaltsreinigung',1,'Monat',189000,1900,'2026-01-01')
     returning id`,
    [mandant, a!.id, o!.id] as never[]);

  return {
    mandant, kunde: k!.id, objekt: o!.id, revier: rv!.id,
    auftrag: a!.id, leistung: l!.id, leitung, raeume,
  };
}

/**
 * Eine Auftragszeile OHNE Standort — der Rahmenvertrag ueber mehrere
 * Liegenschaften, den 0050 ausdruecklich vorsieht.
 *
 * Der Test dazu ist die Gegenprobe zur Objektpruefung: eine Pruefung, die
 * `objekt_id is null` fuer einen Verstoss haelt, weist geltende Vertraege ab.
 */
async function baueRahmenzeile(
  mandant: string, kunde: string, verantwortlich: string,
): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status,
                          bezeichnung, verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,'rahmenvertrag','aktiv','Rahmen über mehrere Häuser',$4,
             '2026-01-01')
     returning id`,
    [mandant, `AU-${zufall()}`, kunde, verantwortlich] as never[]);
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, bezeichnung,
                                   menge, einheit, einzelpreis_cent, steuersatz_bp,
                                   gueltig_ab)
     values ($1,$2,1,'Unterhaltsreinigung',1,'Monat',189000,1900,'2026-01-01')
     returning id`,
    [mandant, a!.id] as never[]);
  return l!.id;
}

/** Ein Nachweis im Zustand `vorgelegt` — bereit zum Unterschreiben. */
async function baueVorgelegtenNachweis(bau: Aufbau): Promise<string> {
  return alsApp(
    { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
      portal: 'intern', readonly: false },
    async (tx) => {
      const kontext = kontextAus(tx, bau.mandant, bau.leitung);
      const id = await erstelleEntwurf(kontext, {
        objektId: bau.objekt,
        kundeId: bau.kunde,
        revierId: bau.revier,
        auftragLeistungId: bau.leistung,
        von: '2026-06-01',
        bis: '2026-06-30',
        positionen: [
          {
            bezeichnung: 'Unterhaltsreinigung Juni',
            menge: '21.000', einheit: 'Durchgang',
            einzelpreisCent: 4250n, quelle: 'manuell',
          },
          {
            bezeichnung: 'Glasreinigung Treppenhaus',
            menge: '1.000', einheit: 'Pauschale',
            einzelpreisCent: 18_900n, quelle: 'manuell',
            bemerkung: 'Nur Innenseite, Gerüst fehlte',
          },
        ],
      });
      await legeVor(kontext, id);
      return id;
    },
  );
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

// ---------------------------------------------------------------------------

describe('(3) Σ revier_raum.sollzeit_minuten = revier.sollzeit_minuten', () => {
  it('steht so in der Datenbank, nicht nur im Rechenergebnis', async () => {
    const bau = await baueRevier(f.reinigung, 12);

    const ergebnis = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => setzeRaeume(
        kontextAus(tx, bau.mandant, bau.leitung), bau.revier, bau.raeume,
        new Date('2026-06-15T10:00:00Z'),
      ),
    );
    expect(ergebnis.zeit.raeume).toHaveLength(12);

    /**
     * Gelesen wird, was WIRKLICH in den Spalten steht — über `sum()` in der
     * Datenbank. Ein Test, der die Rückgabe des Dienstes summiert, prüfte den
     * Dienst gegen sich selbst; `numeric(8,2)` könnte dabei noch
     * dazwischenrunden.
     */
    const [zahlen] = await sql.unsafe<{ kopf: string; summe: string }[]>(
      `select r.sollzeit_minuten::text as kopf,
              (select sum(rr.sollzeit_minuten) from revier_raum rr
                where rr.revier_id = r.id)::text as summe
         from revier r where r.id = $1`,
      [bau.revier]);

    expect(zahlen!.summe).toBe(zahlen!.kopf);
    expect(zahlen!.kopf).toBe(ergebnis.zeit.sollzeitMinuten);
  });

  it('und stimmt mit der Kalkulation aus PR 25 für dieselben Räume überein', async () => {
    const bau = await baueRevier(f.reinigung, 7);

    await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => setzeRaeume(
        kontextAus(tx, bau.mandant, bau.leitung), bau.revier, bau.raeume,
        new Date('2026-06-15T10:00:00Z'),
      ),
    );

    /**
     * Die Gegenrechnung läuft über dieselben Flächen und denselben
     * Leistungswert, die in `revier_raum` als SCHNAPPSCHUSS liegen — und über
     * die Funktion, die PR 25 dafür hat. Stimmen beide überein, ist zwischen
     * Kopf und Räumen nicht zweimal gerundet worden.
     */
    const zeilen = await sql.unsafe<{
      raum_id: string; flaeche: string; lw: string; reihenfolge: number;
    }[]>(
      `select raum_id, flaeche_qm::text as flaeche,
              leistungswert_qm_pro_stunde::text as lw, reihenfolge
         from revier_raum where revier_id = $1 order by reihenfolge`,
      [bau.revier]);

    const milli = (text: string): MilliMenge =>
      BigInt(Math.round(Number(text) * 1000)) as MilliMenge;
    const erwartet = berechneRevierSollzeit(zeilen.map((z) => ({
      raumId: z.raum_id,
      belagsartId: 'pvc',
      belagsartBezeichnung: 'PVC',
      flaeche: milli(z.flaeche),
      leistungswert: milli(z.lw),
      reihenfolge: z.reihenfolge,
    })));

    const [kopf] = await sql.unsafe<{ kopf: string }[]>(
      `select sollzeit_minuten::text as kopf from revier where id = $1`, [bau.revier]);
    expect(kopf!.kopf).toBe(erwartet.sollzeitMinuten);
  });

  it('eine Zuordnung lässt sich nicht lösen — sie steht unter Löschsperre', async () => {
    const bau = await baueRevier(f.reinigung, 3);
    await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => setzeRaeume(
        kontextAus(tx, bau.mandant, bau.leitung), bau.revier, bau.raeume,
        new Date('2026-06-15T10:00:00Z'),
      ),
    );

    // Der Dienst sagt es als benannter Fehler …
    await expect(alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => setzeRaeume(
        kontextAus(tx, bau.mandant, bau.leitung), bau.revier, [bau.raeume[0]!],
        new Date('2026-06-15T10:00:00Z'),
      ),
    )).rejects.toBeInstanceOf(RaumNichtEntfernbar);

    // … und die Datenbank als zweite Linie (Invariante 8).
    await expect(
      sql.unsafe(`delete from revier_raum where revier_id = $1`, [bau.revier]),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

/**
 * **V-094 — die Gegenzeichnung des Auftragnehmers war unerreichbar.**
 *
 * `signiere` kennt beide Rollen, `leistungsnachweis_signatur` sieht sie mit
 * `lns_auftragnehmer_hat_anstellung` eigens vor, die Kundenansicht zeigt sie
 * an — und das einzige Unterschriftsformular schickte
 * `<input type="hidden" name="rolle" value="auftraggeber" />`. Die
 * Unterschrift der eigenen Objektleitung konnte nie entstehen.
 */
describe('(1a) V-094: beide Rollen unterschreiben, je genau einmal', () => {
  it('der Auftragnehmer zeichnet gegen — mit Beschaeftigung, wie 0066 es verlangt', async () => {
    const bau = await baueRevier(f.reinigung);
    const nachweis = await baueVorgelegtenNachweis(bau);

    await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const kontext = kontextAus(tx, bau.mandant, bau.leitung);
        const vorschau = await bereiteUnterschriftVor(kontext, nachweis);
        return signiere(kontext, {
          nachweisId: nachweis,
          rolle: 'auftragnehmer',
          anstellungId: f.jonasReinigung,
          unterzeichnerName: 'Herr Kruse',
          unterzeichnerFunktion: 'Objektleitung',
          bestaetigtePruefsumme: vorschau.pruefsumme,
        });
      },
    );

    const [z] = await sql.unsafe<{ rolle: string; anstellung: string | null }[]>(
      `select rolle::text as rolle, anstellung_id::text as anstellung
         from leistungsnachweis_signatur where leistungsnachweis_id = $1`, [nachweis]);
    expect(z!.rolle).toBe('auftragnehmer');
    /* `lns_auftragnehmer_hat_anstellung`: der Auftraggeber hat keine
       Beschaeftigung bei uns (D-09), der Auftragnehmer schon. */
    expect(z!.anstellung).toBe(f.jonasReinigung);
  });

  it('eine Auftragnehmerunterschrift OHNE Beschaeftigung weist die Datenbank ab', async () => {
    const bau = await baueRevier(f.reinigung);
    const nachweis = await baueVorgelegtenNachweis(bau);

    await expect(alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const kontext = kontextAus(tx, bau.mandant, bau.leitung);
        const vorschau = await bereiteUnterschriftVor(kontext, nachweis);
        return signiere(kontext, {
          nachweisId: nachweis,
          rolle: 'auftragnehmer',
          unterzeichnerName: 'Herr Kruse',
          bestaetigtePruefsumme: vorschau.pruefsumme,
        });
      },
    )).rejects.toThrow(/lns_auftragnehmer_hat_anstellung/u);
  });
});

describe('(1) die Unterschrift friert den Schnappschuss ein', () => {
  it('speichert Name, SERVERZEIT, Ort und die Positionen wie angezeigt', async () => {
    const bau = await baueRevier(f.reinigung);
    const nachweis = await baueVorgelegtenNachweis(bau);

    const ergebnis = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const kontext = kontextAus(tx, bau.mandant, bau.leitung);
        const vorschau = await bereiteUnterschriftVor(kontext, nachweis);
        return signiere(kontext, {
          nachweisId: nachweis,
          rolle: 'auftraggeber',
          unterzeichnerName: 'Frau Özdemir',
          unterzeichnerFunktion: 'Objektverantwortliche',
          bestaetigtePruefsumme: vorschau.pruefsumme,
          breitengrad: '52.520000',
          laengengrad: '13.404954',
          geoGenauigkeitM: '12.50',
          ip: '203.0.113.7',
          userAgent: 'CSE-Tablet/1.0',
        });
      },
    );

    const [zeile] = await sql.unsafe<{
      name: string; funktion: string; lat: string; lon: string;
      hash: string; snapshot: unknown; status: string; gesperrt: string | null;
      serverzeit_nah: boolean;
    }[]>(
      `select s.unterzeichner_name as name, s.unterzeichner_funktion as funktion,
              s.breitengrad::text as lat, s.laengengrad::text as lon,
              s.snapshot_hash as hash, s.snapshot,
              l.status::text as status, l.gesperrt_am::text as gesperrt,
              abs(extract(epoch from (now() - s.unterzeichnet_am))) < 60 as serverzeit_nah
         from leistungsnachweis_signatur s
         join leistungsnachweis l on l.id = s.leistungsnachweis_id
        where s.leistungsnachweis_id = $1`,
      [nachweis]);

    expect(zeile!.name).toBe('Frau Özdemir');
    expect(zeile!.funktion).toBe('Objektverantwortliche');
    expect(zeile!.lat).toBe('52.520000');
    expect(zeile!.lon).toBe('13.404954');
    /**
     * Die Zeit kommt vom SERVER: der Auslöser stempelt sie mit `now()`, und
     * was der Aufrufer geschickt hätte, spielt keine Rolle (Invariante 5).
     */
    expect(zeile!.serverzeit_nah).toBe(true);
    // Die Unterschrift hat den Kopf in einem Zug gesperrt.
    expect(zeile!.status).toBe('signiert');
    expect(zeile!.gesperrt).not.toBeNull();
    // Und der gespeicherte Digest lässt sich am zurückgelesenen Abzug nachrechnen.
    expect(pruefeSchnappschuss(
      zeile!.snapshot as never, zeile!.hash,
    )).toBe(true);
    expect(ergebnis.snapshotHash).toBe(zeile!.hash);
  });

  it('eine spätere Änderung am Revier ändert den Schnappschuss NICHT', async () => {
    const bau = await baueRevier(f.reinigung);
    const nachweis = await baueVorgelegtenNachweis(bau);

    const vorher = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const kontext = kontextAus(tx, bau.mandant, bau.leitung);
        const vorschau = await bereiteUnterschriftVor(kontext, nachweis);
        return signiere(kontext, {
          nachweisId: nachweis, rolle: 'auftraggeber',
          unterzeichnerName: 'Frau Özdemir',
          bestaetigtePruefsumme: vorschau.pruefsumme,
        });
      },
    );

    /**
     * Jetzt wird die Grundlage verändert — so, wie es im Alltag passiert:
     * das Revier wird umbenannt und neu zugeschnitten. Der Name steht im
     * Kopf des Abzugs, also würde ein NACHGELADENER Abzug hier abweichen.
     */
    await sql.unsafe(
      `update revier set bezeichnung = 'EG-Nord (neu zugeschnitten)',
                         sollzeit_minuten = 999.99
        where id = $1`, [bau.revier]);

    const [nachher] = await sql.unsafe<{ hash: string; snapshot: unknown }[]>(
      `select snapshot_hash as hash, snapshot from leistungsnachweis_signatur
        where leistungsnachweis_id = $1`, [nachweis]);

    // Der Beweis: derselbe Hash vorher wie nachher.
    expect(nachher!.hash).toBe(vorher.snapshotHash);
    // Und er passt weiterhin zum gespeicherten Abzug — der Abzug wurde also
    // nicht etwa mitgeändert und der Hash stehen gelassen.
    expect(schnappschussHash(alsSchnappschuss(nachher!.snapshot))).toBe(vorher.snapshotHash);

    // Gegenprobe: ein HEUTE gebauter Abzug wäre ein anderer. Ohne diese Zeile
    // bewiese der Test nur, dass sich nichts geändert hat, was sich ohnehin
    // nicht ändern konnte.
    const heute = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung, portal: 'intern' },
      async (tx) => bereiteUnterschriftVor(kontextAus(tx, bau.mandant, bau.leitung), nachweis),
    );
    expect(heute.pruefsumme).not.toBe(vorher.snapshotHash);
  });

  it('die Unterschriftszeile lässt sich nicht nachbessern', async () => {
    const bau = await baueRevier(f.reinigung);
    const nachweis = await baueVorgelegtenNachweis(bau);
    await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const kontext = kontextAus(tx, bau.mandant, bau.leitung);
        const v = await bereiteUnterschriftVor(kontext, nachweis);
        return signiere(kontext, {
          nachweisId: nachweis, rolle: 'auftraggeber',
          unterzeichnerName: 'Frau Özdemir', bestaetigtePruefsumme: v.pruefsumme,
        });
      },
    );

    // Selbst als Eigentümer: der Auslöser wirft.
    await expect(sql.unsafe(
      `update leistungsnachweis_signatur set unterzeichner_name = 'Herr Müller'
        where leistungsnachweis_id = $1`, [nachweis],
    )).rejects.toThrow();
    await expect(sql.unsafe(
      `delete from leistungsnachweis_signatur where leistungsnachweis_id = $1`, [nachweis],
    )).rejects.toThrow();
  });

  it('ändert sich die Anzeige zwischen Vorschau und Unterschrift, wird abgewiesen', async () => {
    const bau = await baueRevier(f.reinigung);
    const nachweis = await baueVorgelegtenNachweis(bau);

    await expect(alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const kontext = kontextAus(tx, bau.mandant, bau.leitung);
        // Die Prüfsumme eines Abzugs, den es so nicht gibt.
        return signiere(kontext, {
          nachweisId: nachweis, rolle: 'auftraggeber',
          unterzeichnerName: 'Frau Özdemir',
          bestaetigtePruefsumme: '0'.repeat(64),
        });
      },
    )).rejects.toBeInstanceOf(AnzeigeVeraltet);
  });

  it('ein Entwurf wird nicht unterschrieben — erst vorlegen', async () => {
    const bau = await baueRevier(f.reinigung);
    await expect(alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const kontext = kontextAus(tx, bau.mandant, bau.leitung);
        const id = await erstelleEntwurf(kontext, {
          objektId: bau.objekt, kundeId: bau.kunde, von: '2026-06-01', bis: '2026-06-30',
          positionen: [{
            bezeichnung: 'Test', menge: '1.000', einheit: 'Stück', quelle: 'manuell',
          }],
        });
        const v = await bereiteUnterschriftVor(kontext, id);
        return signiere(kontext, {
          nachweisId: id, rolle: 'auftraggeber',
          unterzeichnerName: 'Frau Özdemir', bestaetigtePruefsumme: v.pruefsumme,
        });
      },
    )).rejects.toBeInstanceOf(FalscherZustand);
  });

  it('und der Rückweg aus „signiert" ist versperrt', async () => {
    const bau = await baueRevier(f.reinigung);
    const nachweis = await baueVorgelegtenNachweis(bau);
    await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const kontext = kontextAus(tx, bau.mandant, bau.leitung);
        const v = await bereiteUnterschriftVor(kontext, nachweis);
        return signiere(kontext, {
          nachweisId: nachweis, rolle: 'auftraggeber',
          unterzeichnerName: 'Frau Özdemir', bestaetigtePruefsumme: v.pruefsumme,
        });
      },
    );
    await expect(sql.unsafe(
      `update leistungsnachweis set status = 'entwurf' where id = $1`, [nachweis],
    )).rejects.toThrow();
    // Und die Positionen sind mitgefroren.
    await expect(sql.unsafe(
      `update leistungsnachweis_position set menge = 99 where leistungsnachweis_id = $1`,
      [nachweis],
    )).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('(2) Gerätezeit getrennt, Unterschriftsbild privat', () => {
  it('speichert die Gerätezeit NEBEN der Serverzeit und leitet die Abweichung ab', async () => {
    const bau = await baueRevier(f.reinigung);
    const nachweis = await baueVorgelegtenNachweis(bau);

    /**
     * Ein Tablet, das zwei Stunden vorgeht. Die Behauptung wird gespeichert,
     * nicht übernommen — und die Abweichung entsteht daraus, statt verhandelt
     * zu werden (TIM-08, TIM-09).
     */
    const geraet = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const ergebnis = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const kontext = kontextAus(tx, bau.mandant, bau.leitung);
        const v = await bereiteUnterschriftVor(kontext, nachweis);
        return signiere(kontext, {
          nachweisId: nachweis, rolle: 'auftraggeber',
          unterzeichnerName: 'Frau Özdemir', bestaetigtePruefsumme: v.pruefsumme,
          geraeteZeit: geraet,
        });
      },
    );

    expect(ergebnis.zeitabweichungSek).not.toBeNull();
    // Rund zwei Stunden, mit Luft für die Laufzeit des Tests.
    expect(Math.abs((ergebnis.zeitabweichungSek ?? 0) - 7200)).toBeLessThan(60);

    const [zeile] = await sql.unsafe<{ getrennt: boolean }[]>(
      `select geraete_zeit is distinct from unterzeichnet_am as getrennt
         from leistungsnachweis_signatur where leistungsnachweis_id = $1`, [nachweis]);
    expect(zeile!.getrennt).toBe(true);
  });

  it('das Bild liegt im privaten Bucket und ist nur signiert erreichbar', async () => {
    const bau = await baueRevier(f.reinigung);
    const nachweis = await baueVorgelegtenNachweis(bau);
    const speicher = new LokalerSpeicher();
    const medienId = crypto.randomUUID();

    const adresse = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const kontext = kontextAus(tx, bau.mandant, bau.leitung);
        const ablage = await legeMediumAb(
          { mandantId: bau.mandant, medienId, daten: PNG, behaupteterTyp: 'image/png' },
          speicher,
        );
        /**
         * Die Medienzeile hängt am Nachweis (`bezug_tabelle`), und der
         * Auslöser aus 0041 leitet daraus `kunde_id` ab — nie aus der
         * Anfrage. Die Registerzeile dafür legt 0066 an.
         */
        await kontext.schreibe(
          `insert into einsatz_medien
             (id, mandant_id, bezug_tabelle, bezug_id, art, bucket, pfad, mime_typ,
              groesse_bytes, sha256, exif_entfernt, erstellt_von, erstellt_von_person_id)
           values ($1::uuid, app.aktiver_mandant(), 'leistungsnachweis', $2::uuid,
                   'foto', $3, $4, $5, $6, $7, true, app.aktueller_benutzer(), $8::uuid)`,
          [medienId, nachweis, ablage.bucket, ablage.pfad, ablage.mimeTyp,
            ablage.groesseBytes, ablage.sha256, f.fatima],
        );
        const v = await bereiteUnterschriftVor(kontext, nachweis);
        await signiere(kontext, {
          nachweisId: nachweis, rolle: 'auftraggeber',
          unterzeichnerName: 'Frau Özdemir', bestaetigtePruefsumme: v.pruefsumme,
          signaturMedienId: medienId,
        });
        return signierteMedienAdresse(kontext, medienId, speicher, 1_700_000_000);
      },
    );

    expect(adresse).not.toBeNull();
    // Eine ABLAUFENDE Adresse, kein Bucket-Pfad (DOC-03, SEC-A6).
    expect(adresse!.gueltigBis).toBeGreaterThan(1_700_000_000);
    expect(adresse!.url).toMatch(/einsatz-medien/u);

    const signaturen = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung, portal: 'intern' },
      async (tx) => ladeSignaturen(kontextAus(tx, bau.mandant, bau.leitung), nachweis),
    );
    expect(signaturen[0]?.signaturMedienId).toBe(medienId);
  });

  it('ohne Zugangsdaten entsteht KEINE Zeile — „nicht verbunden" statt Schein', async () => {
    /**
     * Der Adapter ohne Zugangsdaten wirft, statt Erfolg vorzutäuschen
     * (CLAUDE.md: keine Schein-Integrationen). Die Unterschrift selbst
     * gelingt trotzdem — Name, Serverzeit und Abzug sind das rechtlich
     * Tragende, das Bild ist die Beigabe.
     */
    const speicher = new SupabaseSpeicher('', '');
    expect(speicher.verbunden).toBe(false);
    await expect(legeMediumAb(
      { mandantId: f.reinigung, medienId: crypto.randomUUID(), daten: PNG,
        behaupteterTyp: 'image/png' },
      speicher,
    )).rejects.toBeInstanceOf(NichtVerbundenFehler);

    const bau = await baueRevier(f.reinigung);
    const nachweis = await baueVorgelegtenNachweis(bau);
    const ohneBild = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const kontext = kontextAus(tx, bau.mandant, bau.leitung);
        const v = await bereiteUnterschriftVor(kontext, nachweis);
        return signiere(kontext, {
          nachweisId: nachweis, rolle: 'auftraggeber',
          unterzeichnerName: 'Frau Özdemir', bestaetigtePruefsumme: v.pruefsumme,
        });
      },
    );
    expect(ohneBild.snapshotHash).toMatch(/^[0-9a-f]{64}$/u);
  });
});

// ---------------------------------------------------------------------------

describe('(4) die Reklamation verweist auf Nachweis und Nacharbeitsschicht', () => {
  it('legt beide Verweise an und liest sie zurück', async () => {
    const bau = await baueRevier(f.reinigung);
    const nachweis = await baueVorgelegtenNachweis(bau);

    // Eine Nacharbeitsschicht auf demselben Objekt.
    const [einsatz] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                            beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                            endet_am_folgetag, objekt_id, kunde_id, erstellt_von_art)
       values ($1,'manuell',$2,'2026-07-03',
               '2026-07-03T05:00:00Z','2026-07-03T08:00:00Z','07:00','10:00',false,
               $3,$4,'system') returning id`,
      [bau.mandant, `manuell:${zufall()}${zufall()}`, bau.objekt, bau.kunde] as never[]);

    const gelesen = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const kontext = kontextAus(tx, bau.mandant, bau.leitung);
        const { id } = await erstelleReklamation(kontext, {
          objektId: bau.objekt,
          kundeId: bau.kunde,
          revierId: bau.revier,
          leistungsnachweisId: nachweis,
          quelle: 'kunde',
          prioritaet: 'hoch',
          beschreibung: 'Treppenhaus im 2. OG war am 30.06. nicht gereinigt.',
          gemeldetVonName: 'Herr Kraus, Hausverwaltung',
        });
        await schreibeAbstellung(kontext, {
          id,
          status: 'behoben',
          ursache: 'Ausfall der Kraft, keine Vertretung disponiert',
          massnahme: 'Nachreinigung am 03.07., Vertretungsregel im Objektblatt ergänzt',
          nacharbeitEinsatzId: einsatz!.id,
        });
        return findeReklamation(kontext, id);
      },
    );

    expect(gelesen?.leistungsnachweisId).toBe(nachweis);
    expect(gelesen?.nacharbeitEinsatzId).toBe(einsatz!.id);
    expect(gelesen?.status).toBe('behoben');
    expect(gelesen?.nummer).toMatch(/^RK-\d{4}-\d{4}$/u);
    // Der Nachweis ist über seine Nummer benannt, nicht nur über eine id —
    // das ist die Auskunft, die vor einer Rechnungsfreigabe zählt.
    expect(gelesen?.nacharbeitDatum).toBe('03.07.2026');
  });

  it('„behoben" ohne Maßnahme wird abgewiesen — vom Dienst und von der Datenbank', async () => {
    const bau = await baueRevier(f.reinigung);
    const id = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => (await erstelleReklamation(kontextAus(tx, bau.mandant, bau.leitung), {
        objektId: bau.objekt, kundeId: bau.kunde, quelle: 'eigenkontrolle',
        beschreibung: 'Fenster im EG verschmiert.',
      })).id,
    );

    await expect(sql.unsafe(
      `update reklamation set status = 'behoben' where id = $1`, [id],
    )).rejects.toThrow();
  });

  it('ein Nachweis eines anderen Objekts wird nicht angehängt', async () => {
    const eins = await baueRevier(f.reinigung);
    const zwei = await baueRevier(f.reinigung);
    const fremd = await baueVorgelegtenNachweis(zwei);

    await expect(alsApp(
      { scope: 'mandant', mandantId: eins.mandant, benutzerId: eins.leitung,
        portal: 'intern', readonly: false },
      async (tx) => erstelleReklamation(kontextAus(tx, eins.mandant, eins.leitung), {
        objektId: eins.objekt, kundeId: eins.kunde, leistungsnachweisId: fremd,
        quelle: 'kunde', beschreibung: 'Falsches Objekt.',
      }),
    )).rejects.toBeInstanceOf(NachweisPasstNicht);
  });

  /**
   * **Die anderen vier Verweise, jeder einzeln.**
   *
   * Geprüft wurde bisher allein `leistungsnachweis_id`; die übrigen standen
   * unter der RLS, und die sagt „derselbe Mandant", nicht „dasselbe Gebäude".
   * Beide Aufbauten liegen deshalb ABSICHTLICH im selben Mandanten — sonst
   * fiele der fremde Verweis schon an der Mandantengrenze, und der Test
   * bewiese die Prüfung nicht, die er beweisen soll.
   */
  describe('jeder einzelne Fremdverweis fällt — und der eigene bleibt gültig', () => {
    const fremdverweise: readonly [string, (z: Aufbau) => Partial<{
      revierId: string; auftragLeistungId: string; kundeId: string;
    }>][] = [
      ['revier', (z) => ({ revierId: z.revier })],
      ['auftrag_leistung', (z) => ({ auftragLeistungId: z.leistung })],
      ['kunde', (z) => ({ kundeId: z.kunde })],
    ];

    for (const [spalte, fremd] of fremdverweise) {
      it(`\`${spalte}\` eines anderen Objekts wird abgewiesen`, async () => {
        const eins = await baueRevier(f.reinigung);
        const zwei = await baueRevier(f.reinigung);

        const versuch = alsApp(
          { scope: 'mandant', mandantId: eins.mandant, benutzerId: eins.leitung,
            portal: 'intern', readonly: false },
          async (tx) => erstelleReklamation(kontextAus(tx, eins.mandant, eins.leitung), {
            objektId: eins.objekt, quelle: 'kunde',
            beschreibung: 'Verweis gehört zu einem anderen Haus.',
            ...fremd(zwei),
          }),
        );
        await expect(versuch).rejects.toBeInstanceOf(BezugPasstNicht);
        await expect(versuch).rejects.toMatchObject({ spalte, status: 422 });
      });
    }

    it('`wiederholung_von` aus einem anderen Objekt wird abgewiesen', async () => {
      const eins = await baueRevier(f.reinigung);
      const zwei = await baueRevier(f.reinigung);
      const vorherige = await alsApp(
        { scope: 'mandant', mandantId: zwei.mandant, benutzerId: zwei.leitung,
          portal: 'intern', readonly: false },
        async (tx) => (await erstelleReklamation(
          kontextAus(tx, zwei.mandant, zwei.leitung), {
            objektId: zwei.objekt, quelle: 'eigenkontrolle',
            beschreibung: 'Erstmeldung im anderen Haus.',
          })).id,
      );

      await expect(alsApp(
        { scope: 'mandant', mandantId: eins.mandant, benutzerId: eins.leitung,
          portal: 'intern', readonly: false },
        async (tx) => erstelleReklamation(kontextAus(tx, eins.mandant, eins.leitung), {
          objektId: eins.objekt, quelle: 'kunde', wiederholungVonId: vorherige,
          beschreibung: 'Angebliche Wiederholung — anderes Haus.',
        }),
      )).rejects.toBeInstanceOf(BezugPasstNicht);
    });

    /**
     * Die Gegenprobe. Ohne sie bewiese die Schleife oben nur, dass
     * `erstelleReklamation` irgendetwas ablehnt — nicht, dass sie das
     * Richtige ablehnt.
     */
    it('dieselben fünf Verweise am EIGENEN Objekt werden angenommen', async () => {
      const bau = await baueRevier(f.reinigung);
      const nachweis = await baueVorgelegtenNachweis(bau);

      const gelesen = await alsApp(
        { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
          portal: 'intern', readonly: false },
        async (tx) => {
          const kontext = kontextAus(tx, bau.mandant, bau.leitung);
          const erste = await erstelleReklamation(kontext, {
            objektId: bau.objekt, quelle: 'eigenkontrolle',
            beschreibung: 'Erstmeldung.',
          });
          const { id } = await erstelleReklamation(kontext, {
            objektId: bau.objekt, kundeId: bau.kunde, revierId: bau.revier,
            auftragLeistungId: bau.leistung, leistungsnachweisId: nachweis,
            wiederholungVonId: erste.id, quelle: 'kunde',
            beschreibung: 'Dasselbe Treppenhaus, zweiter Monat.',
          });
          return findeReklamation(kontext, id);
        },
      );

      expect(gelesen?.leistungsnachweisId).toBe(nachweis);
      expect(gelesen?.nummer).toMatch(/^RK-\d{4}-\d{4}$/u);
    });
  });
});

// ---------------------------------------------------------------------------

/**
 * Der Nachweis wird UNTERSCHRIEBEN — deshalb steht diese Prüfung hier und
 * nicht in der Oberfläche.
 *
 * Der Schnappschuss friert ihn samt Abzug ein (CLN-04), er geht als Beleg zum
 * Kunden und später in die Rechnung. Eine Zeile mit fremder Auftragsleistung
 * fällt niemandem auf — sie sieht aus wie Arbeit. `zeiteintrag_id` bleibt
 * dabei oft null, also greift auch der zusammengesetzte Fremdschlüssel nicht.
 *
 * Beide Aufbauten liegen im SELBEN Mandanten: sonst hielte die RLS den Test,
 * und die Prüfung, um die es geht, bliebe unbewiesen.
 */
describe('der Entwurf nimmt keine Bezüge fremder Objekte auf', () => {
  it('ein fremdes Revier im Kopf wird abgewiesen', async () => {
    const eins = await baueRevier(f.reinigung);
    const zwei = await baueRevier(f.reinigung);

    const versuch = alsApp(
      { scope: 'mandant', mandantId: eins.mandant, benutzerId: eins.leitung,
        portal: 'intern', readonly: false },
      async (tx) => erstelleEntwurf(kontextAus(tx, eins.mandant, eins.leitung), {
        objektId: eins.objekt, kundeId: eins.kunde, revierId: zwei.revier,
        von: '2026-06-01', bis: '2026-06-30',
        positionen: [{
          bezeichnung: 'Unterhaltsreinigung Juni', menge: '1.000',
          einheit: 'Pauschale', einzelpreisCent: 4250n, quelle: 'manuell',
        }],
      }),
    );
    await expect(versuch).rejects.toBeInstanceOf(BezugPasstNichtZumObjekt);
    await expect(versuch).rejects.toMatchObject({ tabelle: 'revier', status: 422 });
  });

  it('eine fremde Auftragszeile im Kopf wird abgewiesen', async () => {
    const eins = await baueRevier(f.reinigung);
    const zwei = await baueRevier(f.reinigung);

    await expect(alsApp(
      { scope: 'mandant', mandantId: eins.mandant, benutzerId: eins.leitung,
        portal: 'intern', readonly: false },
      async (tx) => erstelleEntwurf(kontextAus(tx, eins.mandant, eins.leitung), {
        objektId: eins.objekt, kundeId: eins.kunde, auftragLeistungId: zwei.leistung,
        von: '2026-06-01', bis: '2026-06-30',
        positionen: [{
          bezeichnung: 'Unterhaltsreinigung Juni', menge: '1.000',
          einheit: 'Pauschale', einzelpreisCent: 4250n, quelle: 'manuell',
        }],
      }),
    )).rejects.toMatchObject({ tabelle: 'auftrag_leistung' });
  });

  /**
   * Der Fall, der ohne diesen Test durchginge: der Kopf ist sauber, die
   * ZWEITE Zeile nicht. Wer nur den Kopf prüft, hält den Nachweis für
   * geprüft.
   */
  it('eine fremde Auftragszeile in einer POSITION wird abgewiesen', async () => {
    const eins = await baueRevier(f.reinigung);
    const zwei = await baueRevier(f.reinigung);

    await expect(alsApp(
      { scope: 'mandant', mandantId: eins.mandant, benutzerId: eins.leitung,
        portal: 'intern', readonly: false },
      async (tx) => erstelleEntwurf(kontextAus(tx, eins.mandant, eins.leitung), {
        objektId: eins.objekt, kundeId: eins.kunde,
        revierId: eins.revier, auftragLeistungId: eins.leistung,
        von: '2026-06-01', bis: '2026-06-30',
        positionen: [
          {
            bezeichnung: 'Unterhaltsreinigung Juni', menge: '1.000',
            einheit: 'Pauschale', einzelpreisCent: 4250n, quelle: 'manuell',
            auftragLeistungId: eins.leistung,
          },
          {
            bezeichnung: 'Glasreinigung', menge: '1.000',
            einheit: 'Pauschale', einzelpreisCent: 18_900n, quelle: 'manuell',
            auftragLeistungId: zwei.leistung,
          },
        ],
      }),
    )).rejects.toBeInstanceOf(BezugPasstNichtZumObjekt);
  });

  it('nichts davon steht hinterher in der Datenbank', async () => {
    const eins = await baueRevier(f.reinigung);
    const zwei = await baueRevier(f.reinigung);

    await expect(alsApp(
      { scope: 'mandant', mandantId: eins.mandant, benutzerId: eins.leitung,
        portal: 'intern', readonly: false },
      async (tx) => erstelleEntwurf(kontextAus(tx, eins.mandant, eins.leitung), {
        objektId: eins.objekt, kundeId: eins.kunde, revierId: zwei.revier,
        von: '2026-06-01', bis: '2026-06-30',
        positionen: [{
          bezeichnung: 'Unterhaltsreinigung Juni', menge: '1.000',
          einheit: 'Pauschale', einzelpreisCent: 4250n, quelle: 'manuell',
        }],
      }),
    )).rejects.toThrow();

    const uebrig = await sql.unsafe(
      `select id from leistungsnachweis where objekt_id = $1`, [eins.objekt]);
    expect(uebrig).toHaveLength(0);
  });

  /**
   * **Die Gegenprobe, die die Prüfung ehrlich hält.**
   *
   * `auftrag_leistung.objekt_id` ist nullbar, und zwar mit Absicht (0050):
   * ein Rahmenvertrag über mehrere Liegenschaften trägt seine Standorte in
   * den Zeilen und nicht im Kopf — oder gar nicht. Eine Prüfung, die `null`
   * für einen Verstoß hält, weist geltende Verträge ab; dieser Fall wäre
   * grün, solange sie das tut, und das ist genau die Sorte Test, die nichts
   * beweist. Deshalb prüft er, dass der Entwurf DURCHKOMMT.
   */
  it('eine Rahmenvertragszeile ohne Standort bleibt zulässig', async () => {
    const bau = await baueRevier(f.reinigung);
    const rahmen = await baueRahmenzeile(bau.mandant, bau.kunde, bau.leitung);

    const id = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => erstelleEntwurf(kontextAus(tx, bau.mandant, bau.leitung), {
        objektId: bau.objekt, kundeId: bau.kunde, auftragLeistungId: rahmen,
        von: '2026-06-01', bis: '2026-06-30',
        positionen: [{
          bezeichnung: 'Unterhaltsreinigung Juni', menge: '1.000',
          einheit: 'Pauschale', einzelpreisCent: 4250n, quelle: 'manuell',
          auftragLeistungId: rahmen,
        }],
      }),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
  });

  /** Gegenprobe: derselbe Aufruf mit EIGENEN Bezügen kommt durch. */
  it('Kopf und Zeilen am eigenen Objekt werden angenommen', async () => {
    const bau = await baueRevier(f.reinigung);

    const id = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => erstelleEntwurf(kontextAus(tx, bau.mandant, bau.leitung), {
        objektId: bau.objekt, kundeId: bau.kunde,
        revierId: bau.revier, auftragLeistungId: bau.leistung,
        von: '2026-06-01', bis: '2026-06-30',
        positionen: [{
          bezeichnung: 'Unterhaltsreinigung Juni', menge: '1.000',
          einheit: 'Pauschale', einzelpreisCent: 4250n, quelle: 'manuell',
          auftragLeistungId: bau.leistung,
        }],
      }),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
  });
});

// ---------------------------------------------------------------------------

describe('die Mandantengrenze hält', () => {
  it('die Security sieht die Nachweise der Reinigung nicht', async () => {
    const bau = await baueRevier(f.reinigung);
    const nachweis = await baueVorgelegtenNachweis(bau);
    const fremder = await konto(`security-${zufall()}@cse.test`);
    await mitglied(fremder, f.security, 'leitung');

    const sichtbar = await alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: fremder, portal: 'intern' },
      async (tx) => tx.unsafe(
        `select id from leistungsnachweis where id = $1`, [nachweis] as never[]),
    );
    expect(sichtbar).toHaveLength(0);
  });

  it('das Kundenportal sieht keinen Entwurf', async () => {
    const bau = await baueRevier(f.reinigung);
    const entwurf = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => erstelleEntwurf(kontextAus(tx, bau.mandant, bau.leitung), {
        objektId: bau.objekt, kundeId: bau.kunde, von: '2026-06-01', bis: '2026-06-30',
        positionen: [{
          bezeichnung: 'Entwurfszeile', menge: '1.000', einheit: 'Stück', quelle: 'manuell',
        }],
      }),
    );

    const kundenkonto = await konto(`kunde-${zufall()}@cse.test`);
    await sql.unsafe(
      `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id)
       values ($1,$2,$3)`, [bau.mandant, bau.kunde, kundenkonto]);

    const sichtbar = await alsApp(
      { scope: 'kunde', mandantIds: [bau.mandant], benutzerId: kundenkonto, portal: 'kunde' },
      async (tx) => tx.unsafe(
        `select id from leistungsnachweis where id = $1`, [entwurf] as never[]),
    );
    // AUT-01: ein Kunde sieht `vorgelegt` und `signiert`, nie einen Entwurf.
    expect(sichtbar).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('die Qualitätsprüfung bleibt unbewertet, solange O-29 offen ist', () => {
  it('eine neu angelegte Gesellschaft bekommt ihre Platzhalterzeile', async () => {
    /**
     * Der Auslöser, ohne den eine neue Gesellschaft keinen Katalog hätte —
     * und `qualitaetspruefung.pruefverfahren_id` ist `not null`: die erste
     * Prüfung schlüge erst vor Ort auf dem Gerät mit einem
     * Fremdschlüsselfehler fehl.
     *
     * Der Mandant entsteht hier über den GEWÖHNLICHEN Weg, nicht über
     * `seed()`: die Fixtur läuft unter `session_replication_role = replica`,
     * und dort feuert kein Auslöser. Ein Test, der die Fixtur befragt, prüfte
     * genau das Gegenteil von dem, was er behauptet.
     */
    const slug = `pruef-${zufall()}`;
    const [neu] = await sql.unsafe<{ id: string }[]>(
      `insert into mandant (slug, name, firma, strasse, plz, ort, land)
       values ($1,$1,$1,'Teststr. 1','10115','Berlin','DE') returning id`, [slug]);

    const zeilen = await sql.unsafe<{
      schluessel: string; ist_platzhalter: boolean; schwelle: string | null;
    }[]>(
      `select schluessel, ist_platzhalter,
              bestehensschwelle_prozent::text as schwelle
         from pruefverfahren where mandant_id = $1`, [neu!.id]);

    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.schluessel).toBe('unbestimmt');
    expect(zeilen[0]?.ist_platzhalter).toBe(true);
    // Die Schwelle ist die offene Frage — NULL, nicht 0 und nicht 90 (O-29).
    expect(zeilen[0]?.schwelle).toBeNull();
  });

  it('`bestanden` bleibt NULL, weil niemand die Schwelle gesetzt hat', async () => {
    const bau = await baueRevier(f.reinigung);
    /**
     * Die Katalogzeile von Hand, weil `seed()` unter
     * `session_replication_role = replica` läuft und der Vorbelegungs-Auslöser
     * dort nicht feuert (siehe oben). Sie trägt bewusst KEINE Skala und KEINE
     * Schwelle — genau der Zustand, den O-29 offen lässt.
     */
    await sql.unsafe(
      `insert into pruefverfahren (mandant_id, schluessel, bezeichnung,
                                   ist_platzhalter, erstellt_von_art)
       values ($1,'unbestimmt','Unbestimmtes Prüfverfahren',true,'system')`,
      [bau.mandant]);

    const ergebnis = await alsApp(
      { scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.leitung,
        portal: 'intern', readonly: false },
      async (tx) => {
        const kontext = kontextAus(tx, bau.mandant, bau.leitung);
        const [verfahren] = await listePruefverfahren(kontext);
        return erfassePruefung(kontext, {
          objektId: bau.objekt,
          revierId: bau.revier,
          kundeId: bau.kunde,
          pruefverfahrenId: verfahren!.id,
          mitKunde: true,
          positionen: [
            { kriterium: 'Treppenhaus EG', ergebnis: 'io', punkte: '5.00' },
            {
              kriterium: 'Sanitär 1. OG', ergebnis: 'nio', punkte: '1.00',
              mangelBeschreibung: 'Waschbecken nicht gereinigt',
            },
          ],
        });
      },
    );
    expect(ergebnis.bewertung).toBe('unbestimmt');

    const [zeile] = await sql.unsafe<{ bestanden: boolean | null; punkte: string | null }[]>(
      `select bestanden, punkte::text as punkte from qualitaetspruefung where id = $1`,
      [ergebnis.id]);
    // NICHT `false`: „nicht bestanden" wäre eine Antwort, die niemand gegeben
    // hat (K-17, O-29).
    expect(zeile!.bestanden).toBeNull();
    /**
     * Und auch keine Kopfsumme: das Platzhalterverfahren trägt keine Skala,
     * und eine 6 ohne „von wie vielen" ist keine Bewertung. Die EINZELNEN
     * Befunde behalten ihre Punkte — es geht nichts verloren, sobald der Kunde
     * die Skala nennt.
     */
    expect(zeile!.punkte).toBeNull();
    const [befunde] = await sql.unsafe<{ summe: string }[]>(
      `select sum(punkte)::text as summe from qualitaetspruefung_position
        where qualitaetspruefung_id = $1`, [ergebnis.id]);
    expect(befunde!.summe).toBe('6.00');

    // Ein „nio" ohne Mangelbeschreibung lässt die Datenbank nicht zu.
    await expect(sql.unsafe(
      `update qualitaetspruefung_position set mangel_beschreibung = null
        where qualitaetspruefung_id = $1 and ergebnis = 'nio'`, [ergebnis.id],
    )).rejects.toThrow();
  });

  it('mit gesetzter Schwelle entscheidet der Dienst — ganzzahlig, ohne Gleitkomma', () => {
    // 84,995 % gegen 85 %: der Fall, der als Double je nach Rundung anders
    // ausgeht. In Hundertstelprozent ist er eindeutig.
    expect(schwellenBewertung.bewerte({
      punkte: '84.99', maxPunkte: '100.00', schwelleProzent: '85.00',
    })).toBe('nicht_bestanden');
    expect(schwellenBewertung.bewerte({
      punkte: '85.00', maxPunkte: '100.00', schwelleProzent: '85.00',
    })).toBe('bestanden');
    // Ohne Schwelle bleibt es unbestimmt — das ist der heutige Zustand.
    expect(schwellenBewertung.bewerte({
      punkte: '85.00', maxPunkte: '100.00', schwelleProzent: null,
    })).toBe('unbestimmt');
  });
});
