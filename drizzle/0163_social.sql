-- 0163 — Das Social Media Center (SOC-01…SOC-08).

/**
 * **Ein Beitrag ist ein ENTWURF, bis ein Mensch ihn freigegeben hat.**
 *
 * Das ist keine Vorsichtsmassnahme, sondern Invariante 7 an der Stelle, an
 * der sie am ehesten unterlaufen wird: ein Beitrag sieht harmlos aus. Er
 * traegt keinen Betrag, keine Frist und keine Unterschrift — und er ist
 * trotzdem eine Aussage der Gesellschaft nach aussen, die nach dem
 * Veroeffentlichen niemand zurueckholt. Ein Kundenname ohne Freigabe, eine
 * Baustelle mit erkennbarer Anschrift, ein Preis in einem Bild: alles Dinge,
 * die man nicht durch Loeschen ungeschehen macht.
 *
 * Deshalb laeuft der Weg ueber denselben Posteingang wie jede andere
 * Aussendung (`freigabe`, `vorgang_typ = 'beitrag_veroeffentlichen'`), und
 * `0136` verbietet dieser Vorgangsart bereits ausdruecklich die verzoegerte
 * Freigabe: ein Beitrag geht nicht raus, weil zwei Stunden vergangen sind.
 *
 * **Der Kanal ist ein ANSCHLUSS, keine Behauptung** (SOC-06, SOC-07). Die
 * fuenf fremden Plattformen tragen `verbunden = false`, solange keine
 * Zugangsdaten hinterlegt sind, und ein Beitrag an einen nicht verbundenen
 * Kanal wird NICHT als veroeffentlicht gefuehrt, sondern als das, was er ist:
 * liegen geblieben.
 *
 * **Die eigene Website ist kein Kanal** (SOC-05). Sie verlaesst das Haus
 * nicht, sie IST das Haus: ein freigegebener Beitrag steht auf der
 * Gesellschaftsseite, weil `beitrag.status` es sagt und die oeffentliche
 * Policy ihn durchlaesst — nicht, weil ein Adapter mit `true` geantwortet hat.
 * Sie als sechsten Kanal zu fuehren hiesse, zwei Wahrheiten ueber dieselbe
 * Seite zu halten, und beim ersten Auseinanderlaufen waere unklar, welche
 * gilt — dieselbe Ueberlegung wie beim Kalender in 0160.
 */

create type social_plattform as enum (
  'instagram',
  'facebook',
  'linkedin',
  'tiktok',
  'youtube'
);

comment on type social_plattform is
  'SOC-06. Die FREMDEN Plattformen. Die eigene Gesellschaftsseite steht bewusst nicht '
  'dabei: sie ist kein Anschluss, sondern diese Plattform selbst (SOC-05) — ein '
  'veroeffentlichter Beitrag steht dort, weil `beitrag.status` es sagt, nicht weil ein '
  'Adapter geantwortet hat. Zwei Wahrheiten ueber dieselbe Seite gaebe es sonst.';

create type beitrag_art as enum (
  'beitrag',
  'projektschau',
  'neuigkeit',
  'aktualisierung'
);

comment on type beitrag_art is
  'SOC-02. Die vier Arten aus der Anforderung — Bilder sind keine eigene Art, '
  'sondern haengen als `medien_id` an jeder von ihnen.';

/**
 * **Der Weg, und nur dieser Weg** (SOC-03).
 *
 * `entwurf` → `vorgelegt` → `freigegeben` → `geplant` → `veroeffentlicht`.
 *
 * `abgelehnt` und `zurueckgezogen` sind Enden, keine Zwischenschritte: aus
 * einem abgelehnten Beitrag wird kein veroeffentlichter, ohne dass jemand ihn
 * erneut vorlegt. Und `veroeffentlicht` ist ein Ende ohne Rueckweg — das
 * Zuruecknehmen eines Beitrags ist eine eigene Handlung auf der Plattform und
 * nicht eine Statusaenderung hier, die so tut, als sei nie etwas geschehen.
 */
create type beitrag_status as enum (
  'entwurf',
  'vorgelegt',
  'freigegeben',
  'geplant',
  'veroeffentlicht',
  'abgelehnt',
  'zurueckgezogen'
);

