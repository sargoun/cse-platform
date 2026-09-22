-- 0384 · Der Mitarbeiterzugang lässt sich einrichten, umschreiben und sperren
--        — und jede dieser drei Handlungen hinterlässt eine Spur
--        (V-014, EMP-01, EMP-14, AUT-08, D-09).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- **Der Befund.**
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `0113` baut den Telefonzugang vollständig: die Tabelle, die drei Policies,
-- die Spaltenrechte. `0114` bis `0144` bauen darauf die Anmeldung, die
-- Bremse, die Ausstellung durch die Einsatzleitung und den Zugangsstand.
--
-- **Und angelegt hat einen Zugang niemand ausser dem Seed.** Kein Formular,
-- kein Dienst, keine Route schreibt je eine Zeile in `mitarbeiter_zugang`.
-- Wer nach dem Seed eingestellt wird — also jeder echte Mensch — hat keine
-- Nummer hinterlegt, und die Zugangsseite sagte ihm das auch: „die
-- Super-Administration trägt die Nummer an der Person ein". Das konnte sie
-- nicht; die Spalte, um die es geht, ist `mitarbeiter_zugang.telefon_e164`
-- und nicht `person.telefon`, und für die erste gab es keinen Schreibweg.
--
-- Dasselbe gilt für das Sperren. Ein Mensch verliert sein Diensttelefon,
-- und die Plattform hat keinen Knopf, der den Zugang anhält — obwohl die
-- Spalten `gesperrt_am`/`gesperrt_grund` seit `0113` dastehen und `0114`
-- sie bei jeder Anmeldung prüft.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- **Befund 1 — die Tabelle trägt KEINEN Auslöser. Keinen einzigen.**
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `0113` begründet, warum `cse_app` `erstellt_von`/`geaendert_von` nicht
-- setzen darf: „die schreibt der Audit-Trigger."
--
-- **Diesen Auslöser gibt es nicht.** `mitarbeiter_zugang` steht weder in
-- `AUDITIERT` noch in `GEAENDERT_AM` in `src/server/db/schema/rls.ts`, und
-- `select … from pg_trigger` findet auf ihr nichts. Zwei Folgen, beide
-- still:
--
--   (a) `erstellt_von` und `geaendert_von` sind seit `0113` NULL und wären
--       es geblieben. Niemand hätte sie je füllen können — die einzige
--       Rolle mit einem Schreibweg hat auf beide Spalten kein Recht.
--   (b) **AUT-08 ist auf dem sicherheitsrelevantesten Schreibweg der
--       Plattform unerfüllt.** Wer die Nummer eines Mitarbeiterzugangs
--       umschreibt, bekommt ab dem nächsten Code dessen Anmeldungen — das
--       ist eine Übernahme des Kontos, ohne ein Kennwort zu brechen. SPEC
--       AUT-08 verlangt „All auth events in `audit_log`". Bisher stand dort
--       zu dieser Tabelle: nichts.
--
-- `kern.protokolliere_aenderung` schreibt `vorher`/`nachher` mit der Nummer
-- darin. Das ist dieselbe Abwägung wie bei `person` in `0005` und
-- ausdrücklich die gewollte: die Werte WERDEN geschrieben, und der LESEWEG
-- ist verengt — `vorher`/`nachher` fehlen im Spaltenrecht von `cse_app` und
-- kommen nur über `app.audit_nutzlast_lesen` unter
-- `system.audit_sensitiv_lesen` heraus. Ein Protokoll, aus dem die alte
-- Nummer fehlt, beantwortet die eine Frage nicht, für die es da ist:
-- WOHIN wurde umgeschrieben.
--
-- Die beiden Auslöser stehen unten im erzeugten Block; die Registrierung
-- liegt in `src/server/db/schema/rls.ts` (`pnpm db:triggers` schreibt neu).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- **Befund 2 — `t_zugang_anlegen` verlangt keine Beschäftigung.**
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Die INSERT-Policy aus `0113` prüft genau zwei Dinge: genau ein aktiver
-- Mandant, nicht lesend. Sie prüft NICHT, ob dieser Mensch in dieser
-- Gesellschaft überhaupt beschäftigt ist — `t_zugang_lesen` tut es, und
-- beide Definer-Funktionen (`app.zugang_code_ausstellen` in `0143`,
-- `app.zugang_stand` in `0144`) tun es ebenfalls und weisen sonst mit
-- `keine_anstellung` ab.
--
-- Die Lücke ist keine theoretische: eine Personalstelle mit
-- `personal.zugang_verwalten` konnte einen Zugang auf eine `person_id`
-- legen, die ihre Gesellschaft nicht beschäftigt — und ihn danach nicht
-- mehr sehen, weil die SELECT-Policy ihn ihr verbirgt. Angelegt, unsichtbar,
-- und `unique (person_id)` blockiert fortan die Gesellschaft, die den
-- Menschen wirklich beschäftigt. Die Policy wird deshalb auf dieselbe
-- Vorbedingung verengt, die die beiden Funktionen daneben schon halten.

