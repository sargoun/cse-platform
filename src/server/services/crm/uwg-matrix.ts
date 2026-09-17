/**
 * Die Matrix des § 7 UWG — als reines, geprüftes Prädikat (CRM-08, LEG-08,
 * 05-API-KARTE §C.7).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Diese Datei ist NICHT das Tor.** Das Tor ist `app.darf_kontaktiert_werden`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Wer eine Nachricht sendet, fragt die Datenbank — dieselbe Funktion, die
 * auch der Auslöser `kern.uwg_sendetor` fragt. Zwei Formulierungen derselben
 * Regel wären zwei Wahrheiten, und die zweite gewinnt immer dort, wo niemand
 * hinsieht.
 *
 * Warum sie dann existiert: **das Tor und die Vorschrift gehen heute
 * auseinander**, und diese Datei macht die Lücke sichtbar und nachprüfbar,
 * statt sie in einem Kommentar zu behaupten. 05-API-KARTE.md §C.7 führt eine
 * Matrix aus vier Grundlagen und drei Nachrichtenarten; `app.darf_kontaktiert_
 * werden` prüft für `werbung` nur `rechtsgrundlage <> 'keine'`. Es lässt damit
 * zwei Fälle durch, die die Matrix verbietet:
 *
 *  1. `bestandskunde` OHNE `aehnliche_leistung` — § 7 Abs. 3 Nr. 2 UWG
 *     verlangt eigene ÄHNLICHE Waren oder Dienstleistungen (O-95, O-660).
 *  2. `anfrage` — wer angefragt hat, bekommt eine ANTWORT; Werbung ist davon
 *     nicht gedeckt. In der Matrix steht dort ein unbedingtes ✗.
 *
 * Die Oberfläche stellt beide Antworten nebeneinander: die des Tores
 * (**wirksam**) und die dieser Matrix (**noch nicht wirksam**), mit der
 * offenen Nummer daneben. Eine Abweichung, die auf dem Bildschirm steht,
 * wird entschieden; eine, die nur im Quelltext steht, bleibt.
 *
 * // TODO(client, O-660): Soll `app.darf_kontaktiert_werden` auf diese Matrix
 * umgestellt werden — Werbung an `bestandskunde` nur mit `aehnliche_leistung`,
 * Werbung an `anfrage` gar nicht?
 */

/** Die vier Grundlagen des Enums `rechtsgrundlage`. */
export const GRUNDLAGEN = ['keine', 'anfrage', 'bestandskunde', 'einwilligung'] as const;
export type Grundlage = (typeof GRUNDLAGEN)[number];

/**
 * Die drei Nachrichtenarten der Matrix.
 *
 * **Sie sind NICHT die vier Werte von `kommunikationszweck`.** Das Enum der
 * Datenbank führt `vertraglich`, `transaktional`, `werbung`, `intern`; die
 * Matrix der API-Karte führt `antwort_auf_anfrage`, `vertragskommunikation`,
 * `werbung`. Die Abbildung ist nicht eindeutig — `transaktional`
 * (Terminbestätigung, Mahnung) steht in keiner der drei Spalten, und ob es
 * als vertraglich notwendig gilt, ist O-65. Deshalb hat diese Datei ihr
 * eigenes Vokabular und behauptet keine Gleichsetzung, die niemand getroffen
 * hat.
 */
export const ARTEN = ['antwort_auf_anfrage', 'vertragskommunikation', 'werbung'] as const;
export type Nachrichtenart = (typeof ARTEN)[number];

export const KANAELE = ['email', 'telefon', 'sms', 'post', 'whatsapp'] as const;
export type Kanal = (typeof KANAELE)[number];

