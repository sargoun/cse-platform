/**
 * Abwesenheiten und Anträge gegen eine echte Datenbank — PR 38 (EMP-10,
 * EMP-05, TIM-05, LEG-09, Art. 9 DSGVO).
 *
 * Der Kern dieser Datei ist nicht, dass ein Urlaubsantrag funktioniert. Er
 * ist, dass die PLANUNG von einer Krankmeldung genau eine Sache erfährt —
 * „nicht verfügbar" — und die Diagnosefrage gar nicht erst stellen kann.
 *
 * (1) Ein genehmigter Antrag schreibt die Abwesenheit, bucht das Urlaubskonto
 *     und macht die betroffenen Schichten auffindbar.
 * (2) Eine Ablehnung behält ihren Grund und BEIDE Zeitpunkte.
 * (3) Eine Krankmeldung um 05:40 für die 06:00-Schicht steht sofort in der
 *     Liste der Planung.
 * (4) Der Grund ist der Planung entzogen — als SPALTENRECHT, nicht als
 *     Auslassung in einer Abfrage — und wer ihn liest, hinterlässt eine
 *     Auditzeile.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  leseGrund, listeAbwesenheiten, meldeAbwesenheit, storniereAbwesenheit,
  unverfuegbarImFenster, ArtUngeklaertFehler,
} from '../../src/server/services/abwesenheit/index.js';
import {
  entscheideAntrag, listeOffeneAntraege, pflichtfeldGrund, reicheAntragEin, zieheAntragZurueck,
  AntragNichtGefunden, KommentarFehlt, UrlaubskontoFehlt,
} from '../../src/server/services/abwesenheit/antrag.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';

let f: Fixtur;
let chef = '';      // leitung — plant, genehmigt, sieht KEINEN Grund
let personal = '';  // admin — sieht den Grund
let jonasKonto = ''; // der Mensch selbst — stellt seine Antraege (EMP-10)

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(praefix: string, personId: string | null = null): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, person_id, status)
     values ($1,$2,$2,$3,'aktiv')`, [u!.id, email, personId]);
  return u!.id;
}

/**
 * Die Sitzung des Menschen selbst — `portal: 'mitarbeiter'` und mit
 * `personId`, denn `app.aktuelle_person()` ist die Bedingung, an der sein
 * Schreibweg haengt (EMP-10). Ohne sie faellt die Policy zu, und zwar
 * richtigerweise.
 */
function alsMensch<T>(
  benutzerId: string, personId: string, mandant: string,
  fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, benutzerId, personId,
      portal: 'mitarbeiter', readonly: false },
    async (tx) => {
      const abfrage = async <R,>(s2: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s2, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal: 'mitarbeiter', benutzerId,
        aktiverMandantId: mandant, mandantIds: [mandant],
        abfrage, schreibe: abfrage,
      });
    },
  );
}

function alsRolle<T>(
  benutzerId: string, mandant: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, benutzerId, portal: 'intern', readonly: false },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId,
        aktiverMandantId: mandant, mandantIds: [mandant],
        abfrage, schreibe: abfrage,
      });
    },
  );
}

/** Die Art aus dem mitgelieferten Katalog — mit beantworteter Lohnfrage. */
async function art(schluessel: string, bezahlt = true): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `update abwesenheitsart set bezahlt = $2 where schluessel = $1 and mandant_id is null
     returning id`, [schluessel, bezahlt]);
  return a!.id;
}

async function antragsart(schluessel: string): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `select id from antragsart where schluessel = $1 and mandant_id is null`, [schluessel]);
  return a!.id;
}

beforeEach(async () => {
  f = await seed();
  chef = await konto('planung');
  personal = await konto('personal');
  jonasKonto = await konto('jonas', f.jonas);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [chef, f.reinigung, await rolleId('leitung')]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [personal, f.reinigung, await rolleId('admin')]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [jonasKonto, f.reinigung, await rolleId('mitarbeiter')]);
});
afterAll(schliessen);

