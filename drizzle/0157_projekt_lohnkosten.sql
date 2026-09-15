-- 0157 — Die Projektkennzahlen, ohne die geschützten Werte herauszugeben (REP-05).

/**
 * **K-05 nimmt `cse_app` den internen Stundensatz weg — und zwar richtig.**
 *
 * `anstellung.stundensatz_intern` trägt für `cse_app` ein `insert` und ein
 * `update`, aber **kein `select`** (Spaltenrecht, 0002): die Anwendung darf
 * ihn setzen und nie lesen. Was ein Mensch kostet, ist die eine Zahl, die aus
 * einer Liste heraus niemanden etwas angeht — und ein Spaltenrecht ist die
 * einzige Schranke, die auch ein `select *` aushält.
 *
 * Die Projektmarge (REP-05) braucht trotzdem die Lohnkosten. Der Ausweg ist
 * nicht, das Recht zu weiten, sondern die **Summe** herauszugeben statt des
 * Satzes: aus `sum(minuten × satz)` über viele Menschen lässt sich der Satz
 * eines einzelnen nicht zurückrechnen, und genau das ist der Unterschied
 * zwischen einer Kennzahl und einer Auskunft.
 *
 * Aufgefallen ist es beim ersten Test, der die Abfrage gegen echte Rechte
 * laufen liess: „permission denied for table projekt" — der Planer las die
 * Spalte, und Postgres weist die ganze Anweisung ab. Ohne diesen Test hätte
 * der Bericht in der Entwicklung funktioniert (dort verbindet der Eigentümer)
 * und in der Auslieferung nicht.
 */
create function app.projekt_lohnkosten(p_von date, p_bis date)
returns table (projekt_id uuid, lohn_cent bigint)
language sql stable security definer
set search_path = pg_catalog, public, app as $$
  select z.projekt_id,
         -- Invariante 1: Geld ist ganzzahlig. Der Satz ist Cent JE STUNDE,
         -- die Dauer steht in Minuten -- also erst multiplizieren, EINMAL am
         -- Ende durch 60 teilen und dabei kaufmaennisch runden (+30 vor der
         -- GANZZAHLIGEN Division). Wer je Zeile teilte, verloere je Zeile
         -- einen halben Cent.
         --
         -- Das ::bigint steht INNEN, und dort muss es stehen: sum() ueber
         -- bigint liefert numeric, und mit einem numeric links waere `/ 60`
         -- eine Bruchdivision -- 2125.5 --, die der Cast am Ende noch einmal
         -- rundet. Zweimal 25 Minuten zu 25,50 EUR/h ergaeben so 2126 statt
         -- 2125 Cent. Erst ganzzahlig machen, dann teilen.
         ((coalesce(sum(
            z.dauer_netto_minuten::bigint * coalesce(a.stundensatz_intern, 0)
          ), 0)::bigint + 30) / 60)
    from public.zeiteintrag z
    join public.anstellung a
      on a.person_id = z.person_id
     and a.mandant_id = z.mandant_id
     and a.geloescht_am is null
   where z.projekt_id is not null
     and z.mandant_id = app.aktiver_mandant()
     -- Die Freigabe ist ein ZEITPUNKT, kein Status (§7.3, EMP-04):
     -- `zeiteintrag_status` führt laufend, abgeschlossen, offen_nacherfassung
     -- und storniert.
     and z.freigegeben_am is not null
     and z.storniert_am is null
     and z.ersetzt_am is null
     and (z.beginn_zeitpunkt at time zone 'Europe/Berlin')::date between p_von and p_bis
     -- Dasselbe Recht, das die Berichtsroute verlangt. Ein Definer OHNE
     -- Rechtefrage wäre eine Tür neben der Tür: er läuft am Eigentümer vorbei
     -- an jeder Policy, und `security definer` heisst nicht „ohne Bedingung".
     and app.hat_recht('kalkulation.lesen', app.aktiver_mandant())
   group by z.projekt_id
$$;

comment on function app.projekt_lohnkosten(date, date) is
  'REP-05, K-05. Lohnkosten je Projekt als SUMME — der Stundensatz selbst bleibt cse_app '
  'entzogen. Verlangt kalkulation.lesen im aktiven Mandanten.';

alter function app.projekt_lohnkosten(date, date) owner to cse_definer;
revoke execute on function app.projekt_lohnkosten(date, date) from public;
grant execute on function app.projekt_lohnkosten(date, date) to cse_app;

-- Und die Spalte, die nur DIESE Funktion lesen darf.
grant select (person_id, mandant_id, geloescht_am, stundensatz_intern)
  on public.anstellung to cse_definer;
grant select on public.zeiteintrag to cse_definer;
grant execute on function app.aktiver_mandant() to cse_definer;


