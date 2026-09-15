/**
 * Das Social Media Center gegen echte Rechte und echte Policies
 * (SOC-01…SOC-08).
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. Ein Beitrag der einen Gesellschaft erscheint nicht in der anderen.
 *  2. Ohne `social.lesen` ist das Center leer — leer, nicht fehlerhaft.
 *  3. **Ein VERÖFFENTLICHTER Beitrag ist öffentlich lesbar, ohne Sitzung.**
 *     Genau daran hing die Entscheidung, die K-04-Decke nur aufs Schreiben zu
 *     legen: eine Lesedecke auf `intern` hätte die Gesellschaftsseite
 *     schweigend geleert, weil `app.portal()` ohne Sitzung auf den
 *     fail-closed-Wert `mitarbeiter` fällt.
 *  4. Ein ENTWURF ist es nicht — und ein zurückgezogener auch nicht mehr.
 *  5. Ohne Sitzung lässt sich nichts schreiben (die Schreibdecke greift).
 *  6. Die Entscheidung im Freigabe-Posteingang zieht den Beitrag nach —
 *     **in beide Richtungen**, auch bei einer Ablehnung, die kein Ausführer
 *     je sieht.
 *  7. `beitrag` kennt kein `delete` (Invariante 8, sinngemäß).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { legeVor } from '../../src/server/services/social/dienst.js';
import { entscheideFreigabe } from '../../src/server/services/freigabe/entscheiden.js';
import { vermerkeAnsicht } from '../../src/server/services/freigabe/laden.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function legeKontoAn(mandantId: string, rolle = 'leitung'): Promise<string> {
  const email = `soc-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Leitung', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

async function legeKanalAn(mandantId: string, plattform = 'instagram'): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into social_kanal (mandant_id, plattform, anzeigename, verbunden)
     values ($1::uuid, $2::social_plattform, $3, false)
     on conflict (mandant_id, plattform) do update set anzeigename = excluded.anzeigename
     returning id`,
    [mandantId, plattform, `Kanal ${plattform}`]);
  return k!.id;
}

/**
 * Eine Rohschreibung MIT Mandantenkontext.
 *
 * **Warum die Fixtur das braucht.** Seit 0163 haengt ein Riegel vor `beitrag`:
 * `freigegeben`, `geplant` und `veroeffentlicht` verlangen eine GENEHMIGTE
 * Freigabe FUER `social_veroeffentlichen`, und der Ausloeser fragt das ueber
 * `app.freigabe_genehmigt` — einen Definer, dessen Policy auf `freigabe`
 * (`d_freigabe_lesen`, 0123) `mandant_id = app.aktiver_mandant()` verlangt.
 * Eine Rohverbindung ohne gesetzte GUCs hat keinen aktiven Mandanten, sieht
 * deshalb null Zeilen und faellt in den Riegel — **richtig herum**: der Riegel
 * schliesst, wenn er nicht nachsehen kann.
 *
 * Die Fixtur setzt den Kontext also, statt den Riegel zu lockern. Genau das
 * tut der echte Weg auch: `withTenant` setzt dieselben beiden GUCs.
 */
