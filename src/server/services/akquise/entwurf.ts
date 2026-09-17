/**
 * Der Ansprache-Entwurf (§12 „Outreach draft").
 *
 * **Entwerfen ist erlaubt. Senden ist es nicht — noch nicht.** Der Unterschied
 * ist der ganze Sinn dieser Datei, und er lässt sich in einem Satz sagen:
 * ein Text, der in der Freigabemappe liegt, ist keine Werbung; §7 UWG
 * verbietet das *Zusenden*, nicht das *Schreiben*.
 *
 * Deshalb tut dieser Dienst zwei Dinge und ein drittes ausdrücklich nicht:
 *
 *  1. Er formuliert einen Entwurf aus dem, was über die Firma bekannt ist.
 *  2. Er sagt, **über welchen Weg** dieser Entwurf hinausgehen dürfte — und
 *     was dem heute entgegensteht.
 *  3. Er sendet nichts und legt keinen Versand an. Der Weg nach draußen führt
 *     über `lead_aktivitaet`, dort über `kern.uwg_sendetor`, und für den
 *     Agenten zusätzlich über `server/agent/policy.ts` (Invariante 7).
 *
 * **Ohne Modell.** Der Entwurf ist eine Vorlage mit eingesetzten Feldern, kein
 * erzeugter Text. Das ist heute keine Einschränkung, sondern der Stand: es ist
 * kein Anbieter freigeschaltet (D-435, O-509). Sobald einer es ist, kann ein
 * Modell diesen Text verbessern — die Vorlage bleibt der Rückfallweg, damit
 * ein nicht erreichbares Modell keinen leeren Entwurf erzeugt.
 *
 * **Und nie eine Zahl.** Kein Preis, kein Stundensatz, kein „ab 3,50 €/m²".
 * Ein Angebot rechnet `services/kalkulation` (Invariante 6). Der Entwurf lädt
 * zu einem Gespräch ein, er beziffert nichts.
 */
import type { Ziel } from './ziel.js';

export type Kanal = 'post' | 'telefon' | 'email';

export interface Gesellschaft {
  readonly name: string;
  readonly slug: string;
  /** Das Gewerk in einem Satz — steht schon im Unternehmensprofil. */
  readonly gewerk: string;
}

export interface Entwurf {
  readonly kanal: Kanal;
  readonly betreff: string;
  readonly text: string;
  /** Darf dieser Entwurf heute hinausgehen? Heute: nein, und der Grund steht daneben. */
  readonly versandMoeglich: false;
  readonly hindernis: string;
  /** Was ein Mensch tun müsste, damit er hinaus darf. In Schritten. */
  readonly schritte: readonly string[];
  readonly erzeugtVon: 'vorlage';
}

/**
 * Welcher Weg ist bei einer recherchierten Firma überhaupt denkbar?
 *
 * **Die Reihenfolge ist Rechtslage, keine Vorliebe:**
 *
 *  - **`email`** braucht nach §7 Abs. 2 Nr. 2 UWG die *vorherige ausdrückliche*
 *    Einwilligung — auch im B2B. Eine recherchierte Firma hat keine. Der Weg
 *    ist damit ausgeschlossen, und zwar nicht „vorläufig".
 *  - **`telefon`** zu einem *Unternehmen* verlangt nach §7 Abs. 2 Nr. 1 UWG nur
 *    die *mutmaßliche* Einwilligung: ein sachlicher Zusammenhang zwischen dem
 *    Angebot und dem Geschäft des Angerufenen. Bei einer Hausverwaltung und
 *    einer Gebäudereinigung ist der denkbar — ob er im Einzelfall trägt, ist
 *    eine Rechtsfrage und keine Programmzeile (O-34).
 *  - **`post`** fällt unter §7 Abs. 2 gar nicht. Werbebriefe an Unternehmen
 *    sind der rechtlich unauffälligste Weg.
 *
 * Deshalb steht `post` an erster Stelle, wenn eine Anschrift bekannt ist.
 */
export function moeglicherKanal(ziel: Ziel): Kanal {
  if (ziel.strasse !== null && ziel.ort !== null) return 'post';
  if (ziel.telefon !== null) return 'telefon';
  return 'post';
}