describe('(1) Ein genehmigter Antrag schreibt die Abwesenheit', () => {
  it('mit gerechneten Tagen, gebuchtem Urlaubskonto und sichtbarem Zeitraum', async () => {
    const urlaub = await art('urlaub');
    // Der Anspruch steht, BEVOR genehmigt wird (O-18).
    await sql.unsafe(
      `insert into urlaubskonto (mandant_id, anstellung_id, jahr, anspruch_tage)
       values ($1, $2, 2029, 30)`, [f.reinigung, f.jonasReinigung]);

    const urlaubsart = await antragsart('urlaub');
    const antrag = await alsMensch(jonasKonto, f.jonas, f.reinigung, (k) =>
      reicheAntragEin(k, {
        anstellungId: f.jonasReinigung,
        antragsartId: urlaubsart,
        vonDatum: '2029-07-16', bisDatum: '2029-07-20',
        abwesenheitsartId: urlaub,
        nachricht: 'Sommerurlaub',
      }));
    expect(antrag.status).toBe('eingereicht');

    const ergebnis = await alsRolle(chef, f.reinigung, (k) =>
      entscheideAntrag(k, { antragId: antrag.id, entscheidung: 'genehmigt' }));

    // Mo–Fr, keine Feiertage: fünf Tage.
    expect(ergebnis.tageAngerechnet).toBe('5.000');
    expect(ergebnis.abwesenheitId).not.toBeNull();

    const [ab] = await sql.unsafe<{ status: string; tage: string; antrag: string }[]>(
      `select status::text as status, tage_angerechnet::text as tage, antrag_id as antrag
         from abwesenheit where id = $1`, [ergebnis.abwesenheitId!]);
    expect(ab?.status).toBe('genehmigt');
    expect(ab?.tage).toBe('5.000');
    expect(ab?.antrag).toBe(antrag.id);

    // Das Urlaubskonto ist gebucht — und zwar vom Auslöser, nicht von Hand.
    const [konto] = await sql.unsafe<{ genommen: string; rest: string }[]>(
      `select genommen_tage::text as genommen, rest_tage::text as rest
         from urlaubskonto where anstellung_id = $1 and jahr = 2029`,
      [f.jonasReinigung]);
    expect(konto?.genommen).toBe('5.000');
    expect(konto?.rest).toBe('25.000');

    // Und die Planung findet den Zeitraum — das ist die Grundlage dafür, dass
    // der Dienstplan die betroffenen Schichten kennzeichnet (TIM-05).
    const fenster = await alsRolle(chef, f.reinigung, (k) =>
      unverfuegbarImFenster(k, '2029-07-13', '2029-07-19'));
    expect(fenster.map((u) => u.anstellungId)).toContain(f.jonasReinigung);
  });

  it('ohne hinterlegten Urlaubsanspruch wird NICHT genehmigt (O-18)', async () => {
    const urlaub = await art('urlaub');
    const artId = await antragsart('urlaub');
    const antrag = await alsMensch(jonasKonto, f.jonas, f.reinigung, (k) =>
      reicheAntragEin(k, {
        anstellungId: f.jonasReinigung, antragsartId: artId,
        vonDatum: '2029-08-06', bisDatum: '2029-08-07', abwesenheitsartId: urlaub,
      }));

    await expect(alsRolle(chef, f.reinigung, (k) =>
      entscheideAntrag(k, { antragId: antrag.id, entscheidung: 'genehmigt' })))
      .rejects.toBeInstanceOf(UrlaubskontoFehlt);

    const [anzahl] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from abwesenheit where antrag_id = $1`, [antrag.id]);
    expect(Number(anzahl?.n ?? '1'), 'kein halber Vorgang').toBe(0);
  });

  it('eine Art mit ungeklärter Lohnfrage wird verweigert (O-139)', async () => {
    // `fortbildung` wird hier bewusst NICHT beantwortet — so wird die
    // Plattform ausgeliefert.
    const [roh] = await sql.unsafe<{ id: string }[]>(
      `select id from abwesenheitsart where schluessel = 'fortbildung' and mandant_id is null`);
    const offen = roh!.id;

    await expect(alsRolle(chef, f.reinigung, (k) =>
      meldeAbwesenheit(k, {
        anstellungId: f.jonasReinigung, abwesenheitsartId: offen,
        von: '2029-09-03', bis: '2029-09-03',
      }))).rejects.toBeInstanceOf(ArtUngeklaertFehler);
  });
});

describe('(2) Eine Ablehnung behält ihren Grund und beide Zeitpunkte', () => {
  it('und ohne Grund gibt es keine Ablehnung', async () => {
    const urlaub = await art('urlaub');
    const artId = await antragsart('urlaub');
    const antrag = await alsMensch(jonasKonto, f.jonas, f.reinigung, (k) =>
      reicheAntragEin(k, {
        anstellungId: f.jonasReinigung, antragsartId: artId,
        vonDatum: '2029-12-24', bisDatum: '2029-12-24', abwesenheitsartId: urlaub,
      }));

    await expect(alsRolle(chef, f.reinigung, (k) =>
      entscheideAntrag(k, { antragId: antrag.id, entscheidung: 'abgelehnt', kommentar: '  ' })))
      .rejects.toBeInstanceOf(KommentarFehlt);

    await alsRolle(chef, f.reinigung, (k) =>
      entscheideAntrag(k, {
        antragId: antrag.id, entscheidung: 'abgelehnt',
        kommentar: 'Heiligabend ist bereits dreifach besetzt.',
      }));

    const [z] = await sql.unsafe<{
      status: string; kommentar: string; eingereicht: Date; entschieden: Date;
    }[]>(
      `select status::text as status, entscheidung_kommentar as kommentar,
              eingereicht_am as eingereicht, entschieden_am as entschieden
         from antrag where id = $1`, [antrag.id]);
    expect(z?.status).toBe('abgelehnt');
    expect(z?.kommentar).toContain('dreifach besetzt');
    // BEIDE Zeitpunkte — der Antrag ist ein Vorgang mit Anfang und Ende.
    expect(z?.eingereicht).toBeInstanceOf(Date);
    expect(z?.entschieden).toBeInstanceOf(Date);
    expect(z!.entschieden.getTime()).toBeGreaterThanOrEqual(z!.eingereicht.getTime());

    // Und es entsteht keine Abwesenheit.
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from abwesenheit where antrag_id = $1`, [antrag.id]);
    expect(Number(n?.n ?? '1')).toBe(0);
  });

  it('ein entschiedener Antrag lässt sich nicht mehr zurückziehen', async () => {
    const urlaub = await art('urlaub');
    const artId = await antragsart('urlaub');
    const antrag = await alsMensch(jonasKonto, f.jonas, f.reinigung, (k) =>
      reicheAntragEin(k, {
        anstellungId: f.jonasReinigung, antragsartId: artId,
        vonDatum: '2029-11-05', bisDatum: '2029-11-05', abwesenheitsartId: urlaub,
      }));
    await alsRolle(chef, f.reinigung, (k) =>
      entscheideAntrag(k, {
        antragId: antrag.id, entscheidung: 'abgelehnt', kommentar: 'Besetzung reicht nicht.',
      }));

    await expect(alsMensch(jonasKonto, f.jonas, f.reinigung, (k) => zieheAntragZurueck(k, antrag.id)))
      .rejects.toThrow();
  });
});

