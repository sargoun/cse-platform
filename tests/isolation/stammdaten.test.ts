/**
 * Die Stammdatenpflege gegen echtes Postgres: Policies, Ausloeser,
 * Spaltenrechte (OPS-02, OPS-03, SEC-01, EMP-05, EMP-10; K-17, K-05,
 * Invariante 8; 0275–0278).
 *
 * **Warum diese Datei hier steht und nicht in `tests/kern`.** Jede Zusage der
 * fuenf Pflegeseiten wird von der DATENBANK gehalten, nicht von TypeScript:
 * dass ein Mandanten-Admin den Plattformkatalog nicht aendert
 * (`t_katalog_pflege` gegen `t_plattform_aendern`, 0275), dass derselbe
 * Schluessel nicht auf beiden Katalogstufen aktiv sein kann
 * (`kern.katalog_schluessel_frei`, 0276), dass eine Systemantragsart fuer
 * jeden fest ist, dass `bezahlt` nicht auf „ungeklaert" zurueckfaellt
 * (`kern.abwesenheitsart_schutz`), dass nichts geloescht wird
 * (`kern.verhindere_loeschung`) und dass ein Leistungswert je Stichtag genau
 * eine Antwort hat (`belagsart_zeitraum_eindeutig`). Ein Ausloeser ohne Test
 * ist eine Behauptung.
 *
 * Gelaufen wird als `cse_app` — nie als Eigentuemer: ein Eigentuemer ohne
 * FORCE umgeht seine eigenen Policies, und jede Zusicherung hier ginge aus dem
 * falschen Grund durch.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  ladeAbwesenheitsarten, legeAbwesenheitsartAn, aendereAbwesenheitsart,
  archiviereAbwesenheitsart, pruefeArtEingabe,
} from '../../src/server/services/stammdaten/abwesenheitsart.js';
import {
  ladeAntragsarten, legeAntragsartAn, aendereAntragsart, archiviereAntragsart,
} from '../../src/server/services/stammdaten/antragsart.js';
import {
  ladeReinigungsklassen, legeReinigungsklasseAn, aendereReinigungsklasse,
  archiviereReinigungsklasse,
} from '../../src/server/services/stammdaten/reinigungsklasse.js';
import {
  ladeBelagsarten, datiereBelagsartUm, stelleBelagsartRichtig,
} from '../../src/server/services/stammdaten/belagsart.js';
import {
  ladeQualifikationen, legeQualifikationAn, aendereQualifikation,
  archiviereQualifikation,
} from '../../src/server/services/stammdaten/qualifikation.js';

let f: Fixtur;
let admin: string;
let chef: string;
const zufall = (): string => String(Math.random()).slice(2, 8);

/** Der Schreibkontext, wie `withTenant` ihn baut — auf dieser Transaktion. */
function alsKontext(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
): SchreibKontext {
  const abfrage = async <T,>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

/** Ein Formular, wie ein `FormData`-Leser es liefert. */
const formular = (werte: Readonly<Record<string, string>>) =>
  (feld: string): string | null => werte[feld] ?? null;

async function konto(email: string, globaleRolle: string | null): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Stammdatenprobe', 'aktiv',
             (select id from rolle where schluessel = $3 and mandant_id is null))`,
    [u!.id, email, globaleRolle] as never[]);
  return u!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null))`,
    [benutzer, mandant, rolle] as never[]);
}

/** Die Sitzung des Mandanten-Admins: `stammdaten.verwalten`, kein Super-Admin. */
async function alsAdmin<T>(
  fn: (kontext: SchreibKontext, tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return alsApp({
    scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung],
    benutzerId: admin, readonly: false, portal: 'intern',
  }, async (tx) => fn(alsKontext(tx, f.reinigung, admin), tx));
}

/**
 * Die Sitzung des Super-Admins — mit `aal2`.
 *
 * `app.ist_super_admin()` verlangt die globale Rolle UND den zweiten Faktor
 * (0004). Ohne `app.aal = aal2` waere diese Sitzung hier kein Super-Admin, und
 * jeder Plattformfall ginge aus dem falschen Grund durch.
 */