async function imMandanten<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.scope', 'mandant', true),
                            set_config('app.mandant_id', $1, true)`, [mandantId]);
    return fn(tx);
  }) as Promise<T>;
}

/** Ein Beitrag samt Freigabe, so wie der Dienst ihn anlegen würde. */
async function legeBeitragAn(
  mandantId: string, titel: string, status: string,
  freigabeStatus: string | null = null,
): Promise<{ beitragId: string; freigabeId: string | null }> {
  let freigabeId: string | null = null;
  if (freigabeStatus !== null) {
    /*
     * **Eine genehmigte Freigabe braucht einen Menschen** -- das ist der
     * CHECK `freigabe_genehmigt_hat_menschen` aus 0012, und er ist Invariante
     * 7 in der Datenbank. Die Fixtur legt nicht in jeder Gesellschaft ein
     * Konto an, also legt der Helfer eines an, statt `null` zu schicken.
     */
    const [vorhanden] = await sql.unsafe<{ id: string }[]>(
      `select benutzer_id as id from benutzer_mandant
        where mandant_id = $1::uuid and entzogen_am is null limit 1`, [mandantId]);
    const mensch = vorhanden ?? { id: await legeKontoAn(mandantId) };
    const [fr] = await sql.unsafe<{ id: string }[]>(
      `insert into freigabe (mandant_id, aktion, status, vorgang_typ, titel,
                             zusammenfassung, risiko, vorschau_payload, payload_hash,
                             freigegeben_von, freigegeben_am, bezug_typ)
       values ($1::uuid, 'social_veroeffentlichen', $2::freigabe_status,
               'beitrag_veroeffentlichen', $3, 'Probe', 'mittel'::risiko_stufe,
               '{}'::jsonb, encode(sha256(convert_to($3::text, 'UTF8')), 'hex'),
               case when $2 = 'genehmigt' then $4::uuid else null end,
               case when $2 = 'genehmigt' then now() else null end, 'beitrag')
       returning id`,
      [mandantId, freigabeStatus, titel, mensch.id]);
    freigabeId = fr!.id;
  }
  const [b] = await imMandanten(mandantId, (tx) => tx.unsafe<{ id: string }[]>(
    `insert into beitrag (mandant_id, titel, text, status, freigabe_id,
                          veroeffentlicht_am)
     values ($1::uuid, $2, 'Text', $3::beitrag_status, $4::uuid,
             case when $3 = 'veroeffentlicht' then now() else null end)
     returning id`,
    [mandantId, titel, status, freigabeId]));
  return { beitragId: b!.id, freigabeId };
}

/** Ohne jede Sitzung — genau so liest die öffentliche Gesellschaftsseite. */
async function ohneSitzung<T>(
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_app`);
    return fn(tx);
  }) as Promise<T>;
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(1) Mandantentrennung', () => {
  it('ein Beitrag der Reinigung erscheint nicht bei der Security', async () => {
    const konto = await legeKontoAn(f.security);
    await legeBeitragAn(f.reinigung, `Nur Reinigung ${zufall()}`, 'entwurf');

    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: konto, portal: 'intern' },
      (tx) => tx.unsafe(`select id, titel from beitrag`));
    expect(zeilen).toHaveLength(0);
  });

  it('ein Kanal der einen Gesellschaft ist in der anderen nicht sichtbar', async () => {
    const konto = await legeKontoAn(f.bau);
    await legeKanalAn(f.reinigung, 'linkedin');

    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: konto, portal: 'intern' },
      (tx) => tx.unsafe(`select id from social_kanal`));
    expect(zeilen).toHaveLength(0);
  });
});

describe('(2) Rechte', () => {
  it('ohne social.lesen ist das Center leer, nicht fehlerhaft', async () => {
    /* `mitarbeiter` hält weder social.lesen noch social.schreiben. */
    const konto = await legeKontoAn(f.reinigung, 'mitarbeiter');
    await legeBeitragAn(f.reinigung, `Entwurf ${zufall()}`, 'entwurf');

    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: konto, portal: 'mitarbeiter' },
      (tx) => tx.unsafe(`select id from beitrag where status = 'entwurf'`));
    expect(zeilen).toHaveLength(0);
  });

  it('die Leitung sieht die Beiträge ihrer Gesellschaft', async () => {
    const konto = await legeKontoAn(f.reinigung);
    const titel = `Sichtbar ${zufall()}`;
    await legeBeitragAn(f.reinigung, titel, 'entwurf');

    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: konto, portal: 'intern' },
      (tx) => tx.unsafe<{ titel: string }[]>(`select titel from beitrag`));
    expect(zeilen.map((z) => z.titel)).toContain(titel);
  });
});

