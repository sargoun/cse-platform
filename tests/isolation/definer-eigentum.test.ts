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
 * Die Funktionen, die den Fehler heute tragen — mit VOLLER SIGNATUR. **Diese
 * Liste darf nur kuerzer werden.**
 *
 * **Warum die Signatur und nicht der Name.** Bis 0304 stand hier
 * `app.uebergabe_fenster` ohne Argumente, und der Vergleich unten lief ueber
 * `nspname || '.' || proname`. 0302 legte daneben eine NEUE Ueberladung
 * `app.uebergabe_fenster(uuid)` an — `security definer`, Eigentuemer
 * `postgres`, also genau der Fehler, den diese Datei einfrieren soll. Sie
 * erbte den Freibrief des gleichnamigen Altlasteintrags und rutschte durch.
 * Die Altlast waechst damit hinter der Wache, die sie einfrieren soll.
 *
 * Mit `pg_get_function_identity_arguments` ist jede Ueberladung ein eigener
 * Eintrag. `app.einstellung` steht deshalb zweimal darin — zwei Funktionen,
 * zwei Zeilen — und `app.uebergabe_fenster()` nur noch in der nullstelligen
 * Fassung; die einstellige gehoert seit 0302 `cse_definer`.
 *
 * Zwei Eintraege standen frueher hier und gehoeren nicht (mehr) dazu; der
 * Grund soll mit der Umstellung nicht verlorengehen:
 *
 *  - `app.hat_zweiten_faktor` gehoert seit 0155 `cse_definer` — sie liest
 *    jetzt auch `kern.zweiter_faktor` und braucht ein Eigentum mit genau
 *    diesem Recht statt dem der Migrationsrolle.
 *  - `kern.checkin_token_widerrufen` wurde in 0063 ERST zu einem Definer
 *    gemacht. Diese Liste friert ein, was VOR K-01 entstand; sie aufzunehmen
 *    hiesse, die Altlast wachsen zu lassen. 0091 gibt ihr `cse_definer`.
 */