/**
 * **Was aus dem Beitrag JE KANAL geworden ist.**
 *
 * Ein Beitrag kann auf der eigenen Website stehen und bei Instagram liegen
 * geblieben sein. Ein einziger Status am Beitrag koennte das nicht sagen —
 * und die bequeme Antwort („veroeffentlicht") waere genau die Simulation, die
 * SOC-07 verbietet. `nicht_verbunden` ist deshalb ein ERGEBNIS, kein Fehler:
 * der Kanal existiert, er ist nur nicht angeschlossen, und das steht so da.
 */
create type kanal_ergebnis as enum (
  'offen',
  'veroeffentlicht',
  'nicht_verbunden',
  'fehlgeschlagen'
);

create table social_kanal (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  plattform     social_plattform not null,
  anzeigename   text not null,
  /** `@cse_gebaeudereinigung` — was auf der Plattform steht, nicht die URL. */
  handle        text,

  /**
   * **`verbunden` ist eine Tatsache ueber Zugangsdaten, kein Wunsch.**
   * Sie wird nicht von Hand gesetzt, sondern von `social.kanal_verbinden` —
   * und ein Kanal ohne hinterlegten Zugang kann sie gar nicht tragen
   * (`sk_verbunden_hat_zeitpunkt` unten).
   */
  verbunden     boolean not null default false,
  verbunden_am  timestamptz,
  /** Warum nicht — steht so auf dem Bildschirm (SOC-07). */
  hinweis       text,

  aktiv         boolean not null default true,
  sortierung    integer not null default 0,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  constraint social_kanal_pk primary key (mandant_id, id),
  constraint social_kanal_id_uk unique (id),
  /** Eine Gesellschaft fuehrt je Plattform genau EIN Profil (SOC-01). */
  constraint social_kanal_plattform_uk unique (mandant_id, plattform),
  constraint sk_anzeigename_nicht_leer check (btrim(anzeigename) <> ''),
  constraint sk_verbunden_hat_zeitpunkt check (
    not verbunden or verbunden_am is not null)
);

comment on table social_kanal is
  'SOC-01, SOC-06, SOC-07. Ein Kanal je Plattform und Gesellschaft. `verbunden` sagt, '
  'ob Zugangsdaten hinterlegt sind — nichts wird simuliert.';

create table beitrag (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  art           beitrag_art not null default 'beitrag',
  titel         text not null,
  text          text not null,
  status        beitrag_status not null default 'entwurf',

  /**
   * **Woraus der Beitrag stammt** (SOC-04). Beides optional und beides
   * mandantengebunden: ein Beitrag der Reinigung kann keine Referenz der
   * Bau-Gesellschaft zeigen, und der zusammengesetzte Fremdschluessel ist
   * die Stelle, an der das nicht durch ein Leck faellt, sondern durch einen
   * Verweis (K-03).
   */
  projekt_id    uuid,
  referenz_id   uuid,
  medien_id     uuid references medien(id),

  /**
   * **Die Freigabe, die diesen Beitrag traegt.** Ohne sie kommt er nicht
   * ueber `vorgelegt` hinaus; `beitrag_freigegeben_hat_freigabe` unten macht
   * daraus einen Riegel statt einer Verabredung.
   */
  freigabe_id   uuid,

  /** Wann er raus soll — Europe/Berlin angezeigt, UTC gespeichert (Inv. 2). */
  geplant_fuer  timestamptz,
  veroeffentlicht_am timestamptz,

  zurueckgezogen_am timestamptz,
  zurueckgezogen_grund text,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  constraint beitrag_pk primary key (mandant_id, id),
  constraint beitrag_id_uk unique (id),
  constraint beitrag_projekt_fk
    foreign key (mandant_id, projekt_id) references projekt (mandant_id, id),
  constraint beitrag_referenz_fk
    foreign key (mandant_id, referenz_id) references referenz (mandant_id, id),
  constraint beitrag_freigabe_fk
    foreign key (mandant_id, freigabe_id) references freigabe (mandant_id, id),

  constraint beitrag_titel_nicht_leer check (btrim(titel) <> ''),
  constraint beitrag_text_nicht_leer check (btrim(text) <> ''),

  /**
   * **Ab `freigegeben` haengt jeder Beitrag an einer Freigabe** (SOC-08,
   * Invariante 7). Ohne diese Bedingung liesse sich der Status mit einem
   * `update` setzen, und die Freigabe waere Zierde.
   */
  constraint beitrag_freigegeben_hat_freigabe check (
    status not in ('freigegeben', 'geplant', 'veroeffentlicht')
    or freigabe_id is not null),
  /** Geplant heisst: es steht ein Zeitpunkt da. */
  constraint beitrag_geplant_hat_zeitpunkt check (
    status <> 'geplant' or geplant_fuer is not null),
  constraint beitrag_veroeffentlicht_hat_zeitpunkt check (
    status <> 'veroeffentlicht' or veroeffentlicht_am is not null),
  constraint beitrag_rueckzug_begruendet check (
    zurueckgezogen_am is null
    or (zurueckgezogen_grund is not null and btrim(zurueckgezogen_grund) <> ''))
);

