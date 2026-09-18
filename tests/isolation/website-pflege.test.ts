/**
 * Die Website-Pflege gegen ECHTE Policies, echte Rechte und echte Auslöser
 * (§5.21, PRO-01 … PRO-05, PUB-07, PUB-11, REQ-01 … REQ-04, Invariante 3,
 * Invariante 8).
 *
 * **Die Sätze, die diese Datei beweist — jeder fällt ohne die Umsetzung:**
 *
 *  1. `abschnitt` hat KEINE `mandant_id`, und `t_abschnitt_pflege` prüft nur
 *     das Recht im aktiven Bereich. Ohne die Pfadbindung im Dienst
 *     (`EIGENE_PROFILSEITE`) änderte Reinigung die Leistungen von Bau. Der
 *     Test fährt genau das (O-49).
 *  2. `jsonb_set` lässt die FAQ desselben Abschnitts stehen. Ein
 *     `set daten = …` löschte sie mit — zwei Einträge weniger auf einer Seite,
 *     die niemand angefasst hat.
 *  3. Ein Leistungseintrag ohne Namen wird ABGEWIESEN, nicht weggelassen; zwei
 *     gleiche Namen ebenso.
 *  4. Der fehlende Leistungsabschnitt (CSE Operations) entsteht auf
 *     `max(reihenfolge) + 1` — inklusive der gelöschten, denn
 *     `abschnitt_reihenfolge_uk` filtert nicht.
 *  5. Eine neue Formularversion trägt Felder und Zuständigkeit; die alte
 *     bleibt unangetastet, und `formular_definition_live_uk` lässt nie zwei
 *     lebende Versionen zu.
 *  6. Eine veröffentlichte Formularversion ist in ihren FELDERN eingefroren
 *     (`kern.formular_definition_unveraenderlich`) — in Titel und Beschreibung
 *     nicht.
 *  7. Der zum Internet offene Annahmeprinzipal (`ist_dienstkonto`, hält
 *     `formular.schreiben`) pflegt keine Website (O-682).
 *  8. Eine Kundenfreigabe ohne Datum oder ohne Beleg geht nicht durch — im
 *     Dienst UND als `referenz_freigabe_belegt` in der Tabelle. Das Datum
 *     landet als Berliner Mitternacht in UTC (Invariante 2).
 *  9. Ohne `referenz.kundenfreigabe_erfassen` ändert sich an einer Referenz
 *     NICHTS — auch nicht mit `referenz.schreiben`.
 * 10. Das Unternehmensprofil wird je SPRACHE veröffentlicht (D-82); eine
 *     Sprachfassung mitzureissen ist nicht möglich.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  RedaktionFehler, aendereProfil, aendereReferenz, bilderZurWahl, erfasseKundenfreigabe,
  ladeLeistungsAbschnitt, ladeReferenzZurPflege, legeLeistungsAbschnittAn, listeProfile,
  listeProfilseiten, setzeLeistungen, setzeProfilStatus,
} from '../../src/server/services/inhalt/redaktion.js';
import {
  aendereFormularKopf, istDienstkonto, ladeFormularZurPflege, legeNeueVersionAn,
  listeFormulare, setzeZustaendigkeit, veroeffentlicheFormular, verweigereDienstkonto,
  waehlbareBenutzer, zieheFormularZurueck,
} from '../../src/server/services/inhalt/formular.js';
import {
  NEUIGKEITS_ARTEN, ladeBeitrag, listeBeitraege,
} from '../../src/server/services/social/dienst.js';
import { FORMULARE } from '../../src/server/db/seed/formulare.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

/** Der Kontext, den jeder Dienst erwartet — auf EINER gebundenen Transaktion. */
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

/** Läuft `fn` als angemeldeter Mensch in genau einem Bereich, SCHREIBEND. */
async function alsPflege<T>(
  mandant: string, benutzer: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, mandantIds: [mandant], benutzerId: benutzer,
      readonly: false, portal: 'intern' },
    async (tx) => fn(alsKontext(tx, mandant, benutzer)));
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/** Entzieht einer Rolle ein Recht in genau einem Bereich (Mandanten-Override). */
async function entziehe(rolle: string, recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, false from berechtigung b where b.schluessel = $3`,
    [await rolleId(rolle), mandant, recht]);
}

async function konto(
  mandantId: string, rolle = 'admin', dienstkonto = false,
): Promise<string> {
  const email = `web-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, ist_dienstkonto)
     values ($1, $2, $3, 'aktiv', $4)`,
    [u!.id, email, dienstkonto ? 'Formular-Eingang' : 'Administration', dienstkonto]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

/**
 * Eine Bereichsprofilseite, wie `pnpm content:import` sie anlegt: **ohne
 * `mandant_id`** (das ist der heutige Stand aller 26 Zeilen, O-49) und unter
 * `/unternehmen/<slug>`.
 */
async function profilseite(slug: string, sprache: string): Promise<string> {
  const [s] = await sql.unsafe<{ id: string }[]>(
    `insert into seite (pfad, sprache, titel, status, veroeffentlicht_am)
     values ($1, $2, $3, 'veroeffentlicht', now()) returning id`,
    [`/unternehmen/${slug}`, sprache, `Profil ${slug} ${sprache}`]);
  return s!.id;
}

async function leistungsAbschnitt(
  seiteId: string, reihenfolge: number, leistungen: readonly unknown[],
): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    /*
     * `$3::text::jsonb` und nicht `$3::jsonb`: `postgres.js` schickt eine
     * JS-Zeichenkette so, dass `$3::jsonb` daraus eine JSON-ZEICHENKETTE
     * macht — `jsonb_typeof(daten->'leistungen')` waere dann `string`, und
     * jede Pruefung darunter liefe gegen eine Fixtur, die es so nirgends
     * gibt. Der Umweg ueber `text` erzwingt das Parsen (dieselbe Falle wie in
     * `services/arbzg/detektor.ts`).
     */
    `insert into abschnitt (seite_id, art, reihenfolge, ueberschrift, daten)
     values ($1, 'leistungen', $2, 'Unsere Leistungen',
             jsonb_build_object('leistungen', $3::text::jsonb,
                                'faq', '[{"frage":"F?","antwort":"A."},
                                         {"frage":"G?","antwort":"B."}]'::jsonb))
     returning id`,
    [seiteId, reihenfolge, JSON.stringify(leistungen)]);
  return a!.id;
}

async function medium(mandantId: string | null, alt: string): Promise<string> {
  const [m] = await sql.unsafe<{ id: string }[]>(
    `insert into medien (mandant_id, pfad, alt_text, ist_platzhalter)
     values ($1::uuid, $2, $3, true) returning id`,
    [mandantId, `/bilder/${zufall()}.svg`, alt]);
  return m!.id;
}

async function referenz(mandantId: string, titel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into referenz (mandant_id, titel, kunde_name, jahr, sortierung)
     values ($1, $2, 'Demokunde', 2025, 0) returning id`,
    [mandantId, titel]);
  return r!.id;
}

