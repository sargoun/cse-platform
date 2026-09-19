-- ===========================================================================
-- 0190 — Die drei geschuetzten Stammdatenfelder eines Menschen
--        (01-KERN §6.13 und §11, SEC-03, LEG-09, K-05)
--
-- Vertrag: `docs/architecture/02-datenmodell/01-KERN.md` §6.13 (Spalten),
-- §11 (Grant-Listen) und die Tabelle „Omitted column → Reader → Right".
--
-- **Der Befund, der diese Migration gebracht hat.** Das Route-Manifest fuehrt
-- `/portal/[mandant]/personal/personen/[id]/stammdaten` mit dem eigenen Recht
-- `personal.stammdaten_lesen` — und `person.geburtsdatum` war `cse_app` als
-- SELECT gegrantet. Das Recht bewachte damit eine Tuer neben einer offenen
-- Wand: jede beliebige Abfrage im Haus las das Geburtsdatum mit, und
-- `personal.stammdaten_lesen` hielt niemanden auf. Von den drei Feldern, die
-- §6.13 und das Bewacherregister (SEC-03) verlangen, existierten ausserdem nur
-- eines: `geburtsort` und `staatsangehoerigkeit` fehlten ganz.
--
-- **Vier Teile — und die letzten zwei fehlten im ersten Entwurf.** (1) Die
-- zwei Spalten anlegen. (2) `geburtsdatum` aus dem SELECT-Grant nehmen und die
-- neuen gar nicht erst hineingeben. (3) Den einen Lesepfad anlegen:
-- `app.person_stammdaten_lesen`, SECURITY DEFINER, mit Rechtepruefung und
-- Protokoll. (4) **Das Schreiben ueberhaupt erst moeglich machen.** `cse_app`
-- hielt auf `person` genau EINEN Spalten-UPDATE-Grant (`sprache`), und die
-- einzige UPDATE-Policy war `t_person_selbstpflege`
-- (`id = app.aktuelle_person()`): die Personalstelle konnte die Zeile eines
-- anderen Menschen strukturell nicht aendern, weder per Grant noch per Policy.
-- Eine Stammdatenmaske ohne diese beiden Zeilen ist ein reines Leseblatt.
--
-- **Gelesen wird ueber die Funktion, geschrieben ueber die Policy.** Das ist
-- kein Widerspruch: `GRANT UPDATE` und `GRANT SELECT` sind getrennte Rechte,
-- und eine Spalte darf schreibbar und unlesbar sein — genau das braucht ein
-- Personalformular, das ein Geburtsdatum aufnimmt und es nicht zurueckliest
-- (§11 sagt das wortwoertlich).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Die zwei fehlenden Spalten (§6.13)
-- ---------------------------------------------------------------------------

alter table person add column geburtsort          text;
alter table person add column staatsangehoerigkeit char(2);

/**
 * ISO 3166-1 alpha-2, gross geschrieben — die Form, in der das
 * Bewacherregister sie verlangt. Ein CHECK und keine Nachschlagetabelle: die
 * Liste der Staaten aendert sich, und eine Fremdschluesselpflege dafuer waere
 * eine Datenpflegeaufgabe ohne fachlichen Gewinn.
 */
alter table person add constraint person_staat_form check (
  staatsangehoerigkeit is null or staatsangehoerigkeit ~ '^[A-Z]{2}$');

comment on column person.geburtsort is
  'SEC-03, § 16 BewachV: Pflichtangabe des Bewacherregisters. Spaltengeschuetzt '
  '(§11) — lesbar nur ueber app.person_stammdaten_lesen.';
comment on column person.staatsangehoerigkeit is
  'ISO 3166-1 alpha-2. SEC-03: Pflichtangabe des Bewacherregisters. '
  'Spaltengeschuetzt (§11).';
comment on column person.geburtsdatum is
  'Kalendertag, kein Zeitpunkt (Invariante 2). Spaltengeschuetzt (§11) — '
  'lesbar nur ueber app.person_stammdaten_lesen, schreibbar ohne Rueckleserecht.';

