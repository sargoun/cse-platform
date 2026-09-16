/**
 * 0168 — Der Status einer Bewerbung wandert NUR über eine Entscheidung
 * (REC-08, Art. 22 DSGVO, Invariante 3).
 *
 * **Was 0166 offen liess.** `t_bewerbung_schreiben` gab jedem `update` auf
 * `bewerbung` frei, der `recruiting.bewerbung_lesen` hält — ohne Spalten- und
 * ohne Zustandsgrenze. Wer Bewerbungen ansehen darf, konnte damit `status`
 * setzen, Namen und Adresse ändern, `aufbewahrung_bis` verschieben oder
 * `loeschsperre` setzen und wieder wegnehmen. Der Riegel
 * `kern.entscheidung_ist_menschlich` steht auf `einstellungsentscheidung` und
 * hielt genau die eine Tür zu, während die Wand daneben offen stand: `status =
 * 'eingestellt'` liess sich direkt schreiben, ohne Entscheidung, ohne
 * Begründung und ohne Namen dessen, der sie traf. Gemeldet hat das die
 * Copilot-Runde auf PR 16.
 *
 * **Die Anwendung braucht diese Erlaubnis nicht.** Im ganzen Baum gibt es
 * genau zwei Schreiber auf `bewerbung`: den Nachtlauf (`bewerber_loeschung`,
 * als `cse_job` mit eigenen `j_*`-Policies) und den Auslöser
 * `entscheidung_zieht_bewerbung_nach`. Der Auslöser läuft als der Aufrufer,
 * und genau deshalb brauchte er die breite Policy — er bekommt jetzt seine
 * eigene, so wie `app.beitrag_folgt_freigabe` in 0163: `security definer`,
 * Eigentum bei `cse_definer`, mit einer Policy, die nur diese eine Funktion
 * benutzt.
 *
 * Danach gilt: **`cse_app` kann `bewerbung` lesen und einfügen, nicht
 * ändern.** Der Status bewegt sich ausschliesslich über eine Entscheidung, die
 * einen Menschen trägt.
 */

-- ---------------------------------------------------------------------------
-- 1. Der Nachzug wird ein Definer
-- ---------------------------------------------------------------------------

/**
 * **`security definer` und `cse_definer` als Eigentümer** (K-08).
 *
 * `create or replace` ginge nicht: die alte Funktion liegt in `kern` und ohne
 * `security definer`. Die neue steht in `app` — dort stehen die Definer —, der
 * Auslöser zeigt danach auf sie, und die alte fällt weg. Ein zweiter Weg zu
 * demselben Nachzug wäre einer zu viel.
 */
create function app.entscheidung_zieht_bewerbung_nach() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  update public.bewerbung
     set status = new.ergebnis, geaendert_am = now()
   where id = new.bewerbung_id and mandant_id = new.mandant_id;
  return new;
end $$;

comment on function app.entscheidung_zieht_bewerbung_nach() is
  'REC-08. Zieht den Status der Bewerbung nach, in DERSELBEN Transaktion wie '
  'die Entscheidung. Definer, damit cse_app selbst nicht auf bewerbung '
  'schreiben muss — der Status bewegt sich nur ueber eine Entscheidung.';

alter function app.entscheidung_zieht_bewerbung_nach() owner to cse_definer;

/**
 * Eine Triggerfunktion ruft niemand von Hand — also darf es auch niemand. Bei
 * einer SECURITY-DEFINER-Funktion hiesse PUBLIC-EXECUTE: jeder Aufrufer
 * könnte sie mit den Rechten von `cse_definer` ausführen.
 * `definer-eigentum.test.ts` zählt mit.
 */
revoke all on function app.entscheidung_zieht_bewerbung_nach() from public;

/**
 * **Zuteilung UND Policy** — `cse_definer` steht unter FORCE RLS und sähe ohne
 * eigene Policy null Zeilen, schweigend. Genau dieser Fehler hat in 0162 einen
 * Browserlauf gekostet.
 */
grant select, update on public.bewerbung to cse_definer;
create policy d_bewerbung_nachzug_lesen on bewerbung for select to cse_definer
  using (true);
create policy d_bewerbung_nachzug on bewerbung as permissive for update to cse_definer
  using (true) with check (true);

drop trigger entscheidung_zieht_bewerbung_nach on einstellungsentscheidung;
drop function kern.entscheidung_zieht_bewerbung_nach();

create trigger entscheidung_zieht_bewerbung_nach
  after insert on einstellungsentscheidung
  for each row execute function app.entscheidung_zieht_bewerbung_nach();

-- ---------------------------------------------------------------------------
-- 2. Und die breite Erlaubnis faellt weg
-- ---------------------------------------------------------------------------

/**
 * **Erst die Policy, dann das Recht.** Eine Policy ohne `grant` ist tot, ein
 * `grant` ohne Policy ist es auch — beides zusammen wegzunehmen ist die
 * einzige Reihenfolge, die keinen halben Zustand hinterlässt (D-388).
 *
 * `insert` bleibt: `t_bewerbung_eingang` ist der öffentliche Eingang vom
 * Karriereformular. `select` bleibt. `update` geht.
 */
drop policy t_bewerbung_schreiben on bewerbung;
revoke update on bewerbung from cse_app;

comment on table bewerbung is
  'REC-03, REC-07. Eine eingegangene Bewerbung. cse_app darf sie LESEN und '
  'EINFUEGEN, nicht aendern: der Status wandert nur ueber eine '
  'einstellungsentscheidung (REC-08, Art. 22 DSGVO), das Loeschen nur ueber '
  'den Nachtlauf als cse_job (REC-07).';