/** Der Zustand eines Kontakts, so wie die Matrix ihn braucht. */
export interface KontaktLage {
  readonly grundlage: Grundlage;
  /** § 7 Abs. 3 Nr. 2 UWG — eine festgehaltene menschliche Wertung (O-95). */
  readonly aehnlicheLeistung: boolean;
  /** Art. 21 DSGVO — der Vollwiderspruch. Schliesst ALLES aus. */
  readonly widerspruch: boolean;
  /** § 7 Abs. 3 Nr. 3 UWG — nur Werbung ist ausgeschlossen. */
  readonly werbewiderspruch: boolean;
  /** Bei `einwilligung`: worein eingewilligt wurde. */
  readonly einwilligungKanaele: readonly string[];
  /** Wird die Abmeldezeile mitgesendet (§ 7 Abs. 3 Nr. 4 UWG)? */
  readonly abmeldezeileGerendert: boolean;
}

export interface MatrixAntwort {
  readonly erlaubt: boolean;
  /** Der Satz für den Bildschirm — immer gesetzt, auch bei `erlaubt`. */
  readonly grund: string;
  /** Die Fundstelle, damit die Antwort nachprüfbar ist. */
  readonly norm: string;
}

/**
 * Darf an diesen Kontakt eine Nachricht dieser Art über diesen Kanal gehen?
 *
 * Rein, ohne Datenbank, ohne Uhr. Die Reihenfolge der Prüfungen ist die
 * Reihenfolge der Ausschlussgründe, vom stärksten zum schwächsten: der
 * Art.-21-Widerspruch schlägt jede Grundlage, danach die Grundlage selbst,
 * danach die Nebenbedingungen.
 */