-- ---------------------------------------------------------------------------
-- 2. Die Spaltenrechte (§11)
-- ---------------------------------------------------------------------------

/**
 * **Der Entzug, der den Schutz erst herstellt — und er muss auf der TABELLE
 * ansetzen.**
 *
 * `person` trug fuer `cse_app` einen TABELLENWEITEN SELECT-Grant
 * (`relacl: cse_app=ar`). Ein `revoke select (geburtsdatum)` darauf ist
 * wirkungslos: `has_column_privilege` bleibt `true`, weil das Tabellenrecht
 * jede Spalte abdeckt, und der Entzug sieht in der Migration richtig aus,
 * ohne etwas zu tun. Nachgemessen in Postgres, nicht vermutet.
 *
 * Deshalb: erst das Tabellenrecht weg, dann eine ERSCHOEPFENDE Spaltenliste
 * zurueck. Danach scheitert `select geburtsdatum from person` fuer `cse_app`
 * mit 42501 — an einer Stelle, an der niemand ein Spaltenrecht vermutet, und
 * genau deshalb steht der Kommentar an der Spalte.
 *
 * Die Liste ist vollstaendig aufzufuehren und nicht abzuleiten: eine neue
 * Spalte ist damit standardmaessig UNLESBAR, und das ist die sichere
 * Richtung — wer sie lesbar braucht, schreibt eine Zeile.
 */
revoke select on person from cse_app;
grant  select (id, vorname, nachname, telefon, sprache,
               geloescht_am, geloescht_von,
               erstellt_am, geaendert_am, erstellt_von, geaendert_von)
       on person to cse_app;
       -- geburtsdatum, geburtsort, staatsangehoerigkeit ausgelassen (§11)

/**
 * INSERT und UPDATE — auf den drei Feldern, und auf KEINEM mehr.
 *
 * Ohne den UPDATE-Grant ist die Stammdatenmaske ein Leseblatt: das Formular
 * nimmt ein Geburtsdatum auf, das es nicht zurueckliest, und traegt es ein.
 * `sprache` war bisher die einzige Spalte mit UPDATE — sie steht hier mit,
 * damit die Liste an EINER Stelle vollstaendig ist.
 *
 * **`vorname`, `nachname` und `telefon` stehen ausdruecklich NICHT hier.**
 * Ein frueherer Entwurf dieser Migration hat sie mitgenommen, „weil die
 * Personalstelle sie ohnehin pflegt" — das war ein Rueckschritt hinter 0165.
 * `person` traegt mit `t_person_selbstpflege` eine Policy, die jedem Menschen
 * seine EIGENE Zeile oeffnet, und RLS kennt keine Spalten: jedes Recht in
 * dieser Liste gilt damit auch fuer den Menschen selbst. `telefon` ist der
 * Anmeldeweg (`app.zugang_code_anfordern`, EMP-01) — aus „ich stelle meine
 * Sprache um" wuerde eine Kontouebernahme. `vorname`/`nachname` gehoeren zur
 * Bewachermeldung (SEC-03). `schreibeStammdaten` schreibt keines der drei;
 * das Recht waere ohne Nutzen und mit Schaden.
 */
grant insert (geburtsort, staatsangehoerigkeit) on person to cse_app;
grant update (geburtsdatum, geburtsort, staatsangehoerigkeit,
              sprache, geaendert_am, geaendert_von)
      on person to cse_app;

