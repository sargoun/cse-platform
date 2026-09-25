/**
 * Die Wörter der neuen Abschnitte des Dokumentblatts — in beiden Sprachen
 * (DOC-04, DOC-05, V-219, D-712, D-713, D-592).
 *
 * **Nur die neuen Abschnitte.** Das Blatt selbst steht noch auf der
 * eingefrorenen Ausnahmeliste der Übersetzungswache
 * (`scripts/guards/uebersetzung-ausnahmen.ts`); was hier dazukommt, kommt
 * zweisprachig dazu — eine neue deutsche Verdrahtung wäre genau der
 * Rückstand, gegen den die Wache gebaut ist.
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text**, wo sie
 * Rechtsbedeutung tragen (GoBD, § 147 AO); erklärt wird daneben.
 */
import type { InternSprache } from '../intern.js';

/**
 * Die Gründe, mit denen eine neue Fassung abgewiesen wird (`FassungFehler`,
 * dazu die Prüfkette der Datei und der Speicher — `api/dokumente/[id]/version`).
 */
export type FassungAbweisungText =
  | 'nicht_gefunden' | 'geloescht' | 'kategorie_gesperrt' | 'an_buchung' | 'ohne_kette'
  | 'leer' | 'kein_recht' | 'speicher' | 'datei_leer' | 'datei_unbekannt'
  | 'datei_nicht_erlaubt' | 'datei_widerspruch' | 'datei_zu_gross';

/** Die Gründe, mit denen die Mitarbeiterfreigabe abgewiesen wird (`DokumentfreigabeFehler`). */
export type MitarbeiterfreigabeAbweisung =
  'nicht_gefunden' | 'geloescht' | 'schon_so' | 'ohne_grund' | 'kein_recht';

export interface DokumentBlattTexte {
  /* ── Fassungen (V-219 b) ────────────────────────────────────────────── */
  readonly faTitel: string;
  readonly faErklaerung: string;
  readonly faBeschriftung: string;
  readonly faSpalteFassung: string;
  readonly faSpalteAbgelegt: string;
  readonly faSpalteVon: string;
  readonly faSpalteGroesse: string;
  readonly faSpalteTyp: string;
  readonly faSpaltePruefsumme: string;
  readonly faSpalteAbruf: string;
  readonly faAktuell: string;
  readonly faAbrufen: string;
  readonly faKeine: string;
  readonly faNeuTitel: string;
  readonly faDatei: string;
  readonly faNeuErklaerung: string;
  /** `{n}` ist die Nummer der neuen Fassung. */
  readonly faAbschicken: string;
  readonly faOhneRecht: string;
  readonly faGesperrtKategorie: string;
  readonly faGesperrtBuchung: string;
  readonly faOhneSpeicher: string;
  /** `{n}` ist die Nummer der abgelegten Fassung. */
  readonly faAbgelegt: string;
  readonly faNichtAbgelegt: string;
  readonly faFehler: Readonly<Record<FassungAbweisungText, string>>;
  readonly faFehlerSonst: string;

  /* ── Freigabe für die Belegschaft (V-219 a) ─────────────────────────── */
  readonly mfTitel: string;
  readonly mfIstFrei: string;
  readonly mfIstNichtFrei: string;
  readonly mfKategorie: string;
  /** Warum die Kategorie hier groß steht (O-851). */
  readonly mfKategorieHinweis: string;
  readonly mfOhneRecht: string;
  readonly mfGrund: string;
  readonly mfGrundBeispielZuruecknehmen: string;
  readonly mfGrundBeispielFreigeben: string;
  readonly mfZuruecknehmen: string;
  readonly mfFreigeben: string;
  /** Was die Rücknahme nicht kann — der Satz unter dem Knopf. */
  readonly mfRuecknahmeGrenze: string;
  readonly mfFreigabeFolge: string;
  readonly mfGesetzt: string;
  readonly mfZurueckgenommen: string;
  readonly mfNichtGeaendert: string;
  readonly mfFehler: Readonly<Record<MitarbeiterfreigabeAbweisung, string>>;
  readonly mfFehlerSonst: string;
}