comment on table beitrag is
  'SOC-02, SOC-03, SOC-04. Der Beitrag selbst. Sein Weg nach draussen steht in '
  'beitrag_kanal — je Kanal ein eigenes Ergebnis.';

create table beitrag_kanal (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  beitrag_id    uuid not null,
  kanal_id      uuid not null,

  ergebnis      kanal_ergebnis not null default 'offen',
  veroeffentlicht_am timestamptz,
  /** Die Kennung auf der fremden Plattform — leer, solange nichts rausging. */
  externe_ref   text,
  /** Warum es nicht ging. Steht auf dem Bildschirm, nicht nur im Protokoll. */
  meldung       text,
  versuche      integer not null default 0 check (versuche >= 0),

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,

  constraint beitrag_kanal_pk primary key (mandant_id, id),
  constraint beitrag_kanal_uk unique (mandant_id, beitrag_id, kanal_id),
  constraint beitrag_kanal_beitrag_fk
    foreign key (mandant_id, beitrag_id) references beitrag (mandant_id, id) on delete cascade,
  constraint beitrag_kanal_kanal_fk
    foreign key (mandant_id, kanal_id) references social_kanal (mandant_id, id),
  constraint bk_veroeffentlicht_hat_zeitpunkt check (
    ergebnis <> 'veroeffentlicht' or veroeffentlicht_am is not null),
  /**
   * **Ein Ergebnis ohne Grund ist keine Auskunft.** „nicht verbunden" und
   * „fehlgeschlagen" sind genau die beiden Faelle, in denen ein Mensch
   * wissen will, woran es lag — und in denen die bequeme Antwort ein leeres
   * Feld waere.
   */
  constraint bk_misserfolg_hat_meldung check (
    ergebnis not in ('nicht_verbunden', 'fehlgeschlagen')
    or (meldung is not null and btrim(meldung) <> ''))
);

comment on table beitrag_kanal is
  'SOC-07. Je Beitrag und Kanal ein Ergebnis. `nicht_verbunden` ist ein Ergebnis, '
  'kein Fehler — und niemals `veroeffentlicht`.';

create index beitrag_status_idx on beitrag (mandant_id, status, erstellt_am desc);
create index beitrag_plan_idx on beitrag (mandant_id, geplant_fuer)
  where status = 'geplant';
create index beitrag_oeffentlich_idx on beitrag (mandant_id, veroeffentlicht_am desc)
  where status = 'veroeffentlicht';
create index beitrag_kanal_beitrag_idx on beitrag_kanal (mandant_id, beitrag_id);

create trigger social_kanal_geaendert before update on social_kanal
  for each row execute function kern.setze_geaendert_am();
create trigger beitrag_geaendert before update on beitrag
  for each row execute function kern.setze_geaendert_am();
create trigger beitrag_kanal_geaendert before update on beitrag_kanal
  for each row execute function kern.setze_geaendert_am();


/* ── Rechte und Riegel ──────────────────────────────────────────────────── */

alter table social_kanal  enable row level security;
alter table social_kanal  force  row level security;
alter table beitrag       enable row level security;
alter table beitrag       force  row level security;
alter table beitrag_kanal enable row level security;
alter table beitrag_kanal force  row level security;

/**
 * **Der veroeffentlichte Beitrag ist oeffentlich — und nur er** (SOC-05).
 *
 * Die Bedingung steht in der POLICY und nicht nur im Dienst. Ein Dienst, der
 * `where status = 'veroeffentlicht'` vergisst, waere sonst der Weg, auf dem
 * ein Entwurf auf der Website landet; hier ist er null Zeilen. Dieselbe
 * Trennung wie bei `referenz` in 0015, und aus demselben Grund: ein Text, der
 * versehentlich oeffentlich wurde, laesst sich nicht zurueckholen.
 *
 * `zurueckgezogen_am is null` steht mit dabei, weil ein zurueckgezogener
 * Beitrag `veroeffentlicht_am` behaelt — er WAR draussen, und das Protokoll
 * luegt darueber nicht (Invariante 8: keine harten Loeschungen).
 */
