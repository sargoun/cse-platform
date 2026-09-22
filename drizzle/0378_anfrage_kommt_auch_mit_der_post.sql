-- 0378 — eine Betroffenenanfrage kommt auch mit der Post (V-031, LEG-09).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- `betroffenenanfrage` hat GENAU EINEN Erzeuger: `/api/datenschutz/anfrage`,
-- das oeffentliche Formular. Seine INSERT-Policy (`0176`) verlangt
-- `formular.schreiben` — das Recht des Eingangsprinzipals. Wer im Buero
-- `datenschutz.auskunft_erstellen` haelt, darf lesen, entscheiden, verlaengern,
-- zuordnen — und keine Zeile anlegen.
--
-- **Art. 12 Abs. 1 DSGVO kennt diese Beschraenkung nicht.** Der Antrag wird
-- „schriftlich oder in anderer Form, gegebenenfalls auch elektronisch"
-- gestellt, „auf muendlichen Antrag" ausdruecklich eingeschlossen. Ein Brief
-- ist ein Antrag. Ein Anruf ist ein Antrag. Beide loesen dieselbe Monatsfrist
-- aus wie das Formular — und beide hatten in dieser Plattform keinen Platz.
--
-- Was in der Praxis daraus wird, ist keine fehlende Zeile, sondern eine
-- fehlende FRIST: der Brief liegt auf dem Schreibtisch, die Uhr des Art. 12
-- Abs. 3 laeuft seit seinem Eingang, und die Plattform, die die Frist
-- ueberwacht, weiss nichts von ihm.
--
-- ===========================================================================
-- Der Eingangszeitpunkt ist eine ANGABE, nicht die Uhr des Erfassers
-- ===========================================================================
--
-- Genau hier liegt der Grund, warum das nicht einfach ein zweiter Aufruf von
-- `nimmAn` sein kann. Das Formular schreibt `eingegangen_am default now()` —
-- richtig, denn beim Formular IST jetzt der Eingang. Beim Brief ist der
-- Eingang der Tag des Posteingangsstempels, und der liegt hinter uns.
--
-- Der Ausloeser `trg_betroffenenanfrage_frist` aus `0176` rechnet die Frist
-- aus `eingegangen_am` und feuert `before insert or update of eingegangen_am`.
-- Er traegt diesen Fall also schon — die Tabelle war bereit, der Weg dorthin
-- fehlte. Ein rueckdatierter Eingang gibt damit eine rueckdatierte Frist, und
-- der Brief vom Ersten steht am Zwanzigsten korrekt als „noch zehn Tage" da
-- und nicht als „noch ein Monat".
--
-- **Nach vorn darf er nicht.** Ein Eingang in der Zukunft verschoebe die
-- Frist nach hinten — das waere die eine Richtung, in der sich mit einer
-- Angabe eine gesetzliche Frist gewinnen liesse. Der Check verbietet sie.
--
-- ===========================================================================
-- Der Weg wird festgehalten, weil er im Streitfall die Frist belegt
-- ===========================================================================
--
-- `eingangsweg` ist keine erfundene Regel, sondern die Aufzaehlung aus
-- Art. 12 Abs. 1 selbst: elektronisch (Formular, E-Mail), schriftlich (Brief),
-- muendlich (Telefon, persoenlich). Wer spaeter fragt, ob fristgerecht
-- geantwortet wurde, fragt als Erstes, wann und wie der Antrag einging.
--
-- `erfasst_von` steht daneben, weil eine muendliche Anfrage ohne benannten
-- Aufnehmenden im Streitfall keine ist — dieselbe Begruendung wie
-- `beantwortet_von` in `0176`.

create type betroffenenanfrage_eingangsweg as enum (
  'formular',     -- Art. 12 Abs. 1: elektronisch — /datenschutz/anfrage
  'email',        -- Art. 12 Abs. 1: elektronisch — frei formuliert
  'brief',        -- Art. 12 Abs. 1: schriftlich
  'telefon',      -- Art. 12 Abs. 1 Satz 3: muendlich
  'persoenlich'); -- Art. 12 Abs. 1 Satz 3: muendlich, vor Ort

comment on type betroffenenanfrage_eingangsweg is
  'Art. 12 Abs. 1 DSGVO: schriftlich, elektronisch oder muendlich. Die Liste '
  'bildet den Artikel ab und ist keine Hauspolitik.';

alter table betroffenenanfrage
  add column eingangsweg betroffenenanfrage_eingangsweg not null default 'formular',
  add column erfasst_von uuid references benutzer(id);

comment on column betroffenenanfrage.eingangsweg is
  'Wie der Antrag einging. Beim Streit um die Frist ist das die erste Frage.';

comment on column betroffenenanfrage.erfasst_von is
  'Wer die Anfrage aufgenommen hat — NULL beim oeffentlichen Formular, denn '
  'dort war es niemand. Bei Telefon und Brief benannt, sonst ist die Aufnahme '
  'im Streitfall nicht belegt.';

/**
 * Der Weg und der Erfasser sagen dasselbe.
 *
 * Eine telefonische Anfrage ohne Aufnehmenden waere eine Behauptung ohne
 * Urheber; ein Formulareingang MIT Aufnehmendem waere eine Erfindung, denn
 * der Eingangsprinzipal ist kein Benutzer. Beides schliesst der Check aus.
 */
