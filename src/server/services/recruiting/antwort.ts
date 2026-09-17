/**
 * Die Antwort an eine Bewerberin (REC-03, § 22 AGG, Invariante 7).
 *
 * **Die Kette in einem Satz:** ein Entwurf entsteht (von Hand oder vom
 * Agenten), ein Mensch liest ihn, gibt ihn frei — und erst dann geht er
 * hinaus, sofern ein Postausgang verbunden ist. Heute ist keiner verbunden
 * (O-501), und dieser Dienst sagt das, statt es zu verschweigen.
 *
 * **Warum eine Antwort an eine Bewerberin NICHT durch das UWG-Tor geht.**
 * §7 UWG regelt Werbung. Eine Bewerbung ist eine Kontaktaufnahme DURCH die
 * betroffene Person; die Antwort darauf ist vorvertragliche Kommunikation
 * (Art. 6 Abs. 1 lit. b DSGVO). Sie durch `app.darf_kontaktiert_werden` zu
 * schicken hiesse, eine Absage zu blockieren, weil kein Werbeeinverständnis
 * vorliegt — und eine unbeantwortete Bewerbung ist kein Datenschutz, sondern
 * Unhöflichkeit mit AGG-Risiko.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Eine Absage nennt keinen Grund. Das ist die wichtigste Regel dieser Datei.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * § 22 AGG kehrt die Beweislast um: wer Indizien für eine Benachteiligung
 * vorträgt, zwingt den Arbeitgeber zum Gegenbeweis. Jede Begründung in einem
 * Absageschreiben ist ein solches Indiz in spe — „wir suchen jemanden mit mehr
 * Berufserfahrung" ist in der Hand eines Anwalts ein Altersindiz.
 *
 * Die Begründung verschwindet deshalb nicht, sie wandert: sie steht in
 * `einstellungsentscheidung.begruendung`, wo sie im Streitfall den sachlichen
 * Grund BELEGT, und nicht im Brief, wo sie ihn ANGREIFBAR macht. Der Auslöser
 * `kern.absage_ohne_grund` (0174) weist einen Antworttext ab, der die interne
 * Begründung übernommen hat — denn der gefährliche Weg ist nicht die Vorlage,
 * sondern der Mensch, der aus Höflichkeit „ein" ergänzt.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { EmailNichtVerbundenFehler, type EmailDienst } from '../../versand/email.js';
import { jcsDigest } from '../freigabe/kette.js';
import { RecruitingFehler } from './dienst.js';

export type AntwortArt = 'eingangsbestaetigung' | 'einladung' | 'absage' | 'rueckfrage';
export type AntwortStand =
  'entwurf' | 'wartet_auf_freigabe' | 'freigegeben' | 'gesendet' | 'verworfen';

export const ANTWORT_ARTEN: readonly AntwortArt[] = [
  'eingangsbestaetigung', 'einladung', 'absage', 'rueckfrage',
];

export const ART_TEXT: Readonly<Record<AntwortArt, string>> = {
  eingangsbestaetigung: 'Eingangsbestätigung',
  einladung: 'Einladung zum Gespräch',
  absage: 'Absage',
  rueckfrage: 'Rückfrage zu den Unterlagen',
};

export interface Antwort {
  readonly id: string;
  readonly bewerbungId: string;
  readonly art: AntwortArt;
  readonly stand: AntwortStand;
  readonly betreff: string;
  readonly text: string;
  readonly entworfenVon: 'mensch' | 'agent' | 'system';
  readonly freigabeId: string | null;
  readonly freigegebenAm: Date | null;
  readonly gesendetAm: Date | null;
  readonly gesendetAn: string | null;
  readonly versandFehler: string | null;
}

/**
 * Die Vorlagen.
 *
 * `{name}` und `{stelle}` sind die einzigen Platzhalter, und sie kommen aus
 * der Bewerbung — nicht aus einem Modell. Ein Modell darf diesen Text später
 * verbessern (das ist Formulieren, nicht Rechnen, Invariante 6); die Vorlage
 * bleibt der Rückfallweg, damit ein nicht erreichbares Modell keinen leeren
 * Brief erzeugt.
 *
 * **Die Absage ist absichtlich der kürzeste Text.** Jeder zusätzliche Satz
 * ist eine Gelegenheit, einen Grund zu nennen.
 */