describe('(2a) Ein zweiter Klick auf „Genehmigen" ist „schon entschieden" — kein Serverfehler (D-753)', () => {
  it('die zweite Genehmigung wirft AntragNichtGefunden mit Grund, und es bleibt EINE Abwesenheit', async () => {
    const urlaub = await art('urlaub');
    await sql.unsafe(
      `insert into urlaubskonto (mandant_id, anstellung_id, jahr, anspruch_tage)
       values ($1, $2, 2029, 30)`, [f.reinigung, f.jonasReinigung]);
    const artId = await antragsart('urlaub');
    const antrag = await alsMensch(jonasKonto, f.jonas, f.reinigung, (k) =>
      reicheAntragEin(k, {
        anstellungId: f.jonasReinigung, antragsartId: artId,
        vonDatum: '2029-10-08', bisDatum: '2029-10-09', abwesenheitsartId: urlaub,
      }));
    await alsRolle(chef, f.reinigung, (k) =>
      entscheideAntrag(k, { antragId: antrag.id, entscheidung: 'genehmigt' }));

    /*
     * Vorher stand vor dem Update, das den Stand prüft, das INSERT der
     * Abwesenheit — und das traf die Sperre `ab_keine_dublette` (23P01):
     * eine 500 statt des Satzes. Jetzt fällt die Entscheidung am Stand.
     */
    const zweite = alsRolle(chef, f.reinigung, (k) =>
      entscheideAntrag(k, { antragId: antrag.id, entscheidung: 'genehmigt' }));
    await expect(zweite).rejects.toBeInstanceOf(AntragNichtGefunden);
    await expect(zweite).rejects.toMatchObject({ grund: 'nicht_gefunden', status: 404 });

    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from abwesenheit where antrag_id = $1`, [antrag.id]);
    expect(Number(n?.n ?? '0'), 'genau eine Abwesenheit').toBe(1);
  });

  it('eine Ablehnung nach der Genehmigung ändert nichts', async () => {
    const urlaub = await art('urlaub');
    await sql.unsafe(
      `insert into urlaubskonto (mandant_id, anstellung_id, jahr, anspruch_tage)
       values ($1, $2, 2029, 30)`, [f.reinigung, f.jonasReinigung]);
    const artId = await antragsart('urlaub');
    const antrag = await alsMensch(jonasKonto, f.jonas, f.reinigung, (k) =>
      reicheAntragEin(k, {
        anstellungId: f.jonasReinigung, antragsartId: artId,
        vonDatum: '2029-10-15', bisDatum: '2029-10-15', abwesenheitsartId: urlaub,
      }));
    await alsRolle(chef, f.reinigung, (k) =>
      entscheideAntrag(k, { antragId: antrag.id, entscheidung: 'genehmigt' }));
    await expect(alsRolle(chef, f.reinigung, (k) =>
      entscheideAntrag(k, { antragId: antrag.id, entscheidung: 'abgelehnt', kommentar: 'zu spät' })))
      .rejects.toBeInstanceOf(AntragNichtGefunden);

    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from antrag where id = $1`, [antrag.id]);
    expect(z?.status).toBe('genehmigt');
  });
});

