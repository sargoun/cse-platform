import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext }
  from '../../src/server/kontext/index.js';
import { kandidaten, lade, ladeZuordnung, ordneZu }
  from '../../src/server/services/datenschutz/anfrage.js';
import { erstelleAuskunft, erteilte, halteFest }
  from '../../src/server/services/datenschutz/auskunft.js';
import { nimmAuf, liste as berichtigungen }
  from '../../src/server/services/datenschutz/berichtigung.js';
import { matrix, liste as loeschungen }
  from '../../src/server/services/datenschutz/loeschentscheidung.js';
import { liste as widersprueche, protokoll, stand }
  from '../../src/server/services/datenschutz/werbewiderspruch.js';

/**
 * **Die Dienstfunktionen selbst — einmal aufgerufen, gegen echtes Postgres.**
 *
 * `datenschutz-nachweis.test.ts` prüft rohes SQL gegen Policies und
 * Definer-Funktionen, `datenschutz-fristen.test.ts` reine Rechenfunktionen und
 * die Markdown-Ausgabe. Keine der beiden ruft eine der Dienstfunktionen auf —
 * also blieben `erstelleAuskunft` (gut zwanzig Abfragen über zwanzig
 * Tabellen), `matrix` (achtzehn), `kandidaten`, `ordneZu`, `nimmAuf`,
 * `erteilte`, `liste`, `protokoll` und `stand` ungeprüft. Genau dort fällt ein
 * umbenannter Spaltenname erst beim Aufruf auf und nie beim Typecheck: die
 * Abfragen stehen in Zeichenketten.
 *
 * **Und deshalb steht hier je Funktion EINE Zusage über Zeilenzahl und
 * Sperrzustand**, für alle drei Zuordnungsarten. `ansprechpartner` und
 * `bewerbung` sind nicht Beiwerk: sie sind die Zweige, in denen der Prüfer
 * fünf fehlende Tabellen gefunden hat, und ein Zweig, den kein Test je läuft,
 * ist ein Zweig, den niemand ausführt.
 */

let f: Fixtur;
/** Hält alle Rechte (super_admin) — die vollständige Auskunft. */
let dsb = '';
/** Hält NUR die drei Datenschutzrechte — der Fall „gesperrt, nicht leer". */
let schmal = '';
let kunde = '';
let kontakt = '';
let bewerbung = '';
const anfrage: Record<string, string> = {};

