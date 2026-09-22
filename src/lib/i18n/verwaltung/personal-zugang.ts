/**
 * Die Wörter des Mitarbeiterzugangs — in beiden Sprachen (V-014, EMP-01,
 * EMP-14, D-592).
 *
 * **Die Seite stand bisher in der Ausnahmeliste der Übersetzungswache** mit
 * fest verdrahteten deutschen Sätzen. Das war doppelt falsch: sie wird von
 * einer Einsatzleitung gelesen, deren Mandant auf Englisch stehen kann, und
 * sie erklärt genau die Fälle, in denen jemand sonst rät.
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text.** `Mandant`,
 * `Anstellung`, `Einsatzleitung` tragen Rechtsbedeutung; erklärt wird in
 * Klammern, ersetzt wird nicht. `Einmalcode` dagegen ist kein Rechtsbegriff
 * und heisst englisch „one-time code".
 */
import type { InternSprache } from '../intern.js';

export interface ZugangTexte {
  readonly modul: string;
  readonly titel: string;
  readonly untertitel: string;
  readonly zurPerson: string;

  /* ── Der Stand ───────────────────────────────────────────────────────── */
  readonly standTitel: string;
  readonly anmeldenummer: string;
  readonly anmeldenummerErklaerung: string;
  readonly akteTelefon: string;
  readonly akteTelefonErklaerung: string;
  readonly anmeldung: string;
  readonly anmeldungErklaerung: string;
  readonly smsVersand: string;
  readonly smsNichtVerbunden: string;
  readonly zugang: string;
  readonly zugangKeiner: string;
  readonly zugangGesperrt: string;
  readonly zugangEingerichtet: string;
  readonly gesperrtSeit: string;
  readonly sperrgrund: string;
  readonly konto: string;
  readonly kontoAktiv: string;
  readonly kontoKeines: string;
  readonly offeneCodes: string;
  readonly vonDrei: string;
  readonly letzteAnmeldung: string;
  readonly nochKeine: string;
  readonly leer: string;

  /* ── Was der Anmeldung im Weg steht ──────────────────────────────────── */
  readonly gehtNichtDurch: string;
  readonly hindernisKeinZugang: string;
  readonly hindernisGesperrt: string;
  readonly hindernisKeinKonto: string;
  readonly hindernisBremse: string;

  /* ── Der Anmeldecode ─────────────────────────────────────────────────── */
  readonly codeAusgestellt: string;
  readonly codeNennen: string;
  readonly codeWeg: string;
  readonly codeKeiner: string;
  readonly codeFormularMitSms: string;
  readonly codeFormularOhneSms: string;
  readonly codeAusstellen: string;
  readonly codeGrund: Readonly<Record<string, string>>;

  /* ── Einrichten, umschreiben, sperren, entsperren (V-014) ────────────── */
  readonly einrichtenTitel: string;
  readonly einrichtenErklaerung: string;
  readonly nummer: string;
  readonly nummerBeispiel: string;
  readonly nummerErklaerung: string;
  readonly einrichten: string;

  readonly aendernTitel: string;
  readonly aendernErklaerung: string;
  readonly aendernWarnung: string;
  readonly aendern: string;

  readonly sperrenTitel: string;
  readonly sperrenErklaerung: string;
  readonly sperrgrundFeld: string;
  readonly sperrgrundBeispiel: string;
  readonly sperren: string;

  readonly entsperrenTitel: string;
  readonly entsperrenErklaerung: string;
  readonly entsperren: string;

  readonly erledigt: string;
  readonly keinSchreibrecht: string;
  readonly fehler: Readonly<Record<string, string>>;
}

