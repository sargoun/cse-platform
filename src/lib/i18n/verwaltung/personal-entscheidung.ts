/**
 * Warum eine Entscheidung über eine Abwesenheit oder einen Antrag nicht
 * durchlief — als SATZ, nachgeschlagen nach einem GRUND (V-197, D-753,
 * EMP-10, D-599, D-728).
 *
 * **Der Befund.** `POST /api/abwesenheiten/[id]` und `POST /api/antraege/[id]`
 * schickten den Satz des Dienstes als `?meldung=` zurück, und die Listen und
 * Blätter zeigten ihn roh. Genehmigte jemand eine Abwesenheit, über die eine
 * Kollegin gerade entschieden hatte — oder zweimal auf „Genehmigen" —, stand
 * dort „Abwesenheit 5b0d6c1e-… gibt es in dieser Gesellschaft nicht.": eine
 * volle Kennung und eine falsche Aussage, denn die Abwesenheit gab es. Und
 * jeder Text aus einem präparierten Link erschien als rote Systemmeldung.
 *
 * **Die Route schickt einen GRUND** (`?fehler=<grund>`, `grundAufsFormular`),
 * die Seite schlägt ihn hier nach — nur als eigener Eintrag (D-728); ein
 * Grund, den die Tabelle nicht kennt, bekommt `sonst`, nie den Schlüssel und
 * nie Text aus der Adresse.
 *
 * Die Sätze sagen, was die Plattform weiss, und nicht mehr: „schon
 * entschieden oder nicht mehr da" ist der häufige Fall von `nicht_gefunden`
 * (der Dienst ändert nur Vorgänge, die noch offen sind); die beiden offenen
 * Fragen O-18 und O-139 stehen mit Nummer da, wie im Dienst.
 */
import type { InternSprache } from '../intern.js';

/** Jeder Grund, den die beiden Entscheidungsrouten zurückschicken. */
export const ENTSCHEIDUNG_FEHLER_GRUENDE = [
  'nicht_gefunden', 'grund_fehlt', 'kommentar_fehlt', 'urlaubskonto_fehlt', 'art_ungeklaert',
  /* der `code` eines Dienstes ohne eigenen Grund */
  'ungueltige_eingabe', 'ungueltiger_zustand',
] as const;
export type EntscheidungFehlerGrund = (typeof ENTSCHEIDUNG_FEHLER_GRUENDE)[number];

export interface EntscheidungFehlerTexte {
  /** Die fett gesetzten ersten Worte des Kastens (DESIGN §5 „Notices"). */
  readonly titel: string;
  /** Für einen Grund, den die Tabelle nicht kennt. */
  readonly sonst: string;
  readonly fehler: Readonly<Record<EntscheidungFehlerGrund, string>>;
}

export const ENTSCHEIDUNG_FEHLER_TEXTE:
Readonly<Record<InternSprache, EntscheidungFehlerTexte>> = {
  de: {
    titel: 'Der Vorgang lief nicht durch.',
    sonst: 'Es wurde nichts geändert.',
    fehler: {
      nicht_gefunden:
        'Darüber ist schon entschieden, oder der Vorgang ist nicht mehr da — die Seite zeigt '
        + 'den aktuellen Stand.',
      grund_fehlt: 'Ablehnen und Stornieren brauchen einen Grund. Bitte tragen Sie ihn ein.',
      kommentar_fehlt: 'Eine Ablehnung braucht einen Kommentar. Bitte tragen Sie ihn ein.',
      urlaubskonto_fehlt:
        'Für das Jahr dieses Urlaubs ist kein Urlaubsanspruch hinterlegt (O-18). Er wird '
        + 'eingetragen, bevor Urlaub genehmigt wird — sonst stünde der Resturlaub im Minus, '
        + 'ohne dass jemand das entschieden hätte.',
      art_ungeklaert:
        'Für diese Abwesenheitsart ist nicht hinterlegt, ob sie bezahlt ist (O-139). Ohne '
        + 'diese Angabe entsteht keine Abwesenheit — die Lohnwirkung wäre offen.',
      ungueltige_eingabe: 'Eine Angabe fehlt oder passt nicht.',
      ungueltiger_zustand:
        'Das geht in diesem Stand nicht mehr — die Seite zeigt den aktuellen Stand.',
    },
  },
  en: {
    titel: 'This did not go through.',
    sonst: 'Nothing was changed.',
    fehler: {
      nicht_gefunden:
        'This has already been decided, or it no longer exists — the page shows the current '
        + 'state.',
      grund_fehlt: 'Declining and cancelling need a reason. Please enter one.',
      kommentar_fehlt: 'A refusal needs a comment. Please enter one.',
      urlaubskonto_fehlt:
        'No leave entitlement is recorded for the year of this leave (O-18). It is entered '
        + 'before leave is approved — otherwise the remaining leave would go negative without '
        + 'anyone having decided so.',
      art_ungeklaert:
        'It is not recorded whether this absence type is paid (O-139). Without that, no '
        + 'absence is created — the effect on pay would be open.',
      ungueltige_eingabe: 'Something is missing or does not fit.',
      ungueltiger_zustand: 'This is no longer possible in this state — the page shows the current state.',
    },
  },
};
