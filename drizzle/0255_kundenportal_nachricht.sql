-- 0255 — Der Kundenfaden: `nachricht` bekommt seinen Kundenbezug
-- (NOT-03, CRM-06, K-04, K-18, 04-SEITENKARTE §8, SPEC §22 `nachricht`).
--
-- ===========================================================================
-- Der Befund: die Seite gab es, die Zeile war unerreichbar
-- ===========================================================================
--
-- Die Kunden-Tableiste fuehrt „Nachrichten" als eines von fuenf Zielen, und
-- `/portal/kunde/nachrichten` steht im Routenregister mit `nachricht.lesen` —
-- einem Recht, das die Rolle `kunde` seit `0008` tatsaechlich haelt. Gelesen
-- hat eine Kundensitzung darunter trotzdem NICHTS, und zwar aus drei Gruenden
-- gleichzeitig:
--
--  1. `nachricht` trug keinen Kundenbezug. `0011` legte Absender, Betreff,
--     Text und Zeitpunkt an, `0231` den Faden, die Richtung, den Kanal und
--     die Empfaengerarten — eine Spalte, die sagt „dieser Vorgang gehoert zu
--     DIESEM Kunden", war nie darunter.
--  2. Die einzigen erlaubenden Policies waren `t_nachricht_mandant`
--     (`mandant_id = app.aktiver_mandant()`, im Kunden-Scope nach K-20 NULL),
--     `t_nachricht_gruppe` (verlangt `gruppe.nachricht.lesen`) und
--     `t_nachricht_eigene` (Absender oder Empfaenger). Keine davon ist ein
--     Kundenlesepfad.
--  3. `nachricht_empfaenger` verlor in `0231` `t_empfaenger_person` und bekam
--     `empfaenger_typ = 'ansprechpartner'` — aber keine PERMISSIVE Policy, die
--     einer Kundensitzung diese Zeilen zeigt. Die restriktive `p_beteiligt`
--     LAESST sie zu; zulassen ist nicht erlauben.
--
-- Der Fehlermodus ist der aus 04-SEITENKARTE §8 unter K-18: kein Fehler,
-- keine Meldung, sondern der Satz „Keine Nachrichten" — und der liest sich
-- fuer den Kunden als „ich habe kein Geschaeft mit euch". `0231` hat diesen
-- PR ausdruecklich vorgemerkt („der Kundenfaden bekommt seinen Lesepfad
-- spaeter — `t_kunde` auf `nachricht`, 0255+").
--
-- ===========================================================================
-- Warum `kunde_id` auf `nachricht` und nicht eine Zeile in
-- `nachricht_empfaenger`
-- ===========================================================================
--
-- Beides waere gegangen, und die Empfaengerzeile ist die Form, die `0231`
-- naeher liegt. Sie beantwortet aber eine andere Frage: WER liest, nicht WEM
-- der Vorgang gehoert. Ein Faden mit dem Kunden hat oft mehrere
-- Ansprechpartner, wechselnde Empfaenger und Kopieempfaenger, und die
-- Zugehoerigkeit zum Kunden ist genau das, was sich dabei NICHT aendert.
-- Dieselbe Trennung tragen `reklamation`, `rechnung`, `projekt` und
-- `offener_posten` — alle vier mit `kunde_id` und `t_kunde` darauf, und die
-- Kundendecke haengt bei allen vier an derselben Spalte. Eine fuenfte,
-- andersartige Loesung waere die erste, die jemand beim naechsten
-- Policy-Rundgang uebersieht.
--
-- **Der Fremdschluessel ist zusammengesetzt** (`mandant_id, kunde_id`). Ein
-- einspaltiger FK auf `kunde(id)` liesse die Nachricht der einen
-- Gesellschaft auf den Kunden einer anderen zeigen — der klassische
-- Fehlversandweg, den `0231` bei `nachricht_anhang` mit demselben Mittel
-- schliesst.
--
-- ===========================================================================
-- Die Decke ist das eigentliche Schutzmittel, nicht der Lesepfad
-- ===========================================================================
--
-- `t_nachricht_eigene` (0231) prueft `mandant_id = any
-- (app.sichtbare_mandanten())` und fragt das Portal NICHT. Im Kunden-Scope
-- ist die sichtbare Menge die Gesellschaft des Kundenzugangs, und sobald
-- `nachricht_empfaenger` einen Kundenlesepfad hat, greift dieses `exists` —
-- eine Kundensitzung kaeme also ueber eine Policy herein, die fuer
-- Mitarbeitende geschrieben wurde, und OHNE jede Einschraenkung auf Richtung,
-- Loeschung oder Kundenbezug.
--
-- Deshalb steht hier BEIDES: ein benannter Lesepfad (`t_kunde`) und eine
-- RESTRIKTIVE Decke (`p_kunde_decke`), die im Kundenportal fuer JEDE Policy
-- gilt — auch fuer die, die es heute noch nicht gibt. Restriktiv heisst UND;
-- eine zweite erlaubende Policy kann daran nichts aufweichen.
--
-- **Die Decke ist als `app.portal() <> 'kunde' or (…)` formuliert und NICHT
-- als `app.portal() = 'intern' or (…)`.** Der Unterschied ist hier nicht
-- kosmetisch: `nachricht` IST die Tabelle des Mitarbeiterposteingangs
-- (EMP-11, `t_nachricht_eigene`), und die zweite Form haette das
-- Mitarbeiterportal stillgelegt. `ansprechpartner` und `dokument` tragen ihre
-- Kundendecke aus demselben Grund in dieser Form.

-- ---------------------------------------------------------------------------
-- 1. Die Spalte
-- ---------------------------------------------------------------------------

alter table nachricht
  add column kunde_id uuid,
  add constraint nachricht_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id);

