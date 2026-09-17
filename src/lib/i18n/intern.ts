import { PORTAL_EIGENNAME, PORTAL_SPRACHEN, type PortalSprache } from './texte';

/**
 * Die Sprachen der INTERNEN Oberflaeche — Deutsch und Englisch.
 *
 * **Warum zwei und nicht vier.** Das Mitarbeiterportal spricht vier Sprachen,
 * weil die Arbeiterin am Objekt keine Wahl hat: sie muss ihre Schicht lesen
 * koennen (EMP-12, SPEC §10). Die internen Bildschirme sind eine andere Lage.
 * Sie fuehren Buchhaltung, Vergabe und Personalakten, ihr Vokabular ist das
 * des UStG, der VOB und der GoBD, und die Haelfte davon hat gar kein
 * englisches Wort — `Aufmass`, `Nachtrag`, `Leistungsnachweis`. Vier Sprachen
 * hiessen vier Uebersetzungen dieser Begriffe, und drei davon waeren eine
 * Erfindung.
 *
 * Englisch kommt dazu, weil die Gruppe Steuerberatung, Entwicklung und
 * Auditoren einkauft, die nicht alle Deutsch lesen — und weil ein Bildschirm,
 * den der Pruefer nicht lesen kann, keinen Nachweis fuehrt.
 */
export const INTERN_SPRACHEN = ['de', 'en'] as const;
export type InternSprache = (typeof INTERN_SPRACHEN)[number];

export function istInternSprache(wert: string): wert is InternSprache {
  return (INTERN_SPRACHEN as readonly string[]).includes(wert);
}

/** Der Name der Sprache IN ihrer Sprache — nie uebersetzt (Usability). */
export const INTERN_EIGENNAME: Readonly<Record<InternSprache, string>> = {
  de: 'Deutsch', en: 'English',
};

/** Was in `<html lang>` steht (WCAG 3.1.1). */
export const INTERN_BCP47: Readonly<Record<InternSprache, string>> = {
  de: 'de-DE', en: 'en',
};

/**
 * Welche der zwei internen Sprachen fuer eine Portalsprache gilt.
 *
 * **`ar` und `tr` fallen auf DEUTSCH, nicht auf Englisch** (D-592). Wer als
 * Person `tr` gewaehlt hat, hat das fuer das Mitarbeiterportal getan; ueber
 * sein Englisch sagt die Wahl nichts. Ein internes Konto auf Englisch zu
 * stellen, weil jemand Tuerkisch bevorzugt, waere geraten — und die Begriffe,
 * die dort stehen, sind die rechtlich bindenden deutschen. Deutsch ist die
 * Sprache, in der diese Bildschirme richtig sind; Englisch ist die, die
 * jemand ausdruecklich waehlt.
 *
 * `null` — keine Angabe, ein Konto ohne Person, ein unbekannter Wert in der
 * Spalte — ist derselbe Fall: Deutsch.
 */
export function internSprache(portal: PortalSprache | null | undefined): InternSprache {
  return portal === 'en' ? 'en' : 'de';
}

/**
 * Die Beschriftungen der internen Portalhuelle, je Sprache (D-419, D-592).
 *
 * **Die Schluessel sind die der Register**, nicht frei gewaehlt: jeder
 * `schluessel` aus `registry/navigation.ts` (beide Listen) und jedes
 * Tab-Ziel der `intern`-Leiste aus `registry/tableiste.ts` steht hier, dazu
 * die sechs `sitzung.*`/`pfad.*`-Schluessel der Kopfzeile. `PortalRahmen`
 * schlaegt unter genau diesem Schluessel nach und faellt sonst auf das
 * deutsche Label des Registers zurueck.
 *
 * **Und dieser Rueckfall ist genau die Gefahr.** Ein neuer Navigationspunkt,
 * den hier niemand eintraegt, wirft keinen Fehler — er steht auf dem
 * englischen Bildschirm auf Deutsch, und das sieht aus wie eine Entscheidung.
 * `tests/kern/intern-beschriftungen.test.ts` vergleicht deshalb die
 * Schluesselmengen gegen die Register und faellt, wenn einer fehlt.
 *
 * **Deutsch steht hier noch einmal, obwohl das Register es schon traegt.**
 * Ohne die deutsche Spalte waere die Vollstaendigkeitspruefung nur fuer
 * Englisch moeglich, und ein Tippfehler im Schluessel — `auftrage` statt
 * `auftraege` — faende sich erst am Bildschirm. Mit beiden Spalten faellt er
 * gegen das Register auf.
 */