describe('(3) Die öffentliche Seite — und warum die Decke nur fürs Schreiben gilt', () => {
  it('ein veröffentlichter Beitrag ist OHNE SITZUNG lesbar', async () => {
    const titel = `Draussen ${zufall()}`;
    await legeBeitragAn(f.reinigung, titel, 'veroeffentlicht', 'genehmigt');

    const zeilen = await ohneSitzung((tx) =>
      tx.unsafe<{ titel: string }[]>(`select titel from beitrag`));
    expect(zeilen.map((z) => z.titel)).toContain(titel);
  });

  it('und app.portal() ist dabei `mitarbeiter` — die Lesedecke hätte geleert', async () => {
    /*
     * Die Gegenprobe zur Entscheidung in 0163: ohne Sitzung faellt
     * `app.portal()` auf den fail-closed-Wert. Eine restriktive Lesedecke
     * auf 'intern' waere damit null Zeilen gewesen, schweigend.
     */
    const [z] = await ohneSitzung((tx) =>
      tx.unsafe<{ portal: string }[]>(`select app.portal() as portal`));
    expect(z?.portal).toBe('mitarbeiter');
  });

  it('ein Entwurf ist NICHT öffentlich', async () => {
    const titel = `Geheim ${zufall()}`;
    await legeBeitragAn(f.reinigung, titel, 'entwurf');

    const zeilen = await ohneSitzung((tx) =>
      tx.unsafe<{ titel: string }[]>(`select titel from beitrag`));
    expect(zeilen.map((z) => z.titel)).not.toContain(titel);
  });

  it('ein zurückgezogener auch nicht mehr — obwohl er draussen WAR', async () => {
    const titel = `Zurueck ${zufall()}`;
    const { beitragId } = await legeBeitragAn(f.reinigung, titel, 'veroeffentlicht', 'genehmigt');
    await sql.unsafe(
      `update beitrag set status = 'zurueckgezogen', zurueckgezogen_am = now(),
                          zurueckgezogen_grund = 'Probe'
        where id = $1::uuid`, [beitragId]);

    const zeilen = await ohneSitzung((tx) =>
      tx.unsafe<{ titel: string; am: Date | null }[]>(
        `select titel from beitrag`));
    expect(zeilen.map((z) => z.titel)).not.toContain(titel);

    /* Aber `veroeffentlicht_am` bleibt stehen: er WAR draussen (Invariante 8). */
    const [zeile] = await sql.unsafe<{ am: Date | null }[]>(
      `select veroeffentlicht_am as am from beitrag where id = $1::uuid`, [beitragId]);
    expect(zeile?.am).not.toBeNull();
  });

  it('ohne Sitzung lässt sich NICHTS schreiben — die Schreibdecke greift', async () => {
    await expect(ohneSitzung((tx) => tx.unsafe(
      `insert into beitrag (mandant_id, titel, text) values ($1::uuid, 'Fremd', 'X')`,
      [f.reinigung]))).rejects.toThrow();
  });

  it('und das Ergebnisblatt je Kanal bleibt drinnen', async () => {
    const kanal = await legeKanalAn(f.reinigung, 'facebook');
    const { beitragId } = await legeBeitragAn(
      f.reinigung, `Mit Kanal ${zufall()}`, 'veroeffentlicht', 'genehmigt');
    await sql.unsafe(
      `insert into beitrag_kanal (mandant_id, beitrag_id, kanal_id, ergebnis, meldung)
       values ($1::uuid, $2::uuid, $3::uuid, 'nicht_verbunden', 'kein Zugang')`,
      [f.reinigung, beitragId, kanal]);

    const zeilen = await ohneSitzung((tx) => tx.unsafe(`select id from beitrag_kanal`));
    expect(zeilen).toHaveLength(0);
  });
});

