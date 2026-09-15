-- 0159 — Drei Stellen, an denen das Register mehr behauptete, als es hielt.

/**
 * **1 · Die Werkzeugfreischaltung schaltete auch das Verbotene frei.**
 *
 * `0154` setzte `agent_werkzeug.aktiv = true` über den ganzen Bestand, damit
 * die vier Demoagenten laufen. Damit standen aber auch Paare auf `aktiv`, die
 * `WERKZEUG_REGISTER` (der Vertrag in `src/server/agent/werkzeuge/`)
 * ausdrücklich NICHT kennt — `sende_email` für CEO, Akquise und Finanzen,
 * `berechne_preis` für CEO und Backoffice. `agent_werkzeug` ist genau die
 * Tabelle, die je Agent sagt, was er darf; eine Zeile darin, die der Vertrag
 * nicht trägt, ist eine Behauptung der Datenbank gegen den Code.
 *
 * Niemand hätte es bemerkt, solange der Orchestrator nur formuliert: er ruft
 * kein Werkzeug auf. Bemerkt hätte man es beim ersten Agenten, der eines
 * aufruft — und dann wäre die Frage „darf er das?" mit „die Tabelle sagt ja"
 * beantwortet worden.
 *
 * Zurückgenommen wird deshalb genau das, was 0154 zu viel geöffnet hat.
 * Die Wahrheit steht im Code; diese Migration bringt die Tabelle darauf
 * zurück.
 */
update agent_werkzeug set ist_aktiv = false, geaendert_am = now()
 where ist_aktiv and ((werkzeug = 'sende_email'
        and agent_id in (select id from agent
                          where kennung in ('ceo_assistent', 'akquise', 'finanzen')))
    or (werkzeug = 'berechne_preis'
        and agent_id in (select id from agent
                          where kennung in ('ceo_assistent', 'backoffice'))));

/**
 * **2 · Der Demobetrieb meldete sieben Fähigkeiten und kann zwei.**
 *
 * `0154` trug `demo:hausintern-v1` für jede `ki_faehigkeit` ein. `DemoModell`
 * implementiert `entwerfe` und `bette` — mehr nicht. Ein Aufruf für Vision,
 * Extraktion oder Klassifikation hätte ein Modell bekommen, das die Aufgabe
 * nicht kann, und der Statusbildschirm hätte die Fähigkeit als verfügbar
 * gemeldet. „Nicht verfügbar" ist ein Betriebszustand, den §8 vorsieht;
 * „verfügbar, aber kann es nicht" ist keiner.
 *
 * Die Zeilen bleiben stehen und werden auf `freigegeben = false` gesetzt:
 * `app.modell_fuer` überspringt sie damit, und die Tabelle behält die Spur,
 * dass es sie gab. Wer eine Fähigkeit nachrüstet, setzt eine Zeile zurück auf
 * `true` — und zwar dann, wenn der Port sie wirklich kann.
 */
update modell_register
   set freigegeben = false,
       bemerkung = coalesce(bemerkung || ' ', '')
         || 'Zurückgenommen in 0159: DemoModell implementiert nur entwurf_text und '
         || 'embedding. Eine Fähigkeit zu melden, die der Port nicht hat, ist schlimmer '
         || 'als sie abzuschalten (§8).'
 where anbieter = 'demo'
   and faehigkeit not in ('entwurf_text', 'embedding');

/**
 * **3 · Der Entwurf gehört als ARTEFAKT in die Akte, nicht nur in die Freigabe.**
 *
 * `agent_artefakt` ist die revidierbare, schwärzbare Zeile eines
 * Agentenergebnisses (LEG-09, APR-Diff). Der Orchestrator schrieb den Entwurf
 * bisher nur in den Schritt und in die Freigabe — beide tragen ihre
 * Löschfrist, die Aufbewahrung war also nicht offen; die ZEILE fehlte aber,
 * an der eine spätere Fassung hängt und gegen die ein Diff läuft.
 *
 * `cse_app` hat auf `agent_artefakt` **keine Schreibrechte**, und das bleibt
 * so: Artefakte schreiben Systemläufe. Diese Funktion ist der enge, benannte
 * Schreiber dafür — sie nimmt genau eine Aufgabe, prüft, dass sie im aktiven
 * Mandanten liegt, und schreibt sonst nichts.
 */
create function app.agent_artefakt_anlegen(
  p_aufgabe_id uuid,
  p_schritt_id uuid,
  p_art artefakt_art,
  p_vorlage text,
  p_inhalt jsonb,
  p_inhalt_hash text,
  p_frist_tage integer
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid;
  v_agent   uuid;
  v_id      uuid;
begin
  select a.mandant_id, a.agent_id into v_mandant, v_agent
    from public.agent_aufgabe a
   where a.id = p_aufgabe_id
     and a.mandant_id = app.aktiver_mandant();

  if v_mandant is null then
    raise exception 'Aufgabe % liegt nicht im aktiven Mandanten', p_aufgabe_id
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.agent_artefakt
    (mandant_id, agent_aufgabe_id, agent_schritt_id, art, status, vorlage,
     inhalt, inhalt_hash, nutzlast_loeschfrist_am, erstellt_von_art, erstellt_von_agent_id)
  values
    (v_mandant, p_aufgabe_id, p_schritt_id, p_art, 'entwurf', p_vorlage,
     p_inhalt, p_inhalt_hash,
     ((now() at time zone 'Europe/Berlin')::date + p_frist_tage)::timestamptz,
     'agent', v_agent)
  returning id into v_id;

  return v_id;
end
$$;

comment on function app.agent_artefakt_anlegen(uuid, uuid, artefakt_art, text, jsonb, text, integer) is
  'AGT-01, LEG-09. Legt das Ergebnis eines Agentenlaufs als Artefakt an. cse_app hat auf '
  'agent_artefakt kein insert; dies ist der einzige Weg aus einer Benutzersitzung.';

alter function app.agent_artefakt_anlegen(uuid, uuid, artefakt_art, text, jsonb, text, integer)
  owner to cse_definer;
revoke execute on function
  app.agent_artefakt_anlegen(uuid, uuid, artefakt_art, text, jsonb, text, integer) from public;
grant execute on function
  app.agent_artefakt_anlegen(uuid, uuid, artefakt_art, text, jsonb, text, integer) to cse_app;

grant select on public.agent_aufgabe to cse_definer;
grant insert on public.agent_artefakt to cse_definer;

-- FORCE row level security gilt auch fuer den Eigentuemer: ohne Policy
-- schriebe der Definer null Zeilen und meldete dabei keinen Fehler.
create policy d_agent_artefakt_anlegen on public.agent_artefakt
  for insert to cse_definer with check (true);
create policy d_agent_aufgabe_lesen on public.agent_aufgabe
  for select to cse_definer using (true);