export function matrixAntwort(
  lage: KontaktLage, art: Nachrichtenart, kanal: Kanal,
): MatrixAntwort {
  if (lage.widerspruch) {
    return {
      erlaubt: false,
      grund: 'Es liegt ein Widerspruch nach Art. 21 DSGVO vor. Er schliesst jede '
        + 'Verarbeitung zu Werbezwecken aus, unabhängig von der Rechtsgrundlage — '
        + 'und er wird nicht zurückgenommen.',
      norm: 'Art. 21 DSGVO',
    };
  }

  if (art === 'antwort_auf_anfrage') {
    if (lage.grundlage === 'keine') {
      return {
        erlaubt: false,
        grund: 'Ohne aufgezeichnete Grundlage ist auch die Antwort nicht gedeckt: es '
          + 'ist keine Anfrage hinterlegt, auf die geantwortet würde.',
        norm: '§ 7 Abs. 1 UWG',
      };
    }
    return {
      erlaubt: true,
      grund: 'Die Antwort auf eine Anfrage ist keine Werbung — sie ist das, worum '
        + 'gebeten wurde.',
      norm: '§ 7 Abs. 1 UWG',
    };
  }

  if (art === 'vertragskommunikation') {
    if (lage.grundlage === 'bestandskunde' || lage.grundlage === 'einwilligung') {
      return {
        erlaubt: true,
        grund: 'Vertragliche Kommunikation hängt nicht an den Werberegeln: eine '
          + 'Rechnung darf zugestellt werden, auch nach einem Werbewiderspruch.',
        norm: '§ 7 Abs. 1 UWG',
      };
    }
    return {
      erlaubt: false,
      grund: lage.grundlage === 'anfrage'
        ? 'Eine Anfrage begründet noch kein Vertragsverhältnis — vertragliche '
          + 'Kommunikation setzt einen Vertrag voraus.'
        : 'Ohne Vertragsverhältnis gibt es keine vertragliche Kommunikation.',
      norm: '§ 7 Abs. 1 UWG',
    };
  }

  /* Ab hier: `werbung`. */
  if (lage.werbewiderspruch) {
    return {
      erlaubt: false,
      grund: 'Dieser Kontakt hat der Werbung widersprochen. Rechnungen und '
        + 'Terminbestätigungen gehen weiter, Werbung nicht.',
      norm: '§ 7 Abs. 3 Nr. 3 UWG',
    };
  }

  if (lage.grundlage === 'keine') {
    return {
      erlaubt: false,
      grund: 'Es ist keine Grundlage aufgezeichnet. Ohne vorherige ausdrückliche '
        + 'Einwilligung ist elektronische Werbung unzulässig — auch gegenüber '
        + 'Unternehmen.',
      norm: '§ 7 Abs. 2 Nr. 2 UWG',
    };
  }

  if (lage.grundlage === 'anfrage') {
    return {
      erlaubt: false,
      grund: 'Eine Anfrage deckt die ANTWORT darauf, nicht Werbung. Wer angefragt '
        + 'hat, hat damit nicht in Werbung eingewilligt.',
      norm: '§ 7 Abs. 2 Nr. 2 UWG',
    };
  }

  if (lage.grundlage === 'bestandskunde') {
    if (!lage.aehnlicheLeistung) {
      return {
        erlaubt: false,
        grund: '§ 7 Abs. 3 UWG erlaubt Werbung an einen Bestandskunden nur für eigene '
          + 'ÄHNLICHE Waren oder Dienstleistungen. Ob das Angebot eines anderen '
          + 'Geschäftsbereichs darunter fällt, ist eine rechtliche Wertung und steht '
          + 'auf diesem Kontakt nicht fest (offen, O-95).',
        norm: '§ 7 Abs. 3 Nr. 2 UWG',
      };
    }
    if (!lage.abmeldezeileGerendert) {
      return {
        erlaubt: false,
        grund: 'Die Nachricht trägt keinen Hinweis auf das Widerspruchsrecht. Ohne ihn '
          + 'entfällt die Ausnahme des § 7 Abs. 3 UWG vollständig.',
        norm: '§ 7 Abs. 3 Nr. 4 UWG',
      };
    }
    if (kanal !== 'email') {
      return {
        erlaubt: false,
        grund: 'Die Ausnahme des § 7 Abs. 3 UWG gilt für die ELEKTRONISCHE '
          + 'Postadresse. Für Telefon, SMS und WhatsApp trägt sie nicht — dort bleibt '
          + 'es bei der Einwilligung.',
        norm: '§ 7 Abs. 3 UWG',
      };
    }
    return {
      erlaubt: true,
      grund: 'Bestandskunde, ähnliche eigene Leistung festgestellt, kein Widerspruch, '
        + 'Abmeldehinweis vorhanden — alle vier Bedingungen liegen vor.',
      norm: '§ 7 Abs. 3 UWG',
    };
  }

  /* `einwilligung` */
  if (!lage.einwilligungKanaele.includes(kanal)) {
    return {
      erlaubt: false,
      grund: lage.einwilligungKanaele.length === 0
        ? 'Es ist eine Einwilligung hinterlegt, aber kein Kanal. Eine Einwilligung '
          + 'ohne Kanal ist eine Einwilligung in nichts.'
        : `Die Einwilligung gilt für ${lage.einwilligungKanaele.join(', ')} — nicht `
          + `für ${kanal}.`,
      norm: '§ 7 Abs. 2 Nr. 2 UWG',
    };
  }
  return {
    erlaubt: true,
    grund: 'Es liegt eine ausdrückliche Einwilligung für diesen Kanal vor.',
    norm: '§ 7 Abs. 2 Nr. 2 UWG',
  };
}

/**
 * Weicht die Matrix bei diesem Kontakt von der Antwort des Tores ab?
 *
 * Genau die zwei Fälle aus dem Kopf dieser Datei — und `null`, wenn beide
 * dasselbe sagen. Die Oberfläche zeigt den Satz dann neben der Antwort des
 * Tores, damit niemand die schärfere Vorschrift für bereits wirksam hält.
 */
export function abweichungVomTor(lage: KontaktLage): string | null {
  if (lage.widerspruch || lage.werbewiderspruch) return null;
  if (lage.grundlage === 'anfrage') {
    return 'Das wirksame Tor lässt hier Werbung durch, die Matrix des § 7 Abs. 2 '
      + 'UWG nicht: eine Anfrage deckt nur die Antwort darauf (offen, O-660).';
  }
  if (lage.grundlage === 'bestandskunde' && !lage.aehnlicheLeistung) {
    return 'Das wirksame Tor lässt hier Werbung durch, § 7 Abs. 3 Nr. 2 UWG nicht: '
      + 'ohne festgestellte ähnliche eigene Leistung trägt die Ausnahme nicht '
      + '(offen, O-95 / O-660).';
  }
  return null;
}
