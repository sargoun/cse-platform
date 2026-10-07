-- 0503 — den Sicherheitskontakt der Plattform pflegen (V-392, O-35, D-809).
--
-- /.well-known/security.txt antwortet 404, bis plattform_einstellung
-- 'sicherheit.kontakt' einen mailto:-, https:- oder tel:-Wert traegt
-- (inhalt/sicherheit-txt.ts). Geschrieben wurde der Wert nur per SQL:
-- plattform_einstellung hat fuer cse_app keine Schreibpolicy (0007), mit
-- Absicht — eine Plattformangabe setzt keine Gesellschaft.
--
-- Ein Definer fuer genau zwei Schluessel — 'sicherheit.kontakt' und
-- 'sicherheit.richtlinie' — und keinen anderen: die Policy unten laesst den
-- Definer an keine andere Zeile. Das Tor: keine lesende Sitzung, zweiter
-- Faktor, system.einstellung_verwalten und eine Super-Administration (die
-- Angabe gilt fuer die ganze Plattform). Geprueft wird nach RFC 9116 §2.5.3
-- (Contact ist eine URI) und §2.5.7 (Policy ist eine https-URI), dieselben
-- Regeln wie istKontaktWert. Leer heisst „kein Postfach": der Wert wird
-- JSON-null, und die Datei antwortet wieder 404 (O-35, D-803: Postfach, wer
-- es liest und die Antwortfrist traegt der Betreiber ein).
--
-- Protokolliert mit vorher und nachher (app.protokolliere): eine Kontakt-
-- adresse fuer Sicherheitsmeldungen zu aendern, lenkt Meldungen um.
--
-- Nur Kommentare mit Doppelstrich.

grant select, insert, update on plattform_einstellung to cse_definer;

create policy d_sicherheitskontakt on plattform_einstellung for all to cse_definer
  using      (schluessel in ('sicherheit.kontakt', 'sicherheit.richtlinie'))
  with check (schluessel in ('sicherheit.kontakt', 'sicherheit.richtlinie'));

