import 'server-only';
import { anbindungen } from '@/server/registry/integrationen';
import type { LeseKontext, SchreibKontext } from '@/server/kontext';

/**
 * Nachrichtenfäden — Liste, Faden, Antwort (EMP-11, CRM-03, CRM-08, LEG-08,
 * NOT-03, Invariante 7).
 *
 * **Ein Faden, keine Zettelsammlung.** `04-SEITENKARTE.md` §5.17 nennt
 * `/portal/[mandant]/nachrichten` den Fadenposteingang; die Liste zeigt
 * deshalb EINEN Kopf je `thread_id` mit der letzten Aktivität und der Zahl
 * ungelesener Zeilen, nicht jede Nachricht einzeln. Nach Datum flach
 * gelistet stünde die Antwort neben der Frage, und wer den Vorgang lesen
 * will, sortiert im Kopf.
 *
 * **Nichts verlässt das System hier.** Der Versand nach draussen braucht
 * einen verbundenen Weg, und keiner ist verbunden (O-36,
 * `registry/integrationen.ts`). `sendeNachAussen` wirft deshalb, statt einen
 * Erfolg zu behaupten: eine Zeile mit `zustell_status = 'gesendet'`, hinter
 * der nichts gesendet wurde, ist die vorgetäuschte Anbindung, die CLAUDE.md
 * ausschliesst. Interne Fäden funktionieren vollständig.
 *
 * **Die Rechtsgrundlage schreibt die DATENBANK.** `kern.nachricht_sendetor()`
 * (0231) fragt denselben Torwächter wie `lead_aktivitaet` und zieht den Wert
 * selbst. Dieser Dienst übergibt ihn nie — was er Sekunden vorher gelesen
 * hätte, gilt in diesem Moment vielleicht nicht mehr.
 */

export type Richtung = 'intern' | 'eingehend' | 'ausgehend';
export type Kanal = 'portal' | 'email' | 'sms';
export type EmpfaengerTyp = 'benutzer' | 'person' | 'ansprechpartner' | 'kandidat' | 'extern';
export type Zustellstatus =
  'ausstehend' | 'gesendet' | 'zugestellt' | 'fehlgeschlagen' | 'unterdrueckt';

/* ------------------------------------------------------------- Versandwege */

export interface Versandweg {
  readonly kanal: 'email' | 'sms';
  readonly verbunden: boolean;
  readonly hinweis: string;
  /** Die offene Frage in DECISIONS.md, wo es eine gibt. */
  readonly offen: string | null;
}

/**
 * Welche Wege nach draussen es GIBT — aus dem Anbindungsregister, nicht aus
 * einer zweiten Liste.
 *
 * Eine zweite Liste verpasst den Tag, an dem ein Schlüssel gesetzt wird, und
 * behauptet danach das Falsche in beide Richtungen.
 */
export function versandwege(): readonly Versandweg[] {
  const alle = anbindungen();
  return (['email', 'sms'] as const).map((kanal) => {
    const a = alle.find((x) => x.schluessel === kanal);
    return {
      kanal,
      verbunden: a?.stand === 'verbunden',
      hinweis: a?.hinweis ?? 'Kein Adapter hinterlegt.',
      offen: a?.offen ?? null,
    };
  });
}

export class VersandNichtVerbundenFehler extends Error {
  constructor(public readonly kanal: string, hinweis: string) {
    super(
      `Für den Kanal „${kanal}" ist kein Versender verbunden, also geht nichts hinaus. `
      + hinweis,
    );
    this.name = 'VersandNichtVerbundenFehler';
  }
}

/* -------------------------------------------------------------------- Liste */

export interface FadenFilter {
  readonly nurUngelesen?: boolean;
  readonly richtung?: Richtung;
  readonly bezugTyp?: string;
}

export interface Fadenkopf {
  readonly threadId: string;
  readonly betreff: string | null;
  readonly anzahl: number;
  readonly ungelesen: number;
  readonly letzteAktivitaet: Date;
  readonly richtung: Richtung;
  readonly kanal: Kanal;
  readonly zustellStatus: Zustellstatus;
  readonly absender: string | null;
  readonly auszug: string;
  readonly geschlossenAm: Date | null;
  readonly bezugTyp: string | null;
  readonly bezugId: string | null;
}