/**
 * **Die zwei Spaltenrechte, die `0113` aus einer falschen Annahme heraus
 * nicht erteilt hat.**
 *
 * Überall sonst in dieser Plattform schreibt der DIENST den Handelnden —
 * `erstellt_von = app.aktueller_benutzer()` — und kein Auslöser tut es;
 * `kern.setze_geaendert_am` setzt nur den Zeitpunkt. `0113` ist die einzige
 * Stelle, die das anders annahm, und die Annahme stimmte nie.
 *
 * **Warum das kein Loch ist.** `app.aktueller_benutzer()` liest die Sitzung,
 * nicht das Formular: der Wert kommt aus derselben Quelle wie in jedem
 * anderen Dienst, und ein Aufrufer, der eine fremde Kennung hineinschriebe,
 * müsste erst eine fremde Sitzung haben. `person_id` bleibt weiterhin
 * ungenannt — ein Zugang, der den Menschen wechselt, ist kein geänderter
 * Zugang, sondern ein fremder (0113).
 */
grant insert (erstellt_von) on mitarbeiter_zugang to cse_app;
grant update (geaendert_von) on mitarbeiter_zugang to cse_app;

/**
 * **Anlegen nur für einen Menschen, den DIESE Gesellschaft beschäftigt.**
 *
 * Dieselbe Bedingung wie in `app.zugang_code_ausstellen` (0143) und
 * `app.zugang_stand` (0144), und dieselbe wie in `t_zugang_lesen` — nur dort
 * über `sichtbare_mandanten()`, was im Mandantenkontext genau der aktive
 * Mandant ist (0004) und in der Gruppenansicht mehrere wären. Hier steht
 * `app.aktiver_mandant()` ausgeschrieben: geschrieben wird nur mit genau
 * einem (Invariante 10), und `assert_genau_ein_mandant()` daneben wirft
 * sonst.
 */
drop policy t_zugang_anlegen on mitarbeiter_zugang;

create policy t_zugang_anlegen on mitarbeiter_zugang for insert to cse_app
  with check (
    app.assert_genau_ein_mandant() is not null
    and not app.ist_readonly()
    and exists (
      select 1 from anstellung a
       where a.person_id = mitarbeiter_zugang.person_id
         and a.mandant_id = app.aktiver_mandant()
         and a.geloescht_am is null)
  );

comment on column mitarbeiter_zugang.geaendert_von is
  'Wer zuletzt die Nummer umgeschrieben, gesperrt oder entsperrt hat — vom Dienst aus der '
  'Sitzung gesetzt (0384). 0113 nahm einen Audit-Trigger an, den es nicht gab.';

/**
 * **`app.zugang_stand` sagt jetzt auch, WARUM gesperrt ist.**
 *
 * `0144` gibt `gesperrt` als Ja/Nein zurück. Solange es keinen Weg gab, einen
 * Zugang zu sperren, war das vollständig: gesperrt wurde nichts. Mit `0384`
 * gibt es den Weg — und „gesperrt: ja" ohne den Grund ist genau die Auskunft,
 * die den Anruf erzeugt, den sie ersparen soll. Der Grund steht in einer
 * Spalte, die `cse_app` ohnehin lesen darf (0113); er kommt trotzdem durch
 * DIESE Funktion, damit es bei EINEM Leseweg mit EINER Rechteprüfung bleibt.
 *
 * **Und damit eine Richtigstellung zu `0144`.** Ihr Kopf sagt: „`cse_app` hat
 * auf `mitarbeiter_zugang` kein Recht und bekommt hier auch keines." Der
 * zweite Halbsatz stimmt, der erste nicht — `0113` erteilt der Rolle
 * `select` auf acht Spalten sowie `insert` und `update` auf je zwei. Die
 * Funktion ist deshalb keine Öffnung eines verschlossenen Wegs, sondern die
 * EINE Auskunft mit Rechteprüfung neben einem Leseweg, den es schon gibt.
 * Die Migration bleibt stehen, wie sie ist (Migrationen sind Geschichte);
 * die Richtigstellung gehört hierher, wo die Funktion neu entsteht.
 *
 * `create or replace` geht hier nicht: der Rückgabetyp ändert sich, und
 * Postgres weist das ab. Nach `drop` sind Eigentümer und Rechte neu zu setzen
 * — ein `drop` ohne sie ist eine Funktion, die niemand mehr ausführen darf.
 */