create policy t_beitrag_oeffentlich on beitrag for select to cse_app
  using (status = 'veroeffentlicht' and zurueckgezogen_am is null);

create policy t_beitrag_lesen on beitrag for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('social.lesen', app.aktiver_mandant())));

/** Gruppenansicht: lesen ja, schreiben nie (Invariante 10, TEN-05). */
create policy t_beitrag_gruppe on beitrag for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.social.lesen')));

create policy t_beitrag_schreiben on beitrag for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('social.schreiben', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('social.schreiben', app.aktiver_mandant())));

/**
 * **Die K-04-Decke gilt fuer das SCHREIBEN, nicht fuer das Lesen** — und das
 * ist hier kein Versehen, sondern der Unterschied zwischen dieser Tabelle und
 * `kalender_eintrag`.
 *
 * Eine restriktive Decke wirkt ZUSAETZLICH zu jeder erlaubenden Regel, also
 * auch zu `t_beitrag_oeffentlich`. Die oeffentliche Seite laeuft ohne Sitzung;
 * `app.portal()` faellt dort auf den fail-closed-Wert `mitarbeiter`
 * (`0004`) — eine Lesedecke auf `intern` machte die Gesellschaftsseite also
 * LEER, und zwar schweigend. Genau der Fall, den `referenz` (0015) und `seite`
 * (0014) seit jeher ohne Decke loesen: dort traegt die oeffentliche Policy
 * ihre Bedingung selbst, und mehr braucht es nicht.
 *
 * Was ein Lesen ohne Decke heute sehen kann, ist genau das, was ohnehin auf
 * der Website steht. Die internen Regeln darueber verlangen `social.lesen`
 * bzw. `gruppe.social.lesen`, und die haelt weder ein Kundenzugang noch ein
 * Mitarbeiterkonto.
 *
 * **Geschrieben wird dagegen nur von innen.** `delete` fehlt bewusst in
 * beiden Deckeln — es ist auf `beitrag` gar nicht zugeteilt (siehe unten).
 */
create policy p_beitrag_decke_neu on beitrag as restrictive for insert to cse_app
  with check (app.portal() = 'intern');
create policy p_beitrag_decke_aendern on beitrag as restrictive for update to cse_app
  using      (app.portal() = 'intern')
  with check (app.portal() = 'intern');

create policy j_beitrag on beitrag for all to cse_job using (true) with check (true);

create policy t_kanal_lesen on social_kanal for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('social.lesen', app.aktiver_mandant())));

create policy t_kanal_gruppe on social_kanal for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.social.lesen')));

/**
 * **Verbinden ist ein eigenes Recht** (SOC-06). Wer Beitraege schreibt, legt
 * damit noch keine Zugangsdaten zu einem fremden Netz an — das ist die
 * Trennung, die `social.kanal_verbinden` im Katalog seit 0008 vorsieht und
 * die hier zum ersten Mal etwas bewacht.
 */
create policy t_kanal_verwalten on social_kanal for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('social.kanal_verbinden', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('social.kanal_verbinden', app.aktiver_mandant())));

/**
 * Hier gilt die Decke fuer ALLES: `social_kanal` hat keine oeffentliche
 * Seite. Was auf der Website steht, ist der Beitrag — nicht, ueber welche
 * Anschluesse das Haus verfuegt.
 */
create policy p_kanal_decke on social_kanal as restrictive for all to cse_app
  using      (app.portal() = 'intern')
  with check (app.portal() = 'intern');

create policy j_kanal on social_kanal for all to cse_job using (true) with check (true);

create policy t_beitrag_kanal_lesen on beitrag_kanal for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('social.lesen', app.aktiver_mandant())));

create policy t_beitrag_kanal_gruppe on beitrag_kanal for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.social.lesen')));

create policy t_beitrag_kanal_schreiben on beitrag_kanal for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('social.schreiben', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('social.schreiben', app.aktiver_mandant())));

/** Auch das Ergebnisblatt ist Betriebswissen und bleibt drinnen. */
create policy p_beitrag_kanal_decke on beitrag_kanal as restrictive for all to cse_app
  using      (app.portal() = 'intern')
  with check (app.portal() = 'intern');