-- Gibt zurueck, ob sich etwas geaendert hat.
create function app.sicherheitskontakt_setzen(p_kontakt text, p_richtlinie text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_kontakt    text := nullif(btrim(coalesce(p_kontakt, '')), '');
  v_richtlinie text := nullif(btrim(coalesce(p_richtlinie, '')), '');
  v_vorher     jsonb;
  v_zahl       integer := 0;
  v_n          integer;
begin
  if app.ist_readonly() then
    raise exception 'Diese Sitzung ist lesend.' using errcode = '42501';
  end if;
  if app.aal() <> 'aal2' then
    raise exception 'Der Sicherheitskontakt verlangt den zweiten Faktor.'
      using errcode = '42501', hint = 'K-15.';
  end if;
  -- Erst das Recht, dann die Super-Administration (AUT-06).
  if not app.hat_recht('system.einstellung_verwalten', app.aktiver_mandant()) then
    raise exception 'Der Sicherheitskontakt verlangt system.einstellung_verwalten.'
      using errcode = '42501';
  end if;
  if not app.ist_super_admin() then
    raise exception 'Den Sicherheitskontakt der Plattform traegt die Super-Administration ein.'
      using errcode = '42501', detail = 'nur_super_admin';
  end if;

  if v_kontakt is not null
     and v_kontakt !~ '^(mailto:[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+|https://[^[:space:]]+|tel:\+?[0-9 ()-]+)$' then
    raise exception 'Der Kontakt ist eine mailto:-, https:- oder tel:-Adresse (RFC 9116).'
      using errcode = '22023', detail = 'kontakt_ungueltig';
  end if;
  if v_richtlinie is not null and v_richtlinie !~ '^https://[^[:space:]]+$' then
    raise exception 'Die Richtlinie ist eine https:-Adresse (RFC 9116).'
      using errcode = '22023', detail = 'richtlinie_ungueltig';
  end if;
  if v_kontakt is null and v_richtlinie is not null then
    raise exception 'Eine Richtlinie ohne Kontakt steht in keiner Datei.'
      using errcode = '22023', detail = 'richtlinie_ohne_kontakt';
  end if;

  -- Erst sperren, dann den Vorher-Stand lesen: zwei gleichzeitige Saetze
  -- laesen sonst denselben Stand, und das Protokoll des zweiten naennte nicht
  -- den Kontakt, den er wirklich ersetzt hat. Eine Zeilensperre truege den
  -- ersten Eintrag nicht — dann gibt es noch keine Zeile. Die Sperre gilt bis
  -- zum Ende der Transaktion, ueber beide Upserts und das Protokoll.
  perform pg_advisory_xact_lock(hashtext('plattform.sicherheitskontakt'));

  select coalesce(jsonb_object_agg(e.schluessel, e.wert), '{}'::jsonb) into v_vorher
    from public.plattform_einstellung e
   where e.schluessel in ('sicherheit.kontakt', 'sicherheit.richtlinie');

  insert into public.plattform_einstellung
    (schluessel, wert, beschreibung, ist_vorlaeufig, grundlage, erstellt_von)
  values ('sicherheit.kontakt', coalesce(to_jsonb(v_kontakt), 'null'::jsonb),
          'RFC 9116 Contact: das Postfach fuer Sicherheitsmeldungen (security.txt).',
          false, 'Eingetragen von der Super-Administration (V-392)', app.aktueller_benutzer())
  on conflict (schluessel) do update
     set wert = excluded.wert, ist_vorlaeufig = false, grundlage = excluded.grundlage,
         geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
   where plattform_einstellung.wert is distinct from excluded.wert;
  get diagnostics v_n = row_count;
  v_zahl := v_zahl + v_n;

  insert into public.plattform_einstellung
    (schluessel, wert, beschreibung, ist_vorlaeufig, grundlage, erstellt_von)
  values ('sicherheit.richtlinie', coalesce(to_jsonb(v_richtlinie), 'null'::jsonb),
          'RFC 9116 Policy: die Seite mit den Regeln fuer Sicherheitsmeldungen.',
          false, 'Eingetragen von der Super-Administration (V-392)', app.aktueller_benutzer())
  on conflict (schluessel) do update
     set wert = excluded.wert, ist_vorlaeufig = false, grundlage = excluded.grundlage,
         geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
   where plattform_einstellung.wert is distinct from excluded.wert;
  get diagnostics v_n = row_count;
  v_zahl := v_zahl + v_n;

  if v_zahl > 0 then
    perform app.protokolliere(
      'plattform.sicherheitskontakt_gesetzt', 'plattform_einstellung', 'sicherheit.kontakt',
      v_vorher,
      jsonb_build_object('sicherheit.kontakt', coalesce(to_jsonb(v_kontakt), 'null'::jsonb),
                         'sicherheit.richtlinie', coalesce(to_jsonb(v_richtlinie), 'null'::jsonb)));
  end if;
  return v_zahl > 0;
end $$;

comment on function app.sicherheitskontakt_setzen(text, text) is
  'V-392, D-809: setzt sicherheit.kontakt (RFC 9116 Contact: mailto:, https: oder tel:) '
  'und sicherheit.richtlinie (Policy: https:) der Plattform; leer = kein Postfach, '
  '/.well-known/security.txt antwortet 404. Verlangt eine Super-Administration mit '
  'system.einstellung_verwalten und aal2; protokolliert. Gibt zurueck, ob sich etwas '
  'geaendert hat.';

alter function app.sicherheitskontakt_setzen(text, text) owner to cse_definer;
revoke execute on function app.sicherheitskontakt_setzen(text, text) from public;
grant execute on function app.sicherheitskontakt_setzen(text, text) to cse_app;
