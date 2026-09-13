-- ===========================================================================
-- 0131 — Der Beleg reist mit der Buchungszeile, und die Kreditorenseite
--        erreicht das Hauptbuch (ACC-01, ACC-03, ACC-05, GoBD)
-- ===========================================================================
--
-- Drei Luecken, eine Wurzel: das Hauptbuch war bisher nur halb angeschlossen.
--
--  (1) `app.buchungssatz_schreiben` hat KEINEN Belegparameter. Jede Buchung
--      steht damit ohne Dokument. `bs_kein_beleg_ohne_hinweis` beisst nicht,
--      weil die Zeile beim Schreiben noch nicht festgeschrieben ist — der
--      Riegel ist da, und er haelt eine Tuer zu, durch die niemand geht.
--      Beim Export faellt es auf: DATEV fragt nach der Belegverknuepfung, und
--      eine Betriebspruefung fragt danach als erstes.
--
--  (2) `eingangsrechnung.buche()` setzt den Status und oeffnet ueber 0123
--      einen Kreditorposten — schreibt aber KEINEN Buchungssatz. Die
--      Kreditorenseite steht damit vollstaendig ausserhalb des Hauptbuchs:
--      ein Export haette nur Ausgangsrechnungen, und die Summe stimmte mit
--      keiner Bilanz ueberein.
--
--  (3) Und sie KANN es nicht: `app.buchungssatz_schreiben` fuellt von den
--      fuenf Quellspalten nur `rechnung_id`. Eine Zeile mit
--      `herkunft = 'eingangsrechnung'` laeuft damit unweigerlich in
--      `bs_genau_eine_herkunft`. Der Weg fehlte, nicht die Absicht.

-- ---------------------------------------------------------------------------
-- (1) Der Beleg und die Quelle
-- ---------------------------------------------------------------------------

/**
 * Dieselbe Funktion wie in 0127, mit zwei Aenderungen.
 *
 * **(a) `p_beleg` kommt hinzu — am ENDE der Liste und mit einer Vorgabe.**
 * Beide Entscheidungen sind dieselbe: die vorhandenen Aufrufer sollen
 * unveraendert weiterlaufen, waehrend die neuen den Beleg mitgeben. Ein
 * Parameter in der Mitte haette jeden Aufruf still auf die falsche Spalte
 * geschoben — Postgres bindet nach POSITION, und alle Argumente hier sind
 * `text` oder `uuid`.
 *
 * Der Fremdschluessel `bs_beleg_fk` (0127) ist zusammengesetzt und prueft die
 * Gesellschaft mit; hier steht deshalb keine zweite Pruefung.
 *
 * **(b) Aus `p_rechnung` wird `p_quelle`, und die Herkunft entscheidet die
 * Spalte.** Das ist der eigentliche Grund fuer diese Migration.
 *
 * `buchungssatz` traegt fuenf Quellspalten — `rechnung_id`,
 * `eingangsrechnung_id`, `zahlung_id`, `ausgabe_id`, `kassenbewegung_id` —
 * und zwei Riegel darueber: `bs_genau_eine_herkunft` verlangt genau eine
 * gefuellte (keine bei `manuell`), `bs_herkunft_passt` verlangt, dass es die
 * zur Herkunft passende ist. Die alte Fassung konnte nur EINE davon fuellen.
 * Jeder Aufrufer mit einer anderen Herkunft lief damit unweigerlich in den
 * Riegel — nicht als Denkfehler, sondern als fehlender Weg.
 *
 * Die naheliegende Antwort waere ein zweiter Parameter je Spalte gewesen.
 * Sie ist die schlechtere: vier weitere `uuid`-Argumente mit Vorgabe `null`,
 * von denen ein Aufrufer das falsche fuellt, und der Riegel meldet erst zur
 * Laufzeit, was die Signatur nie verboten hat. Eine Quelle plus die Herkunft
 * sagt dasselbe, laesst die widerspruechliche Angabe gar nicht erst zu und
 * macht beide Riegel von hier aus unverletzbar.
 *
 * Die zwei vorhandenen Aufrufer (Rechnung, Storno) uebergeben an dieser
 * Stelle bereits die Rechnungs-ID und `'rechnung'` als Herkunft; fuer sie
 * aendert sich nichts.
 */
