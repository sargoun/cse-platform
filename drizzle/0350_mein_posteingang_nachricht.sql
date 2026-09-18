-- 0350 — Der Posteingang der Kraft: `nachricht` erreicht das Mitarbeiterportal
--        (EMP-11, NOT-03, D-09, K-05, K-18, AUT-06, Invariante 7, Invariante 8).
--
-- ===========================================================================
-- Der Befund — nachgemessen, aus dem Betrieb gemeldet
-- ===========================================================================
--
-- Die Gruppenleitung schrieb aus `/portal/[mandant]/nachrichten` eine interne
-- Nachricht an eine Mitarbeiterin. Die Oberflaeche meldete „gesendet". In
-- ihrem Konto kam nichts an.
--
-- Der Grund ist KEIN Policy-Fehler und keine falsche Empfaengerart. Er ist
-- banaler und schlimmer: der Sendeweg schreibt in `nachricht` +
-- `nachricht_empfaenger`, und `/portal/mein/nachrichten` liest
-- `benachrichtigung` — Waechter-, Ablauf- und Fristmeldungen. **Zwei
-- verschiedene Tabellen.** Der persoenliche Posteingang KONNTE eine Nachricht
-- gar nicht anzeigen; er hat auch nie behauptet, es zu tun. Das Kundenportal
-- las ueber `services/kundenportal/nachricht` die richtige Tabelle — der Weg
-- zum KUNDEN funktionierte, der zur KRAFT nicht.
--
-- Die RLS auf `nachricht` und `nachricht_empfaenger` ist dabei in Ordnung und
-- war es seit `0231`: `t_nachricht_eigene` und `t_empfaenger_eigene` binden je
-- Empfaengerart, `person` gegen `app.aktuelle_person()` und `benutzer` gegen
-- `app.aktueller_benutzer()` — die zwei verschiedenen Ids aus D-09, vor denen
-- der Kommentar am Enum `nachricht_empfaenger_typ` ausdruecklich warnt.
-- `tests/isolation/nachricht-faden.test.ts` (5) beweist beide Richtungen
-- bereits. Diese Migration aendert daran NICHTS und darf es nicht.
--
-- ===========================================================================
-- Was hier trotzdem in der Datenbank fehlte
-- ===========================================================================
--
-- 1. **Der Name des Absenders.** `t_benutzer_lesen` (0007) gibt einer
--    Mitarbeitersitzung genau EINE Zeile heraus: die eigene. Im Personen-Scope
--    ist `app.aktiver_mandant()` NULL (K-20), der dritte Zweig also falsch.
--    Ein `left join benutzer` im Posteingang der Kraft liefert deshalb
--    stillschweigend NULL, und auf dem Telefon stuende „Nachricht von —".
--
--    Der naheliegende Weg — eine permissive Policy auf `benutzer` fuer den
--    Personen-Scope — ist hier der falsche: RLS ist zeilen-, nicht
--    spaltenweise. Eine Reinigungskraft bekaeme mit dem NAMEN auch
--    `email`, `gesperrt_bis`, `letzte_ip` und `globale_rolle_id` jedes
--    Kontos ihrer Gesellschaften. Es entsteht deshalb eine Definer-Funktion,
--    die GENAU EINEN TEXT herausgibt — und nur an jemanden, der im Faden
--    steht (K-05: „drei Spalten, nicht die Tabelle").
--
-- 2. **Der Rueckweg.** Ein Faden, der nur in eine Richtung traegt, ist kein
--    Faden. Antworten kann die Kraft grundsaetzlich: `nachricht.versenden` ist
--    im Rechtekatalog (0008) an die Rolle `mitarbeiter` gebunden, und
--    `t_nachricht_mandant` / `t_empfaenger_mandant` pruefen im `with check`
--    genau diesen Schluessel. Was fehlte, war die EMPFAENGERZEILE der
--    Antwort: `p_beteiligt` auf `nachricht_empfaenger` (0231) laesst
--    ausserhalb des internen Portals nur Zeilen zu, die auf MICH zeigen — die
--    Antwort an die Absenderin scheitert daran. Ohne sie kaeme die Antwort im
--    Posteingang der Leitung nicht als ungelesen an.
--
-- **Was hier NICHT entsteht:** kein neuer Rechteschluessel (K-19). „Im Faden
-- antworten, in dem ich stehe" ist Selbstzugriff — ein Recht gehoert einer
-- Rolle und eine Rolle vielen Menschen, „nur die Beteiligte" laesst sich so
-- nicht sagen. Und kein Weg nach draussen: `richtung = 'intern'`,
-- `kanal = 'portal'`. Was das Haus verlaesst, laeuft weiter ueber
-- `sendeNachAussen`, `kern.nachricht_sendetor()` und die Freigabekette
-- (Invariante 7) — und ueber keinen verbundenen Versender (O-36).

-- ---------------------------------------------------------------------------
-- 1. Was `cse_definer` auf den zwei Tabellen sehen darf
-- ---------------------------------------------------------------------------

/**
 * **Vier Ids und ein Loeschstempel — kein Inhalt** (K-05).
 *
 * `0231` gab `cse_definer` bewusst nur `(mandant_id, id, thread_id)` auf
 * `nachricht` und begruendet es: ein Grant auf die ganze Tabelle waere ein
 * zweiter Lesepfad auf Nachrichtentexte neben RLS, und der erste, den eine
 * Policy-Aenderung vergisst. Diese Migration haelt sich daran. Sie braucht
 * zusaetzlich, WER geschrieben hat (drei Absenderspalten) und OB die Zeile
 * weich geloescht ist — Angaben, aus denen sich kein Satz des Briefes
 * rekonstruieren laesst. `koerper`, `betreff`, `rechtsgrundlage` und `zweck`
 * bleiben draussen.
 */
grant select (absender_benutzer_id, absender_agent_id, absender_extern, geloescht_am)
  on nachricht to cse_definer;

/**
 * Und auf `nachricht_empfaenger` genau die vier Spalten, die die Frage
 * „steht dieser Mensch in diesem Faden" beantworten. `gelesen_am`,
 * `zugestellt_am` und `extern_email` gehoeren nicht dazu.
 *
 * Unter FORCE RLS ist ein Grant ohne Policy keine Leseerlaubnis, sondern null
 * Zeilen — schweigend. Die Policy steht deshalb daneben, wie bei
 * `d_nachricht_faden` (0231).
 */
grant select (mandant_id, nachricht_id, empfaenger_typ, empfaenger_id)
  on nachricht_empfaenger to cse_definer;

create policy d_nachricht_empfaenger_faden on nachricht_empfaenger
  for select to cse_definer using (true);

-- ---------------------------------------------------------------------------
-- 2. „Stehe ich in diesem Faden?" — und „habe ich das selbst geschrieben?"
-- ---------------------------------------------------------------------------

/**
 * **Die Sitzung wird GELESEN, nicht uebergeben.**
 *
 * Beide Funktionen ziehen `app.aktueller_benutzer()` und
 * `app.aktuelle_person()` selbst aus den GUCs. Als Parameter waeren sie eine
 * Behauptung des Aufrufers: wer die Funktion mit einer fremden Id aufruft,
 * bekaeme die Antwort fuer einen fremden Menschen. Dieselbe Begruendung, mit
 * der `kern.nachricht_sendetor()` (0231) die Rechtsgrundlage selbst zieht
 * statt sie entgegenzunehmen.
 *
 * **`plpgsql` und nicht `sql`** — mit Absicht. Eine einfache SQL-Funktion
 * kann der Planer in den Aufrufer einbauen; stuende der Rumpf danach in einer
 * Policy auf `nachricht_empfaenger` und laese `nachricht`, dessen Policy
 * wiederum `nachricht_empfaenger` liest, bricht Postgres mit „infinite
 * recursion detected in policy for relation" ab — zur LAUFZEIT, bei der
 * ersten Abfrage. `0255` beschreibt genau diesen Ringverweis. Eine
 * `security definer`-Funktion baut der Planer ohnehin nicht ein; `plpgsql`
 * macht es zusaetzlich unmoeglich, falls die Funktion je ihren Definer
 * verliert.
 */
create function kern.nachricht_faden_beteiligt(p_mandant uuid, p_thread uuid)
returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare
  v_benutzer uuid := app.aktueller_benutzer();
  v_person   uuid := app.aktuelle_person();
begin
  if p_mandant is null or p_thread is null then return false; end if;
  if v_benutzer is null and v_person is null then return false; end if;

  return exists (
    select 1
      from public.nachricht n
     where n.mandant_id = p_mandant
       and n.thread_id = p_thread
       and (n.absender_benutzer_id = v_benutzer
            or exists (select 1
                         from public.nachricht_empfaenger e
                        where e.mandant_id = n.mandant_id
                          and e.nachricht_id = n.id
                          and ((e.empfaenger_typ = 'benutzer'
                                and e.empfaenger_id = v_benutzer)
                            or (e.empfaenger_typ = 'person'
                                and e.empfaenger_id = v_person)))));
end
$$;

comment on function kern.nachricht_faden_beteiligt(uuid, uuid) is
  'EMP-11, D-09. Steht die angemeldete Sitzung in diesem Faden — als Absenderin oder als '
  'Empfaengerin? Prueft `benutzer` gegen die Anmelde-Id UND `person` gegen die '
  'Personen-Id; das sind zwei verschiedene Ids (0231, Kommentar am Enum). Gibt einen '
  'Wahrheitswert heraus, nie einen Inhalt.';

alter function kern.nachricht_faden_beteiligt(uuid, uuid) owner to cse_definer;
revoke execute on function kern.nachricht_faden_beteiligt(uuid, uuid) from public;
grant execute on function kern.nachricht_faden_beteiligt(uuid, uuid) to cse_app;

/**
 * Habe ich diese EINE Zeile selbst verfasst?
 *
 * Schmaler als `kern.nachricht_faden_beteiligt`, und das ist der Zweck: sie
 * steht gleich in einer RESTRIKTIVEN Policy, und eine Decke soll die engste
 * wahre Bedingung tragen, nicht die bequemste.
 */
create function kern.nachricht_selbst_verfasst(p_mandant uuid, p_nachricht uuid)
returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare v_benutzer uuid := app.aktueller_benutzer();
begin
  if p_mandant is null or p_nachricht is null or v_benutzer is null then
    return false;
  end if;
  return exists (select 1 from public.nachricht n
                  where n.mandant_id = p_mandant and n.id = p_nachricht
                    and n.absender_benutzer_id = v_benutzer);
end
$$;

comment on function kern.nachricht_selbst_verfasst(uuid, uuid) is
  'EMP-11. Ist die angemeldete Sitzung die Absenderin dieser Nachricht? Fuer die '
  'restriktive Decke auf `nachricht_empfaenger`: wer schreibt, darf sagen, an wen.';

alter function kern.nachricht_selbst_verfasst(uuid, uuid) owner to cse_definer;
revoke execute on function kern.nachricht_selbst_verfasst(uuid, uuid) from public;
grant execute on function kern.nachricht_selbst_verfasst(uuid, uuid) to cse_app;

-- ---------------------------------------------------------------------------
-- 3. Der Name des Absenders — ein Text, kein Lesepfad auf `benutzer`
-- ---------------------------------------------------------------------------

/**
 * **Wer mir geschrieben hat, darf auf dem Bildschirm stehen** (EMP-11).
 *
 * Die Funktion gibt den Anzeigenamen der Absenderin einer Nachricht heraus —
 * und nur, wenn die fragende Sitzung in DEREN Faden steht. Ohne diese
 * Bedingung waere sie ein Orakel: wer uuids durchprobiert, erfuehre, welche
 * Konten es gibt und wie sie heissen.
 *
 * `coalesce` in derselben Reihenfolge wie `listeFaeden` und `ladeFaden` in
 * `services/kern/nachricht.ts`: Konto, Agent, externe Adresse. Zwei
 * Reihenfolgen fuer dieselbe Frage liefen auseinander, und dann hiesse
 * derselbe Absender im internen Posteingang anders als im persoenlichen.
 *
 * NULL heisst „gibt es nicht ODER darf diese Sitzung nicht sehen" — dieselbe
 * Antwort auf beides (AUT-06). Die Seite zeigt dafuer einen Platzhalter und
 * nie eine Fehlermeldung: eine Nachricht ohne aufloesbaren Absender ist
 * lesbar, nur eben ohne Namen.
 */
create function kern.nachricht_absender_name(p_nachricht uuid)
returns text
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant  uuid;
  v_thread   uuid;
  v_benutzer uuid;
  v_agent    uuid;
  v_extern   text;
  v_name     text;
begin
  if p_nachricht is null then return null; end if;

  select n.mandant_id, n.thread_id, n.absender_benutzer_id, n.absender_agent_id,
         n.absender_extern
    into v_mandant, v_thread, v_benutzer, v_agent, v_extern
    from public.nachricht n
   where n.id = p_nachricht;

  if v_mandant is null then return null; end if;
  if not kern.nachricht_faden_beteiligt(v_mandant, v_thread) then return null; end if;

  if v_benutzer is not null then
    select b.name into v_name from public.benutzer b where b.id = v_benutzer;
  end if;
  if v_name is null and v_agent is not null then
    select a.name into v_name from public.agent a where a.id = v_agent;
  end if;
  return coalesce(v_name, v_extern);
end
$$;

comment on function kern.nachricht_absender_name(uuid) is
  'EMP-11, K-05. Der Anzeigename der Absenderin EINER Nachricht — an eine Sitzung, die '
  'in deren Faden steht. Ein Text statt eines Lesepfades auf `benutzer`: RLS ist '
  'zeilenweise, und eine Policy fuer den Namen gaebe auch E-Mail, Sperrfrist und '
  'globale Rolle heraus.';

alter function kern.nachricht_absender_name(uuid) owner to cse_definer;
revoke execute on function kern.nachricht_absender_name(uuid) from public;
grant execute on function kern.nachricht_absender_name(uuid) to cse_app;

-- ---------------------------------------------------------------------------
-- 4. Die Decke auf `nachricht_empfaenger` — um die Verfasserin erweitert
-- ---------------------------------------------------------------------------

/**
 * **Wer eine Nachricht schreibt, darf sagen, an wen sie geht.**
 *
 * `p_beteiligt` (0231) laesst ausserhalb des internen Portals nur
 * Empfaengerzeilen zu, die auf den Anmeldenden selbst zeigen. Das ist fuer
 * das LESEN genau richtig — eine Kraft soll den internen Verteiler einer
 * Nachricht nicht kennen (04-SEITENKARTE §8: dem Kunden ist das ganze
 * `personal`-Modul verschlossen, und dieselbe Decke traegt den Fall).
 *
 * Fuer das SCHREIBEN war es zu eng, und zwar auf eine Weise, die man erst am
 * Ergebnis sieht: eine Policy mit `using` und ohne `with check` benutzt ihr
 * `using` auch als `with check` (Postgres). Die Antwort der Kraft an die
 * Leitung brauchte also eine Empfaengerzeile, die auf die LEITUNG zeigt — und
 * die war nicht einfuegbar. Ohne sie kommt die Antwort im Posteingang der
 * Leitung nicht als ungelesen an: `listeFaeden` zaehlt nur eigene
 * Empfaengerzeilen. Der Faden traegt dann in eine Richtung.
 *
 * Der neue Zweig ist die engste wahre Bedingung dafuer: die Zeile gehoert zu
 * einer Nachricht, die DIESE Sitzung verfasst hat. Er oeffnet nichts Neues —
 * wer eine Nachricht anlegen darf (`nachricht.versenden`, im Katalog an
 * `mitarbeiter` gebunden), bestimmt ohnehin deren Empfaenger; er macht nur
 * die zweite Haelfte derselben Handlung moeglich. Fuer das Kundenportal
 * aendert sich nichts: dort gibt es keinen Schreibweg (O-74), also nie eine
 * selbst verfasste Zeile.
 *
 * `drop` und `create` in einer NEUEN Datei — `0231` bleibt unveraendert.
 * Zwischen beiden Anweisungen liegt keine Sekunde ohne Decke: die Migration
 * laeuft in einer Transaktion.
 */
drop policy p_beteiligt on nachricht_empfaenger;

create policy p_beteiligt on nachricht_empfaenger as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (empfaenger_typ = 'benutzer'        and empfaenger_id = app.aktueller_benutzer())
         or (empfaenger_typ = 'person'          and empfaenger_id = app.aktuelle_person())
         or (empfaenger_typ = 'ansprechpartner' and empfaenger_id in
               (select a.id from ansprechpartner a
                 where a.kunde_id = any (app.aktuelle_kunden())))
         or kern.nachricht_selbst_verfasst(mandant_id, nachricht_id));

comment on policy p_beteiligt on nachricht_empfaenger is
  '§7.9, B11 (0231), erweitert in 0350: ausserhalb des internen Portals sieht und '
  'schreibt jemand nur Empfaengerzeilen, die auf ihn zeigen — oder die zu einer '
  'Nachricht gehoeren, die er selbst verfasst hat. Der zweite Fall ist die Antwort der '
  'Kraft an die Leitung (EMP-11).';

-- ---------------------------------------------------------------------------
-- 5. Der Index, den der persoenliche Posteingang wirklich stellt
-- ---------------------------------------------------------------------------

/**
 * „Meine Faeden, die neueste Aktivitaet zuerst" — ueber ALLE Gesellschaften,
 * in denen dieser Mensch beschaeftigt ist (D-09, EMP-14).
 *
 * `nachricht_thread_idx` (0231) beginnt mit `mandant_id` und hilft dabei
 * nicht: der Personen-Scope fragt nie nach genau einem Bereich. Der neue
 * Index deckt die Sortierung, `ne_empfaenger_idx` (0231) deckt die
 * Empfaengerseite.
 */
create index nachricht_faden_zeit_idx
  on nachricht (thread_id, erstellt_am desc)
  where geloescht_am is null;