const ALTLAST: readonly string[] = [
  'app.aktuelle_kunden()',
  'app.anstellung_entgelt_lesen(p_anstellung uuid)',
  'app.arbzg_befund_quittieren(p_id uuid, p_begruendung text)',
  'app.arbzg_befund_schreiben(p_person uuid, p_regel arbzg_regel, p_schwere verstoss_schwere, p_beginn timestamp with time zone, p_ende timestamp with time zone, p_ist_minuten integer, p_grenzwert integer, p_ursache jsonb, p_mandanten uuid[])',
  'app.arbzg_belastung(p_person uuid, p_von timestamp with time zone, p_bis timestamp with time zone)',
  'app.audit_nutzlast_lesen(p_audit bigint)',
  'app.aufbewahrung_regel(p_mandant uuid, p_kategorie text)',
  'app.checkin_ausgeben(p_zuordnung uuid, p_zweck token_zweck, p_kanal text)',
  'app.checkin_verbrauchen(p_token_hash text, p_geraete_zeit timestamp with time zone, p_ip inet, p_user_agent text, p_geo jsonb)',
  'app.darf_gruppenansicht()',
  'app.darf_kontaktiert_werden(p_ansprechpartner uuid, p_kanal text, p_zweck text)',
  'app.eigene_einsatz_objekte()',
  'app.eigene_einsatz_projekte()',
  'app.einsatz_hat_zeiterfassung(p_einsatz uuid)',
  'app.einsatz_qualifikation_erfuellt(p_anstellung uuid, p_einsatz uuid)',
  'app.einstellung(p_mandant uuid, p_schluessel text)',
  'app.einstellung(p_schluessel text)',
  'app.fenster_schluessel()',
  'app.firma_aufloesen(p_ust_id text, p_name text, p_land character)',
  'app.firma_kandidaten(p_name text, p_land character)',
  'app.formular_eingang_zaehlen(p_ip_hash text, p_seit timestamp with time zone)',
  'app.formular_zustaendigkeit(p_formular uuid)',
  'app.freigabe_kette_ziehen(p_mandant uuid)',
  'app.hat_recht(p_schluessel text, p_mandant uuid)',
  'app.ist_eingesetzt_auf_objekt(p_objekt uuid)',
  'app.ist_eingesetzt_auf_projekt(p_projekt uuid)',
  'app.ist_mitglied(p_benutzer uuid, p_mandant uuid, p_stichtag date)',
  'app.ist_super_admin()',
  'app.lead_posteingang()',
  'app.leistungswerte_lesen(p_stichtag date)',
  'app.lv_preis_lesen(p_lv_position uuid)',
  'app.mandant_fuer_wechsel(p_slug text)',
  'app.objekt_notiz_lesen(p_objekt uuid)',
  'app.offline_ablehnen(p_ereignis uuid, p_grund ablehnung_grund, p_begruendung text)',
  'app.offline_eingang_zuordnen(p_eingang uuid, p_einsatz_zuordnung uuid, p_begruendung text)',
  'app.offline_ereignis_annehmen(p_token_hash text, p_ereignisse jsonb, p_ip inet)',
  'app.offline_uebernehmen(p_ereignis uuid, p_beginn timestamp with time zone, p_ende timestamp with time zone, p_begruendung text)',
  'app.offline_unzugeordnet_lesen()',
  'app.planungsbedarf(p_mandant uuid, p_von date, p_bis date)',
  'app.plattform_einstellung(p_schluessel text)',
  'app.protokolliere(p_aktion text, p_objekt_typ text, p_objekt_id text, p_vorher jsonb, p_nachher jsonb, p_mandant uuid)',
  'app.qualifikationsanforderung(p_einsatz uuid)',
  'app.raum_notizen_lesen(p_objekt uuid)',
  'app.rechte_mandanten(p_recht text)',
  'app.rechtsgrundlage_lesen(p_ansprechpartner uuid)',
  'app.rechtsgrundlage_von(p_ansprechpartner uuid, p_mandant uuid)',
  'app.sichtbare_mandanten()',
  'app.sitzung_aufloesen(p_token_hash text)',
  'app.switcher_bereiche()',
  'app.switcher_mandanten()',
  'app.uebergabe_fenster()',
  'app.uebergabe_sichtbar(p_objekt uuid, p_erfasst_am timestamp with time zone)',
  'app.versuch_protokollieren(p_kennung text, p_ip inet, p_erfolg boolean, p_grund text, p_art text)',
  'app.wetter_beobachtung_uebernehmen(p_station_id text, p_name text, p_breitengrad numeric, p_laengengrad numeric, p_zeitpunkt timestamp with time zone, p_temperatur_c numeric, p_niederschlag_mm numeric, p_wind_ms numeric, p_qualitaetsniveau smallint, p_roh jsonb)',
  'app.zahlungskondition_lesen(p_kunde uuid)',
  'fin.kind_unveraenderlich()',
  'fin.rechnung_summen_stimmig()',
  'fin.rechnung_verkettet()',
  'fin.setze_aufbewahrung()',
  'kern.abwesenheit_urlaubskonto()',
  'kern.antrag_erzeugt_abwesenheit()',
  'kern.aufmass_kopf_denorm()',
  'kern.behinderung_vorlagen_vorbelegen(p_mandant uuid)',
  'kern.benutzer_2fa_pflicht()',
  'kern.bewegung_summe()',
  'kern.checkin_einloesung_paarweise()',
  'kern.da_kenntnisnahme_vorbereiten()',
  'kern.da_version_vorbereiten()',
  'kern.einsatz_medien_bezug_pruefen()',
  'kern.einsatz_medien_loeschsperre()',
  'kern.ln_kopfstatus_fortschreiben()',
  'kern.mandant_behinderung_vorlagen_vorbelegen()',
  'kern.mandant_nachtrag_grundlagen_vorbelegen()',
  'kern.mandant_pruefverfahren_vorbelegen()',
  'kern.nachtrag_grundlagen_vorbelegen(p_mandant uuid)',
  'kern.nachweis_dokumentpflicht()',
  'kern.oeffne_kenntnisnahme_pflicht()',
  'kern.pflege_da_pflicht()',
  'kern.protokolliere_aenderung()',
  'kern.pruefe_qualifikation_mandant()',
  'kern.refresh_schluessel_status()',
  'kern.rolle_berechtigung_pruefen()',
  'kern.schluessel_quittung_vorbereiten()',
  'kern.setze_aufbewahrung()',
  'kern.sitzung_mandant_pruefen()',
  'kern.sitzung_wechsel_audit()',
  'kern.stundenkonto_monat_sperren()',
  'kern.wachbuch_eintrag_vorbereiten()',
  'zeit_intern.arbzg_belastung_job(p_person uuid, p_von timestamp with time zone, p_bis timestamp with time zone)',
  'zeit_intern.einsatz_fenster_projizieren()',
  'zeit_intern.ez_fenster_projizieren()',
  'zeit_intern.fenster_setzen(p_quelle fenster_quelle, p_quelle_id uuid, p_zuordnung_quelle_id uuid, p_person uuid, p_mandant uuid, p_anstellung uuid, p_beginn timestamp with time zone, p_ende timestamp with time zone, p_pause integer, p_aktiv boolean)',
  'zeit_intern.z_fenster_projizieren()',
];