interface RohKopf {
  readonly thread_id: string;
  readonly betreff: string | null;
  readonly anzahl: string;
  readonly ungelesen: string;
  readonly letzte_aktivitaet: Date | string;
  readonly richtung: Richtung;
  readonly kanal: Kanal;
  readonly zustell_status: Zustellstatus;
  readonly absender: string | null;
  readonly auszug: string;
  readonly geschlossen_am: Date | string | null;
  readonly bezug_typ: string | null;
  readonly bezug_id: string | null;
}

function alsInstant(wert: Date | string | null): Date | null {
  if (wert === null) return null;
  return wert instanceof Date ? wert : new Date(wert);
}

/**
 * Ein Kopf je Faden — letzte Nachricht, Zahl der eigenen ungelesenen Zeilen.
 *
 * `ungelesen` zählt nur, was MIR zugestellt ist: eine Zahl, die die
 * ungelesenen Zeilen der Kollegin mitzählte, wäre in jedem Posteingang
 * dieselbe und damit keine Auskunft. Gezählt wird über `nachricht_empfaenger`
 * mit `benutzer`- und `person`-Bindung, denn eine Anmelde-Id und eine
 * Personen-Id sind zwei verschiedene Ids (D-09, §7.9 B11).
 */
export async function listeFaeden(
  kontext: LeseKontext, filter: FadenFilter = {},
): Promise<readonly Fadenkopf[]> {
  const werte: unknown[] = [];
  const wo: string[] = [];

  if (filter.richtung !== undefined) {
    werte.push(filter.richtung);
    wo.push(`l.richtung = $${String(werte.length)}::nachricht_richtung`);
  }
  if (filter.bezugTyp !== undefined) {
    werte.push(filter.bezugTyp);
    wo.push(`w.bezug_typ = $${String(werte.length)}::bezug_typ`);
  }
  if (filter.nurUngelesen === true) wo.push('f.ungelesen > 0');

  const zeilen = await kontext.abfrage<RohKopf>(
    `with f as (
       select n.thread_id,
              count(distinct n.id) as anzahl,
              max(n.erstellt_am)   as letzte_aktivitaet,
              count(distinct n.id) filter (
                where e.id is not null and e.gelesen_am is null) as ungelesen
         from nachricht n
         left join nachricht_empfaenger e
                on e.mandant_id = n.mandant_id and e.nachricht_id = n.id
               and ((e.empfaenger_typ = 'benutzer'
                     and e.empfaenger_id = app.aktueller_benutzer())
                 or (e.empfaenger_typ = 'person'
                     and e.empfaenger_id = app.aktuelle_person()))
        where n.geloescht_am is null
        group by n.thread_id
     )
     select f.thread_id, f.anzahl::text as anzahl, f.ungelesen::text as ungelesen,
            f.letzte_aktivitaet,
            w.betreff, w.geschlossen_am,
            w.bezug_typ::text as bezug_typ, w.bezug_id,
            l.richtung, l.kanal, l.zustell_status,
            coalesce(ab.name, ag.name, l.absender_extern) as absender,
            left(l.koerper, 160) as auszug
       from f
       /* Die Wurzel trägt Betreff, Bezug und den Abschluss des Fadens. */
       left join nachricht w on w.id = f.thread_id and w.geloescht_am is null
       /* Und die jüngste Zeile trägt Richtung, Kanal und Zustellstand. */
       left join lateral (
         select m.richtung, m.kanal, m.zustell_status, m.koerper,
                m.absender_benutzer_id, m.absender_agent_id, m.absender_extern
           from nachricht m
          where m.thread_id = f.thread_id and m.geloescht_am is null
          order by m.erstellt_am desc, m.id
          limit 1) l on true
       left join benutzer ab on ab.id = l.absender_benutzer_id
       left join agent    ag on ag.id = l.absender_agent_id
      ${wo.length === 0 ? '' : `where ${wo.join(' and ')}`}
      order by f.letzte_aktivitaet desc`,
    werte,
  );

  return zeilen.map((z) => ({
    threadId: z.thread_id,
    betreff: z.betreff,
    anzahl: Number(z.anzahl),
    ungelesen: Number(z.ungelesen),
    letzteAktivitaet: alsInstant(z.letzte_aktivitaet) ?? new Date(0),
    richtung: z.richtung ?? 'intern',
    kanal: z.kanal ?? 'portal',
    zustellStatus: z.zustell_status ?? 'ausstehend',
    absender: z.absender,
    auszug: z.auszug ?? '',
    geschlossenAm: alsInstant(z.geschlossen_am),
    bezugTyp: z.bezug_typ,
    bezugId: z.bezug_id,
  }));
}