export const DOKUMENT_BLATT_TEXTE: Readonly<Record<InternSprache, DokumentBlattTexte>> = {
  de: {
    faTitel: 'Fassungen',
    faErklaerung:
      'Jede Fassung bleibt, wie sie abgelegt wurde: eine neue überschreibt keine alte, und '
      + 'keine wird gelöscht. Je Fassung steht der SHA-256 der gespeicherten Bytes da — die '
      + 'Grundlage, an der sich zeigen lässt, dass eine Datei unverändert ist (GoBD).',
    faBeschriftung: 'Fassungen dieses Dokuments, neueste zuerst',
    faSpalteFassung: 'Fassung',
    faSpalteAbgelegt: 'Abgelegt',
    faSpalteVon: 'Von',
    faSpalteGroesse: 'Größe',
    faSpalteTyp: 'Typ',
    faSpaltePruefsumme: 'SHA-256',
    faSpalteAbruf: 'Datei',
    faAktuell: 'aktuell',
    faAbrufen: 'Abrufen',
    faKeine:
      'Für dieses Dokument steht keine Fassung in der Kette — es wurde abgelegt, bevor es '
      + 'die Kette gab. Neben eine Datei, deren Prüfsumme niemand kennt, lässt sich keine '
      + 'zweite Fassung stellen.',
    faNeuTitel: 'Neue Fassung ablegen',
    faDatei: 'Datei',
    faNeuErklaerung:
      'Die Datei wird geprüft wie beim Ablegen: Typ aus dem Inhalt, Metadaten entfernt, '
      + 'Größe begrenzt. Die bisherige Fassung bleibt in der Kette und abrufbar.',
    faAbschicken: 'Als Fassung {n} ablegen',
    faOhneRecht: 'Neue Fassungen legt ab, wer',
    faGesperrtKategorie:
      'Rechnungen, Belege und Buchhaltungsunterlagen bekommen keine neue Fassung (GoBD, '
      + '§ 147 AO): berichtigt wird durch Gegenbuchung oder Storno, nie durch den Austausch '
      + 'der Datei.',
    faGesperrtBuchung:
      'Eine Buchungszeile beruft sich auf dieses Dokument (ACC-03, § 147 AO) — seine Datei '
      + 'wird nicht durch eine neue Fassung ersetzt.',
    faOhneSpeicher:
      'Der Dateispeicher ist nicht verbunden — eine neue Fassung lässt sich nicht ablegen '
      + '(Einstellungen › Integrationen).',
    faAbgelegt: 'Fassung {n} ist abgelegt. Die vorige bleibt in der Kette und abrufbar.',
    faNichtAbgelegt: 'Keine Fassung abgelegt.',
    faFehler: {
      nicht_gefunden: 'Das Dokument ist nicht erreichbar oder schon gelöscht.',
      geloescht: 'Dieses Dokument ist gelöscht — es bekommt keine Fassung.',
      kategorie_gesperrt:
        'Rechnungen, Belege und Buchhaltungsunterlagen bekommen keine neue Fassung.',
      an_buchung: 'Eine Buchungszeile beruft sich auf dieses Dokument.',
      ohne_kette: 'Dieses Dokument trägt keine erste Fassung in der Kette.',
      leer: 'Es war keine Datei dabei.',
      kein_recht: 'Diese Sitzung darf keine Fassung ablegen. Es wurde nichts gespeichert.',
      speicher:
        'Der Dateispeicher ist nicht verbunden. Es wurde nichts abgelegt — eine Fassung ohne '
        + 'ihre Datei wäre keine.',
      datei_leer: 'Die Datei ist leer.',
      datei_unbekannt: 'Der Dateityp ließ sich aus dem Inhalt nicht bestimmen.',
      datei_nicht_erlaubt: 'Dieser Dateityp oder diese Größe ist nicht zugelassen.',
      datei_widerspruch:
        'Der Inhalt der Datei passt nicht zu dem Typ, den der Browser angegeben hat.',
      datei_zu_gross: 'Die Datei ist zu groß.',
    },
    faFehlerSonst: 'Die Fassung wurde abgewiesen.',

    mfTitel: 'Freigabe für die Belegschaft',
    mfIstFrei:
      'Freigegeben: jede Sitzung im Mitarbeiterportal dieser Gesellschaft sieht dieses '
      + 'Dokument — die ganze Belegschaft, nicht eine einzelne Person.',
    mfIstNichtFrei: 'Nicht freigegeben: im Mitarbeiterportal ist dieses Dokument unsichtbar.',
    mfKategorie: 'Kategorie',
    mfKategorieHinweis:
      'Welche Kategorien einer Belegschaft überhaupt freigegeben werden dürfen, ist offen '
      + '(O-851); die Datenbank prüft nur den Schalter. Die Kategorie steht deshalb hier '
      + 'groß — an ihr fällt eine falsche Freigabe auf.',
    mfOhneRecht: 'Freigegeben und zurückgenommen wird von einer Sitzung mit',
    mfGrund: 'Grund',
    mfGrundBeispielZuruecknehmen:
      'z. B. Versehentlich freigegeben — enthält Angaben zu einzelnen Beschäftigten',
    mfGrundBeispielFreigeben: 'z. B. Aushang für alle Kräfte im Objekt',
    mfZuruecknehmen: 'Freigabe zurücknehmen',
    mfFreigeben: 'Für die Belegschaft freigeben',
    mfRuecknahmeGrenze:
      'Die Rücknahme wirkt sofort: das Mitarbeiterportal zeigt das Dokument nicht mehr. '
      + 'Eine Datei, die schon abgerufen wurde, holt sie nicht zurück — wer sie wann '
      + 'geholt hat, steht im Zugriffsprotokoll. Der Grund steht im Prüfprotokoll.',
    mfFreigabeFolge:
      'Nach der Freigabe sieht jede Sitzung im Mitarbeiterportal dieser Gesellschaft das '
      + 'Dokument. Der Grund steht im Prüfprotokoll.',
    mfGesetzt: 'Das Dokument ist für die Belegschaft freigegeben.',
    mfZurueckgenommen:
      'Die Freigabe für die Belegschaft ist zurückgenommen — das Mitarbeiterportal zeigt '
      + 'das Dokument nicht mehr.',
    mfNichtGeaendert: 'Die Freigabe wurde nicht geändert.',
    mfFehler: {
      nicht_gefunden: 'Das Dokument ist nicht erreichbar oder schon gelöscht.',
      geloescht: 'Dieses Dokument ist gelöscht — es wird weder freigegeben noch zurückgenommen.',
      schon_so:
        'Der Schalter stand schon so — vermutlich hat ihn jemand gleichzeitig umgelegt. Die '
        + 'Seite zeigt den aktuellen Stand.',
      ohne_grund: 'Der Grund fehlt. Freigabe und Rücknahme nennen ihren Grund.',
      kein_recht:
        'Diese Sitzung darf den Schalter nicht umlegen. Es wurde nichts geändert.',
    },
    mfFehlerSonst: 'Die Änderung wurde abgewiesen.',
  },
  en: {
    faTitel: 'Versions',
    faErklaerung:
      'Every version stays as it was filed: a new one overwrites none, and none is deleted. '
      + 'Each version shows the SHA-256 of the stored bytes — the basis for showing that a '
      + 'file is unchanged (GoBD).',
    faBeschriftung: 'Versions of this document, newest first',
    faSpalteFassung: 'Version',
    faSpalteAbgelegt: 'Filed',
    faSpalteVon: 'By',
    faSpalteGroesse: 'Size',
    faSpalteTyp: 'Type',
    faSpaltePruefsumme: 'SHA-256',
    faSpalteAbruf: 'File',
    faAktuell: 'current',
    faAbrufen: 'Download',
    faKeine:
      'No version of this document is recorded in the chain — it was filed before the chain '
      + 'existed. A second version cannot be placed next to a file whose checksum nobody knows.',
    faNeuTitel: 'File a new version',
    faDatei: 'File',
    faNeuErklaerung:
      'The file is checked as on filing: type from its content, metadata removed, size '
      + 'limited. The previous version stays in the chain and can still be downloaded.',
    faAbschicken: 'File as version {n}',
    faOhneRecht: 'New versions are filed by a session holding',
    faGesperrtKategorie:
      'Invoices, receipts and accounting records get no new version (GoBD, § 147 AO): they '
      + 'are corrected by a reversing entry or Storno, never by replacing the file.',
    faGesperrtBuchung:
      'A booking line refers to this document (ACC-03, § 147 AO) — its file is not replaced '
      + 'by a new version.',
    faOhneSpeicher:
      'The file storage is not connected — no new version can be filed '
      + '(Settings › Integrations).',
    faAbgelegt: 'Version {n} is filed. The previous one stays in the chain and can be downloaded.',
    faNichtAbgelegt: 'No version filed.',
    faFehler: {
      nicht_gefunden: 'The document cannot be reached or has already been deleted.',
      geloescht: 'This document is deleted — it gets no version.',
      kategorie_gesperrt: 'Invoices, receipts and accounting records get no new version.',
      an_buchung: 'A booking line refers to this document.',
      ohne_kette: 'This document has no first version in the chain.',
      leer: 'No file was attached.',
      kein_recht: 'This session may not file a version. Nothing was saved.',
      speicher:
        'The file storage is not connected. Nothing was filed — a version without its file '
        + 'would be none.',
      datei_leer: 'The file is empty.',
      datei_unbekannt: 'The file type could not be determined from its content.',
      datei_nicht_erlaubt: 'This file type or size is not permitted.',
      datei_widerspruch: 'The file content does not match the type the browser declared.',
      datei_zu_gross: 'The file is too large.',
    },
    faFehlerSonst: 'The version was rejected.',

    mfTitel: 'Release to the workforce',
    mfIstFrei:
      'Released: every session in this company’s employee portal sees this document — the '
      + 'whole workforce, not one person.',
    mfIstNichtFrei: 'Not released: the document is invisible in the employee portal.',
    mfKategorie: 'Category',
    mfKategorieHinweis:
      'Which categories may be released to a workforce at all is still open (O-851); the '
      + 'database checks only the switch. That is why the category is shown prominently '
      + 'here — it is where a wrong release gets noticed.',
    mfOhneRecht: 'Releases are granted and withdrawn by a session holding',
    mfGrund: 'Reason',
    mfGrundBeispielZuruecknehmen:
      'e.g. Released by mistake — contains details about individual employees',
    mfGrundBeispielFreigeben: 'e.g. Notice for all staff working at the site',
    mfZuruecknehmen: 'Withdraw the release',
    mfFreigeben: 'Release to the workforce',
    mfRuecknahmeGrenze:
      'The withdrawal takes effect at once: the employee portal no longer shows the '
      + 'document. It cannot recall a file that has already been retrieved — who retrieved '
      + 'it and when is in the access log. The reason is kept in the audit log.',
    mfFreigabeFolge:
      'Once released, every session in this company’s employee portal sees the document. '
      + 'The reason is kept in the audit log.',
    mfGesetzt: 'The document is released to the workforce.',
    mfZurueckgenommen:
      'The release to the workforce has been withdrawn — the employee portal no longer '
      + 'shows the document.',
    mfNichtGeaendert: 'The release was not changed.',
    mfFehler: {
      nicht_gefunden: 'The document cannot be reached or has already been deleted.',
      geloescht: 'This document is deleted — it is neither released nor withdrawn.',
      schon_so:
        'The switch was already in that position — someone probably changed it at the same '
        + 'time. The page shows the current state.',
      ohne_grund: 'The reason is missing. Releases and withdrawals state their reason.',
      kein_recht: 'This session may not change the switch. Nothing was changed.',
    },
    mfFehlerSonst: 'The change was rejected.',
  },
};
