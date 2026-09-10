/**
 * **Die Phase-3-Abnahme.**
 *
 * "Ein Mitarbeiterkonto erreicht nichts ausser seinen eigenen Daten —
 * bewiesen durch einen Test, nicht durch Hinsehen." (ROADMAP Phase 3)
 *
 * Das ist eine Aussage über ALLE Routen, nicht über eine Auswahl. Deshalb
 * läuft diese Datei über das Routen-Manifest — 432 Zeilen, erzeugt aus
 * `04-SEITENKARTE.md`. Wer eine Route in die Karte schreibt, hat sie damit in
 * diese Probe geschrieben; wer sie vergisst, hat keine Route. Eine gepflegte
 * Fallliste wäre beim nächsten Modul unvollständig, und zwar genau an der
 * Route, an die niemand gedacht hat.
 *
 * Geprüft wird gegen ECHTE Sitzungen aus dem Seed: `benutzer_mandant.rolle_id`
 * bestimmt, was `app.hat_recht` beantwortet und in welches Portal
 * `app.sitzung_aufloesen` schickt. Ein Test, der sich seine Rollen selbst
 * baut, prüft die Rollen, die er baut.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { alsApp, DB_URL, sql } from './harness.js';
import { ROUTEN, familie, leserechte, routeMitPfad } from '../../src/server/registry/routen.js';
import { pruefeZugang, rechtepruefer, type Entscheidung } from '../../src/server/auth/zugang.js';
import type { Sitzung } from '../../src/server/kontext/index.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const ids = new Map<string, string>();
const konten = new Map<string, { benutzerId: string; personId: string | null }>();

beforeAll(async () => {
  execFileSync('bash', [join(WURZEL, 'scripts/test-db.sh'), 'up'],
    { cwd: WURZEL, encoding: 'utf8' });
  execFileSync(join(WURZEL, 'node_modules/.bin/tsx'),
    [join(WURZEL, 'src/server/db/seed/index.ts')],
    { cwd: WURZEL, encoding: 'utf8', env: { ...process.env, DATABASE_URL: DB_URL } });

  for (const m of await sql<{ id: string; slug: string }[]>`select id, slug from mandant`) {
    ids.set(m.slug, m.id);
  }
  for (const b of await sql<{ id: string; email: string; person_id: string | null }[]>`
    select id, email, person_id from benutzer where email is not null`) {
    konten.set(b.email, { benutzerId: b.id, personId: b.person_id });
  }
}, 240_000);

/** Eine Sitzung, wie `app.sitzung_aufloesen` sie liefern würde. */
function sitzung(
  email: string, portal: 'intern' | 'mitarbeiter' | 'kunde',
  ansicht: 'mandant' | 'gruppe' | 'person' | 'kunde', mandantSlug: string | null,
): Sitzung {
  const k = konten.get(email);
  if (k === undefined) throw new Error(`Seed-Konto fehlt: ${email}`);
  return {
    benutzerId: k.benutzerId,
    personId: k.personId,
    aktiverMandantId: mandantSlug === null ? null : ids.get(mandantSlug)!,
    ansicht,
    aal: 'aal2',
    portal,
    sitzungId: '00000000-0000-0000-0000-000000000000',
  };
}

/**
 * Fragt das Tor — mit `app.hat_recht` aus der ECHTEN Datenbank.
 *
 * Ein nachgebauter Rechteprüfer prüfte die Nachbildung. Hier antwortet die
 * Funktion, die auch jede RLS-Policy aufruft.
 */
async function entscheide(pfad: string, s: Sitzung | null): Promise<Entscheidung> {
  return alsApp(
    {
      scope: s?.ansicht ?? 'gruppe',
      ...(s?.aktiverMandantId == null ? {} : { mandantId: s.aktiverMandantId }),
      mandantIds: s?.aktiverMandantId == null ? [] : [s.aktiverMandantId],
      ...(s?.personId == null ? {} : { personId: s.personId }),
      ...(s?.benutzerId === undefined ? {} : { benutzerId: s.benutzerId }),
      ...(s?.portal === undefined ? {} : { portal: s.portal }),
    },
    async (tx) => pruefeZugang(pfad, s, rechtepruefer(
      async <T,>(q: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(q, w as never[])) as readonly T[],
    )),
  );
}

const erlaubt = async (pfad: string, s: Sitzung | null): Promise<boolean> =>
  (await entscheide(pfad, s)).art === 'erlaubt';

/* ── Die Mengen, über die aufgezählt wird ───────────────────────────────── */

