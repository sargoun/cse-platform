import { NextResponse, type NextRequest } from 'next/server';
import {
  BezugPasstNichtZumObjekt, istWachbuchArt, schreibeEintrag, WachbuchEingabeFehlt,
  type WachbuchArt,
} from '@/server/services/security/wachbuch';
import { erwarteterUrsprung } from '@/server/auth/ursprung';
import { aufDerSchicht, dienstFehlerAntwort, zurueckZu } from '../../bruecke';

/**
 * `POST /api/mein/schichten/[zuordnungId]/wachbuch` — die Wache schreibt eine
 * Seite (SEC-05, SEC-07, TIM-08, TIM-09, LEG-01, § 34a GewO).
 *
 * **Das Recht ist `wachbuch.schreiben`**, und es steht im Katalog UND an der
 * Rolle `mitarbeiter` (0008). Es wird hier nicht noch einmal abgefragt: die
 * `WITH CHECK`-Haelfte von `wachbuch_eintrag.t_mandant` prueft genau diesen
 * Schluessel, und das ist die Stelle, an der er wirken muss (K-03, AUT-05).
 *
 * **Objekt, Schicht und Urheber kommen aus der SITZUNG** (K-02, Invariante 3).
 * Die Anfrage traegt die Zuordnung im Pfad; Objekt und Einsatz werden daraus
 * abgeleitet, der Mandant ebenfalls, und wer schreibt, loest `schreibeEintrag`
 * selbst ueber `app.aktuelle_person()` auf. Ein `anstellung_id` aus dem
 * Formular waere eine Wachbuchseite, die jemand einem Kollegen unterschiebt.
 *
 * **Warum das ohne 0300 nicht ginge.** `schreibeEintrag` prueft vor dem
 * Schreiben, dass der genannte `einsatz` an DIESEM Objekt haengt — und las
 * dabei `einsatz`, das im M1-Scope `dienstplan.lesen` verlangt. Die Rolle
 * `mitarbeiter` haelt es nicht, die EIGENE Schicht kam mit null Zeilen zurueck,
 * und der Dienst wies den eigenen Eintrag mit „der Bezug gehoert zu einem
 * anderen Objekt" ab. `einsatz.t_selbst_m1` (0300) traegt den Weg — und
 * `schluessel.t_selbst_m1` (0466) denselben fuer den Schluessel (V-180).
 *
 * **Nummer, Serverzeit und Kettenglied schickt diese Route nicht mit.** Sie
 * entstehen in der Datenbank (0070); die Geraetezeit reist als Behauptung mit
 * und wird gespeichert, nie geglaubt (TIM-08).
 *
 * **Eine Abweisung ist eine Seite, kein JSON** (D-599): das Formular ist ein
 * echtes `<form method="post">` auf einem Diensttelefon. Der Grund reist als
 * `?fehler=` auf die Wachbuchseite DIESER Schicht zurueck — die Adresse baut
 * die Route selbst, aus der Zuordnung im Pfad, nicht aus einem Feld.
 */
export const dynamic = 'force-dynamic';

function textOder(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

export async function POST(
  anfrage: NextRequest,
  kontext: { params: Promise<{ zuordnungId: string }> },
): Promise<NextResponse> {
  const { zuordnungId } = await kontext.params;
  const daten = await anfrage.formData();
  const seite = `/portal/mein/schichten/${zuordnungId}/wachbuch`;
  const abgewiesen = (grund: string): NextResponse => {
    const ziel = new URL(seite, erwarteterUrsprung(anfrage));
    ziel.searchParams.set('fehler', grund);
    return NextResponse.redirect(ziel, 303);
  };

  const art = textOder(daten, 'art');
  const betreff = textOder(daten, 'betreff');
  const eintragstext = textOder(daten, 'eintragstext');

  if (art === null || !istWachbuchArt(art)) return abgewiesen('unbekannte_art');
  if (betreff === null) return abgewiesen('kein_betreff');
  // Ein Eintrag ohne Text dokumentiert nichts. Was ist passiert?
  if (eintragstext === null) return abgewiesen('kein_text');

  try {
    const ergebnis = await aufDerSchicht(anfrage, zuordnungId,
      async (k, bezug) => {
        if (bezug.objektId === null) {
          // Ein Wachbuch ist das Buch einer Liegenschaft (§ 34a GewO). Ohne
          // Objekt gibt es keins — und keinen Platz fuer diesen Eintrag.
          return null;
        }
        return schreibeEintrag(k, {
          objektId: bezug.objektId,
          einsatzId: bezug.einsatzId,
          art: art as WachbuchArt,
          betreff,
          eintragstext,
          /*
           * Der Praesenznachweis (SEC-05). Die Kennung kommt aus dem
           * Formular — gepruft wird sie NICHT hier, sondern in
           * `schreibeEintrag`: der Dienst haelt sie gegen das Objekt der
           * Schicht (K-02), wie er es fuer Posten, Veranstaltung und Einsatz
           * schon tut. Ein leeres Feld ist `null` und keine leere Zeichenkette,
           * sonst scheiterte der Cast auf `uuid`.
           */
          kontrollpunktId: textOder(daten, 'kontrollpunkt'),
          /* V-180: der Schluessel — ebenso gegen das Objekt gehalten. */
          schluesselId: textOder(daten, 'schluessel'),
          /*
           * `praesenz` ohne Kontrollpunkt weist `pruefeText` ab (400 mit
           * Grund). Das ist Absicht und wird hier nicht vorweggenommen: eine
           * zweite Pruefung in der Route waere eine zweite Regel, die
           * auseinanderlaufen kann.
           */
          praesenzBestaetigt: daten.get('praesenz') === 'ja',
          polizeiInformiert: daten.get('polizei') === 'ja',
          /*
           * Die Behauptung des Geraets — gespeichert, nie massgeblich
           * (TIM-08, Invariante 5). Ohne JavaScript bleibt das Feld leer, und
           * dann steht in der Zeile keine Geraetezeit: behauptet hat niemand
           * etwas, und eine erfundene waere schlechter als keine.
           */
          geraeteZeit: textOder(daten, 'geraete_zeit'),
          /*
           * Das Haekchen „nachgetragen" (TIM-09, V-078): das Formular dieser
           * Schicht schickt es, diese Route reichte es nie weiter — die Seite
           * stand danach ohne die Aussage der Wache da (V-180, im
           * Vorbeigehen behoben).
           */
          nachgetragen: daten.get('nachgetragen') === '1',
        });
      });
    if (ergebnis.art === 'antwort') return ergebnis.antwort;
    if (ergebnis.wert === null) return abgewiesen('kein_objekt');
  } catch (fehler: unknown) {
    if (fehler instanceof WachbuchEingabeFehlt) return abgewiesen(fehler.grund);
    if (fehler instanceof BezugPasstNichtZumObjekt) return abgewiesen(`fremder_${fehler.tabelle}`);
    const f = fehler as { status?: unknown; code?: unknown };
    if (typeof f.status === 'number' && typeof f.code === 'string' && f.status < 500) {
      return abgewiesen(f.code);
    }
    const antwort = dienstFehlerAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return zurueckZu(daten, seite, anfrage);
}