/* -------------------------------------------------------------------- Faden */

export interface Anhang {
  readonly dokumentId: string;
  readonly titel: string | null;
}

export interface Empfaenger {
  readonly typ: EmpfaengerTyp;
  readonly name: string | null;
  readonly art: 'an' | 'kopie';
  readonly gelesenAm: Date | null;
  readonly zugestelltAm: Date | null;
}

export interface Nachricht {
  readonly id: string;
  readonly betreff: string | null;
  readonly koerper: string;
  readonly richtung: Richtung;
  readonly kanal: Kanal;
  readonly akteurArt: string;
  readonly absender: string | null;
  readonly erstelltAm: Date;
  readonly gesendetAm: Date | null;
  readonly zustellStatus: Zustellstatus;
  readonly zustellFehler: string | null;
  /**
   * Der UWG-Nachweis, sichtbar an der Zeile: auf welcher Grundlage gesendet
   * wurde, und — wo ein Agent schrieb — welche Freigabe es erlaubte.
   */
  readonly rechtsgrundlage: string | null;
  readonly zweck: string | null;
  readonly freigabeId: string | null;
  readonly anhaenge: readonly Anhang[];
  readonly empfaenger: readonly Empfaenger[];
}

export interface Faden {
  readonly threadId: string;
  readonly betreff: string | null;
  readonly geschlossenAm: Date | null;
  readonly bezugTyp: string | null;
  readonly bezugId: string | null;
  readonly nachrichten: readonly Nachricht[];
  /**
   * Wie viele Zeilen dieses Fadens ICH ungelesen habe.
   *
   * **Nicht „irgendwer".** Die Detailseite rechnete das einmal selbst, aus
   * den EMPFAENGERZEILEN des Fadens — und im internen Portal gibt `ladeFaden`
   * alle Empfaenger der Gesellschaft heraus. Der Knopf „Als gelesen
   * markieren" erschien damit, solange irgendwer den Faden nicht gelesen
   * hatte; der POST traf dann null eigene Zeilen, und die Seite meldete
   * „Gespeichert." Der Lesestand eines Fremden ist keine Aussage ueber
   * meinen. Gezaehlt wird deshalb hier, mit derselben Bedingung wie die CTE
   * in `listeFaeden` — `benutzer`-Id UND `person`-Id, denn das sind zwei
   * verschiedene Ids (D-09, §7.9 B11).
   */
  readonly ungelesen: number;
}

/**
 * Ein Faden in Zeitfolge, oder `null`.
 *
 * `null` heisst „gibt es nicht ODER darf diese Sitzung nicht sehen". Die Seite
 * antwortet darauf mit 404 und nie mit 403 (AUT-06).
 *
 * Die Anhänge kommen als Ids und Titel, nicht als Adressen: eine signierte
 * URL entsteht erst beim Klick und hat eine Frist — eine, die beim Rendern
 * entstünde, stünde bis zu ihrem Ablauf im Seitenquelltext.
 */
