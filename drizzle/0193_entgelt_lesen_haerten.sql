-- ===========================================================================
-- 0193 — app.entgelt_lesen: das Entgelt haengt am RECHT, nicht an der
--        Sichtbarkeit der Gesellschaft
--        (K-05, D-09 §6, 04-SEITENKARTE §5.12, 05-API-KARTE §C.8, 01-KERN §11)
--
-- **Die Luecke, wortwoertlich.** `app.anstellung_entgelt_lesen` (0004) prueft
-- genau eine Bedingung:
--
--     if not (m = any (app.sichtbare_mandanten())) then return null; end if;
--
-- Keine Rechtepruefung. Jede Sitzung, die eine Gesellschaft ueberhaupt SIEHT,
-- las damit jeden Stundensatz darin — und der Spaltenentzug auf
-- `anstellung.stundensatz_intern` (K-05) war wirkungslos, weil es einen
-- zweiten Weg gab. Genau das schliessen K-05 und D-09 §6 aus, und
-- 04-SEITENKARTE wie 05-API-KARTE verlangen beide „`personal.entgelt_lesen`
-- UND den aktiven Mandanten".
--
-- Die Luecke ist BEGEHBAR und nicht theoretisch: `personal.entgelt_lesen` ist
-- fuer `admin` und `leitung` nur *bindbar*, nicht gebunden
-- (`katalog.generiert.ts`) — eine `leitung` ohne dieses Recht sah jeden
-- Stundensatz ihrer Gesellschaft, und ihre Rolle sagte ausdruecklich, dass sie
-- ihn nicht sehen darf.
--
-- **Zwei Namen, eine Umsetzung.** Die Dokumente nennen die Funktion
-- `app.entgelt_lesen(anstellung, stichtag)` (01-KERN §11, §6.15), die
-- Datenbank hatte `app.anstellung_entgelt_lesen(anstellung)`. Beide bleiben
-- aufrufbar — die alte delegiert an die neue. Zwei Namen sind kein zweiter
-- Lesepfad; zwei IMPLEMENTIERUNGEN waeren einer, und genau den gibt es hier
-- nicht.
--
-- **Der Satz kommt aus der KONDITION** (§6.14: „jede datierte Berechnung liest
-- die Kondition, nie den Spiegel"). Der Spiegel auf `anstellung` ist nur der
-- Rueckfall fuer Beschaeftigungen, die noch keine Kondition haben — der
-- Bestand vor 0192.
-- ===========================================================================

/**
 * Der Stundensatz am Stichtag — mit Recht, mit Mandant, mit Auditzeile.
 *
 * **Werfen und nicht schweigen, wenn das Recht fehlt.** Ein `null` hiesse
 * „kein Satz hinterlegt", und das ist eine andere Auskunft: die eine fuehrt zu
 * „dann tragen wir einen ein", die andere zu „dann hole ich jemanden, der
 * darf". Die Oberflaeche muss den Unterschied sagen koennen — dieselbe
 * Entscheidung wie in `app.abwesenheit_grund_lesen` (0073).
 *
 * **`null` dagegen, wenn die Gesellschaft nicht die aktive ist.** Dort ist die
 * Existenz selbst die Auskunft, die nicht hinaus darf (AUT-06): eine
 * Fehlermeldung „nicht berechtigt" bestaetigte, dass es die Beschaeftigung
 * gibt.
 */
create function app.entgelt_lesen(p_anstellung uuid, p_stichtag date default null)
returns bigint
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid;
  v_tag     date := coalesce(p_stichtag, app.berlin_heute());
  v_satz    bigint;
  v_quelle  text := 'kondition';
begin
  select a.mandant_id into v_mandant
    from public.anstellung a where a.id = p_anstellung;
  if v_mandant is null then return null; end if;

  /*
   * Der AKTIVE Mandant und nicht `sichtbare_mandanten()`. In der
   * Gruppenansicht gibt es keinen aktiven (Invariante 10) — dort ist diese
   * Funktion damit stumm, und das ist richtig: Entgelte je Kopf sind keine
   * Gruppenzahl, die Gruppenansicht zeigt Summen ueber `gruppe.*`-Rechte.
   */
  if v_mandant is distinct from app.aktiver_mandant() then return null; end if;

  if not app.hat_recht('personal.entgelt_lesen', v_mandant) then
    raise exception 'nicht berechtigt' using errcode = '42501';
  end if;

  select k.stundensatz_intern_cent into v_satz
    from public.anstellung_kondition k
   where k.anstellung_id = p_anstellung
     and k.gilt_ab <= v_tag
     and (k.gilt_bis is null or k.gilt_bis >= v_tag)
   order by k.gilt_ab desc
   limit 1;

  /*
   * **Der Rueckfall gilt nur fuer Beschaeftigungen OHNE jede Kondition** — den
   * Bestand vor 0192. Faellt er auch fuer einen Stichtag VOR der ersten
   * Kondition zurueck, liefert er den heutigen Spiegelwert fuer einen
   * vergangenen Tag: genau die stillschweigende Neubewertung vergangener
   * Kalkulationen, gegen die §6.14 die datierte Tabelle einfuehrt. Dann ist
   * `null` die Wahrheit — „fuer diesen Tag ist kein Satz hinterlegt".
   */
  if v_satz is null then
    if exists (select 1 from public.anstellung_kondition k
                where k.anstellung_id = p_anstellung) then
      v_quelle := 'keine_kondition_am_stichtag';
    else
      select a.stundensatz_intern into v_satz
        from public.anstellung a where a.id = p_anstellung;
      v_quelle := 'spiegel';
    end if;
  end if;

  perform app.protokolliere(
    'entgelt.gelesen', 'anstellung', p_anstellung::text, null,
    jsonb_build_object('stichtag', v_tag, 'quelle', v_quelle), v_mandant);
  return v_satz;
end $$;

alter function app.entgelt_lesen(uuid, date) owner to cse_definer;
revoke execute on function app.entgelt_lesen(uuid, date) from public;
grant execute on function app.entgelt_lesen(uuid, date) to cse_app;

comment on function app.entgelt_lesen(uuid, date) is
  'K-05, D-09 §6, §6.15: der einzige Weg zum internen Stundensatz. Prueft '
  'personal.entgelt_lesen UND den aktiven Mandanten, liest die am Stichtag '
  'gueltige Kondition und protokolliert jeden Zugriff.';

/**
 * Der alte Name bleibt — als WEITERLEITUNG.
 *
 * `create or replace` und kein `drop`: die Funktion steht in
 * `tests/isolation/definer-eigentum.test.ts` als Altlast, in
 * `services/mitarbeiter/felder.ts` und in `services/datenschutz/auskunft.ts`
 * als der dokumentierte Weg. Sie zu entfernen hiesse, drei Stellen fuer eine
 * Umbenennung zu aendern, die den Defekt nicht behebt.
 *
 * Der Eigentuemer bleibt, was er war (`postgres`, Altlast K-01) — dieselbe
 * Funktion, nur mit der Pruefung dahinter. Das Umhaengen des Eigentums ist die
 * eigene Pruefrunde D-300 und nicht diese Migration; sie wuerde die Altlastliste
 * kuerzen, ohne dass jemand die 32 Tabellenrechte nachgesehen hat.
 */
create or replace function app.anstellung_entgelt_lesen(p_anstellung uuid)
returns bigint
language sql stable security definer
set search_path = pg_catalog, public, app as $$
  select app.entgelt_lesen(p_anstellung, null);
$$;

comment on function app.anstellung_entgelt_lesen(uuid) is
  'Weiterleitung auf app.entgelt_lesen(anstellung, heute) — 0193. Eine '
  'Umsetzung, zwei Namen: 01-KERN §11 nennt den zweiten, die Datenbank hatte '
  'den ersten.';