comment on column nachricht.kunde_id is
  'NOT-03, CRM-06. WEM der Vorgang gehoert — nicht wer ihn liest (das steht in '
  '`nachricht_empfaenger`). `t_kunde` und `p_kunde_decke` haengen an dieser Spalte; '
  'ist sie NULL, ist die Nachricht im Kundenportal strukturell unerreichbar.';

/**
 * Der Index deckt die eine Abfrage, die das Kundenportal stellt: „meine
 * Nachrichten, die neuesten zuerst". `nachricht_thread_idx` (0231) beginnt mit
 * `thread_id` und hilft dabei nicht.
 *
 * Teilindex, weil die ueberwaeltigende Mehrheit der Zeilen keinen Kundenbezug
 * hat — ein interner Faden, eine Bewerberantwort, eine Notiz.
 */
create index nachricht_kunde_idx
  on nachricht (mandant_id, kunde_id, erstellt_am desc)
  where kunde_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Der Lesepfad des Kunden
-- ---------------------------------------------------------------------------

/**
 * `app.scope() = 'kunde'` und nicht `app.portal() = 'kunde'` — dieselbe Form
 * wie `t_kunde` auf `kunde`, `ansprechpartner`, `rechnung`, `reklamation` und
 * `offener_posten`. Der Scope sagt, WIE gebunden wurde (`withKundeScope`
 * setzt `aktiver_mandant` auf NULL und fuellt `app.mandant_ids` aus
 * `app.sichtbare_mandanten()`); das Portal sagt, WER angemeldet ist. Fuer
 * einen Lesepfad ueber mehrere Gesellschaften ist der Scope die richtige
 * Frage, und die Decke darunter fragt zusaetzlich nach dem Portal.
 */
create policy t_kunde on nachricht for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id is not null
         and kunde_id = any (app.aktuelle_kunden()));

