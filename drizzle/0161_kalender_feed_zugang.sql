/**
 * Der Kalender-Feed bekommt den ZUGANG des Menschen, nicht einen erfundenen
 * (CAL-03, K-04, TEN-08).
 *
 * `0160` loeste den Token zu einer Benutzerkennung auf, und die Route baute
 * sich daraus eine Sitzung zusammen: `portal = 'intern'`, `ansicht =
 * 'mandant'`, `person_id = null`. Drei Erfindungen, jede mit eigener Folge:
 *
 *  1. **`portal = 'intern'` hebt die K-04-Decken.** `p_ma_decke` auf `einsatz`
 *     ist RESTRIKTIV und lautet „Portal ist nicht `mitarbeiter` ODER die
 *     Schicht gehoert dieser Person". Mit einem erfundenen `intern` ist die
 *     linke Seite wahr, und die Decke, die fuer einen Arbeiter die einzige
 *     Begrenzung ist, faellt weg — auf der EINZIGEN Route ohne Sitzung.
 *  2. **`person_id = null` toetet den Lesepfad des Arbeiters.** `t_person`
 *     und `p_ma_decke` haengen beide an `app.aktuelle_person()`. Ohne sie
 *     findet ein Arbeiter im Feed genau nichts — und `mitarbeiter` haelt
 *     `dienstplan.lesen` nicht, also half auch `t_mandant` nicht. Der Feed
 *     war fuer die Leute leer, fuer die er gebaut wurde.
 *  3. **Kein Blick auf `benutzer`.** Ein deaktiviertes, gesperrtes oder zum
 *     Dienstkonto gemachtes Konto behielt einen funktionierenden Kalender:
 *     die einzige Lebendigkeitsbedingung war `widerrufen_am is null` am
 *     Token. `app.sitzung_aufloesen` prueft an derselben Stelle fuenf Dinge.
 *
 * Und die Bereichsliste holte sich die Route selbst — mit `entzogen_am is
 * null` als einziger Bedingung, waehrend `app.switcher_mandanten()`, die
 * Autoritaet fuer jeden Sitzungsweg, zusaetzlich `mandant.archiviert_am`,
 * `gueltig_ab` und `gueltig_bis` verlangt. Eine abgelaufene Mitgliedschaft
 * blieb im Feed gueltig.
 *
 * Diese Migration macht daraus EINE Definer-Funktion, die dasselbe prueft wie
 * `app.sitzung_aufloesen` und dazu je Bereich das Portal aus der ROLLE
 * liefert. Die Route bindet damit, was der Mensch wirklich ist.
 */

drop function if exists app.kalender_feed_aufloesen(text);

create function app.kalender_feed_aufloesen(p_hash text)
returns table(
  benutzer_id uuid,
  person_id   uuid,
  mandant_id  uuid,
  slug        text,
  portal      text
)
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_benutzer uuid;
  v_person   uuid;