export const INTERN_BESCHRIFTUNGEN:
Readonly<Record<InternSprache, Readonly<Record<string, string>>>> = {
  de: {
    dashboard: 'Übersicht',
    crm: 'CRM',
    objekte: 'Objekte',
    dienstplan: 'Dienstplan',
    zeiten: 'Zeiten',
    personal: 'Personal',
    angebote: 'Angebote',
    auftraege: 'Aufträge',
    rechnungen: 'Rechnungen',
    zahlungen: 'Zahlungen',
    eingangsrechnungen: 'Eingangsrechnungen',
    ausgangsbuch: 'Ausgangsbuch',
    mahnungen: 'Mahnungen',
    buchungen: 'Buchungen',
    bank: 'Bank',
    datev: 'DATEV',
    dokumente: 'Dokumente',
    agenten: 'Agenten',
    freigaben: 'Freigaben',
    social: 'Social Media',
    recruiting: 'Recruiting',
    bau: 'Bau',
    security: 'Security',
    reinigung: 'Reinigung',
    qualitaet: 'Qualität',
    dienstanweisungen: 'Dienstanweisungen',
    schluessel: 'Schlüssel',
    einstellungen: 'Einstellungen',
    uebersicht: 'Übersicht',
    finanzen: 'Finanzen',
    'offene-posten': 'Offene Posten',
    kunden: 'Kunden',
    leads: 'Leads',
    projekte: 'Projekte',
    personen: 'Personen',
    auslastung: 'Auslastung',
    berichte: 'Berichte',
    protokoll: 'Protokoll',
    radar: 'Radar',
    mehr: 'Mehr',
    'sitzung.label': 'Sitzung',
    'sitzung.bereich': 'Bereich wechseln',
    'sitzung.konto': 'Konto',
    'sitzung.website': 'Website',
    'sitzung.abmelden': 'Abmelden',
    'pfad.label': 'Pfad',
    'sprache.label': 'Sprache',
  },
  en: {
    dashboard: 'Overview',
    crm: 'CRM',
    /*
     * `Objekt` ist das Gebaeude unter Vertrag — der Ort, an dem gereinigt und
     * bewacht wird. „Object" waere die woertliche und die falsche Uebersetzung;
     * „Property" klaenge nach Eigentum, das der Gruppe nicht gehoert.
     */
    objekte: 'Sites',
    dienstplan: 'Schedule',
    zeiten: 'Time',
    personal: 'Staff',
    angebote: 'Quotes',
    auftraege: 'Orders',
    rechnungen: 'Invoices',
    zahlungen: 'Payments',
    eingangsrechnungen: 'Supplier invoices',
    /* Rechnungsausgangsbuch — das Journal der ausgehenden Rechnungen (GoBD). */
    ausgangsbuch: 'Invoice journal',
    /* Mahnwesen heisst im Englischen „dunning" — „reminders" waere unverbindlich. */
    mahnungen: 'Dunning',
    buchungen: 'Postings',
    bank: 'Bank',
    /* Ein Produktname. Bleibt. */
    datev: 'DATEV',
    dokumente: 'Documents',
    agenten: 'Agents',
    freigaben: 'Approvals',
    social: 'Social media',
    recruiting: 'Recruiting',
    bau: 'Construction',
    security: 'Security',
    reinigung: 'Cleaning',
    qualitaet: 'Quality',
    /* Im Bewachungsgewerbe die „standing orders" des Postens. */
    dienstanweisungen: 'Standing orders',
    schluessel: 'Keys',
    einstellungen: 'Settings',
    uebersicht: 'Overview',
    finanzen: 'Finance',
    'offene-posten': 'Open items',
    kunden: 'Customers',
    leads: 'Leads',
    projekte: 'Projects',
    personen: 'People',
    auslastung: 'Utilisation',
    berichte: 'Reports',
    protokoll: 'Audit log',
    radar: 'Radar',
    mehr: 'More',
    'sitzung.label': 'Session',
    'sitzung.bereich': 'Switch area',
    'sitzung.konto': 'Account',
    'sitzung.website': 'Website',
    'sitzung.abmelden': 'Sign out',
    'pfad.label': 'Breadcrumb',
    'sprache.label': 'Language',
  },
};

/**
 * Die Texte der Bauzustandsseite (`NochNichtGebaut`).
 *
 * **Warum ausgerechnet die zuerst.** Sie steht auf 136 der 434 Routen der
 * Seitenkarte — mehr als jede andere Seite dieses Portals. Eine
 * zweisprachige Huelle um einen deutschen Absatz herum waere genau dort am
 * auffaelligsten, wo am meisten Leute landen.
 *
 * `pfad` und `phase` reisen als Bausteine hinein, statt den Satz zu
 * zerschneiden: eine Sprache, die die Wortstellung anders baut, braucht den
 * ganzen Satz in der Hand.
 */
export interface BauzustandTexte {
  readonly titel: string;
  /** `(pfad, phase)` → der Satz. `phase === null` heisst „spaeter, ohne Zahl". */
  readonly satz: (phase: number | null) => readonly [vor: string, nach: string];
  readonly warumKeinLeererBildschirm: string;
}

