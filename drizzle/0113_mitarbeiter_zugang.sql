/**
 * Der Mitarbeiter-Zugang: Telefon statt E-Mail, Einmalcode statt Passwort
 * (EMP-01, EMP-14, PR 20).
 *
 * **Warum kein Passwort.** Die Menschen, die hier lesen, stehen im Treppenhaus
 * eines Objekts, mit Handschuhen, auf einem Telefon, das sie sich teilen. Ein
 * Passwort waere hier keine Sicherheit, sondern ein Zettel im Putzwagen — und
 * genau so wird es in dieser Branche gehalten. Ein Code, der einmal gilt und
 * nach zehn Minuten verfaellt, ist nicht die bequeme Variante, sondern die
 * ehrlichere: er kann nicht aufgeschrieben werden.
 *
 * **Ein Zugang je PERSON, nicht je Anstellung (D-09, EMP-14).** Fatima putzt
 * vormittags fuer die CSE Dienstleistungen und bewacht abends eine
 * Veranstaltung fuer die SSE Security. Das sind zwei `anstellung`-Zeilen und
 * EIN Mensch. Haengte der Zugang an der Anstellung, haette sie zwei Logins
 * fuer dasselbe Telefon — und die Frage „welches nehme ich?" hat keine
 * Antwort, die sie interessieren sollte. `unique (person_id)` macht die
 * zweite Zeile unmoeglich, statt sie zu verbieten.
 *
 * **Die Nummer steht normalisiert und ist eindeutig.** Zwei Menschen mit
 * derselben Nummer waeren ein Konto, in das beide kommen; `+49 170 1234567`
 * und `01701234567` sind dieselbe Nummer und muessen es auch in der Spalte
 * sein, sonst legt die zweite Schreibweise ein zweites Konto an. Die
 * Normalisierung (E.164) macht der Dienst, die Eindeutigkeit haelt die
 * Datenbank.
 */
create table mitarbeiter_zugang (
  id              uuid primary key default gen_random_uuid(),

  /**
   * KEIN `mandant_id`. Diese Tabelle ist wie `person` mandantenuebergreifend
   * (Kern §1.6): sie beschreibt den Menschen, nicht seine Beschaeftigung.
   * Ein `mandant_id` hier waere genau der Fehler, den D-09 verbietet.
   */
  person_id       uuid not null unique references person(id),

  /** E.164, vom Dienst normalisiert — `+491701234567`. */
  telefon_e164    text not null unique
                  check (telefon_e164 ~ '^\+[1-9][0-9]{6,14}$'),

  /**
   * Der Zugang kann gesperrt werden, ohne die Person zu loeschen.
   * Austritt ist KEIN Loeschgrund: die Zeitnachweise des Menschen bleiben
   * zwei Jahre aufbewahrungspflichtig (§17 MiLoG), und sein Zugang gehoert
   * gesperrt, nicht entfernt.
   */
  gesperrt_am     timestamptz,
  gesperrt_grund  text,

  letzter_login_am timestamptz,

  erstellt_am     timestamptz not null default now(),
  geaendert_am    timestamptz,
  erstellt_von    uuid,
  geaendert_von   uuid,

  constraint zugang_sperre_stimmig
    check ((gesperrt_am is null) = (gesperrt_grund is null))
);

comment on table mitarbeiter_zugang is
  'Ein Login je Mensch (EMP-14, D-09). Telefon + Einmalcode, kein Passwort.';

/**
 * Der Einmalcode.
 *
 * **Der Code steht als Hash da, nie im Klartext.** Wer die Tabelle lesen
 * kann, koennte sich sonst als jeder Mitarbeiter anmelden — und lesen kann
 * sie im Zweifel mehr als einer: ein Backup, ein Log, ein Dump auf einem
 * Entwicklungsrechner. Dieselbe Begruendung wie bei `benutzer_sitzung`, das
 * nur `token_hash` haelt.
 *
 * **`verbraucht_am` und nicht `geloescht`.** Ein Code, der beim Einloesen
 * verschwindet, laesst sich nicht von einem unterscheiden, den es nie gab —
 * und genau das ist der Unterschied zwischen „Code schon benutzt" und „Code
 * falsch". Fuer die Wiedereinlöse-Abwehr braucht es die Zeile, nicht ihr
 * Fehlen.
 */
create table mitarbeiter_einmalcode (
  id            uuid primary key default gen_random_uuid(),
  zugang_id     uuid not null references mitarbeiter_zugang(id),

  /** SHA-256 des sechsstelligen Codes. */
  code_hash     text not null,

  /**
   * Zehn Minuten. Kurz genug, dass eine abgefangene SMS wertlos wird; lang
   * genug, dass jemand das Telefon aus der Jackentasche holen kann.
   */
  gueltig_bis   timestamptz not null,
  verbraucht_am timestamptz,

  /**
   * Fehlversuche JE CODE, nicht je Konto. Die Kontosperre haengt an
   * `kern.anmeldeversuch` (0007) und bleibt, wo sie ist; hier geht es um den
   * einzelnen Code: nach fuenf falschen Eingaben ist er verbrannt, auch wenn
   * er noch gilt. Sonst waere ein sechsstelliger Code mit beliebig vielen
   * Versuchen in Minuten zu raten.
   */
  fehlversuche  smallint not null default 0 check (fehlversuche >= 0),

  ip            inet,
  erstellt_am   timestamptz not null default now()
);

create index einmalcode_zugang_idx
  on mitarbeiter_einmalcode (zugang_id, erstellt_am desc);

/** Fuer den Aufraeumjob: abgelaufene Codes sind Datenmuell mit Personenbezug. */
create index einmalcode_purge_idx on mitarbeiter_einmalcode (gueltig_bis);