const VORLAGE: Readonly<Record<AntwortArt, { betreff: string; text: string }>> = {
  eingangsbestaetigung: {
    betreff: 'Ihre Bewerbung als {stelle}',
    text: 'Guten Tag {name},\n\n'
      + 'vielen Dank für Ihre Bewerbung als {stelle}. Sie ist bei uns eingegangen '
      + 'und wird gerade gesichtet.\n\n'
      + 'Wir melden uns, sobald wir sie durchgesehen haben. Bis dahin brauchen '
      + 'Sie nichts weiter zu tun.\n\n'
      + 'Freundliche Grüße\n{gesellschaft}',
  },
  einladung: {
    betreff: 'Einladung zum Gespräch — {stelle}',
    text: 'Guten Tag {name},\n\n'
      + 'wir haben Ihre Bewerbung als {stelle} gelesen und würden Sie gern '
      + 'kennenlernen.\n\n'
      + 'Bitte sagen Sie uns, wann es Ihnen passt — wir richten uns nach Ihnen. '
      + 'Das Gespräch dauert etwa eine Stunde.\n\n'
      + 'Freundliche Grüße\n{gesellschaft}',
  },
  absage: {
    betreff: 'Ihre Bewerbung als {stelle}',
    /*
     * Vier Sätze, und keiner davon nennt einen Grund. Der Satz „Ihre Unterlagen
     * löschen wir nach Ablauf der Aufbewahrungsfrist" steht nicht aus
     * Höflichkeit da: Art. 13/14 DSGVO verlangt die Information über die
     * Speicherdauer, und eine Absage ist der letzte Moment, in dem sie die
     * Person erreicht.
     */
    text: 'Guten Tag {name},\n\n'
      + 'vielen Dank für Ihre Bewerbung als {stelle} und für die Zeit, die Sie '
      + 'sich dafür genommen haben.\n\n'
      + 'Wir haben uns für eine andere Bewerbung entschieden.\n\n'
      + 'Ihre Unterlagen löschen wir nach Ablauf der Aufbewahrungsfrist. Wir '
      + 'wünschen Ihnen für Ihren weiteren Weg alles Gute.\n\n'
      + 'Freundliche Grüße\n{gesellschaft}',
  },
  rueckfrage: {
    betreff: 'Rückfrage zu Ihrer Bewerbung als {stelle}',
    text: 'Guten Tag {name},\n\n'
      + 'vielen Dank für Ihre Bewerbung als {stelle}. Für die weitere Prüfung '
      + 'fehlen uns noch Unterlagen.\n\n'
      + 'Bitte senden Sie uns: {offen}\n\n'
      + 'Freundliche Grüße\n{gesellschaft}',
  },
};

export interface EntwurfEingabe {
  readonly bewerbungId: string;
  readonly art: AntwortArt;
  /** Nur bei `rueckfrage`: was fehlt. Sonst ignoriert. */
  readonly offen?: string | undefined;
}

interface BewerbungKopf {
  name: string; email: string; stelle_titel: string | null; gesellschaft: string;
  status: string; geloescht_am: Date | null;
}

async function kopf(
  kontext: LeseKontext, bewerbungId: string,
): Promise<BewerbungKopf> {
  const [b] = await kontext.abfrage<BewerbungKopf>(
    `select b.name, b.email, s.titel as stelle_titel, m.name as gesellschaft,
            b.status::text as status, b.geloescht_am
       from bewerbung b
       join mandant m on m.id = b.mandant_id
       left join stelle s on s.id = b.stelle_id
      where b.id = $1::uuid and b.mandant_id = app.aktiver_mandant()`,
    [bewerbungId]);
  if (b === undefined) {
    throw new RecruitingFehler('Diese Bewerbung gibt es nicht.', 'unbekannt', 404);
  }
  /*
   * Eine geloeschte Bewerbung traegt „geloescht (Frist abgelaufen)" als Namen
   * und `geloescht@example.invalid` als Adresse (REC-07). Ein Brief dorthin
   * waere an niemanden — und eine Anrede mit diesem Namen waere ein schlechter
   * Scherz.
   */
  if (b.geloescht_am !== null) {
    throw new RecruitingFehler(
      'Diese Bewerbung ist nach Ablauf der Aufbewahrungsfrist gelöscht. '
      + 'Es gibt niemanden mehr, dem geantwortet werden könnte.',
      'geloescht', 409);
  }
  return b;
}