/**
 * **Der Spaltenwaechter — weil der Grant allein zu grob bleibt.**
 *
 * Auch die geschnittene Liste oben traegt die drei Stammdatenfelder, und
 * `t_person_selbstpflege` (0165) gilt fuer JEDE Spalte der eigenen Zeile.
 * Ohne diesen Trigger koennte eine angemeldete Reinigungskraft aus dem
 * Personen-Scope heraus ihr eigenes Geburtsdatum, ihren Geburtsort und ihre
 * Staatsangehoerigkeit umschreiben — also genau die drei Angaben, die § 16
 * BewachV fuer die Meldung an das Bewacherregister verlangt (SEC-03). Eine
 * Selbstauskunft, die sich selbst korrigiert, ist keine.
 *
 * `current_user` und nicht `session_user`: in einer `security definer`
 * -Funktion ist er `cse_definer`, im Migrations- und Seedlauf `postgres`,
 * und nur im Anwendungsweg `cse_app`. Der Waechter greift deshalb genau
 * dort, wo eine Sitzung an der Tastatur haengt (dasselbe Muster wie
 * `kern.freigabe_snapshot_nur_definer`, 0136).
 *
 * `app.hat_recht(..., app.aktiver_mandant())` ist im Personen-Scope
 * zwangslaeufig falsch: `app.aktiver_mandant()` liefert dort `null`. Der
 * Waechter braucht also keinen eigenen Scope-Zweig — die Rechtefrage
 * beantwortet ihn mit.
 */
create function kern.person_stammdaten_schutz() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
begin
  if current_user <> 'cse_app' then return new; end if;

  if new.geburtsdatum         is distinct from old.geburtsdatum
     or new.geburtsort           is distinct from old.geburtsort
     or new.staatsangehoerigkeit is distinct from old.staatsangehoerigkeit then
    if not (select app.hat_recht('personal.schreiben', app.aktiver_mandant())) then
      raise exception
        'Geburtsdatum, Geburtsort und Staatsangehoerigkeit pflegt die '
        'Personalstelle (personal.schreiben in der aktiven Gesellschaft), '
        'nicht der Mensch selbst.'
        using errcode = '42501',
              hint = 'SEC-03/§ 16 BewachV: diese drei Angaben gehen an das '
                     'Bewacherregister. Die Selbstpflege aus 0165 reicht bis '
                     '`sprache` und nicht weiter.';
    end if;
  end if;
  return new;
end $$;

create trigger trg_person_stammdaten_schutz
  before update on person
  for each row execute function kern.person_stammdaten_schutz();

comment on function kern.person_stammdaten_schutz() is
  'SEC-03: die drei Bewacherregister-Felder aendert nur, wer '
  'personal.schreiben im aktiven Mandanten haelt. RLS kann keine Spalten '
  'einschraenken — t_person_selbstpflege (0165) gilt sonst auch fuer sie.';

/**
 * Der DEFINER braucht sein eigenes Recht — und seine eigene Policy.
 *
 * `app.person_stammdaten_lesen` gehoert `cse_definer` (K-01). `person` traegt
 * `force row level security`; ohne eine Policy fuer diese Rolle liefert die
 * Funktion eine LEERE Antwort statt einer Zeile — sie wirft nicht, sie
 * schweigt, und die Personalstelle sieht ein leeres Feld statt einer
 * Diagnosefrage (derselbe Fehler, den `aa_definer` in 0073 verhindert).
 */
grant select (id, geburtsdatum, geburtsort, staatsangehoerigkeit, geloescht_am)
      on person to cse_definer;
grant update (geburtsdatum, geburtsort, staatsangehoerigkeit, geaendert_am, geaendert_von)
      on person to cse_definer;
create policy d_person_stammdaten on person for select to cse_definer using (true);

-- ---------------------------------------------------------------------------
-- 3. Die Schreibpolicy der Personalstelle (§6.13)
-- ---------------------------------------------------------------------------

/**
 * **Wer darf die Zeile eines ANDEREN Menschen aendern.**
 *
 * `t_person_selbstpflege` deckt den Menschen selbst (0165, seine Sprache).
 * Diese Policy deckt die Personalstelle — und sie ist eng gefasst: der Mensch
 * muss in der AKTIVEN Gesellschaft beschaeftigt sein. `person` traegt keinen
 * Mandanten (D-09), die Beschaeftigung schon; ohne diesen Zweig duerfte eine
 * Gesellschaft die Stammdaten jedes Menschen aendern, den sie irgendwo sehen
 * kann.
 *
 * `personal.schreiben` und nicht `personal.stammdaten_lesen`: das zweite ist
 * ein LESERECHT, und ein Leserecht darf nichts schreiben. Wer die drei Felder
 * pflegen will, braucht beides — das Schreibrecht aus dieser Policy und das
 * Leserecht, um das Ergebnis zu sehen; die Oberflaeche fragt deshalb beide.
 */
