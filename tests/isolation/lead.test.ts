/**
 * PR 17 Akzeptanz (2), (3), (5) — an einer echten Datenbank, als `cse_app`.
 *
 * Was hier geprueft wird, laesst sich nicht simulieren: dass eine
 * `security`-Einsendung fuer einen `reinigung`-Benutzer NICHT EXISTIERT, ist
 * eine Aussage ueber RLS und nicht ueber eine `where`-Bedingung im Dienst.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eigeneDatenbank } from './eigene-datenbank.js';

const { alsApp, sql, baueAuf } = eigeneDatenbank('cse_lead');
import { withEingang } from '../../src/server/kontext/eingang.js';
import { nimmAn, pruefeRatenlimit, RatenlimitFehler, LIMIT_JE_IP }
  from '../../src/server/services/lead/annahme.js';
import { eskaliereFaellige } from '../../src/server/services/lead/eskalation.js';
import { setzeLeadPflege, CrmFehler } from '../../src/server/services/crm/anlegen.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { Felder, type FormularFeld } from '../../src/lib/formular/schema.js';

interface FormularZeile {
  id: string; mandant_id: string; schluessel: string;
  felder: unknown; datenschutz_hinweis_version: string;
}

const ids = new Map<string, string>();
const formulare = new Map<string, FormularZeile>();
let adminId = '';

/*
 * Eigene Datenbank, frisch gebaut und geseedet — siehe `eigene-datenbank.ts`.
 * Mit `test-db.sh up` auf der gemeinsamen `cse_test` lief der Seed hier auf
 * dem Stand der vorherigen Datei, und rot oder gruen entschied die
 * Reihenfolge der Dateien.
 */
beforeAll(async () => {
  baueAuf();

  for (const m of await sql<{ id: string; slug: string }[]>`select id, slug from mandant`) {
    ids.set(m.slug, m.id);
  }
  for (const f of await sql<FormularZeile[]>`
    select id, mandant_id, schluessel, felder, datenschutz_hinweis_version
      from formular_definition`) {
    formulare.set(f.schluessel, f);
  }
  const [admin] = await sql<{ id: string }[]>`
    select id from benutzer where email = 'admin@cse-gruppe.de'`;
  adminId = admin!.id;
}, 180_000);

/** Eine Einsendung, wie die Route sie herstellt. */
async function sende(
  schluessel: string, werte: Record<string, unknown>, ip?: string,
): Promise<{ leadId: string; eingangId: string }> {
  const formular = formulare.get(schluessel)!;
  const felder = Felder.parse(formular.felder) as readonly FormularFeld[];
  return sql.begin(async (tx) => withEingang(tx, formular.mandant_id, async (kontext) => {
    const abfrage = { unsafe: (q: string, w?: readonly unknown[]) => kontext.schreibe(q, w) };
    // Über die Definer-Funktion, wie die Route auch: der Prinzipal hält kein
    // `formular.lesen` und sieht die Tabelle selbst nicht.
    const [z] = await kontext.abfrage<{ sla_stunden: number | null; besitzer: string }>(
      `select sla_stunden, besitzer from app.formular_zustaendigkeit($1)`,
      [formular.id],
    );
    if (ip !== undefined) await pruefeRatenlimit(abfrage, ip, new Date());
    const e = await nimmAn(abfrage, {
      id: formular.id, mandantId: formular.mandant_id, schluessel,
      felder, datenschutzHinweisVersion: formular.datenschutz_hinweis_version,
      slaStunden: z?.sla_stunden ?? null,
      standardBesitzerBenutzerId: z!.besitzer,
    }, { werte, attribution: {}, ...(ip === undefined ? {} : { ip }) });
    return { leadId: e.leadId, eingangId: e.eingangId };
  })) as Promise<{ leadId: string; eingangId: string }>;
}