export async function ladeFaden(
  kontext: LeseKontext, threadId: string,
): Promise<Faden | null> {
  interface Roh {
    readonly id: string;
    readonly betreff: string | null;
    readonly koerper: string;
    readonly richtung: Richtung;
    readonly kanal: Kanal;
    readonly akteur_art: string;
    readonly absender: string | null;
    readonly erstellt_am: Date | string;
    readonly gesendet_am: Date | string | null;
    readonly zustell_status: Zustellstatus;
    readonly zustell_fehler: string | null;
    readonly rechtsgrundlage: string | null;
    readonly zweck: string | null;
    readonly freigabe_id: string | null;
  }
  const zeilen = await kontext.abfrage<Roh>(
    `select n.id, n.betreff, n.koerper, n.richtung, n.kanal,
            n.akteur_art::text as akteur_art,
            coalesce(ab.name, ag.name, n.absender_extern) as absender,
            n.erstellt_am, n.gesendet_am, n.zustell_status, n.zustell_fehler,
            n.rechtsgrundlage::text as rechtsgrundlage, n.zweck::text as zweck,
            n.freigabe_id
       from nachricht n
       left join benutzer ab on ab.id = n.absender_benutzer_id
       left join agent    ag on ag.id = n.absender_agent_id
      where n.thread_id = $1 and n.geloescht_am is null
      order by n.erstellt_am, n.id`,
    [threadId],
  );
  if (zeilen.length === 0) return null;

  const [wurzel] = await kontext.abfrage<{
    betreff: string | null; geschlossen_am: Date | string | null;
    bezug_typ: string | null; bezug_id: string | null;
  }>(
    `select w.betreff, w.geschlossen_am, w.bezug_typ::text as bezug_typ, w.bezug_id
       from nachricht w where w.id = $1`,
    [threadId],
  );

  const anhaenge = await kontext.abfrage<{
    nachricht_id: string; dokument_id: string; titel: string | null;
  }>(
    `select a.nachricht_id, a.dokument_id, d.titel
       from nachricht_anhang a
       join nachricht n on n.mandant_id = a.mandant_id and n.id = a.nachricht_id
       left join dokument d on d.mandant_id = a.mandant_id and d.id = a.dokument_id
      where n.thread_id = $1
      order by a.erstellt_am`,
    [threadId],
  );

  const empfaenger = await kontext.abfrage<{
    nachricht_id: string; empfaenger_typ: EmpfaengerTyp; art: 'an' | 'kopie';
    name: string | null; gelesen_am: Date | string | null;
    zugestellt_am: Date | string | null;
  }>(
    `select e.nachricht_id, e.empfaenger_typ, e.art, e.gelesen_am, e.zugestellt_am,
            coalesce(b.name,
                     btrim(coalesce(p.vorname, '') || ' ' || coalesce(p.nachname, '')),
                     e.extern_email) as name
       from nachricht_empfaenger e
       join nachricht n on n.mandant_id = e.mandant_id and n.id = e.nachricht_id
       left join benutzer b on e.empfaenger_typ = 'benutzer' and b.id = e.empfaenger_id
       left join person   p on e.empfaenger_typ = 'person'   and p.id = e.empfaenger_id
      where n.thread_id = $1
      order by e.art, e.erstellt_am`,
    [threadId],
  );

  /*
   * Die EIGENE Ungelesen-Zahl — dieselbe Bedingung wie in `listeFaeden`.
   * Eine eigene Abfrage und keine Auswertung der `empfaenger`-Liste oben:
   * diese enthaelt im internen Portal alle Empfaenger der Gesellschaft, und
   * daraus „habe ich ungelesen" zu schliessen ist genau der Fehler, den der
   * Kommentar am Feld beschreibt.
   */
  const [eigene] = await kontext.abfrage<{ ungelesen: string }>(
    `select count(*)::text as ungelesen
       from nachricht_empfaenger e
       join nachricht n on n.mandant_id = e.mandant_id and n.id = e.nachricht_id
      where n.thread_id = $1 and n.geloescht_am is null and e.gelesen_am is null
        and ((e.empfaenger_typ = 'benutzer' and e.empfaenger_id = app.aktueller_benutzer())
          or (e.empfaenger_typ = 'person'   and e.empfaenger_id = app.aktuelle_person()))`,
    [threadId],
  );

  return {
    threadId,
    betreff: wurzel?.betreff ?? zeilen[0]?.betreff ?? null,
    geschlossenAm: alsInstant(wurzel?.geschlossen_am ?? null),
    bezugTyp: wurzel?.bezug_typ ?? null,
    bezugId: wurzel?.bezug_id ?? null,
    ungelesen: Number(eigene?.ungelesen ?? '0'),
    nachrichten: zeilen.map((z) => ({
      id: z.id,
      betreff: z.betreff,
      koerper: z.koerper,
      richtung: z.richtung,
      kanal: z.kanal,
      akteurArt: z.akteur_art,
      absender: z.absender,
      erstelltAm: alsInstant(z.erstellt_am) ?? new Date(0),
      gesendetAm: alsInstant(z.gesendet_am),
      zustellStatus: z.zustell_status,
      zustellFehler: z.zustell_fehler,
      rechtsgrundlage: z.rechtsgrundlage,
      zweck: z.zweck,
      freigabeId: z.freigabe_id,
      anhaenge: anhaenge.filter((a) => a.nachricht_id === z.id)
        .map((a) => ({ dokumentId: a.dokument_id, titel: a.titel })),
      empfaenger: empfaenger.filter((e) => e.nachricht_id === z.id).map((e) => ({
        typ: e.empfaenger_typ, name: e.name, art: e.art,
        gelesenAm: alsInstant(e.gelesen_am), zugestelltAm: alsInstant(e.zugestellt_am),
      })),
    })),
  };
}