describe('(2b) Was der Auslöser abweist, wird ein Grund — am echten Fehler (V-198, D-692 Nr. 4)', () => {
  /*
   * `pflichtfeldGrund` war nur an nachgebauten Objekten geprüft
   * (`Object.assign(new Error('x'), { code: '23514', hint })`). Ob der ECHTE
   * postgres.js-Fehler des Auslösers `antrag_pflichtfelder` und der Prüfung
   * `an_zeitraum` diese Felder so trägt und den Dienst so verlässt, prüft nur
   * die Datenbank.
   */
  async function abgewiesen(eingabe: Parameters<typeof reicheAntragEin>[1]): Promise<unknown> {
    try {
      await alsMensch(jonasKonto, f.jonas, f.reinigung, (k) => reicheAntragEin(k, eingabe));
    } catch (fehler) {
      return fehler;
    }
    throw new Error('der Antrag hätte abgewiesen werden müssen');
  }

  it('Urlaubsantrag ohne Datum → `fehlt_zeitraum`', async () => {
    const urlaub = await art('urlaub');
    const fehler = await abgewiesen({
      anstellungId: f.jonasReinigung, antragsartId: await antragsart('urlaub'),
      abwesenheitsartId: urlaub,
    });
    expect(pflichtfeldGrund(fehler)).toBe('fehlt_zeitraum');
  });

  it('Urlaubsantrag ohne Abwesenheitsart → `fehlt_abwesenheitsart`', async () => {
    const fehler = await abgewiesen({
      anstellungId: f.jonasReinigung, antragsartId: await antragsart('urlaub'),
      vonDatum: '2029-06-04', bisDatum: '2029-06-05',
    });
    expect(pflichtfeldGrund(fehler)).toBe('fehlt_abwesenheitsart');
  });

  it('„bis" vor „von" → `zeitraum` (die Prüfung an_zeitraum)', async () => {
    const urlaub = await art('urlaub');
    const fehler = await abgewiesen({
      anstellungId: f.jonasReinigung, antragsartId: await antragsart('urlaub'),
      vonDatum: '2029-06-10', bisDatum: '2029-06-03', abwesenheitsartId: urlaub,
    });
    expect(pflichtfeldGrund(fehler)).toBe('zeitraum');
  });
});