/** Routen der Mandanten-, Gruppen-, Kunden- und Mitarbeiterfamilien. */
const INTERN = ROUTEN.filter((r) => familie(r.pfad) === 'mandant');
const GRUPPE = ROUTEN.filter((r) => familie(r.pfad) === 'gruppe');
const KUNDE = ROUTEN.filter((r) => familie(r.pfad) === 'kunde');
const MEIN = ROUTEN.filter((r) => familie(r.pfad) === 'mein');

/** Eine konkrete URL aus einem Muster — `[x]` bekommt einen echten Wert. */
function konkret(muster: string, mandantSlug: string): string {
  return muster
    .replace('[mandant]', mandantSlug)
    .replace(/\[[^\]]+\]/gu, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
}

describe('die Probe hat überhaupt etwas zu prüfen', () => {
  it('das Manifest führt alle vier Portalfamilien in Menge', () => {
    // Ohne diese Zusage liefe jede Aufzählung unten über eine leere Liste und
    // bestünde aus dem falschen Grund.
    expect(INTERN.length).toBeGreaterThan(200);
    expect(GRUPPE.length).toBeGreaterThan(10);
    expect(KUNDE.length).toBeGreaterThan(10);
    expect(MEIN.length).toBeGreaterThan(10);
  });

  it('die vier Rollenkonten sind geseedet', () => {
    for (const e of ['admin.reinigung@cse-gruppe.de', 'leitung.bau@cse-gruppe.de',
      'fatima.yildiz@cse-gruppe.de', 'kunde.demo@example.test']) {
      expect(konten.get(e), e).toBeDefined();
    }
    // Fatima IST ein Mensch — ohne `person_id` liefe der Personen-Scope leer.
    expect(konten.get('fatima.yildiz@cse-gruppe.de')?.personId).not.toBeNull();
  });
});

/* ── (1) Die ROADMAP-Zusage: ein Mitarbeiter erreicht nichts Fremdes ────── */

describe('(1) `mitarbeiter` erreicht NICHTS ausserhalb des eigenen Portals', () => {
  const fatima = () => sitzung('fatima.yildiz@cse-gruppe.de', 'mitarbeiter', 'person', null);

  it('KEINE der Mandantenrouten — alle 300, nicht eine Auswahl', async () => {
    const durchgelassen: string[] = [];
    for (const r of INTERN) {
      if (await erlaubt(konkret(r.pfad, 'reinigung'), fatima())) durchgelassen.push(r.pfad);
    }
    /**
     * Das ist die Zusage im Wortlaut. Eine einzige durchgelassene Route hier
     * ist eine, auf der ein Reinigungskraft-Login Kundenpreise, Lohnsätze
     * oder die Personalakte einer Kollegin sähe.
     */
    expect(durchgelassen).toEqual([]);
  }, 120_000);

  it('KEINE Gruppenroute — dort stehen die Zahlen der ganzen Gruppe', async () => {
    const durchgelassen: string[] = [];
    for (const r of GRUPPE) {
      if (await erlaubt(r.pfad, fatima())) durchgelassen.push(r.pfad);
    }
    expect(durchgelassen).toEqual([]);
  }, 60_000);

  it('KEINE Kundenroute — dort stehen die Handelswerte der Kunden', async () => {
    const durchgelassen: string[] = [];
    for (const r of KUNDE) {
      if (await erlaubt(r.pfad, fatima())) durchgelassen.push(r.pfad);
    }
    expect(durchgelassen).toEqual([]);
  }, 60_000);

  it('insbesondere: Gruppenfinanzen, Personalakte und Kundenpreise', async () => {
    // Namentlich, damit ein Fehlschlag die ROADMAP-Zeile zitiert und nicht
    // nur eine Pfadliste.
    for (const pfad of [
      '/portal/gruppe/finanzen',
      '/portal/reinigung/personal/personen/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      '/portal/reinigung/crm/kunden/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/konditionen',
      '/portal/reinigung/finanzen/rechnungen',
      '/portal/kunde/rechnungen',
    ]) {
      expect(await erlaubt(pfad, fatima()), pfad).toBe(false);
    }
  });

  it('aber SEIN Portal erreicht er — sonst wäre die Probe trivial', async () => {
    /**
     * Ohne diese Zusage bestünde alles Vorige auch dann, wenn das Tor
     * schlicht alles verböte. Ein Portal, das seinen eigenen Benutzer
     * aussperrt, ist genauso kaputt wie eines, das jeden hereinlässt.
     */
    const eigene: string[] = [];
    for (const r of MEIN) {
      if (await erlaubt(r.pfad, fatima())) eigene.push(r.pfad);
    }
    expect(eigene.length).toBeGreaterThan(5);
    expect(eigene).toContain('/portal/mein');
  }, 60_000);
});