const REINIGUNG = {
  gebaeudetyp: 'buero', flaeche_qm: '250', anzahl_objekte: '2',
  frequenz: 'woechentlich', wunsch_start: '2026-10-01',
  firma: 'Muster GmbH', name: 'A. Muster', email: 'a@muster.test',
  telefon: '+49 30 1', datenschutz_hinweis: 'on',
};
const SECURITY = {
  anlass: 'Messe', einsatz_von: '2026-10-01T08:00', einsatz_bis: '2026-10-01T20:00',
  erwartete_besucher: '500', anzahl_kraefte: '4', veranstaltungsort: 'Messedamm 22',
  firma: 'Geheim AG', name: 'B. Beispiel', email: 'b@geheim.test',
  telefon: '+49 30 2', datenschutz_hinweis: 'on',
};

describe('(1) eine Einsendung erzeugt einen Lead mit Frist, Quelle und Besitzer', () => {
  it('der Lead trägt Frist, Besitzer und quelle = webformular', async () => {
    const { leadId } = await sende('angebot_reinigung', REINIGUNG);
    const [lead] = await sql<{
      quelle: string; sla_frist_am: Date | null; besitzer_benutzer_id: string;
      firma_name: string; eskalationsstufe: number; erste_reaktion_am: Date | null;
    }[]>`select quelle, sla_frist_am, besitzer_benutzer_id, firma_name,
                eskalationsstufe, erste_reaktion_am from lead where id = ${leadId}`;

    expect(lead!.quelle).toBe('webformular');
    expect(lead!.firma_name).toBe('Muster GmbH');
    expect(lead!.besitzer_benutzer_id).toBe(adminId);
    // 24 h VORLÄUFIG (O-14) — geprüft wird, DASS eine Frist steht, nicht welche.
    expect(lead!.sla_frist_am).not.toBeNull();
    // Der Eingang ist `eingehend` gebucht: wäre er ausgehend, gälte der Lead
    // in der Sekunde seiner Entstehung als beantwortet.
    expect(lead!.erste_reaktion_am).toBeNull();
  });

  it('der Eingang zeigt auf den Lead und trägt die Datenschutz-Version', async () => {
    const { leadId, eingangId } = await sende('angebot_reinigung', REINIGUNG);
    const [e] = await sql<{
      lead_id: string; status: string; datenschutz_hinweis_bestaetigt: boolean;
      datenschutz_hinweis_version: string; einwilligung_werbung: boolean;
    }[]>`select lead_id, status, datenschutz_hinweis_bestaetigt,
                datenschutz_hinweis_version, einwilligung_werbung
           from formular_eingang where id = ${eingangId}`;
    expect(e!.lead_id).toBe(leadId);
    expect(e!.datenschutz_hinweis_bestaetigt).toBe(true);
    expect(e!.datenschutz_hinweis_version).not.toBe('');
    // CRM-08: ohne das freiwillige Häkchen keine Werbeeinwilligung.
    expect(e!.einwilligung_werbung).toBe(false);
  });

  it('die Aktivität trägt rechtsgrundlage = anfrage (CRM-08)', async () => {
    const { leadId } = await sende('angebot_reinigung', REINIGUNG);
    const [a] = await sql<{ rechtsgrundlage_snapshot: string; richtung: string }[]>`
      select rechtsgrundlage_snapshot, richtung from lead_aktivitaet
       where lead_id = ${leadId}`;
    expect(a!.rechtsgrundlage_snapshot).toBe('anfrage');
    expect(a!.richtung).toBe('eingehend');
  });

  it('mit Werbehäkchen wird daraus einwilligung — und nur dann', async () => {
    const { leadId } = await sende('angebot_reinigung',
      { ...REINIGUNG, einwilligung_werbung: 'on' });
    const [a] = await sql<{ rechtsgrundlage_snapshot: string }[]>`
      select rechtsgrundlage_snapshot from lead_aktivitaet where lead_id = ${leadId}`;
    expect(a!.rechtsgrundlage_snapshot).toBe('einwilligung');
  });
});

