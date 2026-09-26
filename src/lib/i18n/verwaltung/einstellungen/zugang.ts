/**
 * Die vier Handlungen am Zugang eines fremden Kontos — in beiden Sprachen
 * (V-022, V-074, V-075, V-076).
 *
 * **Die Rechteschlüssel werden NICHT übersetzt.** `system.benutzer_verwalten`
 * und `system.sitzung_widerrufen` stehen so im Katalog, in jeder Policy und in
 * jedem Protokolleintrag; übersetzt wird, was sie bedeuten.
 *
 * **Der Unterschied zwischen Widerruf und Entzug steht in beiden Sprachen
 * ausgeschrieben.** Er ist der Punkt, an dem sich die zwei Rechte trennen —
 * und die zwei Knöpfe stehen untereinander. Wer „beenden" für „sperren" hält,
 * lässt jemanden im Betrieb, den er hinauswerfen wollte, oder umgekehrt.
 */
import type { InternSprache } from '../../intern.js';

export interface ZugangTexte {
  readonly abschnitt: string;
  readonly grund: string;
  readonly eigenesKonto: string;

  readonly entsperrenTitel: string;
  readonly entsperrenText: string;
  readonly entsperrenKnopf: string;

  readonly entziehenTitel: string;
  readonly entziehenText: string;
  readonly entziehenKnopf: string;

  readonly wiedergebenTitel: string;
  readonly wiedergebenText: string;
  readonly wiedergebenKnopf: string;

  readonly widerrufenTitel: string;
  readonly widerrufenText: string;
  readonly widerrufenKnopf: string;

  /** Was nach dem Klick oben steht — der Schlüssel kommt aus der Adresse. */
  readonly meldung: Readonly<Record<string, string>>;
}

export const ZUGANG_TEXTE: Readonly<Record<InternSprache, ZugangTexte>> = {
  de: {
    abschnitt: 'Zugang',
    grund: 'Grund',
    eigenesKonto:
      'Das ist Ihr eigenes Konto. Der Zugangsentzug und der Sitzungswiderruf '
      + 'führen über ein anderes Konto — die eigenen Anmeldungen stehen unter',

    entsperrenTitel: 'Sperre aufheben',
    entsperrenText:
      'Das Konto ist nach zu vielen Fehlversuchen gesperrt. Die Aufhebung setzt '
      + 'zugleich das Zählfenster zurück — sonst sperrte der nächste Fehlversuch '
      + 'sofort wieder. Was danach schiefgeht, zählt normal weiter.',
    entsperrenKnopf: 'Sperre aufheben',

    entziehenTitel: 'Zugang entziehen',
    entziehenText:
      'Das Konto bleibt bestehen und kann sich nicht mehr anmelden. Gelöscht '
      + 'wird nichts: das Protokoll benennt dieses Konto als Handelnden, '
      + 'dauerhaft. Offene Anmeldungen enden mit.',
    entziehenKnopf: 'Zugang entziehen',

    wiedergebenTitel: 'Zugang wiedergeben',
    wiedergebenText:
      'Das Konto kann sich wieder anmelden. Die Anmeldung selbst — Kennwort und '
      + 'zweiter Faktor — besteht unverändert; entzogen war nur der Zugang.',
    wiedergebenKnopf: 'Zugang wiedergeben',

    widerrufenTitel: 'Alle Anmeldungen beenden',
    widerrufenText:
      'Beendet jede offene Anmeldung dieses Kontos — der Fall des verlorenen '
      + 'Geräts. Der Zugang bleibt: wer das Kennwort hat, meldet sich sofort '
      + 'wieder an. Für den Entzug ist das Feld darüber da.',
    widerrufenKnopf: 'Anmeldungen beenden',

    meldung: {
      entsperren: 'Das Konto ist entsperrt. Die Anmeldung ist wieder möglich.',
      entsperren_unveraendert: 'Das Konto war nicht gesperrt — nichts geändert.',
      deaktivieren: 'Der Zugang ist entzogen. Offene Anmeldungen wurden beendet.',
      deaktivieren_unveraendert: 'Der Zugang war bereits entzogen — nichts geändert.',
      reaktivieren: 'Der Zugang ist wieder da. Die Anmeldung besteht unverändert.',
      reaktivieren_unveraendert: 'Das Konto war nicht deaktiviert — nichts geändert.',
      sitzungen_widerrufen: 'Anmeldungen beendet.',
      sitzungen_widerrufen_unveraendert:
        'Es lief keine Anmeldung — nichts zu beenden.',
    },
  },

  en: {
    abschnitt: 'Access',
    grund: 'Reason',
    eigenesKonto:
      'This is your own account. Withdrawing access and revoking sessions go '
      + 'through a different account — your own sign-ins are listed under',

    entsperrenTitel: 'Lift the lock',
    entsperrenText:
      'The account is locked after too many failed attempts. Lifting it also '
      + 'resets the counting window — otherwise the next failed attempt would '
      + 'lock it again immediately. Whatever goes wrong after that counts as usual.',
    entsperrenKnopf: 'Lift the lock',

    entziehenTitel: 'Withdraw access',
    entziehenText:
      'The account stays and can no longer sign in. Nothing is deleted: the '
      + 'audit log names this account as the actor, permanently. Open sign-ins '
      + 'end with it.',
    entziehenKnopf: 'Withdraw access',

    wiedergebenTitel: 'Restore access',
    wiedergebenText:
      'The account can sign in again. The sign-in itself — password and second '
      + 'factor — is unchanged; only access had been withdrawn.',
    wiedergebenKnopf: 'Restore access',

    widerrufenTitel: 'End all sign-ins',
    widerrufenText:
      'Ends every open sign-in of this account — the lost-device case. Access '
      + 'remains: whoever has the password signs in again at once. For '
      + 'withdrawing access, use the panel above.',
    widerrufenKnopf: 'End sign-ins',

    meldung: {
      entsperren: 'The account is unlocked. Signing in is possible again.',
      entsperren_unveraendert: 'The account was not locked — nothing changed.',
      deaktivieren: 'Access withdrawn. Open sign-ins have been ended.',
      deaktivieren_unveraendert: 'Access had already been withdrawn — nothing changed.',
      reaktivieren: 'Access is back. The sign-in is unchanged.',
      reaktivieren_unveraendert: 'The account was not deactivated — nothing changed.',
      sitzungen_widerrufen: 'Sign-ins ended.',
      sitzungen_widerrufen_unveraendert: 'No sign-in was open — nothing to end.',
    },
  },
};
