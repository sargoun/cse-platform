/**
 * Die Sitzung für die Anmeldung mit Telefon und Einmalcode (EMP-01, PR 20).
 *
 * **Warum das nicht `devSitzungAusstellen` erledigt.** Die Dev-Anmeldung
 * schreibt direkt in `benutzer_sitzung`. Das funktioniert nur, weil die
 * Entwicklungsadresse als Eigentümer verbindet — `cse_app` hat auf dieser
 * Tabelle **kein INSERT**, und die einzigen beiden Policies darauf lauten
 * `benutzer_id = app.aktueller_benutzer()`. Wer sich gerade anmeldet, IST aber
 * noch niemand: `app.aktueller_benutzer()` ist NULL, und die Bedingung ist
 * gegen ihn nicht erfüllbar. In einer Auslieferung, die richtigerweise als
 * `cse_app` läuft, wäre dieselbe Anmeldung also tot — und zwar erst dort,
 * nicht hier.
 *
 * Deshalb dieselbe Form wie in `0114`: eine Funktion unter dem Eigentümer,
 * schmal geschnitten, mit genau einer Entscheidung.
 */

/**
 * Wie lange eine Sitzung höchstens gilt.
 *
 * PLATZHALTER (K-17). Zwölf Stunden sind der Wert, den `devSitzungAusstellen`
 * seit PR 19 benutzt; er steht hier als Einstellung und nicht mehr als Zahl im
 * Code, damit die Antwort auf O-79 an EINER Stelle landet.
 *
 * TODO(client, O-79): Sitzungsdauer je Portal — Leerlauf UND absolut — und wie
 * ein verlorenes Arbeitstelefon widerrufen wird. Für Reinigungskräfte und
 * Wachleute ist die Frage eine andere als für die Buchhaltung: das Telefon
 * liegt auf dem Objekt, und eine zwölf Stunden gültige Sitzung überlebt das
 * Schichtende.
 */
insert into plattform_einstellung (schluessel, wert, beschreibung, ist_vorlaeufig) values
  ('auth.sitzung_stunden', '12'::jsonb,
   'Absolute Gültigkeit einer Sitzung in Stunden (VORLÄUFIG, O-79).', true);

/**
 * Eine Sitzung für einen Menschen ausstellen, der seinen Code eingelöst hat.
 *
 * **Der Aufrufer bringt nur den Hash mit.** Der Token selbst entsteht in der
 * Anwendung und geht von dort in den Keks; stünde er als Argument hier, stünde
 * er in jedem Log, das SQL mitschreibt — dieselbe Begründung wie beim Code in
 * `0114`.
 *
 * **`ansicht = 'person'`, und das ist die Decke, nicht nur ein Vorgabewert.**
 * `app.sitzung_aufloesen` leitet das Portal aus der Ansicht ab: `person`
 * ergibt `mitarbeiter`, unabhängig davon, welche Rolle das Konto sonst noch
 * hält. Wer als Leitung geführt wird und sich mit dem Telefon anmeldet, landet
 * also im Mitarbeiterportal und nicht in der Verwaltung — der leichte Weg
 * (EMP-01, ein Faktor) kann den schweren (AUT-02, zwei Faktoren) nicht
 * ersetzen. Das ist die sichere Richtung; ob sie die gewollte ist, ist offen.
 *
 * TODO(client, O-88): Doppelrolle — jemand ist Leitung UND angestellt. Soll
 * die Telefonanmeldung ihn im Mitarbeiterportal lassen (so ist es gebaut), ihm
 * eine Wahl anbieten, oder für ihn gar nicht gelten?
 *
 * **`aal1`, nicht `aal2`.** AUT-02 verlangt den zweiten Faktor für
 * `super_admin` und `admin`; `mitarbeiter` läuft auf `aal1`. Ein `aal2` hier
 * wäre gelogen: der Einmalcode IST der erste Faktor, nicht der zweite.
 *
 * Gibt NULL zurück, wenn zu dem Menschen kein benutzbares Konto gehört. Die
 * Anwendung unterscheidet das nach aussen nicht von einem falschen Code —
 * sonst verriete die Anmeldung, dass es die Person gibt.
 */
