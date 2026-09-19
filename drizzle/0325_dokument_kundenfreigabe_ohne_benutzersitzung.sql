-- 0325 — `kern.dokument_kundenfreigabe_pruefen()` faellt nicht mehr ueber
--        `app.hat_recht`, wenn kein Mensch in der Sitzung steht (DOC-04,
--        Invariante 7, korrigiert 0297).

/**
 * **Der Befund: der naechtliche Archivlauf legte kein einziges PDF mehr ab.**
 *
 * `belegarchiv_ausgangsrechnung` (0139, `jobs/belegarchiv.ts`) schreibt
 * `dokument`, `dokument_version` und `beleg` unter `set local role cse_job`.
 * Seit 0297 haengt an `dokument` der Ausloeser `dokument_05_kundenfreigabe`,
 * und der fragte in EINEM Ausdruck:
 *
 *     if new.sichtbar_fuer_kunde
 *        and not app.hat_recht('dokument.kunde_freigeben', new.mandant_id) then
 *
 * `app.hat_recht(text, uuid)` ist seit 0093 `revoke … from public` und nur an
 * `cse_app` und `cse_definer` vergeben. `cse_job` haelt kein `execute` — und
 * PostgreSQL prueft das Recht beim VORBEREITEN des Ausdrucks, nicht erst,
 * wenn der linke Operand wahr ist. Die Abkuerzung ueber `and` gibt es also
 * nicht: JEDES Einfuegen unter `cse_job` endete mit
 * `permission denied for function hat_recht`, auch das eines Dokuments, das
 * gar nicht freigegeben werden sollte.
 *
 * Der Lauf zaehlte das als `fehler` und meldete sich weiter als gelaufen. Die
 * Rechnungen blieben ohne Beleg — und damit stand ihr DATEV-Export ueber
 * `app.export_sperre_pruefen` still, ohne dass irgendwo „kein Recht" stand.
 *
 * ===========================================================================
 * Die Antwort ist NICHT `grant execute … to cse_job`
 * ===========================================================================
 *
 * Ein Nachtlauf laeuft ausserhalb jeder Benutzersitzung: `alsJobSitzung`
 * setzt `app.benutzer_id` ausdruecklich leer, weil ein Lauf kein Mensch ist.
 * `app.hat_recht` beantwortet die Frage „haelt DER ANGEMELDETE dieses Recht"
 * — eine Frage, die ohne Angemeldeten keinen Sinn ergibt. Sie dem Job
 * zugaenglich zu machen hiesse, ihn nach einem Benutzer fragen zu lassen, den
 * es nicht gibt, und die Antwort `false` als Rechtsauskunft zu lesen.
 *
 * Gefragt wird deshalb erst, wenn die Freigabespalte ueberhaupt beruehrt ist
 * — in einer EIGENEN Anweisung, damit PL/pgSQL den Ausdruck nur dann plant.
 * Und davor steht der ehrliche Fall: ohne Menschen in der Sitzung gibt es
 * keine Kundenfreigabe. Das ist Invariante 7 an dieser Tabelle und kein
 * Nebeneffekt — nichts verlaesst das System ohne menschliche Freigabe, also
 * erst recht nicht auf Veranlassung eines Zeitplans.
 *
 * **Was sich fuer `cse_app` NICHT aendert.** Dieselben zwei Faelle, dieselben
 * zwei Meldungen, dasselbe Recht. Der Ausloeser ist nur so umgestellt, dass
 * die Rechtsfrage hinter der Tatsachenfrage steht statt neben ihr.
 */

create or replace function kern.dokument_kundenfreigabe_pruefen()
returns trigger language plpgsql
set search_path = pg_catalog, public, app as $$
declare
  /**
   * Beim INSERT nur, wenn die Zeile schon freigegeben zur Welt kommt — der
   * gewoehnliche Upload (`services/dokument/upload.ts`) setzt die Spalte
   * nicht und laeuft vorbei, sonst braeuchte jeder Reinigungsnachweis ein
   * Freigaberecht.
   *
   * Beim UPDATE beide Richtungen: zurueckzunehmen ist nicht harmloser als
   * freizugeben — wer eine Freigabe still entfernt, nimmt dem Kunden einen
   * Beleg, den er gesehen hat, und `dokument_zugriff` weiss, ob er ihn schon
   * geholt hat.
   */
  v_beruehrt boolean;
begin
  /**
   * Zwei ANWEISUNGEN und kein `case`-Ausdruck: bei einem INSERT ist `old`
   * nicht zugewiesen, und ein Ausdruck, der das Feld nennt, faellt schon beim
   * Herrichten seiner Parameter — unabhaengig davon, welcher Zweig gilt.
   */
  if tg_op = 'INSERT' then
    v_beruehrt := new.sichtbar_fuer_kunde;
  else
    v_beruehrt := new.sichtbar_fuer_kunde is distinct from old.sichtbar_fuer_kunde;
  end if;

  if not v_beruehrt then return new; end if;

  /**
   * **Kein Mensch in der Sitzung — dann keine Freigabe** (Invariante 7).
   *
   * Diese Anweisung steht VOR jeder Beruehrung von `app.hat_recht`: ein
   * Nachtlauf soll die Tabelle beschreiben duerfen und die Freigabe nicht,
   * und er soll das an einem Satz ablesen koennen statt an
   * `permission denied for function hat_recht`.
   */
  if app.aktueller_benutzer() is null then
    raise exception 'dokument.kunde_freigeben fehlt — keine Benutzersitzung'
      using errcode = 'insufficient_privilege',
            detail  = 'Eine Kundenfreigabe ist eine Willenserklaerung gegenueber dem '
                      || 'Kunden; ein Zeitplan gibt sie nicht ab (Invariante 7, DOC-04).',
            hint    = 'Ein Lauf legt Dokumente ab. Freigegeben wird ueber '
                      || '/api/dokumente/[id]/kundenfreigabe, von einem Menschen.';
  end if;

  if not app.hat_recht('dokument.kunde_freigeben', new.mandant_id) then
    if tg_op = 'INSERT' then
      raise exception 'dokument.kunde_freigeben fehlt'
        using errcode = 'insufficient_privilege',
              detail  = 'Ein Dokument entsteht nicht bereits fuer den Kunden '
                        || 'freigegeben (DOC-04).',
              hint    = 'Erst ablegen, dann freigeben — die Freigabe ist ein eigener '
                        || 'Vorgang mit eigenem Recht.';
    end if;
    raise exception 'dokument.kunde_freigeben fehlt'
      using errcode = 'insufficient_privilege',
            detail  = 'Was ein Kunde zu sehen bekommt, entscheidet nicht, wer '
                      || 'Dokumente ablegen darf (dokument.schreiben).',
            hint    = 'Die Freigabe laeuft ueber /api/dokumente/[id]/kundenfreigabe.';
  end if;

  return new;
end $$;

comment on function kern.dokument_kundenfreigabe_pruefen() is
  'DOC-04, Invariante 7. Bindet jede Aenderung von sichtbar_fuer_kunde an '
  'dokument.kunde_freigeben — im Ausloeser, weil t_mandant mit dokument.schreiben ein '
  'WEITERES Recht prueft, das auch die Rolle mitarbeiter haelt. Die Rechtsfrage steht '
  'hinter der Tatsachenfrage (0325): ohne beruehrte Freigabespalte wird app.hat_recht '
  'nicht einmal geplant, damit cse_job Dokumente ablegen kann, ohne sie freigeben zu '
  'koennen.';
