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

/**
 * Jeder Grund, mit dem `POST /api/system/verwaltungskonto` eine Einladung
 * NICHT ausstellt (D-769, D-774). Er reist als `?fehler=<grund>`, getrennt vom
 * Erfolg (`?erfolg=eingeladen`); bis dahin reisten beide als `?meldung=`, und
 * die Seite zeigte den deutschen Satz der Datenbank roh.
 *
 * Die Sätze der Datenbank (0372) bildet der Dienst ab
 * (`einladungsGrund`); `anbieter_fremd` und `nicht_erlaubt` sind die zwei
 * Gründe von `EinladungFehler`, `rolle_unzulaessig` prüft die Route auch
 * selbst.
 */
export const VERWALTUNGSKONTO_FEHLER_GRUENDE = [
  'gesellschaft_fehlt', 'email_ungueltig', 'name_fehlt', 'rolle_unzulaessig', 'kundenkonto',
  'schon_eingetragen', 'nicht_ausgestellt', 'anbieter_fremd', 'nicht_erlaubt',
] as const;
export type VerwaltungskontoFehlerGrund = (typeof VERWALTUNGSKONTO_FEHLER_GRUENDE)[number];

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
  /**
   * Der Satz zu `?erfolg=eingeladen`, wenn der Keks mit dem Link schon
   * abgelaufen ist — nachgeschlagen mit `eigenerEintrag()`; ein unbekannter
   * Schlüssel zeigt keinen Kasten (ein allgemeiner Erfolgssatz behauptete
   * einen Erfolg, den es nicht gab).
   */
  readonly erfolg: Readonly<Record<'eingeladen', string>>;
  readonly fehlerTitel: string;
  /** Der Satz zu `?fehler=<grund>` — nachgeschlagen mit `eigenerEintrag()`. */
  readonly fehler: Readonly<Record<VerwaltungskontoFehlerGrund, string>>;
  /** Für einen Grund, den die Tabelle nicht kennt. */
  readonly fehlerSonst: string;

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
    rolleAdmin: 'Administration — verwaltet die Gesellschaft: Stammdaten, Benutzer, '
      + 'Finanzen, Freigaben.',
    rolleLeitung: 'Leitung — Einsatz- und Objektleitung: Dienstplan, Zeiten, '
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
    erfolg: {
      eingeladen:
        'Die Einladung ist ausgestellt; den Link zeigt die Seite nur unmittelbar danach — '
        + 'gespeichert ist nur seine Prüfsumme.',
    },
    fehlerTitel: 'Die Einladung wurde nicht ausgestellt.',
    fehler: {
      gesellschaft_fehlt: 'Diese Gesellschaft gibt es nicht.',
      email_ungueltig:
        'Ohne gültige E-Mail-Adresse gibt es kein Konto — die Adresse ist der Anmeldename.',
      name_fehlt:
        'Ein Konto braucht einen Namen — er steht in jeder Freigabe und in jedem '
        + 'Protokolleintrag.',
      rolle_unzulaessig:
        'Über diesen Weg werden nur die Administration und die Leitung eingeladen. '
        + 'Mitarbeiter- und Kundenzugänge haben eigene Wege; eine Super-Administration '
        + 'entsteht nur über die Umgebung der Bereitstellung (D-617).',
      kundenkonto:
        'Diese Adresse gehört einem Kundenkonto. Ein Verwaltungszugang dafür höbe die '
        + 'Trennung der Portale auf (K-04).',
      schon_eingetragen:
        'Dieses Konto ist in dieser Gesellschaft schon eingetragen. Ändern Sie seine Rolle, '
        + 'statt es erneut einzuladen.',
      nicht_ausgestellt: 'Die Datenbank hat keine Einladung ausgestellt; es wurde kein Konto '
        + 'angelegt.',
      anbieter_fremd:
        'Supabase Auth ist als Anbieter aktiv. Ein Konto entsteht dann beim Anbieter und nicht '
        + 'in dieser Datenbank — ein hier angelegtes Konto könnte sich nicht anmelden. Dieser '
        + 'Weg ist noch nicht gebaut (O-501, O-662).',
      nicht_erlaubt:
        'Die Datenbank hat die Einladung abgewiesen. Einladen darf nur die '
        + 'Super-Administration — mit zweitem Faktor, im Bereich genau einer Gesellschaft und '
        + 'nicht aus der Gruppenansicht.',
    },
    fehlerSonst: 'Es wurde kein Konto angelegt.',

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
    rolleAdmin: 'Administration — runs the Gesellschaft: master data, users, '
      + 'finances, approvals.',
    rolleLeitung: 'Leitung (management) — dispatch and site management: rosters, '
      + 'working time, records; no user administration.',
    einladen: 'Invite',

    linkTitel: 'The account has been created.',
    linkErklaerung:
      'Pass this link on in person — over a channel you trust. No mail provider is '
      + 'connected, and none is simulated here.',
    linkKopieren: 'Invitation link',
    linkEinmal:
      'It is shown exactly once. Only its checksum is stored; if you lose it, issue a '
      + 'new one — the old one expires in the process.',
    erfolg: {
      eingeladen:
        'The invitation has been issued; the page shows the link only right afterwards — '
        + 'only its checksum is stored.',
    },
    fehlerTitel: 'The invitation was not issued.',
    fehler: {
      gesellschaft_fehlt: 'This Gesellschaft does not exist.',
      email_ungueltig:
        'Without a valid e-mail address there is no account — the address is the login name.',
      name_fehlt:
        'An account needs a name — it appears in every approval and in every audit entry.',
      rolle_unzulaessig:
        'Only the administration and the Leitung (management) are invited this way. Employee '
        + 'and customer access have their own paths; a super administration is created only '
        + 'through the deployment environment (D-617).',
      kundenkonto:
        'This address belongs to a customer account. Administration access for it would '
        + 'break the separation of the portals (K-04).',
      schon_eingetragen:
        'This account is already registered in this Gesellschaft. Change its role instead of '
        + 'inviting it again.',
      nicht_ausgestellt: 'The database issued no invitation; no account was created.',
      anbieter_fremd:
        'Supabase Auth is active as the provider. An account is then created with the '
        + 'provider, not in this database — an account created here could not sign in. That '
        + 'path is not built yet (O-501, O-662).',
      nicht_erlaubt:
        'The database rejected the invitation. Only the super administration may invite — '
        + 'with a second factor, within exactly one Gesellschaft and not from the group view.',
    },
    fehlerSonst: 'No account was created.',

    keinVersand: 'Not connected: no mail provider is configured (O-501). The link is '
      + 'therefore displayed, not sent.',
    superAdminOffen:
      'A second super administration cannot be invited here — nor anywhere else in '
      + 'the application. It is created solely through the deployment environment '
      + '(D-617): that way it can be restored at any time, but only by whoever '
      + 'controls the server — and no hijacked session can take that path.',
  },
};