/**
 * **Geloescht wird nur, was nie hinausging.**
 *
 * Der Kommentar bei den Zuteilungen sagte, der Dienst lasse das Loeschen nur
 * bei `ergebnis = 'offen'` zu — und genau das stand nirgends in der Datenbank.
 * Damit war die Zusicherung eine Verabredung: ein `delete` an der
 * Dienstschicht vorbei loeschte auch die Zeile eines Kanals, auf dem wirklich
 * etwas veroeffentlicht wurde, und die Auskunft „wo stand das wann" waere
 * hinterher schlicht weg. Invariante 3 verlangt die zweite Linie hier ebenso
 * wie ueberall sonst: RLS ist nie die einzige, aber auch nie die fehlende.
 *
 * `offen` heisst: es wurde noch nichts versucht. Ein Kanal aus einem Entwurf
 * herauszunehmen bleibt damit eine Korrektur am Plan; ein `veroeffentlicht`,
 * `nicht_verbunden` oder `fehlgeschlagen` ist ein Ereignis und bleibt stehen.
 */
create policy p_beitrag_kanal_kein_loeschen on beitrag_kanal
  as restrictive for delete to cse_app
  using (ergebnis = 'offen');

create policy j_beitrag_kanal on beitrag_kanal for all to cse_job using (true) with check (true);

/**
 * **Kein hartes Loeschen auf einem Beitrag.**
 *
 * `delete` fehlt in der Zuteilung mit Absicht: ein veroeffentlichter Beitrag
 * wird ZURUECKGEZOGEN, und das ist eine andere Aussage als „hat es nie
 * gegeben". Invariante 8 nennt Finanz, Zeit und Audit — eine Aussendung nach
 * aussen gehoert in dieselbe Klasse, weil sie geschehen ist und weil jemand
 * hinterher fragen wird, was wann draussen stand.
 *
 * `beitrag_kanal` darf dagegen geloescht werden: einen Kanal aus einem
 * ENTWURF wieder herauszunehmen ist eine Korrektur am Plan. Der Dienst laesst
 * es nur zu, solange nichts rausging (`ergebnis = 'offen'`).
 */
grant select, insert, update on beitrag to cse_app;
grant select, insert, update on beitrag to cse_job;
grant select, insert, update, delete on beitrag_kanal to cse_app;
grant select, insert, update, delete on beitrag_kanal to cse_job;
grant select, insert, update on social_kanal to cse_app;
grant select, insert, update on social_kanal to cse_job;


/* ── Der Riegel: freigegeben heisst GENEHMIGT ───────────────────────────── */

/**
 * **`freigabe_id is not null` ist kein Riegel, sondern ein Zeiger.**
 *
 * `beitrag_freigegeben_hat_freigabe` verlangte eine Freigabe — irgendeine.
 * Eine OFFENE erfuellte die Bedingung genauso wie eine ABGELEHNTE, und damit
 * liess sich ein Beitrag auf `freigegeben` setzen, waehrend die Entscheidung
 * darueber noch im Posteingang lag oder bereits verneint war. Invariante 7
 * sagt nicht „es liegt ein Vorgang vor", sie sagt: ein Mensch hat zugestimmt.
 *
 * Eine `check`-Bedingung kann das nicht: sie darf keine andere Tabelle lesen.
 * Ein Ausloeser also — und er liest die Freigabe NICHT selbst, sondern fragt
 * `app.freigabe_genehmigt` (0123, dreiargumentig seit 0130). Die Frage ist
 * dieselbe, die schon der Kreditor und die Mahnung stellen, und sie ist
 * strukturell: ja/nein zu einer Kennung, die der Aufrufer ohnehin in der Hand
 * hat. Ein eigenes `select … from freigabe` waere hier ein zweiter Weg zu
 * derselben Auskunft — mit einem breiteren Spaltenrecht als K-01 zulaesst.
 *
 * **Die AKTION geht mit** (0130 §6). Ohne sie oeffnete eine Zustimmung zu
 * einem Mahnbrief einen Beitrag auf Instagram: dieselbe Kennung, derselbe
 * Mandant, derselbe Status — und eine voellig andere Entscheidung.
 */
--  Was diese Freigabe genehmigt haben muss, damit ein Beitrag hinausgeht.
--  Derselbe Wert, den `legeVor` (services/social/dienst.ts) einsetzt.