async function profil(mandantId: string, sprache: string, status: string): Promise<string> {
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into unternehmensprofil (mandant_id, sprache, kurzbeschreibung, status)
     values ($1, $2, $3, $4::seite_status) returning id`,
    [mandantId, sprache, sprache === 'de' ? 'Gebäudereinigung' : 'Building cleaning',
     status]);
  return p!.id;
}

async function formular(
  mandantId: string, besitzer: string, live: boolean,
): Promise<string> {
  const vorlage = FORMULARE[0]!;
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into formular_definition
       (mandant_id, schluessel, version, titel, felder, datenschutz_hinweis_version,
        veroeffentlicht_am)
     values ($1, 'angebot_reinigung', 1, $2, $3::text::jsonb, '2026-09-01',
             case when $4 then now() else null end)
     returning id`,
    [mandantId, vorlage.titel, JSON.stringify(vorlage.felder), live]);
  await sql.unsafe(
    `insert into formular_zustaendigkeit
       (mandant_id, formular_definition_id, sla_stunden, standard_besitzer_benutzer_id)
     values ($1, $2, 24, $3)`,
    [mandantId, d!.id, besitzer]);
  return d!.id;
}

/**
 * Eine VERÖFFENTLICHTE Neuigkeit — mit der Freigabe, die `beitrag` verlangt.
 *
 * `app.beitrag_braucht_genehmigung` lässt `freigegeben`, `geplant` und
 * `veroeffentlicht` nur mit einer genehmigten `freigabe` derselben
 * Gesellschaft und der Aktion `social_veroeffentlichen` zu (Invariante 7).
 * Genau dieser Status ist hier der Punkt: er ist der einzige, den
 * `t_beitrag_oeffentlich` ohne jede Mandantenbedingung durchlässt.
 */
async function neuigkeit(mandantId: string, benutzer: string, titel: string): Promise<string> {
  const [fr] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, freigegeben_am, freigegeben_von)
     values ($1, 'social_veroeffentlichen', 'genehmigt', now(), $2) returning id`,
    [mandantId, benutzer]);
  /*
   * **Der Riegel schaut nur nach, wenn er den Mandanten kennt.**
   * `app.beitrag_braucht_genehmigung` fragt `app.freigabe_genehmigt` — einen
   * Definer, dessen Policy auf `freigabe` `mandant_id = app.aktiver_mandant()`
   * verlangt. Eine Rohverbindung ohne GUCs sieht null Zeilen und fällt in den
   * Riegel, und zwar richtig herum. Die Fixtur setzt deshalb denselben Kontext,
   * den `withTenant` auch setzt, statt den Riegel zu lockern.
   */
  const [b] = await sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.scope', 'mandant', true),
                            set_config('app.mandant_id', $1, true)`, [mandantId]);
    return tx.unsafe<{ id: string }[]>(
      `insert into beitrag (mandant_id, art, titel, text, slug, status,
                            veroeffentlicht_am, freigabe_id)
       values ($1, 'neuigkeit', $2, 'Volltext.', $3, 'veroeffentlicht', now(), $4)
       returning id`,
      [mandantId, titel, `n-${zufall()}`, fr!.id]);
  }) as unknown as { id: string }[];
  return b!.id;
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

// ---------------------------------------------------------------------------
// (1) … (5) Leistungen
// ---------------------------------------------------------------------------

