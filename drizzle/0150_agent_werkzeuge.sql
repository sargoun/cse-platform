-- 0150 · Die neun Werkzeuge (AGT-02) und das Artefakt, das ein Entwurf ist
--
-- **Was hier NICHT entsteht: ein Agent, der läuft.** Es gibt keinen
-- Modellzugang (D-435), und ohne ihn gibt es keinen Orchestrator. Was
-- entsteht, ist das, was ein Orchestrator RUFEN würde — und das ist der
-- interessantere Teil: die Grenze zwischen dem, was ein Modell vorschlagen
-- darf, und dem, was Code rechnet.
--
-- **`berechne_preis` ist reiner Code, und das steht im SPEC** (AGT-02,
-- Invariante 6). Es ruft `kalkuliere()` — dieselbe getestete Funktion, die
-- die Angebotsseite ruft. Ein Modell, das einen Preis „berechnet", ist ein
-- Modell, das rät; der Unterschied fällt bei einem Angebot über 486.000 €
-- nicht in der Prüfung auf, sondern im Nachhinein.
--
-- **`erfordert_freigabe` kann verschärfen, nie lockern.** Der CHECK auf
-- `sende_email` ist die Zeile, die Invariante 7 in der Datenbank festhält:
-- „nichts verlässt das System ohne menschliche Freigabe" darf sich nicht
-- über ein Häkchen in der Oberfläche abschalten lassen.

/**
 * `agent_werkzeug_name` steht seit 0128 — damals absichtlich vor seiner
 * Tabelle, damit `agent_schritt.werkzeug` typisiert ist und ein zehntes
 * Werkzeug sich gar nicht erst protokollieren lässt. Hier kommt nur die
 * Tabelle dazu, die der Typ seither erwartet hat.
 */
comment on type agent_werkzeug_name is
  'AGT-02, die neun. Mehr gibt es nicht: ein Werkzeug, das nicht hier steht, kann kein '
  'Orchestrator aufrufen — und keine Richtlinie es erlauben.';

create type artefakt_art as enum (
  'lv_extrakt', 'textentwurf', 'email_entwurf', 'angebot_entwurf',
  'vergabemappe_entwurf', 'zusammenfassung', 'shortlist');

create type artefakt_status as enum ('entwurf', 'freigegeben', 'verworfen', 'ersetzt');

-- ---------------------------------------------------------------------------
-- (1) Welches Werkzeug ist für welchen Agenten in welcher Gesellschaft an?
-- ---------------------------------------------------------------------------

create table agent_werkzeug (
  id                  uuid primary key default gen_random_uuid(),
  mandant_id          uuid not null references mandant(id),
  agent_id            uuid not null references agent(id),

  werkzeug            agent_werkzeug_name not null,
  ist_aktiv           boolean not null default false,
  /**
   * Darf eine Gesellschaft ein Werkzeug schärfer stellen als die Richtlinie?
   * Ja. Umgekehrt nie — siehe den CHECK.
   */
  erfordert_freigabe  boolean not null default true,
  /** z. B. die Höchstgrösse für `lies_dokument`. Kein Geld, keine Menge (K-10). */
  parameter           jsonb not null default '{}',

  erstellt_von_art    akteur_art not null default 'mensch',
  erstellt_von        uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_am         timestamptz not null default now(),
  geaendert_am        timestamptz,
  geaendert_von       uuid references benutzer(id),

  constraint aw_mandant_uk unique (mandant_id, id),
  constraint aw_uk unique (mandant_id, agent_id, werkzeug),
  /**
   * **Invariante 7 als Zeile in der Datenbank.** Jeder Versand nach draussen
   * braucht eine menschliche Freigabe; ein Häkchen in der Oberfläche darf das
   * nicht abschalten können. Hier steht es so, dass auch ein direkter UPDATE
   * scheitert.
   */
  constraint aw_versand_immer_freigabe check (
    werkzeug <> 'sende_email' or erfordert_freigabe)
);

create index aw_aktiv_idx on agent_werkzeug (mandant_id, agent_id) where ist_aktiv;

