-- 0093 — das K-08-Register schliessen: PUBLIC verliert EXECUTE auf die
-- `app`-Funktionen, die ohnehin eine benannte Rolle haben.
--
-- **Was hier offenstand.** Postgres gibt jeder neuen Funktion `EXECUTE` an
-- PUBLIC. Wer danach `grant execute … to cse_app` schreibt, FUEGT HINZU und
-- ersetzt nichts: der Eintrag fuer PUBLIC bleibt daneben stehen. 41 Funktionen
-- in `app` trugen deshalb beides — die benannte Rolle UND jede andere. Darunter
-- `app.anstellung_entgelt_lesen` (das Entgelt, das K-05 der Zeile entzieht),
-- `app.leistungswerte_lesen` (der Leistungswert, also die Marge — D-92),
-- `app.audit_nutzlast_lesen`, `app.objekt_notiz_lesen` und
-- `app.checkin_ausgeben`, das eine Marke ausstellt.
--
-- **Warum das mehr ist als Hygiene.** Alle diese Funktionen sind
-- `security definer` und gehoeren `postgres`: im Rumpf gilt kein Rechtecheck
-- mehr. Was sie ZURUECKHAELT, ist die Sitzung — `app.aktueller_benutzer()` aus
-- den K-02-GUCs. Ein Prinzipal ohne Sitzung bekommt also heute nichts. Das ist
-- eine Zusicherung ueber den Rumpf jeder einzelnen Funktion, und sie gilt nur,
-- solange niemand eine schreibt, die ohne Sitzung etwas herausgibt. K-08 will
-- genau diese Abhaengigkeit nicht: das Register nennt je Prinzipal, was er
-- aufrufen darf, und was nicht genannt ist, darf er nicht.
--
-- **Warum das hier sicher ist.** Jede Zeile unten betrifft eine Funktion, die
-- BEREITS einen ausdruecklichen `cse_*`-Grant traegt. Der Entzug nimmt also
-- keinem benannten Aufrufer etwas — er entfernt nur den Eintrag, der jeden
-- meint. Erzeugt wurde die Liste aus dem Katalog (`pg_proc.proacl`), nicht von
-- Hand; drei Anlaeufe an anderer Stelle in diesem Zweig haben gezeigt, dass
-- eine abgetippte Liste die eine Zeile vergisst, auf die es ankommt.
--
-- **Was ausdruecklich BLEIBT.**
--   * `app.sichtbare_mandanten()` — dort ist PUBLIC der EINZIGE Eintrag
--     (`proacl is null`). Ein Entzug ohne vorherige Grants liesse jeden
--     Aufrufer lautlos ausfallen, und welche Rollen sie ueber welche Policy
--     erreichen, ist Urteil je Policy. Siehe D-301.
--   * Die Ausloeser-Funktionen in `kern`, `fin` und `zeit_intern` mit
--     `proacl is null`. Postgres weist den DIREKTEN Aufruf einer Funktion, die
--     `trigger` zurueckgibt, selbst ab („trigger functions can only be called
--     as triggers"); der PUBLIC-Eintrag dort oeffnet nichts.
--   * Rund 45 weitere `security definer`-Funktionen gehoeren weiterhin
--     `postgres` statt `cse_definer` (D-300). Das ist die andere Haelfte
--     derselben Frage und braucht Urteil je Funktion.

revoke execute on function app.aktuelle_kunden() from public;
revoke execute on function app.anstellung_entgelt_lesen(p_anstellung uuid) from public;
revoke execute on function app.audit_nutzlast_lesen(p_audit bigint) from public;
revoke execute on function app.aufbewahrung_regel(p_mandant uuid, p_kategorie text) from public;
revoke execute on function app.checkin_ausgeben(p_zuordnung uuid, p_zweck token_zweck, p_kanal text) from public;
revoke execute on function app.checkin_verbrauchen(p_token_hash text, p_geraete_zeit timestamp with time zone, p_ip inet, p_user_agent text, p_geo jsonb) from public;
revoke execute on function app.darf_gruppenansicht() from public;
revoke execute on function app.darf_kontaktiert_werden(p_ansprechpartner uuid, p_kanal text, p_zweck text) from public;
revoke execute on function app.einsatz_hat_zeiterfassung(p_einsatz uuid) from public;
revoke execute on function app.einstellung(p_schluessel text) from public;
revoke execute on function app.einstellung(p_mandant uuid, p_schluessel text) from public;
revoke execute on function app.firma_aufloesen(p_ust_id text, p_name text, p_land character) from public;
revoke execute on function app.firma_kandidaten(p_name text, p_land character) from public;
revoke execute on function app.formular_eingang_zaehlen(p_ip_hash text, p_seit timestamp with time zone) from public;
revoke execute on function app.formular_zustaendigkeit(p_formular uuid) from public;
revoke execute on function app.freigabe_kette_ziehen(p_mandant uuid) from public;
revoke execute on function app.hat_recht(p_schluessel text, p_mandant uuid) from public;
revoke execute on function app.hat_zweiten_faktor(p_benutzer uuid) from public;
revoke execute on function app.ist_mitglied(p_benutzer uuid, p_mandant uuid, p_stichtag date) from public;
revoke execute on function app.ist_super_admin() from public;
revoke execute on function app.lead_posteingang() from public;
revoke execute on function app.leistungswerte_lesen(p_stichtag date) from public;
revoke execute on function app.mandant_fuer_wechsel(p_slug text) from public;
revoke execute on function app.objekt_notiz_lesen(p_objekt uuid) from public;
revoke execute on function app.offline_ablehnen(p_ereignis uuid, p_grund ablehnung_grund, p_begruendung text) from public;
revoke execute on function app.offline_eingang_zuordnen(p_eingang uuid, p_einsatz_zuordnung uuid, p_begruendung text) from public;
revoke execute on function app.offline_ereignis_annehmen(p_token_hash text, p_ereignisse jsonb, p_ip inet) from public;
revoke execute on function app.offline_uebernehmen(p_ereignis uuid, p_beginn timestamp with time zone, p_ende timestamp with time zone, p_begruendung text) from public;
revoke execute on function app.offline_unzugeordnet_lesen() from public;
revoke execute on function app.planungsbedarf(p_mandant uuid, p_von date, p_bis date) from public;
revoke execute on function app.plattform_einstellung(p_schluessel text) from public;
revoke execute on function app.protokolliere(p_aktion text, p_objekt_typ text, p_objekt_id text, p_vorher jsonb, p_nachher jsonb, p_mandant uuid) from public;
revoke execute on function app.raum_notizen_lesen(p_objekt uuid) from public;
revoke execute on function app.rechte_mandanten(p_recht text) from public;
revoke execute on function app.rechtsgrundlage_lesen(p_ansprechpartner uuid) from public;
revoke execute on function app.rechtsgrundlage_von(p_ansprechpartner uuid, p_mandant uuid) from public;
revoke execute on function app.sitzung_aufloesen(p_token_hash text) from public;
revoke execute on function app.switcher_bereiche() from public;
revoke execute on function app.switcher_mandanten() from public;
revoke execute on function app.versuch_protokollieren(p_kennung text, p_ip inet, p_erfolg boolean, p_grund text, p_art text) from public;
revoke execute on function app.zahlungskondition_lesen(p_kunde uuid) from public;