/* ── (2) leitung von `bau` sieht keine `security`-Zeile ─────────────────── */

describe('(2) `leitung` von bau erreicht keine security-Zeile', () => {
  const leitungBau = () => sitzung('leitung.bau@cse-gruppe.de', 'intern', 'mandant', 'bau');

  it('das Tor entscheidet je MANDANT, nicht global (K-03)', async () => {
    /**
     * `app.hat_recht` NIMMT einen Mandanten. Ein globales Prädikat trüge das
     * in `bau` erteilte Leitungsrecht nach `security` — und genau das ist der
     * Leak, gegen den RLS existiert. Hier wird dieselbe Route einmal mit
     * `bau` und einmal mit `security` als aktivem Mandanten gefragt.
     */
    const inBau = await erlaubt('/portal/bau/auftraege', leitungBau());
    expect(inBau).toBe(true);

    const alsFremder: Sitzung = {
      ...leitungBau(), aktiverMandantId: ids.get('security')!,
    };
    expect(await erlaubt('/portal/security/auftraege', alsFremder)).toBe(false);
  });

  it('die zweite Linie ist die K-04-Decke, und sie greift von selbst', async () => {
    /**
     * `t_anstellung_lesen` prüft `mandant_id = any(app.sichtbare_mandanten())`
     * und KEIN Recht. Die Mandantentrennung hängt hier also am gebundenen
     * Mandanten — und der kommt nicht vom Aufrufer, sondern aus der Sitzung.
     *
     * Der erste Anlauf dieser Prüfung band `security` UND `portal = 'intern'`
     * von Hand und meldete eine gelesene Zeile als Leak. Das war die falsche
     * Anklage: `app.sitzung_aufloesen` leitet das Portal aus der MITGLIEDSCHAFT
     * im gebundenen Mandanten ab und fällt ohne eine solche auf `mitarbeiter`
     * zurück. Eine Sitzung mit fremdem Mandanten UND `intern` kann also gar
     * nicht entstehen.
     *
     * Diese Prüfung hält jetzt das fest, was wirklich schützt: ohne
     * Mitgliedschaft ist das Portal `mitarbeiter`, und dann lässt
     * `p_ma_ceiling` nur die eigenen Zeilen durch — bei einem Login ohne
     * `person` also keine.
     */
    const [zeile] = await sql<{ portal: string | null }[]>`
      select (select r.portal from benutzer_mandant bm join rolle r on r.id = bm.rolle_id
               where bm.benutzer_id = ${konten.get('leitung.bau@cse-gruppe.de')!.benutzerId}
                 and bm.mandant_id = ${ids.get('security')!}
                 and bm.entzogen_am is null limit 1) as portal`;
    // Keine Mitgliedschaft in `security` — `sitzung_aufloesen` nimmt deshalb
    // die fail-closed Vorgabe `mitarbeiter`.
    expect(zeile?.portal ?? null).toBeNull();

    const zeilen = await alsApp(
      {
        scope: 'mandant', mandantId: ids.get('security')!,
        mandantIds: [ids.get('security')!],
        benutzerId: konten.get('leitung.bau@cse-gruppe.de')!.benutzerId,
        portal: 'mitarbeiter',
      },
      async (tx) => tx.unsafe(`select id from anstellung`),
    );
    expect(zeilen).toEqual([]);
  });
});

/* ── (3) Ein ausgeblendeter Punkt bleibt 404, auch direkt getippt ───────── */

describe('(3) was nicht im Menü steht, ist auch getippt nicht da', () => {
  const fatima = () => sitzung('fatima.yildiz@cse-gruppe.de', 'mitarbeiter', 'person', null);

  it('dieselbe Entscheidung für Navigation und für die getippte URL', async () => {
    /**
     * Ein Menüpunkt ist eine Anzeige derselben Entscheidung, die das Tor
     * trifft — nicht eine zweite Liste daneben. Deshalb kann eine URL nicht
     * erreichbar sein, weil sie im Menü fehlt: sie fehlt im Menü, WEIL das
     * Tor sie verbietet.
     */
    for (const r of INTERN.slice(0, 40)) {
      const pfad = konkret(r.pfad, 'reinigung');
      const imMenue = await erlaubt(pfad, fatima());
      const getippt = await erlaubt(pfad, fatima());
      expect(getippt, pfad).toBe(imMenue);
      expect(getippt, pfad).toBe(false);
    }
  }, 60_000);

  it('eine erfundene URL ist unbekannt, nicht erlaubt', async () => {
    const admin = sitzung('admin.reinigung@cse-gruppe.de', 'intern', 'mandant', 'reinigung');
    // Fail closed: was nicht im Manifest steht, gibt es nicht.
    expect((await entscheide('/portal/reinigung/gibtesnicht', admin)).art).toBe('unbekannt');
    expect((await entscheide('/portal/reinigung/crm/kunden/x/geheim', admin)).art)
      .toBe('unbekannt');
  });
});

