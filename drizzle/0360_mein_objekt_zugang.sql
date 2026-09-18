-- 0360 — Der Zutritt zum eigenen Objekt: Zutrittshinweis und Ansprechpartner
--        im Mitarbeiterportal (EMP-02, OPS-01, K-04, K-05, K-18, AUT-06).
--
-- ===========================================================================
-- Wofuer — und warum es dafuer eine Migration braucht
-- ===========================================================================
--
-- `/portal/mein/objekte` und `/portal/mein/objekte/[id]` zeigen die Objekte,
-- auf denen dieser Mensch arbeitet: Anschrift, ZUTRITTSHINWEIS und
-- Ansprechpartner (04-SEITENKARTE §7, Zeile 2151). Zwei der drei Angaben
-- kommen im Personen-Scope heute NICHT durch, und zwar aus zwei verschiedenen
-- Gruenden:
--
--  1. **`objekt.zutritt_hinweis` ist `cse_app` als SPALTE entzogen** (0021,
--     K-05: „In der einen steht, wo der Schluessel liegt"). Der einzige Leser
--     ist `app.objekt_notiz_lesen()`, und der verlangt `app.portal() =
--     'intern'` UND `objekt.lesen` — beides hat eine Reinigungskraft nicht.
--     Eine Abfrage auf die Spalte scheitert hart an „permission denied for
--     column"; ein `select *` auf `objekt` ebenso. Das ist kein Versehen der
--     Seite, das ist die Decke.
--
--  2. **`ansprechpartner` traegt gar keine Personen-Policy** (0020: t_mandant,
--     t_gruppe, t_kunde, p_kunde_decke). Im Personen-Scope ist
--     `app.aktiver_mandant()` NULL (K-20), also greift keine — die Kraft liest
--     null Zeilen, ohne Fehler. Auf dem Telefon stuende „Ansprechpartner: —",
--     und niemand wuesste, ob keiner hinterlegt ist oder ob er nur nicht
--     lesbar war (AUT-05).
--
-- ===========================================================================
-- Die Sichtbarkeitsregel wird NICHT neu erfunden
-- ===========================================================================
--
-- Ein Schluessel- oder Alarmcode gehoert dem, der dort eingeteilt IST — und
-- nur, solange er es ist. Genau diese Aussage steht seit 0069 in der
-- Datenbank und traegt schon die Schichtseiten:
--
--     app.ist_eingesetzt_auf_objekt(p_objekt)
--       → p_objekt = any (app.eigene_einsatz_objekte())
--       → eigene, nicht entfernte, nicht abgesagte Zuordnung
--         auf einem nicht stornierten Einsatz mit `ende_zeitpunkt >= now()`
--
-- Dieselbe Funktion entscheidet in `leistungsnachweis.p_portal_decke`,
-- `projekt.p_portal_decke` und in `objekt.t_selbst_m1` (0300). Eine zweite,
-- hier ausformulierte Bedingung waere die, die irgendwann etwas anderes sagt
-- als das Tor — die Kraft saehe den Code eines Objekts, auf dem die Planung
-- sie nicht mehr fuehrt, oder umgekehrt.
--
-- **Das Zeitfenster ist damit ausdruecklich das der Einteilung.** Es endet mit
-- der letzten Schicht, nicht mit dem Vertrag und nicht mit dem Kalenderjahr.
-- Wie weit VOR der ersten und wie lange NACH der letzten Schicht ein Objekt
-- sichtbar bleiben soll, ist offen und gehoert zu derselben Frage, die 0069
-- schon gestellt hat:
-- // TODO(client, O-211): Wie weit im Voraus und wie lange danach darf eine
-- Kraft Zutrittshinweis und Ansprechpartner ihres Objekts sehen (SEC-05,
-- SEC-06, EMP-09)? Bis zur Antwort gilt die Grenze aus den Daten selbst: eine
-- Schicht, die noch nicht zu Ende ist.
--
-- ===========================================================================
-- Was die Funktion herausgibt — und was nicht
-- ===========================================================================
--
-- **Vier Texte, nicht die Tabelle** (K-05, dieselbe Bauart wie
-- `app.absender_name_lesen` in 0350):
--
--   zutritt_hinweis            die Anweisung, wie man hineinkommt
--   ansprechpartner_name       Vor- und Nachname des Kontakts VOR ORT
--   ansprechpartner_telefon    Festnetz
--   ansprechpartner_mobil      Mobil
--
-- **`objekt.bemerkung` bleibt draussen.** Sie ist die INTERNE Notiz zu diesem
-- Auftrag — was das Haus ueber den Kunden sagt, nicht was die Kraft zum
-- Arbeiten braucht (0021 nennt beide Spalten in einem Atemzug und meint zwei
-- verschiedene Dinge). `app.objekt_notiz_lesen` gibt beide heraus und bleibt
-- deshalb, wo sie ist: im internen Portal.
--
-- **Keine E-Mail-Adresse.** Ein Telefon vor Ort loest ein Problem vor Ort. Eine
-- Mailadresse ist ein Kanal, und Kanaele zu Kundenkontakten haengen an
-- `rechtsgrundlage`/`einwilligung_kanaele` (§7 UWG, 0020) — die entscheidet
-- der Vertrieb, nicht das Diensttelefon.
--
-- **Kein `kunde_id`, kein Kundenname, kein kaufmaennisches Feld** (EMP-13,
-- K-05). Der Kontakt steht als NAME da, ohne die Firma dahinter zu nennen.
--
-- **Ausgeschiedene und anonymisierte Kontakte fallen heraus.** Ein Name, der
-- nach Art. 17 DSGVO geloescht wurde, darf nicht ueber einen zweiten Lesepfad
-- zurueckkommen, und wer nicht mehr da ist, hilft niemandem an der Tuer.
--
-- ===========================================================================
-- K-04: ausserhalb des Mitarbeiterportals antwortet sie NICHTS
-- ===========================================================================
--
-- Die Funktion ist der Leser DIESER Seiten. Im internen Portal gibt es
-- `app.objekt_notiz_lesen` mit `objekt.lesen`; im Kundenportal hat der Kunde
-- seine eigene Sicht (0021 `t_kunde`). Ein Definer, der ueberall antwortet,
-- waere ein zweiter Weg an beiden vorbei — sie prueft `app.portal()` deshalb
-- selbst und erbt die Decke nicht.
--
-- Sie WIRFT nicht, sie gibt null Zeilen zurueck: die Seite bleibt eine Seite,
-- und „kein Hinweis hinterlegt" und „nicht mehr eingeteilt" unterscheidet sie
-- an der Stelle, an der sie den Satz dazuschreibt — nicht an einem 500er.

-- ---------------------------------------------------------------------------
-- 1. Der Lesepfad des Definers (K-01, §1.10)
-- ---------------------------------------------------------------------------

/**
 * `cse_definer` liest `objekt` — Policy UND Tabellenrecht.
 *
 * 0304 hat die Policy `d_nachweis_kopf` angelegt, das GRANT dazu aber nicht.
 * Heute faellt das nicht auf, weil die Definer aus dieser Zeit `postgres`
 * gehoeren; diese Funktion gehoert `cse_definer` (K-01), und ohne das Recht
 * scheiterte sie an „permission denied for table objekt" — an einer Stelle,
 * die mit dem Zutrittshinweis nichts zu tun zu haben scheint.
 *
 * Das SELECT-Recht geht auf die GANZE Tabelle und nicht auf Spalten: der
 * Spaltenentzug aus 0021 gilt `cse_app`, und genau deshalb gibt es diesen
 * Umweg. Was der Definer herausgibt, entscheidet sein Rumpf.
 */
grant select on objekt to cse_definer;

/**
 * Und `ansprechpartner`: das GRANT steht seit 0222 (`werbewiderspruch`), die
 * Lesepolicy dort ist aber auf den Widerspruchsweg zugeschnitten
 * (`d_ansprechpartner_widerspruch`). Ob sie `using (true)` traegt oder eine
 * Bedingung, ist fuer diese Funktion nicht verlaesslich — sie bekommt ihre
 * eigene, benannte Zeile.
 */
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'ansprechpartner'
                    and policyname = 'd_objekt_ansprechpartner') then
    create policy d_objekt_ansprechpartner on ansprechpartner
      for select to cse_definer using (true);
  end if;
