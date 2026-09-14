-- 0152 · Stapelfreigabe, Einspruchsfenster, Rückgängig (APR-04, APR-05, APR-06)
--
-- Die drei Zusagen, die dem Freigabe-Posteingang noch fehlten. Die Spalten
-- dafür stehen seit 0136 (`stapel_faehig`, `verzoegerte_freigabe_bis`,
-- `undo_bis`) — was fehlte, waren die Wege dorthin.
--
-- **Warum das nicht drei Spaltenupdates aus der Anwendung sind.** Alle drei
-- verändern eine Entscheidung, die bereits gefallen ist. Sie gehören deshalb
-- hinter Definer-Funktionen: sie prüfen das Recht ein zweites Mal, sie prüfen
-- das FENSTER (ein Einspruch nach Ablauf ist kein Einspruch), und sie
-- schreiben ins Protokoll. Ein `update freigabe set status = 'widerrufen'`
-- aus der Anwendung könnte all das umgehen.
--
-- **Und warum keine davon den Schnappschuss anfasst.** APR-07 sagt: der
-- Schnappschuss bezeugt, WAS zum Zeitpunkt der Entscheidung vorlag. Ein
-- Einspruch ändert daran nichts — er ist ein NEUES Ereignis, und deshalb
-- bekommt er eine eigene Zeile in der Kette, nicht eine Korrektur der alten.

-- ---------------------------------------------------------------------------
-- (1) Das Einspruchsfenster (APR-05)
-- ---------------------------------------------------------------------------

/**
 * Armiert das Fenster nach einer Genehmigung.
 *
 * **Nur für risikoarme Vorgänge.** APR-05 sagt „for low-risk actions", und
 * das ist keine Formulierung, sondern die Grenze: bei einem Angebot über
 * 40.000 € ist eine verzögerte Auslösung ohne Widerspruch genau die
 * Automatik, die Invariante 7 verhindert. Geprüft wird `risiko = 'niedrig'`
 * UND `stapel_faehig` — dieselbe Menge, die auch im Stapel darf.
 *
 * **Das Fenster ist ein PLATZHALTER** (O-108). Wie lange jemand widersprechen
 * können soll, entscheidet der Betrieb; die Zahl kommt als Parameter herein
 * und steht nicht hier.
 */
create function app.freigabe_verzoegern(p_freigabe uuid, p_minuten integer)
returns timestamptz
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_bis     timestamptz;
  f         record;