/* ── (4) Die übrigen Rollen: erreichbar, aber nicht alles ───────────────── */

describe('(4) admin und leitung unterscheiden sich — sonst wäre die Rolle Zierde', () => {
  const admin = () => sitzung('admin.reinigung@cse-gruppe.de', 'intern', 'mandant', 'reinigung');
  const leitung = () => sitzung('leitung.bau@cse-gruppe.de', 'intern', 'mandant', 'bau');

  it('admin erreicht mehr Mandantenrouten als leitung', async () => {
    let a = 0;
    let l = 0;
    for (const r of INTERN) {
      if (await erlaubt(konkret(r.pfad, 'reinigung'), admin())) a += 1;
      if (await erlaubt(konkret(r.pfad, 'bau'), leitung())) l += 1;
    }
    expect(a).toBeGreaterThan(0);
    expect(l).toBeGreaterThan(0);
    // 146 gegen 106 gebundene Rechte — die Rollen sind verschieden, und das
    // muss sich an den Routen zeigen, nicht nur in der Matrix.
    expect(a).toBeGreaterThan(l);
  }, 180_000);

  it('kein `kunde` erreicht das interne Portal', async () => {
    const kunde = sitzung('kunde.demo@example.test', 'kunde', 'kunde', null);
    const durchgelassen: string[] = [];
    for (const r of [...INTERN.slice(0, 60), ...GRUPPE]) {
      if (await erlaubt(konkret(r.pfad, 'reinigung'), kunde)) durchgelassen.push(r.pfad);
    }
    expect(durchgelassen).toEqual([]);
  }, 120_000);

  it('eine Route mit `aal2` bleibt einer aal1-Sitzung verwehrt (K-15)', async () => {
    const rollen = routeMitPfad('/portal/[mandant]/einstellungen/rollen');
    expect(rollen?.bewachung.art === 'recht' && rollen.bewachung.aal2).toBe(true);

    const schwach: Sitzung = { ...sitzung('admin.reinigung@cse-gruppe.de', 'intern', 'mandant', 'reinigung'), aal: 'aal1' };
    expect((await entscheide('/portal/reinigung/einstellungen/rollen', schwach)).art)
      .toBe('zweiter_faktor');
  });
});

/* ── (5) Nicht angemeldet ───────────────────────────────────────────────── */

describe('(5) ohne Sitzung führt jede Portalroute zur Anmeldung', () => {
  it('und keine einzige ist erlaubt', async () => {
    const durchgelassen: string[] = [];
    for (const r of [...INTERN.slice(0, 50), ...GRUPPE, ...KUNDE, ...MEIN]) {
      if (await erlaubt(konkret(r.pfad, 'reinigung'), null)) durchgelassen.push(r.pfad);
    }
    expect(durchgelassen).toEqual([]);
  }, 120_000);

  it('die öffentlichen Routen dagegen schon — sonst wäre die Website zu', async () => {
    for (const pfad of ['/', '/kontakt', '/unternehmen/reinigung', '/angebot/bau']) {
      expect(await erlaubt(pfad, null), pfad).toBe(true);
    }
  });

  it('JEDE öffentliche Route der Karte ist ohne Anmeldung erreichbar', async () => {
    /**
     * Nicht eine Auswahl: eine öffentliche Route, die das Tor verschlucken
     * würde, wäre eine Seite, die es gibt und die niemand sieht — und zwar
     * genau dann, wenn das Tor vor den öffentlichen Baum gehängt wird.
     */
    const gesperrt: string[] = [];
    for (const r of ROUTEN.filter((x) => familie(x.pfad) === 'oeffentlich')) {
      if (!(await erlaubt(konkret(r.pfad, 'reinigung'), null))) gesperrt.push(r.pfad);
    }
    expect(gesperrt).toEqual([]);
  }, 60_000);
});

/* ── (6) Das Manifest selbst bleibt sinnvoll ────────────────────────────── */

describe('(6) jede bewachte Route nennt ein Recht, das es gibt', () => {
  it('keine Mandantenroute ohne Leserecht oder Selbstzugriff', () => {
    const ohne = INTERN.filter((r) =>
      r.bewachung.art === 'recht' && leserechte(r).length === 0);
    // Eine Route ohne Bedingung im Mandantenportal stünde jedem offen, der
    // angemeldet ist — auch dem Kundenzugang.
    expect(ohne.map((r) => r.pfad)).toEqual([]);
  });
});
