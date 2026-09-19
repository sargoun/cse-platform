/**
 * Reinigung, Sicherheit und Qualitaet gegen die ECHTE Datenbank — die Zusagen,
 * die nur mit RLS und Ausloesern pruefbar sind.
 *
 * Diese Datei prueft vier Dinge, und jedes davon ist ein Befund, der in
 * Produktion nach nichts aussieht:
 *
 *  1. **Ein abgerechneter Einzelabruf laesst sich nicht zurueckstellen.**
 *     `positionsquelle.ts` stempelt bei der Rechnungsuebernahme `erbracht` →
 *     `abgerechnet`, und `einzelabruf.ts` liest ausschliesslich `erbracht` als
 *     abrechenbar. Ein freies `setzeStatus` machte den Abruf ein zweites Mal
 *     abrechenbar; nur der Sperrindex `quelle_sonderleistung_uk` stuende noch
 *     dazwischen, und eine Eindeutigkeitsverletzung ist die schlechteste Art,
 *     eine Doppelabrechnung zu erfahren.
 *  2. **Ein Befund kann keinen Revierraum aus einem fremden Revier nennen.**
 *     Der Fremdschluessel `qpp_revier_raum_fk` ist zusammengesetzt
 *     `(mandant_id, revier_id, revier_raum_id)` und laeuft als MATCH SIMPLE:
 *     bleibt `revier_id` NULL, wird er GAR NICHT geprueft. Der falsche Raum
 *     stuende danach auf dem Pruefprotokoll.
 *  3. **Das Bewacherregister ist ueber `anstellung` eingegrenzt und traegt
 *     kein Entgeltfeld.** `bewacher_eintrag` hat kein `mandant_id` (der
 *     Eintrag haengt am Menschen, D-09) — ohne den Verbund stuenden dort die
 *     Bewacher jeder Schwestergesellschaft.
 *  4. **„Nicht geprueft" ist nicht „nichts offen".** Die Modulkoepfe lesen
 *     Tabellen mit anderen Rechten als ihre Route; ohne das Recht kommt `null`
 *     und nicht `0`.
 *
 * Die Fixtur baut ihre Stammdaten selbst — der Seed kennt sie in dieser Form
 * nicht (0 Sonderleistungen, 0 Qualitaetspruefungen, 0 Bewachereintraege).
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  erfasseAbruf, ladeAbrufAuswahl, ladeKatalogzeilen, listeAbrufe, setzeStatus,
  setzeZeitwert, storniereAbruf, StatusNichtErlaubt,
} from '../../src/server/services/reinigung/sonderleistung.js';
import {
  aktualisiereEintrag, erfasseEintrag, leseRegister, securityGebucht,
} from '../../src/server/services/security/bewacherregister.js';
import {
  erfassePruefung, findePruefung, ladeBefunde, ladePruefungAuswahl,
  listePruefungen, listePruefverfahren, RaumPasstNicht,
} from '../../src/server/services/reinigung/qualitaet.js';
import {
  findeTurnus, ladeAusnahmen, ladeTurnusEinsaetze, ladeVorschau, legeAusnahmeAn,
  listeTurnusse,
} from '../../src/server/services/reinigung/turnus.js';
import { listeSerien } from '../../src/server/services/dienstplan/serienliste.js';
import { ladeReinigungKopf } from '../../src/server/services/reinigung/uebersicht.js';
import { ladeSecurityKopf } from '../../src/server/services/security/uebersicht.js';
import { findeVeranstaltung } from '../../src/server/services/security/veranstaltung.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/** Der Stichtag der Fixtur — fest, damit Restfristen prueffbar sind. */
const STICHTAG = '2026-09-18';

interface Aufbau {
  readonly mandant: string;
  readonly leitung: string;
  readonly person: string;
  readonly anstellung: string;
  readonly kunde: string;
  readonly objekt: string;
  readonly revier: string;
  readonly revierFremd: string;
  readonly revierRaum: string;
  readonly revierRaumFremd: string;
  readonly raum: string;
  readonly katalog: string;
  readonly auftragLeistung: string;
  readonly verfahren: string;
  readonly turnus: string;
  readonly veranstaltung: string;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/** Der Kontext, den ein Dienst erwartet — auf der Transaktion der Sitzung. */
function kontextAus(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
): SchreibKontext {
  const abfrage = async <T>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant],
    abfrage, schreibe: abfrage,
  };
}

/**
 * Kunde, Objekt, Raeume, ZWEI Reviere, Katalog, Auftrag, Turnus, Veranstaltung.
 *
 * Das ZWEITE Revier ist kein Zierat: es ist die Gegenprobe zu Zusage 2 — ein
 * Revierraum, der zu einem anderen Revier gehoert, darf auf dem
 * Pruefprotokoll nicht landen.
 */