export const BAUZUSTAND_TEXTE: Readonly<Record<InternSprache, BauzustandTexte>> = {
  de: {
    titel: 'Dieses Modul wird noch gebaut',
    satz: (phase) => [
      ' steht in der Seitenkarte und ist Ihnen freigegeben — die Seite dahinter entsteht',
      phase === null ? ' in einer späteren Phase.' : ` in Phase ${phase}.`,
    ],
    warumKeinLeererBildschirm:
      'Hier steht bewusst kein leerer Bildschirm mit einer Überschrift: eine leere Liste '
      + 'liest sich wie „es gibt nichts“, und das wäre eine Aussage über Ihre Daten statt '
      + 'über den Bauzustand.',
  },
  en: {
    titel: 'This module is still being built',
    satz: (phase) => [
      ' is on the site map and you have access to it — the page behind it is being built',
      phase === null ? ' in a later phase.' : ` in phase ${phase}.`,
    ],
    warumKeinLeererBildschirm:
      'This is deliberately not an empty screen with a heading: an empty list reads as '
      + '“there is nothing here”, and that would be a statement about your data rather '
      + 'than about what has been built.',
  },
};

export function bauzustandTexte(sprache: PortalSprache | null | undefined): BauzustandTexte {
  return BAUZUSTAND_TEXTE[internSprache(sprache)];
}

/**
 * Die Beschriftungen fuer eine Sitzung — das, was `PortalRahmen` erwartet.
 *
 * Eine Funktion und keine direkte Indizierung, damit die Aufruferin die
 * Portalsprache uebergeben kann und die Abbildung auf die zwei internen
 * Sprachen an EINER Stelle steht.
 */
export function internBeschriftungen(
  sprache: PortalSprache | null | undefined,
): Readonly<Record<string, string>> {
  return INTERN_BESCHRIFTUNGEN[internSprache(sprache)];
}

/**
 * Der Hinweis fuer jemanden, dessen Portalsprache der Umschalter gar nicht
 * anbietet (D-592).
 *
 * **Warum es ihn geben muss.** Die Spalte `sprache` ist EINE Spalte fuer beide
 * Portale. Wer als Arbeiterin `ar` gewaehlt hat und sich am internen Portal
 * anmeldet, sieht hier Deutsch markiert — ein Klick auf „Deutsch" oder
 * „English" ersetzt dann seine Arbeiterportal-Sprache, ohne dass irgendwo
 * stuende, dass das passiert. Ein Bildschirm, der eine Wahl STILL
 * ueberschreibt, ist schlimmer als einer, der sie gar nicht anbietet.
 *
 * Der Text steht in beiden internen Sprachen, obwohl in dieser Lage immer
 * Deutsch gilt: `internSprache('ar')` ist `de`. Er stuende auf Englisch nur
 * dann, wenn jemand vorher ausdruecklich Englisch gewaehlt haette — und dann
 * ist `fremdeWahl` null und der Hinweis erscheint nicht. Er steht trotzdem
 * da, weil eine Karte mit einem Loch darin beim naechsten Leser wie ein
 * Versehen aussieht.
 */
export const SPRACH_HINWEIS: Readonly<Record<InternSprache, (fremd: string) => string>> = {
  de: (fremd) =>
    `Ihre Portalsprache ist ${fremd}. Diese Ansicht gibt es nur auf Deutsch und `
    + 'Englisch — eine Wahl hier ersetzt auch die Sprache Ihres Mitarbeiterportals.',
  en: (fremd) =>
    `Your portal language is ${fremd}. This view exists only in German and English — `
    + 'choosing here also replaces the language of your employee portal.',
};

export function sprachHinweis(
  sprache: PortalSprache | null | undefined, fremd: PortalSprache,
): string {
  return SPRACH_HINWEIS[internSprache(sprache)](PORTAL_EIGENNAME[fremd]);
}

/**
 * Die Sprachen, die der Umschalter im internen Portal anbietet — mit dem
 * Wert, der in die Spalte `sprache` geschrieben wird.
 *
 * **Er zeigt zwei, die Spalte kennt vier.** Wer als Arbeiterin `ar` gewaehlt
 * hat und sich am internen Portal anmeldet, sieht hier Deutsch markiert; ein
 * Klick auf Englisch ueberschriebe seine Arbeiterportal-Sprache. Deshalb
 * traegt der Umschalter die aktuelle Wahl als `aktuell` mit — auch dann, wenn
 * sie keine der zwei ist — und die Huelle sagt es an.
 */
export function internSprachwahl(aktuell: PortalSprache | null): {
  readonly aktiv: InternSprache;
  readonly fremdeWahl: PortalSprache | null;
} {
  const aktiv = internSprache(aktuell);
  const fremd = aktuell !== null && !istInternSprache(aktuell) ? aktuell : null;
  return { aktiv, fremdeWahl: fremd };
}

/** Die vier Portalsprachen, hier nur als Typwaechter re-exportiert. */
export const ALLE_PORTAL_SPRACHEN = PORTAL_SPRACHEN;