/**
 * **Die Auftragssumme ist ebenso entzogen — und aus demselben Grund.**
 *
 * `cse_app` hat auf `projekt` Spaltenrechte: `nummer`, `bezeichnung`, `status`
 * und die Termine ja, **`auftragssumme_netto_cent` und
 * `sicherheitseinbehalt_bp` nein** (K-05, D-92: ein Leistungswert ist ein
 * Geschäftsgeheimnis). Ein `select pr.auftragssumme_netto_cent` weist Postgres
 * mit „permission denied for table projekt" ab — die ganze Anweisung, nicht
 * die Spalte.
 *
 * Diese Funktion gibt die vier Zahlen zusammen heraus, die eine Marge
 * ausmachen, und nichts daneben: Auftragssumme, bereits berechnet, Lohn,
 * Fremdleistung. Wer sie hat, kann die Marge rechnen; den Stundensatz eines
 * einzelnen Menschen kann er daraus nicht zurückrechnen.
 *
 * Zwei Tore, dieselben wie bei `app.leistungswerte_lesen`: nur im INTERNEN
 * Portal (K-04 — ein Kundenzugang hat hier nichts zu suchen) und nur mit
 * `kalkulation.lesen`, genau dem Recht, das die Berichtsroute verlangt.
 */
create function app.projekt_kennzahlen(p_von date, p_bis date)
returns table (
  projekt_id uuid,
  auftragssumme_cent bigint,
  berechnet_cent bigint,
  lohn_cent bigint,
  fremd_cent bigint
)
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
begin
  if app.portal() <> 'intern' then
    raise exception 'Projektkennzahlen sind ausserhalb des internen Portals nicht lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('kalkulation.lesen', app.aktiver_mandant()) then
    raise exception 'kalkulation.lesen fehlt' using errcode = 'insufficient_privilege';
  end if;

  return query
    select pr.id,
           coalesce(pr.auftragssumme_netto_cent, 0)::bigint,
           coalesce((select sum(r.netto_gesamt_cent) from public.rechnung r
                      where r.projekt_id = pr.id
                        and r.status = 'festgeschrieben'), 0)::bigint,
           coalesce((select lk.lohn_cent from app.projekt_lohnkosten(p_von, p_bis) lk
                      where lk.projekt_id = pr.id), 0)::bigint,
           coalesce((select sum(e.netto_cent) from public.eingangsrechnung e
                      where e.projekt_id = pr.id
                        and e.status in ('freigegeben', 'gebucht')), 0)::bigint
      from public.projekt pr
     where pr.mandant_id = app.aktiver_mandant()
       and pr.archiviert_am is null;
end
$$;

comment on function app.projekt_kennzahlen(date, date) is
  'REP-05, K-05, D-92. Auftragssumme, Berechnetes, Lohn und Fremdleistung je Projekt — die '
  'geschuetzten Spalten selbst bleiben cse_app entzogen. Intern und mit kalkulation.lesen.';

alter function app.projekt_kennzahlen(date, date) owner to cse_definer;
revoke execute on function app.projekt_kennzahlen(date, date) from public;
grant execute on function app.projekt_kennzahlen(date, date) to cse_app;

grant select on public.projekt, public.rechnung, public.eingangsrechnung to cse_definer;
grant execute on function app.portal() to cse_definer;
grant execute on function app.hat_recht(text, uuid) to cse_definer;

/**
 * **Ein Grant allein reicht nicht — RLS steht auf FORCE.**
 *
 * `projekt` und `eingangsrechnung` fuehren `force row level security`: die
 * Policies gelten auch fuer den Eigentuemer und damit auch fuer `cse_definer`.
 * Beide Tabellen kannten fuer diese Rolle bisher KEINE Policy — `zeiteintrag`
 * (`z_definer_lesen`, 0034), `anstellung` (`a_definer`) und `rechnung`
 * (`d_rechnung_lesen`) schon. Die Folge war kein Fehler, sondern eine LEERE
 * Menge: `app.projekt_kennzahlen` gab null Zeilen zurueck, der Bericht zeigte
 * „keine Projekte im Zeitraum", und niemand haette gemerkt, dass das eine
 * Rechteluecke und keine Aussage ueber Projekte war.
 *
 * `using (true)` ist hier richtig und nicht zu weit: die Funktion filtert
 * selbst auf `app.aktiver_mandant()` und traegt ihre beiden Tore (internes
 * Portal, `kalkulation.lesen`) oben. Die Policy oeffnet die Tabelle fuer
 * `cse_definer`, nicht fuer `cse_app` — und `cse_definer` erreicht man nur
 * durch eine dieser Funktionen.
 */
create policy d_projekt_kennzahlen on public.projekt
  for select to cse_definer using (true);

create policy d_eingangsrechnung_kennzahlen on public.eingangsrechnung
  for select to cse_definer using (true);
