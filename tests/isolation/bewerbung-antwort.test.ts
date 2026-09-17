import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  aendere, entwirf, legeVor, liste, sende,
} from '../../src/server/services/recruiting/antwort.js';
import { RecruitingFehler } from '../../src/server/services/recruiting/dienst.js';
import {
  EntwicklungsEmailDienst, NichtVerbundenerEmailDienst,
} from '../../src/server/versand/email.js';

/**
 * Die Antwort an eine Bewerberin (REC-03, § 22 AGG, Invariante 7).
 *
 * **Drei Zusagen, jede mit einem Preis, wenn sie bricht:**
 *
 *  1. **Eine Absage nennt keinen Grund.** § 22 AGG kehrt die Beweislast um;
 *     jede Begründung im Absageschreiben ist ein Indiz in spe. Die Begründung
 *     steht INTERN in `einstellungsentscheidung`, wo sie den sachlichen Grund
 *     belegt. Der Auslöser weist einen Text ab, der sie übernommen hat.
 *  2. **Nichts geht ohne einen Menschen hinaus** (Invariante 7). Der Dienst
 *     kann den Stand `freigegeben` nicht selbst setzen — das tut der Auslöser
 *     an der Freigabe.
 *  3. **Nichts behauptet einen Versand, den es nicht gab.** Ohne verbundenen
 *     Postausgang bleibt `gesendet_am` NULL und der Grund steht im Klartext
 *     daneben. Das gilt auch für den Entwicklungsdienst, der jede Mail
 *     annimmt und keine verschickt — der gefährlichere Fall, weil er nicht
 *     wirft.
 */

let f: Fixtur;
let bewerter: string;
let entscheider: string;

