import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { berlinFormularZeitpunkt } from '@/lib/datum/formularzeit';
import { herkunft } from '@/app/auth/mitarbeiter/anmeldung';
import {
  KeinAktuellerEintragFehler, korrigiereZeiteintrag, LaufenderEintragFehler,
  type KorrekturArt, type KorrekturErgebnis, type KorrekturGrund,
} from '@/server/services/zeit/korrektur';

/**
 * `POST /api/zeit/korrektur` — die Korrektur eines Zeiteintrags (TIM-11,
 * LEG-01, SEC-A9).
 *
 * **Der Befund, der diese Route nötig machte.** `korrigiereZeiteintrag` ist
 * gebaut, geprüft und hatte **keinen einzigen Aufrufer** — keine Route, keine
 * Seite. Damit endete der Einwandsweg im Nichts: eine Mitarbeiterin meldet
 * eine Abweichung (EMP-07), die Planung erkennt sie an — und der Zeiteintrag
 * blieb, wie er war. Die Entscheidungsroute sagt das selbst
 * (`zeit/einwand/entscheidung`): „Anerkennen schreibt hier keine Korrektur."
 * Nur gab es die Korrektur nirgends.
 *
 * **`zeit.korrigieren`, nicht `zeit.schreiben`.** Wer Zeiten erfasst, ändert
 * damit noch keine bestehende Aufzeichnung — dieselbe Trennung, die
 * `zeit.einwand_entscheiden` vom Erfassen trennt. Drei Vorgänge, drei Rechte:
 * melden, entscheiden, korrigieren.
 *
 * **Die Uhrzeiten kommen als BERLINER Ortszeit herein.** Ein
 * `datetime-local`-Feld trägt keine Zone; sie naiv zu nehmen hiesse, in der
 * Umstellungsnacht eine Stunde zu erfinden oder zu verlieren (Invariante 2).
 * `berlinFormularZeitpunkt` löst sie über dieselbe Stelle auf, die der
 * Dienstplan benutzt.
 *
 * **Die Begründung ist Pflicht und hat keine Mindestlänge** (§5.7): „Krank"
 * ist eine Begründung. Was die Datenbank verlangt, ist, dass überhaupt eine
 * dasteht — eine Korrektur ohne Grund ist im Streit wertlos, und eine
 * erzwungene Mindestzahl an Zeichen erzeugt nur „xxxxxxxxxx".
 *
 * **Nicht an sich selbst** (`zk_nicht_selbst`): der Auslöser weist eine
 * Korrektur am eigenen Zeiteintrag ab. Das ist kein Misstrauen, sondern
 * dieselbe Regel wie in EMP-07 — was die betroffene Person selbst schreibt,
 * ist ihre Behauptung und keine Aufzeichnung mehr.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/*
 * Der Bereichsschluessel geht in einen PFAD, nicht in eine Abfrage — und ein
 * `?` oder `#` darin zerlegte das Ziel in Pfad und Abfrage. Der Mandant der
 * SITZUNG entscheidet, was geschrieben wird (K-02); dieser Wert bestimmt nur,
 * wohin der Browser danach geht.
 */
const SLUG = /^[a-z0-9-]{1,40}$/u;

const ARTEN = new Set<KorrekturArt>([
  'zeit_korrektur', 'pause_korrektur', 'zuordnung_korrektur', 'nacherfassung', 'storno',
]);
const GRUENDE = new Set<KorrekturGrund>([
  'vergessen_auszustempeln', 'geraet_defekt', 'falsches_objekt',
  'einwand_mitarbeiter', 'nachtrag_offline', 'sonstiges',
]);