create function app.beitrag_braucht_genehmigung() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  if new.status not in ('freigegeben', 'geplant', 'veroeffentlicht') then
    return new;
  end if;
  if new.freigabe_id is null
     or not app.freigabe_genehmigt(new.freigabe_id, new.mandant_id,
                                   'social_veroeffentlichen') then
    raise exception using
      errcode = 'check_violation',
      message = 'Ein Beitrag wird freigegeben, geplant oder veroeffentlicht nur mit '
              || 'einer GENEHMIGTEN Freigabe (Invariante 7, SOC-08).',
      detail  = format('Beitrag %s, Freigabe %s.', new.id,
                       coalesce(new.freigabe_id::text, 'keine'));
  end if;
  return new;
end;
$$;
alter function app.beitrag_braucht_genehmigung() owner to cse_definer;
revoke all on function app.beitrag_braucht_genehmigung() from public;

create trigger beitrag_braucht_genehmigung
  before insert or update of status, freigabe_id on beitrag
  for each row execute function app.beitrag_braucht_genehmigung();


/* ── Die Entscheidung zieht den Beitrag nach ────────────────────────────── */

/**
 * **Der Beitrag folgt seiner Freigabe — in der Datenbank, nicht im Aufrufer.**
 *
 * Der naheliegende Ort waere ein Ausfuehrer in `freigabe/ausfuehrung.ts`. Er
 * waere die halbe Loesung: `fuehreAus` laeuft nur bei `genehmigt` (siehe
 * `api/freigaben/[id]/entscheidung` und `freigabe/stapel.ts`). Bei einer
 * ABLEHNUNG liefe er gar nicht, und der Beitrag bliebe auf „In Prüfung"
 * stehen, waehrend seine Freigabe abgelehnt ist. Zwei Bildschirme, zwei
 * Antworten, und niemand sucht danach.
 *
 * Deshalb haengt der Nachzug an der Zustandsaenderung selbst. Er gilt fuer
 * jeden Weg, der je eine Freigabe entscheidet — den Einzelfall, den Stapel und
 * jeden kuenftigen —, und er laeuft in DERSELBEN Transaktion: eine
 * Entscheidung, die zurueckrollt, nimmt den Beitrag mit.
 *
 * **`cse_definer`, nicht der Eigentuemer** (K-08). Und weil diese Rolle unter
 * FORCE RLS ohne eigene Policy null Zeilen sieht — schweigend —, stehen
 * Zuteilung UND Policy darunter. Genau dieser Fehler hat in 0162 einen
 * Browserlauf gekostet.
 */
create function app.beitrag_folgt_freigabe() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'genehmigt' then
    update public.beitrag set status = 'freigegeben'
     where freigabe_id = new.id and status = 'vorgelegt';
  elsif new.status = 'abgelehnt' then
    update public.beitrag set status = 'abgelehnt'
     where freigabe_id = new.id and status = 'vorgelegt';
  end if;

  return new;
end;
$$;

comment on function app.beitrag_folgt_freigabe() is
  'SOC-03, SOC-08. Zieht den Beitrag nach, wenn seine Freigabe entschieden wird — '
  'auch bei einer ABLEHNUNG, die kein Ausfuehrer je sieht.';

alter function app.beitrag_folgt_freigabe() owner to cse_definer;

/**
 * **Eine Triggerfunktion ruft niemand von Hand — also darf es auch niemand.**
 *
 * Ohne diese Zeile stuende sie mit PUBLIC-EXECUTE da wie jede frisch angelegte
 * Funktion. Bei einer SECURITY-DEFINER-Funktion heisst das: jeder Aufrufer
 * koennte sie mit den Rechten von `cse_definer` ausfuehren. Hier waere der
 * Schaden begrenzt (sie erwartet einen Triggerkontext und faellt sonst auf die
 * Nase), aber die Regel ist die Regel, und `definer-eigentum.test.ts` zaehlt
 * mit: es gibt GENAU EINE `app`-Funktion ohne eigene Zuteilung, und das ist
 * `app.sichtbare_mandanten()`. Eine zweite laesst die Pruefung fallen -- und
 * genau dafuer steht sie da.
 *
 * Der Trigger selbst braucht kein EXECUTE: Postgres ruft die Funktion als
 * Eigentuemer der Tabelle auf, nicht als der Rolle, die das UPDATE macht.
 */
revoke all on function app.beitrag_folgt_freigabe() from public;

grant select, update on public.beitrag to cse_definer;
create policy d_beitrag_folgt on beitrag for select to cse_definer using (true);
create policy d_beitrag_nachzug on beitrag as permissive for update to cse_definer
  using (true) with check (true);

create trigger freigabe_zieht_beitrag_nach
  after update of status on freigabe
  for each row execute function app.beitrag_folgt_freigabe();