/**
 * **Die Decke — sie gilt fuer jede Policy, auch fuer die von 0231.**
 *
 * Drei Bedingungen, und jede hat einen Fall, den sie verhindert:
 *
 *  · `kunde_id = any (app.aktuelle_kunden())` — der Faden eines anderen
 *    Kunden derselben Gesellschaft. Der schwerste Fall und der einzige, der
 *    ohne Decke ueber `t_nachricht_eigene` tatsaechlich offen stuende.
 *  · `geloescht_am is null` — eine weich geloeschte Zeile bleibt fuer die
 *    Nachweisfuehrung stehen (Invariante 8, `trg_nachricht_kein_hard_delete`).
 *    Sie steht fuer die Aufsicht, nicht fuer den Kunden.
 *  · `richtung <> 'intern'` — ein interner Vermerk zum Kundenvorgang. Er
 *    traegt `kunde_id`, weil er zum Vorgang gehoert; er ist trotzdem eine
 *    Notiz zwischen Kollegen. Ohne diese Zeile waere der Kundenbezug, der den
 *    Vorgang zusammenhaelt, genau das Mittel, das den Vermerk herausgibt.
 *
 * **Was hier bewusst NICHT steht: `gesendet_am is not null`.**
 * `0231` nimmt `gesendet_am` den Vorgabewert mit der Begruendung, der
 * Zeitpunkt werde gesetzt, „wenn etwas WIRKLICH hinausgeht". Fuer
 * `kanal = 'portal'` geht aber nichts hinaus — `kern.nachricht_sendetor()`
 * kehrt fuer diesen Kanal sofort zurueck, und der Empfaenger liest angemeldet
 * auf derselben Plattform. Waere `gesendet_am` hier Bedingung, saehe der
 * Kunde je nach Schreibpfad ALLES oder NICHTS, und welches von beidem, haengt
 * an einer Zeile in einem Dienst, den diese Migration nicht kennt. Genau der
 * stille Fehlermodus, den K-18 beschreibt.
 *
 * Die Frage dahinter ist keine technische und wird deshalb nicht hier
 * entschieden:
 * // TODO(client, O-670): Wird eine Portalnachricht an den Kunden sofort
 * sichtbar, sobald sie angelegt ist, oder braucht sie eine ausdrueckliche
 * Freigabe (ein gesetztes `gesendet_am`, eine Zustellung) — und darf ein
 * Sachbearbeiter einen Text vorbereiten, den der Kunde noch nicht sieht?
 * Heute gilt: sichtbar, sobald `kunde_id` gesetzt, die Richtung nicht
 * `intern` und eine Empfaengerzeile vorhanden ist.
 */
create policy p_kunde_decke on nachricht as restrictive for all to cse_app
  using (app.portal() <> 'kunde'
         or (kunde_id is not null
             and kunde_id = any (app.aktuelle_kunden())
             and geloescht_am is null
             and richtung <> 'intern'));

-- ---------------------------------------------------------------------------
-- 3. Der Lesepfad auf die Empfaengerzeilen
-- ---------------------------------------------------------------------------