async function baueAuf(mandant: string): Promise<Aufbau> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`,
    [`rsq-${zufall()}@cse.test`]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into person (vorname, nachname) values ('Prüf','Person') returning id`);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`,
    [u!.id, `rsq-${zufall()}@cse.test`, p!.id] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId('admin')]);
  const [an] = await sql.unsafe<{ id: string }[]>(
    `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
     values ($1,$2,$3,'2025-01-01','aktiv') returning id`,
    [mandant, p!.id, `P-${zufall()}`]);

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Prüfkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Prüfhaus','Teststr. 1','10178','Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                            quelle, gueltig_ab)
     values ($1,$2,$2,137,'Platzhalter (O-17)','2020-01-01') returning id`,
    [mandant, `PVC-${zufall()}`]);

  const raum = async (nummer: string, sortierung: number): Promise<string> => {
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into raum (mandant_id, objekt_id, raumnummer, bezeichnung, flaeche_qm,
                         belagsart_id, sortierung)
       values ($1,$2,$3,'Büro',12.5,$4,$5) returning id`,
      [mandant, o!.id, nummer, b!.id, sortierung] as never[]);
    return r!.id;
  };
  const raum1 = await raum('1.01', 0);
  const raum2 = await raum('2.01', 1);

  const revier = async (bezeichnung: string, kurz: string): Promise<string> => {
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into revier (mandant_id, objekt_id, bezeichnung, kurzzeichen,
                           sollzeit_minuten, aktiv_ab, erstellt_von_art)
       values ($1,$2,$3,$4,60,'2026-01-01','system') returning id`,
      [mandant, o!.id, bezeichnung, kurz] as never[]);
    return r!.id;
  };
  const rev = await revier(`EG-Nord ${zufall()}`, `EGN${zufall().slice(0, 3)}`);
  const revFremd = await revier(`OG-Sued ${zufall()}`, `OGS${zufall().slice(0, 3)}`);

  const revierRaum = async (revierId: string, raumId: string): Promise<string> => {
    const [rr] = await sql.unsafe<{ id: string }[]>(
      `insert into revier_raum (mandant_id, revier_id, raum_id, objekt_id, flaeche_qm,
                                leistungswert_qm_pro_stunde, sollzeit_minuten,
                                reihenfolge, erstellt_von_art)
       values ($1,$2,$3,$4,12.5,137,5.48,0,'system') returning id`,
      [mandant, revierId, raumId, o!.id] as never[]);
    return rr!.id;
  };
  const rr1 = await revierRaum(rev, raum1);
  const rrFremd = await revierRaum(revFremd, raum2);

  const [kat] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, gueltig_ab, status)
     values ($1,$2,'Prüfkatalog','2020-01-01','aktiv') returning id`,
    [mandant, `pruef-${zufall()}`]);
  const [lkp] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog_position
       (mandant_id, katalog_id, oz, kurztext, einheit, zeitwert_minuten,
        standard_einzelpreis_cent, gueltig_ab, ist_platzhalter)
     values ($1,$2,'01.01','Glasreinigung','m²',3.5,450,'2020-01-01',true) returning id`,
    [mandant, kat!.id] as never[]);

  const [auf] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                          bezeichnung, verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,$4,'rahmenvertrag','aktiv','Prüfauftrag',$5,'2026-01-01')
     returning id`,
    [mandant, `AU-${zufall()}`, k!.id, o!.id, u!.id] as never[]);
  const [alz] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, objekt_id,
                                   bezeichnung, menge, einheit, einzelpreis_cent,
                                   steuersatz_bp, gueltig_ab)
     values ($1,$2,1,$3,'Glas',1,'Stk',45000,1900,'2026-01-01') returning id`,
    [mandant, auf!.id, o!.id] as never[]);

  /**
   * Das Platzhalterverfahren — gelesen, und wenn es fehlt, VON HAND angelegt.
   *
   * In Produktion legt `trg_mandant_pruefverfahren_vorbelegen` es je
   * Gesellschaft an (0068). Die Fixtur bekommt es aber NICHT: `seed()` in
   * `harness.ts` setzt `session_replication_role = replica`, um die
   * Loeschriegel fuer das `truncate` abzuschalten — und das schaltet jeden
   * Haken ab, auch die vorbelegenden. Dieselbe Falle, die der Harness fuer
   * `trg_mandant_domaene` schon kennt und dort mit einem Aufruf von Hand
   * loest.
   *
   * Ohne diese Zeilen ist `pv` undefiniert, `baueAuf` wirft beim Aufbau, und
   * ALLE Zusagen dieser Datei fallen mit einem `TypeError` aus — also mit
   * einer Meldung, die nach einem Produktfehler aussieht und keiner ist.
   * Gelesen wird trotzdem zuerst: `pruefverfahren_schluessel_uk` laesst kein
   * zweites `unbestimmt` zu, und ein Lauf gegen eine Datenbank MIT Haken
   * legte sonst ein Duplikat an.
   */
  const [vorhanden] = await sql.unsafe<{ id: string }[]>(
    `select id from pruefverfahren where mandant_id = $1 and archiviert_am is null
      order by ist_platzhalter limit 1`, [mandant]);
  const pv = vorhanden ?? (await sql.unsafe<{ id: string }[]>(
    `insert into pruefverfahren (mandant_id, schluessel, bezeichnung, beschreibung,
                                 ist_platzhalter, erstellt_von_art)
     values ($1,'unbestimmt','Unbestimmtes Prüfverfahren',
             'Platzhalter, bis O-29 beantwortet ist.', true, 'system')
     returning id`, [mandant] as never[]))[0];

  const [t] = await sql.unsafe<{ id: string }[]>(
    `insert into turnus (mandant_id, revier_id, leistungskatalog_position_id, bezeichnung,
                         rrule, dtstart_lokal, dauer_minuten, feiertagsregel, gueltig_ab,
                         erstellt_von_art)
     values ($1,$2,$3,'Unterhalt früh','FREQ=WEEKLY;BYDAY=MO,WE,FR',
             '2026-01-05 06:00'::timestamp,240,'ausfall','2026-01-01','system')
     returning id`,
    [mandant, rev, lkp!.id] as never[]);
  /* `generiert_bis` liegt VOR dem Stichtag: die Serie ist stehen geblieben,
     und genau das soll der Modulkopf melden. */
  await sql.unsafe(
    `insert into planungsserie (mandant_id, turnus_id, quelle, zeitzone,
                                feiertage_ueberspringen, feiertag_bundesland,
                                horizont_tage, generiert_bis, erstellt_von_art)
     values ($1,$2,'turnus','Europe/Berlin',true,'BE',56,'2026-01-01','system')`,
    [mandant, t!.id] as never[]);

  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into veranstaltung (mandant_id, objekt_id, kunde_id, bezeichnung, anlass,
                                beginn, ende, erwartete_besucher, soll_besetzung,
                                leitung_anstellung_id, erstellt_von_art)
     values ($1,$2,$3,'Sommerfest','Betriebsfest',
             '2026-07-10 18:00+02','2026-07-11 02:00+02',400,4,$4,'system')
     returning id`,
    [mandant, o!.id, k!.id, an!.id] as never[]);

  return {
    mandant, leitung: u!.id, person: p!.id, anstellung: an!.id,
    kunde: k!.id, objekt: o!.id, revier: rev, revierFremd: revFremd,
    revierRaum: rr1, revierRaumFremd: rrFremd, raum: raum1,
    katalog: lkp!.id, auftragLeistung: alz!.id, verfahren: pv!.id,
    turnus: t!.id, veranstaltung: v!.id,
  };
}

function alsLeitung<T>(a: Aufbau, fn: (k: SchreibKontext, tx: postgres.TransactionSql) => Promise<T>):
Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId: a.mandant, benutzerId: a.leitung,
      personId: a.person, portal: 'intern', readonly: false,
    },
    async (tx) => fn(kontextAus(tx, a.mandant, a.leitung), tx),
  );
}

let a: Aufbau;

beforeEach(async () => {
  f = await seed();
  a = await baueAuf(f.reinigung);
});

afterAll(schliessen);

describe('Einzelabruf — der Status ist finanzwirksam (CLN-05, FIN-01)', () => {
  it('erfasst, liest und pflegt einen Abruf; die Menge bleibt Text', async () => {
    await alsLeitung(a, async (k) => {
      const { id } = await erfasseAbruf(k, {
        objektId: a.objekt, kundeId: a.kunde, leistungskatalogPositionId: a.katalog,
        bezeichnung: 'Glasreinigung Treppenhaus', beauftragtAm: '2026-09-01',
        revierId: a.revier, auftragLeistungId: a.auftragLeistung,
        ausfuehrungVon: '2026-09-10', ausfuehrungBis: '2026-09-12',
        menge: '24,5', einheit: 'm²', status: 'beauftragt',
      });
      const liste = await listeAbrufe(k);
      expect(liste).toHaveLength(1);
      expect(liste[0]!.id).toBe(id);
      /* `numeric(12,3)` als TEXT: durch einen Double geschickt waere aus 24,5
         irgendwann 24,499999 — und die Menge geht in eine Rechnung. */
      expect(liste[0]!.menge).toBe('24.500');
      expect(liste[0]!.objekt).toBe('Prüfhaus');
      expect(liste[0]!.kunde).toBe('Prüfkunde');
      expect(liste[0]!.katalogKurztext).toBe('Glasreinigung');
      expect(liste[0]!.hatVertragszeile).toBe(true);

      const wechsel = await setzeStatus(k, { id, status: 'erbracht' });
      expect(wechsel).toEqual({ von: 'beauftragt', nach: 'erbracht' });
    });
  });

  it('ein ABGERECHNETER Abruf laesst sich nicht zurueckstellen und nicht stornieren', async () => {
    const id = await alsLeitung(a, async (k) => (await erfasseAbruf(k, {
      objektId: a.objekt, kundeId: a.kunde, leistungskatalogPositionId: a.katalog,
      bezeichnung: 'Glas EG', beauftragtAm: '2026-09-01', status: 'erbracht',
    })).id);

    /*
     * Der Stempel kommt von der Rechnungsuebernahme (`positionsquelle.ts`).
     * Hier wird er als Eigentuemer gesetzt — der Test prueft die Sperre des
     * Dienstes, nicht den Weg dorthin.
     */
    await sql.unsafe(
      `update sonderleistung set status = 'abgerechnet' where id = $1`, [id]);

    await alsLeitung(a, async (k) => {
      await expect(setzeStatus(k, { id, status: 'erbracht' }))
        .rejects.toThrow(StatusNichtErlaubt);
      await expect(storniereAbruf(k, { id, grund: 'Versuch' }))
        .rejects.toThrow(StatusNichtErlaubt);
    });

    const [danach] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from sonderleistung where id = $1`, [id]);
    expect(danach!.status).toBe('abgerechnet');
  });

  it('Storno setzt Grund und Urheber — und loescht nichts (Invariante 8)', async () => {
    const id = await alsLeitung(a, async (k) => {
      const { id: neu } = await erfasseAbruf(k, {
        objektId: a.objekt, kundeId: a.kunde, leistungskatalogPositionId: a.katalog,
        bezeichnung: 'Warenräumung Keller', beauftragtAm: '2026-09-02',
      });
      await storniereAbruf(k, { id: neu, grund: 'Kunde hat abbestellt' });
      const zeile = (await listeAbrufe(k)).find((x) => x.id === neu)!;
      expect(zeile.status).toBe('storniert');
      expect(zeile.stornoGrund).toBe('Kunde hat abbestellt');
      // Die Zeit kommt vom Ausloeser und damit von der SERVERUHR (Invariante 5).
      expect(zeile.storniertAmLokal).not.toBeNull();
      return neu;
    });
    const [noch] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from sonderleistung where id = $1`, [id]);
    expect(noch!.n).toBe('1');
    // Und die Loeschsperre haelt auch gegen einen direkten DELETE.
    await expect(sql.unsafe(`delete from sonderleistung where id = $1`, [id]))
      .rejects.toThrow();
  });

  it('der Zeitwert einer Katalogzeile wird gepflegt, der PREIS nicht angefasst', async () => {
    await alsLeitung(a, async (k) => {
      const vorher = await ladeKatalogzeilen(k);
      expect(vorher.geprueft).toBe(true);
      const zeile = vorher.zeilen.find((z) => z.id === a.katalog)!;
      expect(zeile.zeitwertMinuten).toBe('3.500');
      // Cent als GANZZAHLTEXT — nie als `number` (Invariante 1).
      expect(zeile.standardEinzelpreisCent).toBe('450');
      expect(zeile.istPlatzhalter).toBe(true);

      await setzeZeitwert(k, {
        id: a.katalog, zeitwertMinuten: '4,25', istPlatzhalter: false,
      });
      const danach = (await ladeKatalogzeilen(k)).zeilen.find((z) => z.id === a.katalog)!;
      expect(danach.zeitwertMinuten).toBe('4.250');
      expect(danach.istPlatzhalter).toBe(false);
      /* Der Listenpreis bleibt: zwei Seiten, die dieselbe Preisspalte
         schreiben, sind eine zu viel (O-702). */
      expect(danach.standardEinzelpreisCent).toBe('450');

      const auswahl = await ladeAbrufAuswahl(k);
      expect(auswahl.objekte.length).toBeGreaterThanOrEqual(1);
      expect(auswahl.katalog.length).toBeGreaterThanOrEqual(1);
      expect(auswahl.reviere.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('Bewacherregister — § 34a GewO, handerfasst (SEC-03, LEG-04, D-09)', () => {
  it('Personen OHNE Eintrag stehen in der Liste — sie sind die Luecke', async () => {
    await alsLeitung(a, async (k) => {
      const register = await leseRegister(k, STICHTAG);
      expect(register.verbindung).toBe('nicht_verbunden');
      const eigene = register.zeilen.find((z) => z.personId === a.person)!;
      expect(eigene).toBeDefined();
      expect(eigene.eintragId).toBeNull();
      expect(eigene.einsetzbarAmStichtag).toBe(false);
    });
  });

  it('erfasst, liest und sperrt — die Restfrist rechnet die Datenbank', async () => {
    await alsLeitung(a, async (k) => {
      const { id } = await erfasseEintrag(k, {
        personId: a.person, bewacherId: 'BE-2026-000123', status: 'registriert',
        registriertSeit: '2026-01-15', gueltigBis: '2026-10-01',
      });
      const z = (await leseRegister(k, STICHTAG)).zeilen
        .find((x) => x.personId === a.person)!;
      expect(z.eintragId).toBe(id);
      expect(z.bewacherId).toBe('BE-2026-000123');
      // 2026-10-01 minus 2026-09-18 = 13 Tage, gerechnet in Postgres (K-11).
      expect(z.restTage).toBe(13);
      expect(z.einsetzbarAmStichtag).toBe(true);
      expect(z.quelle).toBe('manuell');

      /*
       * Die festgeschriebene Feldliste: KEIN Entgeltfeld. `anstellung` traegt
       * `stundensatz_intern` und `tarifgruppe`; die Abfrage nennt sie nicht,
       * und dieser Test sucht nicht stichprobenartig nach „stundensatz",
       * sondern nach jeder Spur davon (K-05).
       */
      for (const feld of Object.keys(z)) {
        expect(feld).not.toMatch(/satz|tarif|entgelt|lohn|gehalt/iu);
      }

      await aktualisiereEintrag(k, {
        id, personId: a.person, bewacherId: 'BE-2026-000123', status: 'gesperrt',
        registriertSeit: '2026-01-15', gueltigBis: '2026-10-01',
        bemerkung: 'Prüfung offen',
      });
      const danach = (await leseRegister(k, STICHTAG)).zeilen
        .find((x) => x.personId === a.person)!;
      expect(danach.status).toBe('gesperrt');
      // Nur `registriert` deckt den Tag — dieselbe Bedingung wie im § 34a-Tor.
      expect(danach.einsetzbarAmStichtag).toBe(false);
    });
  });

  it('kein Format wird geprueft, aber die Pruefbedingung der Tabelle schon (O-40)', async () => {
    await alsLeitung(a, async (k) => {
      // Was die Behoerde ausgestellt hat, wird angenommen — auch „7".
      const { id } = await erfasseEintrag(k, {
        personId: a.person, bewacherId: '7', status: 'beantragt',
      });
      expect(id).toBeTruthy();
      await expect(erfasseEintrag(k, {
        personId: a.person, bewacherId: '   ', status: 'beantragt',
      })).rejects.toThrow(/1 bis 32/u);
    });
  });

  it('die Liste ist ueber `anstellung` eingegrenzt — kein Eintrag einer Schwester', async () => {
    /*
     * Eine Person, die NUR in der Security beschaeftigt ist, mit einem
     * Eintrag. `bewacher_eintrag` traegt kein `mandant_id`; ohne den Verbund
     * auf `anstellung` stuende sie im Register der Reinigung.
     */
    const [fremd] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname) values ('Fremde','Wache') returning id`);
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1,$2,$3,'2025-01-01','aktiv')`,
      [f.security, fremd!.id, `S-${zufall()}`] as never[]);
    await sql.unsafe(
      `insert into bewacher_eintrag (person_id, bewacher_id, status, quelle)
       values ($1,$2,'registriert','manuell')`,
      [fremd!.id, `BE-${zufall()}`] as never[]);

    await alsLeitung(a, async (k) => {
      const register = await leseRegister(k, STICHTAG);
      expect(register.zeilen.some((z) => z.personId === fremd!.id)).toBe(false);
    });
  });

  it('ohne gebuchtes Security-Modul gibt es die Seite nicht (D-377, AUT-06)', async () => {
    /*
     * Die zentrale Modulsperre greift hier NICHT: die Route traegt als
     * einziges Recht `personal.bewacher_verwalten`, und `personal` ist ein
     * Querschnittsmodul. Ohne diese Pruefung waere
     * `/portal/bau/security/bewacherregister` fuer jede admin/leitung
     * erreichbar — mit einer leeren Liste, die eine Aussage waere, die
     * niemand treffen wollte.
     */
    await sql.unsafe(
      `update mandant set module = array['reinigung','security'], module_gepflegt = true
        where id = $1`, [a.mandant]);
    await sql.unsafe(
      `update mandant set module = array['bau'], module_gepflegt = true where id = $1`,
      [f.bau]);
    const [u] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [`bau-${zufall()}@cse.test`]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
      [u!.id, `bau-${zufall()}@cse.test`] as never[]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [u!.id, f.bau, await rolleId('admin')]);

    await alsLeitung(a, async (k) => {
      expect(await securityGebucht(k)).toBe(true);
    });
    await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: u!.id, portal: 'intern', readonly: false },
      async (tx) => {
        expect(await securityGebucht(kontextAus(tx, f.bau, u!.id))).toBe(false);
      },
    );
  });
});

describe('Qualitaetspruefung — der Anker eines Befundes (OPS-11)', () => {
  it('ein Revierraum aus einem FREMDEN Revier wird abgewiesen', async () => {
    await alsLeitung(a, async (k) => {
      await expect(erfassePruefung(k, {
        objektId: a.objekt, revierId: a.revier, kundeId: a.kunde,
        pruefverfahrenId: a.verfahren,
        positionen: [{
          kriterium: 'Boden', ergebnis: 'io', revierRaumId: a.revierRaumFremd,
        }],
      })).rejects.toThrow(RaumPasstNicht);
    });
  });

  it('ein Revier aus einem FREMDEN Objekt wird abgewiesen — `qp_revier_fk` kennt das Haus nicht', async () => {
    /*
     * Derselbe Defekt wie beim Revierraum, eine Ebene hoeher. Der
     * Fremdschluessel lautet
     * `FOREIGN KEY (mandant_id, revier_id) REFERENCES revier(mandant_id, id)`
     * — er haelt die Gesellschaft und sonst nichts. Ohne die Pruefung im
     * Dienst wird ein Protokoll mit Objekt A und Revier B still gespeichert
     * und danach als „Objekt A / Revier B" angezeigt: eine Zeile, die es so
     * nie gab, und ein Mangel, der am falschen Haus steht.
     */
    const [o2] = await sql.unsafe<{ id: string }[]>(
      `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
       values ($1,$2,$3,'Zweithaus','Teststr. 2','10179','Berlin') returning id`,
      [a.mandant, a.kunde, `O-${zufall()}`] as never[]);
    const [rev2] = await sql.unsafe<{ id: string }[]>(
      `insert into revier (mandant_id, objekt_id, bezeichnung, kurzzeichen,
                           sollzeit_minuten, aktiv_ab, erstellt_von_art)
       values ($1,$2,$3,$4,60,'2026-01-01','system') returning id`,
      [a.mandant, o2!.id, `Zweitrevier ${zufall()}`, `ZR${zufall().slice(0, 3)}`] as never[]);

    await alsLeitung(a, async (k) => {
      await expect(erfassePruefung(k, {
        // Objekt A, Revier aus Objekt B — die Datenbank laesst das durch.
        objektId: a.objekt, revierId: rev2!.id, kundeId: a.kunde,
        pruefverfahrenId: a.verfahren,
        positionen: [{ kriterium: 'Boden', ergebnis: 'io' }],
      })).rejects.toThrow(RaumPasstNicht);
    });

    // Die Gegenprobe: dasselbe Revier an SEINEM Objekt geht durch. Ohne sie
    // bestuende die Zusage oben auch dann, wenn jedes Revier abgewiesen wuerde.
    await alsLeitung(a, async (k) => {
      const aus = await erfassePruefung(k, {
        objektId: o2!.id, revierId: rev2!.id, kundeId: a.kunde,
        pruefverfahrenId: a.verfahren,
        positionen: [{ kriterium: 'Boden', ergebnis: 'io' }],
      });
      expect(aus.nummer).not.toBe('');
    });
  });

  it('ein Revierraum OHNE Revier am Kopf wird abgewiesen — MATCH SIMPLE prueft nicht', async () => {
    await alsLeitung(a, async (k) => {
      await expect(erfassePruefung(k, {
        objektId: a.objekt, kundeId: a.kunde, pruefverfahrenId: a.verfahren,
        positionen: [{
          kriterium: 'Boden', ergebnis: 'io', revierRaumId: a.revierRaum,
        }],
      })).rejects.toThrow(/MATCH SIMPLE|Revier/u);
    });
  });

  it('erfasst eine Pruefung: Nummer, Serverzeit, Geraetezeit getrennt, kein Urteil', async () => {
    await alsLeitung(a, async (k, tx) => {
      const verfahren = await listePruefverfahren(k);
      expect(verfahren.some((v) => v.istPlatzhalter && v.maxPunkte === null)).toBe(true);

      const erg = await erfassePruefung(k, {
        objektId: a.objekt, revierId: a.revier, kundeId: a.kunde,
        pruefverfahrenId: a.verfahren, mitKunde: true,
        prueferAnstellungId: a.anstellung,
        // Die Geraeteuhr geht fuenf Minuten vor — die Abweichung muss stehen.
        geraeteZeit: new Date(Date.now() + 300_000),
        bemerkung: 'Erste Prüfung',
        positionen: [
          {
            kriterium: 'Boden', ergebnis: 'io', punkte: '5.00',
            revierRaumId: a.revierRaum, raumId: a.raum,
          },
          {
            kriterium: 'Sanitär', ergebnis: 'nio', punkte: '1.00',
            mangelBeschreibung: 'Becken nicht gereinigt', fristAm: '2026-09-01',
          },
        ],
      });
      expect(erg.nummer).toMatch(/^QP-\d{4}-\d{4}$/u);
      // Ohne Skala kein Urteil — und ausdruecklich nicht `nicht_bestanden`.
      expect(erg.bewertung).toBe('unbestimmt');

      const kopf = (await findePruefung(k, erg.id))!;
      expect(kopf.punkte).toBeNull();
      expect(kopf.maxPunkte).toBeNull();
      expect(kopf.bestanden).toBeNull();
      expect(kopf.erfuellungsgradProzent).toBeNull();
      // Invariante 5: beide Zeiten, getrennt.
      expect(kopf.geraeteZeitLokal).not.toBeNull();
      expect(kopf.zeitabweichungSek).not.toBeNull();
      expect(kopf.zeitabweichungSek!).toBeGreaterThan(250);
      expect(kopf.befunde).toBe(2);
      expect(kopf.befundeNio).toBe(1);
      expect(kopf.fristenUeberfaellig).toBe(1);
      expect(kopf.prueferName).toBe('Prüf Person');
      expect(kopf.objekt).toBe('Prüfhaus');
      expect(kopf.kunde).toBe('Prüfkunde');

      const befunde = await ladeBefunde(k, erg.id);
      expect(befunde.map((b) => b.reihenfolge)).toEqual([0, 1]);
      expect(befunde[0]!.raum).toBe('1.01 · Büro');
      // Punkte als Text — sie gehen in den Erfuellungsgrad (K-16).
      expect(befunde[0]!.punkte).toBe('5.00');
      expect(befunde[1]!.fristUeberfaellig).toBe(true);

      /* `revier_id` steht auf der Position — sonst waere der zusammengesetzte
         Fremdschluessel ungeprueft. Der Ausloeser `qpp_kopf_denormalisieren`
         setzt es aus dem Kopf; der Dienst schickt es mit. */
      const [pos] = await tx.unsafe<{ revier_id: string | null }[]>(
        `select revier_id from qualitaetspruefung_position
          where qualitaetspruefung_id = $1 order by reihenfolge limit 1`, [erg.id]);
      expect(pos!.revier_id).toBe(a.revier);

      // Die EINZELNEN Punkte bleiben — es geht nichts verloren, wenn die
      // Skala kommt.
      const [summe] = await tx.unsafe<{ s: string }[]>(
        `select sum(punkte)::text as s from qualitaetspruefung_position
          where qualitaetspruefung_id = $1`, [erg.id]);
      expect(summe!.s).toBe('6.00');
    });
  });

  it('liest, filtert und schneidet das Zeitfenster', async () => {
    await alsLeitung(a, async (k) => {
      await erfassePruefung(k, {
        objektId: a.objekt, revierId: a.revier, kundeId: a.kunde,
        pruefverfahrenId: a.verfahren,
        positionen: [{
          kriterium: 'Sanitär', ergebnis: 'nio',
          mangelBeschreibung: 'Becken nicht gereinigt',
        }],
      });
      expect(await listePruefungen(k)).toHaveLength(1);
      expect(await listePruefungen(k, { nurMitMangel: true })).toHaveLength(1);
      expect(await listePruefungen(k, { objektId: a.objekt })).toHaveLength(1);
      // Ein Fenster in der Vergangenheit schneidet die Pruefung von heute weg.
      expect(await listePruefungen(k, { von: '2020-01-01', bis: '2020-01-02' }))
        .toHaveLength(0);

      const auswahl = await ladePruefungAuswahl(k);
      expect(auswahl.verfahren.length).toBeGreaterThanOrEqual(1);
      expect(auswahl.revierRaeume.length).toBeGreaterThanOrEqual(2);
      // Der Pruefer ist die EIGENE Anstellung, nie eine Liste.
      expect(auswahl.eigeneAnstellung?.id).toBe(a.anstellung);
    });
  });

  it('eine Pruefung kennt keine harte Loeschung (Invariante 8)', async () => {
    const id = await alsLeitung(a, async (k) => (await erfassePruefung(k, {
      objektId: a.objekt, kundeId: a.kunde, pruefverfahrenId: a.verfahren,
      positionen: [{ kriterium: 'Boden', ergebnis: 'io' }],
    })).id);
    await expect(sql.unsafe(`delete from qualitaetspruefung where id = $1`, [id]))
      .rejects.toThrow();
  });
});

describe('Turnus und Modulkoepfe — „nicht geprueft" ist nicht „nichts offen"', () => {
  it('liest Turnusse mit Serie, Einsatzzahl und den Fremdrechten', async () => {
    await alsLeitung(a, async (k) => {
      const { zeilen, geprueft } = await listeTurnusse(k);
      const t = zeilen.find((z) => z.id === a.turnus)!;
      expect(t.bezeichnung).toBe('Unterhalt früh');
      expect(geprueft['dienstplan.lesen']).toBe(true);
      expect(geprueft['objekt.lesen']).toBe(true);
      expect(geprueft['katalog.lesen']).toBe(true);
      expect(t.generiertBis).toBe('2026-01-01');
      // 0 heisst „geprueft und keine da"; `null` hiesse „nicht geprueft".
      expect(t.einsaetze).toBe(0);
      expect(t.leistung).toBe('Glasreinigung');
      expect(t.objekt).toBe('Prüfhaus');
      expect(t.planungsserieId).not.toBeNull();

      // Dieselbe Serie aus dem Dienstplanblick — EINE Quelle fuer beide Seiten.
      expect((await listeSerien(k)).some((s) => s.generiert_bis === '2026-01-01'))
        .toBe(true);
    });
  });

  it('ohne `dienstplan.lesen` heisst die leere Serie „nicht geprueft", nicht „keine Serie"', async () => {
    /*
     * Der Fehlalarm zur Fehlentwarnung. `planungsserie` liegt hinter
     * `dienstplan.lesen` (pg_policies: t_mandant); ohne das Recht liefert der
     * LEFT JOIN still NULL. Wer daraus „keine Serie — der Generator hat
     * diesen Turnus noch nie gesehen" macht, behauptet das ueber JEDEN
     * Turnus, obwohl hier eine Serie steht.
     *
     * Erreichbar ueber `benutzer_mandant.module` (AUT-01): die
     * Modulbeschraenkung ist eine SCHNITTMENGE in `app.hat_recht_fuer`
     * (`split_part(p_schluessel, '.', 1) = any (bm.module)`). Eine
     * Reinigungsleitung mit `module = {reinigung,objekt,katalog}` haelt
     * `reinigung.lesen`, aber nicht `dienstplan.lesen`.
     */
    await sql.unsafe(
      `update benutzer_mandant set module = array['reinigung','objekt','katalog']
        where benutzer_id = $1 and mandant_id = $2`,
      [a.leitung, a.mandant] as never[]);

    await alsLeitung(a, async (k) => {
      const { zeilen, geprueft } = await listeTurnusse(k);
      expect(geprueft['dienstplan.lesen']).toBe(false);
      const t = zeilen.find((z) => z.id === a.turnus)!;
      // Der Turnus selbst ist da — `turnus` liegt hinter `reinigung.lesen`.
      expect(t.bezeichnung).toBe('Unterhalt früh');
      // Und JEDE Angabe aus der Planung steht auf „nicht geprueft".
      expect(t.serieGeprueft).toBe(false);
      expect(t.planungsserieId).toBeNull();
      expect(t.generiertBis).toBeNull();
      expect(t.einsaetze).toBeNull();

      const kopf = await ladeReinigungKopf(k, STICHTAG);
      expect(kopf.stehendeSerien).toBeNull();
      // Die Kachel „Ohne Serie" darf hier NICHT jeden Turnus zaehlen.
      expect(kopf.ohneSerie).toBeNull();
    });

    // Zurueck auf unbeschraenkt — die Fixtur steht fuer die naechste Zusage.
    await sql.unsafe(
      `update benutzer_mandant set module = null
        where benutzer_id = $1 and mandant_id = $2`,
      [a.leitung, a.mandant] as never[]);
  });

  it('legt eine Ausnahme an; `abrechnungsrelevant` bleibt OFFEN (O-700)', async () => {
    await alsLeitung(a, async (k) => {
      await legeAusnahmeAn(k, {
        turnusId: a.turnus, datum: '2026-02-04', art: 'verschiebung',
        ersatzBeginn: '08:00', dauerMinuten: 180, grund: 'Zugang erst später',
      });
      const ausnahmen = await ladeAusnahmen(k, a.turnus);
      expect(ausnahmen).toHaveLength(1);
      expect(ausnahmen[0]!.ersatzBeginnLokal).toBe('2026-02-04T08:00');
      // NULL heisst UNBEANTWORTET und nicht „nein": ob ein Ausfall vom
      // Pauschalbetrag abgeht, steht im Vertrag.
      expect(ausnahmen[0]!.abrechnungsrelevant).toBeNull();

      // Eine Verschiebung ohne Ersatzbeginn laesst die Tabelle nicht zu.
      await expect(legeAusnahmeAn(k, {
        turnusId: a.turnus, datum: '2026-02-11', art: 'verschiebung',
        grund: 'ohne Zeit',
      })).rejects.toThrow(/Ersatzbeginn/u);
    });
  });

  it('die Vorschau laeuft ueber ECHTE Feiertage und rechnet die Ausnahme ein', async () => {
    await alsLeitung(a, async (k) => {
      await legeAusnahmeAn(k, {
        turnusId: a.turnus, datum: '2026-02-04', art: 'verschiebung',
        ersatzBeginn: '08:00', dauerMinuten: 180, grund: 'Zugang erst später',
      });
      const { blatt } = await findeTurnus(k, a.turnus);
      expect(blatt).not.toBeNull();
      const vorschau = await ladeVorschau(k, blatt!, {
        vonDatum: '2026-02-02', bisDatum: '2026-02-08',
      });
      expect(vorschau.bundesland).toBe('BE');
      const verschoben = vorschau.termine.find((t) => t.planDatum === '2026-02-04')!;
      expect(verschoben.beginnLokal).toBe('08:00');
      expect(verschoben.dauerNominal).toBe(180);
      expect(verschoben.art).toBe('verschiebung');
      expect(await ladeTurnusEinsaetze(k, a.turnus)).toHaveLength(0);
    });
  });

  it('der Reinigungskopf meldet die stehengebliebene Serie und sagt, was geprueft ist', async () => {
    await alsLeitung(a, async (k) => {
      const kopf = await ladeReinigungKopf(k, STICHTAG);
      expect(kopf.reviere).toBeGreaterThanOrEqual(2);
      // `generiert_bis` (2026-01-01) liegt vor dem Stichtag → Generator steht.
      expect(kopf.stehendeSerien).not.toBeNull();
      expect(kopf.stehendeSerien!.some((t) => t.id === a.turnus)).toBe(true);
      // Geprueft und leer — `null` waere „nicht geprueft".
      expect(kopf.offeneNachweise).not.toBeNull();
      expect(kopf.schichtenHeute).not.toBeNull();
    });
  });

  it('der Securitykopf liest Posten, Nachweise und Wachbuch (Art `vorkommnis`)', async () => {
    await alsLeitung(a, async (k) => {
      const kopf = await ladeSecurityKopf(
        k, STICHTAG, { von: STICHTAG, bis: '2026-10-16' }, '2026-09-12',
      );
      expect(kopf.posten).not.toBeNull();
      expect(kopf.luecken).not.toBeNull();
      expect(kopf.nachweise).not.toBeNull();
      /*
       * Die Art heisst `vorkommnis` und nicht `vorfall`: `wachbuch_art` hat
       * genau fuenf Werte, und ein Filter auf einen sechsten waere
       * `22P02 invalid input value for enum` — hier faellt es auf, nicht im
       * Betrieb.
       */
      expect(kopf.vorkommnisse).not.toBeNull();
    });
  });

  it('das Veranstaltungsblatt rechnet die Dauer aus INSTANTS und nennt den Stichtag', async () => {
    await alsLeitung(a, async (k) => {
      const blatt = (await findeVeranstaltung(k, a.veranstaltung))!;
      expect(blatt.kopf.bezeichnung).toBe('Sommerfest');
      expect(blatt.kopf.beginnLokal).toContain('10.07.2026 18:00');
      // 18:00 bis 02:00 des Folgetages = acht Stunden, als Instantdifferenz.
      expect(blatt.kopf.dauerMinuten).toBe(480);
      // Der Stichtag der Nachweislage ist der Tag der VERANSTALTUNG.
      expect(blatt.stichtag).toBe('2026-07-10');
      expect(blatt.kopf.leitung).toBe('Prüf Person');
      expect(blatt.kopf.kunde).toBe('Prüfkunde');
      expect(blatt.kopf.hatObjekt).toBe(true);
      // Geprueft, und es gibt keine Schicht — nicht „nicht geprueft".
      expect(blatt.schichten).not.toBeNull();
      expect(blatt.schichten).toHaveLength(0);
    });
  });

  it('eine fremde Kennung ist NICHT VORHANDEN, nicht verboten (AUT-06)', async () => {
    await alsLeitung(a, async (k) => {
      const fremd = '11111111-1111-4111-8111-111111111111';
      expect((await findeTurnus(k, fremd)).blatt).toBeNull();
      expect(await findePruefung(k, fremd)).toBeNull();
      expect(await findeVeranstaltung(k, fremd)).toBeNull();
    });
  });
});
