/**
 * `/[mandant]/einstellungen/benutzer/einladen` — in beiden Sprachen.
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text** (siehe
 * `../basis.ts`): `Mandant` und `Gesellschaft` tragen im Konzernrecht eine
 * Bedeutung, die „client" oder „company" nicht trifft. Wo einer stehen
 * bleibt, steht die Erklaerung daneben — nie eine erfundene Entsprechung.
 *
 * **Die Rollennamen `admin` und `leitung` werden NICHT uebersetzt.** Sie sind
 * Schluessel aus `rolle.schluessel` und stehen so in jedem Protokolleintrag,
 * in der Rechtematrix und in `katalog.generiert.ts`. Uebersetzt wird ihre
 * ERKLAERUNG, damit ein englischer Leser weiss, was er vergibt.
 */
import type { InternSprache } from '../../intern.js';

export interface VerwaltungskontoTexte {
  readonly titel: string;
  /** Der Name der Portalwurzel in der Spur `‹ Einstellungen › …`. */
  readonly wurzelTitel: string;
  readonly untertitel: string;
  readonly zurueckZurListe: string;

  readonly nurSuperAdmin: string;
  readonly nurSuperAdminTitel: string;

  readonly email: string;
  readonly emailHinweis: string;
  readonly name: string;
  readonly nameHinweis: string;
  readonly rolle: string;
  readonly rolleAdmin: string;
  readonly rolleLeitung: string;
  readonly einladen: string;

  readonly linkTitel: string;
  readonly linkErklaerung: string;
  readonly linkKopieren: string;
  readonly linkEinmal: string;
  readonly fehlerTitel: string;

  readonly keinVersand: string;
  readonly superAdminOffen: string;
}

export const VERWALTUNGSKONTO_TEXTE:
Readonly<Record<InternSprache, VerwaltungskontoTexte>> = {
  de: {
    titel: 'Verwaltungskonto einladen',
    wurzelTitel: 'Einstellungen',
    untertitel:
      'Legt ein Konto an und stellt einen Einladungslink aus. Das Konto steht danach '
      + 'auf „Wartet", bis die eingeladene Person ihr Kennwort gesetzt hat.',
    zurueckZurListe: 'Alle Benutzer',

    nurSuperAdminTitel: 'Das darf nur die Super-Administration.',
    nurSuperAdmin:
      'Ein Verwaltungskonto sieht Personal, Zeiten und Finanzen einer Gesellschaft. '
      + 'Wer solche Konten anlegen darf, kann sich die ganze Gruppe erschliessen — '
      + 'deshalb liegt dieses Recht oben und nicht bei der Administration einer '
      + 'einzelnen Gesellschaft (D-610). Mitarbeiter- und Kundenzugänge legen Sie '
      + 'weiterhin selbst an.',

    email: 'E-Mail-Adresse',
    emailHinweis: 'Die Adresse ist der Anmeldename. Ein bestehendes Kundenkonto kann '
      + 'nicht zu einem Verwaltungskonto werden (K-04).',
    name: 'Name',
    nameHinweis: 'Er steht in jeder Freigabe und in jedem Protokolleintrag.',
    rolle: 'Rolle in dieser Gesellschaft',
    rolleAdmin: '`admin` — Administration der Gesellschaft: Stammdaten, Benutzer, '
      + 'Finanzen, Freigaben.',
    rolleLeitung: '`leitung` — Einsatz- und Objektleitung: Dienstplan, Zeiten, '
      + 'Nachweise; keine Benutzerverwaltung.',
    einladen: 'Einladen',

    linkTitel: 'Das Konto ist angelegt.',
    linkErklaerung:
      'Geben Sie diesen Link persönlich weiter — über einen Kanal, dem Sie trauen. '
      + 'Es ist kein Mailversand verbunden, und hier wird keiner vorgetäuscht.',
    linkKopieren: 'Einladungslink',
    linkEinmal:
      'Er steht genau einmal hier. Gespeichert ist nur seine Prüfsumme; wenn Sie ihn '
      + 'verlieren, stellen Sie einen neuen aus — der alte verfällt dabei.',
    fehlerTitel: 'Die Einladung wurde nicht ausgestellt.',

    keinVersand: 'Nicht verbunden: es ist kein Mailanbieter hinterlegt (O-501). '
      + 'Der Link wird deshalb angezeigt und nicht versendet.',
    superAdminOffen:
      'Eine zweite Super-Administration lässt sich hier nicht einladen — und auch '
      + 'sonst nirgends in der Anwendung. Sie entsteht ausschliesslich über die '
      + 'Umgebung der Bereitstellung (D-617): so lässt sie sich jederzeit '
      + 'wiederherstellen, aber nur von dem, der den Server kontrolliert — und keine '
      + 'gekaperte Anmeldung kann diesen Weg nehmen.',
  },
  en: {
    titel: 'Invite an administration account',
    wurzelTitel: 'Settings',
    untertitel:
      'Creates an account and issues an invitation link. The account then sits at '
      + '„Wartet" (waiting) until the invited person has set their password.',
    zurueckZurListe: 'All users',

    nurSuperAdminTitel: 'Only the super administration may do this.',
    nurSuperAdmin:
      'An administration account sees personnel, working time and finances of a '
      + 'Gesellschaft (one legal entity of the group). Whoever may create such '
      + 'accounts can open up the whole group — which is why this right sits at the '
      + 'top and not with the administration of a single Gesellschaft (D-610). '
      + 'Employee and customer access stays yours to grant.',

    email: 'E-mail address',
    emailHinweis: 'The address is the login name. An existing customer account cannot '
      + 'become an administration account (K-04).',
    name: 'Name',
    nameHinweis: 'It appears in every approval and in every audit entry.',
    rolle: 'Role in this Gesellschaft',
    rolleAdmin: '`admin` — administration of the Gesellschaft: master data, users, '
      + 'finances, approvals.',
    rolleLeitung: '`leitung` — dispatch and site management: rosters, working time, '
      + 'records; no user administration.',
    einladen: 'Invite',

    linkTitel: 'The account has been created.',
    linkErklaerung:
      'Pass this link on in person — over a channel you trust. No mail provider is '
      + 'connected, and none is simulated here.',
    linkKopieren: 'Invitation link',
    linkEinmal:
      'It is shown exactly once. Only its checksum is stored; if you lose it, issue a '
      + 'new one — the old one expires in the process.',
    fehlerTitel: 'The invitation was not issued.',

    keinVersand: 'Not connected: no mail provider is configured (O-501). The link is '
      + 'therefore displayed, not sent.',
    superAdminOffen:
      'A second super administration cannot be invited here — nor anywhere else in '
      + 'the application. It is created solely through the deployment environment '
      + '(D-617): that way it can be restored at any time, but only by whoever '
      + 'controls the server — and no hijacked session can take that path.',
  },
};