describe('(4) Die Entscheidung zieht den Beitrag nach — in BEIDE Richtungen', () => {
  it('eine Genehmigung macht aus „vorgelegt" „freigegeben"', async () => {
    const { beitragId, freigabeId } = await legeBeitragAn(
      f.reinigung, `Wird genehmigt ${zufall()}`, 'vorgelegt', 'offen');
    const [mensch] = await sql.unsafe<{ id: string }[]>(
      `select benutzer_id as id from benutzer_mandant
        where mandant_id = $1::uuid and entzogen_am is null limit 1`, [f.reinigung]);

    await imMandanten(f.reinigung, (tx) => tx.unsafe(
      `update freigabe set status = 'genehmigt', freigegeben_von = $2::uuid,
                           freigegeben_am = now()
        where id = $1::uuid`, [freigabeId, mensch?.id ?? null]));

    const [b] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from beitrag where id = $1::uuid`, [beitragId]);
    expect(b?.status).toBe('freigegeben');
  });

  it('**und eine Ablehnung macht daraus „abgelehnt"** — kein Ausführer sieht sie', async () => {
    const { beitragId, freigabeId } = await legeBeitragAn(
      f.reinigung, `Wird abgelehnt ${zufall()}`, 'vorgelegt', 'offen');

    await sql.unsafe(`update freigabe set status = 'abgelehnt' where id = $1::uuid`,
      [freigabeId]);

    const [b] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from beitrag where id = $1::uuid`, [beitragId]);
    expect(b?.status).toBe('abgelehnt');
  });

  it('ein Beitrag, der nicht mehr vorgelegt ist, wird NICHT mitgezogen', async () => {
    const { beitragId, freigabeId } = await legeBeitragAn(
      f.reinigung, `Schon draussen ${zufall()}`, 'veroeffentlicht', 'genehmigt');
    await sql.unsafe(`update freigabe set status = 'abgelehnt' where id = $1::uuid`,
      [freigabeId]);

    const [b] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from beitrag where id = $1::uuid`, [beitragId]);
    expect(b?.status).toBe('veroeffentlicht');
  });
});

/**
 * **Der Weg, der zweimal an einem Abdruck gescheitert ist.**
 *
 * `app.freigabe_entscheiden` bildet den Digest der eingereichten Nutzlast
 * KANONISCH (RFC 8785) und vergleicht ihn mit `payload_hash`. Wer beim
 * Vorlegen `JSON.stringify` nimmt, schreibt eine andere Byte-Folge — und jede
 * Entscheidung wird mit „die eingereichte Nutzlast ist nicht die vorgelegte"
 * abgewiesen. Der Knopf ist da, der Vorschlag liegt vor, und er lässt sich
 * nicht entscheiden.
 *
 * Kein Test war diesen Weg gegangen; gefunden hat es die Browsersuite. Dieser
 * Fall geht ihn — durch die ECHTEN Dienste, nicht an ihnen vorbei.
 */
describe('(5) Vorlegen und Entscheiden gehen wirklich zusammen', () => {
  it('ein vorgelegter Beitrag lässt sich im Posteingang genehmigen', async () => {
    const konto = await legeKontoAn(f.reinigung, 'admin');
    const titel = `Ganzer Weg ${zufall()}`;
    const { beitragId } = await legeBeitragAn(f.reinigung, titel, 'entwurf');

    /*
     * **`readonly: false` ist Pflicht, nicht Kosmetik.** Die Fixtur bindet
     * die Sitzung sonst schreibgeschuetzt (`app.readonly = 'on'`), und JEDE
     * `with check`-Policy mit `not app.ist_readonly()` weist ab -- mit
     * derselben Meldung, die auch ein fehlendes Recht erzeugt. Beim ersten
     * Lauf sah das nach dem Rechteproblem aus, das die Durchsicht vermutet
     * hatte; es war die Fixtur.
     */
    const sitzung = {
      scope: 'mandant' as const, mandantId: f.reinigung,
      benutzerId: konto, portal: 'intern' as const, readonly: false,
    };

    /* Vorlegen ueber den echten Dienst — der bildet den Abdruck. */
    const freigabeId = await alsApp(sitzung, async (tx) => legeVor({
      scope: 'mandant', portal: 'intern', benutzerId: konto,
      aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
      abfrage: async <R,>(q: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(q, w as never[])) as readonly R[],
      schreibe: async <R,>(q: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(q, w as never[])) as readonly R[],
    }, beitragId));

    /*
     * **Erst ansehen, dann entscheiden** (APR-08). `app.freigabe_entscheiden`
     * weist eine Entscheidung ab, die niemand geoeffnet hat -- die Pruefdauer
     * misst der Server aus `freigabe_ansicht`, und ohne Vermerk gibt es keine.
     * Im Portal schreibt ihn die Detailseite beim Laden; hier steht derselbe
     * Dienst.
     */
    await alsApp(sitzung, async (tx) => vermerkeAnsicht({
      scope: 'mandant', portal: 'intern', benutzerId: konto,
      aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
      abfrage: async <R,>(q: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(q, w as never[])) as readonly R[],
      schreibe: async <R,>(q: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(q, w as never[])) as readonly R[],
    }, freigabeId, 'web'));

    /* Und entscheiden ueber den echten Dienst — der vergleicht den Abdruck. */
    const entschieden = await alsApp(sitzung, async (tx) => entscheideFreigabe({
      scope: 'mandant', portal: 'intern', benutzerId: konto,
      aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
      abfrage: async <R,>(q: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(q, w as never[])) as readonly R[],
      schreibe: async <R,>(q: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(q, w as never[])) as readonly R[],
    }, {
      freigabeId, art: 'genehmigt', begruendung: null,
      ip: null, userAgent: null, codeVersion: 'test',
    }));

    expect(entschieden.hash).toMatch(/^[0-9a-f]{64}$/u);

    const [b] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from beitrag where id = $1::uuid`, [beitragId]);
    expect(b?.status).toBe('freigegeben');
  });
});

