import { expect, type Page } from '@playwright/test';
import postgres from 'postgres';

/**
 * Anmeldung als ein BESTIMMTER Mensch — nie als „irgendwer mit dieser Rolle".
 *
 * **Warum das eine eigene Datei bekommt.** Zwölf Spezifikationen hatten je
 * eine eigene Abschrift von `[data-cse="dev-anmelden"][data-rolle="…"]
 * .first()`. Das ging gut, solange es je Rolle genau ein Seed-Konto gab —
 * und hörte auf, gut zu gehen, als der Seed ein zweites bekam: `/dev/anmelden`
 * listet `order by b.name`, also griff `.first()` plötzlich „Amir Haddad"
 * statt „Fatima Yildiz", und eine Prüfung über Fatimas zwei Gesellschaften
 * prüfte stillschweigend einen anderen Menschen.
 *
 * Schlimmer noch bei `admin`: das einzige Konto dieser Rolle gehört
 * `reinigung`. Die Aufmass- und die Wachbuchprüfung arbeiten in `bau` und
 * `security` — sie bekamen eine Sitzung im falschen Mandanten, die
 * Slug-Wache antwortete 404 (AUT-06, und das ist richtig so), und der
 * Fehlschlag las sich wie ein kaputter Bildschirm. Acht Fehlschläge in einer
 * Datei, alle aus dieser einen Zeile.
 *
 * `toHaveCount(1)` und nicht `.first()`: dass es GENAU EIN Konto mit dieser
 * Kennung gibt, ist die Zusicherung. Ein `.first()` verschweigt den Tag, an
 * dem es zwei sind.
 */
const DSN = process.env['DATABASE_URL']
  ?? process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

const sql = postgres(DSN, { max: 2, onnotice: () => {} });

/**
 * Meldet ein Konto an — auf dem Weg, den dieses Konto im Betrieb nimmt.
 *
 * **Warum die Weiche HIER sitzt und nicht an den Aufrufstellen.** PR 20 nimmt
 * `/dev/anmelden` die `mitarbeiter`-Konten weg: fuer diesen einen Weg gibt es
 * jetzt eine echte Anmeldung, und eine Abkuerzung daneben hiesse, dass jede
 * Pruefung an ihr vorbeilaeuft. Fuenfzehn Aufrufstellen umzuschreiben waere
 * moeglich gewesen — nur stehen mehrere davon in TABELLEN (`[pfad, konto]`),
 * und eine Weiche, die man je Aufrufer trifft, trifft man irgendwo nicht.
 *
 * Fuer alle anderen Rollen bleibt die Dev-Anmeldung, bis `/auth/login`
 * (E-Mail, Kennwort, zweiter Faktor — Phase 1, AUT-01/AUT-02) gebaut ist.
 */
export async function alsKonto(page: Page, email: string): Promise<void> {
  const [zeile] = await sql<{ rolle: string | null; telefon: string | null }[]>`
    select r.schluessel as rolle, p.telefon
      from benutzer b
      left join person p on p.id = b.person_id
      left join benutzer_mandant bm
             on bm.benutzer_id = b.id and bm.entzogen_am is null and bm.ist_standard
      left join rolle r on r.id = bm.rolle_id
     where b.email = ${email} limit 1`;
  expect(zeile, `kein Seed-Konto ${email}`).toBeDefined();

  if (zeile!.rolle === 'mitarbeiter') {
    await alsMitarbeiter(page, zeile!.telefon);
    return;
  }

  await page.goto('/dev/anmelden');
  const knopf = page.locator(`[data-cse="dev-anmelden"][data-email="${email}"]`);
  await expect(knopf, `kein Seed-Konto ${email}`).toHaveCount(1);
  await knopf.click();
  await page.waitForLoadState('networkidle');
}

