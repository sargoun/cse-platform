/**
 * Nachrichtenfäden gegen echte Policies und das UWG-Tor (EMP-11, CRM-03,
 * CRM-08, LEG-08, Invariante 7, Invariante 8).
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. `trg_thread_id` macht jede Wurzel zu ihrem eigenen Faden, und jede
 *     Antwort landet im Faden ihres Elternteils — nicht in einem neuen.
 *  2. Eine AUSGEHENDE Nachricht ohne aufgezeichnete Rechtsgrundlage lässt
 *     sich nicht speichern (§ 7 UWG als Datenbankbedingung).
 *  3. Ein Agent sendet nicht ohne Freigabe (Invariante 7).
 *  4. Das Sendetor fragt denselben Torwächter wie `lead_aktivitaet` und
 *     SCHREIBT die Rechtsgrundlage selbst — der Aufrufer kann sie nicht
 *     erfinden.
 *  5. `p_beteiligt` lässt ausserhalb des internen Portals nur Beteiligte
 *     durch, und zwar je Empfängerart (eine Anmelde-Id ist keine Personen-Id).
 *  6. Gelöscht wird nichts; ein Faden wird geschlossen, und nur an der Wurzel.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function legeKontoAn(
  mandantId: string, rolle = 'leitung', personId: string | null = null,
): Promise<string> {
  const email = `nac-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1, $2, 'Konto', 'aktiv', $3)`, [u!.id, email, personId]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

interface NachrichtZeile { id: string; thread_id: string }

async function schreibeIntern(
  mandantId: string, absender: string, koerper: string,
  z: { betreff?: string | null; antwortetAuf?: string | null } = {},
): Promise<NachrichtZeile> {
  const [n] = await sql.unsafe<NachrichtZeile[]>(
    `insert into nachricht (mandant_id, betreff, koerper, richtung, kanal, akteur_art,
                            absender_benutzer_id, antwortet_auf_id, erstellt_von)
     values ($1::uuid, $2, $3, 'intern', 'portal', 'mensch', $4::uuid, $5::uuid, $4::uuid)
     returning id, thread_id`,
    [mandantId, z.betreff ?? null, koerper, absender, z.antwortetAuf ?? null]);
  return n!;
}

async function empfaenger(
  mandantId: string, nachrichtId: string,
  typ: 'benutzer' | 'person' | 'ansprechpartner' | 'extern',
  id: string | null, externEmail: string | null = null,
): Promise<void> {
  await sql.unsafe(
    `insert into nachricht_empfaenger
       (mandant_id, nachricht_id, empfaenger_typ, empfaenger_id, extern_email)
     values ($1::uuid, $2::uuid, $3::nachricht_empfaenger_typ, $4::uuid, $5)`,
    [mandantId, nachrichtId, typ, id, externEmail]);
}

/** Ein Kontakt mit Einwilligung für E-Mail — der Fall, in dem gesendet werden DARF. */
async function kontaktMitEinwilligung(mandantId: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1::uuid, $2, 'Testkunde', 'einwilligung', 'Formular 2026-01', now(), 'aktiv')
     returning id`, [mandantId, `K-${zufall()}`]);
  const [ap] = await sql.unsafe<{ id: string }[]>(
    `insert into ansprechpartner (mandant_id, kunde_id, nachname, email, rechtsgrundlage,
                                  rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am,
                                  einwilligung_kanaele)
     values ($1::uuid, $2::uuid, 'Muster', $3, 'einwilligung', 'Formular 2026-01', now(),
             array['email'])
     returning id`, [mandantId, k!.id, `k${zufall()}@example.test`]);
  return ap!.id;
}

async function titelIm(
  scope: 'mandant' | 'gruppe' | 'person' | 'kunde',
  z: {
    mandantId?: string; mandantIds?: readonly string[];
    benutzerId?: string; personId?: string;
    portal?: 'intern' | 'mitarbeiter' | 'kunde';
  },
): Promise<readonly string[]> {
  const zeilen = await alsApp(
    { scope, readonly: true, ...z },
    async (tx: postgres.TransactionSql) => tx.unsafe(
      `select koerper from nachricht where geloescht_am is null order by koerper`),
  ) as readonly { koerper: string }[];
  return zeilen.map((r) => r.koerper);
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(1) der Faden entsteht im Auslöser, nicht im Aufrufer', () => {
  it('eine Wurzel ist ihr eigener Faden', async () => {
    const w = await legeKontoAn(f.reinigung);
    const n = await schreibeIntern(f.reinigung, w, 'Bitte Termin bestätigen.',
                                   { betreff: 'Schlüsselübergabe' });
    expect(n.thread_id).toBe(n.id);
  });

  it('eine Antwort landet im Faden ihres Elternteils', async () => {
    const w = await legeKontoAn(f.reinigung);
    const wurzel = await schreibeIntern(f.reinigung, w, 'Frage', { betreff: 'Vorgang' });
    const antwort = await schreibeIntern(f.reinigung, w, 'Antwort',
                                         { antwortetAuf: wurzel.id });
    expect(antwort.thread_id).toBe(wurzel.id);
    expect(antwort.id).not.toBe(antwort.thread_id);
  });

  it('und eine Antwort auf die Antwort bleibt im SELBEN Faden', async () => {
    const w = await legeKontoAn(f.reinigung);
    const wurzel = await schreibeIntern(f.reinigung, w, 'Frage', { betreff: 'Vorgang' });
    const a1 = await schreibeIntern(f.reinigung, w, 'Erste', { antwortetAuf: wurzel.id });
    const a2 = await schreibeIntern(f.reinigung, w, 'Zweite', { antwortetAuf: a1.id });
    // Ohne diese Zusage wäre ein Vorgang nach drei Antworten in drei Fäden
    // geteilt — und jeder davon sähe vollständig aus.
    expect(a2.thread_id).toBe(wurzel.id);
  });

  it('eine Antwort auf eine Nachricht einer FREMDEN Gesellschaft geht nicht', async () => {
    const wR = await legeKontoAn(f.reinigung);
    const wB = await legeKontoAn(f.bau);
    const imBau = await schreibeIntern(f.bau, wB, 'Im Bau', { betreff: 'Bau' });
    /*
     * Zwei Riegel liegen davor, und der ERSTE spricht: `trg_thread_id` sucht
     * die Fadenwurzel innerhalb desselben Mandanten und findet keine, also
     * wirft es mit einer Begründung, die ein Mensch lesen kann. Der
     * zusammengesetzte Fremdschlüssel `nachricht_antwort_fk` hielte auch
     * allein — er käme nur mit „violates foreign key constraint" heraus.
     */
    await expect(schreibeIntern(f.reinigung, wR, 'Aus der Reinigung',
                                { antwortetAuf: imBau.id }))
      .rejects.toThrow(/kein Faden dieses Bereichs/u);
  });
});

describe('(2) § 7 UWG als Datenbankbedingung', () => {
  it('ausgehend ohne Rechtsgrundlage ist nicht speicherbar', async () => {
    const w = await legeKontoAn(f.reinigung);
    await expect(sql.unsafe(
      `insert into nachricht (mandant_id, koerper, richtung, kanal, akteur_art,
                              absender_benutzer_id)
       values ($1::uuid, 'Angebot!', 'ausgehend', 'portal', 'mensch', $2::uuid)`,
      [f.reinigung, w])).rejects.toThrow(/nachricht_ausgehend_grundlage/u);
  });

  it('und `keine` als Grundlage ist keine Grundlage', async () => {
    const w = await legeKontoAn(f.reinigung);
    await expect(sql.unsafe(
      `insert into nachricht (mandant_id, koerper, richtung, kanal, akteur_art,
                              absender_benutzer_id, rechtsgrundlage)
       values ($1::uuid, 'Angebot!', 'ausgehend', 'portal', 'mensch', $2::uuid, 'keine')`,
      [f.reinigung, w])).rejects.toThrow(/nachricht_ausgehend_grundlage/u);
  });

  it('INTERN darf ohne Grundlage — es verlässt das Haus nicht', async () => {
    const w = await legeKontoAn(f.reinigung);
    const n = await schreibeIntern(f.reinigung, w, 'Interne Notiz');
    expect(n.id).toBeTruthy();
  });
});

describe('(3) kein Agent sendet ohne Freigabe (Invariante 7)', () => {
  it('ausgehend als Agent ohne `freigabe_id` wird abgewiesen', async () => {
    const [a] = await sql.unsafe<{ id: string }[]>(`select id from agent limit 1`);
    await expect(sql.unsafe(
      `insert into nachricht (mandant_id, koerper, richtung, kanal, akteur_art,
                              absender_agent_id, rechtsgrundlage)
       values ($1::uuid, 'Entwurf', 'ausgehend', 'portal', 'agent', $2::uuid, 'bestandskunde')`,
      [f.reinigung, a!.id])).rejects.toThrow(/nachricht_agent_braucht_freigabe/u);
  });

  it('ein Agent als Absender muss BENANNT sein', async () => {
    await expect(sql.unsafe(
      `insert into nachricht (mandant_id, koerper, richtung, kanal, akteur_art)
       values ($1::uuid, 'Entwurf', 'intern', 'portal', 'agent')`,
      [f.reinigung])).rejects.toThrow(/nachricht_agent_benannt/u);
  });
});

describe('(4) das Sendetor fragt den Torwächter und schreibt den Beleg selbst', () => {
  it('ohne Ansprechpartner ist eine ausgehende E-Mail nicht belegbar', async () => {
    const w = await legeKontoAn(f.reinigung);
    await expect(sql.unsafe(
      `insert into nachricht (mandant_id, koerper, richtung, kanal, akteur_art,
                              absender_benutzer_id, rechtsgrundlage, zweck)
       values ($1::uuid, 'Angebot', 'ausgehend', 'email', 'mensch', $2::uuid,
               'einwilligung', 'werbung')`,
      [f.reinigung, w])).rejects.toThrow(/ohne Ansprechpartner/u);
  });

  it('`intern` ist kein Zweck für etwas, das hinausgeht', async () => {
    const w = await legeKontoAn(f.reinigung);
    const ap = await kontaktMitEinwilligung(f.reinigung);
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: w, portal: 'intern',
        readonly: false },
      async (tx: postgres.TransactionSql) => tx.unsafe(
        `insert into nachricht (mandant_id, koerper, richtung, kanal, akteur_art,
                                absender_benutzer_id, rechtsgrundlage_kontakt_id, zweck)
         values (app.aktiver_mandant(), 'Angebot', 'ausgehend', 'email', 'mensch',
                 app.aktueller_benutzer(), $1::uuid, 'intern')`,
        [ap] as never[]),
    )).rejects.toThrow(/nie ''intern''|nie 'intern'/u);
  });

  it('mit Einwilligung für E-Mail geht es — und die Grundlage wird GEZOGEN', async () => {
    const w = await legeKontoAn(f.reinigung);
    const ap = await kontaktMitEinwilligung(f.reinigung);
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: w, portal: 'intern',
        readonly: false },
      async (tx: postgres.TransactionSql) => tx.unsafe(
        `insert into nachricht (mandant_id, koerper, richtung, kanal, akteur_art,
                                absender_benutzer_id, rechtsgrundlage_kontakt_id, zweck,
                                rechtsgrundlage)
         values (app.aktiver_mandant(), 'Angebot', 'ausgehend', 'email', 'mensch',
                 app.aktueller_benutzer(), $1::uuid, 'werbung', 'anfrage')
         returning rechtsgrundlage::text as grundlage, zustell_status::text as stand`,
        [ap] as never[]),
    ) as readonly { grundlage: string; stand: string }[];
    /*
     * Der Aufrufer hat `anfrage` mitgeschickt; gespeichert ist
     * `einwilligung` — der Auslöser zieht den Wert selbst. Was der Dienst
     * Sekunden vorher gelesen hätte, gilt in diesem Moment vielleicht nicht
     * mehr: ein Widerspruch wirkt sofort.
     */
    expect(zeilen[0]?.grundlage).toBe('einwilligung');
    // Und nichts ist hinausgegangen: kein Versender ist verbunden (O-36).
    expect(zeilen[0]?.stand).toBe('ausstehend');
  });

  it('ohne Einwilligung für den Kanal wird abgewiesen', async () => {
    const w = await legeKontoAn(f.reinigung);
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                          rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
       values ($1::uuid, $2, 'Testkunde', 'einwilligung', 'Formular', now(), 'aktiv')
       returning id`, [f.reinigung, `K-${zufall()}`]);
    // Einwilligung nur für `post`, gesendet werden soll per E-Mail.
    const [ap] = await sql.unsafe<{ id: string }[]>(
      `insert into ansprechpartner (mandant_id, kunde_id, nachname, email, rechtsgrundlage,
                                    rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am,
                                    einwilligung_kanaele)
       values ($1::uuid, $2::uuid, 'Muster', $3, 'einwilligung', 'Formular', now(),
               array['post'])
       returning id`, [f.reinigung, k!.id, `k${zufall()}@example.test`]);

    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: w, portal: 'intern',
        readonly: false },
      async (tx: postgres.TransactionSql) => tx.unsafe(
        `insert into nachricht (mandant_id, koerper, richtung, kanal, akteur_art,
                                absender_benutzer_id, rechtsgrundlage_kontakt_id, zweck,
                                rechtsgrundlage)
         values (app.aktiver_mandant(), 'Angebot', 'ausgehend', 'email', 'mensch',
                 app.aktueller_benutzer(), $1::uuid, 'werbung', 'einwilligung')`,
        [ap!.id] as never[]),
    )).rejects.toThrow(/§ 7 UWG/u);
  });
});

