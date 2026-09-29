import { NextResponse, type NextRequest } from 'next/server';
import {
  BezugPasstNichtZumObjekt, istWachbuchArt, schreibeEintrag, type WachbuchArt,
} from '@/server/services/security/wachbuch';
import {
  legeWachbuchFotosAb, MedienFehler, MEDIEN_MAX_BYTES, type FormularDatei,
} from '@/server/services/zeit/medien';
import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';
import { internesZiel } from '@/server/auth/ursprung';
import { aufDerSchicht, dienstFehlerAntwort, zurueckZu } from '../../bruecke';
import { grundAufsFormularweg } from '@/app/api/formular-antwort';

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
 * `?fehler=` auf die Wachbuchseite zurueck, und die Seite schlaegt ihn in
 * ihrer Sprache nach — zuerst in ihrer eigenen Tabelle, dann in der des
 * ganzen Portals (`FormularFehler`, D-728). Es ist EIN Weg fuer jede
 * Abweisung dieser Route (zusammengefuehrt, D-692 Nachsatz): der Weg aller
 * Formulare des Portals, `grundAufsFormularweg` — `fehlerweg` vor `zurueck`,
 * und das Formular dieser Seite schickt als `zurueck` sich selbst. Ohne beide
 * Felder ist der Aufrufer ein Programm und bekommt JSON mit Status.
 *
 * **Fotos kommen MIT der Seite** (V-181, SEC-05 „with photos"): das Formular
 * ist `multipart/form-data`, jedes Feld `foto` eine Aufnahme. Sie werden in
 * DERSELBEN Transaktion wie die Seite geprüft, bereinigt und abgelegt
 * (`legeWachbuchFotosAb`); scheitert eine, steht auch die Seite nicht da, und
 * der Grund kommt als `?fehler=` zurück. Die Grösse wird VOR dem Lesen des
 * Rumpfes geprüft — dort gibt es noch keine Felder: die Adresse der
 * Abweisung baut die Route selbst, aus der Zuordnung im Pfad, und ob ein
 * Formular fragt, sagt der Rumpf `multipart/form-data`; ein Programm bekommt
 * JSON mit 413 (wie `…/fotos`, V-198).
 */
export const dynamic = 'force-dynamic';

function textOder(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

/** Die Aufnahmen des Formulars — ein leeres Dateifeld ist keine. */
function fotosAus(daten: FormData): readonly File[] {
  return daten.getAll('foto').filter((f): f is File => f instanceof File && f.size > 0);
}

export async function POST(
  anfrage: NextRequest,
  kontext: { params: Promise<{ zuordnungId: string }> },
): Promise<NextResponse> {
  const { zuordnungId } = await kontext.params;
  const seite = `/portal/mein/schichten/${zuordnungId}/wachbuch`;

  /* Die Grösse VOR dem Lesen — sonst läge die ganze Anfrage schon im Speicher. */
  const angekuendigt = Number(anfrage.headers.get('content-length') ?? '0');
  if (Number.isFinite(angekuendigt) && angekuendigt > MEDIEN_MAX_BYTES) {
    if ((anfrage.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      const ziel = internesZiel(seite, '/portal/mein', anfrage);
      ziel.searchParams.set('fehler', 'foto_zu_gross');
      return NextResponse.redirect(ziel, 303);
    }
    return NextResponse.json({ fehler: 'foto_zu_gross' }, { status: 413 });
  }
  const daten = await anfrage.formData();
  const fotos = fotosAus(daten);

  const art = textOder(daten, 'art');
  const betreff = textOder(daten, 'betreff');
  const eintragstext = textOder(daten, 'eintragstext');

  if (art === null || !istWachbuchArt(art)) {
    return grundAufsFormularweg(anfrage, daten, 'unbekannte_art', 400);
  }
  if (betreff === null) {
    return grundAufsFormularweg(anfrage, daten, 'kein_betreff', 400);
  }
  if (eintragstext === null) {
    // Ein Eintrag ohne Text dokumentiert nichts. Was ist passiert?
    return grundAufsFormularweg(anfrage, daten, 'kein_text', 400);
  }

  try {
    const ergebnis = await aufDerSchicht(anfrage, zuordnungId,
      async (k, bezug) => {
        if (bezug.objektId === null) {
          // Ein Wachbuch ist das Buch einer Liegenschaft (§ 34a GewO). Ohne
          // Objekt gibt es keins — und keinen Platz fuer diesen Eintrag.
          return null;
        }
        const eintragId = await schreibeEintrag(k, {
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
        /*
         * Die Fotos, nach der Seite und in DERSELBEN Transaktion: die
         * Datenbank nimmt ein Foto nur an einer Seite an, die diese
         * Transaktion geschrieben hat (`t_wachbuch_medien`, 0467). Die Bytes
         * werden erst hier gelesen — nach der Pruefung der Schicht.
         */
        const dateien: FormularDatei[] = [];
        for (const foto of fotos) {
          dateien.push({
            daten: new Uint8Array(await foto.arrayBuffer()),
            behaupteterTyp: foto.type === '' ? null : foto.type,
          });
        }
        await legeWachbuchFotosAb(k, { eintragId, dateien }, waehleSpeicher());
        return eintragId;
      }, daten);
    if (ergebnis.art === 'antwort') return ergebnis.antwort;
    if (ergebnis.wert === null) {
      return grundAufsFormularweg(anfrage, daten, 'kein_objekt', 422);
    }
  } catch (fehler: unknown) {
    /*
     * Drei Fehler nennt die Seite unter eigenem Namen (V-180, V-181): woran
     * eine Aufnahme scheiterte (`foto_…`), dass der Speicher fehlt, und
     * welcher Bezug zu einem anderen Objekt gehoert (`fremder_…`) — die
     * Weiche der Schichtwege gaebe dafuer nur einen allgemeinen Code. Alles
     * andere — `WachbuchEingabeFehlt` mit seinem Grund, `KeinUrheber` mit
     * seinem Code — nimmt diese Weiche, auf demselben Weg.
     */
    if (fehler instanceof MedienFehler) {
      return grundAufsFormularweg(anfrage, daten, `foto_${fehler.grund}`,
        fehler.grund === 'zu_gross' ? 413 : fehler.status);
    }
    if (fehler instanceof NichtVerbundenFehler) {
      return grundAufsFormularweg(anfrage, daten, 'speicher_nicht_verbunden', fehler.status);
    }
    if (fehler instanceof BezugPasstNichtZumObjekt) {
      return grundAufsFormularweg(anfrage, daten, `fremder_${fehler.tabelle}`, fehler.status);
    }
    const antwort = dienstFehlerAntwort(fehler, { anfrage, daten });
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return zurueckZu(daten, seite, anfrage);
}
