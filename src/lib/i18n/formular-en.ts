/**
 * Die englischen Beschriftungen der Anfrageformulare.
 *
 * **Eine Auflage, keine zweite Definition.** Die Felddefinition in
 * `formular_definition` bleibt die eine Quelle: sie bestimmt, welche Felder es
 * gibt, welche Pflicht sind, was validiert wird und was in `formular_eingang`
 * landet. Diese Datei uebersetzt ausschliesslich, was ein Mensch LIEST —
 * Beschriftung, Hilfetext, Fehlermeldung, Auswahlbezeichnungen.
 *
 * **Warum nicht zwei Definitionen je Formular.** Zwei Definitionen sind zwei
 * Feldlisten, und die zweite laeuft der ersten irgendwann hinterher: ein Feld,
 * das jemand deutsch ergaenzt, fehlt englisch — und dann validiert die Annahme
 * gegen eine Liste, die der Besucher nie gesehen hat. Eine Auflage kann das
 * nicht: `tests/kern/i18n.test.ts` verlangt fuer JEDES Feld JEDER
 * veroeffentlichten Vorlage einen vollstaendigen englischen Eintrag, samt
 * jeder Auswahloption. Ein neues deutsches Feld bricht damit den Build, statt
 * still deutsch auszuliefern.
 *
 * Die Werte der Optionen (`wert`) werden NIE uebersetzt — sie sind der
 * gespeicherte Inhalt, nicht seine Anzeige.
 */

export interface FeldTexte {
  readonly label: string;
  readonly hilfetext?: string;
  readonly fehlermeldung: string;
  /** Optionswert → englische Bezeichnung. Nur bei Auswahlfeldern. */
  readonly optionen?: Readonly<Record<string, string>>;
}

/** Beschriftungen, die in jedem der vier Formulare vorkommen. */
const GEMEINSAM: Readonly<Record<string, FeldTexte>> = {
  firma: { label: 'Company', fehlermeldung: 'Please enter your company name.' },
  name: { label: 'Your name', fehlermeldung: 'Please enter your name.' },
  email: {
    label: 'Email',
    fehlermeldung: 'Please enter an email address where we can reach you.',
  },
  telefon: { label: 'Phone', fehlermeldung: 'Please enter a phone number.' },
  nachricht: {
    label: 'Your message',
    hilfetext: 'Anything that helps us put together a suitable quote.',
    fehlermeldung: 'Please shorten your message.',
  },
  datenschutz_hinweis: {
    label: 'I have read the privacy notice.',
    fehlermeldung: 'Please confirm that you have read the privacy notice.',
  },
  einwilligung_werbung: {
    label: 'I would like to receive information about further services.',
    fehlermeldung: 'Please check this entry.',
  },
};

export interface FormularTexte {
  readonly titel: string;
  readonly felder: Readonly<Record<string, FeldTexte>>;
}

/** Formularschluessel → englische Fassung. */
export const FORMULAR_EN: Readonly<Record<string, FormularTexte>> = {
  'angebot_reinigung': {
    titel: 'Request a quote for building cleaning',
    felder: {
      ...GEMEINSAM,
      gebaeudetyp: {
        label: 'Type of building',
        fehlermeldung: 'Please choose the type of building.',
        optionen: {
          buero: 'Office building',
          wohnanlage: 'Residential complex',
          praxis: 'Medical practice or clinic',
          einzelhandel: 'Retail',
          industrie: 'Industrial or warehouse',
          bildung: 'School or nursery',
          hotel: 'Hotel or hospitality',
        },
      },
      flaeche_qm: {
        label: 'Area in m²',
        fehlermeldung: 'Please enter the area in square metres.',
      },
      anzahl_objekte: {
        label: 'Number of properties',
        fehlermeldung: 'Please tell us how many properties this concerns.',
      },
      frequenz: {
        label: 'Cleaning frequency',
        fehlermeldung: 'Please choose how often cleaning should take place.',
        optionen: {
          taeglich: 'Daily',
          fuenf_woechentlich: 'Five times a week',
          drei_woechentlich: 'Three times a week',
          zwei_woechentlich: 'Twice a week',
          woechentlich: 'Weekly',
          vierzehntaegig: 'Every two weeks',
          monatlich: 'Monthly',
          einmalig: 'One-off',
        },
      },
      wunsch_start: {
        label: 'Preferred start',
        fehlermeldung: 'Please enter a start date (YYYY-MM-DD).',
      },
    },
  },

  'angebot_security': {
    titel: 'Request a quote for security services',
    felder: {
      ...GEMEINSAM,
      anlass: {
        label: 'Occasion',
        fehlermeldung: 'Please describe the occasion briefly.',
      },
      einsatz_von: {
        label: 'Deployment from',
        fehlermeldung: 'Please enter the start with date and time.',
      },
      einsatz_bis: {
        label: 'Deployment until',
        fehlermeldung: 'Please enter the end with date and time.',
      },
      erwartete_besucher: {
        label: 'Expected visitors',
        fehlermeldung: 'Please estimate the number of visitors.',
      },
      anzahl_kraefte: {
        label: 'Staff required',
        fehlermeldung: 'Please tell us how many staff you need.',
      },
      veranstaltungsort: {
        label: 'Venue',
        fehlermeldung: 'Please enter the venue.',
      },
    },
  },

  'angebot_bau': {
    titel: 'Request a quote for construction work',
    felder: {
      ...GEMEINSAM,
      gewerk: {
        label: 'Trade',
        fehlermeldung: 'Please choose the trade.',
        optionen: {
          hochbau: 'Structural work',
          ausbau: 'Fit-out and drywall',
          rueckbau: 'Demolition and strip-out',
          sanierung: 'Refurbishment of existing buildings',
          maler: 'Painting',
          boden: 'Flooring',
        },
      },
      volumen: {
        label: 'Scope',
        hilfetext: 'Order of magnitude, extent or estimated build cost.',
        fehlermeldung: 'Please describe the scope.',
      },
      fertigstellung_bis: {
        label: 'Completion by',
        fehlermeldung: 'Please enter your preferred completion date.',
      },
      lv_datei: {
        label: 'Bill of quantities',
        hilfetext: 'PDF or XLSX, up to 20 MB.',
        fehlermeldung: 'Please upload the bill of quantities as a PDF or XLSX.',
      },
    },
  },

  'angebot_operations': {
    titel: 'Enquire about digital operations',
    felder: {
      ...GEMEINSAM,
      anliegen: {
        label: 'What is this about?',
        fehlermeldung: 'Please choose what this is about.',
        optionen: {
          prozessanalyse: 'Map and analyse our processes',
          software: 'Introduce or replace software',
          automatisierung: 'Automate recurring work',
          migration: 'Migrate data from a legacy system',
          schulung: 'Training for an existing system',
        },
      },
      anzahl_mitarbeitende: {
        label: 'Employees affected',
        hilfetext: 'How many people work with this process?',
        fehlermeldung: 'Please tell us how many people are affected.',
      },
      systeme: {
        label: 'Systems in use',
        hilfetext: 'Which programs do you use for this today?',
        fehlermeldung: 'Please shorten this entry.',
      },
      zeitrahmen: {
        label: 'Preferred timeframe',
        fehlermeldung: 'Please choose a timeframe.',
        optionen: {
          sofort: 'As soon as possible',
          quartal: 'Within the current quarter',
          halbjahr: 'Within the next six months',
          offen: 'Still open',
        },
      },
    },
  },
};

