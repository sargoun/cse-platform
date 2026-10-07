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
 * Warum sie dann existiert: **sie beurteilt den Kontakt allein, und sie
 * kennt eine Bedingung, die das Tor nicht prüfen kann.** Seit 0524 (V-342,
 * O-660, D-833) folgt das Tor auf den fünf Fernkanälen derselben Matrix:
 * Werbung an `anfrage` nie, an `bestandskunde` nur per E-Mail und nur mit
 * festgestellter ähnlicher eigener Leistung, an `einwilligung` auf den
 * eingewilligten Kanälen. Was zwischen beiden bleibt, zeigt
 * `abweichungenVomTor` — in beide Richtungen:
 *
 * Die Matrix ist strenger beim Hinweis auf das Widerspruchsrecht (§ 7 Abs. 3
 * Nr. 4 UWG). Er hängt an der NACHRICHT, nicht am Kontakt; das Tor prüft ihn
 * nicht, der Versandweg hängt ihn an jede Werbenachricht
 * (`nachricht-an-kontakt.ts`). Auf einem Kontaktblatt ist er nicht
 * feststellbar, und die Matrix antwortet dann „nein".
 *
 * Das TOR ist strenger, wo es Dinge mitfragt, die in der Matrix gar nicht
 * vorkommen: die Firma hinter dem Kontakt (Grundlage, beide Widersprüche,
 * `status = 'gesperrt'`, archiviert) und der Kontakt selbst auf
 * `archiviert_am` / `anonymisiert_am`. Wer diese Hälfte weglässt, zeigt neben
 * dem roten „Abgelehnt" des Tores ein grünes „Bereit" der Matrix — und der
 * Mensch davor liest daraus eine Erlaubnis, die es nicht gibt.
 *
 * Die Oberfläche stellt beide Antworten nebeneinander: die des Tores
 * (**wirksam**) und die dieser Matrix, mit der Fundstelle daneben.
 *
 * // TODO(client, O-660): Voreinstellung — wie gebaut (0524, V-342): Werbung an
 * `anfrage` nie, an `bestandskunde` nur per E-Mail mit festgestellter
 * `aehnliche_leistung`, an `einwilligung` auf den eingewilligten Kanälen; den
 * Abmeldehinweis hängt der Versandweg an jede Werbenachricht. D-793, D-833.
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
 * (Terminbestätigung, Mahnung) steht in keiner der drei Spalten; nach der
 * Voreinstellung (O-65, D-792) ist es vertraglich notwendig, und das Tor lässt
 * es seit 0524 wie die vertragliche Post durch (V-339). Diese Datei behält
 * trotzdem ihr eigenes Vokabular: die Antwort auf eine Anfrage geht am Tor
 * ebenfalls als `vertraglich`, und eine Gleichsetzung hier verwischte das.
 */
export const ARTEN = ['antwort_auf_anfrage', 'vertragskommunikation', 'werbung'] as const;
export type Nachrichtenart = (typeof ARTEN)[number];

export const KANAELE = ['email', 'telefon', 'sms', 'post', 'whatsapp'] as const;
export type Kanal = (typeof KANAELE)[number];

/**
 * Die Ebene des KUNDEN, an dem der Kontakt hängt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Das Tor fragt sie mit, die Matrix der API-Karte kennt sie nicht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `app.darf_kontaktiert_werden` prüft für `werbung` zusätzlich die Firma:
 * `k.rechtsgrundlage <> 'keine' and k.widerspruch_am is null and
 * k.werbewiderspruch_am is null and k.status <> 'gesperrt' and
 * k.archiviert_am is null`. Ohne diese Angaben meldete `abweichungenVomTor`
 * für einen Kontakt mit eigener Einwilligung an einer Firma ohne Grundlage
 * „keine Abweichung" — und auf dem Bildschirm stand ein grünes „Bereit" der
 * Matrix neben dem roten „Abgelehnt" des Tores, ohne einen Satz dazu. Ein
 * Mensch liest daraus „sobald O-660 entschieden ist, darf ich werben",
 * während der Kontakt in Wahrheit gesperrt bleibt.
 */