describe('(6) Kein hartes Löschen', () => {
  it('`beitrag` ist für cse_app nicht löschbar', async () => {
    const konto = await legeKontoAn(f.reinigung);
    const { beitragId } = await legeBeitragAn(f.reinigung, `Bleibt ${zufall()}`, 'entwurf');

    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: konto, portal: 'intern' },
      (tx) => tx.unsafe(`delete from beitrag where id = $1::uuid`, [beitragId]),
    )).rejects.toThrow(/permission denied/iu);
  });
});

describe('(7) Der Riegel: „freigegeben" heisst GENEHMIGT', () => {
  /**
   * **`freigabe_id is not null` war ein Zeiger, kein Riegel.**
   *
   * Die CHECK-Bedingung verlangte eine Freigabe — irgendeine. Diese drei
   * Proben sind die Faelle, die sie durchliess und in denen Invariante 7
   * verletzt gewesen waere: der Beitrag stand auf „freigegeben", waehrend die
   * Entscheidung darueber noch offen, schon verneint oder fuer etwas ganz
   * anderes erteilt war.
   */
  it('eine OFFENE Freigabe traegt keinen freigegebenen Beitrag', async () => {
    await expect(legeBeitragAn(
      f.reinigung, `Noch offen ${zufall()}`, 'freigegeben', 'offen',
    )).rejects.toThrow(/GENEHMIGTEN Freigabe/u);
  });

  it('eine ABGELEHNTE auch nicht', async () => {
    await expect(legeBeitragAn(
      f.reinigung, `Verneint ${zufall()}`, 'geplant', 'abgelehnt',
    )).rejects.toThrow(/GENEHMIGTEN Freigabe/u);
  });

  it('und gar keine erst recht nicht', async () => {
    await expect(legeBeitragAn(
      f.reinigung, `Ohne alles ${zufall()}`, 'veroeffentlicht', null,
    )).rejects.toThrow(/GENEHMIGTEN Freigabe|beitrag_freigegeben_hat_freigabe/u);
  });

  /**
   * **Die Aktion geht mit** (0130 §6). Eine Zustimmung zu einem Mahnbrief ist
   * keine Zustimmung zu einem Beitrag auf Instagram — gleiche Kennung,
   * gleicher Mandant, gleicher Status, andere Entscheidung. Ohne das dritte
   * Argument waere dieser Fall durchgegangen.
   */
  it('eine genehmigte Freigabe FUER ETWAS ANDERES traegt ihn auch nicht', async () => {
    const mensch = await legeKontoAn(f.reinigung);
    const titel = `Fremde Aktion ${zufall()}`;
    const [fr] = await imMandanten(f.reinigung, (tx) => tx.unsafe<{ id: string }[]>(
      `insert into freigabe (mandant_id, aktion, status, vorgang_typ, titel,
                             zusammenfassung, risiko, vorschau_payload, payload_hash,
                             freigegeben_von, freigegeben_am, bezug_typ)
       values ($1::uuid, 'mahnung_senden', 'genehmigt', 'beitrag_veroeffentlichen',
               $2, 'Probe', 'mittel'::risiko_stufe, '{}'::jsonb,
               encode(sha256(convert_to($2::text, 'UTF8')), 'hex'),
               $3::uuid, now(), 'beitrag')
       returning id`, [f.reinigung, titel, mensch]));

    await expect(imMandanten(f.reinigung, (tx) => tx.unsafe(
      `insert into beitrag (mandant_id, titel, text, status, freigabe_id,
                            veroeffentlicht_am)
       values ($1::uuid, $2, 'Text', 'veroeffentlicht'::beitrag_status, $3::uuid, now())`,
      [f.reinigung, titel, fr!.id]),
    )).rejects.toThrow(/GENEHMIGTEN Freigabe/u);
  });
});

