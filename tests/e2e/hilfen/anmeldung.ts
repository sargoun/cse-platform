import { expect, type Page } from '@playwright/test';

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
export async function alsKonto(page: Page, email: string): Promise<void> {
  await page.goto('/dev/anmelden');
  const knopf = page.locator(`[data-cse="dev-anmelden"][data-email="${email}"]`);
  await expect(knopf, `kein Seed-Konto ${email}`).toHaveCount(1);
  await knopf.click();
  await page.waitForLoadState('networkidle');
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
  leitungBau: 'leitung.bau@cse-gruppe.de',
  leitungSecurity: 'leitung.security@cse-gruppe.de',
  gruppe: 'admin@cse-gruppe.de',
  /** Fatima Yildiz — ein Mensch, zwei Gesellschaften (D-09), Sprache Deutsch. */
  fatima: 'fatima.yildiz@cse-gruppe.de',
  /** Amir Haddad — dieselbe Oberfläche auf Arabisch (EMP-12). */
  amir: 'amir.haddad@cse-gruppe.de',
  kunde: 'kunde.demo@example.test',
} as const;