/* ---------------------------------------------------------------- Schreiben */

export interface EmpfaengerEingabe {
  readonly typ: EmpfaengerTyp;
  readonly id?: string | null;
  readonly externEmail?: string | null;
  readonly art?: 'an' | 'kopie';
}

export interface NeueNachricht {
  readonly betreff?: string | null;
  readonly koerper: string;
  readonly empfaenger: readonly EmpfaengerEingabe[];
  readonly bezugTyp?: string | null;
  readonly bezugId?: string | null;
}

async function schreibeEmpfaenger(
  kontext: SchreibKontext, nachrichtId: string,
  empfaenger: readonly EmpfaengerEingabe[],
): Promise<void> {
  for (const e of empfaenger) {
    await kontext.schreibe(
      `insert into nachricht_empfaenger
         (mandant_id, nachricht_id, empfaenger_typ, empfaenger_id, extern_email, art)
       values (app.aktiver_mandant(), $1, $2::nachricht_empfaenger_typ, $3, $4,
               coalesce($5::empfaenger_art, 'an'))
       on conflict do nothing`,
      [nachrichtId, e.typ, e.id ?? null, e.externEmail ?? null, e.art ?? null],
    );
  }
}

/**
 * Einen internen Faden eröffnen.
 *
 * `richtung = 'intern'`, `kanal = 'portal'` — und beides ist hier keine
 * Vorgabe, sondern der Umfang dieser Funktion: was nach draussen geht, läuft
 * über `sendeNachAussen`, durch das UWG-Tor und die Freigabekette. Zwei Wege
 * mit einem Namen wären der Weg, auf dem eine Werbemail als interne Notiz
 * hinausgeht.
 */
export async function eroeffneFaden(
  kontext: SchreibKontext, eingabe: NeueNachricht,
): Promise<string> {
  const [z] = await kontext.schreibe<{ id: string; thread_id: string }>(
    `insert into nachricht
       (mandant_id, betreff, koerper, richtung, kanal, akteur_art,
        absender_benutzer_id, bezug_typ, bezug_id, erstellt_von)
     values (app.aktiver_mandant(), $1, $2, 'intern', 'portal', 'mensch',
             app.aktueller_benutzer(), $3::bezug_typ, $4, app.aktueller_benutzer())
     returning id, thread_id`,
    [eingabe.betreff ?? null, eingabe.koerper, eingabe.bezugTyp ?? null,
     eingabe.bezugId ?? null],
  );
  if (z === undefined) throw new Error('Nachricht konnte nicht angelegt werden');
  await schreibeEmpfaenger(kontext, z.id, eingabe.empfaenger);
  return z.thread_id;
}