describe('(5) eine security-Einsendung ist für einen reinigung-Benutzer UNSICHTBAR', () => {
  it('der Lead des anderen Bereichs existiert für ihn nicht', async () => {
    const { leadId } = await sende('angebot_security', SECURITY);

    const sichtbar = await alsApp(
      { scope: 'mandant', mandantId: ids.get('reinigung')!, benutzerId: adminId,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select id from lead where id = $1`, [leadId]),
    );
    // Nicht "gefiltert": für diese Sitzung gibt es die Zeile nicht.
    expect(sichtbar).toEqual([]);
  });

  it('und der Formulareingang ebenso wenig', async () => {
    const { eingangId } = await sende('angebot_security', SECURITY);
    const sichtbar = await alsApp(
      { scope: 'mandant', mandantId: ids.get('reinigung')!, benutzerId: adminId,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select id from formular_eingang where id = $1`, [eingangId]),
    );
    expect(sichtbar).toEqual([]);
  });

  it('im eigenen Bereich sieht derselbe Benutzer ihn sehr wohl', async () => {
    // Ohne diese Gegenprobe bestünde der Test auch, wenn NIEMAND etwas sähe.
    const { leadId } = await sende('angebot_security', SECURITY);
    const sichtbar = await alsApp(
      { scope: 'mandant', mandantId: ids.get('security')!, benutzerId: adminId,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select id from lead where id = $1`, [leadId]),
    );
    expect(sichtbar.length).toBe(1);
  });

  it('das Mitarbeiterportal sieht überhaupt keine Leads (EMP-13)', async () => {
    const { leadId } = await sende('angebot_reinigung', REINIGUNG);
    const sichtbar = await alsApp(
      { scope: 'mandant', mandantId: ids.get('reinigung')!, benutzerId: adminId,
        portal: 'mitarbeiter', readonly: false },
      (tx) => tx.unsafe(`select id from lead where id = $1`, [leadId]),
    );
    expect(sichtbar).toEqual([]);
  });
});

describe('der Eingang ist BEWEIS und kein Arbeitsblatt', () => {
  it('`daten` lässt sich nicht nachträglich ändern', async () => {
    const { eingangId } = await sende('angebot_reinigung', REINIGUNG);
    await expect(sql`
      update formular_eingang set daten = '{"firma":"anders"}'::jsonb
       where id = ${eingangId}`).rejects.toThrow(/Beweis/u);
  });

  it('`eingegangen_am` gehört dem Server, nicht dem Aufrufer', async () => {
    const formular = formulare.get('angebot_reinigung')!;
    const [z] = await sql<{ eingegangen_am: Date }[]>`
      insert into formular_eingang
        (mandant_id, formular_definition_id, daten, datenschutz_hinweis_bestaetigt,
         datenschutz_hinweis_version, eingegangen_am)
      values (${formular.mandant_id}, ${formular.id}, '{}'::jsonb, true, 'x',
              '2001-01-01T00:00:00Z')
      returning eingegangen_am`;
    // Der mitgeschickte Zeitpunkt wird überschrieben — sonst schriebe ein
    // Absender aus dem offenen Internet seinen eigenen Beleg.
    expect(z!.eingegangen_am.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('status, lead_id und verarbeitet_* dürfen sich ändern', async () => {
    const { eingangId } = await sende('angebot_reinigung', REINIGUNG);
    await expect(sql`
      update formular_eingang set status = 'spam' where id = ${eingangId}`)
      .resolves.toBeDefined();
  });

  it('eine veröffentlichte Formularversion ist eingefroren', async () => {
    const formular = formulare.get('angebot_reinigung')!;
    await expect(sql`
      update formular_definition set felder = '[]'::jsonb where id = ${formular.id}`)
      .rejects.toThrow(/eingefroren/u);
  });
});

describe('das Ratenlimit greift auf dem IP-Hash', () => {
  it(`nach ${String(LIMIT_JE_IP)} Einsendungen wird abgewiesen`, async () => {
    const hash = 'a'.repeat(64);
    for (let i = 0; i < LIMIT_JE_IP; i += 1) {
      await sende('angebot_reinigung', REINIGUNG, hash);
    }
    await expect(sende('angebot_reinigung', REINIGUNG, hash))
      .rejects.toThrow(RatenlimitFehler);
  });

  it('eine andere Verbindung ist davon nicht betroffen', async () => {
    await expect(sende('angebot_reinigung', REINIGUNG, 'b'.repeat(64)))
      .resolves.toBeDefined();
  });
});

describe('(2) die Eskalation läuft einmal je Stunde und wird protokolliert', () => {
  it('eine überfällige Anfrage eskaliert — ein zweiter Lauf sendet nichts', async () => {
    const { leadId } = await sende('angebot_reinigung', REINIGUNG);
    // Die Uhr wird nicht gestellt: die FRIST wird vordatiert. Dasselbe
    // Ergebnis, ohne eine Systemuhr, von der andere Tests abhängen.
    await sql`update lead set sla_frist_am = now() - interval '2 hours'
               where id = ${leadId}`;

    const mandantId = ids.get('reinigung')!;
    const lauf = { unsafe: (q: string, w?: readonly unknown[]) => sql.unsafe(q, (w ?? []) as never[]) };

    const erst = await eskaliereFaellige(lauf, mandantId, new Date());
    expect(erst.leads).toContain(leadId);

    const [nachher] = await sql<{ eskalationsstufe: number; zuletzt_eskaliert_am: Date }[]>`
      select eskalationsstufe, zuletzt_eskaliert_am from lead where id = ${leadId}`;
    expect(nachher!.eskalationsstufe).toBe(1);

    // Zweiter Lauf im selben Fenster: nichts.
    const zweit = await eskaliereFaellige(lauf, mandantId, new Date());
    expect(zweit.leads).not.toContain(leadId);
    const [unveraendert] = await sql<{ eskalationsstufe: number }[]>`
      select eskalationsstufe from lead where id = ${leadId}`;
    expect(unveraendert!.eskalationsstufe).toBe(1);
  });

  it('die Eskalation steht als Aktivität in der Zeitachse — und ist INTERN', async () => {
    const { leadId } = await sende('angebot_reinigung', REINIGUNG);
    await sql`update lead set sla_frist_am = now() - interval '2 hours' where id = ${leadId}`;
    const lauf = { unsafe: (q: string, w?: readonly unknown[]) => sql.unsafe(q, (w ?? []) as never[]) };
    await eskaliereFaellige(lauf, ids.get('reinigung')!, new Date());

    const zeilen = await sql<{ richtung: string; betreff: string }[]>`
      select richtung, betreff from lead_aktivitaet
       where lead_id = ${leadId} and typ = 'system' and richtung = 'intern'`;
    expect(zeilen.length).toBe(1);
    expect(zeilen[0]!.betreff).toContain('Reaktionszeit überschritten');

    // Und die Uhr steht danach immer noch: eine Eskalation an die eigene
    // Leitung ist keine Antwort an den Anfragenden.
    const [lead] = await sql<{ erste_reaktion_am: Date | null }[]>`
      select erste_reaktion_am from lead where id = ${leadId}`;
    expect(lead!.erste_reaktion_am).toBeNull();
  });

  it('eine ausgehende Aktivität hält die Uhr an — und danach eskaliert nichts mehr', async () => {
    const { leadId } = await sende('angebot_reinigung', REINIGUNG);
    await sql`update lead set sla_frist_am = now() - interval '2 hours' where id = ${leadId}`;

    /**
     * Die Rueckmeldung ist ein AUSGEHENDER elektronischer Kontakt, und
     * `kern.uwg_sendetor` laesst sie nur zu, wenn drei Dinge belegt sind:
     * der Kanal, der Empfaenger und seine Rechtsgrundlage. Genau das ist der
     * Sinn — eine Antwort, von der niemand sagen kann, an wen sie ging,
     * belegt im Streitfall nichts. Die Anfrage selbst begruendet `anfrage`
     * (CRM-08), also traegt der Kontakt sie.
     */
    const [ap] = await sql<{ id: string }[]>`
      insert into ansprechpartner (mandant_id, nachname, email, rechtsgrundlage,
                                   rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am)
      values (${ids.get('reinigung')!}, 'Anfragende', 'anfrage@beispiel.test',
              'anfrage', 'Webformular', now())
      returning id`;
    await sql`update lead set ansprechpartner_id = ${ap!.id} where id = ${leadId}`;
    await alsApp(
      { scope: 'mandant', mandantId: ids.get('reinigung')!, benutzerId: adminId,
        portal: 'intern', readonly: false },
      (tx) => tx`
        insert into lead_aktivitaet (mandant_id, lead_id, ansprechpartner_id, typ,
                                     richtung, zweck, kanal, betreff)
        values (${ids.get('reinigung')!}, ${leadId}, ${ap!.id}, 'email', 'ausgehend',
                'vertraglich', 'email', 'Rückmeldung')`);

    const [lead] = await sql<{ erste_reaktion_am: Date | null }[]>`
      select erste_reaktion_am from lead where id = ${leadId}`;
    // Der Trigger stempelt — nicht ein Mensch, der ein Feld setzt.
    expect(lead!.erste_reaktion_am).not.toBeNull();

    const lauf = { unsafe: (q: string, w?: readonly unknown[]) => sql.unsafe(q, (w ?? []) as never[]) };
    const bericht = await eskaliereFaellige(lauf, ids.get('reinigung')!, new Date());
    expect(bericht.leads).not.toContain(leadId);
  });
});

describe('der Eingangsprinzipal schreibt und liest NICHT', () => {
  it('er hält formular.schreiben, aber kein formular.lesen', async () => {
    const [b] = await sql<{ id: string }[]>`
      select id from benutzer where email = 'formular@cse-gruppe.de'`;
    const rechte = await sql<{ schluessel: string }[]>`
      select distinct be.schluessel
        from benutzer_mandant bm
        join rolle_berechtigung rb on rb.rolle_id = bm.rolle_id and rb.gewaehrt
        join berechtigung be on be.id = rb.berechtigung_id
       where bm.benutzer_id = ${b!.id}`;
    const menge = new Set(rechte.map((r) => r.schluessel));
    expect(menge.has('formular.schreiben')).toBe(true);
    // Er nimmt Einsendungen entgegen und kann keine zurückholen. Wer ihn
    // übernimmt, bekommt kein Archiv fremder Anfragen.
    expect(menge.has('formular.lesen')).toBe(false);
  });

  it('und er kann eine Einsendung tatsächlich nicht lesen', async () => {
    const { eingangId } = await sende('angebot_reinigung', REINIGUNG);
    const formular = formulare.get('angebot_reinigung')!;
    const sichtbar = await (sql.begin(async (tx) =>
      withEingang(tx, formular.mandant_id, async (kontext) =>
        kontext.abfrage(`select id from formular_eingang where id = $1`, [eingangId]),
      )) as Promise<readonly unknown[]>);
    expect(sichtbar).toEqual([]);
  });
});

describe('(6) V-137: der Anfragende ist erreichbar, und die Kette schliesst sich', () => {
  const lauf = { unsafe: (q: string, w?: readonly unknown[]) => sql.unsafe(q, (w ?? []) as never[]) };
  const zufallMail = (): string => `anfrage-${String(Math.random()).slice(2, 10)}@beispiel.test`;

  it('die Annahme legt den Anfragenden als Ansprechpartner an — Grundlage anfrage', async () => {
    const email = zufallMail();
    const { leadId, eingangId } = await sende('angebot_reinigung', { ...REINIGUNG, email });
    const [z] = await sql<{
      nachname: string; email: string; telefon: string; kunde_id: string | null;
      rechtsgrundlage: string; rechtsgrundlage_quelle: string;
    }[]>`
      select a.nachname, a.email, a.telefon, a.kunde_id, a.rechtsgrundlage::text as rechtsgrundlage,
             a.rechtsgrundlage_quelle
        from lead l join ansprechpartner a on a.id = l.ansprechpartner_id
       where l.id = ${leadId}`;
    expect(z).toBeDefined();
    expect(z!.nachname).toBe('A. Muster');
    expect(z!.email).toBe(email);
    expect(z!.telefon).toBe('+49 30 1');
    expect(z!.kunde_id).toBeNull();
    expect(z!.rechtsgrundlage).toBe('anfrage');
    expect(z!.rechtsgrundlage_quelle).toContain(eingangId);
  });

  it('auch mit Werbehäkchen bleibt die Grundlage anfrage — das Häkchen nennt keinen Kanal', async () => {
    const { leadId } = await sende('angebot_reinigung',
      { ...REINIGUNG, email: zufallMail(), einwilligung_werbung: 'on' });
    const [z] = await sql<{ g: string }[]>`
      select a.rechtsgrundlage::text as g from lead l
        join ansprechpartner a on a.id = l.ansprechpartner_id where l.id = ${leadId}`;
    expect(z!.g).toBe('anfrage');
  });

  it('dieselbe E-Mail zweimal ist EIN Mensch — derselbe Kontakt, zwei Leads', async () => {
    const email = zufallMail();
    const a = await sende('angebot_reinigung', { ...REINIGUNG, email });
    const b = await sende('angebot_reinigung', { ...REINIGUNG, email: email.toUpperCase() });
    const zeilen = await sql<{ ansprechpartner_id: string }[]>`
      select ansprechpartner_id from lead where id in (${a.leadId}, ${b.leadId})`;
    expect(new Set(zeilen.map((z) => z.ansprechpartner_id)).size).toBe(1);
    const [n] = await sql<{ n: number }[]>`
      select count(*)::int as n from ansprechpartner
       where lower(email) = ${email} and mandant_id = ${ids.get('reinigung')!}`;
    expect(n!.n).toBe(1);
  });

  it('der Besitzer bekommt „neue Anfrage" — mit Verweis auf genau diesen Lead', async () => {
    const { leadId } = await sende('angebot_reinigung', { ...REINIGUNG, email: zufallMail() });
    const [b] = await sql<{ empfaenger_id: string; ziel: string; titel: string; objekt_id: string }[]>`
      select empfaenger_id, ziel, titel, objekt_id from benachrichtigung
       where art = 'crm.neuer_lead' and objekt_id = ${leadId}`;
    expect(b).toBeDefined();
    expect(b!.empfaenger_id).toBe(adminId);
    expect(b!.ziel).toBe(`/portal/reinigung/crm/leads/${leadId}`);
    expect(b!.titel).toContain('Neue Anfrage');
  });

  it('der Eingangs-Prinzipal kann keine fremde oder alte Meldung auslösen', async () => {
    const { leadId } = await sende('angebot_reinigung', { ...REINIGUNG, email: zufallMail() });
    const formular = formulare.get('angebot_reinigung')!;
    /* Eine NEUE Transaktion: der Lead ist nicht in ihr entstanden. */
    const ok = await sql.begin(async (tx) => withEingang(tx, formular.mandant_id, async (k) => {
      const [z] = await k.abfrage<{ ok: boolean }>(
        `select app.lead_eingang_melden($1::uuid, 'x', 'y', $2) as ok`,
        [leadId, `/portal/reinigung/crm/leads/${leadId}`]);
      return z!.ok;
    }));
    expect(ok).toBe(false);
    const [n] = await sql<{ n: number }[]>`
      select count(*)::int as n from benachrichtigung
       where art = 'crm.neuer_lead' and objekt_id = ${leadId}`;
    expect(n!.n).toBe(1);
  });

  it('eine ausgehende E-Mail an den Anfragenden hält die Uhr an — ohne Handarbeit', async () => {
    const { leadId } = await sende('angebot_reinigung', { ...REINIGUNG, email: zufallMail() });
    const [l] = await sql<{ ansprechpartner_id: string }[]>`
      select ansprechpartner_id from lead where id = ${leadId}`;
    await alsApp(
      { scope: 'mandant', mandantId: ids.get('reinigung')!, benutzerId: adminId,
        portal: 'intern', readonly: false },
      (tx) => tx`
        insert into lead_aktivitaet (mandant_id, lead_id, ansprechpartner_id, typ,
                                     richtung, zweck, kanal, betreff)
        values (${ids.get('reinigung')!}, ${leadId}, ${l!.ansprechpartner_id}, 'email',
                'ausgehend', 'vertraglich', 'email', 'Angebot folgt')`);
    const [nachher] = await sql<{ erste_reaktion_am: Date | null }[]>`
      select erste_reaktion_am from lead where id = ${leadId}`;
    expect(nachher!.erste_reaktion_am).not.toBeNull();
  });

  it('ein gewonnener Lead eskaliert nicht mehr — auch ohne erfasste Reaktion', async () => {
    const { leadId } = await sende('angebot_reinigung', { ...REINIGUNG, email: zufallMail() });
    await sql`update lead set sla_frist_am = now() - interval '2 hours', status = 'gewonnen'
               where id = ${leadId}`;
    const bericht = await eskaliereFaellige(lauf, ids.get('reinigung')!, new Date());
    expect(bericht.leads).not.toContain(leadId);
  });

  it('die Eskalation meldet sich bei der zuständigen Person — ohne UUID im Verlauf', async () => {
    const { leadId } = await sende('angebot_reinigung', { ...REINIGUNG, email: zufallMail() });
    await sql`update lead set sla_frist_am = now() - interval '2 hours' where id = ${leadId}`;
    await eskaliereFaellige(lauf, ids.get('reinigung')!, new Date());
    const [b] = await sql<{ empfaenger_id: string; sammelbar: boolean }[]>`
      select empfaenger_id, sammelbar from benachrichtigung
       where art = 'crm.lead_sla_ueberschritten' and objekt_id = ${leadId}`;
    expect(b).toBeDefined();
    expect(b!.sammelbar).toBe(false);
    const [a] = await sql<{ inhalt: string }[]>`
      select inhalt from lead_aktivitaet
       where lead_id = ${leadId} and typ = 'system' and richtung = 'intern'`;
    expect(a!.inhalt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/u);
    expect(a!.inhalt).toMatch(/Gemeldet an /u);
    expect(a!.inhalt).not.toMatch(/T\d\d:\d\d:\d\d/u);
  });

  it('Priorität und Besitzer lassen sich setzen — ein Fremder wird nicht Besitzer', async () => {
    const { leadId } = await sende('angebot_reinigung', { ...REINIGUNG, email: zufallMail() });
    const kontext = (tx: Parameters<Parameters<typeof alsApp>[1]>[0]): SchreibKontext => {
      const lauf2 = async <R,>(q: string, w?: readonly unknown[]) =>
        (await tx.unsafe(q, (w ?? []) as never[])) as unknown as readonly R[];
      return { scope: 'mandant', portal: 'intern', benutzerId: adminId,
        aktiverMandantId: ids.get('reinigung')!, mandantIds: [ids.get('reinigung')!],
        abfrage: lauf2, schreibe: lauf2 };
    };
    const sitzung = { scope: 'mandant' as const, mandantId: ids.get('reinigung')!,
      benutzerId: adminId, portal: 'intern' as const, readonly: false };
    await alsApp(sitzung, (tx) => setzeLeadPflege(kontext(tx), leadId, { prioritaet: 'hoch' }));
    const [p] = await sql<{ prioritaet: string }[]>`
      select prioritaet::text as prioritaet from lead where id = ${leadId}`;
    expect(p!.prioritaet).toBe('hoch');

    /* Unverändert mitgeschickt (so tut es das Formular): keine Prüfung, kein Fehler. */
    await alsApp(sitzung, (tx) => setzeLeadPflege(kontext(tx), leadId,
      { prioritaet: 'niedrig', besitzerBenutzerId: adminId }));

    const [fremd] = await sql<{ id: string }[]>`
      select b.id from benutzer b
       where b.globale_rolle_id is null and not b.ist_dienstkonto
         and not exists (select 1 from benutzer_mandant bm
                          where bm.benutzer_id = b.id and bm.mandant_id = ${ids.get('reinigung')!})
       limit 1`;
    await expect(alsApp(sitzung, (tx) => setzeLeadPflege(kontext(tx), leadId,
      { besitzerBenutzerId: fremd!.id }))).rejects.toBeInstanceOf(CrmFehler);
    await expect(alsApp(sitzung, (tx) => setzeLeadPflege(kontext(tx), leadId,
      { prioritaet: 'dringend' }))).rejects.toBeInstanceOf(CrmFehler);
  });
});
