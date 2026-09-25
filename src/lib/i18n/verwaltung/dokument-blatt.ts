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

/** Die Gründe, mit denen die Mitarbeiterfreigabe abgewiesen wird (`DokumentfreigabeFehler`). */
export type MitarbeiterfreigabeAbweisung =
  'nicht_gefunden' | 'geloescht' | 'schon_so' | 'ohne_grund' | 'kein_recht';

export interface DokumentBlattTexte {
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