/**
 * Antworten — im Faden, nicht daneben.
 *
 * `antwortet_auf_id` ist die jüngste Zeile des Fadens, und `thread_id` setzt
 * `trg_thread_id` daraus (0231). Der Dienst gibt die Wurzel nicht selbst mit:
 * eine Antwort, deren Faden der Aufrufer bestimmt, kann in einen fremden
 * Faden gelegt werden.
 */
export async function antworte(
  kontext: SchreibKontext, threadId: string,
  eingabe: { readonly koerper: string; readonly empfaenger?: readonly EmpfaengerEingabe[] },
): Promise<string | null> {
  const [eltern] = await kontext.abfrage<{ id: string; geschlossen: boolean }>(
    `select m.id,
            exists (select 1 from nachricht w
                     where w.id = $1 and w.geschlossen_am is not null) as geschlossen
       from nachricht m
      where m.thread_id = $1 and m.geloescht_am is null
      order by m.erstellt_am desc, m.id
      limit 1`,
    [threadId],
  );
  if (eltern === undefined) return null;
  if (eltern.geschlossen) throw new Error('Der Faden ist geschlossen.');

  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into nachricht
       (mandant_id, koerper, richtung, kanal, akteur_art,
        absender_benutzer_id, antwortet_auf_id, erstellt_von)
     values (app.aktiver_mandant(), $1, 'intern', 'portal', 'mensch',
             app.aktueller_benutzer(), $2, app.aktueller_benutzer())
     returning id`,
    [eingabe.koerper, eltern.id],
  );
  if (z === undefined) return null;

  /*
   * Ohne eigene Angabe erbt die Antwort die Empfänger des Fadens — sonst
   * schreibt jemand in einen Faden, und niemand bekommt es angezeigt.
   */
  const ziele = eingabe.empfaenger ?? await erbeEmpfaenger(kontext, threadId);
  await schreibeEmpfaenger(kontext, z.id, ziele);
  return z.id;
}

async function erbeEmpfaenger(
  kontext: LeseKontext, threadId: string,
): Promise<readonly EmpfaengerEingabe[]> {
  const zeilen = await kontext.abfrage<{
    empfaenger_typ: EmpfaengerTyp; empfaenger_id: string | null; extern_email: string | null;
  }>(
    `select distinct e.empfaenger_typ, e.empfaenger_id, e.extern_email
       from nachricht_empfaenger e
       join nachricht n on n.mandant_id = e.mandant_id and n.id = e.nachricht_id
      where n.thread_id = $1`,
    [threadId],
  );
  return zeilen.map((z) => ({
    typ: z.empfaenger_typ, id: z.empfaenger_id, externEmail: z.extern_email, art: 'an' as const,
  }));
}

/**
 * **Der Weg nach draussen — und er endet heute an einer Wand.**
 *
 * Gebaut ist die Schnittstelle vollständig: Kanal, Zweck, Kontakt, das
 * UWG-Tor in der Datenbank, der Freigabebezug. Was fehlt, ist der Versender
 * (O-36). Diese Funktion wirft deshalb, BEVOR sie schreibt — eine Zeile mit
 * `zustell_status = 'gesendet'` ohne Versand wäre eine Behauptung in einem
 * Nachweis, den eine Abmahnung liest.
 *
 * `rechtsgrundlage` steht nicht in den Parametern: sie wird vom Auslöser
 * gezogen (0231). Ein Aufrufer, der sie mitgäbe, könnte sie erfinden.
 */
export async function sendeNachAussen(
  kontext: SchreibKontext,
  eingabe: {
    readonly threadId?: string | null;
    readonly betreff?: string | null;
    readonly koerper: string;
    readonly kanal: 'email' | 'sms';
    readonly zweck: 'vertraglich' | 'transaktional' | 'werbung';
    readonly ansprechpartnerId: string;
    /** Pflicht, wenn ein Agent schreibt (Invariante 7). */
    readonly freigabeId?: string | null;
  },
): Promise<string> {
  const weg = versandwege().find((w) => w.kanal === eingabe.kanal);
  if (weg === undefined || !weg.verbunden) {
    throw new VersandNichtVerbundenFehler(eingabe.kanal, weg?.hinweis ?? '');
  }
  /* istanbul ignore next — erreichbar, sobald ein Versender verbunden ist. */
  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into nachricht
       (mandant_id, betreff, koerper, richtung, kanal, akteur_art,
        absender_benutzer_id, rechtsgrundlage_kontakt_id, zweck, freigabe_id,
        thread_id, erstellt_von)
     values (app.aktiver_mandant(), $1, $2, 'ausgehend', $3::nachricht_kanal, 'mensch',
             app.aktueller_benutzer(), $4, $5::kommunikationszweck, $6, $7,
             app.aktueller_benutzer())
     returning id`,
    [eingabe.betreff ?? null, eingabe.koerper, eingabe.kanal,
     eingabe.ansprechpartnerId, eingabe.zweck, eingabe.freigabeId ?? null,
     eingabe.threadId ?? null],
  );
  if (z === undefined) throw new Error('Nachricht konnte nicht angelegt werden');
  await schreibeEmpfaenger(kontext, z.id, [
    { typ: 'ansprechpartner', id: eingabe.ansprechpartnerId, art: 'an' },
  ]);
  return z.id;
}