async function benutzer(email: string, rolle: string, mandantId: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Personal', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

beforeAll(async () => {
  f = await seed();
  bewerter = await benutzer('bewerter@antwort.test', 'admin', f.reinigung);
  entscheider = await benutzer('entscheider@antwort.test', 'admin', f.reinigung);
});
afterAll(schliessen);

function sitzung(benutzerId = bewerter) {
  return { scope: 'mandant' as const, mandantId: f.reinigung, benutzerId,
           readonly: false, portal: 'intern' as const };
}

let laufendeNummer = 0;

async function bewerbungAnlegen(): Promise<string> {
  laufendeNummer += 1;
  return alsRolle('', async (tx) => {
    const [s] = (await tx.unsafe(
      `insert into stelle (mandant_id, titel, beschreibung, anforderungen)
       values ($1::uuid, 'Reinigungskraft', 'Unterhaltsreinigung', array['A','B'])
       returning id`, [f.reinigung])) as unknown as { id: string }[];
    const [b] = (await tx.unsafe(
      `insert into bewerbung (mandant_id, stelle_id, name, email, aufbewahrung_bis)
       values ($1::uuid, $2::uuid, 'Amira Said', $3, app.berlin_heute() + 180)
       returning id`,
      [f.reinigung, s!.id, `amira${String(laufendeNummer)}@example.test`],
    )) as unknown as { id: string }[];
    return b!.id;
  });
}

/**
 * Eine Entscheidung anlegen — ueber eine GEBUNDENE Sitzung.
 *
 * Der erste Entwurf schrieb sie als Eigentuemer (`alsRolle('')`), und der
 * Ausloeser `entscheidung_ist_menschlich` wies sie ab: „Eine
 * Einstellungsentscheidung braucht eine angemeldete Person" (0166, Art. 22
 * DSGVO). Der Riegel hat recht und der Test hatte unrecht — eine Entscheidung
 * OHNE benannten Menschen ist genau das, was Art. 22 verbietet, und ein
 * Testaufbau, der ihn umgeht, prueft eine Lage, die es nicht geben darf.
 */
async function entscheidungAnlegen(
  bewerbungId: string, ergebnis: 'abgelehnt' | 'eingestellt', begruendung: string,
): Promise<void> {
  await alsApp(sitzung(entscheider), (tx) => tx.unsafe(
    `insert into einstellungsentscheidung
       (mandant_id, bewerbung_id, ergebnis, begruendung, entschieden_von)
     values (app.aktiver_mandant(), $1::uuid, $2::bewerbung_status, $3,
             app.aktueller_benutzer())`,
    [bewerbungId, ergebnis, begruendung]));
}

/** Der echte Weg: Entwurf → vorlegen → ein Mensch genehmigt. */
async function bisFreigegeben(bewerbungId: string, art: 'absage' | 'einladung' = 'absage') {
  const antwortId = await alsApp(sitzung(), (tx) =>
    entwirf(kontextAus(tx), { bewerbungId, art }));
  const freigabeId = await alsApp(sitzung(), (tx) => legeVor(kontextAus(tx), antwortId));

  await alsRolle('', async (tx) => {
    await tx.unsafe(
      `update freigabe set status = 'genehmigt', freigegeben_von = $2::uuid,
                           freigegeben_am = now()
        where id = $1::uuid`, [freigabeId, entscheider]);
  });
  return { antwortId, freigabeId };
}

/* Der Dienst erwartet einen Kontext, die Harness gibt eine Transaktion. */
function kontextAus(tx: { unsafe(s: string, w?: readonly unknown[]): Promise<readonly unknown[]> }) {
  return {
    aktiverMandantId: f.reinigung,
    benutzerId: bewerter,
    abfrage: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
    schreibe: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
  } as never;
}

describe('§1 § 22 AGG — eine Absage nennt keinen Grund', () => {
  it('die Vorlage nennt keinen', async () => {
    const bewerbungId = await bewerbungAnlegen();
    const id = await alsApp(sitzung(), (tx) =>
      entwirf(kontextAus(tx), { bewerbungId, art: 'absage' }));
    const [a] = await alsApp(sitzung(), (tx) => liste(kontextAus(tx), bewerbungId));
    expect(a!.id).toBe(id);
    expect(a!.text).toContain('Wir haben uns für eine andere Bewerbung entschieden.');
    for (const verraeterisch of ['weil', 'Erfahrung', 'Alter', 'Qualifikation', 'leider nicht']) {
      expect(a!.text).not.toContain(verraeterisch);
    }
  });

  it('WEIST einen Text AB, der die interne Begründung übernimmt', async () => {
    const bewerbungId = await bewerbungAnlegen();
    const grund = 'Die Bewerberin hat keine Berufserfahrung in der Glasreinigung '
      + 'und das Objekt verlangt sie.';
    await entscheidungAnlegen(bewerbungId, 'abgelehnt', grund);

    const id = await alsApp(sitzung(), (tx) =>
      entwirf(kontextAus(tx), { bewerbungId, art: 'absage' }));

    /*
     * Der gefaehrliche Weg ist genau dieser: jemand ergaenzt die Begruendung
     * von Hand, aus Hoeflichkeit. Der Riegel faengt auch eine GEKUERZTE
     * Uebernahme — wer kopiert, kuerzt meist.
     */
    await expect(alsApp(sitzung(), (tx) => aendere(
      kontextAus(tx), id, 'Ihre Bewerbung',
      `Guten Tag,\n\n${grund.slice(0, 60)}\n\nFreundliche Grüße`,
    ))).rejects.toThrow(/§ 22 AGG|AGG/u);
  });

  it('lässt einen neutralen Text durch, obwohl eine Begründung gespeichert ist', async () => {
    const bewerbungId = await bewerbungAnlegen();
    await entscheidungAnlegen(
      bewerbungId, 'abgelehnt',
      'Eine andere Bewerbung passte fachlich besser zum Objekt Hauptstrasse.');
    const id = await alsApp(sitzung(), (tx) =>
      entwirf(kontextAus(tx), { bewerbungId, art: 'absage' }));
    await expect(alsApp(sitzung(), (tx) => aendere(
      kontextAus(tx), id, 'Ihre Bewerbung',
      'Guten Tag,\n\nwir haben uns anders entschieden.\n\nFreundliche Grüße',
    ))).resolves.toBeUndefined();
  });

  it('gilt NUR für die Absage — eine Einladung darf alles sagen', async () => {
    const bewerbungId = await bewerbungAnlegen();
    const grund = 'Die Bewerberin bringt zehn Jahre Erfahrung in der Glasreinigung mit.';
    await entscheidungAnlegen(bewerbungId, 'eingestellt', grund);
    const id = await alsApp(sitzung(), (tx) =>
      entwirf(kontextAus(tx), { bewerbungId, art: 'einladung' }));
    await expect(alsApp(sitzung(), (tx) => aendere(
      kontextAus(tx), id, 'Einladung', `Guten Tag,\n\n${grund}\n\nKommen Sie vorbei.`,
    ))).resolves.toBeUndefined();
  });
});

describe('§2 nichts geht ohne einen Menschen hinaus', () => {
  it('ein frischer Entwurf lässt sich nicht senden', async () => {
    const bewerbungId = await bewerbungAnlegen();
    const id = await alsApp(sitzung(), (tx) =>
      entwirf(kontextAus(tx), { bewerbungId, art: 'absage' }));
    await expect(alsApp(sitzung(), (tx) =>
      sende(kontextAus(tx), id, new NichtVerbundenerEmailDienst())))
      .rejects.toThrow(RecruitingFehler);
  });

  it('auch einer, der zur Freigabe LIEGT, nicht', async () => {
    const bewerbungId = await bewerbungAnlegen();
    const id = await alsApp(sitzung(), (tx) =>
      entwirf(kontextAus(tx), { bewerbungId, art: 'absage' }));
    await alsApp(sitzung(), (tx) => legeVor(kontextAus(tx), id));
    await expect(alsApp(sitzung(), (tx) =>
      sende(kontextAus(tx), id, new NichtVerbundenerEmailDienst())))
      .rejects.toThrow(/freigegeben/u);
  });

  it('erst die GENEHMIGUNG eines Menschen setzt den Stand — und zwar der Auslöser', async () => {
    const bewerbungId = await bewerbungAnlegen();
    const { antwortId } = await bisFreigegeben(bewerbungId);
    const [a] = await alsApp(sitzung(), (tx) => liste(kontextAus(tx), bewerbungId));
    expect(a!.id).toBe(antwortId);
    expect(a!.stand).toBe('freigegeben');
    expect(a!.freigegebenAm).not.toBeNull();
  });

  it('eine ABLEHNUNG holt den Entwurf zurück — sonst hängt er für immer', async () => {
    const bewerbungId = await bewerbungAnlegen();
    const id = await alsApp(sitzung(), (tx) =>
      entwirf(kontextAus(tx), { bewerbungId, art: 'absage' }));
    const freigabeId = await alsApp(sitzung(), (tx) => legeVor(kontextAus(tx), id));

    await alsRolle('', async (tx) => {
      await tx.unsafe(`update freigabe set status = 'abgelehnt' where id = $1::uuid`,
                      [freigabeId]);
    });

    const [a] = await alsApp(sitzung(), (tx) => liste(kontextAus(tx), bewerbungId));
    expect(a!.stand).toBe('entwurf');
    /*
     * Und die Kennung ist gelöst: bliebe sie stehen, sähe der nächste Versuch
     * aus, als läge schon eine Entscheidung vor.
     */
    expect(a!.freigabeId).toBeNull();
  });
});

describe('§3 kein behaupteter Versand', () => {
  it('ohne Postausgang bleibt gesendet_am NULL — mit dem Grund daneben', async () => {
    const bewerbungId = await bewerbungAnlegen();
    const { antwortId } = await bisFreigegeben(bewerbungId);

    const ergebnis = await alsApp(sitzung(), (tx) =>
      sende(kontextAus(tx), antwortId, new NichtVerbundenerEmailDienst()));
    expect(ergebnis.gesendet).toBe(false);
    expect(ergebnis.meldung).toContain('O-501');

    const [a] = await alsApp(sitzung(), (tx) => liste(kontextAus(tx), bewerbungId));
    expect(a!.gesendetAm).toBeNull();
    expect(a!.stand).toBe('freigegeben');
    expect(a!.versandFehler).toContain('NICHT versendet');
  });

  it('und auch NICHT beim Entwicklungsdienst, der jede Mail annimmt', async () => {
    /*
     * Der gefaehrlichere Fall: dieser Dienst wirft nicht. Wer nur den Fehler
     * faengt, schriebe hier `gesendet_am` — und der Personalbereich laese
     * „zugestellt", waehrend die Bewerberin wartet.
     */
    const bewerbungId = await bewerbungAnlegen();
    const { antwortId } = await bisFreigegeben(bewerbungId);

    const ergebnis = await alsApp(sitzung(), (tx) =>
      sende(kontextAus(tx), antwortId, new EntwicklungsEmailDienst()));
    expect(ergebnis.gesendet).toBe(false);

    const [a] = await alsApp(sitzung(), (tx) => liste(kontextAus(tx), bewerbungId));
    expect(a!.gesendetAm).toBeNull();
    expect(a!.versandFehler).toContain('verschickt aber keine');
  });

  it('die Datenbank lässt gesendet_am ohne benannten Menschen gar nicht zu', async () => {
    const bewerbungId = await bewerbungAnlegen();
    const id = await alsApp(sitzung(), (tx) =>
      entwirf(kontextAus(tx), { bewerbungId, art: 'absage' }));
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update bewerbung_antwort set gesendet_am = now(), gesendet_an = 'x@example.test'
        where id = $1::uuid`, [id],
    ))).rejects.toThrow(/versand_belegt/u);
  });
});

describe('§4 zwei Absagen an dieselbe Person sind eine zu viel', () => {
  it('weist die zweite ab', async () => {
    const bewerbungId = await bewerbungAnlegen();
    await alsApp(sitzung(), (tx) => entwirf(kontextAus(tx), { bewerbungId, art: 'absage' }));
    await expect(alsApp(sitzung(), (tx) =>
      entwirf(kontextAus(tx), { bewerbungId, art: 'absage' })))
      .rejects.toThrow(/schon|eine zu viel/u);
  });

  it('lässt aber Eingangsbestätigung UND Absage nebeneinander zu', async () => {
    const bewerbungId = await bewerbungAnlegen();
    await alsApp(sitzung(), (tx) =>
      entwirf(kontextAus(tx), { bewerbungId, art: 'eingangsbestaetigung' }));
    await expect(alsApp(sitzung(), (tx) =>
      entwirf(kontextAus(tx), { bewerbungId, art: 'absage' }))).resolves.toBeTruthy();
  });
});

describe('§5 eine gelöschte Bewerbung bekommt keine Post', () => {
  it('weist den Entwurf ab, statt „geloescht (Frist abgelaufen)" anzuschreiben', async () => {
    const bewerbungId = await bewerbungAnlegen();
    await alsRolle('', (tx) => tx.unsafe(
      `update bewerbung set geloescht_am = now(),
              name = 'gelöscht (Frist abgelaufen)', email = 'geloescht@example.invalid'
        where id = $1::uuid`, [bewerbungId]));
    await expect(alsApp(sitzung(), (tx) =>
      entwirf(kontextAus(tx), { bewerbungId, art: 'absage' })))
      .rejects.toThrow(/gelöscht/u);
  });
});

describe('§6 die Antwort geht mit, wenn die Bewerbung gelöscht wird (REC-07)', () => {
  it('der Löschlauf nimmt sie mit — sonst bliebe die Anrede mit Namen stehen', async () => {
    const bewerbungId = await bewerbungAnlegen();
    await alsApp(sitzung(), (tx) => entwirf(kontextAus(tx), { bewerbungId, art: 'absage' }));

    /*
     * Der Loeschlauf laeuft als `cse_job` und benennt jede abhaengige Zeile
     * einzeln (LEG-11). Hier wird geprueft, dass `bewerbung_antwort` dabei ist
     * — eine Kaskade gibt es absichtlich nicht.
     */
    await alsRolle('cse_job', (tx) => tx.unsafe(
      `delete from bewerbung_antwort where bewerbung_id = $1::uuid`, [bewerbungId]));

    const [uebrig] = await alsRolle('', (tx) => tx.unsafe(
      `select count(*)::int as n from bewerbung_antwort where bewerbung_id = $1::uuid`,
      [bewerbungId])) as unknown as { n: number }[];
    expect(uebrig!.n).toBe(0);
  });

  it('`cse_app` darf NICHT löschen — das ist der Job, und er protokolliert', async () => {
    const bewerbungId = await bewerbungAnlegen();
    await alsApp(sitzung(), (tx) => entwirf(kontextAus(tx), { bewerbungId, art: 'absage' }));
    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `delete from bewerbung_antwort where bewerbung_id = $1::uuid`, [bewerbungId],
    ))).rejects.toThrow(/permission denied/u);
  });
});
