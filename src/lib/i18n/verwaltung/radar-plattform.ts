/**
 * Der Plattformkatalog und der Registrierungsstand des Vergaberadars — in
 * beiden Sprachen (V-175, RAD-09, O-07, D-592).
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text**: `Mandant`,
 * `Vergabeplattform`, `Bekanntmachung` — erklärt in Klammern, nicht ersetzt
 * (siehe `./basis.ts`).
 *
 * **Die Abweisungen sind SCHLÜSSEL**, die `/api/radar/plattform` und
 * `/api/radar/vorgang` zurückgeben (`?fehler=…`). Die Seite zeigt den Satz
 * zum Schlüssel und für einen unbekannten Schlüssel `fehlerSonst` — nie den
 * Schlüssel selbst.
 */
import type { InternSprache } from '../intern.js';

type Stand = 'unbekannt' | 'nicht_registriert' | 'beantragt' | 'registriert' | 'abgelaufen';
type Pruefung = 'unbekannt' | 'registriert' | 'nicht_registriert' | 'keine_plattform';

export interface RadarPlattformTexte {
  /* ── Kopf ──────────────────────────────────────────────────────────── */
  readonly titel: string;
  readonly wurzelTitel: string;
  readonly zumRadar: string;
  readonly einleitung: string;
  readonly frageDavor: string;
  readonly warnungOffene: (anzahl: number) => string;
  readonly warnungOffeneDauer: string;

  /* ── Rückmeldungen ─────────────────────────────────────────────────── */
  readonly nichtGespeichert: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerSonst: string;
  readonly vermerkt: Readonly<Record<string, string>>;
  readonly zugeordnet: (anzahl: number) => string;

  /* ── Der leere Katalog ─────────────────────────────────────────────── */
  readonly leerTitel: string;
  readonly leerText: string;
  readonly leerSuperAdmin: string;

  /* ── Eine Zeile des Katalogs ───────────────────────────────────────── */
  readonly betreiberFehlt: string;
  readonly kennung: (kennung: string) => string;
  readonly seit: (tag: string) => string;
  readonly gueltigBisText: (tag: string) => string;
  readonly offene: (anzahl: number) => string;
  readonly unbestaetigt: string;
  readonly ohneRegistrierungspflicht: string;
  readonly gueltigkeitAbgelaufen: (tag: string) => string;
  readonly zuletztBestaetigt: (wann: string) => string;
  readonly hostsText: (hosts: string) => string;
  readonly keineHosts: string;
  readonly stand: Readonly<Record<Stand, string>>;

  /* ── Der Registrierungsstand dieser Gesellschaft ──────────────────── */
  readonly registrierungTitel: string;
  readonly feldStand: string;
  readonly feldKennung: string;
  readonly feldKennungHinweis: string;
  readonly feldRegistriertAm: string;
  readonly feldGueltigBis: string;
  readonly feldVerantwortlich: string;
  readonly niemand: string;
  readonly feldNotiz: string;
  readonly registrierungSpeichern: string;

  /* ── Der Katalog (Super-Administration) ────────────────────────────── */
  readonly katalogTitel: string;
  readonly katalogErklaerung: string;
  readonly eintragen: string;
  readonly eintragAendern: string;
  readonly feldName: string;
  readonly feldSlug: string;
  readonly feldSlugHinweis: string;
  readonly feldBetreiber: string;
  readonly feldBasisUrl: string;
  readonly feldHosts: string;
  readonly feldHostsHinweis: string;
  readonly feldPflicht: string;
  readonly feldDauer: string;
  readonly feldDauerHinweis: string;
  readonly speichern: string;
  readonly bestaetigen: string;
  readonly bestaetigenHinweis: string;
  readonly archivieren: string;
  readonly archivierenHinweis: string;
  readonly nurSuperAdmin: string;

  readonly keinKennwort: string;

  /* ── Die Plattformprüfung am Vorgang (Seite „Stand setzen") ───────── */
  readonly pruefungTitel: string;
  readonly pruefungErklaerung: string;
  readonly pruefungPlattform: (name: string, stand: string) => string;
  readonly pruefungOhnePlattform: (hinweis: string) => string;
  readonly pruefungStand: string;
  readonly pruefungGeprueftAm: (wann: string) => string;
  readonly pruefungNie: string;
  readonly pruefungOhneVorgang: string;
  readonly pruefungSpeichern: string;
  readonly pruefung: Readonly<Record<Pruefung, string>>;
  readonly pruefungVermerkt: string;
}