async function alsChef<T>(
  fn: (kontext: SchreibKontext, tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return alsApp({
    scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung],
    benutzerId: chef, readonly: false, portal: 'intern',
  }, async (tx) => {
    await tx.unsafe(`select set_config('app.aal','aal2',true)`);
    return fn(alsKontext(tx, f.reinigung, chef), tx);
  });
}

beforeEach(async () => {
  f = await seed();
  admin = await konto(`stamm-admin-${zufall()}@cse.test`, null);
  await mitglied(admin, f.reinigung, 'admin');
  chef = await konto(`stamm-chef-${zufall()}@cse.test`, 'super_admin');
  await mitglied(chef, f.reinigung, 'admin');
});
afterAll(schliessen);

// ---------------------------------------------------------------------------
// Die Voraussetzung: wer hier was hält
// ---------------------------------------------------------------------------

describe('die beiden Sitzungen dieser Datei', () => {
  it('der Mandanten-Admin hält stammdaten.verwalten und ist kein Super-Admin', async () => {
    const befund = await alsAdmin((k) => k.abfrage<{ pflege: boolean; chef: boolean }>(
      `select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant()) as pflege,
              app.ist_super_admin() as chef`));
    expect(befund[0]?.pflege).toBe(true);
    expect(befund[0]?.chef).toBe(false);
  });

  it('der Super-Admin ist einer — aber nur mit zweitem Faktor', async () => {
    const mit = await alsChef((k) => k.abfrage<{ chef: boolean }>(
      `select app.ist_super_admin() as chef`));
    expect(mit[0]?.chef).toBe(true);

    // Dieselbe Person, aal1: `app.ist_super_admin()` ist dann falsch (0004).
    const ohne = await alsApp({
      scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung],
      benutzerId: chef, readonly: false, portal: 'intern',
    }, async (tx) => tx.unsafe<{ chef: boolean }[]>(
      `select app.ist_super_admin() as chef`));
    expect(ohne[0]?.chef).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// abwesenheitsart — zwei Stufen, drei Zustände, kein Löschen
// ---------------------------------------------------------------------------

describe('der Abwesenheitskatalog', () => {
  it('liegt plattformweit vor, und bezahlt ist bei jeder Art ungeklärt (O-139)', async () => {
    const arten = await alsAdmin((k) => ladeAbwesenheitsarten(k));
    expect(arten).toHaveLength(7);
    expect(arten.every((a) => a.istPlattform)).toBe(true);
    // NULL heisst ungeklaert und nicht „nein" — ohne Default, mit Absicht.
    expect(arten.every((a) => a.bezahlt === null)).toBe(true);
  });

  it('lässt sich vom Mandanten-Admin NICHT ändern', async () => {
    // `t_katalog_pflege` verlangt `mandant_id = app.aktiver_mandant()`; eine
    // Plattformzeile trifft das UPDATE deshalb nicht.
    await expect(alsAdmin(async (k) => {
      const urlaub = (await ladeAbwesenheitsarten(k))
        .find((a) => a.schluessel === 'urlaub')!;
      return aendereAbwesenheitsart(k, urlaub.id, pruefeArtEingabe(formular({
        schluessel: 'urlaub', bezeichnung: 'Urlaub', bezahlt: 'ja',
      }), true));
    })).rejects.toMatchObject({ name: 'StammdatenFehler', grund: 'plattform' });
  });

  it('und vom Super-Admin schon — das ist der Weg zur Antwort auf O-139', async () => {
    await alsChef(async (k) => {
      const urlaub = (await ladeAbwesenheitsarten(k))
        .find((a) => a.schluessel === 'urlaub')!;
      await aendereAbwesenheitsart(k, urlaub.id, pruefeArtEingabe(formular({
        schluessel: 'urlaub', bezeichnung: 'Urlaub', i18n_en: 'Annual leave',
        bezahlt: 'ja', zaehltAufUrlaubskonto: 'ja', lohnartSchluessel: 'L100',
        farbeToken: 'info',
      }), true));
      const nachher = (await ladeAbwesenheitsarten(k))
        .find((a) => a.schluessel === 'urlaub')!;
      expect(nachher.bezahlt).toBe(true);
      expect(nachher.lohnartSchluessel).toBe('L100');
      expect(nachher.bezeichnungI18n['en']).toBe('Annual leave');
    });
  });

  it('eine beantwortete Lohnfrage fällt nicht auf „ungeklärt" zurück', async () => {
    // `kern.abwesenheitsart_schutz`: eine Antwort, die jemand gegeben hat,
    // geht nicht verloren.
    await alsChef(async (k) => {
      const urlaub = (await ladeAbwesenheitsarten(k))
        .find((a) => a.schluessel === 'urlaub')!;
      await aendereAbwesenheitsart(k, urlaub.id, pruefeArtEingabe(formular({
        schluessel: 'urlaub', bezeichnung: 'Urlaub', bezahlt: 'ja',
      }), true));
    });
    await expect(alsChef(async (k) => {
      const urlaub = (await ladeAbwesenheitsarten(k))
        .find((a) => a.schluessel === 'urlaub')!;
      return aendereAbwesenheitsart(k, urlaub.id, pruefeArtEingabe(formular({
        schluessel: 'urlaub', bezeichnung: 'Urlaub', bezahlt: 'offen',
      }), true));
    })).rejects.toMatchObject({ name: 'StammdatenFehler', grund: 'benutzt' });
  });

  it('eine eigene Art entsteht, wird geändert und archiviert — nie gelöscht', async () => {
    const id = await alsAdmin((k) => legeAbwesenheitsartAn(k, pruefeArtEingabe(formular({
      schluessel: 'hitzefrei', bezeichnung: 'Hitzefrei', bezahlt: 'ja',
      i18n_tr: 'Sıcak izni', farbeToken: 'warning', nachweisAbTagen: '3',
    }), false)));

    await alsAdmin(async (k) => {
      const eigen = (await ladeAbwesenheitsarten(k)).find((a) => a.id === id)!;
      expect(eigen.istPlattform).toBe(false);
      expect(eigen.nachweisPflichtAbTagen).toBe(3);
      expect(eigen.bezeichnungI18n['tr']).toBe('Sıcak izni');
      await archiviereAbwesenheitsart(k, id);
      const danach = (await ladeAbwesenheitsarten(k)).find((a) => a.id === id)!;
      expect(danach.archiviertAm).not.toBeNull();
    });

    // Invariante 8: `kern.verhindere_loeschung` liegt auf der Tabelle, und
    // `delete` ist `cse_app` nicht gewaehrt.
    await expect(alsAdmin((k) => k.schreibe(
      `delete from abwesenheitsart where id = $1`, [id]))).rejects.toThrow();
  });

  it('derselbe Schlüssel kann nicht auf beiden Katalogstufen aktiv sein', async () => {
    // Sonst stehen im Antragsformular zwei Einträge „Urlaub" mit
    // verschiedener Lohnfolge (0276).
    await expect(alsAdmin((k) => legeAbwesenheitsartAn(k, pruefeArtEingabe(formular({
      schluessel: 'urlaub', bezeichnung: 'Urlaub eigen', bezahlt: 'ja',
    }), false)))).rejects.toMatchObject({ grund: 'kollision' });
  });

  it('auch nicht umgekehrt — und der Ausloeser hält, nicht nur der Dienst', async () => {
    const id = await alsAdmin((k) => legeAbwesenheitsartAn(k, pruefeArtEingabe(formular({
      schluessel: 'werkstattbesuch', bezeichnung: 'Werkstattbesuch', bezahlt: 'nein',
    }), false)));
    expect(id).toHaveLength(36);
    // Direkt in die Tabelle, am Dienst vorbei: die Sperre liegt in der
    // Datenbank (`kern.katalog_schluessel_frei`, security definer, damit sie
    // auch die Zeile einer fremden Gesellschaft sieht).
    await expect(alsChef((k) => k.schreibe(
      `insert into abwesenheitsart (mandant_id, schluessel, bezeichnung)
       values (null, 'werkstattbesuch', 'Werkstattbesuch plattform')`)))
      .rejects.toThrow(/anderen Katalogstufe/u);
  });

  it('und nach dem Archivieren ist der Schlüssel wieder frei', async () => {
    const id = await alsAdmin((k) => legeAbwesenheitsartAn(k, pruefeArtEingabe(formular({
      schluessel: 'werkstattbesuch', bezeichnung: 'Werkstattbesuch', bezahlt: 'nein',
    }), false)));
    await alsAdmin((k) => archiviereAbwesenheitsart(k, id));
    await expect(alsChef((k) => k.schreibe(
      `insert into abwesenheitsart (mandant_id, schluessel, bezeichnung)
       values (null, 'werkstattbesuch', 'Werkstattbesuch plattform')`)))
      .resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// antragsart — die drei Systemzeilen sind für JEDEN fest
// ---------------------------------------------------------------------------

describe('der Antragsartenkatalog', () => {
  it('führt drei Systemzeilen, und der Bestand bleibt ohne Recht unbekannt', async () => {
    const arten = await alsAdmin((k) => ladeAntragsarten(k, false));
    expect(arten).toHaveLength(3);
    expect(arten.every((a) => a.istSystem && a.istPlattform)).toBe(true);
    // `null` heisst „nicht lesbar", nicht „keine Antraege" — `t_mandant` auf
    // `antrag` verlangt `zeit.abwesenheit_lesen`.
    expect(arten.every((a) => a.antraege === null)).toBe(true);
  });

  it('eine Systemzeile ändert auch der Super-Admin nicht', async () => {
    await expect(alsChef(async (k) => {
      const urlaub = (await ladeAntragsarten(k, false))
        .find((a) => a.schluessel === 'urlaub')!;
      return aendereAntragsart(k, urlaub.id, {
        schluessel: 'urlaub', bezeichnung: 'Urlaubsantrag neu',
        i18n: { de: 'Urlaubsantrag neu' }, erfordertZeitraum: true,
        erfordertAbwesenheitsart: true, erfordertEinsatz: false,
        erfordertTauschpartner: false, erzeugtAbwesenheit: true,
        istStammdatenaenderung: false, plattform: true,
      });
    })).rejects.toMatchObject({ grund: 'system' });
  });

  it('und wird nicht archiviert — ohne sie gäbe es keinen Weg, Urlaub zu melden', async () => {
    await expect(alsChef(async (k) => {
      const krank = (await ladeAntragsarten(k, false))
        .find((a) => a.schluessel === 'krankmeldung')!;
      return archiviereAntragsart(k, krank.id);
    })).rejects.toMatchObject({ grund: 'system' });
  });

  it('eine eigene Art entsteht und trägt ist_system NICHT', async () => {
    const id = await alsAdmin((k) => legeAntragsartAn(k, {
      schluessel: 'freistellung', bezeichnung: 'Unbezahlte Freistellung',
      i18n: { de: 'Unbezahlte Freistellung', en: 'Unpaid leave' },
      erfordertZeitraum: true, erfordertAbwesenheitsart: true,
      erfordertEinsatz: false, erfordertTauschpartner: false,
      erzeugtAbwesenheit: true, istStammdatenaenderung: false, plattform: false,
    }));
    await alsAdmin(async (k) => {
      const neu = (await ladeAntragsarten(k, false)).find((a) => a.id === id)!;
      expect(neu.istSystem).toBe(false);
      expect(neu.istPlattform).toBe(false);
      expect(neu.erzeugtAbwesenheit).toBe(true);
      await archiviereAntragsart(k, id);
      expect((await ladeAntragsarten(k, false)).find((a) => a.id === id)!.archiviertAm)
        .not.toBeNull();
    });
  });

  it('und kein DELETE, auch nicht auf eine eigene Art', async () => {
    const id = await alsAdmin((k) => legeAntragsartAn(k, {
      schluessel: `probe_${zufall()}`, bezeichnung: 'Probe',
      i18n: { de: 'Probe' }, erfordertZeitraum: false,
      erfordertAbwesenheitsart: false, erfordertEinsatz: false,
      erfordertTauschpartner: false, erzeugtAbwesenheit: false,
      istStammdatenaenderung: false, plattform: false,
    }));
    await expect(alsAdmin((k) => k.schreibe(
      `delete from antragsart where id = $1`, [id]))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// belagsart — die Datierung, der K-05-Leser und die Ausschluss-Schranke
// ---------------------------------------------------------------------------

describe('der Belagsartenkatalog', () => {
  it('liest den Leistungswert über den Definer aus 0277 — und prüft dabei das Recht',
    async () => {
      await alsAdmin((k) => datiereBelagsartUm(k, {
        code: 'PVC', bezeichnung: 'PVC-Boden', beschreibung: null,
        leistungswert: '250.000', quelle: 'Branchenüblich — nicht bestätigt (O-17)',
        bestaetigt: false, gueltigAb: '2026-01-01',
      }));
      const fassungen = await alsAdmin((k) => ladeBelagsarten(k, true));
      expect(fassungen).toHaveLength(1);
      expect(fassungen[0]?.leistungswert).toBe('250.000');
      expect(fassungen[0]?.istPlatzhalter).toBe(true);
      expect(fassungen[0]?.raeume).toBe(0);

      /*
       * Der entzogene SELECT auf die Spalte (K-05, 0021): DIREKT gelesen
       * scheitert sie mit `42501`. Das ist der Grund, aus dem es den Definer
       * gibt — und die Zusicherung, dass er nicht umgangen werden kann.
       */
      await expect(alsAdmin((k) => k.abfrage(
        `select leistungswert_qm_pro_stunde from belagsart`))).rejects.toThrow();
    });

  it('eine neue Fassung schliesst die laufende zum Vortag', async () => {
    await alsAdmin(async (k) => {
      await datiereBelagsartUm(k, {
        code: 'PVC', bezeichnung: 'PVC-Boden', beschreibung: null,
        leistungswert: '250', quelle: 'Branchenüblich (O-17)', bestaetigt: false,
        gueltigAb: '2026-01-01',
      });
      await datiereBelagsartUm(k, {
        code: 'PVC', bezeichnung: 'PVC-Boden', beschreibung: null,
        leistungswert: '300,5', quelle: 'Zeitaufnahme Adlershof 2026',
        bestaetigt: true, gueltigAb: '2026-07-01',
      });
      const fassungen = await ladeBelagsarten(k, false);
      expect(fassungen).toHaveLength(2);
      const alt = fassungen.find((x) => x.gueltigAb === '2026-01-01')!;
      const neu = fassungen.find((x) => x.gueltigAb === '2026-07-01')!;
      expect(alt.gueltigBis).toBe('2026-06-30');
      expect(neu.gueltigBis).toBeNull();
      expect(neu.leistungswert).toBe('300.500');
      expect(neu.istPlatzhalter).toBe(false);
    });
  });

  it('und rückwärts geht es nicht: „der Wert am Stichtag" hat eine Antwort', async () => {
    await alsAdmin((k) => datiereBelagsartUm(k, {
      code: 'PVC', bezeichnung: 'PVC', beschreibung: null, leistungswert: '250',
      quelle: 'Probe', bestaetigt: false, gueltigAb: '2026-07-01',
    }));
    await expect(alsAdmin((k) => datiereBelagsartUm(k, {
      code: 'PVC', bezeichnung: 'PVC', beschreibung: null, leistungswert: '200',
      quelle: 'Probe', bestaetigt: false, gueltigAb: '2026-07-01',
    }))).rejects.toMatchObject({ grund: 'ungueltig' });
  });

  it('die Ausschluss-Schranke hält auch am Dienst vorbei', async () => {
    await alsAdmin((k) => datiereBelagsartUm(k, {
      code: 'TEPPICH', bezeichnung: 'Teppich', beschreibung: null,
      leistungswert: '180', quelle: 'Probe', bestaetigt: false,
      gueltigAb: '2026-01-01',
    }));
    // Eine zweite offene Fassung desselben Codes: `belagsart_code_uk` bzw.
    // `belagsart_zeitraum_eindeutig` weist sie ab.
    await expect(alsAdmin((k) => k.schreibe(
      `insert into belagsart (mandant_id, code, bezeichnung,
                              leistungswert_qm_pro_stunde, quelle, gueltig_ab)
       values (app.aktiver_mandant(), 'TEPPICH', 'Teppich zwei', 200, 'Probe',
               '2026-06-01')`))).rejects.toThrow();
  });

  it('eine Richtigstellung ändert den Wert nicht', async () => {
    await alsAdmin(async (k) => {
      await datiereBelagsartUm(k, {
        code: 'LINO', bezeichnung: 'Linoleum', beschreibung: null,
        leistungswert: '220', quelle: 'Probe', bestaetigt: false,
        gueltigAb: '2026-01-01',
      });
      const [fassung] = await ladeBelagsarten(k, false);
      await stelleBelagsartRichtig(k, fassung!.id, {
        bezeichnung: 'Linoleum-Belag', beschreibung: 'homogen',
        quelle: 'Zeitaufnahme 2026', bestaetigt: true,
      });
      const [danach] = await ladeBelagsarten(k, false);
      expect(danach?.bezeichnung).toBe('Linoleum-Belag');
      expect(danach?.leistungswert).toBe('220.000');
      expect(danach?.istPlatzhalter).toBe(false);
      expect(danach?.gueltigBis).toBeNull();
    });
  });

  it('und kein DELETE — ein abgegebenes Angebot bleibt nachrechenbar', async () => {
    await alsAdmin((k) => datiereBelagsartUm(k, {
      code: 'PVC', bezeichnung: 'PVC', beschreibung: null, leistungswert: '250',
      quelle: 'Probe', bestaetigt: false, gueltigAb: '2026-01-01',
    }));
    await expect(alsAdmin((k) => k.schreibe(
      `delete from belagsart where code = 'PVC'`))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// reinigungsklasse — mandantengebunden, Code nur einmal aktiv
// ---------------------------------------------------------------------------

describe('der Reinigungsklassenkatalog', () => {
  it('ist mandantengebunden und beginnt leer', async () => {
    expect(await alsAdmin((k) => ladeReinigungsklassen(k, {
      raeume: true, importzeilen: true,
    }))).toEqual([]);
  });

  it('nimmt eine Klasse auf, bestätigt sie und zählt, was daran hängt', async () => {
    const id = await alsAdmin((k) => legeReinigungsklasseAn(k, {
      code: 'RK1', bezeichnung: 'Büro und Besprechung', beschreibung: null,
      sortierung: 10, bestaetigt: false,
    }));
    await alsAdmin(async (k) => {
      const [eine] = await ladeReinigungsklassen(k, { raeume: true, importzeilen: true });
      expect(eine?.id).toBe(id);
      expect(eine?.istPlatzhalter).toBe(true);
      expect(eine?.raeume).toBe(0);
      expect(eine?.importzeilen).toBe(0);

      await aendereReinigungsklasse(k, id, {
        code: 'RK1', bezeichnung: 'Büroflächen', beschreibung: 'Schreibtische',
        sortierung: 20, bestaetigt: true,
      });
      const [danach] = await ladeReinigungsklassen(k, { raeume: false, importzeilen: false });
      expect(danach?.istPlatzhalter).toBe(false);
      expect(danach?.bezeichnung).toBe('Büroflächen');
      // Ohne Recht bleibt die Zahl `null` — nicht 0.
      expect(danach?.raeume).toBeNull();
    });
  });

  it('gibt den Code erst mit dem Archivieren wieder frei', async () => {
    const id = await alsAdmin((k) => legeReinigungsklasseAn(k, {
      code: 'RK3', bezeichnung: 'Sanitär', beschreibung: null, sortierung: 30,
      bestaetigt: false,
    }));
    await expect(alsAdmin((k) => legeReinigungsklasseAn(k, {
      code: 'RK3', bezeichnung: 'Sanitär zwei', beschreibung: null, sortierung: 31,
      bestaetigt: false,
    }))).rejects.toMatchObject({ grund: 'doppelt' });

    await alsAdmin((k) => archiviereReinigungsklasse(k, id));
    await expect(alsAdmin((k) => legeReinigungsklasseAn(k, {
      code: 'RK3', bezeichnung: 'Sanitär neu', beschreibung: null, sortierung: 31,
      bestaetigt: false,
    }))).resolves.toHaveLength(36);
  });

  it('und eine Klasse einer FREMDEN Gesellschaft ist unsichtbar (K-03)', async () => {
    await alsAdmin((k) => legeReinigungsklasseAn(k, {
      code: 'RK9', bezeichnung: 'Nur Reinigung', beschreibung: null, sortierung: 90,
      bestaetigt: false,
    }));
    const inBau = await alsApp({
      scope: 'mandant', mandantId: f.bau, mandantIds: [f.bau],
      benutzerId: admin, readonly: false, portal: 'intern',
    }, async (tx) => ladeReinigungsklassen(alsKontext(tx, f.bau, admin), {
      raeume: false, importzeilen: false,
    }));
    expect(inBau).toEqual([]);
  });

  it('und kein DELETE — die Klasse steht im Leistungsverzeichnis', async () => {
    const id = await alsAdmin((k) => legeReinigungsklasseAn(k, {
      code: 'RK4', bezeichnung: 'Technik', beschreibung: null, sortierung: 40,
      bestaetigt: false,
    }));
    await expect(alsAdmin((k) => k.schreibe(
      `delete from reinigungsklasse where id = $1`, [id]))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// qualifikation — die gesetzliche Stufe gehört dem Super-Admin
// ---------------------------------------------------------------------------

describe('der Qualifikationskatalog', () => {
  it('nimmt eine eigene Qualifikation auf, mit Warnstufen und Sperre', async () => {
    const id = await alsAdmin((k) => legeQualifikationAn(k, {
      schluessel: 'hausordnung', bezeichnung: 'Hausordnungsschulung',
      i18n: { de: 'Hausordnungsschulung' }, beschreibung: null, kategorie: 'intern',
      rechtsgrundlage: null, laeuftAb: true, standardGueltigkeitMonate: 24,
      warnungTage: [60, 30, 7], blockiertEinsatz: false, erfordertDokument: false,
      plattform: false,
    }));
    await alsAdmin(async (k) => {
      const [eine] = await ladeQualifikationen(k, {
        nachweise: true, anforderungen: true,
      });
      expect(eine?.id).toBe(id);
      expect(eine?.istPlattform).toBe(false);
      expect(eine?.warnungTage).toEqual([60, 30, 7]);
      expect(eine?.nachweise).toBe(0);
      expect(eine?.anforderungen).toBe(0);

      await aendereQualifikation(k, id, {
        schluessel: 'hausordnung', bezeichnung: 'Hausordnung',
        i18n: { de: 'Hausordnung', ar: 'لائحة المنزل' }, beschreibung: null,
        kategorie: 'intern', rechtsgrundlage: null, laeuftAb: true,
        standardGueltigkeitMonate: 12, warnungTage: [90, 30],
        blockiertEinsatz: true, erfordertDokument: true, plattform: false,
      });
      const [danach] = await ladeQualifikationen(k, {
        nachweise: false, anforderungen: false,
      });
      expect(danach?.blockiertEinsatz).toBe(true);
      expect(danach?.warnungTage).toEqual([90, 30]);
      expect(danach?.bezeichnungI18n['ar']).toBe('لائحة المنزل');
      // Ohne Recht bleibt die Reichweite unbekannt statt 0.
      expect(danach?.nachweise).toBeNull();

      await archiviereQualifikation(k, id);
      const [arch] = await ladeQualifikationen(k, {
        nachweise: false, anforderungen: false,
      });
      expect(arch?.archiviertAm).not.toBeNull();
    });
  });

  it('eine plattformweite Zeile legt nur der Super-Admin an (§6.16)', async () => {
    await expect(alsAdmin((k) => legeQualifikationAn(k, {
      schluessel: `global_${zufall()}`, bezeichnung: 'Global', i18n: { de: 'Global' },
      beschreibung: null, kategorie: 'gesetzlich', rechtsgrundlage: null,
      laeuftAb: false, standardGueltigkeitMonate: null, warnungTage: [60, 30, 7],
      blockiertEinsatz: false, erfordertDokument: false, plattform: true,
    }))).rejects.toThrow();

    await expect(alsChef((k) => legeQualifikationAn(k, {
      schluessel: `global_${zufall()}`, bezeichnung: 'Sachkunde',
      i18n: { de: 'Sachkunde' }, beschreibung: null, kategorie: 'gesetzlich',
      rechtsgrundlage: '§34a Abs. 1a GewO', laeuftAb: false,
      standardGueltigkeitMonate: null, warnungTage: [60, 30, 7],
      blockiertEinsatz: true, erfordertDokument: false, plattform: true,
    }))).resolves.toHaveLength(36);
  });

  it('der Schlüssel bleibt unveränderlich — auch am Dienst vorbei', async () => {
    const id = await alsAdmin((k) => legeQualifikationAn(k, {
      schluessel: 'hausordnung', bezeichnung: 'Hausordnung', i18n: { de: 'Hausordnung' },
      beschreibung: null, kategorie: 'intern', rechtsgrundlage: null, laeuftAb: false,
      standardGueltigkeitMonate: null, warnungTage: [60, 30, 7],
      blockiertEinsatz: false, erfordertDokument: false, plattform: false,
    }));
    // `kern.qualifikation_katalog_schutz` (0030): er steht in Berichten.
    await expect(alsAdmin((k) => k.schreibe(
      `update qualifikation set schluessel = 'anders' where id = $1`, [id])))
      .rejects.toThrow(/unveraenderlich/u);
  });

  it('und kein DELETE — der Nachweis eines Menschen beruft sich darauf', async () => {
    const id = await alsAdmin((k) => legeQualifikationAn(k, {
      schluessel: 'hausordnung', bezeichnung: 'Hausordnung', i18n: { de: 'Hausordnung' },
      beschreibung: null, kategorie: 'intern', rechtsgrundlage: null, laeuftAb: false,
      standardGueltigkeitMonate: null, warnungTage: [60, 30, 7],
      blockiertEinsatz: false, erfordertDokument: false, plattform: false,
    }));
    await expect(alsAdmin((k) => k.schreibe(
      `delete from qualifikation where id = $1`, [id]))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Das Protokoll — vier der fünf Tabellen tragen keinen Audit-Auslöser
// ---------------------------------------------------------------------------

describe('das Prüfprotokoll', () => {
  it('hält jede Katalogänderung fest, auch ohne Audit-Auslöser', async () => {
    await alsAdmin((k) => legeReinigungsklasseAn(k, {
      code: 'RK1', bezeichnung: 'Büro', beschreibung: null, sortierung: 10,
      bestaetigt: false,
    }));
    const zeilen = await sql.unsafe<{ aktion: string; objekt_typ: string }[]>(
      `select aktion, objekt_typ from audit_log
        where aktion like 'stammdaten.%' order by erstellt_am desc`);
    expect(zeilen.map((z) => z.aktion)).toContain('stammdaten.reinigungsklasse_angelegt');
    expect(zeilen[0]?.objekt_typ).toBe('reinigungsklasse');
  });

  it('und nennt bei einer Änderung Vorher UND Nachher', async () => {
    const id = await alsAdmin((k) => legeReinigungsklasseAn(k, {
      code: 'RK2', bezeichnung: 'Verkehrsfläche', beschreibung: null, sortierung: 20,
      bestaetigt: false,
    }));
    await alsAdmin((k) => aendereReinigungsklasse(k, id, {
      code: 'RK2', bezeichnung: 'Verkehrsflächen', beschreibung: null, sortierung: 20,
      bestaetigt: true,
    }));
    const [zeile] = await sql.unsafe<{
      vorher: Record<string, unknown> | null;
      nachher: Record<string, unknown> | null;
      geaendert_felder: string[] | null;
    }[]>(
      `select vorher, nachher, geaendert_felder from audit_log
        where aktion = 'stammdaten.reinigungsklasse_geaendert'
        order by erstellt_am desc limit 1`);
    expect(zeile?.vorher?.['bezeichnung']).toBe('Verkehrsfläche');
    expect(zeile?.nachher?.['bezeichnung']).toBe('Verkehrsflächen');
    // `geaendert_felder` entsteht in `app.protokolliere` aus beiden Seiten —
    // das geht nur, wenn wirklich zwei Objekte ankommen und nicht zwei
    // Zeichenketten.
    expect(zeile?.geaendert_felder).not.toBeNull();
  });
});