const KANAL_HINDERNIS: Readonly<Record<Kanal, string>> = {
  email: 'E-Mail-Werbung verlangt nach §7 Abs. 2 Nr. 2 UWG die vorherige '
    + 'ausdrückliche Einwilligung — auch gegenüber Unternehmen. Eine '
    + 'recherchierte Firma hat keine erteilt. Dieser Weg ist nicht offen.',
  telefon: 'Ein Werbeanruf bei einem Unternehmen verlangt nach §7 Abs. 2 Nr. 1 '
    + 'UWG die mutmaßliche Einwilligung. Ob sie hier vorliegt, ist eine '
    + 'Einzelfallbewertung — die Plattform trifft sie nicht (O-34).',
  post: 'Ein Werbebrief an ein Unternehmen fällt nicht unter §7 Abs. 2 UWG und '
    + 'wäre zulässig. Die Plattform lässt ihn heute trotzdem nicht durch: '
    + '`app.darf_kontaktiert_werden` weist jeden Kanal ab, solange die '
    + 'Rechtsgrundlage `keine` ist. Das ist strenger als das Gesetz und eine '
    + 'bewusste Vorsichtsstellung, bis die Rechtsprüfung O-34 entschieden hat.',
};

/*
 * // TODO(client, O-34): Soll postalische Kaltwerbung an Unternehmen möglich
 * // sein? §7 Abs. 2 UWG erfasst sie nicht; die Plattform sperrt sie heute
 * // trotzdem. Eine einzige Zeile in `app.darf_kontaktiert_werden` ist der
 * // Schalter — sie wird erst nach anwaltlicher Prüfung umgelegt.
 */

/** Die Schritte, die aus einem Entwurf eine erlaubte Nachricht machen. */
function schritteFuer(kanal: Kanal): readonly string[] {
  const gemeinsam = [
    'Einen Ansprechpartner anlegen — mit Namen, Funktion und Herkunft der Daten.',
    'Die betroffene Person nach Art. 14 DSGVO binnen eines Monats informieren.',
    'Die Rechtsgrundlage am Kontakt eintragen (§7 UWG, LEG-08).',
  ];
  if (kanal === 'email') {
    return [
      'Dieser Weg ist ohne vorherige ausdrückliche Einwilligung nicht zu öffnen.',
      'Eine Einwilligung kann nur der Kontakt selbst erteilen — nicht die Recherche.',
    ];
  }
  return [...gemeinsam, 'Den Entwurf in die Freigabe geben; senden darf ihn nur ein Mensch.'];
}

/**
 * Der Entwurf.
 *
 * Er nennt **warum diese Firma** angeschrieben wird — aus derselben Begründung,
 * die auch die Punktzahl trägt. Ein Anschreiben, das nicht sagt, warum
 * ausgerechnet dieser Empfänger, ist Massenpost; eines, das es sagt, ist ein
 * Anlass. Die Vermutung wird dabei als Vermutung formuliert („womöglich"), denn
 * niemand hat bei dieser Firma nachgesehen.
 */
export function entwerfe(ziel: Ziel, gesellschaft: Gesellschaft): Entwurf {
  const kanal = moeglicherKanal(ziel);
  const anrede = 'Sehr geehrte Damen und Herren,';

  const anlass = ziel.branche === null
    ? `wir sind ein Berliner Unternehmen für ${gesellschaft.gewerk}.`
    : `wir sind ein Berliner Unternehmen für ${gesellschaft.gewerk} und arbeiten `
      + `regelmäßig für Auftraggeber aus dem Bereich ${ziel.branche}.`;

  const vermutung = ziel.bedarfVermutung === null
    ? 'Womöglich ergibt sich daraus ein Anknüpfungspunkt.'
    : `Womöglich besteht bei Ihnen Bedarf: ${ziel.bedarfVermutung}`;

  const text = [
    anrede,
    '',
    anlass,
    '',
    vermutung,
    '',
    'Wenn Sie mögen, schaue ich mir Ihre Objekte unverbindlich an und melde '
    + 'mich mit einem konkreten Vorschlag. Ein kurzes Telefonat genügt.',
    '',
    'Mit freundlichen Grüßen',
    gesellschaft.name,
  ].join('\n');

  return {
    kanal,
    betreff: `${gesellschaft.gewerk} für ${ziel.firmenname}`,
    text,
    versandMoeglich: false,
    hindernis: KANAL_HINDERNIS[kanal],
    schritte: schritteFuer(kanal),
    erzeugtVon: 'vorlage',
  };
}