describe('(8) Das Ergebnisblatt: geloescht wird nur, was nie hinausging', () => {
  /**
   * Der Kommentar bei den Zuteilungen sagte, der Dienst lasse das Loeschen
   * nur bei `ergebnis = 'offen'` zu — und in der Datenbank stand davon nichts.
   * Eine Zusicherung, die nur in der Dienstschicht lebt, ist bei einem
   * `delete` daneben weg (Invariante 3: RLS ist nie die einzige Linie, aber
   * auch nie die fehlende).
   */
  it('ein offener Kanal laesst sich wieder herausnehmen', async () => {
    const konto = await legeKontoAn(f.reinigung);
    const { beitragId } = await legeBeitragAn(f.reinigung, `Plan ${zufall()}`, 'entwurf');
    const kanal = await legeKanalAn(f.reinigung, 'instagram');
    await sql.unsafe(
      `insert into beitrag_kanal (mandant_id, beitrag_id, kanal_id, ergebnis)
       values ($1::uuid, $2::uuid, $3::uuid, 'offen')`, [f.reinigung, beitragId, kanal]);

    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: konto, portal: 'intern',
        readonly: false },
      (tx) => tx.unsafe(`delete from beitrag_kanal where beitrag_id = $1::uuid`,
        [beitragId]));

    const [uebrig] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from beitrag_kanal where beitrag_id = $1::uuid`,
      [beitragId]);
    expect(uebrig?.n).toBe('0');
  });

  it('ein Kanal, auf dem etwas GESCHAH, bleibt stehen', async () => {
    const konto = await legeKontoAn(f.reinigung);
    const { beitragId } = await legeBeitragAn(
      f.reinigung, `Ging raus ${zufall()}`, 'veroeffentlicht', 'genehmigt');
    const kanal = await legeKanalAn(f.reinigung, 'linkedin');
    await sql.unsafe(
      `insert into beitrag_kanal (mandant_id, beitrag_id, kanal_id, ergebnis, meldung)
       values ($1::uuid, $2::uuid, $3::uuid, 'nicht_verbunden', 'kein Zugang')`,
      [f.reinigung, beitragId, kanal]);

    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: konto, portal: 'intern',
        readonly: false },
      (tx) => tx.unsafe(`delete from beitrag_kanal where beitrag_id = $1::uuid`,
        [beitragId]));

    /*
     * Kein Fehler, sondern NULL ZEILEN — so wirkt eine restriktive
     * Loeschpolicy. Die Zusicherung ist, dass die Zeile danach noch da ist.
     */
    const [uebrig] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from beitrag_kanal where beitrag_id = $1::uuid`,
      [beitragId]);
    expect(uebrig?.n).toBe('1');
  });
});
