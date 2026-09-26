import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { GeldFehler, parseGeld } from '@/server/services/finanz/geld';
import {
  ProfilFehler, entferneCpv, entferneEmpfaenger, legeProfilAn, schreibeProfil, setzeCpv,
  setzeEmpfaenger, teileListe,
} from '@/server/services/radar/profil';
import type { Wirkung } from '@/server/services/radar/bewertung';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/radar/profil` — ein Suchprofil des Vergaberadars pflegen
 * (RAD-04, RAD-05).
 *
 * **Sechs Handlungen an einer Adresse, weil sie EIN Profil betreffen**: eins
 * anlegen, seine Stammdaten setzen, eine CPV-Zeile anlegen oder ändern, eine
 * entfernen, einen Empfänger eintragen, einen entfernen. Jede geht durch
 * dasselbe Tor (`radar.profil_schreiben`) und durch dieselbe Transaktion —
 * sechs Routen wären sechs Stellen, an denen jemand das `authorize` vergisst.
 *
 * **`anlegen` ist die einzige Handlung ohne Profilkennung** (V-016) und wird
 * deshalb VOR der Kennungsprüfung entschieden. Sie landet danach auf dem
 * Blatt des neuen Profils, nicht auf der Liste: dort steht, was als Nächstes
 * fehlt (CPV, Region, Stichwörter) und warum das Profil noch abgeschaltet
 * ist.
 *
 * **Der Handler bleibt dünn**: prüfen, den Dienst rufen, umleiten. Was ein
 * Profil überhaupt tragen darf, entscheidet `services/radar/profil.ts`; was
 * gesperrt ist (Gewichtung, Benachrichtigungsschwelle, Skala, Währung, die
 * Wirkung der Negativ-Stichwörter), taucht hier nicht einmal als Feldname
 * auf — die offenen Fragen dazu sind O-15, O-47 und O-191.
 *
 * **Und nichts davon rührt eine Bewertung an.** Die Punktzahl entsteht im
 * Nachtlauf, deterministisch, aus `bewertung.ts`. Ein Speichern zählt die
 * Profilfassung hoch (Datenbanktrigger), und der nächste Lauf schreibt eine
 * NEUE Bewertungszeile neben die alte. Diese Route rechnet keine Punkte und
 * löscht keine Bewertung.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const WIRKUNGEN: readonly string[] = ['positiv', 'abzug', 'ausschluss'];

/** Die drei Zustände von `oberhalb_schwellenwert`: ja, nein, gleichgültig. */
function dreiwertig(wert: string | null): boolean | null {
  return wert === 'ja' ? true : wert === 'nein' ? false : null;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const text = (feld: string): string | null => {
    const wert = daten.get(feld);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };

  const profil = text('profil') ?? '';
  const was = text('was') ?? '';
  /*
   * **`anlegen` trägt noch keine Kennung** (V-016) — es erzeugt sie erst. Die
   * Prüfung steht deshalb hinter der Fallunterscheidung und nicht davor; für
   * jede andere Handlung bleibt sie die erste Wand.
   */
  if (was !== 'anlegen' && !UUID.test(profil)) {
    return NextResponse.json({ fehler: 'unbekanntes_profil' }, { status: 400 });
  }

  /*
   * **Der Slug kommt aus der SITZUNG, nicht aus dem Rumpf** (Invariante 3) —
   * dieselbe Stelle, die `/api/agenten/lauf` bereits beseitigt hat.
   *
   * Hier stand ein verstecktes Formularfeld `mandant`, und nur es bestimmte,
   * wohin die 303 zeigte, waehrend geschrieben wurde, was
   * `app.aktiver_mandant()` sagt. Wer den Bereich in einem zweiten Reiter
   * gewechselt hatte, schickte den alten Slug ab: gespeichert wurde in der
   * richtigen Gesellschaft, die Umleitung fuehrte in die andere — und dort
   * findet `leseProfil` das Profil nicht. Ein gegluecktes Speichern endete
   * also auf einem 404.
   *
   * Gelesen wird er in der Transaktion und nach AUSSEN gereicht, damit auch
   * der Fehlerzweig ihn hat: ein Rollback nimmt die Zuweisung an dieser
   * Variablen nicht zurueck. Gesetzt ist sie ab dem Augenblick nach dem
   * `authorize`, und ein `ProfilFehler` kann erst danach entstehen.
   */
  let slug = '';
  /*
   * Die Kennung des EBEN angelegten Profils. Sie steht erst nach dem Dienst
   * fest, und dieselbe Überlegung wie beim Slug gilt auch hier: sie wird
   * ausserhalb der Transaktion gehalten, damit die Umleitung sie hat.
   */
  let angelegt = '';
  const liste = (): string => `/portal/${slug}/radar/profile`;
  /*
   * Wohin zurück: auf das Blatt des neuen Profils, sobald es eines gibt; auf
   * die LISTE, solange ein `anlegen` fehlgeschlagen ist (ein Blatt ohne
   * Kennung gibt es nicht); sonst auf das Blatt, das bearbeitet wurde.
   */
  const seite = (): string => angelegt !== ''
    ? `${liste()}/${angelegt}`
    : was === 'anlegen' ? liste() : `${liste()}/${profil}`;

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'radar.profil_schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [bereich] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (bereich === undefined) throw new NichtGefundenFehler('Bereich ohne Slug');
        slug = bereich.slug;

        if (was === 'anlegen') {
          angelegt = await legeProfilAn(kontext, text('name') ?? '');
          return;
        }

        if (was === 'stammdaten') {
          const min = text('wertMin');
          const max = text('wertMax');
          const frist = text('fristMinTage');
          await schreibeProfil(kontext, profil, {
            name: text('name') ?? '',
            nutsPraefixe: teileListe(text('nuts')),
            positivKeywords: teileListe(text('positiv')),
            negativKeywords: teileListe(text('negativ')),
            wertMinCent: min === null ? null : parseGeld(min),
            wertMaxCent: max === null ? null : parseGeld(max),
            /*
             * `Number.parseInt` und nicht `Number`: ein leeres Feld ist oben
             * schon `null`, und „12 Tage" soll nicht als NaN durchgehen — der
             * Dienst weist alles ab, was keine ganze Zahl ist.
             */
            fristMinTage: frist === null ? null : Number.parseInt(frist, 10),
            oberhalbSchwellenwert: dreiwertig(text('schwellenwert')),
            istAktiv: text('istAktiv') === 'ja',
          });
          return;
        }

        if (was === 'cpv_hinzu') {
          const wirkung = text('wirkung') ?? 'positiv';
          if (!WIRKUNGEN.includes(wirkung)) {
            throw new ProfilFehler('cpv', 'Unbekannte Wirkung für eine CPV-Zeile.');
          }
          const laenge = text('praefixLaenge');
          await setzeCpv(kontext, profil, {
            code: text('cpvCode') ?? '',
            praefixLaenge: laenge === null ? 8 : Number.parseInt(laenge, 10),
            wirkung: wirkung as Wirkung,
            bezeichnung: text('bezeichnung'),
          });
          return;
        }

        if (was === 'cpv_weg') {
          const cpv = text('cpv') ?? '';
          if (!UUID.test(cpv)) throw new ProfilFehler('cpv', 'Keine CPV-Kennung.');
          await entferneCpv(kontext, profil, cpv);
          return;
        }

        if (was === 'empfaenger_hinzu') {
          const benutzer = text('benutzer') ?? '';
          if (!UUID.test(benutzer)) {
            throw new ProfilFehler('empfaenger', 'Kein Konto ausgewählt.');
          }
          await setzeEmpfaenger(kontext, profil, benutzer);
          return;
        }

        if (was === 'empfaenger_weg') {
          const eintrag = text('empfaenger') ?? '';
          if (!UUID.test(eintrag)) {
            throw new ProfilFehler('empfaenger', 'Kein Eintrag ausgewählt.');
          }
          await entferneEmpfaenger(kontext, profil, eintrag);
          return;
        }

        throw new ProfilFehler('gesperrt', 'Unbekannte Handlung.');
      }));
  } catch (fehler) {
    /*
     * Eine abgewiesene EINGABE ist eine Auskunft, kein Serverfehler: die Seite
     * zeigt sie als Satz am Feld. Ein `GeldFehler` ist dasselbe — „1.234,5,6"
     * ist keine Panne der Anwendung.
     */
    if (fehler instanceof ProfilFehler) {
      return NextResponse.redirect(
        internesZiel(`${seite()}?fehler=${fehler.code}`, seite(), anfrage), 303);
    }
    if (fehler instanceof GeldFehler) {
      return NextResponse.redirect(
        internesZiel(`${seite()}?fehler=wert`, seite(), anfrage), 303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(`${seite()}?vermerkt=${encodeURIComponent(was)}`, seite(), anfrage), 303);
}