function fuelle(vorlage: string, werte: Readonly<Record<string, string>>): string {
  /*
   * Ein Platzhalter OHNE Wert bleibt stehen und faellt auf. Er wird nicht
   * stillschweigend leer — ein Brief mit „Guten Tag ," ginge sonst hinaus und
   * niemand wuesste, wo der Name geblieben ist.
   */
  return vorlage.replaceAll(/\{(\w+)\}/gu, (treffer, schluessel: string) =>
    werte[schluessel] ?? treffer);
}

/**
 * Einen Entwurf anlegen.
 *
 * **Er geht NICHT automatisch in die Freigabe.** Anlegen und vorlegen sind
 * zwei Handlungen, und zwischen ihnen liegt der Moment, in dem ein Mensch den
 * Text liest. Wer beides zusammenlegte, hätte einen Posteingang voller
 * Vorlagen, die niemand gelesen hat — und der erste, der sie durchklickt,
 * gewöhnt sich das Lesen ab.
 */
export async function entwirf(
  kontext: SchreibKontext, eingabe: EntwurfEingabe,
): Promise<string> {
  const b = await kopf(kontext, eingabe.bewerbungId);
  const v = VORLAGE[eingabe.art];

  const werte: Record<string, string> = {
    name: b.name,
    stelle: b.stelle_titel ?? 'Initiativbewerbung',
    gesellschaft: b.gesellschaft,
  };
  if (eingabe.art === 'rueckfrage') {
    const offen = eingabe.offen?.trim() ?? '';
    if (offen === '') {
      throw new RecruitingFehler(
        'Eine Rückfrage ohne die Angabe, was fehlt, ist keine Rückfrage.',
        'unvollstaendig', 400);
    }
    werte['offen'] = offen;
  }

  let z: { id: string } | undefined;
  try {
    [z] = await kontext.schreibe<{ id: string }>(
      `insert into bewerbung_antwort
         (mandant_id, bewerbung_id, art, betreff, text, entworfen_von, entworfen_durch)
       values (app.aktiver_mandant(), $1::uuid, $2::bewerbung_antwort_art, $3, $4,
               'mensch', $5::uuid)
       returning id`,
      [eingabe.bewerbungId, eingabe.art,
        fuelle(v.betreff, werte), fuelle(v.text, werte), kontext.benutzerId]);
  } catch (fehler: unknown) {
    if ((fehler as { code?: string }).code === '23505') {
      throw new RecruitingFehler(
        `Es gibt für diese Bewerbung schon eine ${ART_TEXT[eingabe.art]}. `
        + 'Zwei Absagen an dieselbe Person sind eine zu viel.',
        'schon_vorhanden', 409);
    }
    throw fehler;
  }
  if (z === undefined) {
    throw new RecruitingFehler('Der Entwurf wurde nicht angelegt.', 'kein_schreibrecht', 403);
  }
  return z.id;
}

/** Den Text ändern, solange er Entwurf ist. Der AGG-Riegel prüft mit (0174). */
export async function aendere(
  kontext: SchreibKontext, id: string, betreff: string, text: string,
): Promise<void> {
  if (betreff.trim() === '' || text.trim() === '') {
    throw new RecruitingFehler(
      'Betreff und Text gehören beide dazu.', 'unvollstaendig', 400);
  }
  const geaendert = await kontext.schreibe<{ id: string }>(
    `update bewerbung_antwort set betreff = $2, text = $3
      where id = $1::uuid and mandant_id = app.aktiver_mandant() and stand = 'entwurf'
      returning id`,
    [id, betreff.trim(), text.trim()]);
  if (geaendert[0] === undefined) {
    throw new RecruitingFehler(
      'Diesen Entwurf gibt es nicht — oder er liegt schon zur Freigabe und lässt '
      + 'sich nicht mehr ändern. Wer nach der Freigabe den Text ändert, hat für '
      + 'das, was hinausgeht, keine Freigabe mehr.',
      'falscher_status', 409);
  }
}

/**
 * Vorlegen — der Entwurf geht in den Freigabe-Posteingang.
 *
 * `erforderliches_recht` ist `recruiting.entscheiden` und nicht
 * `recruiting.bewerbung_bewerten`: den Text schreiben darf, wer bewertet; ihn
 * hinausgehen lassen darf nur, wer entscheidet. Eine Absage IST die
 * Entscheidung, aus Sicht der Empfängerin.
 */