export const ZUGANG_TEXTE: Readonly<Record<InternSprache, ZugangTexte>> = {
  de: {
    modul: 'Personal',
    titel: 'Zugang',
    untertitel:
      'Womit sich dieser Mensch am Telefon anmeldet — und was ihn daran hindert.',
    zurPerson: 'Zur Person',

    standTitel: 'Stand',
    anmeldenummer: 'Anmeldenummer',
    anmeldenummerErklaerung:
      'Mit dieser Nummer meldet sich der Mensch an. Sie steht vollständig nur in '
      + 'der Datenbank; hier sind es die letzten drei Ziffern.',
    akteTelefon: 'Telefon in der Personalakte',
    akteTelefonErklaerung:
      'Die Nummer aus den Stammdaten — für Rückrufe. Sie ist NICHT die '
      + 'Anmeldenummer; beide dürfen auseinanderlaufen, und genau deshalb '
      + 'stehen sie getrennt.',
    anmeldung: 'Verfahren',
    anmeldungErklaerung:
      'Mobilnummer + sechsstelliger Einmalcode, zehn Minuten gültig — kein Kennwort (EMP-01)',
    smsVersand: 'SMS-Versand',
    smsNichtVerbunden: 'nicht verbunden (O-82)',
    zugang: 'Zugang',
    zugangKeiner: 'keiner hinterlegt',
    zugangGesperrt: 'gesperrt',
    zugangEingerichtet: 'eingerichtet',
    gesperrtSeit: 'Gesperrt seit',
    sperrgrund: 'Sperrgrund',
    konto: 'Portalzugang (Konto)',
    kontoAktiv: 'aktiv',
    kontoKeines: 'keines — die Anmeldung käme auch mit richtigem Code nicht durch',
    offeneCodes: 'Offene Codes',
    vonDrei: 'von 3',
    letzteAnmeldung: 'Letzte Anmeldung',
    nochKeine: 'noch keine',
    leer: '—',

    gehtNichtDurch: 'Die Anmeldung geht so nicht durch.',
    hindernisKeinZugang:
      'Für diesen Menschen ist keine Anmeldenummer hinterlegt. Ohne Zugang gibt es '
      + 'keinen Code — richten Sie ihn unten ein.',
    hindernisGesperrt:
      'Der Zugang ist gesperrt. Ein Code würde nicht ausgestellt, und ein schon '
      + 'ausgestellter ist mit der Sperre wertlos geworden.',
    hindernisKeinKonto:
      'Dieser Mensch hat keinen aktiven Portalzugang (Benutzerkonto). Ein Code würde '
      + 'angenommen und verbraucht, die Anmeldung scheitert trotzdem — und am Telefon '
      + 'sähe es aus wie ein falscher Code. Erst das Konto anlegen oder entsperren, '
      + 'dann den Code ausstellen.',
    hindernisBremse:
      'Es sind drei Codes offen — mehr nimmt die Bremse nicht an (Schutz gegen Raten). '
      + 'Warten Sie, bis einer abläuft (zehn Minuten), oder lassen Sie einen einlösen.',

    codeAusgestellt: 'Anmeldecode ausgestellt.',
    codeNennen:
      'Nennen Sie der Person diesen Code — er gilt zehn Minuten und genau einmal:',
    codeWeg:
      'Die Person meldet sich unter /auth/mitarbeiter mit ihrer Mobilnummer an und '
      + 'gibt den Code ein. Die Ausstellung steht im Protokoll.',
    codeKeiner: 'Kein Code ausgestellt.',
    codeFormularMitSms:
      'Der Code geht normalerweise per SMS. Hier stellen Sie ihn zusätzlich aus, wenn '
      + 'die SMS nicht ankommt.',
    codeFormularOhneSms:
      'Solange kein SMS-Gateway verbunden ist (O-82), stellt die Einsatzleitung den Code '
      + 'hier aus und nennt ihn der Person — derselbe Code, dieselbe Frist, dieselbe '
      + 'Bremse (drei offene Codes).',
    codeAusstellen: 'Anmeldecode ausstellen',
    codeGrund: {
      keine_anstellung: 'Dieser Mensch ist in dieser Gesellschaft nicht beschäftigt.',
      kein_zugang:
        'Für diesen Menschen ist keine Anmeldenummer hinterlegt — ohne Nummer gibt es '
        + 'keinen Code.',
      gesperrt: 'Der Zugang dieses Menschen ist gesperrt.',
      bremse:
        'Es sind schon drei Codes offen. Warten Sie, bis einer abgelaufen ist (zehn '
        + 'Minuten), oder lösen Sie einen ein.',
    },

    einrichtenTitel: 'Zugang einrichten',
    einrichtenErklaerung:
      'Ein Login je Mensch, nicht je Anstellung (EMP-14, D-09): wer in zwei '
      + 'Gesellschaften der Gruppe beschäftigt ist, meldet sich mit EINER Nummer an '
      + 'und sieht danach beide.',
    nummer: 'Mobilnummer',
    nummerBeispiel: '0170 1234567',
    nummerErklaerung:
      'Mit führender Null oder international (+49 …). Die Plattform normalisiert sie; '
      + 'eine Nummer ohne beides könnte deutsch oder ausländisch sein, und geraten '
      + 'wird nicht.',
    einrichten: 'Zugang einrichten',

    aendernTitel: 'Anmeldenummer ändern',
    aendernErklaerung:
      'Neues Telefon, neue Nummer. Der Zugang bleibt derselbe; die alte Nummer meldet '
      + 'sich ab sofort nicht mehr an.',
    aendernWarnung:
      'Wer die Nummer hat, bekommt den Code — eine Änderung ist fachlich eine Übergabe '
      + 'des Kontos. Sie steht mit alter und neuer Nummer im Protokoll (AUT-08). Ob '
      + 'dafür ein zweites Augenpaar verlangt wird, ist nicht entschieden (O-86) und '
      + 'wird hier nicht erfunden. Ein bereits ausgestellter Code bleibt bis zu seinem '
      + 'Ablauf gültig — auch für die neue Nummer.',
    aendern: 'Nummer ändern',

    sperrenTitel: 'Zugang sperren',
    sperrenErklaerung:
      'Verlorenes Telefon, Austritt, Verdacht. Die Sperre wirkt sofort und auch auf '
      + 'schon ausgestellte Codes: die Anmeldung sucht den Zugang nur, solange er '
      + 'nicht gesperrt ist. Gelöscht wird nichts (Invariante 8) — der Zugang bleibt '
      + 'stehen und lässt sich entsperren.',
    sperrgrundFeld: 'Grund der Sperre',
    sperrgrundBeispiel: 'Diensttelefon verloren, gemeldet am …',
    sperren: 'Zugang sperren',

    entsperrenTitel: 'Zugang entsperren',
    entsperrenErklaerung:
      'Der Mensch meldet sich danach wieder mit derselben Nummer an. Der Sperrgrund '
      + 'muss dabei geleert werden; er bleibt im Protokoll lesbar.',
    entsperren: 'Zugang entsperren',

    erledigt: 'Erledigt.',
    keinSchreibrecht: 'Zum Ändern fehlt das Recht',
    fehler: {
      keine_nummer:
        'Das ist keine Mobilnummer, die sich eindeutig lesen lässt. Schreiben Sie sie '
        + 'mit führender Null (0170 1234567) oder international (+49 170 1234567).',
      nummer_vergeben:
        'Diese Mobilnummer ist schon der Zugang eines anderen Menschen. Zwei Menschen '
        + 'unter einer Nummer wären ein Konto, in das beide kommen. Klären Sie, wem '
        + 'die Nummer gehört, und sperren Sie den alten Zugang, bevor Sie sie neu '
        + 'vergeben.',
      schon_vorhanden:
        'Dieser Mensch hat schon einen Zugang. Ändern Sie die Nummer, statt einen '
        + 'zweiten danebenzustellen — ein Mensch, ein Login (EMP-14).',
      kein_zugang: 'Für diesen Menschen gibt es keinen Zugang. Richten Sie ihn zuerst ein.',
      keine_anstellung:
        'Dieser Mensch ist in dieser Gesellschaft nicht beschäftigt. Ein Zugang hängt '
        + 'am Menschen, eingerichtet wird er von der Gesellschaft, die ihn beschäftigt.',
      unveraendert: 'Das ist die Nummer, die schon hinterlegt ist. Nichts geändert.',
      schon_gesperrt: 'Dieser Zugang ist schon gesperrt.',
      nicht_gesperrt: 'Dieser Zugang ist nicht gesperrt.',
      grund_fehlt:
        'Eine Sperre ohne Grund ist keine Auskunft — mindestens drei Zeichen. Sie '
        + 'beantwortet später die Frage, warum dieser Mensch nicht mehr ins Portal kommt.',
      abgewiesen:
        'Die Datenbank hat den Schreibversuch abgewiesen. Fehlt das Recht in dieser '
        + 'Gesellschaft, oder steht die Ansicht auf „nur lesen"?',
    },
  },

  en: {
    modul: 'Personnel',
    titel: 'Access',
    untertitel:
      'What this person signs in with on their phone — and what is stopping them.',
    zurPerson: 'To the person',

    standTitel: 'Status',
    anmeldenummer: 'Sign-in number',
    anmeldenummerErklaerung:
      'This is the number the person signs in with. It is held in full only in the '
      + 'database; shown here are the last three digits.',
    akteTelefon: 'Phone in the personnel file',
    akteTelefonErklaerung:
      'The number from the master data — for calling back. It is NOT the sign-in '
      + 'number; the two may differ, which is exactly why they are shown apart.',
    anmeldung: 'Method',
    anmeldungErklaerung:
      'Mobile number + a six-digit one-time code, valid ten minutes — no password (EMP-01)',
    smsVersand: 'SMS delivery',
    smsNichtVerbunden: 'not connected (O-82)',
    zugang: 'Access',
    zugangKeiner: 'none on file',
    zugangGesperrt: 'locked',
    zugangEingerichtet: 'set up',
    gesperrtSeit: 'Locked since',
    sperrgrund: 'Reason for the lock',
    konto: 'Portal account',
    kontoAktiv: 'active',
    kontoKeines: 'none — sign-in would fail even with the right code',
    offeneCodes: 'Open codes',
    vonDrei: 'of 3',
    letzteAnmeldung: 'Last sign-in',
    nochKeine: 'none yet',
    leer: '—',

    gehtNichtDurch: 'Sign-in will not get through like this.',
    hindernisKeinZugang:
      'No sign-in number is on file for this person. Without an access there is no '
      + 'code — set one up below.',
    hindernisGesperrt:
      'The access is locked. No code would be issued, and any code already issued '
      + 'became worthless with the lock.',
    hindernisKeinKonto:
      'This person has no active portal account. A code would be accepted and used '
      + 'up, sign-in would still fail — and on the phone it would look like a wrong '
      + 'code. Create or unlock the account first, then issue the code.',
    hindernisBremse:
      'Three codes are open — the brake takes no more (protection against guessing). '
      + 'Wait until one expires (ten minutes) or have one redeemed.',

    codeAusgestellt: 'Sign-in code issued.',
    codeNennen:
      'Read this code out to the person — it is valid for ten minutes and exactly once:',
    codeWeg:
      'The person opens /auth/mitarbeiter, enters their mobile number and the code. '
      + 'The issuing is recorded in the audit log.',
    codeKeiner: 'No code issued.',
    codeFormularMitSms:
      'The code normally goes by SMS. Issue it here in addition when the SMS does not '
      + 'arrive.',
    codeFormularOhneSms:
      'As long as no SMS gateway is connected (O-82), the shift lead issues the code '
      + 'here and reads it out — same code, same window, same brake (three open codes).',
    codeAusstellen: 'Issue sign-in code',
    codeGrund: {
      keine_anstellung:
        'This person is not employed by this Gesellschaft (legal entity).',
      kein_zugang:
        'No sign-in number is on file for this person — without a number there is no code.',
      gesperrt: 'This person’s access is locked.',
      bremse:
        'Three codes are already open. Wait until one expires (ten minutes) or have one '
        + 'redeemed.',
    },

    einrichtenTitel: 'Set up access',
    einrichtenErklaerung:
      'One login per human, not per Anstellung (employment relationship) — EMP-14, '
      + 'D-09: whoever works for two Gesellschaften of the group signs in with ONE '
      + 'number and then sees both.',
    nummer: 'Mobile number',
    nummerBeispiel: '0170 1234567',
    nummerErklaerung:
      'With a leading zero or international (+49 …). The platform normalises it; a '
      + 'number with neither could be German or foreign, and nothing is guessed.',
    einrichten: 'Set up access',

    aendernTitel: 'Change the sign-in number',
    aendernErklaerung:
      'New phone, new number. The access stays the same; the old number stops signing '
      + 'in immediately.',
    aendernWarnung:
      'Whoever holds the number receives the code — changing it is, in substance, '
      + 'handing over the account. It is recorded with the old and the new number '
      + '(AUT-08). Whether a second pair of eyes is required for this is not decided '
      + '(O-86) and is not invented here. A code already issued stays valid until it '
      + 'expires — for the new number too.',
    aendern: 'Change number',

    sperrenTitel: 'Lock access',
    sperrenErklaerung:
      'Lost phone, departure, suspicion. The lock takes effect at once and also on '
      + 'codes already issued: sign-in only finds the access while it is unlocked. '
      + 'Nothing is deleted (invariant 8) — the access stays and can be unlocked.',
    sperrgrundFeld: 'Reason for the lock',
    sperrgrundBeispiel: 'Company phone lost, reported on …',
    sperren: 'Lock access',

    entsperrenTitel: 'Unlock access',
    entsperrenErklaerung:
      'The person signs in again afterwards with the same number. The reason has to be '
      + 'cleared; it stays readable in the audit log.',
    entsperren: 'Unlock access',

    erledigt: 'Done.',
    keinSchreibrecht: 'Changing this needs the right',
    fehler: {
      keine_nummer:
        'That is not a mobile number that can be read unambiguously. Write it with a '
        + 'leading zero (0170 1234567) or international (+49 170 1234567).',
      nummer_vergeben:
        'This mobile number is already another person’s access. Two humans under one '
        + 'number would be one account both get into. Find out whose number it is and '
        + 'lock the old access before handing it out again.',
      schon_vorhanden:
        'This person already has an access. Change the number instead of putting a '
        + 'second one beside it — one human, one login (EMP-14).',
      kein_zugang: 'There is no access for this person. Set one up first.',
      keine_anstellung:
        'This person is not employed by this Gesellschaft (legal entity). An access '
        + 'belongs to the human; it is set up by the entity employing them.',
      unveraendert: 'That is the number already on file. Nothing changed.',
      schon_gesperrt: 'This access is already locked.',
      nicht_gesperrt: 'This access is not locked.',
      grund_fehlt:
        'A lock without a reason tells nobody anything — at least three characters. It '
        + 'answers the later question of why this person can no longer get into the portal.',
      abgewiesen:
        'The database refused the write. Is the right missing in this Gesellschaft, or '
        + 'is the view read-only?',
    },
  },
};