/**
 * **Ohne diese Policy bleibt die Nachricht unsichtbar, auch mit `t_kunde`.**
 *
 * `p_beteiligt` auf `nachricht` (0231) ist RESTRIKTIV und verlangt: internes
 * Portal ODER selbst Absender ODER `exists` eine Zeile in
 * `nachricht_empfaenger`. Fuer eine Kundensitzung ist keines der ersten zwei
 * wahr, und das `exists` laeuft unter DER RLS von `nachricht_empfaenger` —
 * also unter den Policies, die dort stehen. Dort stand fuer den Kunden keine.
 *
 * **Die Bedingung ist WORTGLEICH mit dem Kundenzweig von `p_beteiligt`.** Das
 * ist Absicht und kein Kopierfehler: die restriktive Decke sagt, welche
 * Empfaengerzeilen ein Kunde sehen DARF, und diese Policy gibt genau diese
 * frei — nicht mehr. Waere sie weiter, sperrte die Decke den Ueberschuss
 * ohnehin, und die Differenz waere eine Zeile, die niemand mehr versteht.
 *
 * **Diese Policy nennt `nachricht` ABSICHTLICH nicht.** Eine Bedingung
 * `exists (select 1 from nachricht n …)` waere die naheliegende Form der
 * „Decke des Elternteils ueber das Elternteil" (so macht es
 * `nachricht_anhang`). Hier ist sie unmoeglich: `p_beteiligt` auf `nachricht`
 * fragt bereits `nachricht_empfaenger`, und Postgres bricht den Ringverweis
 * mit „infinite recursion detected in policy for relation" ab — zur
 * LAUFZEIT, bei der ersten Abfrage, nicht bei der Migration. Die Verengung
 * leistet stattdessen der Empfaengertyp: eine Zeile, die auf einen
 * Ansprechpartner DIESES Kunden zeigt, ist bereits eine Zeile dieses Kunden.
 *
 * Was ein Kunde damit NICHT sieht: die Mitempfaenger einer Nachricht, die
 * keine seiner Ansprechpartner sind — also jeden internen Verteiler
 * (04-SEITENKARTE §8: dem Kunden ist das ganze `personal`-Modul verschlossen,
 * „no names"). `p_beteiligt` haelt das fuer jede kuenftige Policy.
 *
 * ===========================================================================
 * Die Empfaengerzeile braucht die Kopffakten AN SICH — sonst deckt sie nichts
 * ===========================================================================
 *
 * Hier stand einmal nur die Verengung auf den Empfaenger, mit der Zusage
 * „waere sie weiter, sperrte die Decke den Ueberschuss ohnehin". Die Zusage
 * war falsch, und zwar nachweislich: auf `nachricht_empfaenger` gibt es
 * ausser `p_beteiligt` keine Kundendecke, und deren Kundenzweig ist mit
 * dieser Bedingung WORTGLEICH. Es gab also gar keinen Ueberschuss zu
 * sperren. Gemessen in einer echten Kundensitzung sah der Kunde fuenf
 * Empfaengerzeilen — darunter die zum internen Vermerk
 * („INTERN: Kunde zahlt schlecht"), die zur weich geloeschten Nachricht und
 * die zu einer Nachricht ohne Kundenbezug —, waehrend `nachricht` selbst
 * korrekt nur zwei zeigte. Herausgegeben waren damit Existenz, `erstellt_am`,
 * `zugestellt_am` und `gelesen_am` interner und zurueckgezogener Vorgaenge.
 *
 * Die drei Bedingungen, die `p_kunde_decke` auf `nachricht` sorgfaeltig
 * setzt, muessen also AUCH auf der Kindtabelle stehen. Der naheliegende Weg
 * — `exists (select 1 from nachricht n …)` — ist hier wirklich unmoeglich:
 * `p_beteiligt` auf `nachricht` fragt bereits `nachricht_empfaenger`, und
 * Postgres bricht den Ringverweis zur LAUFZEIT mit „infinite recursion
 * detected in policy for relation" ab. Bleibt die Denormalisierung, die
 * dieses Schema an genau derselben Stelle schon zweimal traegt:
 * `leistungsnachweis_signatur.kunde_id/kopf_status/kopf_storniert_am` (0066)
 * und `aufmass_zeile.kopf_status/kopf_storniert_am` (0072). Dieselbe Bauform,
 * derselbe Ausloeser in beide Richtungen, dieselbe Begruendung.
 */

alter table nachricht_empfaenger
  add column kunde_id uuid,
  add column kopf_richtung nachricht_richtung,
  add column kopf_geloescht_am timestamptz,
  add constraint ne_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id);

comment on column nachricht_empfaenger.kunde_id is
  'Denormalisiert aus `nachricht.kunde_id` (Ausloeser, beide Richtungen). Traegt die '
  'Kundendecke dieser Kindtabelle; ein `exists` auf `nachricht` ist hier wegen des '
  'Ringverweises ueber `p_beteiligt` unmoeglich.';