interface DefinerZeile { name: string; eigentuemer: string }

async function definerFunktionen(): Promise<readonly DefinerZeile[]> {
  return sql.unsafe<DefinerZeile[]>(
    `select n.nspname || '.' || p.proname
              || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
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

/**
 * K-08, die andere Haelfte: wer DARF die Definer-Funktionen aufrufen?
 *
 * **Was offenstand.** Postgres gibt jeder neuen Funktion `EXECUTE` an PUBLIC.
 * Ein spaeteres `grant execute … to cse_app` fuegt HINZU und ersetzt nichts —
 * der Eintrag fuer PUBLIC bleibt daneben stehen. 41 Funktionen in `app` trugen
 * deshalb beides: die benannte Rolle UND jede andere, `cse_anon` eingeschlossen.
 * Darunter `app.anstellung_entgelt_lesen` (das Entgelt, das K-05 der Zeile
 * entzieht), `app.leistungswerte_lesen` (die Marge, D-92) und
 * `app.checkin_ausgeben`, das eine Marke ausstellt.
 *
 * Zurueckgehalten hat sie bis dahin die Sitzung: ohne die K-02-GUCs findet
 * `app.aktueller_benutzer()` niemanden. Das ist eine Zusicherung ueber den
 * RUMPF jeder einzelnen Funktion und gilt nur, solange niemand eine schreibt,
 * die auch ohne Sitzung etwas herausgibt. K-08 will genau diese Abhaengigkeit
 * nicht.
 *
 * Die Pruefung ist deshalb eine Sperrklinke wie die darueber: sie zaehlt, was
 * NOCH offensteht, und laesst die Zahl nur sinken.
 */
describe('K-08 — PUBLIC haelt kein EXECUTE auf den `app`-Funktionen', () => {
  it('keine `app`-Definer-Funktion mit benannter Rolle laesst PUBLIC daneben stehen', async () => {
    const offen = await sql.unsafe<{ name: string }[]>(`
      select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and n.nspname = 'app'
         and p.proacl is not null
         and exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
       order by 1`);
    expect(offen.map((z) => z.name)).toEqual([]);
  });

  /**
   * Die eine, die BLEIBT — benannt statt uebersehen.
   *
   * `app.sichtbare_mandanten()` traegt PUBLIC als EINZIGEN Eintrag
   * (`proacl is null`). Ein Entzug ohne vorherige Grants liesse jeden Aufrufer
   * lautlos ausfallen, und welche Rolle sie ueber welche Policy erreicht, ist
   * Urteil je Policy (D-301). Diese Prüfung haelt fest, dass es GENAU diese
   * eine ist: kaeme eine zweite dazu, faellt sie.
   */
  it('genau eine `app`-Funktion steht noch ohne eigenen Grant da', async () => {
    const ohne = await sql.unsafe<{ proname: string }[]>(`
      select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and n.nspname = 'app' and p.proacl is null
       order by 1`);
    expect(ohne.map((z) => z.proname)).toEqual(['sichtbare_mandanten']);
  });

  /**
   * Und die Gegenprobe, dass der Entzug nicht zu weit ging: die benannten
   * Rollen duerfen weiterhin. Ohne sie hiesse „PUBLIC haelt nichts mehr"
   * moeglicherweise „niemand haelt mehr etwas" — und das faellt erst dem
   * Betrieb auf.
   */
  it('die benannten Rollen behalten ihr EXECUTE', async () => {
    const paare: readonly [string, string][] = [
      ['hat_recht', 'cse_app'],
      ['hat_recht', 'cse_definer'],
      ['sitzung_aufloesen', 'cse_anon'],
      ['checkin_verbrauchen', 'cse_checkin'],
      ['offline_ereignis_annehmen', 'cse_checkin'],
      ['planungsbedarf', 'cse_job'],
      ['anstellung_entgelt_lesen', 'cse_app'],
    ];
    for (const [name, rolle] of paare) {
      const [z] = await sql.unsafe<{ ok: boolean }[]>(
        `select bool_or(has_function_privilege($1, p.oid, 'EXECUTE')) as ok
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = $2`,
        [rolle, name],
      );
      expect(z?.ok, `${rolle} darf app.${name} nicht mehr`).toBe(true);
    }
  });
});