comment on table agent_werkzeug is
  'AGT-01, AGT-02, Invariante 7. Welches der neun Werkzeuge fuer einen Agenten in einer '
  'Gesellschaft freigeschaltet ist — und ob es zusaetzlich eine Freigabe verlangt.';

create trigger trg_aw_geaendert before update on agent_werkzeug
  for each row execute function kern.setze_geaendert_am();

-- ---------------------------------------------------------------------------
-- (2) Das Artefakt — ein Entwurf ist eine Zeile, kein Textfeld
-- ---------------------------------------------------------------------------

/**
 * **Warum ein eigener Tisch und kein `jsonb` an der Freigabe.** Ein Entwurf
 * entsteht in einem Schritt, kann in einem späteren überarbeitet werden, wird
 * gegen seinen Vorgänger verglichen (das ist APR-02s Diff) und unterliegt
 * derselben Löschfrist wie die Modellnutzlast, aus der er stammt (LEG-09).
 * Eine Spalte an `freigabe` könnte keine dieser vier Tatsachen tragen: kein
 * Vergleich zweier Entwürfe, keine Angabe, welcher Schritt ihn erzeugt hat,
 * und kein Schwärzen ohne eine Freigabezeile zu ändern, die der
 * Einfrier-Trigger gar nicht ändern lässt.
 */
create table agent_artefakt (
  id                uuid primary key default gen_random_uuid(),
  mandant_id        uuid not null references mandant(id),

  agent_aufgabe_id  uuid not null,
  agent_schritt_id  uuid,

  art               artefakt_art not null,
  status            artefakt_status not null default 'entwurf',
  /** Die Vorlage, aus der ein Textentwurf entstand — sonst leer. */
  vorlage           text,
  /** Der Entwurf selbst. Nutzlast, und deshalb schwärzbar (LEG-09). */
  inhalt            jsonb not null default '{}',
  inhalt_hash       text not null,
  /** Der Vorgänger, gegen den APR-02 vergleicht. */
  ersetzt_artefakt_id uuid,

  nutzlast_loeschfrist_am timestamptz,
  nutzlast_geloescht_am   timestamptz,

  erstellt_von_art  akteur_art not null default 'agent',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_agent_id uuid references agent(id),
  erstellt_am       timestamptz not null default now(),
  geaendert_am      timestamptz,
  geaendert_von     uuid references benutzer(id),

  constraint aa_mandant_uk unique (mandant_id, id),
  constraint aa_aufgabe_fk foreign key (mandant_id, agent_aufgabe_id)
    references agent_aufgabe (mandant_id, id),
  constraint aa_schritt_fk foreign key (mandant_id, agent_schritt_id)
    references agent_schritt (mandant_id, id),
  constraint aa_vorgaenger_fk foreign key (mandant_id, ersetzt_artefakt_id)
    references agent_artefakt (mandant_id, id),
  /** Eine Vorlage gibt es nur bei den drei Arten, die eine haben. */
  constraint aa_vorlage_nur_bei_text check (
    vorlage is null
    or art in ('textentwurf', 'email_entwurf', 'angebot_entwurf'))
);

create index aa_aufgabe_idx on agent_artefakt (mandant_id, agent_aufgabe_id, erstellt_am);
create index aa_offen_idx on agent_artefakt (mandant_id, status) where status = 'entwurf';

comment on table agent_artefakt is
  'AGT-02, APR-02, LEG-09. Der Entwurf als Zeile: vergleichbar, einem Schritt zuordenbar und '
  'schwaerzbar, ohne eine eingefrorene Freigabe anzufassen.';

create trigger trg_aa_geaendert before update on agent_artefakt
  for each row execute function kern.setze_geaendert_am();

-- ---------------------------------------------------------------------------
-- (3) RLS
-- ---------------------------------------------------------------------------

alter table agent_werkzeug enable row level security;
alter table agent_werkzeug force  row level security;
alter table agent_artefakt enable row level security;
alter table agent_artefakt force  row level security;