comment on table mitarbeiter_einmalcode is
  'Einmalcode je Zugang — als Hash, mit Ablauf, Verbrauch und Fehlversuchen.';

/**
 * RLS — nach dem Muster von `person` (0004), aus demselben Grund.
 *
 * **Wer den Menschen sieht, sieht seinen Zugang.** `person` ist lesbar aus
 * jedem Mandanten, mit dem der Mensch eine Anstellung hat; der Zugang folgt
 * dieser Sichtbarkeit, statt eine zweite danebenzustellen. Sonst saehe eine
 * Personalstelle die Person, aber nicht, ob sie ueberhaupt einen Zugang hat —
 * und die Frage „warum kommt Frau Yildiz nicht ins Portal?" waere von innen
 * nicht zu beantworten.
 *
 * **Die eigene Zeile sieht man immer.** `app.aktuelle_person()` deckt den
 * Fall, den die Anstellungsprüfung nicht erreicht: ein Mensch, der gerade
 * dabei ist, sich anzumelden, hat noch keine Sitzung und keinen Mandanten.
 * Dieser Weg laeuft deshalb NICHT ueber `cse_app`, sondern ueber die
 * Definer-Funktionen weiter unten — hier steht er der Vollstaendigkeit halber.
 */
alter table mitarbeiter_zugang    enable row level security;
alter table mitarbeiter_zugang    force  row level security;
alter table mitarbeiter_einmalcode enable row level security;
alter table mitarbeiter_einmalcode force  row level security;

create policy t_zugang_lesen on mitarbeiter_zugang for select to cse_app
  using (
    exists (select 1 from anstellung a
             where a.person_id = mitarbeiter_zugang.person_id
               and a.geloescht_am is null
               and a.mandant_id = any (app.sichtbare_mandanten()))
    or mitarbeiter_zugang.person_id = app.aktuelle_person()
  );

/**
 * Anlegen und Sperren gehoert der Personalstelle — mit genau einem aktiven
 * Mandanten und nicht in der Gruppenansicht (Invariante 10).
 */
create policy t_zugang_anlegen on mitarbeiter_zugang for insert to cse_app
  with check (app.assert_genau_ein_mandant() is not null and not app.ist_readonly());

create policy t_zugang_aendern on mitarbeiter_zugang for update to cse_app
  using (
    exists (select 1 from anstellung a
             where a.person_id = mitarbeiter_zugang.person_id
               and a.geloescht_am is null
               and a.mandant_id = any (app.sichtbare_mandanten()))
  )
  with check (app.assert_genau_ein_mandant() is not null and not app.ist_readonly());

/**
 * **Auf `mitarbeiter_einmalcode` bekommt `cse_app` KEINE Policy.**
 *
 * Unter FORCE heisst „keine anwendbare Policy" nicht *alles*, sondern
 * *nichts* — genau die Eigenschaft, die 0109 beim toten Leserecht auf
 * `vertrag_abrechnung` freigelegt hat, hier absichtlich eingesetzt. Der Code
 * geht die Anwendung nichts an: er wird von einer SECURITY-DEFINER-Funktion
 * erzeugt und von einer zweiten geprueft, und beide laufen unter `cse_definer`.
 * Ein Weg, auf dem die Anwendung den Hash lesen koennte, waere ein Weg, auf
 * dem ein Fehler in einer Route ihn herausgibt.
 */

/**
 * **Die Rechte — ohne die die Policies darüber tot wären.**
 *
 * Postgres prüft in dieser Reihenfolge: erst das GRANT, dann die Policy. Eine
 * Policy auf einer Tabelle, auf die `cse_app` kein Recht hat, wird nie
 * ausgewertet — sie steht da und tut nichts. Das ist der Spiegel des Befunds
 * aus `0109`: dort war das Recht da und der Weg fehlte, hier wäre der Weg da
 * und das Recht fehlte. Beide Male sieht die Migration vollständig aus.
 *
 * **Spalten, nicht Tabellen (K-05).** Die Personalstelle muss sehen, DASS
 * jemand einen Zugang hat, seit wann er zuletzt benutzt wurde und ob er
 * gesperrt ist — und sie muss ihn anlegen und sperren können. Was sie NICHT
 * braucht, ist `erstellt_von`/`geaendert_von` zu setzen: die schreibt der
 * Audit-Trigger.
 */
grant select (
  id, person_id, telefon_e164, gesperrt_am, gesperrt_grund,
  letzter_login_am, erstellt_am, geaendert_am
) on mitarbeiter_zugang to cse_app;

grant insert (person_id, telefon_e164) on mitarbeiter_zugang to cse_app;

/**
 * Ändern heißt hier: sperren, entsperren, Nummer korrigieren. NICHT
 * `person_id` — ein Zugang, der den Menschen wechselt, ist kein geänderter
 * Zugang, sondern ein fremder. Wer sich vertan hat, sperrt und legt neu an;
 * die alte Zeile bleibt als Spur stehen.
 */
grant update (telefon_e164, gesperrt_am, gesperrt_grund, geaendert_am)
  on mitarbeiter_zugang to cse_app;

/**
 * **Auf `mitarbeiter_einmalcode` bekommt `cse_app` KEIN Recht** — passend zu
 * der fehlenden Policy weiter oben. Die Ausnahme ist damit eine Verengung
 * und kein Loch: kein Recht UND keine Policy, beides bewusst.
 *
 * `cse_definer` braucht ebenfalls kein explizites Recht: die beiden
 * Funktionen in 0114 laufen als SECURITY DEFINER unter dem Eigentümer.
 */