export async function legeVor(kontext: SchreibKontext, id: string): Promise<string> {
  const [a] = await kontext.abfrage<{
    bewerbung_id: string; art: AntwortArt; betreff: string; text: string; stand: string;
    freigabe_id: string | null;
  }>(
    `select bewerbung_id, art::text as art, betreff, text, stand::text as stand, freigabe_id
       from bewerbung_antwort
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
      for update`, [id]);
  if (a === undefined) {
    throw new RecruitingFehler('Diesen Entwurf gibt es nicht.', 'unbekannt', 404);
  }
  if (a.stand !== 'entwurf') {
    throw new RecruitingFehler(
      'Vorgelegt wird ein Entwurf. Was schon zur Freigabe liegt oder hinaus ist, '
      + 'geht nicht noch einmal durch dieselbe Entscheidung.', 'falscher_status', 409);
  }

  const b = await kopf(kontext, a.bewerbung_id);
  const nutzlast = {
    antwort_id: id,
    bewerbung_id: a.bewerbung_id,
    art: a.art,
    empfaenger: b.email,
    betreff: a.betreff,
    text: a.text,
  };

  const [f] = await kontext.schreibe<{ id: string }>(
    `insert into freigabe
       (mandant_id, aktion, status, vorgang_typ, titel, zusammenfassung, risiko,
        diff, vorschau_payload, payload_hash, bezug_typ, bezug_id, erstellt_von,
        erforderliches_recht)
     values (app.aktiver_mandant(), 'bewerbung_antworten', 'offen',
             'bewerbung_antwort_entwurf', $1, $2, 'mittel'::risiko_stufe,
             '[]'::jsonb, $3::jsonb, $4, 'bewerbung', $5::uuid, $6::uuid,
             'recruiting.entscheiden')
     returning id`,
    [`${ART_TEXT[a.art]}: ${b.name}`,
      `${ART_TEXT[a.art]} an ${b.name} (${b.email}). Der Text geht erst nach `
      + 'dieser Freigabe hinaus — und nur, wenn ein Postausgang verbunden ist.',
      nutzlast, jcsDigest(nutzlast), a.bewerbung_id, kontext.benutzerId]);
  if (f === undefined) {
    throw new RecruitingFehler('Die Freigabe wurde nicht angelegt.', 'kein_schreibrecht', 403);
  }

  await kontext.schreibe(
    `update bewerbung_antwort set stand = 'wartet_auf_freigabe', freigabe_id = $2::uuid
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
    [id, f.id]);
  return f.id;
}

export async function liste(
  kontext: LeseKontext, bewerbungId: string,
): Promise<readonly Antwort[]> {
  const zeilen = await kontext.abfrage<{
    id: string; bewerbung_id: string; art: AntwortArt; stand: AntwortStand;
    betreff: string; text: string; entworfen_von: 'mensch' | 'agent' | 'system';
    freigabe_id: string | null; freigegeben_am: Date | null; gesendet_am: Date | null;
    gesendet_an: string | null; versand_fehler: string | null;
  }>(
    `select id, bewerbung_id, art::text as art, stand::text as stand, betreff, text,
            entworfen_von::text as entworfen_von, freigabe_id, freigegeben_am,
            gesendet_am, gesendet_an, versand_fehler
       from bewerbung_antwort
      where mandant_id = app.aktiver_mandant() and bewerbung_id = $1::uuid
      order by erstellt_am`,
    [bewerbungId]);

  return zeilen.map((z) => ({
    id: z.id, bewerbungId: z.bewerbung_id, art: z.art, stand: z.stand,
    betreff: z.betreff, text: z.text, entworfenVon: z.entworfen_von,
    freigabeId: z.freigabe_id, freigegebenAm: z.freigegeben_am,
    gesendetAm: z.gesendet_am, gesendetAn: z.gesendet_an,
    versandFehler: z.versand_fehler,
  }));
}

/**
 * Senden — der einzige Schritt, der wirklich hinausgeht.
 *
 * **Er verlangt DREI Dinge, und keines davon ist verhandelbar:**
 *
 *  1. Der Entwurf steht auf `freigegeben` — also hat ein Mensch entschieden
 *     (Invariante 7). Der Stand kommt vom Auslöser `freigabe_zieht_antwort_nach`
 *     und nicht von diesem Dienst; er kann ihn nicht selbst setzen.
 *  2. Eine Empfängeradresse, die zu DIESER Bewerbung gehört. Sie wird frisch
 *     gelesen und nicht aus der Nutzlast der Freigabe übernommen: was vor drei
 *     Tagen in der Vorschau stand, gilt heute vielleicht nicht mehr — und die
 *     Adresse ist das eine Feld, bei dem „veraltet" heisst: an die falsche
 *     Person.
 *  3. Einen verbundenen Postausgang. Heute gibt es keinen (O-501), und dann
 *     passiert genau das Richtige: NICHTS geht hinaus, `versand_fehler` trägt
 *     den Grund im Klartext, und der Stand bleibt `freigegeben`. Beim nächsten
 *     Versuch — mit Anbieter — geht dieselbe Zeile hinaus.
 *
 * **Warum der Fehler nicht geworfen, sondern GESCHRIEBEN wird.** Ein
 * geworfener Fehler rollt die Transaktion zurück, und dann steht in der
 * Datenbank nichts darüber, dass jemand es versucht hat. Der Personalbereich
 * sähe eine freigegebene Absage ohne jede Spur — und probierte es morgen
 * wieder, mit demselben Ergebnis und derselben Ratlosigkeit.
 */
export async function sende(
  kontext: SchreibKontext, id: string, post: EmailDienst,
): Promise<{ readonly gesendet: boolean; readonly meldung: string }> {
  const [a] = await kontext.abfrage<{
    bewerbung_id: string; art: AntwortArt; betreff: string; text: string; stand: string;
  }>(
    `select bewerbung_id, art::text as art, betreff, text, stand::text as stand
       from bewerbung_antwort
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
      for update`, [id]);
  if (a === undefined) {
    throw new RecruitingFehler('Diesen Entwurf gibt es nicht.', 'unbekannt', 404);
  }
  if (a.stand === 'gesendet') {
    throw new RecruitingFehler(
      'Diese Antwort ist bereits hinausgegangen. Zweimal dieselbe Absage ist eine '
      + 'zu viel.', 'schon_gesendet', 409);
  }
  if (a.stand !== 'freigegeben') {
    throw new RecruitingFehler(
      'Hinaus geht nur, was ein Mensch freigegeben hat (Invariante 7). Dieser '
      + `Entwurf steht auf „${a.stand}".`, 'nicht_freigegeben', 409);
  }

  const b = await kopf(kontext, a.bewerbung_id);

  try {
    await post.sende({ an: b.email, betreff: a.betreff, text: a.text });
  } catch (fehler: unknown) {
    const meldung = fehler instanceof EmailNichtVerbundenFehler
      ? fehler.message
      : `Der Versand ist gescheitert: ${fehler instanceof Error ? fehler.message : 'unbekannt'}`;
    await kontext.schreibe(
      `update bewerbung_antwort set versand_fehler = $2
        where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
      [id, meldung]);
    return { gesendet: false, meldung };
  }

  /*
   * **`zeigtInhalt` unterscheidet die Entwicklungsfläche vom Betrieb.** Der
   * Entwicklungsdienst nimmt jede Mail an und verschickt keine. Eine Zeile
   * `gesendet_am` zu schreiben, weil er nicht geworfen hat, wäre genau die
   * Falschaussage, gegen die dieser ganze Dienst gebaut ist: der Personalbereich
   * läse „zugestellt", und die Bewerberin wartete.
   */
  if (!post.verbunden) {
    const meldung = `Kein Versand: „${post.name}" nimmt Nachrichten an, verschickt aber `
      + 'keine (O-501). Die Antwort bleibt freigegeben und ungesendet.';
    await kontext.schreibe(
      `update bewerbung_antwort set versand_fehler = $2
        where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
      [id, meldung]);
    return { gesendet: false, meldung };
  }

  await kontext.schreibe(
    `update bewerbung_antwort
        set stand = 'gesendet', gesendet_am = now(), gesendet_an = $2,
            versand_fehler = null
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
    [id, b.email]);
  return { gesendet: true, meldung: `Gesendet an ${b.email}.` };
}
