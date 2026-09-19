import 'server-only';
import type { Kanal, KanalPraeferenz } from './registry.js';

/**
 * **Kein `LeseKontext`, kein `SchreibKontext` — und das ist eine Aussage.**
 *
 * Beide tragen `aktiverMandantId`, der Schreibkontext sogar als `string`:
 * „im Schreibkontext ist er nie NULL, das ist der ganze Unterschied"
 * (Invariante 10). Der Posteingang ist aber PERSOENLICH und nicht
 * mandantengebunden — in der Gruppenansicht gibt es keinen aktiven Bereich,
 * und eine Benachrichtigung dort als gelesen zu stempeln ist trotzdem
 * richtig. Ein Schreibkontext an dieser Stelle waere ein Typ, der das
 * Gegenteil behauptet.
 *
 * Die Eingrenzung leistet RLS: `t_benachrichtigung_eigene` und
 * `t_benachrichtigung_lesen_setzen` binden jede Zeile an
 * `empfaenger_id = app.aktueller_benutzer()`.
 */
export interface Leser {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface Schreiber extends Leser {
  schreibe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/**
 * Der Posteingang, den ein Mensch im Portal sieht (NOT-01), und die
 * Einstellung, mit der er ihn steuert (NOT-02).
 *
 * **Was hier NICHT steht: eine Rechtepruefung.** Der Posteingang ist
 * persoenlich, und die Policy sagt es: `empfaenger_id =
 * app.aktueller_benutzer()`. Ein Recht davor hiesse, dass jemand eine
 * Mitteilung bekommen kann, die er nicht ansehen darf.
 *
 * **Und keine harte Loeschung.** Gelesen wird gestempelt, nicht entfernt: der
 * Posteingang ist das Protokoll dessen, was jemandem mitgeteilt wurde, und
 * „ich habe nichts bekommen" laesst sich sonst weder bestaetigen noch
 * widerlegen.
 */

export interface Eintrag {
  readonly id: string;
  readonly art: string;
  readonly titel: string;
  readonly text: string;
  readonly ziel: string;
  readonly objektTyp: string;
  readonly objektId: string | null;
  readonly gelesenAm: Date | null;
  readonly erstelltAm: Date;
  readonly mandantSlug: string | null;
  readonly mandantName: string | null;
}

interface Zeile {
  id: string;
  art: string;
  titel: string;
  text: string;
  ziel: string;
  objekt_typ: string;
  objekt_id: string | null;
  gelesen_am: Date | null;
  erstellt_am: Date;
  mandant_slug: string | null;
  mandant_name: string | null;
}

function ausZeile(z: Zeile): Eintrag {
  return {
    id: z.id, art: z.art, titel: z.titel, text: z.text, ziel: z.ziel,
    objektTyp: z.objekt_typ, objektId: z.objekt_id,
    gelesenAm: z.gelesen_am === null ? null : new Date(z.gelesen_am),
    erstelltAm: new Date(z.erstellt_am),
    mandantSlug: z.mandant_slug, mandantName: z.mandant_name,
  };
}

export interface Filter {
  /** `true` = nur ungelesene, `false` = nur gelesene, `undefined` = alle. */
  readonly ungelesen?: boolean;
  /** Ein Artschluessel oder ein Modulpraefix (`radar`). */
  readonly art?: string | null;
  readonly grenze?: number;
}

/**
 * Der Posteingang, neueste zuerst.
 *
 * Die Gesellschaft steht dabei — ohne sie sieht in der Gruppenansicht
 * dieselbe Meldung dreimal gleich aus, und der Link fuehrt in einen Bereich,
 * den man beim Lesen nicht erkannt hat.
 */
export async function ladePosteingang(
  kontext: Leser, filter: Filter = {},
): Promise<readonly Eintrag[]> {
  const grenze = Math.min(Math.max(filter.grenze ?? 100, 1), 500);
  const bedingungen: string[] = [];
  const werte: unknown[] = [];

  if (filter.ungelesen === true) bedingungen.push('b.gelesen_am is null');
  if (filter.ungelesen === false) bedingungen.push('b.gelesen_am is not null');
  if (filter.art !== undefined && filter.art !== null && filter.art !== '') {
    werte.push(filter.art);
    // Ein Artschluessel trifft genau, ein Modul alles darunter. Beides ueber
    // denselben Parameter, damit die Seite nur EIN Feld schicken muss.
    bedingungen.push(`(b.art = $${String(werte.length)}
                       or b.art like $${String(werte.length)} || '.%')`);
  }
  const wo = bedingungen.length === 0 ? '' : `and ${bedingungen.join(' and ')}`;
  werte.push(grenze);

  const zeilen = await kontext.abfrage<Zeile>(
    `select b.id, b.art, b.titel, b.text, b.ziel, b.objekt_typ, b.objekt_id,
            b.gelesen_am, b.erstellt_am,
            m.slug as mandant_slug, m.name as mandant_name
       from benachrichtigung b
       left join mandant m on m.id = b.mandant_id
      where true ${wo}
      order by b.erstellt_am desc
      limit $${String(werte.length)}`,
    werte,
  );
  return zeilen.map(ausZeile);
}

/**
 * EINE Zeile — oder `null`, wenn sie diesem Konto nicht gehoert.
 *
 * **Dieselbe Auswahl wie `ladePosteingang`**, Spalte fuer Spalte, und darum
 * steht sie hier und nicht in der Seite: zwei Fassungen derselben Frage laufen
 * auseinander, sobald eine ein Feld dazubekommt — und die Einzelansicht zeigte
 * dann etwas anderes als die Zeile, aus der man sie geoeffnet hat.
 *
 * **Sie STEMPELT NICHT.** Lesen ist ein GET, und `gelesen_am` setzt weiter nur
 * `POST /api/benachrichtigungen/[id]/oeffnen` — sonst leerte ein Vorauslader
 * den Posteingang von allein (D-504).
 *
 * `null` heisst „gibt es fuer diese Anmeldung nicht": `t_benachrichtigung_eigene`
 * bindet jede Zeile an `empfaenger_id = app.aktueller_benutzer()`, und die
 * Seite antwortet darauf 404 statt 403 (AUT-06).
 */
export async function findeEintrag(kontext: Leser, id: string): Promise<Eintrag | null> {
  const [z] = await kontext.abfrage<Zeile>(
    `select b.id, b.art, b.titel, b.text, b.ziel, b.objekt_typ, b.objekt_id,
            b.gelesen_am, b.erstellt_am,
            m.slug as mandant_slug, m.name as mandant_name
       from benachrichtigung b
       left join mandant m on m.id = b.mandant_id
      where b.id = $1::uuid`,
    [id],
  );
  return z === undefined ? null : ausZeile(z);
}

/** Wie viele ungelesene — die Zahl an der Glocke. */
export async function zaehleUngelesen(kontext: Leser): Promise<number> {
  const [z] = await kontext.abfrage<{ n: string }>(
    `select count(*) as n from benachrichtigung where gelesen_am is null`);
  return Number(z?.n ?? 0);
}

/** Wie viele ungelesene je Art — fuer die Filterleiste. */
export async function zaehleJeArt(
  kontext: Leser,
): Promise<readonly { art: string; offen: number; gesamt: number }[]> {
  const zeilen = await kontext.abfrage<{ art: string; offen: string; gesamt: string }>(
    `select art,
            count(*) filter (where gelesen_am is null) as offen,
            count(*) as gesamt
       from benachrichtigung
      group by art
      order by art`);
  return zeilen.map((z) => ({ art: z.art, offen: Number(z.offen), gesamt: Number(z.gesamt) }));
}

/**
 * Eine Zeile als gelesen stempeln — und das Ziel zurueckgeben.
 *
 * **Beides zusammen, weil der Klick beides ist.** Wer eine Benachrichtigung
 * oeffnet, hat sie gelesen; ein zweiter Knopf „als gelesen markieren" neben
 * dem Link waere eine Handlung, die niemand ausfuehrt. Das Ziel kommt aus der
 * Zeile und nicht aus der Anfrage: sonst waere der Link ein Feld, in das sich
 * eine fremde Adresse schreiben liesse.
 *
 * `null` heisst: diese Zeile gehoert nicht diesem Konto. Kein eigener Satz
 * dafuer — RLS gibt sie schlicht nicht heraus (AUT-06).
 */
export async function oeffne(kontext: Schreiber, id: string): Promise<string | null> {
  const [z] = await kontext.schreibe<{ ziel: string }>(
    `update benachrichtigung
        set gelesen_am = coalesce(gelesen_am, now())
      where id = $1::uuid
      returning ziel`,
    [id],
  );
  return z?.ziel ?? null;
}

/** Alles als gelesen stempeln. Gibt die Zahl der geaenderten Zeilen zurueck. */
export async function markiereAlleGelesen(kontext: Schreiber): Promise<number> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update benachrichtigung set gelesen_am = now()
      where gelesen_am is null
      returning id`);
  return zeilen.length;
}

// ---------------------------------------------------------------------------
// Praeferenzen (NOT-02)
// ---------------------------------------------------------------------------

/**
 * Was dieses Konto je Art eingestellt hat.
 *
 * Nur die ABWEICHUNGEN stehen in der Tabelle; was fehlt, faellt auf
 * `ArtDefinition.kanaeleVorgabe` zurueck. Jede Art vorzubelegen hiesse, dass
 * eine spaeter geaenderte Vorgabe an allen bestehenden Konten vorbeiginge.
 */
export async function ladePraeferenzen(kontext: Leser): Promise<KanalPraeferenz> {
  const zeilen = await kontext.abfrage<{ art: string; kanaele: string[] }>(
    `select art, kanaele from benachrichtigung_praeferenz`);
  const aus: Record<string, readonly Kanal[]> = {};
  for (const z of zeilen) aus[z.art] = z.kanaele as Kanal[];
  return aus;
}

/**
 * Eine Einstellung setzen.
 *
 * `app` bleibt immer dabei — der CHECK `praeferenz_app_bleibt` erzwingt es,
 * und der Grund steht dort: der Posteingang ist das Protokoll dessen, was
 * mitgeteilt wurde. Abgeschaltet wird der Weg nach draussen.
 *
 * Stimmt die Auswahl mit der Vorgabe ueberein, wird die Zeile ENTFERNT statt
 * geschrieben: eine gespeicherte Vorgabe waere eine Abweichung, die keine ist,
 * und sie bliebe stehen, wenn die Vorgabe sich aendert.
 */
export async function setzePraeferenz(
  kontext: Schreiber,
  art: string,
  kanaele: readonly Kanal[],
  vorgabe: readonly Kanal[],
): Promise<void> {
  const gewuenscht = [...new Set<Kanal>(['app', ...kanaele.filter((k) => k !== 'app')])].sort();
  const standard = [...new Set<Kanal>(['app', ...vorgabe.filter((k) => k !== 'app')])].sort();

  if (gewuenscht.join(',') === standard.join(',')) {
    await kontext.schreibe(
      `delete from benachrichtigung_praeferenz where art = $1`, [art]);
    return;
  }

  await kontext.schreibe(
    `insert into benachrichtigung_praeferenz (benutzer_id, art, kanaele)
     values (app.aktueller_benutzer(), $1, $2::benachrichtigung_kanal[])
     on conflict (benutzer_id, art)
       do update set kanaele = excluded.kanaele, geaendert_am = now()`,
    [art, gewuenscht],
  );
}