begin
  /*
   * Der Abruf zaehlt nur, wenn der MENSCH den Zugang noch hat. Dieselben
   * fuenf Bedingungen wie in app.sitzung_aufloesen -- ein Feed, der einen
   * deaktivierten Zugang ueberlebt, ist eine Sitzung ohne Ablauf.
   */
  update public.kalender_feed f
     set letzter_abruf_am = now(), abrufe = abrufe + 1
    from public.benutzer b
   where f.token_hash = p_hash
     and f.widerrufen_am is null
     and b.id = f.benutzer_id
     and b.deaktiviert_am is null
     and b.status = 'aktiv'
     and (b.gesperrt_bis is null or b.gesperrt_bis <= now())
     and not b.ist_dienstkonto
  returning b.id, b.person_id into v_benutzer, v_person;

  if v_benutzer is null then return; end if;

  /*
   * `left join` und nicht `from mandant`: ein gueltiger Token, dessen Mensch
   * gerade keine Mitgliedschaft traegt, muss EINE Zeile ergeben -- sonst
   * liest der Aufrufer "keine Zeile" als "Token unbekannt" und antwortet 404,
   * wo ein leerer Kalender richtig waere. Der Unterschied zwischen "gibt es
   * nicht" und "ist heute leer" gehoert nicht verwischt.
   */
  return query
  select v_benutzer, v_person, m.id, m.slug,
         /*
          * Das Portal kommt aus der ROLLE (K-04) -- zuerst aus der
          * Mitgliedschaft in DIESEM Bereich, sonst aus der globalen Rolle
          * (TEN-08), sonst 'mitarbeiter'. Fail closed: die engste Decke,
          * wenn keine Rolle sie nennt.
          */
         coalesce(
           (select r.portal from public.benutzer_mandant bm
              join public.rolle r on r.id = bm.rolle_id
             where bm.benutzer_id = v_benutzer and bm.mandant_id = m.id
               and bm.entzogen_am is null limit 1),
           (select r.portal from public.rolle r
             join public.benutzer b2 on b2.globale_rolle_id = r.id
            where b2.id = v_benutzer and r.geltungsbereich = 'global'
              and r.archiviert_am is null),
           'mitarbeiter')::text
    from (select 1) as anker
    left join public.mandant m
      on m.archiviert_am is null
     and exists (select 1 from public.benutzer_mandant bm
                  where bm.benutzer_id = v_benutzer
                    and bm.mandant_id = m.id
                    and bm.entzogen_am is null
                    and bm.gueltig_ab <= current_date
                    and (bm.gueltig_bis is null or bm.gueltig_bis >= current_date))
   order by m.sortierung, m.slug;
end
$$;

comment on function app.kalender_feed_aufloesen(text) is
  'CAL-03. Loest einen Feed-Token auf und zaehlt den Abruf. Gibt Benutzer, Person und '
  'je Bereich das Portal aus der Rolle heraus -- nie Termine. Dieselben '
  'Lebendigkeits- und Mitgliedschaftsbedingungen wie app.sitzung_aufloesen und '
  'app.switcher_mandanten().';

alter function app.kalender_feed_aufloesen(text) owner to cse_definer;
revoke execute on function app.kalender_feed_aufloesen(text) from public;
grant execute on function app.kalender_feed_aufloesen(text) to cse_app;

/*
 * Die Funktion liest jetzt auch benutzer, benutzer_mandant, rolle und
 * mandant. Unter FORCE RLS ist ein grant ohne policy keine Leseerlaubnis,
 * sondern null Zeilen -- schweigend.
 */
grant select on public.benutzer, public.benutzer_mandant, public.rolle, public.mandant
  to cse_definer;
create policy d_feed_benutzer on benutzer for select to cse_definer using (true);
create policy d_feed_mitgliedschaft on benutzer_mandant for select to cse_definer using (true);
create policy d_feed_rolle on rolle for select to cse_definer using (true);
create policy d_feed_mandant on mandant for select to cse_definer using (true);

/**
 * **Ein Kalendereintrag wird ABGESAGT, nicht geloescht** -- und seit dieser
 * Zeile geht das auch nicht mehr.
 *
 * `t_kalender_schreiben` ist `for all`; ihr `with check` traegt
 * `not app.ist_readonly()`, ihr `using` nicht. Fuer DELETE gibt es kein
 * `with check` -- eine lesend gebundene Anfrage (`bindeAnfrage` setzt
 * `app.readonly = 'on'`) haette mit `kalender.schreiben` eine Zeile hart
 * loeschen koennen. Der Entwurf kennt dafuer `abgesagt_am`: wer einen Termin
 * loescht, nimmt ihn allen Teilnehmern weg, ohne dass es je einen gegeben
 * haette. cse_job behaelt DELETE fuer Migrationsarbeit nicht -- es brauchte
 * sie nie.
 */
revoke delete on kalender_eintrag from cse_app;
revoke delete on kalender_eintrag from cse_job;
