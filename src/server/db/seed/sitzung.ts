/**
 * Eine Sitzung wie im Portal — `cse_app` mit gebundenem Mandanten.
 *
 * Der Seed laeuft sonst als Eigentuemer, und der sieht alles. Was er ueber
 * einen DIENST schreibt, soll aber genau das durchlaufen, was ein Mensch im
 * Portal durchlaeuft: `app.hat_recht`, die Policies, die Definer-Funktionen.
 * Als Eigentuemer geprueft hiesse: nicht geprueft — und ein Seed, der die Tore
 * umgeht, erzeugt Zeilen, die es im Betrieb nie geben koennte.
 *
 * Die Funktion stand zuerst in `zeit.ts`; mit dem zweiten Aufrufer
 * (`konto.ts`) waeren es zwei Fassungen desselben Sitzungsaufbaus geworden,
 * und die zweite haette irgendwann `app.readonly` vergessen.
 */
import type postgres from 'postgres';
import type { SchreibKontext } from '../../kontext/index.js';

type Sql = postgres.Sql<Record<string, unknown>>;

/**
 * Wahlweise MIT Mensch hinter dem Konto.
 *
 * `app.person_id` ist die zweite Haelfte einer Sitzung: `app.aktuelle_person()`
 * liest sie, und daran haengen die Spalten, die festhalten, WER etwas getan
 * hat — `aufmass.aufgenommen_von_anstellung_id`, `erstellt_von_person_id` im
 * Bautagebuch. Ohne sie entstehen Zeilen, die niemand aufgenommen hat: nicht
 * falsch, aber im Streitfall wertlos.
 *
 * Sie ist OPTIONAL, weil es Konten ohne Menschen gibt — der Website-Renderer
 * und der Formular-Eingang haben keine Person, und eine Pflichtangabe haette
 * sie aus dem Seed gedraengt.
 */
export interface SitzungsOptionen {
  readonly personId?: string | null;
}

export async function alsPortalSitzung<T>(
  sql: Sql, mandantId: string, benutzerId: string,
  fn: (kontext: SchreibKontext) => Promise<T>,
  optionen: SitzungsOptionen = {},
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_app`);
    const setze = async (name: string, wert: string): Promise<void> => {
      await tx.unsafe(`select set_config($1, $2, true)`, [name, wert]);
    };
    await setze('app.scope', 'mandant');
    await setze('app.mandant_id', mandantId);
    await setze('app.mandant_ids', mandantId);
    await setze('app.benutzer_id', benutzerId);
    await setze('app.person_id', optionen.personId ?? '');
    await setze('app.portal', 'intern');
    await setze('app.readonly', 'off');
    await setze('app.akteur_typ', 'mensch');
    /*
     * Die Sitzung eines Menschen, der sich VOLLSTÄNDIG angemeldet hat — mit
     * zweitem Faktor, wo seine Rolle ihn verlangt (AUT-02). Seit V-136 gewährt
     * eine Rolle mit `erfordert_2fa` ohne `aal2` nichts mehr (0395); ohne
     * diese Zeile stünde der Seed als Admin mit halber Anmeldung da und
     * bekäme kein einziges Recht. Dieselbe Stufe wie `kontext/dev.ts`.
     */
    await setze('app.aal', 'aal2');
    const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly R[];
    return fn({
      scope: 'mandant', portal: 'intern', benutzerId,
      aktiverMandantId: mandantId, mandantIds: [mandantId],
      abfrage, schreibe: abfrage,
    });
  }) as Promise<T>;
}