create or replace function app.buchungssatz_schreiben(
  p_mandant     uuid,
  p_buchung     uuid,
  p_datum       date,
  p_periode     uuid,
  p_umsatz_cent bigint,
  p_soll_haben  soll_haben,
  p_konto       text,
  p_gegenkonto  text,
  p_bu          text,
  p_gruppe      uuid,
  p_text        text,
  p_belegfeld1  text,
  p_herkunft    buchung_herkunft,
  p_quelle      uuid,
  p_hinweis     text,
  p_dienst      text,
  p_beleg       uuid default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_id uuid;
begin
  perform app.buchen_erlaubt(p_mandant);

  /*
   * Die Riegel der Tabelle greifen ohnehin. Sie melden aber „violates check
   * constraint bs_genau_eine_herkunft" — richtig und unbrauchbar. Wer den
   * Aufruf geschrieben hat, sucht dann in der Tabelle statt in seinem Aufruf.
   */
  if p_herkunft = 'manuell' and p_quelle is not null then
    raise exception
      'Eine manuelle Buchung hat keine Quelle; % wurde uebergeben.', p_quelle
      using errcode = '22023';
  end if;
  if p_herkunft <> 'manuell' and p_quelle is null then
    raise exception
      'Herkunft % ohne Quelle: die Buchungszeile haette keinen Beleg, auf den '
      'sie sich beruft.', p_herkunft
      using errcode = '22023';
  end if;

  insert into public.buchungssatz
    (mandant_id, buchung_id, buchungsdatum, belegdatum, periode_id, umsatz_cent,
     soll_haben, konto, gegenkonto, bu_schluessel, steuersatz_gruppe_id,
     buchungstext, belegfeld1, herkunft,
     rechnung_id, eingangsrechnung_id, zahlung_id, ausgabe_id, kassenbewegung_id,
     pruefhinweis, beleg_id, erstellt_von_art, erstellt_von_dienst)
  values (p_mandant, p_buchung, p_datum, p_datum, p_periode, p_umsatz_cent,
          p_soll_haben, p_konto, p_gegenkonto, p_bu, p_gruppe,
          p_text, p_belegfeld1, p_herkunft,
          case when p_herkunft = 'rechnung'         then p_quelle end,
          case when p_herkunft = 'eingangsrechnung' then p_quelle end,
          case when p_herkunft = 'zahlung'          then p_quelle end,
          -- `bs_herkunft_hat_eltern` schliesst diese beiden Herkuenfte heute
          -- aus; sie stehen hier, damit das Aufheben jenes Riegels eine
          -- Zeile ist und nicht eine Suche nach der Stelle, die fehlt.
          case when p_herkunft = 'ausgabe'          then p_quelle end,
          case when p_herkunft = 'kassenbewegung'   then p_quelle end,
          p_hinweis, p_beleg, 'system', p_dienst)
  returning id into v_id;
  return v_id;
end $$;

alter function app.buchungssatz_schreiben(uuid, uuid, date, uuid, bigint, soll_haben, text,
                                          text, text, uuid, text, text, buchung_herkunft,
                                          uuid, text, text, uuid) owner to cse_definer;
revoke all on function app.buchungssatz_schreiben(uuid, uuid, date, uuid, bigint, soll_haben,
                                                  text, text, text, uuid, text, text,
                                                  buchung_herkunft, uuid, text, text, uuid)
  from public;
grant execute on function app.buchungssatz_schreiben(uuid, uuid, date, uuid, bigint, soll_haben,
                                                     text, text, text, uuid, text, text,
                                                     buchung_herkunft, uuid, text, text, uuid)
  to cse_app;

/**
 * **Die alte, sechzehnargumentige Fassung geht.**
 *
 * Zwei Ueberladungen mit derselben Bedeutung und einem Argument Unterschied
 * sind die Sorte Doppelung, bei der ein Aufrufer die falsche erwischt und es
 * niemandem auffaellt — die eine schreibt den Beleg, die andere schweigt.
 * `create or replace` hat sie NICHT ersetzt (eine andere Signatur ist eine
 * andere Funktion), also muss sie ausdruecklich weg.
 */
drop function app.buchungssatz_schreiben(uuid, uuid, date, uuid, bigint, soll_haben, text,
                                         text, text, uuid, text, text, buchung_herkunft,
                                         uuid, text, text);

/** Der Definer liest den Beleg, um ihn zu setzen (D-388, K-05). */
grant select (id, mandant_id, typ, belegdatum) on beleg to cse_definer;

-- ---------------------------------------------------------------------------
-- (2) Die Eingangsrechnung braucht ihre Periode und ihren Beleg
-- ---------------------------------------------------------------------------

/**
 * Ein Kreditorbuchungssatz laeuft ueber DENSELBEN Schreiber wie ein
 * Debitorbuchungssatz — es gibt keinen zweiten.
 *
 * Was ihn unterscheidet, ist die Kontierung (Aufwand statt Erloes, Vorsteuer
 * statt Umsatzsteuer) und die Richtung; beides entscheidet der Dienst, nicht
 * die Datenbank. Hier fehlt deshalb nur die eine Erlaubnis, die dem Dienst
 * bisher fehlte: `eingang.freigeben` darf buchen.
 *
 * **Warum nicht `buchhaltung.schreiben`.** Wer eine Eingangsrechnung bucht,
 * ist die Person, die sie freigegeben hat — dieselbe Ueberlegung wie D-427
 * fuer die Ausgangsseite: die Buchung ist die FOLGE ihrer Handlung, nicht
 * eine eigene, und ein zweites Recht zu verlangen hiesse, jeder
 * Rechnungspruefung Zugriff auf die gesamte Buchhaltung zu geben.
 */
create or replace function app.buchen_erlaubt(p_mandant uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if session_user = 'cse_job' then return; end if;
  if app.ist_readonly() then
    raise exception 'Die Gruppenansicht bucht nicht (Invariante 10).' using errcode = '42501';
  end if;
  if not (app.hat_recht('finanzen.schreiben', p_mandant)
          or app.hat_recht('buchhaltung.schreiben', p_mandant)
          or app.hat_recht('eingang.freigeben', p_mandant)) then
    raise exception
      'finanzen.schreiben, buchhaltung.schreiben oder eingang.freigeben fehlt'
      using errcode = '42501';
  end if;
end $$;

alter function app.buchen_erlaubt(uuid) owner to cse_definer;