async function konto(email: string, global: string | null): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, $2, 'aktiv',
             case when $3::text is null then null
                  else (select id from rolle
                         where schluessel = $3 and mandant_id is null) end)`,
    [u!.id, email, global]);
  return u!.id;
}

async function legeAnfrageAn(
  art: string, spalte: string | null, ziel: string | null,
): Promise<string> {
  const [a] = await alsRolle('', (tx) => tx.unsafe(
    `insert into betroffenenanfrage (mandant_id, art, name, email${
      spalte === null ? '' : `, ${spalte}`})
     values ($1, $2, 'Amira Said', 'amira@dienste.test'${
       spalte === null ? '' : ', $3::uuid'})
     returning id`,
    spalte === null ? [f.reinigung, art] : [f.reinigung, art, ziel]),
  ) as unknown as { id: string }[];
  return a!.id;
}

beforeAll(async () => {
  f = await seed();
  dsb = await konto('dsb@dienste.test', 'super_admin');
  schmal = await konto('schmal@dienste.test', null);

  for (const b of [dsb, schmal]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle
                         where schluessel = $3 and mandant_id is null), true)`,
      [b, f.reinigung, b === dsb ? 'admin' : 'leitung']);
  }
  /*
   * `schmal` bekommt GENAU die drei Datenschutzrechte in dieser Gesellschaft
   * — und kein `crm.lesen`, kein `zeit.lesen`, kein
   * `recruiting.bewerbung_lesen`. Das ist der Fall, für den `auskunft.ts`
   * gebaut ist: die Datenbank antwortet korrekt mit null Zeilen, und eine
   * Auskunft, die daraus „nichts gespeichert" macht, ist falsch.
   */
  for (const recht of ['datenschutz.auskunft_erstellen',
    'datenschutz.berichtigung_bearbeiten', 'datenschutz.loeschung_pruefen']) {
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
               (select id from berechtigung where schluessel = $1), $2, true)`,
      [recht, f.reinigung]);
  }

  const [fi] = await alsRolle('', (tx) => tx.unsafe(
    `insert into firma (name, land) values ('Dienste GmbH', 'DE') returning id`),
  ) as unknown as { id: string }[];
  const [k] = await alsRolle('', (tx) => tx.unsafe(
    `insert into kunde (mandant_id, firma_id, kundennummer, name, typ, status,
                        email_zentral, rechtsgrundlage, rechtsgrundlage_quelle,
                        rechtsgrundlage_erfasst_am)
     values ($1, $2, 'K-9001', 'Dienste GmbH', 'firma', 'aktiv',
             'zentrale@dienste.test', 'bestandskunde', 'Rahmenvertrag', now())
     returning id`, [f.reinigung, fi!.id])) as unknown as { id: string }[];
  kunde = k!.id;
  const [ap] = await alsRolle('', (tx) => tx.unsafe(
    `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname, email,
                                  rechtsgrundlage, rechtsgrundlage_quelle,
                                  rechtsgrundlage_erfasst_am)
     values ($1, $2, 'Amira', 'Said', 'amira@dienste.test', 'bestandskunde',
             'Rahmenvertrag', now())
     returning id`, [f.reinigung, kunde])) as unknown as { id: string }[];
  kontakt = ap!.id;

  const [st] = await alsRolle('', (tx) => tx.unsafe(
    `insert into stelle (mandant_id, titel, beschreibung, status)
     values ($1, 'Objektleitung', 'Leitung eines Reinigungsobjekts.', 'entwurf')
     returning id`, [f.reinigung]),
  ) as unknown as { id: string }[];
  const [bw] = await alsRolle('', (tx) => tx.unsafe(
    `insert into bewerbung (mandant_id, stelle_id, name, email, quelle, status,
                            aufbewahrung_bis)
     values ($1, $2, 'Amira Said', 'amira@dienste.test', 'karriereseite',
             'eingegangen', now() + interval '180 days')
     returning id`, [f.reinigung, st!.id])) as unknown as { id: string }[];
  bewerbung = bw!.id;

  anfrage['person'] = await legeAnfrageAn('auskunft', 'person_id', f.fatima);
  anfrage['ansprechpartner'] =
    await legeAnfrageAn('auskunft', 'ansprechpartner_id', kontakt);
  anfrage['bewerbung'] = await legeAnfrageAn('auskunft', 'bewerbung_id', bewerbung);
  anfrage['offen'] = await legeAnfrageAn('berichtigung', null, null);
});
afterAll(schliessen);

function sitzung(benutzerId: string) {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId,
    portal: 'intern' as const, readonly: false,
  };
}

/** Der schmale Ausschnitt, den die Dienste erwarten — lesend und schreibend. */
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

describe('die Akte: laden, suchen, zuordnen', () => {
  it('`lade` findet den Vorgang und rechnet die Frist', async () => {
    const z = await imKontext(dsb, (k) => lade(k as LeseKontext, anfrage['person']!));
    expect(z).not.toBeNull();
    expect(z!.art).toBe('auskunft');
    expect(typeof z!.tageBisFrist).toBe('number');
  });

  it('`ladeZuordnung` liest alle drei Arten', async () => {
    for (const art of ['person', 'ansprechpartner', 'bewerbung'] as const) {
      const z = await imKontext(dsb,
        (k) => ladeZuordnung(k as LeseKontext, 'reinigung', anfrage[art]!));
      expect(z.art, art).toBe(art);
      expect(z.id, art).not.toBeNull();
    }
  });

  it('`kandidaten` findet in allen drei Töpfen — und schweigt unter zwei Zeichen', async () => {
    const treffer = await imKontext(dsb,
      (k) => kandidaten(k as LeseKontext, 'Said'));
    expect(treffer.map((t) => t.art)).toContain('ansprechpartner');
    expect(treffer.map((t) => t.art)).toContain('bewerbung');
    expect(await imKontext(dsb, (k) => kandidaten(k as LeseKontext, 'S'))).toEqual([]);
  });

  it('`ordneZu` setzt und löst — und weist eine fremde Kennung ab', async () => {
    await imKontext(dsb, (k) => ordneZu(k, anfrage['offen']!, 'ansprechpartner', kontakt));
    expect((await imKontext(dsb,
      (k) => ladeZuordnung(k as LeseKontext, null, anfrage['offen']!))).art)
      .toBe('ansprechpartner');

    await imKontext(dsb, (k) => ordneZu(k, anfrage['offen']!, 'keine', null));
    expect((await imKontext(dsb,
      (k) => ladeZuordnung(k as LeseKontext, null, anfrage['offen']!))).art)
      .toBe('keine');

    await expect(imKontext(dsb, (k) => ordneZu(
      k, anfrage['offen']!, 'person', '00000000-0000-0000-0000-000000000009')))
      .rejects.toThrow(/keine Beschäftigte/u);
  });
});

describe('Art. 15: die Auskunft läuft in allen drei Zweigen wirklich', () => {
  for (const art of ['person', 'ansprechpartner', 'bewerbung'] as const) {
    it(`${art}: jede Abfrage des Zweigs läuft gegen echtes Postgres`, async () => {
      const a = await imKontext(dsb, async (k) => {
        const z = await ladeZuordnung(k as LeseKontext, null, anfrage[art]!);
        return erstelleAuskunft(k as LeseKontext, anfrage[art]!, z, new Date());
      });
      expect(a.betroffener.art).toBe(art);
      expect(a.abschnitte.length).toBeGreaterThan(0);
      /*
       * Ein `super_admin` hält jedes Recht — also ist NICHTS gesperrt. Wäre
       * hier ein Abschnitt gesperrt, stimmte entweder die Rechteangabe des
       * Abschnitts nicht oder die Fixtur.
       */
      expect(a.fehlendeRechte).toEqual([]);
      expect(a.abschnitte.filter((s) => s.gesperrt)).toEqual([]);
    });
  }

  it('der Kontaktzweig führt die sieben Tabellen mit `ansprechpartner_id`', async () => {
    /*
     * Der Befund des Prüfers: hier standen DREI Abschnitte. Diese Zusage
     * nennt die Abschnitte beim Namen — die Wache in
     * `datenschutz-abdeckung.test.ts` prüft die Menge gegen das Schema, dieser
     * Fall prüft, dass sie auch WIRKLICH abgefragt werden.
     */
    const a = await imKontext(dsb, async (k) => {
      const z = await ladeZuordnung(k as LeseKontext, null, anfrage['ansprechpartner']!);
      return erstelleAuskunft(k as LeseKontext, anfrage['ansprechpartner']!, z, new Date());
    });
    const schluessel = a.abschnitte.map((s) => s.schluessel);
    for (const s of ['kontakt', 'rechtsgrundlage', 'widerspruchsprotokoll',
      'lead', 'lead_aktivitaet', 'angebot', 'objekt', 'werbewiderspruch_token',
      'betroffenenanfrage']) {
      expect(schluessel, s).toContain(s);
    }
  });

  it('der Bewerbungszweig führt Entscheidung und Kandidatenprofil', async () => {
    const a = await imKontext(dsb, async (k) => {
      const z = await ladeZuordnung(k as LeseKontext, null, anfrage['bewerbung']!);
      return erstelleAuskunft(k as LeseKontext, anfrage['bewerbung']!, z, new Date());
    });
    const schluessel = a.abschnitte.map((s) => s.schluessel);
    for (const s of ['bewerbung', 'bewerbung_bewertung', 'gespraech',
      'bewerbung_antwort', 'einstellungsentscheidung', 'kandidat']) {
      expect(schluessel, s).toContain(s);
    }
  });

  it('ohne das Fachrecht ist der Abschnitt GESPERRT, nicht leer', async () => {
    /*
     * `crm.rechtsgrundlage_lesen` ist das Recht, das die Rolle `leitung`
     * NICHT trägt (`crm.lesen`, `angebot.lesen` und `objekt.lesen` trägt sie
     * — nachgemessen, nicht angenommen). Genau daran hängt der
     * Widerspruchsprotokoll-Abschnitt.
     */
    const a = await imKontext(schmal, async (k) => {
      const z = await ladeZuordnung(k as LeseKontext, null, anfrage['ansprechpartner']!);
      return erstelleAuskunft(k as LeseKontext, anfrage['ansprechpartner']!, z, new Date());
    });
    expect(a.vollstaendig).toBe(false);
    expect(a.fehlendeRechte).toContain('crm.rechtsgrundlage_lesen');
    const gesperrt = a.abschnitte.find((s) => s.schluessel === 'widerspruchsprotokoll');
    expect(gesperrt?.gesperrt).toBe(true);
    expect(gesperrt?.zeilen).toEqual([]);
    // Und der Abschnitt daneben, dessen Recht sie HAT, ist nicht gesperrt —
    // sonst prüfte dieser Fall nur, dass irgendetwas fehlt.
    expect(a.abschnitte.find((s) => s.schluessel === 'kontakt')?.gesperrt).toBe(false);
  });

  it('die offene Aufbewahrungsfrist wird gezählt, nicht als Angabe geführt', async () => {
    const a = await imKontext(dsb, async (k) => {
      const z = await ladeZuordnung(k as LeseKontext, null, anfrage['person']!);
      return erstelleAuskunft(k as LeseKontext, anfrage['person']!, z, new Date());
    });
    expect(a.offeneFristen.length).toBeGreaterThan(0);
    for (const titel of a.offeneFristen) {
      const s = a.abschnitte.find((x) => x.titel === titel);
      expect(s?.frist, titel).toMatch(/nicht entschieden|nicht gesetzt/iu);
    }
  });

  it('`halteFest` und `erteilte` schreiben und lesen dasselbe Artefakt', async () => {
    const a = await imKontext(dsb, async (k) => {
      const z = await ladeZuordnung(k as LeseKontext, null, anfrage['person']!);
      const auskunft = await erstelleAuskunft(
        k as LeseKontext, anfrage['person']!, z, new Date());
      await halteFest(k, auskunft, 'md');
      return auskunft;
    });
    const zeilen = await imKontext(dsb,
      (k) => erteilte(k as LeseKontext, anfrage['person']!));
    expect(zeilen.length).toBe(1);
    expect(zeilen[0]!.sha256).toBe(a.sha256);
    expect(zeilen[0]!.abschnitte).toBe(a.abschnitte.length);
  });
});

describe('Art. 16: der Feldnachweis wird nicht überschrieben', () => {
  it('`nimmAuf` legt an, `liste` liest, und der zweite Wert ersetzt den ersten nicht', async () => {
    const id = anfrage['person']!;
    await imKontext(dsb, (k) => nimmAuf(k, id, {
      tabelle: 'person', feld: 'nachname',
      wertGespeichert: 'Said', wertBehauptet: 'Saïd', quelle: 'Arbeitsvertrag',
    }));
    await imKontext(dsb, (k) => nimmAuf(k, id, {
      tabelle: 'person', feld: 'nachname',
      wertGespeichert: 'Saïd', wertBehauptet: 'Saïd-Meyer',
    }));
    const felder = await imKontext(dsb, (k) => berichtigungen(k as LeseKontext, id));
    expect(felder.length).toBe(1);
    // Der ERSTE erfasste Stand — das ist der Beweis, um den es geht.
    expect(felder[0]!.wertGespeichert).toBe('Said');
    expect(felder[0]!.wertBehauptet).toBe('Saïd-Meyer');
    expect(felder[0]!.quelle).toBe('Arbeitsvertrag');
  });

  it('ein entschiedenes Feld antwortet mit 409 statt sich überschreiben zu lassen', async () => {
    const id = anfrage['person']!;
    await sql.unsafe(
      `update berichtigung_feld
          set ergebnis = 'berichtigt', berichtigt_am = now(), berichtigt_von = $1
        where mandant_id = $2 and anfrage_id = $3::uuid`,
      [dsb, f.reinigung, id]);
    await expect(imKontext(dsb, (k) => nimmAuf(k, id, {
      tabelle: 'person', feld: 'nachname',
      wertGespeichert: 'Saïd-Meyer', wertBehauptet: 'Said',
    }))).rejects.toThrow(/bereits.*entschieden/iu);
  });
});

describe('Art. 17: die Matrix zählt in allen drei Zweigen', () => {
  for (const art of ['person', 'ansprechpartner', 'bewerbung'] as const) {
    it(`${art}: jede Ortsabfrage läuft`, async () => {
      const orte = await imKontext(dsb, async (k) => {
        const z = await ladeZuordnung(k as LeseKontext, null, anfrage[art]!);
        return matrix(k as LeseKontext, anfrage[art]!, z);
      });
      expect(orte.length).toBeGreaterThan(0);
      expect(orte.filter((o) => o.ungelesen)).toEqual([]);
      /*
       * Jeder Ort nennt seine Löschart aus `rls.ts` ODER sagt, dass keine
       * registriert ist — beides ist eine Aussage, `undefined` wäre keine.
       */
      for (const o of orte) expect(typeof o.loeschartText, o.tabelle).toBe('string');
    });
  }

  it('der Kontaktzweig zählt die fünf nachgetragenen Orte mit', async () => {
    const orte = await imKontext(dsb, async (k) => {
      const z = await ladeZuordnung(k as LeseKontext, null, anfrage['ansprechpartner']!);
      return matrix(k as LeseKontext, anfrage['ansprechpartner']!, z);
    });
    const tabellen = orte.map((o) => o.tabelle);
    for (const t of ['lead', 'lead_aktivitaet', 'angebot', 'objekt',
      'werbewiderspruch_token']) {
      expect(tabellen, t).toContain(t);
    }
  });

  it('`liste` gibt die getroffenen Entscheidungen zurück — anfangs keine', async () => {
    expect(await imKontext(dsb,
      (k) => loeschungen(k as LeseKontext, anfrage['bewerbung']!))).toEqual([]);
  });
});

describe('Die Widerspruchslisten laufen als Dienst, nicht nur als SQL', () => {
  it('`liste`, `protokoll` und `stand` antworten ohne zu werfen', async () => {
    const zeilen = await imKontext(dsb, (k) => widersprueche(k as LeseKontext));
    expect(Array.isArray(zeilen)).toBe(true);

    const p = await imKontext(dsb, (k) => protokoll(k as LeseKontext));
    expect(Array.isArray(p)).toBe(true);

    const s = await imKontext(dsb, (k) => stand(k as LeseKontext, kontakt, null));
    expect(s.length).toBe(1);
    expect(s[0]!.ebene).toBe('ansprechpartner');
    // Die Firma kommt MIT — ohne sie verwirft `/api/datenschutz/widerspruch`
    // den Haken „auch auf Ebene der Firma" stillschweigend.
    expect(s[0]!.kundeId).toBe(kunde);
  });

  it('`stand` ohne Betroffenen ist leer und fragt die Datenbank gar nicht', async () => {
    expect(await imKontext(dsb, (k) => stand(k as LeseKontext, null, null))).toEqual([]);
  });
});