comment on column nachricht_empfaenger.kopf_richtung is
  'Denormalisiert aus `nachricht.richtung`. `intern` ist ein Vermerk zwischen Kollegen — '
  'auch seine Empfaengerzeile gehoert nicht ins Kundenportal.';
comment on column nachricht_empfaenger.kopf_geloescht_am is
  'Denormalisiert aus `nachricht.geloescht_am`. Eine weich geloeschte Nachricht bleibt fuer '
  'die Nachweisfuehrung stehen (Invariante 8) — auch ihre Empfaengerzeilen, und auch die '
  'bleiben dem Kunden verschlossen.';

/**
 * Hinschreiben beim Anlegen und beim Aendern der Zeile.
 *
 * `before insert or update`, nicht nur `insert`: sonst liesse sich die
 * Zuordnung einer bestehenden Zeile auf eine andere Nachricht umhaengen und
 * die Kopffakten blieben die der alten.
 */
create function kern.nachricht_empfaenger_kopf_denormalisieren() returns trigger
language plpgsql as $$
declare k record;
begin
  select n.kunde_id, n.richtung, n.geloescht_am into k
    from nachricht n
   where n.id = new.nachricht_id and n.mandant_id = new.mandant_id;
  if not found then
    raise exception 'Zu dieser Empfaengerzeile gibt es keine Nachricht in dieser Gesellschaft'
      using errcode = 'foreign_key_violation';
  end if;
  new.kunde_id          := k.kunde_id;
  new.kopf_richtung     := k.richtung;
  new.kopf_geloescht_am := k.geloescht_am;
  return new;
end $$;

create trigger trg_ne_kopf_denormalisieren
  before insert or update on nachricht_empfaenger
  for each row execute function kern.nachricht_empfaenger_kopf_denormalisieren();

/**
 * Und die Gegenrichtung — IN DERSELBEN TRANSAKTION.
 *
 * Ohne sie truege die Empfaengerzeile einer soeben weich geloeschten oder
 * einem Kunden zugeordneten Nachricht noch den alten Stand, und die Decke
 * daneben entschiede nach einer veralteten Angabe. Genau der stille
 * Fehlermodus, den `0072` bei `aufmass_zeile` beschreibt.
 *
 * `security definer`, und zwar zwingend — dieselbe Lage wie bei
 * `kern.ln_kopfstatus_fortschreiben()` in 0066: `cse_app` darf ueber
 * `t_empfaenger_eigene_stempeln` nur die EIGENE Empfaengerzeile stempeln.
 * Ein Ausloeser unter der Rolle des Schreibenden erreichte die Zeilen der
 * uebrigen Empfaenger nicht und liesse sie stumm auf dem alten Stand —
 * schlimmer als ein Fehler, weil die Decke dann zu WEIT stuende. Erhoeht wird
 * nichts, was der Aufrufer nicht ohnehin bewirkt: die Funktion schreibt
 * ausschliesslich die drei Kopfspalten und ausschliesslich auf Kinder
 * DERSELBEN Nachricht, deren Zeile der Aufrufer gerade veraendert hat.
 * `search_path` steht woertlich (K-01).
 */
create function kern.nachricht_kopf_fortschreiben() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.kunde_id is not distinct from old.kunde_id
     and new.richtung is not distinct from old.richtung
     and new.geloescht_am is not distinct from old.geloescht_am then
    return null;
  end if;
  update nachricht_empfaenger
     set kunde_id = new.kunde_id,
         kopf_richtung = new.richtung,
         kopf_geloescht_am = new.geloescht_am
   where nachricht_id = new.id and mandant_id = new.mandant_id;
  return null;
end $$;

create trigger trg_nachricht_kopf_fortschreiben
  after update on nachricht
  for each row execute function kern.nachricht_kopf_fortschreiben();