describe('(3) Die Krankmeldung um 05:40 erreicht die Planung sofort', () => {
  it('steht in der Liste des Tages, ohne dass jemand sie genehmigt', async () => {
    const krank = await art('krankheit');
    const [heute] = await sql.unsafe<{ tag: string }[]>(
      `select to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD') as tag`);

    const gemeldet = await alsRolle(chef, f.reinigung, (k) =>
      meldeAbwesenheit(k, {
        anstellungId: f.jonasReinigung, abwesenheitsartId: krank,
        von: heute!.tag, bis: heute!.tag,
        bemerkung: 'Telefonisch um 05:40 gemeldet.',
      }));
    // `erfasst`, nicht `beantragt`: eine Krankmeldung wird zur Kenntnis
    // genommen, nicht genehmigt.
    expect(gemeldet.status).toBe('erfasst');

    const fenster = await alsRolle(chef, f.reinigung, (k) =>
      unverfuegbarImFenster(k, heute!.tag, heute!.tag));
    expect(fenster.map((u) => u.anstellungId)).toContain(f.jonasReinigung);

    // Die Serveruhr bestimmt den Meldezeitpunkt — er ist die Frist, an der
    // „unverzüglich" gemessen wird (§ 5 EntgFG).
    const [z] = await sql.unsafe<{ gemeldet: Date }[]>(
      `select gemeldet_am as gemeldet from abwesenheit where id = $1`, [gemeldet.id]);
    expect(Math.abs(Date.now() - z!.gemeldet.getTime())).toBeLessThan(60_000);
  });

  it('und eine falsche Meldung wird storniert, nicht gelöscht', async () => {
    const krank = await art('krankheit');
    const gemeldet = await alsRolle(chef, f.reinigung, (k) =>
      meldeAbwesenheit(k, {
        anstellungId: f.jonasReinigung, abwesenheitsartId: krank,
        von: '2029-10-01', bis: '2029-10-01',
      }));
    await alsRolle(chef, f.reinigung, (k) =>
      storniereAbwesenheit(k, gemeldet.id, 'Verwechslung — die Meldung galt einer anderen Person.'));

    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from abwesenheit where id = $1`, [gemeldet.id]);
    expect(z?.status).toBe('storniert');

    const offen = await alsRolle(chef, f.reinigung, (k) =>
      unverfuegbarImFenster(k, '2029-10-01', '2029-10-01'));
    expect(offen.map((u) => u.anstellungId)).not.toContain(f.jonasReinigung);
  });
});

describe('(4) Der Grund ist der Planung entzogen — Art. 9 DSGVO', () => {
  it('die Antwort an den Dienstplan trägt Feld für Feld keinen Grund', async () => {
    const krank = await art('krankheit');
    await alsRolle(chef, f.reinigung, (k) =>
      meldeAbwesenheit(k, {
        anstellungId: f.jonasReinigung, abwesenheitsartId: krank,
        von: '2029-06-04', bis: '2029-06-05', auBescheinigungVorliegt: true,
        bemerkung: 'AU liegt vor.',
      }));

    const fenster = await alsRolle(chef, f.reinigung, (k) =>
      unverfuegbarImFenster(k, '2029-06-01', '2029-06-07'));
    expect(fenster.length).toBe(1);
    /**
     * Feld für Feld, nicht „enthält nicht das Wort krank": die Zusage ist die
     * SIGNATUR. Ein späterer Zusatz, der die Art mitschickt, fällt hier auf
     * und nicht erst in einem Datenschutzvorfall.
     */
    expect(Object.keys(fenster[0]!).sort())
      .toEqual(['anstellungId', 'bis', 'personName', 'status', 'von']);
  });

  it('und die Planung kann die Spalten gar nicht lesen — ein Spaltenrecht, keine Auslassung',
    async () => {
      await expect(alsRolle(chef, f.reinigung, (k) =>
        k.abfrage(`select abwesenheitsart_id from abwesenheit limit 1`)))
        .rejects.toThrow(/permission denied|keine Berechtigung/u);
      await expect(alsRolle(chef, f.reinigung, (k) =>
        k.abfrage(`select bemerkung from abwesenheit limit 1`)))
        .rejects.toThrow(/permission denied|keine Berechtigung/u);
    });

  it('die Personalstelle liest ihn — über die Definer-Funktion, mit Auditzeile', async () => {
    const krank = await art('krankheit');
    const gemeldet = await alsRolle(personal, f.reinigung, (k) =>
      meldeAbwesenheit(k, {
        anstellungId: f.jonasReinigung, abwesenheitsartId: krank,
        von: '2029-06-11', bis: '2029-06-12', auBescheinigungVorliegt: true,
        auBis: '2029-06-12', bemerkung: 'AU vorgelegt.',
      }));

    const grund = await alsRolle(personal, f.reinigung, (k) => leseGrund(k, gemeldet.id));
    expect(grund?.abwesenheitsart).toBe('Krankheit');
    expect(grund?.istGesundheitsbezogen).toBe(true);
    expect(grund?.auBescheinigungVorliegt).toBe(true);

    const [audit] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'personal.abwesenheitsgrund_gelesen'`);
    expect(Number(audit?.n ?? '0'),
      'jeder Zugriff auf ein Gesundheitsdatum ist belegt').toBeGreaterThan(0);
  });

  it('der Planung verweigert dieselbe Funktion die Antwort', async () => {
    const krank = await art('krankheit');
    const gemeldet = await alsRolle(personal, f.reinigung, (k) =>
      meldeAbwesenheit(k, {
        anstellungId: f.jonasReinigung, abwesenheitsartId: krank,
        von: '2029-06-18', bis: '2029-06-18',
      }));

    await expect(alsRolle(chef, f.reinigung, (k) => leseGrund(k, gemeldet.id)))
      .rejects.toThrow(/nicht berechtigt/u);
  });
});