create function app.mitarbeiter_sitzung_ausstellen(
  p_person_id  uuid,
  p_token_hash text,
  p_ip         inet default null,
  p_user_agent text default null
) returns uuid
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare
  v_benutzer uuid;
  v_stunden  int := coalesce((app.plattform_einstellung('auth.sitzung_stunden'))::int, 12);
  v_id       uuid;
begin
  /**
   * Dieselben Ausschlüsse wie in `app.sitzung_aufloesen` — und das ist kein
   * doppelt gemoppelt, sondern der Unterschied zwischen „kann sich nicht
   * anmelden" und „meldet sich an und bekommt sofort nichts". Ein gesperrtes
   * Konto, das eine Sitzung bekäme, sähe eine leere Oberfläche ohne Grund.
   */
  select b.id into v_benutzer
    from public.benutzer b
   where b.person_id = p_person_id
     and b.status = 'aktiv'
     and b.deaktiviert_am is null
     and not b.ist_dienstkonto
     and (b.gesperrt_bis is null or b.gesperrt_bis <= now());

  if v_benutzer is null then
    return null;
  end if;

  insert into public.benutzer_sitzung
    (benutzer_id, token_hash, aktiver_mandant_id, ansicht, aal, ablauf_am, ip, user_agent)
  values
    (v_benutzer, p_token_hash, null, 'person', 'aal1',
     now() + make_interval(hours => v_stunden), p_ip, p_user_agent)
  returning id into v_id;

  return v_id;
end
$$;

comment on function app.mitarbeiter_sitzung_ausstellen(uuid, text, inet, text) is
  'Stellt eine Sitzung im Mitarbeiterportal aus (ansicht=person, aal1). NULL ohne benutzbares Konto.';

/**
 * **`cse_anon` darf sie ausführen, weil die anmeldende Person genau das ist.**
 *
 * `cse_app` ebenfalls: dieselbe Verbindung bedient auch schon Angemeldete, und
 * ein Recht, das je nach Rolle der Verbindung fehlt, hiesse, dass die
 * Anmeldung von der Reihenfolge der Aufrufe abhinge.
 */
grant execute on function app.mitarbeiter_sitzung_ausstellen(uuid, text, inet, text)
  to cse_anon, cse_app;

/**
 * **Die Abmeldung braucht denselben Weg.**
 *
 * `beendeSitzung` setzt `beendet_am` direkt — und stösst gegen dieselbe Wand:
 * die UPDATE-Policy verlangt `benutzer_id = app.aktueller_benutzer()`, und
 * genau dieser Wert ist gebunden, solange die Sitzung noch steht. Beim
 * Abmelden ist er es aber nicht immer: der Weg über `/api/abmelden` weist sich
 * durch den BESITZ des Tokens aus, nicht durch eine gebundene Sitzung.
 *
 * Die Funktion ist deshalb so schmal wie ihre Berechtigung: sie findet die
 * Zeile nur über den Hash des Tokens, und nur solange sie offen ist. Mehr als
 * die eigene, noch laufende Sitzung ist damit nicht erreichbar — wer den
 * Token hat, IST der Inhaber.
 */
create function app.sitzung_beenden(p_token_hash text) returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare v_treffer int;
begin
  update public.benutzer_sitzung
     set beendet_am = now(), ende_grund = 'abmeldung'
   where token_hash = p_token_hash
     and beendet_am is null;
  get diagnostics v_treffer = row_count;
  return v_treffer > 0;
end
$$;

comment on function app.sitzung_beenden(text) is
  'Beendet die Sitzung zu diesem Token-Hash. Der Besitz des Tokens ist der Ausweis.';

grant execute on function app.sitzung_beenden(text) to cse_anon, cse_app;