describe('(5) `p_beteiligt` — je Empfängerart, nicht pauschal', () => {
  it('die Mandantengrenze gilt', async () => {
    const wR = await legeKontoAn(f.reinigung);
    const wB = await legeKontoAn(f.bau);
    await schreibeIntern(f.reinigung, wR, 'Nur in der Reinigung');
    expect(await titelIm('mandant',
      { mandantId: f.reinigung, benutzerId: wR, portal: 'intern' }))
      .toContain('Nur in der Reinigung');
    expect(await titelIm('mandant',
      { mandantId: f.bau, benutzerId: wB, portal: 'intern' }))
      .not.toContain('Nur in der Reinigung');
  });

  /**
   * **Der Kern von B11: `person` wird gegen die PERSONEN-Id geprüft.**
   *
   * Eine Anmelde-Id und eine `person.id` sind zwei verschiedene Ids. Wäre die
   * Policy gegen `app.aktueller_benutzer()` geschrieben, wäre eine an
   * `empfaenger_typ = 'person'` adressierte Nachricht für genau den Menschen
   * unsichtbar, dem sie geschickt wurde — EMP-11 hätte nicht funktioniert.
   */
  it('eine an `person` adressierte Nachricht erreicht diese Person', async () => {
    const chef = await legeKontoAn(f.reinigung);
    const ich = await legeKontoAn(f.reinigung, 'mitarbeiter', f.fatima);
    const n = await schreibeIntern(f.reinigung, chef, 'Für Fatima');
    await empfaenger(f.reinigung, n.id, 'person', f.fatima);

    expect(await titelIm('person', {
      mandantIds: [f.reinigung], benutzerId: ich, personId: f.fatima,
    })).toEqual(['Für Fatima']);
  });

  it('und eine an eine ANDERE Person adressierte nicht', async () => {
    const chef = await legeKontoAn(f.reinigung);
    const ich = await legeKontoAn(f.reinigung, 'mitarbeiter', f.fatima);
    const n = await schreibeIntern(f.reinigung, chef, 'Für Jonas');
    await empfaenger(f.reinigung, n.id, 'person', f.jonas);

    expect(await titelIm('person', {
      mandantIds: [f.reinigung], benutzerId: ich, personId: f.fatima,
    })).toEqual([]);
  });

  it('der eigene Gelesen-Stempel geht, ein fremder nicht', async () => {
    const chef = await legeKontoAn(f.reinigung);
    const ich = await legeKontoAn(f.reinigung, 'mitarbeiter', f.fatima);
    const meine = await schreibeIntern(f.reinigung, chef, 'Für Fatima');
    await empfaenger(f.reinigung, meine.id, 'person', f.fatima);
    const fremde = await schreibeIntern(f.reinigung, chef, 'Für Jonas');
    await empfaenger(f.reinigung, fremde.id, 'person', f.jonas);

    const getroffen = await alsApp(
      { scope: 'person', mandantIds: [f.reinigung], benutzerId: ich, personId: f.fatima,
        readonly: false },
      async (tx: postgres.TransactionSql) => tx.unsafe(
        `update nachricht_empfaenger set gelesen_am = now()
          where gelesen_am is null returning nachricht_id`),
    ) as readonly { nachricht_id: string }[];
    expect(getroffen.map((z) => z.nachricht_id)).toEqual([meine.id]);
  });

  it('`extern` ohne Adresse ist ein Empfänger, den niemand erreicht — abgewiesen', async () => {
    const w = await legeKontoAn(f.reinigung);
    const n = await schreibeIntern(f.reinigung, w, 'Text');
    await expect(empfaenger(f.reinigung, n.id, 'extern', null, null))
      .rejects.toThrow(/ne_extern_braucht_adresse/u);
  });

  it('und alles ausser `extern` braucht eine Id', async () => {
    const w = await legeKontoAn(f.reinigung);
    const n = await schreibeIntern(f.reinigung, w, 'Text');
    await expect(empfaenger(f.reinigung, n.id, 'person', null, null))
      .rejects.toThrow(/ne_id_oder_extern/u);
  });
});