/**
 * Der echte Weg fuer Beschaeftigte: Telefon, Code, Sitzung (EMP-01, PR 20).
 *
 * **Die Nummer wird GELESEN, nicht getippt.** Der Seed leitet sie aus der
 * Reihenfolge der Menschen ab; stuende sie hier als Zeichenkette, waere sie
 * beim naechsten zusaetzlichen Menschen falsch — und der Fehlschlag saehe aus
 * wie eine kaputte Anmeldung.
 *
 * Der Code kommt aus der Entwicklungsauskunft der Codeseite. Das ist kein
 * Umweg um die Pruefung: genau diesen Weg nimmt auch ein Mensch ohne
 * SMS-Gateway (01-ORDNERSTRUKTUR §11.3), und der Code geht durch
 * `app.zugang_code_einloesen` wie jeder andere.
 */
export async function alsMitarbeiter(page: Page, telefon: string | null): Promise<void> {
  expect(telefon, 'Mitarbeiterkonto ohne Telefonnummer — kein Zugang moeglich')
    .not.toBeNull();

  await page.goto('/auth/mitarbeiter');
  await page.fill('input[name="telefon"]', telefon!);
  await page.locator('[data-cse="code-anfordern"]').click();
  await page.waitForURL('**/auth/mitarbeiter/code');

  const code = await page.locator('[data-cse="dev-code-wert"]').innerText();
  await page.fill('input[name="code"]', code.trim());
  await page.locator('[data-cse="code-einloesen"]').click();

  /*
   * **Die Nachbedingung, die hier gefehlt hat.**
   *
   * Vorher endete diese Hilfe mit `waitForLoadState('networkidle')` — sie gab
   * zurueck, sobald das Netz ruhig war, AUCH wenn die Anmeldung auf der
   * Nummernseite geendet war. Drei Spezifikationsdateien betreten den
   * Mitarbeiterweg ausschliesslich hier; eine Hilfe ohne Nachbedingung macht
   * aus „die Anmeldung ist kaputt" ein „irgendein spaeterer Bildschirm ist
   * leer", und danach sucht man an der falschen Stelle.
   *
   * Zwei Zusicherungen, weil sie zwei verschiedene Dinge pruefen:
   *  - die Adresse sagt, dass der Weg durchgegangen ist;
   *  - der SITZUNGSKEKS sagt, dass der Browser ihn auch behalten hat. Genau
   *    das unterschied „angemeldet" von „sieht aus wie angemeldet", als ein
   *    einkompiliertes `Secure` den Keks verwarf (D-541) — und keine einzige
   *    Pruefung im Haus hat es bemerkt.
   */
  await page.waitForURL(/\/portal\/mein/u);
  const kekse = await page.context().cookies();
  expect(
    kekse.some((k) => k.name.endsWith('cse_sitzung')),
    'kein Sitzungskeks nach der Anmeldung — der Browser hat ihn nicht behalten',
  ).toBe(true);
}

/**
 * Die Konten des Seeds, benannt statt getippt.
 *
 * Eine Kennung, die in zwölf Dateien als Zeichenkette steht, ist zwölfmal
 * die Gelegenheit, sie falsch zu tippen — und ein Tippfehler wird hier zu
 * „kein Seed-Konto", also zu einem Fehlschlag, der nach einem fehlenden
 * Bildschirm aussieht.
 */
export const KONTO = {
  adminReinigung: 'admin.reinigung@cse-gruppe.de',
  adminBau: 'admin.bau@cse-gruppe.de',
  adminSecurity: 'admin.security@cse-gruppe.de',
  leitungReinigung: 'leitung.reinigung@cse-gruppe.de',
  leitungBau: 'leitung.bau@cse-gruppe.de',
  leitungSecurity: 'leitung.security@cse-gruppe.de',
  gruppe: 'admin@cse-gruppe.de',
  /** Fatima Yildiz — ein Mensch, zwei Gesellschaften (D-09), Sprache Deutsch. */
  fatima: 'fatima.yildiz@cse-gruppe.de',
  /** Amir Haddad — dieselbe Oberfläche auf Arabisch (EMP-12). */
  amir: 'amir.haddad@cse-gruppe.de',
  kunde: 'kunde.demo@example.test',
} as const;