function feld(daten: FormData, name: string): string {
  const wert = daten.get(name);
  return typeof wert === 'string' ? wert.trim() : '';
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
  const eintrag = feld(daten, 'eintrag');
  const art = feld(daten, 'art');
  const grund = feld(daten, 'grund');
  const begruendung = feld(daten, 'begruendung');
  const mandant = feld(daten, 'mandant');
  /*
   * Der Einwand, auf den diese Korrektur antwortet (EMP-07) — optional.
   *
   * Er kommt aus dem Formular und nicht aus einer Vermutung: dass jemand am
   * selben Tag korrigiert hat, heisst nicht, dass er DIESE Meldung beantwortet
   * hat. Ein fremder oder erfundener Wert scheitert am Fremdschluessel
   * `zk_einwand_fk` ueber `(mandant_id, zeit_einwand_id)` und wird zu 404 und
   * nicht zu 403 (AUT-06) — die Zeile eines anderen Mandanten ist nicht
   * vorhanden, nicht verboten.
   */
  const einwand = feld(daten, 'einwand');

  if (!UUID.test(eintrag)
      || (einwand !== '' && !UUID.test(einwand))
      || !SLUG.test(mandant)
      || !ARTEN.has(art as KorrekturArt)
      || !GRUENDE.has(grund as KorrekturGrund)
      || begruendung === '') {
    return zurueckMit(anfrage, daten, 'unbrauchbare_eingabe', 400);
  }

  /*
   * Leer heisst „unverändert", nicht „auf null setzen" — das Formular bietet
   * kein Feld an, das einen Wert löscht. Deshalb fällt ein leeres Feld hier
   * schlicht weg, statt `null` durchzureichen (`exactOptionalPropertyTypes`).
   */
  const beginn = berlinFormularZeitpunkt(daten.get('beginn'));
  const ende = berlinFormularZeitpunkt(daten.get('ende'));
  const pauseRoh = feld(daten, 'pause');
  const pause = /^[0-9]{1,4}$/u.test(pauseRoh) ? Number(pauseRoh) : null;
  if (pauseRoh !== '' && pause === null) {
    return zurueckMit(anfrage, daten, 'pause_unbrauchbar', 400);
  }

  const { ip } = await herkunft(anfrage.headers);

  let ergebnis: KorrekturErgebnis;
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: 'zeit.korrigieren', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return korrigiereZeiteintrag(kontext, {
          zeiteintragId: eintrag,
          art: art as KorrekturArt,
          grundKategorie: grund as KorrekturGrund,
          begruendung,
          durchgefuehrtVon: sitzung.benutzerId,
          ...(einwand === '' ? {} : { zeitEinwandId: einwand }),
          ...(beginn === null ? {} : { beginnZeitpunkt: beginn }),
          ...(ende === null ? {} : { endeZeitpunkt: ende }),
          ...(pause === null ? {} : { pauseMinuten: pause }),
          ...(ip === null ? {} : { ipAdresse: ip }),
        });
      })) as Promise<KorrekturErgebnis>);
  } catch (fehler) {
    const schluessel = fehlerschluessel(fehler);
    if (schluessel === null) throw fehler;
    return zurueckMit(anfrage, daten, schluessel.wort, schluessel.status);
  }

  /*
   * Das Ziel ist die NEUE Fassung, nicht die korrigierte.
   *
   * Die alte trägt jetzt `ersetzt_am` und zeigt den Hinweis „Diese Fassung ist
   * nicht mehr die aktuelle". Wer gerade korrigiert hat, dorthin
   * zurückzuschicken hiesse, ihn auf einem überholten Blatt abzusetzen und ihn
   * den Weg zur gültigen Fassung selbst suchen zu lassen. Beim Storno ist
   * `neueFassungId` derselbe Eintrag — dort gibt es keine neue Fassung, nur
   * einen stornierten Datensatz, und genau der soll zu sehen sein.
   */
  return NextResponse.redirect(
    internesZiel(null, `/portal/${mandant}/zeiten/${ergebnis.neueFassungId}?korrigiert=1`,
      anfrage),
    303,
  );
}

/**
 * Was die Datenbank abweist, und unter welchem Wort es auf dem Bildschirm
 * steht. `null` heisst: kein bekannter Fall — dann fliegt der Fehler weiter
 * und wird zu einem 500, denn ein unbekannter Fehler als „nicht zulässig"
 * ausgegeben wäre eine Diagnose, die niemand geprüft hat.
 */
function fehlerschluessel(
  fehler: unknown,
): { readonly wort: string; readonly status: number } | null {
  if (fehler instanceof KeinAktuellerEintragFehler) return { wort: 'nicht_aktuell', status: 409 };
  if (fehler instanceof LaufenderEintragFehler) return { wort: 'laeuft_noch', status: 409 };
  if (fehler instanceof NichtGefundenFehler) return { wort: 'nicht_gefunden', status: 404 };
  if (fehler instanceof NichtAngemeldetFehler) return { wort: 'keine_sitzung', status: 401 };
  if (fehler instanceof ZweiterFaktorFehler) return { wort: 'zweiter_faktor', status: 403 };

  const pg = fehler as { code?: string; detail?: string };
  /*
   * `zk_nicht_selbst` (0036) meldet `insufficient_privilege` (42501) — NICHT
   * `check_violation`. Der Unterschied ist teuer: 42501 ist auch, was Postgres
   * bei einem fehlenden Tabellenrecht sagt, und beides in einen Topf zu werfen
   * hiesse, einem echten Rechtefehler die Meldung „das ist Ihr eigener
   * Eintrag" zu geben. Unterschieden wird am `detail`, das der Auslöser selbst
   * mit „EMP-07" beginnen lässt.
   */
  if (pg.code === '42501' && (pg.detail ?? '').startsWith('EMP-07')) {
    return { wort: 'nicht_selbst', status: 409 };
  }
  /*
   * `check_violation` deckt die Kettenbedingungen aus 0036 ab: bereits
   * abgelöst, falsche Kette, falsche Fassungsnummer — und
   * `zk_sperre_ausgleich`, die Korrektur an einem gesperrten Monat ohne
   * Gegenbuchung (EMP-04, §12.2).
   */
  if (pg.code === '23514') return { wort: 'nicht_zulaessig', status: 409 };
  /* Fremder Mandant: nach aussen dieselbe Antwort wie „gibt es nicht" (AUT-06). */
  if (pg.code === '23503') return { wort: 'nicht_gefunden', status: 404 };
  return null;
}

/**
 * Zurück auf das Formular mit dem Grund in der Adresse — oder, ohne `zurueck`,
 * als JSON.
 *
 * Ein Formular, dessen Fehler als `{"fehler":"…"}` auf einer weissen Seite
 * landet, hat den Menschen verloren: sein Entwurf ist weg und der Rückweg ist
 * der Zurück-Knopf. Dieselbe Lösung wie in `api/offline-ereignis/[id]`.
 */
function zurueckMit(
  anfrage: NextRequest, daten: FormData, wort: string, status: number,
): NextResponse {
  const zurueck = daten.get('zurueck');
  if (typeof zurueck === 'string' && zurueck !== '') {
    return NextResponse.redirect(
      internesZiel(
        `${zurueck}${zurueck.includes('?') ? '&' : '?'}fehler=${encodeURIComponent(wort)}`,
        zurueck, anfrage),
      303,
    );
  }
  return NextResponse.json({ fehler: wort }, { status });
}