describe('Der Posteingang der Planung', () => {
  it('zeigt offene Anträge, das Älteste oben', async () => {
    const urlaub = await art('urlaub');
    const artId = await antragsart('urlaub');
    const erste = await alsMensch(jonasKonto, f.jonas, f.reinigung, (k) =>
      reicheAntragEin(k, {
        anstellungId: f.jonasReinigung, antragsartId: artId,
        vonDatum: '2029-03-05', bisDatum: '2029-03-06', abwesenheitsartId: urlaub,
      }));
    const zweite = await alsMensch(jonasKonto, f.jonas, f.reinigung, (k) =>
      reicheAntragEin(k, {
        anstellungId: f.jonasReinigung, antragsartId: artId,
        vonDatum: '2029-04-02', bisDatum: '2029-04-03', abwesenheitsartId: urlaub,
      }));

    const offen = await alsRolle(chef, f.reinigung, (k) => listeOffeneAntraege(k));
    expect(offen.map((a) => a.id)).toEqual([erste.id, zweite.id]);
    expect(offen[0]?.personName.length).toBeGreaterThan(0);

    const meine = await alsRolle(chef, f.reinigung, (k) =>
      listeAbwesenheiten(k, { status: ['erfasst'] }));
    expect(meine).toEqual([]);
  });
});
