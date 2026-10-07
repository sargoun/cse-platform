/**
 * Die Modulbuchung einer Gesellschaft eintragen — in beiden Sprachen (V-298,
 * O-355, D-809).
 *
 * Die Gewerke heissen hier wie in `CLAUDE.md` und auf der Modulseite; die
 * Schluessel (`reinigung`, `security`, `bau`) stehen nur im Formularwert.
 */
import type { InternSprache } from '../../intern.js';

export interface ModulbuchungTexte {
  readonly titel: string;
  readonly erklaerung: string;
  readonly gewerk: Readonly<Record<string, string>>;
  readonly keinesHeisst: string;
  readonly speichern: string;
  readonly nurSuperAdmin: string;
  readonly eingetragen: (am: string, von: string | null) => string;
  readonly seedStand: string;
  readonly erfolg: Readonly<Record<'gebucht' | 'unveraendert', string>>;
  readonly fehler: Readonly<Record<'nur_super_admin' | 'unbekanntes_gewerk', string>>;
}

export const MODULBUCHUNG_TEXTE: Readonly<Record<InternSprache, ModulbuchungTexte>> = {
  de: {
    titel: 'Buchung eintragen',
    erklaerung: 'Voreinstellung (O-355): die Super-Administration trägt die gebuchten '
      + 'Gewerke beim Vertragsschluss ein. Ein Gewerk ohne Haken ist danach in dieser '
      + 'Gesellschaft für niemanden sichtbar — auch nicht für die Super-Administration.',
    gewerk: {
      reinigung: 'Gebäudereinigung',
      security: 'Sicherheits- und Objektschutzdienste',
      bau: 'Hochbau, Ausbau, Rückbau',
    },
    keinesHeisst: 'Kein Haken heißt: kein Gewerk — so wie bei der CSE Operations.',
    speichern: 'Buchung speichern',
    nurSuperAdmin: 'Die Buchung trägt die Super-Administration ein (O-355). Dieses Konto '
      + 'kann sie lesen, aber nicht ändern.',
    eingetragen: (am, von) => `Eingetragen am ${am}${von === null ? '' : ` von ${von}`}.`,
    seedStand: 'Noch nicht eingetragen: was oben steht, ist der Stand des Seeds, keine '
      + 'Entscheidung.',
    erfolg: {
      gebucht: 'Die Buchung ist eingetragen.',
      unveraendert: 'Die Buchung war schon so eingetragen — nichts geändert.',
    },
    fehler: {
      nur_super_admin: 'Nicht gespeichert: die Buchung trägt die Super-Administration ein.',
      unbekanntes_gewerk: 'Nicht gespeichert: gebucht werden nur Gebäudereinigung, '
        + 'Sicherheit und Bau.',
    },
  },
  en: {
    titel: 'Record the booking',
    erklaerung: 'Default (O-355): the super administration records the booked trades when '
      + 'the contract is signed. A trade without a tick is then invisible to everyone in '
      + 'this company — the super administration included.',
    gewerk: {
      reinigung: 'Building cleaning',
      security: 'Security and property protection',
      bau: 'Construction, fit-out, demolition',
    },
    keinesHeisst: 'No tick means: no trade — as for CSE Operations.',
    speichern: 'Save booking',
    nurSuperAdmin: 'The super administration records the booking (O-355). This account can '
      + 'read it but not change it.',
    eingetragen: (am, von) => `Recorded on ${am}${von === null ? '' : ` by ${von}`}.`,
    seedStand: 'Not recorded yet: what is shown above is the seed state, not a decision.',
    erfolg: {
      gebucht: 'The booking has been recorded.',
      unveraendert: 'The booking was already recorded like this — nothing changed.',
    },
    fehler: {
      nur_super_admin: 'Not saved: the super administration records the booking.',
      unbekanntes_gewerk: 'Not saved: only building cleaning, security and construction '
        + 'can be booked.',
    },
  },
};
