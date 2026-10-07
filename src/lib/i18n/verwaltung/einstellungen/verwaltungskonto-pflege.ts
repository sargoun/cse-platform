/**
 * Das Benutzerblatt eines Verwaltungskontos: neuer Link und Rollenwechsel
 * (V-302, O-980, O-981, D-821) — in beiden Sprachen.
 *
 * Wie bei der Einladung bleiben die Rollenschlüssel `admin` und `leitung`
 * stehen (`./verwaltungskonto.ts`); übersetzt wird ihre Erklärung.
 */
import type { InternSprache } from '../../intern.js';

/**
 * Jeder Stand, mit dem `POST /api/system/verwaltungskonto` (Aktionen
 * `link_neu` und `rolle`) auf das Benutzerblatt zurückführt — als
 * `?verwaltung=<stand>`. Die Gründe einer Abweisung sind die der beiden
 * Definer aus 0517 (`VERWALTUNG_GRUENDE` im Dienst), dazu `nicht_erlaubt` und
 * `anbieter_fremd` aus `EinladungFehler`.
 */
export const VERWALTUNGSKONTO_PFLEGE_STAENDE = [
  'link_einladung', 'link_kennwort', 'gewechselt', 'unveraendert',
  'kein_verwaltungskonto', 'deaktiviert', 'gesperrt', 'rolle_unzulaessig', 'selbst',
  'nicht_ausgefuehrt', 'nicht_erlaubt', 'anbieter_fremd',
] as const;
export type VerwaltungskontoPflegeStand = (typeof VERWALTUNGSKONTO_PFLEGE_STAENDE)[number];

/** Die Stände, die ein Erfolg sind — die übrigen sagen, warum nichts geschah. */
export const VERWALTUNGSKONTO_PFLEGE_ERFOLGE: ReadonlySet<string> =
  new Set(['link_einladung', 'link_kennwort', 'gewechselt']);

export interface VerwaltungskontoPflegeTexte {
  readonly abschnitt: string;
  readonly nurSuperAdmin: string;

  readonly linkTitel: string;
  readonly linkWartet: string;
  readonly linkAktiv: string;
  readonly linkKnopf: string;

  readonly rolleTitel: string;
  readonly rolleErklaerung: string;
  readonly rolle: string;
  readonly rolleAdmin: string;
  readonly rolleLeitung: string;
  readonly rolleKnopf: string;

  readonly linkAnzeigeTitel: string;
  readonly linkAnzeigeEinladung: string;
  readonly linkAnzeigeKennwort: string;
  readonly linkKopieren: string;
  readonly linkEinmal: string;

  /** Der Satz zu `?verwaltung=<stand>` — nachgeschlagen mit `eigenerEintrag()`. */
  readonly stand: Readonly<Record<VerwaltungskontoPflegeStand, string>>;
}