begin
  if v_mandant is null or app.aktueller_benutzer() is null then
    raise insufficient_privilege using message = 'Ohne Sitzung kein Einspruchsfenster.';
  end if;
  if p_minuten is null or p_minuten <= 0 then
    raise exception 'Ein Fenster von null Minuten ist kein Fenster'
      using errcode = 'check_violation';
  end if;

  select id, status, risiko, stapel_faehig, ausfuehrung_status, erforderliches_recht
    into f
    from public.freigabe
   where id = p_freigabe and mandant_id = v_mandant
     for update;
  if not found then
    raise exception 'Freigabe nicht gefunden' using errcode = 'no_data_found';
  end if;
  if not app.hat_recht(coalesce(f.erforderliches_recht, 'freigabe.entscheiden'), v_mandant) then
    raise insufficient_privilege using message = 'Kein Recht an dieser Freigabe.';
  end if;
  /*
   * **Stapelweise zu entscheiden ist eine EIGENE Befugnis** (Katalog:
   * `freigabe.stapel_entscheiden` ist an `admin` und `leitung` bindbar, nicht
   * gebunden). Wer einzeln entscheiden darf, darf deshalb nicht schon
   * fünfzig auf einmal — das ist der Unterschied zwischen einer Prüfung und
   * einem Häkchen bei „alle".
   */
  if not app.hat_recht('freigabe.stapel_entscheiden', v_mandant) then
    raise insufficient_privilege using message = 'Kein Recht auf Stapelentscheidungen.';
  end if;
  if f.status <> 'genehmigt' then
    raise exception 'Nur eine genehmigte Freigabe bekommt ein Einspruchsfenster'
      using errcode = 'check_violation';
  end if;
  if f.risiko <> 'niedrig' or not f.stapel_faehig then
    raise exception 'Verzoegerte Ausloesung gibt es nur fuer risikoarme Vorgaenge (APR-05)'
      using errcode = 'check_violation',
            hint = 'Bei erhoehtem Risiko loest ein Mensch aus, nicht eine Uhr.';
  end if;
  if f.ausfuehrung_status <> 'offen' then
    raise exception 'Diese Freigabe ist bereits ausgefuehrt' using errcode = 'check_violation';
  end if;

  /**
   * **Die Vorgangsart entscheidet der Riegel aus 0136, nicht eine zweite
   * Liste hier.** `freigabe_verzoegerung_nur_niedrig` nimmt sieben Arten von
   * der verzoegerten Ausloesung aus — ein versendetes E-Mail laeuft nicht von
   * selbst hinaus, auch wenn eine Richtlinie `niedrig` sagt. Diese Funktion
   * schreibt den Wert und laesst den Riegel antworten; dieselbe Liste ein
   * zweites Mal zu tippen hiesse, sie irgendwann abweichen zu lassen.
   *
   * **Und sie MELDET das Nein, sie wirft es nicht.** Die Stapelfreigabe ruft
   * hier fuer jede risikoarme Zeile an; ein Fehler an dieser Stelle risse die
   * ganze Transaktion mit — neunundvierzig geprueft und genehmigt, und
   * zurueckgerollt, weil die fuenfzigste kein Fenster bekommen darf. NULL
   * heisst: kein Fenster, sofort gueltig.
   */
  v_bis := now() + make_interval(mins => p_minuten);
  begin
    update public.freigabe set verzoegerte_freigabe_bis = v_bis, geaendert_am = now()
     where id = p_freigabe;
  exception when check_violation then
    return null;
  end;

  perform app.protokolliere('freigabe.verzoegert', 'freigabe', p_freigabe::text, null,
                            jsonb_build_object('bis', v_bis, 'minuten', p_minuten), v_mandant);
  return v_bis;
end $$;

comment on function app.freigabe_verzoegern(uuid, integer) is
  'APR-05. Armiert das Einspruchsfenster nach einer Genehmigung — nur fuer risikoarme, '
  'stapelfaehige Vorgaenge (D-497).';

alter function app.freigabe_verzoegern(uuid, integer) owner to cse_definer;
revoke execute on function app.freigabe_verzoegern(uuid, integer) from public;
grant execute on function app.freigabe_verzoegern(uuid, integer) to cse_app;

/**
 * Der Einspruch selbst.
 *
 * **Er muss INNERHALB des Fensters kommen.** Ein Einspruch nach Ablauf ist
 * kein Einspruch, sondern der Wunsch nach einem Rückgängig — und das ist ein
 * anderer Vorgang mit einer anderen Frage („lässt sich das noch zurückholen?").
 * Die Prüfung steht hier und nicht in der Oberfläche: zwischen dem Anzeigen
 * eines Knopfes und seinem Drücken vergeht Zeit.
 *
 * **Ein Einspruch braucht einen Grund.** Wer eine gefallene Entscheidung
 * zurückholt, schuldet den anderen Beteiligten eine Erklärung — in einem
 * halben Jahr ist „warum wurde das damals gestoppt" eine echte Frage.
 */
