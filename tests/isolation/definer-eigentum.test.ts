/**
 * K-01, zweite Haelfte: wem gehoeren die `SECURITY DEFINER`-Funktionen?
 *
 * **Der Befund, den diese Datei einfriert.** `00-KONVENTIONEN.md` K-01 sagt
 * zwei Dinge: „`SECURITY DEFINER` functions are owned by `cse_definer`" und
 * „**no application role holds `BYPASSRLS`**". Das zweite stimmt. Das erste
 * stimmte fuer 3 von 98 Funktionen: die uebrigen 95 gehoerten dem Konto, das
 * die Migration ausfuehrt — und das ist `postgres`, Superuser mit
 * `BYPASSRLS`.
 *
 * Eine `SECURITY DEFINER`-Funktion laeuft mit den Rechten IHRES
 * EIGENTUEMERS. Diese 95 liefen damit an jeder RLS vorbei und mit vollem
 * Zugriff auf jede Tabelle — und die sorgfaeltig geschriebenen
 * `cse_definer`-Policies (`n_definer`, `q_definer`, `aa_definer`,
 * `sk_definer_lesen` …) wurden nie erreicht. Sie standen da wie eine zweite
 * Verteidigungslinie, und es gab sie nicht. Das faellt nicht auf, weil nichts
 * dabei kaputtgeht: es funktioniert genau so lange gut, bis eine vergessene
 * `mandant_id` in einer `where`-Klausel nicht an einer Policy scheitert,
 * sondern liest, was sie greifen kann.
 *
 * **Warum hier eine Sperrklinke steht und keine Reparatur.** Das Eigentum
 * umzuhaengen ist eine Zeile (`alter function … owner to cse_definer`) und
 * wurde ausprobiert: danach fehlen `cse_definer` Tabellenrechte auf 32
 * Tabellen, und — teurer — jede LESENDE Stelle braucht eine
 * `cse_definer`-Policy, sonst liest die Funktion stillschweigend null Zeilen
 * und schreibt einen falschen Wert ohne Fehlermeldung. Das ist Arbeit je
 * Funktion, mit Urteil je Funktion, und sie gehoert in die eigene
 * Pruefrunde (D-300) — nicht zwischen zwei Gewerke-PRs.
 *
 * Was diese Datei leistet: **die Schuld waechst nicht mehr.** Jede NEUE
 * Definer-Funktion muss `alter function … owner to cse_definer` mitbringen,
 * sonst faellt dieser Test. Und wer eine alte repariert, streicht sie aus der
 * Liste — steht sie noch drin, obwohl sie schon richtig ist, faellt der Test
 * ebenfalls. Eine Liste, die still veraltet, ist keine Sperrklinke.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { schliessen, sql } from './harness.js';

/**
 * Die 95 Funktionen, die den Fehler heute tragen. **Diese Liste darf nur
 * kuerzer werden.**
 */
const ALTLAST: readonly string[] = [
  'app.aktuelle_kunden', 'app.anstellung_entgelt_lesen', 'app.arbzg_befund_quittieren',
  'app.arbzg_befund_schreiben', 'app.arbzg_belastung', 'app.audit_nutzlast_lesen',
  'app.aufbewahrung_regel', 'app.checkin_ausgeben', 'app.checkin_verbrauchen',
  'app.darf_gruppenansicht', 'app.darf_kontaktiert_werden', 'app.eigene_einsatz_objekte',
  'app.eigene_einsatz_projekte', 'app.einsatz_hat_zeiterfassung', 'app.einsatz_qualifikation_erfuellt',
  'app.einstellung', 'app.einstellung', 'app.fenster_schluessel',
  'app.firma_aufloesen', 'app.firma_kandidaten', 'app.formular_eingang_zaehlen',
  'app.formular_zustaendigkeit', 'app.freigabe_kette_ziehen', 'app.hat_recht',
  'app.hat_zweiten_faktor', 'app.ist_eingesetzt_auf_objekt', 'app.ist_eingesetzt_auf_projekt',
  'app.ist_mitglied', 'app.ist_super_admin', 'app.lead_posteingang',
  'app.leistungswerte_lesen', 'app.lv_preis_lesen', 'app.mandant_fuer_wechsel',
  'app.objekt_notiz_lesen', 'app.offline_ablehnen', 'app.offline_eingang_zuordnen',
  'app.offline_ereignis_annehmen', 'app.offline_uebernehmen', 'app.offline_unzugeordnet_lesen',
  'app.planungsbedarf', 'app.plattform_einstellung', 'app.protokolliere',
  'app.qualifikationsanforderung', 'app.raum_notizen_lesen', 'app.rechte_mandanten',
  'app.rechtsgrundlage_lesen', 'app.rechtsgrundlage_von', 'app.sichtbare_mandanten',
  'app.sitzung_aufloesen', 'app.switcher_bereiche', 'app.switcher_mandanten',
  'app.uebergabe_fenster', 'app.uebergabe_sichtbar', 'app.versuch_protokollieren',
  'app.wetter_beobachtung_uebernehmen', 'app.zahlungskondition_lesen', 'fin.kind_unveraenderlich',
  'fin.rechnung_summen_stimmig', 'fin.rechnung_verkettet', 'fin.setze_aufbewahrung',
  'kern.abwesenheit_urlaubskonto', 'kern.antrag_erzeugt_abwesenheit', 'kern.aufmass_kopf_denorm',
  'kern.behinderung_vorlagen_vorbelegen', 'kern.benutzer_2fa_pflicht', 'kern.bewegung_summe',
  'kern.checkin_einloesung_paarweise', 'kern.da_kenntnisnahme_vorbereiten',
  // `kern.checkin_token_widerrufen` stand hier und gehoert nicht hierher:
  // die Funktion wurde in 0063 ZU einem Definer gemacht, die Grenze ist also
  // neu gezogen worden. Diese Liste friert ein, was vor K-01 entstand — sie
  // aufzunehmen hiess, die Altlast wachsen zu lassen, und genau das soll
  // dieser Test verhindern. 0091 gibt ihr `cse_definer`.
  'kern.da_version_vorbereiten', 'kern.einsatz_medien_bezug_pruefen', 'kern.einsatz_medien_loeschsperre',
  'kern.ln_kopfstatus_fortschreiben', 'kern.mandant_behinderung_vorlagen_vorbelegen', 'kern.mandant_nachtrag_grundlagen_vorbelegen',
  'kern.mandant_pruefverfahren_vorbelegen', 'kern.nachtrag_grundlagen_vorbelegen', 'kern.nachweis_dokumentpflicht',
  'kern.oeffne_kenntnisnahme_pflicht', 'kern.pflege_da_pflicht', 'kern.protokolliere_aenderung',
  'kern.pruefe_qualifikation_mandant', 'kern.refresh_schluessel_status', 'kern.rolle_berechtigung_pruefen',
  'kern.schluessel_quittung_vorbereiten', 'kern.setze_aufbewahrung', 'kern.sitzung_mandant_pruefen',
  'kern.sitzung_wechsel_audit', 'kern.stundenkonto_monat_sperren', 'kern.wachbuch_eintrag_vorbereiten',
  'zeit_intern.arbzg_belastung_job', 'zeit_intern.einsatz_fenster_projizieren', 'zeit_intern.ez_fenster_projizieren',
  'zeit_intern.fenster_setzen', 'zeit_intern.z_fenster_projizieren',
];