export const RADAR_PLATTFORM_TEXTE: Readonly<Record<InternSprache, RadarPlattformTexte>> = {
  de: {
    titel: 'Vergabeplattformen',
    wurzelTitel: 'Radar',
    zumRadar: 'Zum Radar',
    einleitung:
      'Über diese Plattformen werden Vergabeunterlagen veröffentlicht und Angebote eingereicht. '
      + 'Eingereicht wird von Hand: eine Schnittstelle dafür gibt es nicht, Konten hängen an '
      + 'natürlichen Personen, und manche Plattform verlangt eine Signatur (D-07).',
    frageDavor: 'Was hier zählt, ist deshalb die Frage davor: dürfen wir dort überhaupt bieten?',
    warnungOffene: (n) =>
      `${String(n)} offene Bekanntmachung${n === 1 ? '' : 'en'} auf Plattformen ohne Freischaltung.`,
    warnungOffeneDauer:
      'Eine Freischaltung dauert Tage bis Wochen — jetzt beantragen ist der Unterschied zwischen '
      + 'Angebot und Zuschauen.',

    nichtGespeichert: 'Es wurde nichts gespeichert.',
    fehler: {
      nur_super_admin:
        'Den Plattformkatalog pflegt die Super-Administration — er gehört keiner Gesellschaft.',
      name_fehlt: 'Eine Plattform braucht einen Namen.',
      slug_ungueltig:
        'Der Kurzname besteht aus 2 bis 60 Kleinbuchstaben, Ziffern, Binde- oder Unterstrichen.',
      slug_vergeben: 'Diesen Kurznamen trägt schon ein anderer Eintrag.',
      url_ungueltig:
        'Die Adresse ist keine Webadresse (https://…) oder trägt Zugangsdaten — die gehören nie '
        + 'hierher.',
      host_ungueltig:
        'Ein Hostname ist ungültig. Erlaubt sind Namen wie vergabe.berlin.de — getrennt durch '
        + 'Komma oder Zeilenwechsel, höchstens 20.',
      text_zu_lang: 'Ein Text ist zu lang.',
      plattform_unbekannt: 'Diese Plattform gibt es im Katalog nicht (mehr).',
      status_unbekannt: 'Diesen Registrierungsstand gibt es nicht.',
      datum_ungueltig: 'Ein Datum ist ungültig.',
      registriert_ohne_datum:
        '„Registriert" heißt: seit einem bestimmten Tag. Bitte das Datum der Freischaltung '
        + 'nennen.',
      gueltig_vor_start: 'Die Gültigkeit endet vor der Registrierung.',
      verantwortlich_fremd: 'Verantwortlich kann nur sein, wer in dieser Gesellschaft arbeitet.',
      unbekannte_handlung: 'Diese Handlung gibt es hier nicht.',
      plattform: 'Diesen Prüfstand gibt es nicht.',
      kein_vorgang:
        'Die Plattformprüfung hängt am Vorgang — er entsteht mit dem ersten gesetzten Stand '
        + '(zum Beispiel „Geprüft").',
    },
    fehlerSonst: 'Die Eingabe wurde abgewiesen.',
    vermerkt: {
      angelegt: 'Die Plattform ist eingetragen — als unbestätigter Eintrag (O-07).',
      geaendert: 'Der Eintrag ist geändert.',
      bestaetigt: 'Der Eintrag ist bestätigt.',
      archiviert: 'Der Eintrag ist archiviert. Neue Bekanntmachungen werden ihm nicht mehr zugeordnet.',
      registrierung: 'Der Registrierungsstand ist gespeichert.',
    },
    zugeordnet: (n) =>
      n === 0
        ? 'Keine schon eingelesene Bekanntmachung passt zu den Hostnamen.'
        : `${String(n)} schon eingelesene Bekanntmachung${n === 1 ? '' : 'en'} trägt jetzt `
          + 'eine Plattform.',

    leerTitel: 'Der Plattformkatalog ist leer — mit Absicht.',
    leerText:
      'Welche Plattformen für diese Gruppe gelten und unter welcher Kennung dort wer registriert '
      + 'ist, ist offen (O-07). Eine erfundene Liste sähe aus wie ein geprüfter Stand und wäre '
      + 'eine Behauptung über die Konten dieses Betriebs. Sobald die Antwort da ist, trägt die '
      + 'Super-Administration die Plattformen hier ein, und Bekanntmachungen werden über ihre '
      + 'Adresse zugeordnet — auch die schon eingelesenen.',
    leerSuperAdmin: 'Die erste Plattform tragen Sie unten ein.',

    betreiberFehlt: 'Betreiber nicht hinterlegt',
    kennung: (k) => `Kennung ${k}`,
    seit: (t) => `seit ${t}`,
    gueltigBisText: (t) => `gültig bis ${t}`,
    offene: (n) => `${String(n)} offene Bekanntmachung${n === 1 ? '' : 'en'}`,
    unbestaetigt: 'Eintrag noch unbestätigt (O-07)',
    ohneRegistrierungspflicht: 'Registrierung laut Eintrag nicht erforderlich',
    gueltigkeitAbgelaufen: (t) =>
      `Die eingetragene Gültigkeit endete am ${t} — bitte den Stand prüfen.`,
    zuletztBestaetigt: (w) => `Zuletzt gesagt am ${w}`,
    hostsText: (h) => `Zuordnung über: ${h}`,
    keineHosts: 'Keine Hostnamen — Bekanntmachungen werden dieser Plattform nicht zugeordnet.',
    stand: {
      registriert: 'registriert und freigeschaltet',
      beantragt: 'beantragt — noch nicht freigeschaltet',
      nicht_registriert: 'nicht registriert',
      abgelaufen: 'abgelaufen',
      unbekannt: 'unbekannt — niemand hat es bisher geprüft',
    },

    registrierungTitel: 'Stand dieser Gesellschaft',
    feldStand: 'Stand',
    feldKennung: 'Anmeldekennung',
    feldKennungHinweis: 'Nur die Kennung — nie ein Kennwort.',
    feldRegistriertAm: 'Freigeschaltet am',
    feldGueltigBis: 'Gültig bis',
    feldVerantwortlich: 'Verantwortlich',
    niemand: '— niemand benannt —',
    feldNotiz: 'Notiz',
    registrierungSpeichern: 'Stand speichern',

    katalogTitel: 'Katalog pflegen',
    katalogErklaerung:
      'Nur für die Super-Administration: der Katalog gilt für die ganze Gruppe. Eingetragen '
      + 'wird, was Sie wissen; ein neuer Eintrag bleibt unbestätigt, bis Sie ihn bestätigen. '
      + 'Nach dem Speichern werden die schon eingelesenen Bekanntmachungen ohne Plattform über '
      + 'die Hostnamen nachgeordnet.',
    eintragen: 'Plattform eintragen',
    eintragAendern: 'Eintrag ändern',
    feldName: 'Name',
    feldSlug: 'Kurzname',
    feldSlugHinweis: 'Leer lassen: er entsteht aus dem Namen.',
    feldBetreiber: 'Betreiber',
    feldBasisUrl: 'Adresse (https://…)',
    feldHosts: 'Hostnamen der Bekanntmachungen',
    feldHostsHinweis:
      'Die Rechner, auf denen die Bekanntmachungen dieser Plattform liegen, z. B. '
      + 'vergabe.berlin.de — getrennt durch Komma oder Zeilenwechsel. Untergeordnete Namen '
      + 'zählen mit.',
    feldPflicht: 'Zum Bieten ist eine Registrierung erforderlich',
    feldDauer: 'Hinweis zur Freischaltung',
    feldDauerHinweis: 'Freitext, z. B. wie lange eine Freischaltung laut Betreiber dauert.',
    speichern: 'Speichern',
    bestaetigen: 'Eintrag bestätigen',
    bestaetigenHinweis: 'Sie bestätigen, dass diese Plattform für die Gruppe gilt (O-07).',
    archivieren: 'Archivieren',
    archivierenHinweis:
      'Gelöscht wird nichts: Bekanntmachungen und Registrierungen bleiben lesbar, neue werden '
      + 'nicht mehr zugeordnet.',
    nurSuperAdmin:
      'Den Katalog selbst pflegt die Super-Administration; hier steht der Registrierungsstand '
      + 'dieser Gesellschaft.',

    keinKennwort:
      'Ein Kennwort steht hier nie. Gespeichert wird die Anmeldekennung — nicht das Geheimnis '
      + '(SEC-A5).',

    pruefungTitel: 'Plattform geprüft',
    pruefungErklaerung:
      'Was Sie für diese Bekanntmachung nachgesehen haben: dürfen wir auf ihrer Plattform '
      + 'bieten? Das hängt am Vorgang und setzt keinen Stand.',
    pruefungPlattform: (name, stand) => `Plattform laut Katalog: ${name} — Stand dieser Gesellschaft: ${stand}.`,
    pruefungOhnePlattform: (hinweis) =>
      `Die Plattform steht nicht im Katalog (Adresse: ${hinweis}).`,
    pruefungStand: 'Ergebnis der Prüfung',
    pruefungGeprueftAm: (w) => `geprüft am ${w}`,
    pruefungNie: 'noch nicht geprüft',
    pruefungOhneVorgang:
      'Die Plattformprüfung hängt am Vorgang — er entsteht mit dem ersten gesetzten Stand.',
    pruefungSpeichern: 'Prüfung speichern',
    pruefung: {
      unbekannt: 'unbekannt',
      registriert: 'registriert — wir können dort bieten',
      nicht_registriert: 'nicht registriert — Freischaltung nötig',
      keine_plattform: 'keine Plattform — Abgabe auf anderem Weg',
    },
    pruefungVermerkt: 'Die Plattformprüfung ist gespeichert.',
  },
  en: {
    titel: 'Procurement platforms',
    wurzelTitel: 'Radar',
    zumRadar: 'Back to the radar',
    einleitung:
      'Tender documents are published and bids are submitted on these Vergabeplattformen '
      + '(procurement platforms). Submission is manual: there is no interface for it, accounts '
      + 'belong to natural persons, and some platforms require a signature (D-07).',
    frageDavor: 'What counts here is the question before that: may we bid there at all?',
    warnungOffene: (n) =>
      `${String(n)} open Bekanntmachung${n === 1 ? '' : 'en'} (notices) on platforms without `
      + 'activation.',
    warnungOffeneDauer:
      'Activation takes days to weeks — applying now makes the difference between bidding and '
      + 'watching.',

    nichtGespeichert: 'Nothing was saved.',
    fehler: {
      nur_super_admin:
        'The platform catalogue is maintained by the super administration — it belongs to no '
        + 'single Mandant (company).',
      name_fehlt: 'A platform needs a name.',
      slug_ungueltig:
        'The short name consists of 2 to 60 lower-case letters, digits, hyphens or underscores.',
      slug_vergeben: 'Another entry already uses this short name.',
      url_ungueltig:
        'The address is not a web address (https://…) or it carries credentials — those never '
        + 'belong here.',
      host_ungueltig:
        'A host name is invalid. Allowed are names like vergabe.berlin.de — separated by comma '
        + 'or line break, at most 20.',
      text_zu_lang: 'A text is too long.',
      plattform_unbekannt: 'This platform does not exist (any more) in the catalogue.',
      status_unbekannt: 'This registration status does not exist.',
      datum_ungueltig: 'A date is invalid.',
      registriert_ohne_datum:
        '"Registered" means: since a certain day. Please enter the date of activation.',
      gueltig_vor_start: 'The validity ends before the registration.',
      verantwortlich_fremd: 'Only someone who works in this Mandant (company) can be responsible.',
      unbekannte_handlung: 'This action does not exist here.',
      plattform: 'This check result does not exist.',
      kein_vorgang:
        'The platform check belongs to the Vorgang (case) — it is opened by the first status '
        + 'you set (for example "Checked").',
    },
    fehlerSonst: 'The entry was rejected.',
    vermerkt: {
      angelegt: 'The platform has been entered — as an unconfirmed entry (O-07).',
      geaendert: 'The entry has been changed.',
      bestaetigt: 'The entry has been confirmed.',
      archiviert: 'The entry has been archived. New notices are no longer assigned to it.',
      registrierung: 'The registration status has been saved.',
    },
    zugeordnet: (n) =>
      n === 0
        ? 'No notice read in earlier matches the host names.'
        : `${String(n)} notice${n === 1 ? '' : 's'} read in earlier now carr${n === 1 ? 'ies' : 'y'} `
          + 'a platform.',

    leerTitel: 'The platform catalogue is empty — on purpose.',
    leerText:
      'Which platforms apply to this group, and under which login who is registered there, is '
      + 'an open question (O-07). An invented list would look like a checked status and would be '
      + 'a claim about this business’s accounts. Once the answer is there, the super '
      + 'administration enters the platforms here, and notices are assigned by their address — '
      + 'including those read in earlier.',
    leerSuperAdmin: 'Enter the first platform below.',

    betreiberFehlt: 'Operator not recorded',
    kennung: (k) => `Login ${k}`,
    seit: (t) => `since ${t}`,
    gueltigBisText: (t) => `valid until ${t}`,
    offene: (n) => `${String(n)} open notice${n === 1 ? '' : 's'}`,
    unbestaetigt: 'Entry not yet confirmed (O-07)',
    ohneRegistrierungspflicht: 'Registration not required according to the entry',
    gueltigkeitAbgelaufen: (t) =>
      `The recorded validity ended on ${t} — please check the status.`,
    zuletztBestaetigt: (w) => `Last stated on ${w}`,
    hostsText: (h) => `Assigned via: ${h}`,
    keineHosts: 'No host names — notices are not assigned to this platform.',
    stand: {
      registriert: 'registered and activated',
      beantragt: 'applied for — not yet activated',
      nicht_registriert: 'not registered',
      abgelaufen: 'expired',
      unbekannt: 'unknown — nobody has checked yet',
    },

    registrierungTitel: 'Status of this Mandant (company)',
    feldStand: 'Status',
    feldKennung: 'Login name',
    feldKennungHinweis: 'Only the login — never a password.',
    feldRegistriertAm: 'Activated on',
    feldGueltigBis: 'Valid until',
    feldVerantwortlich: 'Responsible',
    niemand: '— nobody named —',
    feldNotiz: 'Note',
    registrierungSpeichern: 'Save status',

    katalogTitel: 'Maintain the catalogue',
    katalogErklaerung:
      'For the super administration only: the catalogue applies to the whole group. Enter what '
      + 'you know; a new entry stays unconfirmed until you confirm it. After saving, notices '
      + 'already read in without a platform are assigned via the host names.',
    eintragen: 'Enter platform',
    eintragAendern: 'Change entry',
    feldName: 'Name',
    feldSlug: 'Short name',
    feldSlugHinweis: 'Leave empty: it is derived from the name.',
    feldBetreiber: 'Operator',
    feldBasisUrl: 'Address (https://…)',
    feldHosts: 'Host names of the notices',
    feldHostsHinweis:
      'The hosts on which this platform publishes its notices, e.g. vergabe.berlin.de — '
      + 'separated by comma or line break. Sub-domains count as well.',
    feldPflicht: 'Bidding requires a registration',
    feldDauer: 'Note on activation',
    feldDauerHinweis: 'Free text, e.g. how long activation takes according to the operator.',
    speichern: 'Save',
    bestaetigen: 'Confirm entry',
    bestaetigenHinweis: 'You confirm that this platform applies to the group (O-07).',
    archivieren: 'Archive',
    archivierenHinweis:
      'Nothing is deleted: notices and registrations stay readable, new notices are no longer '
      + 'assigned.',
    nurSuperAdmin:
      'The catalogue itself is maintained by the super administration; here you keep the '
      + 'registration status of this Mandant (company).',

    keinKennwort:
      'A password is never stored here. What is kept is the login name — not the secret '
      + '(SEC-A5).',

    pruefungTitel: 'Platform checked',
    pruefungErklaerung:
      'What you checked for this notice: may we bid on its platform? This belongs to the '
      + 'Vorgang (case) and sets no status.',
    pruefungPlattform: (name, stand) =>
      `Platform according to the catalogue: ${name} — status of this Mandant (company): ${stand}.`,
    pruefungOhnePlattform: (hinweis) =>
      `The platform is not in the catalogue (address: ${hinweis}).`,
    pruefungStand: 'Result of the check',
    pruefungGeprueftAm: (w) => `checked on ${w}`,
    pruefungNie: 'not checked yet',
    pruefungOhneVorgang:
      'The platform check belongs to the Vorgang (case) — it is opened by the first status set.',
    pruefungSpeichern: 'Save check',
    pruefung: {
      unbekannt: 'unknown',
      registriert: 'registered — we can bid there',
      nicht_registriert: 'not registered — activation needed',
      keine_plattform: 'no platform — submission by other means',
    },
    pruefungVermerkt: 'The platform check has been saved.',
  },
};
