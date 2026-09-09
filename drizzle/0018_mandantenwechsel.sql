-- ---------------------------------------------------------------------------
-- 0018 — Der Mandantenwechsel als POST (03-AUTH-BERECHTIGUNGEN.md §4.4/§4.5).
--
-- **Ein GET wechselt den Mandanten nie.** Bis hierher betrat `/portal/gruppe`
-- die Gruppenansicht einfach dadurch, dass die Seite `withGroupScope` rief —
-- unabhaengig davon, was in `benutzer_sitzung.ansicht` stand. Damit war die URL
-- der Mandantenzustand, und ein falsch eingefuegter Link haette eine Leitung
-- lautlos in eine andere Ansicht versetzt. Genau das verhindern D-10 und
-- DESIGN §6.
--
-- Diese Migration liefert die drei Bausteine, die der POST braucht, und
-- repariert den Auditausloeser, der einen Wechsel bisher nur EINSEITIG
-- festhielt.
-- ---------------------------------------------------------------------------

/**
 * Der Bereich hinter einem Slug — oder NULL.
 *
 * NULL fuer "gibt es nicht" UND fuer "du gehoerst nicht dazu", und das ist
 * kein Versehen: AUT-06 verlangt fuer beide dieselbe Antwort. Ein 403 auf den
 * zweiten Fall bestaetigte, dass die Gesellschaft existiert.
 *
 * `switcher_mandanten()` und nicht `sichtbare_mandanten()` (B14): ein
 * archivierter Bereich bleibt lesbar, wird aber nicht mehr als Arbeitskontext
 * angeboten — und darf folglich auch nicht per POST zu einem gemacht werden.
 * Derselbe Massstab, den `kern.sitzung_mandant_pruefen` als Trigger anlegt.
 */
create function app.mandant_fuer_wechsel(p_slug text) returns uuid
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select m.id from public.mandant m
   where m.slug = p_slug
     and m.id = any (app.switcher_mandanten())
   limit 1
$$;

comment on function app.mandant_fuer_wechsel(text) is
  'Slug -> mandant_id, beschraenkt auf switcher_mandanten(). NULL heisst 404 (AUT-06).';

grant execute on function app.mandant_fuer_wechsel(text) to cse_app;

/**
 * Darf diese Anmeldung die Gruppenansicht ueberhaupt betreten?
 *
 * Die drei Bedingungen aus §4.5, woertlich:
 *
 *  1. **mindestens zwei Bereiche** im Switcher. DESIGN §6 Regel 1: wer in
 *     genau einer Gesellschaft arbeitet, hat keine Gruppe, ueber die er
 *     hinwegsehen koennte.
 *  2. **mindestens eine Mitgliedschaft mit `rolle.portal = 'intern'`** — oder
 *     eine globale Rolle mit diesem Portal (TEN-08: ein Super-Admin bringt
 *     keine Zuweisungszeile mit). Die Gruppenansicht ist die leitende
 *     Ansicht; eine Arbeiterin, die fuer zwei Gesellschaften faehrt, liest
 *     ihre beiden Beschaeftigungen ueber `/portal/mein` (K-18).
 *  3. **mindestens ein `gruppe.<modul>.lesen`** in mindestens einem dieser
 *     Bereiche. Ohne das waere die Ansicht eine leere Seite mit einer
 *     Ueberschrift.
 *
 * Erfuellt sie eine davon nicht, ist die Antwort 404 und nicht 403 — auch hier
 * bestaetigt eine Absage die Existenz.
 */
create function app.darf_gruppenansicht() returns boolean
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select coalesce(array_length(app.switcher_mandanten(), 1), 0) >= 2
     and (exists (select 1 from public.benutzer_mandant bm
                    join public.rolle r on r.id = bm.rolle_id
                   where bm.benutzer_id = app.aktueller_benutzer()
                     and bm.entzogen_am is null
                     and bm.gueltig_ab <= current_date
                     and (bm.gueltig_bis is null or bm.gueltig_bis >= current_date)
                     and r.portal = 'intern')
       or exists (select 1 from public.benutzer b
                    join public.rolle r on r.id = b.globale_rolle_id
                   where b.id = app.aktueller_benutzer()
                     and b.deaktiviert_am is null and b.status = 'aktiv'
                     and r.portal = 'intern'))
     and exists (select 1
                   from unnest(app.switcher_mandanten()) as s(id)
                   cross join public.berechtigung b
                  where b.modul = 'gruppe' and b.aktion = 'lesen'
                    and app.hat_recht(b.schluessel, s.id))
$$;

comment on function app.darf_gruppenansicht() is
  'Die drei Bedingungen aus 03-AUTH §4.5 fuer den Eintritt in die Gruppenansicht.';

grant execute on function app.darf_gruppenansicht() to cse_app;

-- ---------------------------------------------------------------------------
-- Der Auditausloeser: ZWEI Spiegelzeilen, und der richtige Name (TEN-09).
-- ---------------------------------------------------------------------------