create function app.freigabe_einspruch(p_freigabe uuid, p_grund text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_ich     uuid := app.aktueller_benutzer();
  f         record;
  v_grund   text := nullif(btrim(coalesce(p_grund, '')), '');
begin
  if v_mandant is null or v_ich is null then
    raise insufficient_privilege using message = 'Ohne Sitzung kein Einspruch.';
  end if;
  if v_grund is null or length(v_grund) < 5 then
    raise exception 'Ein Einspruch braucht einen Grund'
      using errcode = 'check_violation',
            hint = 'In einem halben Jahr ist „warum wurde das gestoppt" eine echte Frage.';
  end if;

  select id, status, verzoegerte_freigabe_bis, ausfuehrung_status, erforderliches_recht
    into f
    from public.freigabe
   where id = p_freigabe and mandant_id = v_mandant
     for update;
  if not found then
    raise exception 'Freigabe nicht gefunden' using errcode = 'no_data_found';
  end if;
  if not app.hat_recht(coalesce(f.erforderliches_recht, 'freigabe.entscheiden'), v_mandant) then
    raise insufficient_privilege using message = 'Kein Recht an dieser Freigabe.';
  end if;
  /* Einspruch ist eine eigene, bindbare Befugnis (Katalog). */
  if not app.hat_recht('freigabe.einspruch_erheben', v_mandant) then
    raise insufficient_privilege using message = 'Kein Recht, Einspruch zu erheben.';
  end if;
  if f.verzoegerte_freigabe_bis is null then
    raise exception 'Diese Freigabe hat kein Einspruchsfenster'
      using errcode = 'check_violation';
  end if;
  if f.verzoegerte_freigabe_bis <= now() then
    raise exception 'Das Einspruchsfenster ist abgelaufen'
      using errcode = 'check_violation',
            hint = 'Nach Ablauf hilft nur noch das Ruecknahmefenster (APR-06), falls es laeuft.';
  end if;
  if f.ausfuehrung_status <> 'offen' then
    raise exception 'Diese Freigabe ist bereits ausgefuehrt' using errcode = 'check_violation';
  end if;

  update public.freigabe
     set status = 'widerrufen', begruendung = v_grund,
         verzoegerte_freigabe_bis = null, geaendert_am = now()
   where id = p_freigabe;

  perform app.protokolliere('freigabe.einspruch', 'freigabe', p_freigabe::text,
                            jsonb_build_object('status', f.status),
                            jsonb_build_object('status', 'widerrufen', 'von', v_ich),
                            v_mandant);
  return true;
end $$;

comment on function app.freigabe_einspruch(uuid, text) is
  'APR-05. Der Einspruch INNERHALB des Fensters — mit Grund, und nur solange nichts '
  'ausgefuehrt ist (D-497).';

alter function app.freigabe_einspruch(uuid, text) owner to cse_definer;
revoke execute on function app.freigabe_einspruch(uuid, text) from public;
grant execute on function app.freigabe_einspruch(uuid, text) to cse_app;

-- ---------------------------------------------------------------------------
-- (2) Das Rücknahmefenster (APR-06)
-- ---------------------------------------------------------------------------

/**
 * Setzt das Rücknahmefenster nach einer Ausführung — **nur wo umkehrbar**.
 *
 * APR-06 sagt „wherever the action is reversible", und das ist die ganze
 * Bedingung. Ein versendetes E-Mail ist nicht umkehrbar; ein angelegter
 * Entwurf schon. Welche Vorgangsart in welche Gruppe fällt, entscheidet der
 * Aufrufer — diese Funktion setzt nur das Fenster und besteht darauf, dass
 * die Ausführung überhaupt stattgefunden hat.
 */
create function app.freigabe_ruecknahme_fenster(p_freigabe uuid, p_minuten integer)
returns timestamptz
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_bis     timestamptz;
  f         record;
begin
  if v_mandant is null then
    raise insufficient_privilege using message = 'Ohne Sitzung kein Ruecknahmefenster.';
  end if;
  select id, ausfuehrung_status into f
    from public.freigabe where id = p_freigabe and mandant_id = v_mandant for update;
  if not found then
    raise exception 'Freigabe nicht gefunden' using errcode = 'no_data_found';
  end if;
  if f.ausfuehrung_status <> 'ausgefuehrt' then
    raise exception 'Ein Ruecknahmefenster gibt es erst nach der Ausfuehrung'
      using errcode = 'check_violation';
  end if;
  v_bis := now() + make_interval(mins => greatest(p_minuten, 1));
  update public.freigabe set undo_bis = v_bis, geaendert_am = now() where id = p_freigabe;
  return v_bis;
end $$;

alter function app.freigabe_ruecknahme_fenster(uuid, integer) owner to cse_definer;
revoke execute on function app.freigabe_ruecknahme_fenster(uuid, integer) from public;
grant execute on function app.freigabe_ruecknahme_fenster(uuid, integer) to cse_app, cse_job;

/**
 * Die Rücknahme.
 *
 * **Sie macht die Ausführung rückgängig, nicht die Entscheidung.** Die
 * Freigabe bleibt genehmigt, ihr Schnappschuss bleibt, was er war (APR-07) —
 * `ausfuehrung_status` geht auf `zurueckgenommen`. Wer die Entscheidung
 * selbst umkehren will, braucht eine neue Freigabe; das ist §4.5, und es ist
 * ein anderer Vorgang.
 *
 * **Die fachliche Umkehrung passiert NICHT hier.** Diese Funktion setzt den
 * Stand; was zurückzudrehen ist — ein Entwurf, eine Zeile, ein Vorgang —
 * weiss der Dienst, der ausgeführt hat. Eine Datenbankfunktion, die alle
 * Fachwege rückwärts kennt, wäre eine zweite Fassung jedes dieser Wege.
 */
create function app.freigabe_ruecknahme(p_freigabe uuid, p_grund text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_ich     uuid := app.aktueller_benutzer();
  f         record;
  v_grund   text := nullif(btrim(coalesce(p_grund, '')), '');
begin
  if v_mandant is null or v_ich is null then
    raise insufficient_privilege using message = 'Ohne Sitzung keine Ruecknahme.';
  end if;
  if v_grund is null or length(v_grund) < 5 then
    raise exception 'Eine Ruecknahme braucht einen Grund' using errcode = 'check_violation';
  end if;

  select id, ausfuehrung_status, undo_bis, erforderliches_recht into f
    from public.freigabe where id = p_freigabe and mandant_id = v_mandant for update;
  if not found then
    raise exception 'Freigabe nicht gefunden' using errcode = 'no_data_found';
  end if;
  if not app.hat_recht(coalesce(f.erforderliches_recht, 'freigabe.entscheiden'), v_mandant) then
    raise insufficient_privilege using message = 'Kein Recht an dieser Freigabe.';
  end if;
  /* Rückgängig ist eine eigene, bindbare Befugnis (Katalog). */
  if not app.hat_recht('freigabe.rueckgaengig', v_mandant) then
    raise insufficient_privilege using message = 'Kein Recht auf Ruecknahmen.';
  end if;
  if f.ausfuehrung_status <> 'ausgefuehrt' then
    raise exception 'Nur eine ausgefuehrte Freigabe laesst sich zuruecknehmen'
      using errcode = 'check_violation';
  end if;
  if f.undo_bis is null or f.undo_bis <= now() then
    raise exception 'Das Ruecknahmefenster ist abgelaufen oder gab es nie'
      using errcode = 'check_violation',
            hint = 'Eine Korrektur ist dann eine NEUE Freigabe (§4.5).';
  end if;

  update public.freigabe
     set ausfuehrung_status = 'zurueckgenommen', ausfuehrung_fehler = v_grund,
         undo_bis = null, geaendert_am = now()
   where id = p_freigabe;

  perform app.protokolliere('freigabe.zurueckgenommen', 'freigabe', p_freigabe::text,
                            jsonb_build_object('ausfuehrung', 'ausgefuehrt'),
                            jsonb_build_object('ausfuehrung', 'zurueckgenommen', 'von', v_ich),
                            v_mandant);
  return true;
end $$;

comment on function app.freigabe_ruecknahme(uuid, text) is
  'APR-06. Nimmt die AUSFUEHRUNG zurueck, nicht die Entscheidung — der Schnappschuss bleibt, '
  'was er war (APR-07, D-497).';

alter function app.freigabe_ruecknahme(uuid, text) owner to cse_definer;
revoke execute on function app.freigabe_ruecknahme(uuid, text) from public;
grant execute on function app.freigabe_ruecknahme(uuid, text) to cse_app;

-- ---------------------------------------------------------------------------
-- (3) Der Nachtlauf, der abgelaufene Fenster auslöst
-- ---------------------------------------------------------------------------

/**
 * Die Indexe für beide Fenster stehen seit 0136 (`freigabe_verzoegert_idx`,
 * `freigabe_undo_idx`) — damals mit den Spalten angelegt, obwohl es noch
 * keinen Weg dorthin gab. Hier kommt nur der Lauf dazu, der sie benutzt.
 */
grant select, update on freigabe to cse_job;
create policy j_freigabe_fenster on freigabe for all to cse_job using (true) with check (true);

-- ---------------------------------------------------------------------------
-- (4) Und der Riegel, ohne den die drei Funktionen nur eine Absprache wären
-- ---------------------------------------------------------------------------

/**
 * **`cse_app` schreibt die beiden Fensterspalten nicht mehr selbst.**
 *
 * Bis hierher stand oben „ein `update freigabe set …` aus der Anwendung
 * könnte all das umgehen" — und genau das konnte sie: `0012` gab
 * `grant select, insert, update on freigabe to cse_app`, also auf JEDE Spalte,
 * und ein `update freigabe set verzoegerte_freigabe_bis = now() + '1 day'`
 * ging durch. Die Risikoprüfung, die Fensterprüfung und der Protokolleintrag
 * der drei Definer-Funktionen waren damit eine Bitte, keine Wand. Der
 * Isolationstest hat es gefunden, bevor es jemand ausnutzen musste.
 *
 * **Ein spaltenweiser `revoke` genügt dafür nicht.** Wo das Recht auf der
 * TABELLE liegt, lässt Postgres es von einer einzelnen Spalte nicht
 * abziehen — `has_column_privilege` sagt danach weiter `true`. Der einzige
 * Weg ist: das Tabellenrecht ganz zurücknehmen und die übrigen Spalten
 * einzeln wiedergeben. Was die Anwendung bisher durfte, darf sie weiterhin
 * (Zuweisung, Ausführungsstand, Bezug); die zwei Spalten, die ein Fenster
 * beschreiben, gehen nur noch durch die Funktionen.
 *
 * **Eine künftige Spalte muss ihr Recht mitbringen.** Die Liste wird hier
 * aus dem Katalog gebildet, nicht getippt — aber sie wird EINMAL gebildet.
 * Wer `freigabe` später erweitert, gibt `cse_app` das Recht auf die neue
 * Spalte in derselben Migration. Das ist die Absicht: eine Spalte an dieser
 * Tabelle ist nichts Beiläufiges.
 */
do $$
declare v_spalten text;
begin
  select string_agg(quote_ident(attname), ', ' order by attname) into v_spalten
    from pg_attribute
   where attrelid = 'public.freigabe'::regclass
     and attnum > 0 and not attisdropped
     and attname not in ('verzoegerte_freigabe_bis', 'undo_bis');
  execute 'revoke update on public.freigabe from cse_app';
  execute format('grant update (%s) on public.freigabe to cse_app', v_spalten);
end $$;

-- ---------------------------------------------------------------------------
-- (5) Der Stapel und APR-08: gesehen wurde die LISTE, und das steht so da
-- ---------------------------------------------------------------------------

/**
 * **Ein dritter Kanal: `stapel`.**
 *
 * `app.freigabe_entscheiden` weist eine Entscheidung ab, die dieser Mensch
 * nie geöffnet hat (APR-08) — zu Recht, und die Stapelfreigabe lief genau
 * dagegen: wer fünfzig Routinezeilen aus der Liste genehmigt, hat keine
 * fünfzig Detailseiten geöffnet.
 *
 * **Die Lösung ist nicht, den Riegel zu lockern, sondern die Wahrheit
 * aufzuschreiben.** In der Liste steht je Zeile, was APR-02 verlangt: Titel,
 * Kopfzeile, Einstufung, Frist, Betrag. Das IST eine Ansicht — eine andere
 * als die Detailseite, und deshalb bekommt sie einen eigenen Namen. Wer
 * später fragt „wie hat diese Person das gesehen", liest `stapel` und weiss
 * es, statt ein `web` zu lesen, das nicht stimmt.
 *
 * **Und die Prüfdauer wird dadurch nicht geschönt.** Sie ist bei einer
 * Stapelzeile nahe null, und genau das soll sie sein: APR-08 will sichtbar
 * machen, wie schnell entschieden wurde — nicht, dass es schnell ging,
 * sondern DASS es so aussieht. Die Verteilung unten weist den Stapelanteil
 * deshalb getrennt aus: ein Stapel ist kein Durchwinken, und ein
 * Durchwinken ist kein Stapel.
 */
alter table freigabe_ansicht drop constraint freigabe_ansicht_kanal_check;
alter table freigabe_ansicht add constraint freigabe_ansicht_kanal_check
  check (kanal is null or kanal in ('web', 'mobil', 'stapel'));

/**
 * Die Verteilung der Prüfdauer — **ohne Personenbezug** (APR-08, §4.9).
 *
 * `app.freigabe_pruefdauer_lesen` (0136) gibt EINEN Wert zu EINEM
 * Schnappschuss. Was APR-08 darüber hinaus verlangt — „flag consistent
 * sub-3-second approvals" — ist eine Auswertung ÜBER einen Menschen, und die
 * bleibt bis zur Antwort auf **O-06** aus: sie wäre Verhaltens- und
 * Leistungskontrolle nach § 87 Abs. 1 Nr. 6 BetrVG.
 *
 * Was ohne diese Antwort geht, ist die Verteilung über die Gesellschaft: wie
 * viele Entscheidungen in welcher Zeitspanne fielen, und wie viele davon aus
 * einem Stapel kamen. Kein Name, keine Gruppierung je Person, keine Reihung —
 * eine Zahl über alle. Sie beantwortet „wird hier durchgewunken?", ohne zu
 * beantworten „wer".
 *
 * Ohne das Recht kommen KEINE Zeilen zurück, nicht eine Ausnahme: eine
 * Ausnahme wäre selbst die Auskunft.
 */
create function app.freigabe_pruefdauer_verteilung()
returns table (eimer text, anzahl bigint, davon_stapel bigint)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare v_mandant uuid := app.aktiver_mandant();
begin
  if v_mandant is null then return; end if;
  if not app.hat_recht('freigabe.pruefdauer_lesen', v_mandant) then return; end if;

  return query
    select b.eimer, count(*)::bigint, count(*) filter (where b.aus_stapel)::bigint
      from (
        select case
                 when s.pruefdauer_sek is null then 'unbekannt'
                 when s.pruefdauer_sek < 3   then 'unter_3s'
                 when s.pruefdauer_sek < 10  then 'unter_10s'
                 when s.pruefdauer_sek < 60  then 'unter_60s'
                 else 'ab_60s'
               end as eimer,
               exists (select 1 from public.freigabe_ansicht a
                        where a.freigabe_id = s.freigabe_id
                          and a.benutzer_id = s.entschieden_von
                          and a.kanal = 'stapel') as aus_stapel
          from public.freigabe_snapshot s
         where s.mandant_id = v_mandant
      ) b
     group by b.eimer;
end $$;

comment on function app.freigabe_pruefdauer_verteilung() is
  'APR-08, §4.9, D-497. Die Verteilung der Pruefdauer OHNE Personenbezug — die '
  'personenbezogene Auswertung bleibt bis zur Antwort auf O-06 aus (§ 87 Abs. 1 '
  'Nr. 6 BetrVG). Ohne das Recht: keine Zeilen.';

alter function app.freigabe_pruefdauer_verteilung() owner to cse_definer;
revoke all on function app.freigabe_pruefdauer_verteilung() from public;
grant execute on function app.freigabe_pruefdauer_verteilung() to cse_app;