interface DefinerZeile { name: string; eigentuemer: string }

async function definerFunktionen(): Promise<readonly DefinerZeile[]> {
  return sql.unsafe<DefinerZeile[]>(
    `select n.nspname || '.' || p.proname            as name,
            pg_get_userbyid(p.proowner)              as eigentuemer
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef
        and n.nspname in ('app', 'kern', 'fin', 'zeit_intern')
      order by 1`,
  );
}

afterAll(async () => { await schliessen(); });

describe('K-01 · das Eigentum der Definer-Funktionen', () => {
  it('es gibt überhaupt welche zu prüfen', async () => {
    // Ohne diese Zusage bestünde alles Folgende auf einer leeren Menge.
    expect((await definerFunktionen()).length).toBeGreaterThan(90);
  });

  it('jede NEUE Definer-Funktion gehört `cse_definer` — die Altlast wächst nicht', async () => {
    const altlast = new Set(ALTLAST);
    const neueFehler = (await definerFunktionen())
      .filter((f) => f.eigentuemer !== 'cse_definer' && !altlast.has(f.name))
      .map((f) => `${f.name} (gehört ${f.eigentuemer})`);

    expect(
      neueFehler,
      'Neue SECURITY-DEFINER-Funktionen brauchen `alter function … owner to cse_definer` '
      + 'in ihrer Migration (K-01). Ohne das laufen sie als Superuser an jeder RLS vorbei.',
    ).toEqual([]);
  });

  it('und die Liste veraltet nicht still — was repariert ist, fliegt raus', async () => {
    const vorhanden = new Map(
      (await definerFunktionen()).map((f) => [f.name, f.eigentuemer]));
    const unnoetig = ALTLAST.filter(
      (name) => !vorhanden.has(name) || vorhanden.get(name) === 'cse_definer');

    expect(
      unnoetig,
      'Diese Funktionen gehören inzwischen `cse_definer` (oder gibt es nicht mehr) — '
      + 'aus ALTLAST streichen.',
    ).toEqual([]);
  });

  it('jede Definer-Funktion setzt ihren `search_path` (K-01, Rechteausweitung)', async () => {
    /**
     * Die andere Haelfte von K-01 — und sie gilt schon lange. Ein
     * unqualifizierter `search_path` auf einer Definer-Funktion laesst den
     * Aufrufer eine eigene Tabelle vorschieben und den Funktionskoerper damit
     * gegen SEINE Daten laufen. Der Fall steht hier, damit er auch dann noch
     * geprueft wird, wenn jemand die Vorlage einmal ohne `set` kopiert.
     */
    const ohne = await sql.unsafe<{ name: string }[]>(
      `select n.nspname || '.' || p.proname as name
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef
          and n.nspname in ('app', 'kern', 'fin', 'zeit_intern')
          and (p.proconfig is null
               or not exists (select 1 from unnest(p.proconfig) c
                               where c like 'search_path=%'))
        order by 1`);
    expect(ohne.map((z) => z.name)).toEqual([]);
  });
});