export const VERWALTUNGSKONTO_PFLEGE_TEXTE:
Readonly<Record<InternSprache, VerwaltungskontoPflegeTexte>> = {
  de: {
    abschnitt: 'Verwaltungskonto',
    nurSuperAdmin:
      'Link und Rolle eines Verwaltungskontos pflegt nur die Super-Administration, mit '
      + 'zweitem Faktor (D-610) — beides steht im Protokoll.',

    linkTitel: 'Neuen Link ausstellen',
    linkWartet:
      'Das Konto wartet noch auf die Annahme der Einladung. Ein neuer Einladungslink '
      + 'ersetzt den bisherigen; der alte verfällt sofort.',
    linkAktiv:
      'Das Konto ist aktiv. Der neue Link führt zum Setzen eines neuen Kennworts — für '
      + 'den Fall, dass es vergessen ist; es ist kein Mailversand verbunden. Er gilt so lange '
      + 'wie jeder Zurücksetzungslink (Voreinstellung zwei Stunden, O-500), und jeder offene '
      + 'Link des Kontos verfällt dabei.',
    linkKnopf: 'Link ausstellen',

    rolleTitel: 'Rolle wechseln',
    rolleErklaerung:
      'Wechselt die Rolle dieses Kontos in dieser Gesellschaft. Eine Modulzuweisung bleibt '
      + 'stehen; eine Super-Administration entsteht hier nicht (D-617).',
    rolle: 'Neue Rolle',
    rolleAdmin: 'admin — Administration: Stammdaten, Benutzer, Finanzen, Freigaben.',
    rolleLeitung: 'leitung — Einsatz- und Objektleitung: Dienstplan, Zeiten, Nachweise.',
    rolleKnopf: 'Rolle wechseln',

    linkAnzeigeTitel: 'Der neue Link ist ausgestellt.',
    linkAnzeigeEinladung: 'Er ist eine Einladung: die Person setzt damit ihr Kennwort.',
    linkAnzeigeKennwort: 'Er führt zum Setzen eines neuen Kennworts.',
    linkKopieren: 'Link',
    linkEinmal:
      'Geben Sie ihn persönlich weiter — über einen Kanal, dem Sie trauen. Er steht genau '
      + 'einmal hier; gespeichert ist nur seine Prüfsumme.',

    stand: {
      link_einladung:
        'Ein neuer Einladungslink ist ausgestellt; den Link zeigt die Seite nur unmittelbar '
        + 'danach.',
      link_kennwort:
        'Ein neuer Kennwortlink ist ausgestellt; den Link zeigt die Seite nur unmittelbar '
        + 'danach.',
      gewechselt: 'Die Rolle ist gewechselt und im Protokoll vermerkt.',
      unveraendert: 'Das Konto hat diese Rolle schon — nichts geändert.',
      kein_verwaltungskonto:
        'Dieses Konto hat in dieser Gesellschaft keine lebende Mitgliedschaft als '
        + 'Administration oder Leitung — Mitarbeiter- und Kundenzugänge haben eigene Wege.',
      deaktiviert: 'Das Konto ist deaktiviert und bekommt keinen Link.',
      gesperrt: 'Das Konto ist gesperrt. Erst entsperren, dann einen Link ausstellen.',
      rolle_unzulaessig:
        'Gewechselt wird nur zwischen Administration und Leitung; eine Super-Administration '
        + 'entsteht nur über die Umgebung der Bereitstellung (D-617).',
      selbst: 'Die eigene Rolle wechselt man nicht selbst.',
      nicht_ausgefuehrt: 'Die Datenbank hat nichts ausgeführt; es wurde nichts geändert.',
      nicht_erlaubt:
        'Die Datenbank hat den Vorgang abgewiesen. Das darf nur die Super-Administration — '
        + 'mit zweitem Faktor, im Bereich genau einer Gesellschaft und nicht aus der '
        + 'Gruppenansicht.',
      anbieter_fremd:
        'Supabase Auth ist als Anbieter aktiv; einen Link stellt dann der Anbieter aus, '
        + 'nicht diese Datenbank. Dieser Weg ist noch nicht gebaut (O-501, O-662).',
    },
  },
  en: {
    abschnitt: 'Administration account',
    nurSuperAdmin:
      'Only the super administration maintains the link and the role of an administration '
      + 'account, with a second factor (D-610) — both appear in the audit log.',

    linkTitel: 'Issue a new link',
    linkWartet:
      'The account is still waiting for the invitation to be accepted. A new invitation '
      + 'link replaces the previous one; the old one expires at once.',
    linkAktiv:
      'The account is active. The new link leads to setting a new password — for when it '
      + 'has been forgotten; no e-mail sending is connected. It is valid as long as any reset '
      + 'link (default two hours, O-500), and every open link of the account expires.',
    linkKnopf: 'Issue link',

    rolleTitel: 'Change role',
    rolleErklaerung:
      'Changes the role of this account in this Gesellschaft (one legal entity of the '
      + 'group). A module assignment stays; no super administration is created here (D-617).',
    rolle: 'New role',
    rolleAdmin: 'admin — administration: master data, users, finances, approvals.',
    rolleLeitung: 'leitung — operations and site management: duty roster, times, records.',
    rolleKnopf: 'Change role',

    linkAnzeigeTitel: 'The new link has been issued.',
    linkAnzeigeEinladung: 'It is an invitation: the person sets their password with it.',
    linkAnzeigeKennwort: 'It leads to setting a new password.',
    linkKopieren: 'Link',
    linkEinmal:
      'Hand it over in person — over a channel you trust. It is shown here exactly once; '
      + 'only its checksum is stored.',

    stand: {
      link_einladung:
        'A new invitation link has been issued; the page shows the link only right after.',
      link_kennwort:
        'A new password link has been issued; the page shows the link only right after.',
      gewechselt: 'The role has been changed and recorded in the audit log.',
      unveraendert: 'The account already has this role — nothing changed.',
      kein_verwaltungskonto:
        'This account has no live membership as administration or leitung in this '
        + 'Gesellschaft — employee and customer access have their own ways.',
      deaktiviert: 'The account is deactivated and gets no link.',
      gesperrt: 'The account is locked. Unlock it first, then issue a link.',
      rolle_unzulaessig:
        'The role changes only between administration and leitung; a super administration '
        + 'is created only through the deployment environment (D-617).',
      selbst: 'You do not change your own role.',
      nicht_ausgefuehrt: 'The database did not carry anything out; nothing was changed.',
      nicht_erlaubt:
        'The database rejected the request. Only the super administration may do this — '
        + 'with a second factor, within exactly one Gesellschaft and not from the group view.',
      anbieter_fremd:
        'Supabase Auth is the active provider; the provider then issues links, not this '
        + 'database. This path is not built yet (O-501, O-662).',
    },
  },
};