end $$;

comment on policy d_objekt_ansprechpartner on ansprechpartner is
  'Lesepfad fuer app.mein_objekt_zugang (0360): der Kontakt VOR ORT im '
  'Mitarbeiterportal. Der Rumpf der Funktion entscheidet, welche Spalten und '
  'welche Zeile herauskommen — die Policy macht den Weg ueberhaupt gangbar.';

-- ---------------------------------------------------------------------------
-- 2. `app.mein_objekt_zugang` — vier Texte, eine Bedingung
-- ---------------------------------------------------------------------------

create function app.mein_objekt_zugang(p_objekt uuid)
returns table (zutritt_hinweis text,
               ansprechpartner_name text,
               ansprechpartner_telefon text,
               ansprechpartner_mobil text)
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
begin
  /*
   * K-04 zuerst: ein Definer erbt die Portaldecke nicht. Ein NULL-Argument
   * ist hier kein Sonderfall, sondern die haeufigste Form der Frage — eine
   * Schicht ohne Objekt (Veranstaltung, Springerdienst) traegt `objekt_id`
   * NULL, und `= any(...)` auf NULL ergaebe NULL statt `false`.
   */
  if p_objekt is null or app.portal() <> 'mitarbeiter' then return; end if;
  if not app.ist_eingesetzt_auf_objekt(p_objekt) then return; end if;

  return query
    select o.zutritt_hinweis,
           nullif(btrim(coalesce(a.vorname, '') || ' ' || coalesce(a.nachname, '')), ''),
           a.telefon,
           a.mobil
      from public.objekt o
      left join public.ansprechpartner a
        on a.mandant_id = o.mandant_id
       and a.id = o.ansprechpartner_id
       and a.archiviert_am is null
       and a.ausgeschieden_am is null
       and a.anonymisiert_am is null
     where o.id = p_objekt
       and o.mandant_id = any (app.sichtbare_mandanten());
end $$;

comment on function app.mein_objekt_zugang(uuid) is
  'EMP-02, OPS-01, K-05. Zutrittshinweis und Ansprechpartner VOR ORT fuer ein '
  'Objekt, auf dem der Aufrufer selbst eingeteilt ist — dieselbe Bedingung wie '
  'objekt.t_selbst_m1 und leistungsnachweis.p_portal_decke '
  '(app.ist_eingesetzt_auf_objekt, 0069). Ausserhalb des Mitarbeiterportals '
  'null Zeilen. Gibt vier Texte heraus, nie eine Zeile der Tabelle.';

revoke execute on function app.mein_objekt_zugang(uuid) from public;
grant execute on function app.mein_objekt_zugang(uuid) to cse_app;
alter function app.mein_objekt_zugang(uuid) owner to cse_definer;