/**
 * Der Bestand aus `0011`/`0231` — ohne ihn traegt jede vorhandene Zeile NULL
 * in `kopf_richtung`, und die Decke unten liesse sie durch (`NULL <> 'intern'`
 * ist NULL, also nicht wahr — sie sperrte sie, was hier die sichere Richtung
 * waere, aber `set not null` gleich darunter verlangt ohnehin einen
 * vollstaendigen Bestand).
 */
update nachricht_empfaenger e
   set kunde_id = n.kunde_id,
       kopf_richtung = n.richtung,
       kopf_geloescht_am = n.geloescht_am
  from nachricht n
 where n.id = e.nachricht_id and n.mandant_id = e.mandant_id;

alter table nachricht_empfaenger
  alter column kopf_richtung set not null;

/**
 * Der Index deckt dieselbe Frage wie `nachricht_kunde_idx` eine Ebene hoeher.
 * Teilindex aus demselben Grund: die ueberwaeltigende Mehrheit der
 * Empfaengerzeilen hat keinen Kundenbezug.
 */
create index ne_kunde_idx
  on nachricht_empfaenger (mandant_id, kunde_id)
  where kunde_id is not null;

create policy t_kunde on nachricht_empfaenger for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and empfaenger_typ = 'ansprechpartner'
         and empfaenger_id in (select a.id from ansprechpartner a
                                where a.kunde_id = any (app.aktuelle_kunden())));

/**
 * **Und die Decke — dieselben drei Bedingungen wie auf `nachricht`.**
 *
 * Sie steht in derselben Form (`app.portal() <> 'kunde' or (…)`) und aus
 * demselben Grund: `nachricht_empfaenger` ist die Zustellliste des
 * MITARBEITERposteingangs (EMP-11), und `app.portal() = 'intern' or (…)`
 * haette ihn stillgelegt.
 */
create policy p_kunde_decke on nachricht_empfaenger as restrictive for all to cse_app
  using (app.portal() <> 'kunde'
         or (kunde_id is not null
             and kunde_id = any (app.aktuelle_kunden())
             and kopf_geloescht_am is null
             and kopf_richtung <> 'intern'));

/**
 * **Und der Anhang.** `t_anhang_eigene` (0231) prueft `exists` auf
 * `nachricht` — das laeuft im Kunden-Scope jetzt durch, weil `t_kunde` auf
 * `nachricht` steht. `p_beteiligt` auf `nachricht_anhang` prueft dasselbe
 * `exists` und laesst es damit ebenfalls zu.
 *
 * Eine eigene Policy braucht es hier deshalb nicht — und `dokument` selbst
 * bleibt im Kunden-Scope trotzdem bei null Zeilen: es traegt zwar die
 * Kundendecke `p_kunde_ceiling` auf `sichtbar_fuer_kunde`, aber keine
 * PERMISSIVE `t_kunde`. Die Anhangsliste einer Kundennachricht ist damit
 * heute immer leer, und die Seite sagt das, statt einen Verweis auf einen
 * Download anzubieten, hinter dem 404 steht.
 *
 * // TODO(client, O-671): Duerfen Anhaenge einer Kundennachricht im Portal
 * heruntergeladen werden — also bekommt `dokument` eine permissive `t_kunde`
 * auf `sichtbar_fuer_kunde` (die Decke dafuer steht schon) —, oder bleiben
 * Anlagen dem Mailweg vorbehalten?
 */

-- ---------------------------------------------------------------------------
-- 4. Keine neuen Rechte, keine neuen Grants
-- ---------------------------------------------------------------------------

/**
 * `grant select … to cse_app` steht seit `0011`/`0231`; eine neue Spalte auf
 * einer Tabelle mit Tabellen-Grant braucht keinen eigenen. Und es entsteht
 * KEIN Schreibweg: `nachricht.versenden` ist der Rolle `kunde` im Seed
 * bewusst nicht erteilt, und ob ein Kunde im Portal ueberhaupt schreiben darf,
 * ist O-74 — bis dahin gibt es im Kundenportal keinen einzigen Schreibpfad.
 */