alter table betroffenenanfrage
  add constraint betroffenenanfrage_aufnahme_belegt check (
    (eingangsweg = 'formular') = (erfasst_von is null));

/**
 * **Kein Eingang in der Zukunft — im AUSLOESER, nicht in einem Check.**
 *
 * `eingegangen_am` bestimmt ueber `kern.betroffenenanfrage_frist()` die Frist
 * des Art. 12 Abs. 3. Ein Datum nach vorn ist deshalb kein Tippfehler mit
 * kosmetischer Folge, sondern eine selbst verlaengerte gesetzliche Frist.
 *
 * Die Regel steht in DERSELBEN Funktion, die die Frist rechnet, und nicht in
 * einem `check`: ein Check mit `now()` darin ist nicht immutable — beim
 * Wiedereinspielen eines Dumps wuerde er gegen die Uhr des Einspielzeitpunkts
 * geprueft und koennte Zeilen ablehnen, die bei ihrer Entstehung richtig
 * waren. Der Ausloeser prueft dort, wo der Wert ankommt, und nur dann.
 *
 * Die Minute Spielraum faengt die Uhrdifferenz zwischen Anwendung und
 * Datenbank — nicht einen anderen Tag.
 */
create or replace function kern.betroffenenanfrage_frist() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.eingegangen_am > now() + interval '1 minute' then
    raise exception
      'Eingang liegt in der Zukunft: %', new.eingegangen_am
      using errcode = 'check_violation',
            hint = 'Art. 12 Abs. 3 DSGVO laeuft ab Eingang.';
  end if;

  new.frist_am :=
    ((new.eingegangen_am at time zone 'Europe/Berlin') + interval '1 month')
      at time zone 'Europe/Berlin';
  return new;
end $$;

comment on function kern.betroffenenanfrage_frist() is
  'Art. 12 Abs. 3 DSGVO: ein MONAT kalendarisch, in Berliner Ortszeit gerechnet. '
  'Eine generierte Spalte geht nicht — timestamptz + interval ist nicht immutable. '
  'Seit 0378 weist dieselbe Funktion einen Eingang in der Zukunft ab: er waere '
  'eine selbst verlaengerte Frist.';

-- ---------------------------------------------------------------------------
-- Die Aufnahme im Buero — eine eigene Policy, nicht die des Eingangs
-- ---------------------------------------------------------------------------
--
-- Die Policy des Eingangsprinzipals (`t_betroffenenanfrage_eingang`, `0176`)
-- bleibt, wie sie ist: `formular.schreiben`, anlegen und nicht lesen. Sie hier
-- zu erweitern hiesse, dem oeffentlichen Prinzipal einen zweiten Weg zu geben
-- oder dem Buero `formular.schreiben` zu erteilen — beides verschoebe ein
-- Recht, um eine Zeile zu schreiben.
--
-- Die neue Policy traegt dasselbe Praedikat wie Lesen und Bearbeiten
-- (`app.darf_betroffenenanfrage`, `0220`): wer den Vorgang fuehren darf, darf
-- den Brief aufnehmen, der ihn ausloest. Ein viertes Recht waere eines, das
-- genau die Menschen zusaetzlich braeuchten, die die Arbeit ohnehin tun (K-19).
--
-- **Was `eingangsweg <> formular` NICHT leistet.** Erlaubende Policies werden
-- in Postgres verodert: wer neben dem Datenschutzrecht auch
-- `formular.schreiben` haelt — `admin` und `leitung` tun das (Katalog §87) —
-- kommt durch die Policy des Eingangsprinzipals und kann eine Zeile als
-- `formular` schreiben. Das ist kein Loch, denn derselbe Mensch koennte das
-- oeffentliche Formular ausfuellen; es ist nur nicht die Trennung, fuer die
-- man es halten koennte.
--
-- **Die Trennung, die wirklich traegt, ist der CHECK darueber.** Er paart Weg
-- und Aufnehmenden und gilt fuer JEDE Rolle: ein Brief ohne benannten
-- Menschen entsteht nicht, und ein Formulareingang mit einem entsteht ebenso
-- wenig. Damit ist an jeder Zeile ablesbar, ob ihr Eingangszeitpunkt gemessen
-- oder protokolliert wurde — und genau das ist die Frage, an der die Frist des
-- Art. 12 Abs. 3 im Streitfall haengt.

create policy t_betroffenenanfrage_aufnahme on betroffenenanfrage for insert to cse_app
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and eingangsweg <> 'formular'
              and (select app.darf_betroffenenanfrage()));

comment on policy t_betroffenenanfrage_aufnahme on betroffenenanfrage is
  'V-031, Art. 12 Abs. 1 DSGVO. Brief, Telefon, E-Mail, persoenlich — vom '
  'Buero aufgenommen. `eingangsweg <> formular` sagt: DIESE Policy oeffnet den '
  'Formularweg nicht. Wer neben dem Datenschutzrecht auch `formular.schreiben` '
  'haelt, kommt durch die Policy daneben — Postgres verodert erlaubende '
  'Policies. Das ist kein Loch: derselbe Mensch koennte das oeffentliche '
  'Formular absenden. Die Trennung, auf die es ankommt, ist deshalb der CHECK '
  'und nicht die Policy — er PAART Weg und Aufnehmenden, und er gilt fuer '
  'jede Rolle.';