/**
 * **Ein Spaltenrecht mehr für `cse_definer` — sonst ist die Erweiterung tot.**
 *
 * `0116` gibt der Definer-Rolle `select (id, person_id, telefon_e164,
 * gesperrt_am)`, `0144` legt `letzter_login_am` dazu. `gesperrt_grund` stand
 * nie darin, weil es bis `0384` keinen Weg gab, einen Grund zu SETZEN. Die
 * Funktion unten liest ihn — und ein SECURITY DEFINER liest nicht mehr, als
 * seinem Eigentümer erlaubt ist. Ohne diese Zeile beantwortet sie jede Frage
 * nach dem Zugangsstand mit `permission denied for table
 * mitarbeiter_zugang`, und zwar erst zur Laufzeit.
 */
grant select (gesperrt_grund) on mitarbeiter_zugang to cse_definer;

drop function app.zugang_stand(uuid);

create function app.zugang_stand(p_person uuid)
returns table (
  hat_anstellung   boolean,
  hat_zugang       boolean,
  gesperrt         boolean,
  gesperrt_am      timestamptz,
  sperrgrund       text,
  telefon_maskiert text,
  hat_konto        boolean,
  offene_codes     integer,
  letzte_anmeldung timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_zugang  uuid;
  v_telefon text;
  v_gesperrt timestamptz;
  v_grund   text;
  v_letzter timestamptz;
begin
  if v_mandant is null or not app.hat_recht('personal.zugang_verwalten', v_mandant) then
    raise insufficient_privilege using message =
      'Den Zugangsstand liest, wer Zugänge verwaltet (personal.zugang_verwalten).';
  end if;

  if not exists (
    select 1 from public.anstellung a
     where a.person_id = p_person and a.mandant_id = v_mandant and a.geloescht_am is null
  ) then
    return query select false, false, false, null::timestamptz, null::text,
                        null::text, false, 0, null::timestamptz;
    return;
  end if;

  select z.id, z.telefon_e164, z.gesperrt_am, z.gesperrt_grund, z.letzter_login_am
    into v_zugang, v_telefon, v_gesperrt, v_grund, v_letzter
    from public.mitarbeiter_zugang z
   where z.person_id = p_person;

  return query
    select
      true,
      v_zugang is not null,
      v_gesperrt is not null,
      v_gesperrt,
      v_grund,
      case when v_telefon is null then null else '…' || right(v_telefon, 3) end,
      /* Dieselben Ausschluesse wie in app.mitarbeiter_sitzung_ausstellen (0115) —
         sonst sagt diese Auskunft „Konto vorhanden", und die Anmeldung sagt Nein. */
      exists (
        select 1 from public.benutzer b
         where b.person_id = p_person
           and b.status = 'aktiv'
           and b.deaktiviert_am is null
           and not b.ist_dienstkonto
           and (b.gesperrt_bis is null or b.gesperrt_bis <= now())
      ),
      (select count(*)::integer from public.mitarbeiter_einmalcode c
        where c.zugang_id = v_zugang and c.verbraucht_am is null and c.gueltig_bis > now()),
      v_letzter;
end $$;

comment on function app.zugang_stand(uuid) is
  'Zugangsstand einer Person fuer die Einsatzleitung: Zugang, Sperre samt Grund, Konto, '
  'offene Codes, letzte Anmeldung — ohne die Nummer. Nur unter personal.zugang_verwalten '
  'und nur fuer Beschaeftigte der aktiven Gesellschaft (D-488, 0384).';

alter function app.zugang_stand(uuid) owner to cse_definer;
revoke execute on function app.zugang_stand(uuid) from public;
grant execute on function app.zugang_stand(uuid) to cse_app;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0384)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- mitarbeiter_zugang (archiv): EMP-14, AUT-08, Invariante 8. Der Zugang ist die Antwort auf die Frage, WER sich unter dieser Nummer angemeldet hat — `letzter_login_am` haengt daran, und die Zeile ist der Anker jeder Anmeldung dieses Menschen. `0113` sagt es selbst: „Austritt ist KEIN Loeschgrund ... sein Zugang gehoert gesperrt, nicht entfernt." Beendet wird mit `gesperrt_am`, nie durch Loeschen; eine geloeschte Zeile naehme das Protokoll mit, das seit `0384` an ihr haengt, und gaebe die Nummer fuer einen zweiten Menschen frei, als waere sie nie vergeben gewesen. `geloescht_am` gibt es hier nicht, und das ist der Punkt: eine Loeschspalte waere die Einladung.
create trigger trg_mitarbeiter_zugang_kein_hard_delete
  before delete on mitarbeiter_zugang
  for each row execute function kern.verhindere_loeschung();
create trigger trg_mitarbeiter_zugang_kein_truncate
  before truncate on mitarbeiter_zugang
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on mitarbeiter_zugang from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_mitarbeiter_zugang_geaendert_am
  before update on mitarbeiter_zugang
  for each row execute function kern.setze_geaendert_am();

create trigger trg_mitarbeiter_zugang_audit
  after insert or update or delete on mitarbeiter_zugang
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