describe('Leistungen: die Pfadbindung ist die einzige Mandantengrenze (O-49)', () => {
  it('die eigene Sprachfassung wird geändert — und die FAQ bleibt stehen', async () => {
    const seiteR = await profilseite('reinigung', 'de');
    const a = await leistungsAbschnitt(seiteR, 2, [{ name: 'Unterhaltsreinigung' }]);
    const admin = await konto(f.reinigung);

    await alsPflege(f.reinigung, admin, (k) => setzeLeistungen(k, a, [
      { name: 'Unterhaltsreinigung', beschreibung: 'Täglich, nach Revierplan.' },
      { name: 'Glasreinigung' },
    ]));

    const [z] = await sql.unsafe<{ leist: number; faq: number }[]>(
      `select jsonb_array_length(daten->'leistungen') as leist,
              jsonb_array_length(daten->'faq') as faq
         from abschnitt where id = $1`, [a]);
    expect(z!.leist).toBe(2);
    // Ohne `jsonb_set` wären hier 0 — zwei FAQ-Einträge weniger, ohne dass
    // jemand die FAQ angefasst hätte.
    expect(z!.faq).toBe(2);
  });

  it('REINIGUNG ändert die Leistungen von BAU nicht — obwohl RLS es liesse', async () => {
    const seiteB = await profilseite('bau', 'de');
    const fremd = await leistungsAbschnitt(seiteB, 2, [{ name: 'Rohbau' }]);
    const admin = await konto(f.reinigung);

    /*
     * `t_abschnitt_pflege` prüft `app.hat_recht('referenz.schreiben',
     * app.aktiver_mandant())` und NICHTS über die Seite — `abschnitt` hat gar
     * keine `mandant_id`. Nimm `EIGENE_PROFILSEITE` aus `setzeLeistungen`
     * heraus, und diese Prüfung fällt: Reinigung schriebe in die Profilseite
     * von Bau.
     */
    await expect(alsPflege(f.reinigung, admin, (k) => setzeLeistungen(k, fremd, [
      { name: 'Übernommen' },
    ]))).rejects.toThrow(RedaktionFehler);

    const [z] = await sql.unsafe<{ name: string }[]>(
      `select daten->'leistungen'->0->>'name' as name from abschnitt where id = $1`,
      [fremd]);
    expect(z!.name).toBe('Rohbau');
  });

  it('eine GRUPPENSEITE ist von hier aus unerreichbar', async () => {
    const [s] = await sql.unsafe<{ id: string }[]>(
      `insert into seite (pfad, sprache, titel, status, veroeffentlicht_am)
       values ('/leistungen', 'de', 'Leistungen', 'veroeffentlicht', now()) returning id`);
    const gruppe = await leistungsAbschnitt(s!.id, 2, [{ name: 'Gruppenleistung' }]);
    const admin = await konto(f.reinigung);

    await expect(alsPflege(f.reinigung, admin, (k) => setzeLeistungen(k, gruppe, [
      { name: 'Geändert' },
    ]))).rejects.toThrow(/nicht zur Profilseite/u);
  });

  it('ein leerer Name wird abgewiesen und nicht weggelassen', async () => {
    const s = await profilseite('security', 'de');
    const a = await leistungsAbschnitt(s, 2, [{ name: 'Objektschutz' }]);
    const admin = await konto(f.security);

    const fehler = await alsPflege(f.security, admin, (k) => setzeLeistungen(k, a, [
      { name: 'Objektschutz' }, { name: '   ' },
    ])).catch((e: unknown) => e);
    expect((fehler as RedaktionFehler).grund).toBe('name_fehlt');

    const [z] = await sql.unsafe<{ leist: number }[]>(
      `select jsonb_array_length(daten->'leistungen') as leist from abschnitt where id = $1`,
      [a]);
    expect(z!.leist).toBe(1);
  });

  it('zwei gleiche Namen ebenso — die öffentliche Liste nimmt den Namen als Schlüssel',
    async () => {
      const s = await profilseite('security', 'en');
      const a = await leistungsAbschnitt(s, 2, [{ name: 'Guarding' }]);
      const admin = await konto(f.security);

      const fehler = await alsPflege(f.security, admin, (k) => setzeLeistungen(k, a, [
        { name: 'Guarding' }, { name: 'Guarding' },
      ])).catch((e: unknown) => e);
      expect((fehler as RedaktionFehler).grund).toBe('name_doppelt');
    });

  it('der fehlende Abschnitt entsteht auf max(reihenfolge) + 1 — auch über Gelöschte',
    async () => {
      const s = await profilseite('operations', 'de');
      // hero = 1, text = 2, und eine GELÖSCHTE 3: `abschnitt_reihenfolge_uk`
      // filtert nicht, also ist 3 vergeben.
      await sql.unsafe(
        `insert into abschnitt (seite_id, art, reihenfolge) values ($1,'hero',1),($1,'text',2)`,
        [s]);
      await sql.unsafe(
        `insert into abschnitt (seite_id, art, reihenfolge, geloescht_am)
         values ($1,'text',3, now())`, [s]);
      const admin = await konto(f.operations);

      const neu = await alsPflege(f.operations, admin,
        (k) => legeLeistungsAbschnittAn(k, s, { name: 'Abläufe digitalisieren' }));

      const [z] = await sql.unsafe<{ reihenfolge: number; name: string }[]>(
        `select reihenfolge, daten->'leistungen'->0->>'name' as name
           from abschnitt where id = $1`, [neu]);
      expect(z!.reihenfolge).toBe(4);
      expect(z!.name).toBe('Abläufe digitalisieren');

      // Ein zweiter Abschnitt derselben Art entsteht NICHT.
      const zweiter = await alsPflege(f.operations, admin,
        (k) => legeLeistungsAbschnittAn(k, s, { name: 'Noch etwas' }))
        .catch((e: unknown) => e);
      expect((zweiter as RedaktionFehler).grund).toBe('nicht_angelegt');
    });

  it('ein Abschnitt ohne Namen entsteht gar nicht — ein leerer Block wäre öffentlich',
    async () => {
      const s = await profilseite('operations', 'en');
      const admin = await konto(f.operations);
      const fehler = await alsPflege(f.operations, admin,
        (k) => legeLeistungsAbschnittAn(k, s, { name: '  ' })).catch((e: unknown) => e);
      expect((fehler as RedaktionFehler).grund).toBe('name_fehlt');
    });

  it('die Liste zählt, was der LESER zeigt — nicht, was im Feld steht', async () => {
    const s = await profilseite('bau', 'en');
    // Drei Zeilen im Feld, eine ohne Namen: `leistungenAus` verwirft die
    // ganze Liste, also zeigt die öffentliche Seite NICHTS.
    await leistungsAbschnitt(s, 2, [{ name: 'A' }, { name: '' }, { name: 'C' }]);
    const admin = await konto(f.bau);

    const seiten = await alsPflege(f.bau, admin, (k) => listeProfilseiten(k));
    const en = seiten.find((x) => x.sprache === 'en');
    expect(en).toBeDefined();
    expect(en!.leistungsAbschnittId).not.toBeNull();
    expect(en!.eintraege).toBe(0);

    // Und die Detailseite sagt es als Warnung, nicht als „keine Einträge".
    const detail = await alsPflege(f.bau, admin,
      (k) => ladeLeistungsAbschnitt(k, en!.leistungsAbschnittId!));
    expect(detail!.datenUnlesbar).toBe(true);
  });

  it('die Liste zeigt nur die eigenen Profilseiten', async () => {
    await profilseite('reinigung', 'en');
    const admin = await konto(f.reinigung);
    const seiten = await alsPflege(f.reinigung, admin, (k) => listeProfilseiten(k));
    expect(seiten.length).toBeGreaterThan(0);
    for (const s of seiten) expect(s.pfad).toBe('/unternehmen/reinigung');
  });
});

// ---------------------------------------------------------------------------
// (5) … (7) Formulare
// ---------------------------------------------------------------------------