/**
 * Öffnen stempelt `gelesen_am` auf der EIGENEN Empfängerzeile — und nur per
 * POST (D-504).
 *
 * Ein GET, das stempelt, wird von einem Vorauslader ausgelöst; der
 * Posteingang wäre dann von allein leer. Gestempelt werden nur die eigenen
 * Zeilen, und `coalesce` lässt einen früheren Zeitpunkt stehen: gelesen ist
 * man einmal.
 */
export async function markiereGelesen(
  kontext: SchreibKontext, threadId: string,
): Promise<number> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update nachricht_empfaenger e
        set gelesen_am = coalesce(e.gelesen_am, now())
      where e.gelesen_am is null
        and e.nachricht_id in (select n.id from nachricht n
                                where n.thread_id = $1 and n.geloescht_am is null)
        and ((e.empfaenger_typ = 'benutzer' and e.empfaenger_id = app.aktueller_benutzer())
          or (e.empfaenger_typ = 'person'   and e.empfaenger_id = app.aktuelle_person()))
      returning e.id`,
    [threadId],
  );
  return zeilen.length;
}

/** Einen Faden schliessen — der Ersatz für eine Löschung (Invariante 8). */
export async function schliesseFaden(
  kontext: SchreibKontext, threadId: string,
): Promise<boolean> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update nachricht set geschlossen_am = now(),
            geschlossen_von = app.aktueller_benutzer(),
            geaendert_von = app.aktueller_benutzer()
      where id = $1 and id = thread_id and geschlossen_am is null
      returning id`,
    [threadId],
  );
  return zeilen.length === 1;
}

export async function oeffneFaden(
  kontext: SchreibKontext, threadId: string,
): Promise<boolean> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update nachricht set geschlossen_am = null, geschlossen_von = null,
            geaendert_von = app.aktueller_benutzer()
      where id = $1 and id = thread_id and geschlossen_am is not null
      returning id`,
    [threadId],
  );
  return zeilen.length === 1;
}

/** Wer als Empfänger in Frage kommt: die Konten dieser Gesellschaft. */
export async function ladeEmpfaengerziele(
  kontext: LeseKontext,
): Promise<readonly { readonly id: string; readonly name: string }[]> {
  return kontext.abfrage<{ id: string; name: string }>(
    `select distinct b.id, b.name
       from benutzer b
       join benutzer_mandant bm on bm.benutzer_id = b.id
      where bm.mandant_id = app.aktiver_mandant() and b.status = 'aktiv'
        and b.id <> app.aktueller_benutzer()
      order by b.name`,
  );
}