/* ── Die Auflage anwenden ───────────────────────────────────────────────── */

/**
 * Legt die englischen Beschriftungen ueber eine Felddefinition.
 *
 * Struktur, Reihenfolge, Pflicht, Typ und Optionswerte bleiben unveraendert —
 * uebersetzt wird nur, was jemand liest. Fehlt ein Eintrag, bleibt das
 * deutsche Wort stehen: eine halb uebersetzte Beschriftung ist unschoen, ein
 * fehlendes Feld waere ein Fehler. Dass nichts fehlt, sichert der Test.
 */
export function uebersetzeFelder<T extends {
  readonly schluessel: string; readonly label: string;
  readonly hilfetext?: string | undefined; readonly fehlermeldung: string;
  readonly optionen?: readonly { readonly wert: string; readonly label: string }[] | undefined;
}>(formularSchluessel: string, felder: readonly T[]): readonly T[] {
  const vorlage = FORMULAR_EN[formularSchluessel];
  if (vorlage === undefined) return felder;
  return felder.map((f) => {
    const t = vorlage.felder[f.schluessel];
    if (t === undefined) return f;
    const optionen = f.optionen === undefined ? undefined : f.optionen.map((o) => ({
      ...o, label: t.optionen?.[o.wert] ?? o.label,
    }));
    return {
      ...f,
      label: t.label,
      fehlermeldung: t.fehlermeldung,
      ...(t.hilfetext === undefined ? {} : { hilfetext: t.hilfetext }),
      ...(optionen === undefined ? {} : { optionen }),
    };
  });
}

/** Der englische Titel eines Formulars, sonst der deutsche. */
export function uebersetzeTitel(formularSchluessel: string, titel: string): string {
  return FORMULAR_EN[formularSchluessel]?.titel ?? titel;
}

/**
 * Die Feldmeldungen einer abgewiesenen Anfrage — in der Sprache des Formulars.
 *
 * Die Validierung laeuft gegen `formular_definition` (D-83), und die ist
 * deutsch. Ein englisches Formular bekam deshalb englische Beschriftungen und
 * daneben deutsche Fehlermeldungen: "Please enter the area in square metres."
 * beim Ausfuellen, "Bitte geben Sie an, um wie viele Objekte es geht." beim
 * Absenden. Dieselbe Auflage, die die Beschriftung liefert, liefert hier die
 * Meldung — es entsteht keine zweite Validierung, nur eine zweite Anzeige
 * derselben.
 *
 * Ein Schluessel ohne Eintrag behaelt die deutsche Meldung. Das ist die
 * schlechtere von zwei Auskuenften und immer noch besser als keine — und
 * `tests/kern/i18n.test.ts` laesst ihn ohnehin nicht durch.
 */
export function uebersetzeFeldmeldungen(
  formularSchluessel: string, felder: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const vorlage = FORMULAR_EN[formularSchluessel];
  if (vorlage === undefined) return felder;
  return Object.fromEntries(
    Object.entries(felder).map(
      ([schluessel, meldung]) =>
        [schluessel, vorlage.felder[schluessel]?.fehlermeldung ?? meldung],
    ),
  );
}