describe('Formulare: eine lebende Version wird nicht an ihrem Platz geändert', () => {
  it('Version + 1 trägt Felder UND Zuständigkeit, die alte bleibt live', async () => {
    const admin = await konto(f.reinigung);
    const v1 = await formular(f.reinigung, admin, true);

    const neu = await alsPflege(f.reinigung, admin, (k) => legeNeueVersionAn(k, v1));
    expect(neu.version).toBe(2);
    expect(neu.zustaendigkeitKopiert).toBe(true);

    const detail = await alsPflege(f.reinigung, admin,
      (k) => ladeFormularZurPflege(k, neu.id));
    expect(detail!.formular.zustand).toBe('entwurf');
    expect(detail!.felder.length).toBe(FORMULARE[0]!.felder.length);
    expect(detail!.formular.slaStunden).toBe(24);
    // Die alte Version ist unverändert live — das ist der ganze Punkt.
    expect(detail!.liveVersion?.version).toBe(1);
  });

  it('Veröffentlichen zieht die bisher lebende Version im gleichen Schritt zurück',
    async () => {
      const admin = await konto(f.reinigung);
      const v1 = await formular(f.reinigung, admin, true);
      const neu = await alsPflege(f.reinigung, admin, (k) => legeNeueVersionAn(k, v1));

      const ergebnis = await alsPflege(f.reinigung, admin,
        (k) => veroeffentlicheFormular(k, neu.id));
      expect(ergebnis.zurueckgezogeneVersion).toBe(1);

      const zeilen = await alsPflege(f.reinigung, admin, (k) => listeFormulare(k));
      const nachVersion = new Map(zeilen.map((z) => [z.version, z.zustand]));
      expect(nachVersion.get(1)).toBe('zurueckgezogen');
      expect(nachVersion.get(2)).toBe('live');
      /*
       * `formular_definition_live_uk` ist `unique (mandant_id, schluessel)
       * where veroeffentlicht_am is not null and zurueckgezogen_am is null` —
       * genau EINE lebende Version. Zwei getrennte Klicks hätten dazwischen
       * ein Loch, in dem `/angebot/reinigung` mit 404 antwortet.
       */
      expect([...nachVersion.values()].filter((z) => z === 'live')).toHaveLength(1);
    });

  it('eine schon lebende Version wird nicht zweimal veröffentlicht', async () => {
    const admin = await konto(f.reinigung);
    const v1 = await formular(f.reinigung, admin, true);
    const fehler = await alsPflege(f.reinigung, admin,
      (k) => veroeffentlicheFormular(k, v1)).catch((e: unknown) => e);
    expect((fehler as RedaktionFehler).grund).toBe('schon_live');
  });

  it('Zurückziehen lässt kein lebendes Formular zurück — und sagt es nur einmal',
    async () => {
      const admin = await konto(f.reinigung);
      const v1 = await formular(f.reinigung, admin, true);
      await alsPflege(f.reinigung, admin, (k) => zieheFormularZurueck(k, v1));

      const zeilen = await alsPflege(f.reinigung, admin, (k) => listeFormulare(k));
      expect(zeilen[0]!.zustand).toBe('zurueckgezogen');

      // Ein zweites Zurückziehen ist ein Fehlschlag mit Grund, kein stilles „ok".
      const fehler = await alsPflege(f.reinigung, admin,
        (k) => zieheFormularZurueck(k, v1)).catch((e: unknown) => e);
      expect((fehler as RedaktionFehler).grund).toBe('nicht_geaendert');
    });

  it('Titel und Beschreibung sind an einer LEBENDEN Version änderbar, die Felder nicht',
    async () => {
      const admin = await konto(f.reinigung);
      const v1 = await formular(f.reinigung, admin, true);

      await alsPflege(f.reinigung, admin, (k) => aendereFormularKopf(k, v1, {
        titel: 'Angebot anfragen', beschreibung: 'Ein Satz über den Feldern.',
      }));
      const [z] = await sql.unsafe<{ titel: string }[]>(
        `select titel from formular_definition where id = $1`, [v1]);
      expect(z!.titel).toBe('Angebot anfragen');

      // Die Felder: `kern.formular_definition_unveraenderlich` wirft.
      await expect(sql.unsafe(
        `update formular_definition set felder = '[]'::jsonb where id = $1`, [v1],
      )).rejects.toThrow(/eingefroren/u);
    });

  it('ein Titel darf nicht leer werden — die öffentliche Seite hätte keine Überschrift',
    async () => {
      const admin = await konto(f.reinigung);
      const v1 = await formular(f.reinigung, admin, true);
      const fehler = await alsPflege(f.reinigung, admin, (k) => aendereFormularKopf(k, v1, {
        titel: '   ', beschreibung: null,
      })).catch((e: unknown) => e);
      expect((fehler as RedaktionFehler).grund).toBe('titel_fehlt');
    });

  it('der Annahmeprinzipal pflegt keine Website (O-682)', async () => {
    /*
     * `formular.schreiben` hält auch die Rolle `formular_eingang` — der zum
     * Internet offene Annahmeprinzipal (03-AUTH §14.3, `ist_dienstkonto`). Er
     * braucht das Recht, um eine Einsendung zu speichern, und soll damit KEIN
     * öffentliches Formular zurückziehen können. Vor dieser Pflegeseite gab es
     * im Portal keinen Schreibweg auf `formular_definition`; das Recht war
     * latent.
     */
    const dienst = await konto(f.reinigung, 'admin', true);
    const mensch = await konto(f.reinigung);

    expect(await alsPflege(f.reinigung, dienst, (k) => istDienstkonto(k))).toBe(true);
    expect(await alsPflege(f.reinigung, mensch, (k) => istDienstkonto(k))).toBe(false);

    const fehler = await alsPflege(f.reinigung, dienst, (k) => verweigereDienstkonto(k))
      .catch((e: unknown) => e);
    expect((fehler as RedaktionFehler).grund).toBe('dienstkonto');
    await expect(alsPflege(f.reinigung, mensch, (k) => verweigereDienstkonto(k)))
      .resolves.toBeUndefined();
  });

  it('ein Besitzer aus einer FREMDEN Gesellschaft wird abgewiesen', async () => {
    const admin = await konto(f.reinigung);
    const fremder = await konto(f.bau);
    const v1 = await formular(f.reinigung, admin, true);

    /*
     * `formular_zustaendigkeit.eskalation_benutzer_id` zeigt auf `benutzer(id)`
     * OHNE Mandanten. Ohne die Mitgliedsprüfung im Dienst stünde der Mensch
     * einer anderen Gesellschaft als Eskalationsziel — und bekäme eine
     * Benachrichtigung über eine fremde Anfrage.
     */
    const fehler = await alsPflege(f.reinigung, admin, (k) => setzeZustaendigkeit(k, v1, {
      besitzerId: null, eskalationId: fremder, slaStunden: 24,
    })).catch((e: unknown) => e);
    expect((fehler as RedaktionFehler).grund).toBe('benutzer_unbekannt');
  });

  it('die Reaktionszeit lässt sich ändern und auf „keine Frist" setzen (O-14)', async () => {
    const admin = await konto(f.reinigung);
    const v1 = await formular(f.reinigung, admin, true);

    await alsPflege(f.reinigung, admin, (k) => setzeZustaendigkeit(k, v1, {
      besitzerId: null, eskalationId: null, slaStunden: 48,
    }));
    let zeilen = await alsPflege(f.reinigung, admin, (k) => listeFormulare(k));
    expect(zeilen[0]!.slaStunden).toBe(48);

    await alsPflege(f.reinigung, admin, (k) => setzeZustaendigkeit(k, v1, {
      besitzerId: null, eskalationId: null, slaStunden: null,
    }));
    zeilen = await alsPflege(f.reinigung, admin, (k) => listeFormulare(k));
    expect(zeilen[0]!.slaStunden).toBeNull();
    expect(zeilen[0]!.hatZustaendigkeit).toBe(true);

    // Null ist erlaubt, null Stunden nicht (`sla_stunden > 0`).
    const fehler = await alsPflege(f.reinigung, admin, (k) => setzeZustaendigkeit(k, v1, {
      besitzerId: null, eskalationId: null, slaStunden: 0,
    })).catch((e: unknown) => e);
    expect((fehler as RedaktionFehler).grund).toBe('sla_ungueltig');
  });

  it('ein Formular einer fremden Gesellschaft ist hier nicht sichtbar (Invariante 3)',
    async () => {
      const adminR = await konto(f.reinigung);
      const adminB = await konto(f.bau);
      const v1 = await formular(f.reinigung, adminR, true);

      expect(await alsPflege(f.bau, adminB, (k) => listeFormulare(k))).toHaveLength(0);
      expect(await alsPflege(f.bau, adminB, (k) => ladeFormularZurPflege(k, v1))).toBeNull();
    });

  it('ohne `formular.lesen` bleiben Zuständigkeit und Eingänge LEER, nicht null', async () => {
    /*
     * `t_formular_schreiben` ist `for all` — wer `formular.schreiben` hält,
     * liest die Definitionen. `t_zustaendigkeit` und `t_eingang_lesen`
     * verlangen dagegen `formular.lesen`. Die Rolle `formular_eingang` hält
     * das erste ausdrücklich ohne das zweite; für sie sieht ein gepflegtes
     * Formular unbetreut aus. Deshalb sagt die Seite „nicht lesbar" und nicht
     * „keine Zuständigkeit".
     */
    const admin = await konto(f.reinigung);
    const v1 = await formular(f.reinigung, admin, true);
    await entziehe('admin', 'formular.lesen', f.reinigung);
    const ohne = await konto(f.reinigung);

    const zeilen = await alsPflege(f.reinigung, ohne, (k) => listeFormulare(k));
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.id).toBe(v1);
    expect(zeilen[0]!.hatZustaendigkeit).toBe(false);
    expect(zeilen[0]!.slaStunden).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (8) … (9) Referenzen
// ---------------------------------------------------------------------------

describe('Referenzen: die Kundenfreigabe ist die Bedingung, nicht ein Häkchen', () => {
  it('ohne Datum und ohne Beleg geht sie nicht durch — und die Tabelle hält nach',
    async () => {
      const admin = await konto(f.reinigung);
      const r = await referenz(f.reinigung, 'Bürohaus Mitte');

      const ohneDatum = await alsPflege(f.reinigung, admin,
        (k) => erfasseKundenfreigabe(k, r, { freigegeben: true, am: null, beleg: 'Mail' }))
        .catch((e: unknown) => e);
      expect((ohneDatum as RedaktionFehler).grund).toBe('freigabe_ohne_datum');

      const ohneBeleg = await alsPflege(f.reinigung, admin,
        (k) => erfasseKundenfreigabe(k, r,
          { freigegeben: true, am: '2026-03-29', beleg: '  ' }))
        .catch((e: unknown) => e);
      expect((ohneBeleg as RedaktionFehler).grund).toBe('freigabe_ohne_beleg');

      // Die zweite Linie: `referenz_freigabe_belegt` lässt es auch direkt nicht zu.
      await expect(sql.unsafe(
        `update referenz set freigegeben_vom_kunden = true, freigabe_am = null
          where id = $1`, [r],
      )).rejects.toThrow(/referenz_freigabe_belegt/u);
    });

  it('mit Datum und Beleg steht sie — als Berliner Mitternacht in UTC (Invariante 2)',
    async () => {
      const admin = await konto(f.reinigung);
      const r = await referenz(f.reinigung, 'Wohnanlage Nord');

      /*
       * Der 29. März 2026 ist die Nacht der Zeitumstellung. Berliner
       * Mitternacht liegt an diesem Tag noch in der Winterzeit (UTC+1), also
       * 28.03. 23:00 UTC. `($1::date) at time zone 'Europe/Berlin'` hätte hier
       * 02:00 zonenlos ergeben — die falsche Überladung (Wache
       * `wacheDatumZone`), und der Tag wäre um Stunden verschoben.
       */
      await alsPflege(f.reinigung, admin, (k) => erfasseKundenfreigabe(k, r, {
        freigegeben: true, am: '2026-03-29', beleg: 'E-Mail des Kunden vom 29.03.2026',
      }));

      const [z] = await sql.unsafe<{ utc: string; berlin: string }[]>(
        `select to_char(freigabe_am at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as utc,
                to_char(freigabe_am at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI')
                  as berlin
           from referenz where id = $1`, [r]);
      expect(z!.utc).toBe('2026-03-28 23:00');
      expect(z!.berlin).toBe('2026-03-29 00:00');
    });

  it('Zurücknehmen räumt Datum und Beleg mit ab', async () => {
    const admin = await konto(f.reinigung);
    const r = await referenz(f.reinigung, 'Praxis Süd');
    await alsPflege(f.reinigung, admin, (k) => erfasseKundenfreigabe(k, r, {
      freigegeben: true, am: '2026-02-01', beleg: 'Vertragsklausel 7.2',
    }));
    await alsPflege(f.reinigung, admin, (k) => erfasseKundenfreigabe(k, r, {
      freigegeben: false, am: '2026-02-01', beleg: 'Vertragsklausel 7.2',
    }));

    const d = await alsPflege(f.reinigung, admin, (k) => ladeReferenzZurPflege(k, r));
    expect(d!.freigegeben).toBe(false);
    // Ein stehengebliebenes Datum läse sich wie eine versehentlich
    // abgehakte Freigabe.
    expect(d!.freigabeAm).toBeNull();
    expect(d!.freigabeBeleg).toBeNull();
  });

  it('ein Bild einer FREMDEN Gesellschaft geht nicht unter dieses Projekt', async () => {
    const admin = await konto(f.reinigung);
    const r = await referenz(f.reinigung, 'Schule West');
    const fremdesBild = await medium(f.bau, 'Eine Baustelle im Rohbau');

    /*
     * `t_medien_oeffentlich` liest `medien` mit `using (true)` — RLS grenzt
     * hier GAR NICHTS ein, und `referenz_medien_id_fkey` kennt keinen
     * Mandanten. Ohne die Prüfung im Dienst stünde ein Bild von einer
     * Security-Baustelle unter einem Reinigungsprojekt.
     */
    const fehler = await alsPflege(f.reinigung, admin, (k) => aendereReferenz(k, r, {
      titel: 'Schule West', slug: 'schule-west', kundeName: null, beschreibung: null,
      jahr: 2025, medienId: fremdesBild, sortierung: 0,
    })).catch((e: unknown) => e);
    expect((fehler as RedaktionFehler).grund).toBe('bild_fremd');
  });

  it('das eigene Bild geht durch, und die Auswahlliste zeigt nur die eigenen', async () => {
    const admin = await konto(f.reinigung);
    const r = await referenz(f.reinigung, 'Hotel Ost');
    const eigen = await medium(f.reinigung, 'Heller Innenraum mit Betonwänden');
    await medium(f.bau, 'Eine Baustelle im Rohbau');
    await medium(null, 'Ein Bild der Gruppe');

    await alsPflege(f.reinigung, admin, (k) => aendereReferenz(k, r, {
      titel: 'Hotel Ost', slug: 'hotel-ost', kundeName: 'Demokunde',
      beschreibung: 'Unterhaltsreinigung im laufenden Betrieb.', jahr: 2025,
      medienId: eigen, sortierung: 2,
    }));

    const d = await alsPflege(f.reinigung, admin, (k) => ladeReferenzZurPflege(k, r));
    expect(d!.slug).toBe('hotel-ost');
    expect(d!.medienId).toBe(eigen);
    expect(d!.sortierung).toBe(2);

    const bilder = await alsPflege(f.reinigung, admin, (k) => bilderZurWahl(k));
    expect(bilder.map((b) => b.id)).toEqual([eigen]);
  });

  it('ein Slug ausserhalb der Form wird abgewiesen — er ist eine Adresse', async () => {
    const admin = await konto(f.reinigung);
    const r = await referenz(f.reinigung, 'Lager Nordwest');
    const fehler = await alsPflege(f.reinigung, admin, (k) => aendereReferenz(k, r, {
      titel: 'Lager', slug: 'Lager Nordwest!', kundeName: null, beschreibung: null,
      jahr: null, medienId: null, sortierung: 0,
    })).catch((e: unknown) => e);
    expect((fehler as RedaktionFehler).grund).toBe('slug_form');
  });

  it('ohne `referenz.kundenfreigabe_erfassen` ändert sich NICHTS', async () => {
    /*
     * `t_referenz_pflege` verlangt das Recht in ihrer `with check` — für JEDEN
     * Schreibvorgang auf dieser Tabelle, nicht nur für das Häkchen. Wer nur
     * `referenz.schreiben` hält, sähe Formulare, die nichts tun; der Dienst
     * meldet es als Fehlschlag mit Grund.
     */
    const r = await referenz(f.security, 'Objekt Alpha');
    await entziehe('admin', 'referenz.kundenfreigabe_erfassen', f.security);
    const admin = await konto(f.security);

    const fehler = await alsPflege(f.security, admin, (k) => aendereReferenz(k, r, {
      titel: 'Anders', slug: 'anders', kundeName: null, beschreibung: null,
      jahr: null, medienId: null, sortierung: 0,
    })).catch((e: unknown) => e);
    /*
     * `kein_freigaberecht` und nicht `nicht_geaendert`: die `with check` von
     * `t_referenz_pflege` WIRFT (42501), statt null Zeilen zu liefern — die
     * Zeile ist über `using` (dort genügt `referenz.lesen`) ja sichtbar. Ohne
     * die Vorprüfung im Dienst bekäme ein Mensch hier einen 500.
     */
    expect((fehler as RedaktionFehler).grund).toBe('kein_freigaberecht');

    const [z] = await sql.unsafe<{ titel: string }[]>(
      `select titel from referenz where id = $1`, [r]);
    expect(z!.titel).toBe('Objekt Alpha');
  });

  it('eine Referenz einer fremden Gesellschaft ist 404 und nicht 403 (AUT-06)', async () => {
    const r = await referenz(f.reinigung, 'Nur bei Reinigung');
    const adminB = await konto(f.bau);
    expect(await alsPflege(f.bau, adminB, (k) => ladeReferenzZurPflege(k, r))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (10) Unternehmensprofil
// ---------------------------------------------------------------------------

describe('Unternehmensprofil: eine Zeile je Sprache (D-82)', () => {
  it('de und en werden getrennt veröffentlicht', async () => {
    const admin = await konto(f.reinigung);
    const de = await profil(f.reinigung, 'de', 'veroeffentlicht');
    const en = await profil(f.reinigung, 'en', 'entwurf');

    let profile = await alsPflege(f.reinigung, admin, (k) => listeProfile(k));
    expect(profile.map((p) => p.sprache)).toEqual(['de', 'en']);
    expect(profile.find((p) => p.sprache === 'en')!.status).toBe('entwurf');

    await alsPflege(f.reinigung, admin, (k) => setzeProfilStatus(k, en, true));
    profile = await alsPflege(f.reinigung, admin, (k) => listeProfile(k));
    expect(profile.find((p) => p.sprache === 'en')!.status).toBe('veroeffentlicht');
    // Die deutsche Zeile ist NICHT mitgereist.
    expect(profile.find((p) => p.sprache === 'de')!.status).toBe('veroeffentlicht');

    await alsPflege(f.reinigung, admin, (k) => setzeProfilStatus(k, de, false));
    profile = await alsPflege(f.reinigung, admin, (k) => listeProfile(k));
    expect(profile.find((p) => p.sprache === 'de')!.status).toBe('entwurf');
    expect(profile.find((p) => p.sprache === 'en')!.status).toBe('veroeffentlicht');
  });

  it('die Texte werden geändert, die Grenzen der Tabelle gelten', async () => {
    const admin = await konto(f.bau);
    const de = await profil(f.bau, 'de', 'entwurf');

    await alsPflege(f.bau, admin, (k) => aendereProfil(k, de, {
      kurzbeschreibung: 'Hochbau, Ausbau, Rückbau',
      beschreibung: 'Berliner Baustellen seit Jahren.', gruendung: 2011,
      mitarbeiterZahl: 42,
    }));
    const profile = await alsPflege(f.bau, admin, (k) => listeProfile(k));
    expect(profile[0]!.gruendung).toBe(2011);
    expect(profile[0]!.mitarbeiterZahl).toBe(42);

    for (const [felder, grund] of [
      [{ kurzbeschreibung: '  ', beschreibung: null, gruendung: null,
        mitarbeiterZahl: null }, 'kurzbeschreibung_fehlt'],
      [{ kurzbeschreibung: 'X', beschreibung: null, gruendung: 1899,
        mitarbeiterZahl: null }, 'gruendung_ungueltig'],
      [{ kurzbeschreibung: 'X', beschreibung: null, gruendung: null,
        mitarbeiterZahl: -1 }, 'mitarbeiter_ungueltig'],
    ] as const) {
      const fehler = await alsPflege(f.bau, admin, (k) => aendereProfil(k, de, felder))
        .catch((e: unknown) => e);
      expect((fehler as RedaktionFehler).grund).toBe(grund);
    }
  });

  it('das Profil einer fremden Gesellschaft ist hier unsichtbar (Invariante 3)', async () => {
    await profil(f.security, 'de', 'veroeffentlicht');
    const adminO = await konto(f.operations);
    expect(await alsPflege(f.operations, adminO, (k) => listeProfile(k))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Die Gruppenansicht
// ---------------------------------------------------------------------------

describe('die Gruppenansicht liest und schreibt nicht (Invariante 10)', () => {
  it('ein Schreibversuch in der Gruppenansicht geht nicht durch', async () => {
    const s = await profilseite('reinigung', 'de');
    const a = await leistungsAbschnitt(s, 2, [{ name: 'Unterhaltsreinigung' }]);
    const admin = await konto(f.reinigung);

    /*
     * `app.readonly = 'on'`, und jede `with check` im Haus trägt
     * `not app.ist_readonly()`. Der Kontext einer Gruppensitzung hat gar keine
     * Schreibmethode (K-18), und `authorize({ schreibend: true })` weist die
     * Gruppenansicht vorher ab — hier wird der Kontext trotzdem gebaut, um die
     * DRITTE Linie zu prüfen: die Policy selbst.
     *
     * **Und sie WIRFT, sie filtert nicht.** Eine `with check`-Bedingung
     * erzeugt `42501`, keine null Zeilen; die Regel dieses Moduls („null
     * geänderte Zeilen sind ein Fehler mit Grund") greift dort gar nicht.
     * Genau deshalb prüft `pruefeFreigaberecht` das Recht VOR dem `update` —
     * sonst läse ein Mensch „Da ist etwas schiefgegangen" statt eines Satzes.
     */
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung],
        benutzerId: admin, readonly: true, portal: 'intern' },
      async (tx) => setzeLeistungen(alsKontext(tx, f.reinigung, admin), a, [
        { name: 'Aus der Gruppenansicht' },
      ]),
    )).rejects.toThrow(/row-level security/u);
  });
});

describe('die Benutzerliste hängt an `system.benutzer_lesen`', () => {
  it('ohne das Recht ist sie leer — und die Seite bietet dann keine Auswahl', async () => {
    await konto(f.operations);
    await entziehe('admin', 'system.benutzer_lesen', f.operations);
    const ohne = await konto(f.operations);

    const liste = await alsPflege(f.operations, ohne, (k) => waehlbareBenutzer(k));
    /*
     * `t_benutzer_lesen` lässt die EIGENE Zeile immer durch
     * (`id = app.aktueller_benutzer()`); die Liste ist also nicht leer,
     * sondern auf einen zusammengeschrumpft. Genau deshalb darf ein leeres
     * Auswahlfeld den Besitzer nicht auf nichts setzen — `setzeZustaendigkeit`
     * liest `null` als „unverändert lassen".
     */
    expect(liste.map((b) => b.id)).toEqual([ohne]);
  });
});

// ---------------------------------------------------------------------------
// (12) Die Mandantengrenze von `beitrag` — der Befund, der diese Zeile brachte
// ---------------------------------------------------------------------------

describe('Neuigkeiten: der Dienst zieht die Mandantengrenze, nicht die Policy', () => {
  /**
   * **Warum RLS hier NICHT reicht.** `beitrag` trägt zwei erlaubende
   * Lesepolicies: `t_beitrag_lesen` (aktiver Mandant + `social.lesen`) und
   * `t_beitrag_oeffentlich` (`status = 'veroeffentlicht' and zurueckgezogen_am
   * is null`, ohne Mandantenbedingung — die öffentliche Seite läuft ohne
   * Sitzung). Erlaubende Policies werden ver-ODER-t, und eine restriktive
   * SELECT-Decke gibt es auf dieser Tabelle bewusst nicht (0163). Eine
   * Abfrage ohne eigene Bedingung sah damit die veröffentlichten Neuigkeiten
   * ALLER vier Gesellschaften — und die Seite druckte dazu eine Adresse unter
   * dem AKTIVEN Bereich, die öffentlich mit 404 antwortet.
   *
   * Invariante 3 sagt dazu den Satz, den dieser Test festhält: RLS ist die
   * zweite Linie, nie die einzige.
   */
  it('eine Neuigkeit einer fremden Gesellschaft steht nicht in dieser Liste', async () => {
    const adminR = await konto(f.reinigung);
    const adminB = await konto(f.bau);
    await neuigkeit(f.reinigung, adminR, 'Reinigung Neuigkeit');
    await neuigkeit(f.bau, adminB, 'BAU Neuigkeit — fremde Gesellschaft');

    const liste = await alsPflege(f.reinigung, adminR, (k) =>
      listeBeitraege(k, { arten: NEUIGKEITS_ARTEN }));
    expect(liste.map((b) => b.titel)).toEqual(['Reinigung Neuigkeit']);
  });

  it('und ist über ihre Kennung nicht ladbar — 404 und nicht 403 (AUT-06)', async () => {
    const adminR = await konto(f.reinigung);
    const adminB = await konto(f.bau);
    const fremd = await neuigkeit(f.bau, adminB, 'BAU Neuigkeit — fremde Gesellschaft');

    expect(await alsPflege(f.reinigung, adminR, (k) => ladeBeitrag(k, fremd))).toBeNull();
    expect(await alsPflege(f.bau, adminB, (k) => ladeBeitrag(k, fremd))).not.toBeNull();
  });

  it('der VERÖFFENTLICHTE Stand ist der Fall — ein Entwurf war nie sichtbar', async () => {
    /*
     * Die Gegenprobe, damit der Test nicht aus dem falschen Grund grün ist:
     * ohne `t_beitrag_oeffentlich` hätte `t_beitrag_lesen` die fremde Zeile
     * ohnehin geschluckt. Der Beleg, dass die LÜCKE am Status hängt, steht
     * deshalb auf der Ebene, auf der sie entstand — der nackten Abfrage ohne
     * Mandantenbedingung.
     */
    const adminR = await konto(f.reinigung);
    const adminB = await konto(f.bau);
    const fremd = await neuigkeit(f.bau, adminB, 'BAU Neuigkeit — fremde Gesellschaft');

    const roh = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung],
        benutzerId: adminR, readonly: false, portal: 'intern' },
      async (tx) => tx.unsafe(`select id from beitrag where id = $1::uuid`, [fremd]));
    expect(roh.length, 'die Policy allein lässt die fremde Zeile durch').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (13) Der Slug einer Referenz ist eine ADRESSE — je Gesellschaft einmal
// ---------------------------------------------------------------------------

describe('Referenzen: der Slug ist je Gesellschaft eindeutig', () => {
  it('ein schon vergebener Slug wird mit Grund abgewiesen, nicht als 23505', async () => {
    /*
     * `referenz_slug_uk` weist die Kollision ohnehin ab — aber als roher
     * `PostgresError`, und `fuehreWebsiteAus` fängt nur `RedaktionFehler` ab:
     * der Bediener sah einen 500 statt eines Satzes. Der Weg ist nicht
     * konstruiert: bei leerem Slug-Feld bildet die Route den Slug über
     * `app.slug_aus_titel(titel)`, und zwei ähnliche Projekttitel geben
     * denselben.
     */
    const admin = await konto(f.reinigung);
    const erste = await referenz(f.reinigung, 'Büroreinigung Mitte');
    const zweite = await referenz(f.reinigung, 'Büroreinigung Mitte Nord');
    await alsPflege(f.reinigung, admin, (k) => aendereReferenz(k, erste, {
      titel: 'Büroreinigung Mitte', slug: 'bueroreinigung-mitte', kundeName: null,
      beschreibung: null, jahr: null, medienId: null, sortierung: 0,
    }));

    const fehler = await alsPflege(f.reinigung, admin, (k) => aendereReferenz(k, zweite, {
      titel: 'Büroreinigung Mitte Nord', slug: 'bueroreinigung-mitte', kundeName: null,
      beschreibung: null, jahr: null, medienId: null, sortierung: 0,
    })).catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(RedaktionFehler);
    expect((fehler as RedaktionFehler).grund).toBe('slug_vergeben');
  });

  it('auch eine GELÖSCHTE Referenz hält ihren Slug (Invariante 8)', async () => {
    /*
     * `referenz_slug_uk` ist `unique (mandant_id, slug)` OHNE Teilbedingung
     * auf `geloescht_am` — und `ladeReferenzZurPflege` filtert die gelöschte
     * heraus. Ohne diesen Satz sähe der Mensch nicht, wer den Slug hält.
     */
    const admin = await konto(f.reinigung);
    const weg = await referenz(f.reinigung, 'Altes Projekt');
    await alsPflege(f.reinigung, admin, (k) => aendereReferenz(k, weg, {
      titel: 'Altes Projekt', slug: 'altes-projekt', kundeName: null,
      beschreibung: null, jahr: null, medienId: null, sortierung: 0,
    }));
    await sql.unsafe(`update referenz set geloescht_am = now() where id = $1`, [weg]);

    const neue = await referenz(f.reinigung, 'Neues Projekt');
    const fehler = await alsPflege(f.reinigung, admin, (k) => aendereReferenz(k, neue, {
      titel: 'Neues Projekt', slug: 'altes-projekt', kundeName: null,
      beschreibung: null, jahr: null, medienId: null, sortierung: 0,
    })).catch((e: unknown) => e);
    expect((fehler as RedaktionFehler).grund).toBe('slug_vergeben');
  });

  it('derselbe Slug in einer ANDEREN Gesellschaft geht durch', async () => {
    const adminR = await konto(f.reinigung);
    const adminB = await konto(f.bau);
    const r = await referenz(f.reinigung, 'Halle Ost');
    const b = await referenz(f.bau, 'Halle Ost');
    const felder = {
      titel: 'Halle Ost', slug: 'halle-ost', kundeName: null,
      beschreibung: null, jahr: null, medienId: null, sortierung: 0,
    };
    await alsPflege(f.reinigung, adminR, (k) => aendereReferenz(k, r, felder));
    await alsPflege(f.bau, adminB, (k) => aendereReferenz(k, b, felder));

    const [z] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*) as anzahl from referenz where slug = 'halle-ost'`);
    expect(Number(z!.anzahl)).toBe(2);
  });

  it('ein Freigabedatum, das kein Datum ist, wird abgewiesen — nicht vom Treiber',
    async () => {
      /*
       * Der Parameter steht als `$3::date` im SQL; `postgres.js` serialisiert
       * ihn dann über `new Date(wert).toISOString()` und wirft bei Müll einen
       * `RangeError` — weder `RedaktionFehler` noch `PostgresError`, also ein
       * 500. Das Feld ist ein `<input type="date">`; ein Browser ohne
       * Datumsfeld schickt freien Text.
       */
      const admin = await konto(f.reinigung);
      const r = await referenz(f.reinigung, 'Projekt mit Freigabe');
      for (const am of ['29.03.2026', '2026-02-30', 'heute']) {
        const fehler = await alsPflege(f.reinigung, admin, (k) =>
          erfasseKundenfreigabe(k, r, { freigegeben: true, am, beleg: 'E-Mail vom Kunden' }),
        ).catch((e: unknown) => e);
        expect(fehler, am).toBeInstanceOf(RedaktionFehler);
        expect((fehler as RedaktionFehler).grund, am).toBe('freigabe_datum_form');
      }

      const [z] = await sql.unsafe<{ freigegeben: boolean }[]>(
        `select freigegeben_vom_kunden as freigegeben from referenz where id = $1`, [r]);
      expect(z!.freigegeben).toBe(false);
    });
});