describe('(6) geschlossen, nicht gelöscht (Invariante 8)', () => {
  it('geschlossen wird nur die WURZEL', async () => {
    const w = await legeKontoAn(f.reinigung);
    const wurzel = await schreibeIntern(f.reinigung, w, 'Frage', { betreff: 'Vorgang' });
    const antwort = await schreibeIntern(f.reinigung, w, 'Antwort',
                                         { antwortetAuf: wurzel.id });
    await expect(sql.unsafe(
      `update nachricht set geschlossen_am = now() where id = $1`, [antwort.id]))
      .rejects.toThrow(/nachricht_schliessen_nur_wurzel/u);

    const ok = await sql.unsafe(
      `update nachricht set geschlossen_am = now() where id = $1 returning id`,
      [wurzel.id]);
    expect(ok).toHaveLength(1);
  });

  it('`delete` greift auf keiner der drei Tabellen', async () => {
    const w = await legeKontoAn(f.reinigung);
    const n = await schreibeIntern(f.reinigung, w, 'Bleibt stehen');
    await empfaenger(f.reinigung, n.id, 'benutzer', w);
    const [d] = await sql.unsafe<{ id: string }[]>(
      `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel,
                             mime_typ, mime_verifiziert, groesse_bytes, exif_entfernt)
       values ($1::uuid, 'kunde', 'Anschreiben', $2, 'application/pdf', true, 100, true)
       returning id`, [f.reinigung, `rein/${zufall()}.pdf`]);
    await sql.unsafe(
      `insert into nachricht_anhang (mandant_id, nachricht_id, dokument_id)
       values ($1::uuid, $2::uuid, $3::uuid)`, [f.reinigung, n.id, d!.id]);

    /*
     * Je Tabelle eine Zeile, BEVOR gelöscht wird: ein `delete` auf eine leere
     * Tabelle trifft keine Zeile, feuert den BEFORE-DELETE-Auslöser gar nicht
     * und „besteht" die Prüfung, ohne sie geprüft zu haben. `truncate` fällt
     * dagegen auch auf der leeren Tabelle — der Auslöser dafür ist
     * anweisungsweise (0175).
     */
    for (const tabelle of ['nachricht_empfaenger', 'nachricht_anhang', 'nachricht']) {
      const [z] = await sql.unsafe<{ n: string }[]>(
        `select count(*)::text as n from ${tabelle}`);
      expect(Number(z!.n), `${tabelle} ist nicht leer`).toBeGreaterThan(0);
      await expect(sql.unsafe(`delete from ${tabelle}`), tabelle).rejects.toThrow();
      await expect(sql.unsafe(`truncate table ${tabelle}`), tabelle).rejects.toThrow();
    }
  });

  it('ein Anhang gehört derselben Gesellschaft wie seine Nachricht', async () => {
    const wR = await legeKontoAn(f.reinigung);
    const n = await schreibeIntern(f.reinigung, wR, 'Mit Anhang');
    const [d] = await sql.unsafe<{ id: string }[]>(
      `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel,
                             mime_typ, mime_verifiziert, groesse_bytes, exif_entfernt)
       values ($1::uuid, 'kunde', 'Kalkulation', $2, 'application/pdf', true, 100, true)
       returning id`, [f.bau, `bau/${zufall()}.pdf`]);
    // Anhänge sind der klassische Fehlversandweg: die Kalkulation der einen
    // Gesellschaft an den Kunden der anderen. Der zusammengesetzte
    // Fremdschlüssel macht es unmöglich.
    await expect(sql.unsafe(
      `insert into nachricht_anhang (mandant_id, nachricht_id, dokument_id)
       values ($1::uuid, $2::uuid, $3::uuid)`, [f.reinigung, n.id, d!.id]))
      .rejects.toThrow(/na_dokument_fk/u);
  });
});