/**
 * Ein Wechsel spannt per Definition ueber zwei Gesellschaften.
 *
 * Die bisherige Fassung schrieb EINE Zeile, gekeyt auf
 * `new.aktiver_mandant_id`. Beim Eintritt in die Gruppenansicht ist der NULL —
 * die Zeile landete auf Plattformebene, und in der Pruefspur der verlassenen
 * Gesellschaft stand nichts. TEN-09 verspricht, dass JEDER Wechsel dort
 * auftaucht, wo er stattgefunden hat, und das sind beide Seiten.
 *
 * Der Eintritt in die Gruppenansicht heisst ausserdem
 * `sitzung.gruppenansicht_geoeffnet` und nicht `sitzung.mandant_gewechselt`
 * (§4.4): es wird kein Mandant aktiv, es wird einer aufgegeben.
 *
 * Das Paar reist weiterhin IN `vorher`/`nachher`; `audit_log` fuehrt keine
 * Spalten `mandant_id_alt`/`_neu` (K-21).
 */
create or replace function kern.sitzung_wechsel_audit() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_aktion  text;
  v_vorher  jsonb;
  v_nachher jsonb;
begin
  if (new.aktiver_mandant_id is not distinct from old.aktiver_mandant_id)
     and (new.ansicht is not distinct from old.ansicht) then
    return new;
  end if;

  v_aktion := case
    when new.ansicht = 'gruppe' and old.ansicht is distinct from 'gruppe'
      then 'sitzung.gruppenansicht_geoeffnet'
    else 'sitzung.mandant_gewechselt'
  end;
  v_vorher  := jsonb_build_object('mandant_id', old.aktiver_mandant_id,
                                  'ansicht', old.ansicht);
  v_nachher := jsonb_build_object('mandant_id', new.aktiver_mandant_id,
                                  'ansicht', new.ansicht);

  /**
   * Je Seite eine Zeile — aber nur fuer die Seiten, die es GIBT.
   *
   * `app.protokolliere` faellt bei NULL auf `app.aktiver_mandant()` zurueck.
   * Ein `perform … , null` waere hier deshalb keine Plattformzeile, sondern
   * eine zweite Zeile auf dem GEBUNDENEN Mandanten: beim Eintritt in die
   * Gruppenansicht stuenden zwei identische Eintraege in der verlassenen
   * Gesellschaft und keiner sonst. Es gibt in diesem Fall schlicht keine
   * zweite Seite — der Wechsel gibt einen Bereich auf, er betritt keinen.
   */
  if old.aktiver_mandant_id is not null then
    perform app.protokolliere(v_aktion, 'benutzer_sitzung', new.id::text,
                              v_vorher, v_nachher, old.aktiver_mandant_id);
  end if;
  if new.aktiver_mandant_id is not null
     and new.aktiver_mandant_id is distinct from old.aktiver_mandant_id then
    perform app.protokolliere(v_aktion, 'benutzer_sitzung', new.id::text,
                              v_vorher, v_nachher, new.aktiver_mandant_id);
  end if;
  -- Ein Wechsel zwischen zwei mandantenlosen Ansichten (gruppe -> person) hat
  -- keine Seite. Er bleibt trotzdem ein Ereignis: TEN-09 verspricht JEDEN.
  if old.aktiver_mandant_id is null and new.aktiver_mandant_id is null then
    perform app.protokolliere(v_aktion, 'benutzer_sitzung', new.id::text,
                              v_vorher, v_nachher, null);
  end if;

  new.mandant_gewechselt_am := now();
  return new;
end $$;

/**
 * Die Bereiche des Switchers MIT ihren Namen (§11.3).
 *
 * Warum eine eigene Funktion und nicht ein Join auf `mandant`: die Policy
 * `t_mandant_lesen` zeigt genau `app.sichtbare_mandanten()`, und das ist im
 * `mandant`-Scope der EINE aktive Bereich. Ein Switcher, der nur den Bereich
 * anbietet, in dem man schon ist, waere kein Switcher. `security definer`
 * loest das, ohne die Policy zu lockern — und gibt nur heraus, was
 * `switcher_mandanten()` ohnehin erlaubt.
 *
 * `ist_standard` reist mit, weil §4.4 es als REIHENFOLGE zulaesst und als
 * Vorauswahl verbietet: "it is a hint, never an automatic choice."
 */
create function app.switcher_bereiche()
returns table (id uuid, slug text, name text, ist_standard boolean)
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select m.id, m.slug, m.name,
         coalesce(bool_or(bm.ist_standard), false) as ist_standard
    from public.mandant m
    left join public.benutzer_mandant bm
           on bm.mandant_id = m.id
          and bm.benutzer_id = app.aktueller_benutzer()
          and bm.entzogen_am is null
   where m.id = any (app.switcher_mandanten())
   group by m.id, m.slug, m.name, m.sortierung
   order by ist_standard desc, m.sortierung, m.slug
$$;

comment on function app.switcher_bereiche() is
  'Die Bereiche des Mandantenwechslers mit Namen — beschraenkt auf switcher_mandanten().';

grant execute on function app.switcher_bereiche() to cse_app;
