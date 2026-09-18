-- 0183 — `fin.auftraege_ohne_zeit()`: die FIN-18-Menge fuer `finanzen.lesen`
--        (FIN-18, EMP-13, AUT-06, Invariante 3).
--
-- ===========================================================================
-- Der Befund: die Seite brach genau dann, wenn sie etwas zu zeigen hatte
-- ===========================================================================
--
-- `/portal/[mandant]/finanzen/pruefungen` ist im Routenregister mit
-- `finanzen.lesen` geoeffnet. Sie las die FIN-18-Zahl bisher aus
-- `fin.auftrag_erfasste_minuten(uuid)` — und DIE Funktion verlangt
-- `finanzen.festschreiben`:
--
--     if not app.hat_recht('finanzen.festschreiben', v_gehoert) then
--       raise exception 'finanzen.festschreiben fehlt'
--         using errcode = 'insufficient_privilege';
--
-- In der Rollenmatrix haelt `leitung` NUR `finanzen.lesen`; festschreiben
-- haben allein admin und super_admin. Die Seite lief fuer eine Leitung also
-- nur, solange es KEINEN abgeschlossenen Auftrag gab — der erste Auftrag im
-- Bestand machte aus ihr eine 500er. Ein Bildschirm, der beim ersten echten
-- Inhalt umfaellt, ist im Betrieb schlimmer als einer, der fehlt: er wird
-- gebaut, abgenommen und faellt beim Kunden um.
--
-- ===========================================================================
-- Die Antwort ist eine ZWEITE Funktion, nicht ein aufgeweichtes Recht
-- ===========================================================================
--
-- `fin.auftrag_erfasste_minuten` bleibt, wie sie ist. Sie gibt eine ZAHL
-- heraus, und diese Zahl ist die Grundlage der Festschreibung samt ihrer
-- Uebergehung — sie gehoert hinter `finanzen.festschreiben`.
--
-- Diese Funktion hier gibt keine Zahl heraus, sondern eine MENGE VON
-- AUFTRAGSKENNUNGEN: welche abgeschlossenen Auftraege ueberhaupt keine
-- erfasste Minute tragen. Das ist die Ja/Nein-Auskunft, die die Vorab-Liste
-- braucht, und nicht mehr.
--
-- **EMP-13 bleibt gewahrt.** Es verlaesst keine Zeiteintragszeile die
-- Funktion, keine Personenkennung und keine Minutenzahl. Die Buchhaltung
-- erfaehrt, DASS Zeit fehlt, nicht von wem und nicht wie viel.
--
-- **Und nicht die Sicht `zeiteintrag_auftrag`.** Die laeuft mit
-- `security_invoker` (0051): ein Konto ohne `zeit.lesen` bekaeme dort bei
-- JEDEM Auftrag null Minuten — also bei jedem Auftrag eine FIN-18-Warnung.
-- Eine Warnung, die immer kommt, wird nach dem dritten Mal ungelesen
-- weggeklickt, und dann ist die eine echte mit weg.

create function fin.auftraege_ohne_zeit() returns setof uuid
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare v_mandant uuid := app.aktiver_mandant();
begin
  /**
   * Ohne genau EINEN aktiven Mandanten gibt es hier nichts (Invariante 3 und
   * Invariante 10). Die Gruppenansicht liest keine FIN-18-Menge: die Liste
   * ist eine Arbeitsliste der Buchhaltung EINER Gesellschaft, und ueber alle
   * drei gelesen saehe sie aus wie ein Gruppenbefund.
   */
  if v_mandant is null then return; end if;
  if not app.hat_recht('finanzen.lesen', v_mandant) then return; end if;

  return query
    select a.id
      from public.auftrag a
     where a.mandant_id = v_mandant
       /**
        * **Ein STORNIERTER Auftrag steht nicht darin.** FIN-18 fragt nach
        * abgerechneter Leistung; was storniert ist, wird nicht abgerechnet
        * und hat keine zu erfassende Zeit. Der CHECK aus 0025 lautet
        * `status <> 'abgeschlossen' or abgeschlossen_am is not null` und
        * raeumt `abgeschlossen_am` beim Stornieren NICHT — eine Zeile mit
        * `status = 'storniert'` und gesetztem Abschlussdatum ist also
        * moeglich (beim Einfuegen; `kern.auftrag_uebergang_pruefen` sperrt
        * nur den Weg zurueck aus `abgeschlossen`). Sie gehoert nicht auf eine
        * Liste, die die Buchhaltung abarbeiten soll.
        */
       and a.status <> 'storniert'
       and (a.status = 'abgeschlossen' or a.abgeschlossen_am is not null)
       /**
        * `coalesce(sum(...), 0) = 0` und nicht `not exists`: die Bedingung
        * ist WORTGLEICH die von `fin.auftrag_erfasste_minuten` — Summe der
        * Netto-Minuten aller nicht stornierten, nicht ersetzten Eintraege.
        * Zwei Prueforte mit zwei Formulierungen derselben Regel sind einer zu
        * viel.
        */
       and coalesce((select sum(z.dauer_netto_minuten)
                       from public.zeiteintrag z
                       join public.auftrag_leistung al
                         on al.mandant_id = z.mandant_id
                        and al.id = z.auftrag_leistung_id
                      where al.auftrag_id = a.id
                        and z.storniert_am is null
                        and z.ersetzt_am is null), 0) = 0;
end $$;

comment on function fin.auftraege_ohne_zeit() is
  'FIN-18, EMP-13. Die abgeschlossenen Auftraege des aktiven Mandanten ohne eine '
  'einzige erfasste Minute — als MENGE VON KENNUNGEN, nicht als Minutenzahl. '
  'Oeffnet mit finanzen.lesen (die Route /finanzen/pruefungen tut es auch); '
  'fin.auftrag_erfasste_minuten bleibt hinter finanzen.festschreiben, weil sie '
  'die Zahl herausgibt, an der die Festschreibung haengt. Fehlendes Recht ergibt '
  'eine LEERE Menge und keinen Fehler (AUT-06).';

/**
 * **`owner to cse_definer`** (K-01). Ohne diese Zeile gehoerte die Funktion
 * der Migrationsrolle — Superuser mit `BYPASSRLS` — und liefe an jeder Policy
 * vorbei. `cse_definer` haelt genau, was sie braucht: `select` auf `auftrag`
 * (`d_auftrag_lesen`), auf `zeiteintrag` (`z_definer_lesen`) und auf
 * `auftrag_leistung` (`d_auftrag_leistung_lesen`) — Recht UND Policy (D-388).
 */
alter function fin.auftraege_ohne_zeit() owner to cse_definer;
revoke all on function fin.auftraege_ohne_zeit() from public;
grant execute on function fin.auftraege_ohne_zeit() to cse_app;