create policy t_person_personalpflege on person for update to cse_app
  using      (exists (select 1 from anstellung a
                       where a.person_id = person.id
                         and a.mandant_id = app.aktiver_mandant()
                         and a.geloescht_am is null)
              and (select app.hat_recht('personal.schreiben', app.aktiver_mandant())))
  with check (exists (select 1 from anstellung a
                       where a.person_id = person.id
                         and a.mandant_id = app.aktiver_mandant()
                         and a.geloescht_am is null)
              and not app.ist_readonly()
              and (select app.hat_recht('personal.schreiben', app.aktiver_mandant())));

comment on policy t_person_personalpflege on person is
  'EMP-14, D-09: die Personalstelle pflegt die Zeile eines Menschen, der in '
  'IHRER Gesellschaft beschaeftigt ist. Invariante 10: not app.ist_readonly().';

-- ---------------------------------------------------------------------------
-- 4. app.person_stammdaten_lesen — der einzige Lesepfad (§11, LEG-09)
-- ---------------------------------------------------------------------------

/**
 * Drei Felder, ein Recht, eine Auditzeile.
 *
 * **Keine Zeile ist keine Zeile, ein fehlendes Recht wirft.** Der Unterschied
 * ist fuer die Oberflaeche wesentlich: „diesen Menschen gibt es hier nicht"
 * und „Sie duerfen diese Felder nicht sehen" sind zwei Saetze, und ein leeres
 * Feld sagt keinen von beiden. Nach aussen bleibt die Existenz trotzdem
 * verborgen — geprueft wird zuerst die Sichtbarkeit (AUT-06).
 */
create function app.person_stammdaten_lesen(p_person uuid)
returns table (
  geburtsdatum date,
  geburtsort text,
  staatsangehoerigkeit char(2)
)
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare v_sichtbar boolean;
begin
  select exists (select 1 from public.anstellung a
                  where a.person_id = p_person
                    and a.mandant_id = app.aktiver_mandant()
                    and a.geloescht_am is null)
    into v_sichtbar;

  -- Nicht in dieser Gesellschaft beschaeftigt: keine Zeile, kein Hinweis
  -- darauf, dass es die Zeile woanders gibt (AUT-06).
  if not v_sichtbar then return; end if;

  if not app.hat_recht('personal.stammdaten_lesen', app.aktiver_mandant()) then
    raise exception 'nicht berechtigt' using errcode = '42501';
  end if;

  perform app.protokolliere(
    'personal.stammdaten_gelesen', 'person', p_person::text,
    null, jsonb_build_object(
      'rechtsgrundlage', 'Art. 6 Abs. 1 lit. b und c DSGVO — § 16 BewachV (SEC-03)'));

  return query
    select p.geburtsdatum, p.geburtsort, p.staatsangehoerigkeit
      from public.person p
     where p.id = p_person and p.geloescht_am is null;
end $$;

alter function app.person_stammdaten_lesen(uuid) owner to cse_definer;
revoke execute on function app.person_stammdaten_lesen(uuid) from public;
grant execute on function app.person_stammdaten_lesen(uuid) to cse_app;

comment on function app.person_stammdaten_lesen(uuid) is
  'SEC-03, LEG-09, §11: der EINZIGE Weg zu geburtsdatum, geburtsort und '
  'staatsangehoerigkeit. Prueft personal.stammdaten_lesen im aktiven Mandanten '
  'und schreibt eine Auditzeile mit Rechtsgrundlage.';