export interface KundenLage {
  readonly grundlage: Grundlage;
  /** Art. 21 DSGVO am KUNDEN. */
  readonly widerspruch: boolean;
  /** § 7 Abs. 3 Nr. 3 UWG am KUNDEN. */
  readonly werbewiderspruch: boolean;
  /** `kunde.status = 'gesperrt'`. */
  readonly gesperrt: boolean;
  readonly archiviert: boolean;
}

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
  /**
   * Wird die Abmeldezeile mitgesendet (§ 7 Abs. 3 Nr. 4 UWG)?
   *
   * ═════════════════════════════════════════════════════════════════════════
   * **`null` heisst NICHT FESTSTELLBAR — und das ist heute der Normalfall.**
   * ═════════════════════════════════════════════════════════════════════════
   *
   * Geprüft wird ein KONTAKT, keine Nachricht — vom Tor ebenso wie hier;
   * deshalb prüft das Tor diese Bedingung gar nicht. Der Versandweg ist gebaut
   * (`POST /api/crm/nachrichten`, V-101) und hängt an jede Werbenachricht den
   * Hinweis nach § 7 Abs. 3 Nr. 4 UWG (`mitPflichthinweis`); ein Versender ist
   * aber nicht verbunden, also geht keine hinaus. Der frühere Vorgabewert
   * `true` bejahte die Vorschrift für eine Nachricht, die es nicht gibt — eine
   * Annahme im Code, die auf dem Bildschirm als Rechtsauskunft erschien.
   * Deshalb ist der Wert Pflicht und `null` eine zulässige, sichtbare Antwort.
   */
  readonly abmeldezeileGerendert: boolean | null;
  /** `ansprechpartner.archiviert_am is not null` — das Tor sperrt dann. */
  readonly archiviert: boolean;
  /** `ansprechpartner.anonymisiert_am is not null` — das Tor sperrt dann. */
  readonly anonymisiert: boolean;
  /** Die Firma dahinter — `null`, wenn der Kontakt an keiner hängt. */
  readonly kunde: KundenLage | null;
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
    // TODO(client, O-95): Voreinstellung — ähnlich ist nur eine eigene Leistung
    // derselben Gesellschaft für denselben Bedarf; ein Mensch stellt es fest und
    // begründet es, Vorgabe „nein" (D-802).
    if (!lage.aehnlicheLeistung) {
      return {
        erlaubt: false,
        grund: '§ 7 Abs. 3 UWG erlaubt Werbung an einen Bestandskunden nur für eigene '
          + 'ÄHNLICHE Waren oder Dienstleistungen. Auf diesem Kontakt ist die '
          + 'Ähnlichkeit nicht festgestellt (Voreinstellung O-95: ähnlich ist nur '
          + 'eine eigene Leistung derselben Gesellschaft für denselben Bedarf, das '
          + 'Angebot einer anderen Gesellschaft der Gruppe nie).',
        norm: '§ 7 Abs. 3 Nr. 2 UWG',
      };
    }
    if (lage.abmeldezeileGerendert !== true) {
      return {
        erlaubt: false,
        grund: lage.abmeldezeileGerendert === null
          ? 'Ob die Nachricht einen Hinweis auf das Widerspruchsrecht trägt, ist hier '
            + 'nicht feststellbar: geprüft wird ein Kontakt, keine Nachricht, und ein '
            + 'Versender ist nicht verbunden. Ohne diesen Hinweis entfällt die Ausnahme '
            + 'des § 7 Abs. 3 UWG vollständig — die Antwort bleibt deshalb „nein", bis '
            + 'eine Nachricht vorliegt, die ihn trägt.'
          : 'Die Nachricht trägt keinen Hinweis auf das Widerspruchsrecht. Ohne ihn '
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
 * Wo laufen Matrix und wirksames Tor auseinander — in BEIDE Richtungen?
 *
 * Seit 0524 (V-342) nur noch an zwei Stellen: am Abmeldehinweis, den das Tor
 * nicht prüfen kann (Matrix strenger), und an der Ebene des Kunden und den
 * Sperrmerkmalen des Kontakts, die die Matrix nicht kennt (Tor strenger).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der frühere Stand nannte nur eine Richtung, und das war die gefährliche
 * Hälfte.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Er prüfte allein die Ebene des Ansprechpartners und meldete dort, wo das
 * Tor MEHR durchlässt als die Vorschrift. Das Tor ist aber an anderen Stellen
 * STRENGER: es fragt die Firma mit (Grundlage, beide Widersprüche, Sperre,
 * archiviert) und den Kontakt auf `archiviert_am`/`anonymisiert_am`. In allen
 * diesen Fällen sperrte das Tor, die Matrix erlaubte, und hier stand `null` —
 * auf dem Bildschirm ein grünes „Bereit" neben einem roten „Abgelehnt", unter
 * einer Überschrift, die die Matrix als die erst noch einzuschaltende,
 * SCHÄRFERE Fassung rahmt. Wer das liest, wartet auf O-660 und werbt danach
 * an einen Kontakt, der aus einem ganz anderen Grund gesperrt ist.
 *
 * **Die Sätze behaupten nie, was das Tor TUT.** Sie sagen, was die jeweilige
 * Regel prüft und was die andere nicht prüft. Das Tor selbst wird gefragt,
 * nicht nachformuliert (siehe Kopf dieser Datei) — auch hier nicht.
 */
export type Abweichungsrichtung = 'tor_strenger' | 'matrix_strenger';

export interface Abweichung {
  /**
   * `tor_strenger`   — das wirksame Tor sperrt aus einem Grund, den die
   *                    Matrix der API-Karte gar nicht kennt.
   * `matrix_strenger`— die Matrix verbietet, was das Tor nicht prüfen kann:
   *                    den Abmeldehinweis einer Nachricht (§ 7 Abs. 3 Nr. 4).
   */
  readonly richtung: Abweichungsrichtung;
  readonly text: string;
  readonly norm: string;
}

export function abweichungenVomTor(lage: KontaktLage): readonly Abweichung[] {
  const liste: Abweichung[] = [];

  /* ---------------------------------------- Das Tor ist STRENGER als die Matrix */

  if (lage.anonymisiert) {
    liste.push({
      richtung: 'tor_strenger',
      text: 'Dieser Kontakt ist anonymisiert. Das wirksame Tor sperrt ihn deshalb für '
        + 'jeden Zweck; die Matrix des § 7 UWG kennt dieses Merkmal nicht.',
      norm: 'Art. 17 DSGVO',
    });
  } else if (lage.archiviert) {
    liste.push({
      richtung: 'tor_strenger',
      text: 'Dieser Kontakt ist archiviert. Das wirksame Tor sperrt ihn deshalb; die '
        + 'Matrix des § 7 UWG kennt dieses Merkmal nicht.',
      norm: 'app.darf_kontaktiert_werden',
    });
  }

  const k = lage.kunde;
  if (k !== null) {
    if (k.grundlage === 'keine') {
      liste.push({
        richtung: 'tor_strenger',
        text: 'Die Firma, an der dieser Kontakt hängt, hat selbst KEINE '
          + 'Rechtsgrundlage. Das wirksame Tor verlangt sie zusätzlich zur Grundlage '
          + 'des Kontakts und sperrt deshalb hier — auch wenn am Kontakt eine '
          + 'Einwilligung steht. Die Matrix beurteilt nur den Kontakt.',
        norm: '§ 7 Abs. 1 UWG',
      });
    }
    if (k.widerspruch) {
      liste.push({
        richtung: 'tor_strenger',
        text: 'An der Firma liegt ein Widerspruch nach Art. 21 DSGVO vor. Das '
          + 'wirksame Tor sperrt damit auch diesen Kontakt; die Matrix beurteilt nur '
          + 'den Kontakt.',
        norm: 'Art. 21 DSGVO',
      });
    }
    if (k.werbewiderspruch) {
      liste.push({
        richtung: 'tor_strenger',
        text: 'Die Firma hat der Werbung widersprochen. Das wirksame Tor sperrt damit '
          + 'auch diesen Kontakt; die Matrix beurteilt nur den Kontakt.',
        norm: '§ 7 Abs. 3 Nr. 3 UWG',
      });
    }
    if (k.gesperrt) {
      liste.push({
        richtung: 'tor_strenger',
        text: 'Die Firma steht auf „gesperrt". Das wirksame Tor lässt an einen '
          + 'gesperrten Kunden keine Werbung; die Matrix des § 7 UWG kennt diesen '
          + 'Zustand nicht.',
        norm: 'app.darf_kontaktiert_werden',
      });
    }
    if (k.archiviert) {
      liste.push({
        richtung: 'tor_strenger',
        text: 'Die Firma ist archiviert. Das wirksame Tor sperrt deshalb; die Matrix '
          + 'des § 7 UWG kennt dieses Merkmal nicht.',
        norm: 'app.darf_kontaktiert_werden',
      });
    }
  }

  /* --------------------------------------- Die MATRIX ist strenger als das Tor */

  /*
   * Seit 0524 (V-342) prüft das Tor die Matrix selbst — Anfrage, ähnliche
   * Leistung und Kanal stehen dort. Es bleibt die eine Bedingung, die an der
   * NACHRICHT hängt: der Hinweis auf das Widerspruchsrecht. Ein Widerspruch
   * am Kontakt sperrt in BEIDEN — dann gibt es hier nichts zu melden.
   */
  if (!lage.widerspruch && !lage.werbewiderspruch && lage.grundlage === 'bestandskunde'
      && lage.aehnlicheLeistung && lage.abmeldezeileGerendert !== true) {
    liste.push({
      richtung: 'matrix_strenger',
      text: lage.abmeldezeileGerendert === null
        ? 'Ob eine Nachricht den Hinweis auf das Widerspruchsrecht trüge, ist hier nicht '
          + 'feststellbar — geprüft wird ein Kontakt, keine Nachricht. Die Matrix antwortet '
          + 'deshalb „nein"; das Tor prüft den Hinweis nicht, weil der Versandweg ihn an jede '
          + 'Werbenachricht hängt.'
        : 'Die Nachricht trägt keinen Hinweis auf das Widerspruchsrecht. Die Matrix verbietet '
          + 'sie deshalb; das Tor prüft diesen Hinweis nicht — er hängt an der Nachricht, '
          + 'nicht am Kontakt.',
      norm: '§ 7 Abs. 3 Nr. 4 UWG',
    });
  }

  return liste;
}