create policy t_werkzeug_lesen on agent_werkzeug for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('agent.lesen', app.aktiver_mandant()));
/** Verbinden und trennen ist ein eigenes Recht — nicht „wer den Agenten sieht". */
create policy t_werkzeug_schreiben on agent_werkzeug for all to cse_app
  using      (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('agent.werkzeug_verbinden', app.aktiver_mandant()))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('agent.werkzeug_verbinden', app.aktiver_mandant()));
create policy t_werkzeug_gruppe on agent_werkzeug for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.agent.lesen')));
create policy p_intern_ceiling on agent_werkzeug as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

/**
 * **Der Entwurf ist lesbar, sein INHALT nicht.** `agent.lesen` öffnet die
 * Zeile — dass ein Entwurf entstand, mit welcher Art und welchem Stand. Der
 * Inhalt ist Nutzlast und gehört hinter `agent.protokoll_lesen`, wie der
 * Schrittinhalt auch (D-433); der Spaltenschnitt unten setzt das durch.
 */
create policy t_artefakt_lesen on agent_artefakt for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('agent.lesen', app.aktiver_mandant()));
create policy p_intern_ceiling on agent_artefakt as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

grant select on agent_werkzeug to cse_app;
grant insert, update on agent_werkzeug to cse_app;
/**
 * `inhalt` fehlt hier mit Absicht: der Entwurfstext ist Nutzlast. Wer ihn
 * sehen darf, liest ihn über `app.agent_artefakt_lesen` — dieselbe Trennung
 * wie beim Schrittprotokoll.
 */
grant select (id, mandant_id, agent_aufgabe_id, agent_schritt_id, art, status, vorlage,
              inhalt_hash, ersetzt_artefakt_id, nutzlast_loeschfrist_am, nutzlast_geloescht_am,
              erstellt_von_art, erstellt_von, erstellt_von_agent_id, erstellt_am, geaendert_am)
  on agent_artefakt to cse_app;

create policy j_agent_werkzeug on agent_werkzeug for select to cse_job using (true);
create policy j_agent_artefakt on agent_artefakt for all to cse_job using (true) with check (true);
grant select on agent_werkzeug to cse_job;
grant select, insert, update on agent_artefakt to cse_job;

create policy d_agent_artefakt on agent_artefakt for select to cse_definer using (true);
grant select on agent_artefakt to cse_definer;

-- ---------------------------------------------------------------------------
-- (4) Der Leser für den Entwurfsinhalt — wie beim Schrittprotokoll
-- ---------------------------------------------------------------------------

/**
 * Gibt den Entwurfstext heraus, wenn die Sitzung `agent.protokoll_lesen`
 * hält — und schreibt jeden Zugriff ins Protokoll (D-433, LEG-09).
 *
 * **`null` statt einer Ausnahme**, weil das Fehlen des Rechts kein Fehler
 * ist, sondern eine Auskunft: die Seite zeigt dann „Inhalt nicht sichtbar"
 * und nicht einen roten Kasten.
 */
create function app.agent_artefakt_lesen(p_artefakt uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_inhalt  jsonb;
  v_geloescht timestamptz;
begin
  if v_mandant is null or not app.hat_recht('agent.protokoll_lesen', v_mandant) then
    return null;
  end if;
  select a.inhalt, a.nutzlast_geloescht_am into v_inhalt, v_geloescht
    from public.agent_artefakt a
   where a.id = p_artefakt and a.mandant_id = v_mandant;
  if not found then return null; end if;
  if v_geloescht is not null then
    return jsonb_build_object('geschwaerzt', true, 'am', v_geloescht);
  end if;
  return v_inhalt;
end $$;

comment on function app.agent_artefakt_lesen(uuid) is
  'Der Entwurfsinhalt unter agent.protokoll_lesen (AGT-02, APR-02, LEG-09). Ohne das Recht '
  'null — kein Fehler, eine Auskunft.';

alter function app.agent_artefakt_lesen(uuid) owner to cse_definer;
revoke execute on function app.agent_artefakt_lesen(uuid) from public;
grant execute on function app.agent_artefakt_lesen(uuid) to cse_app;
