-- ===========================================================================
-- 0470 — Die zweite Fassung eines Dokuments (DOC-05, V-219, D-713)
-- ===========================================================================
-- **Der Befund.** `dokument_version` ist seit 0009 als Kette angelegt —
-- eindeutig je (mandant_id, dokument_id, version), anfuegend, mit dem SHA-256
-- der gespeicherten Bytes. Jeder Schreiber setzte aber fest `version = 1`,
-- und es gab weder Dienst noch Route noch Formular fuer eine zweite Fassung.
-- Ein ueberarbeiteter Vertrag liess sich nur als neues, unverbundenes Dokument
-- ablegen.
--
-- **Was diese Migration bringt: die zweite Linie der Kette.** Den Weg selbst
-- baut der Dienst (`legeFassungAn`, services/dokument/ablage.ts); hier steht,
-- was fuer JEDEN Schreiber gilt, der eine Fassung jenseits der ersten anlegt:
--
--   1. Die Kette ist lueckenlos: die neue Fassung ist genau die hoechste
--      vorhandene plus eins. Ohne erste Fassung gibt es keine zweite — ein
--      Dokument, das vor der Kette abgelegt wurde, bekommt keine Fassung 2
--      neben eine Datei, deren Pruefsumme niemand kennt.
--   2. Ein geloeschtes Dokument bekommt keine Fassung.
--   3. Rechnungen, Belege und Buchhaltungsunterlagen bekommen KEINE neue
--      Fassung (GoBD, Paragraf 147 AO, Invariante 4): ein Beleg wird durch
--      Gegenbuchung bzw. Storno berichtigt, nie durch den Austausch seiner
--      Datei. Die Buchung zeigt ueber beleg.dokument_version_id ohnehin auf
--      ihre Fassung; eine neue daneben waere eine zweite Wahrheit ueber
--      denselben Beleg.
--
-- **Kein SECURITY DEFINER.** Der Ausloeser laeuft als der Aufrufer: wer eine
-- Fassung anlegt, muss das Dokument sehen koennen (dokument.lesen,
-- t_mandant) — sieht er es nicht, wird abgewiesen, statt still an einer
-- Zeile vorbei zu pruefen, die fuer ihn nicht existiert. Die erste Fassung
-- (version = 1) laeuft unveraendert durch; alle bisherigen Schreiber bleiben,
-- wie sie sind.
--
-- Kommentare nur mit --, keine Backticks (dieselbe Regel wie in 0392).
-- ===========================================================================

create function kern.dokument_fassung_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_kategorie text;
  v_geloescht timestamptz;
  v_hoechste  integer;
begin
  if new.version = 1 then
    return new;
  end if;

  select d.kategorie::text, d.geloescht_am
    into v_kategorie, v_geloescht
    from public.dokument d
   where d.id = new.dokument_id and d.mandant_id = new.mandant_id;
  if not found then
    raise exception
      'Fassung % zu Dokument %: das Dokument ist fuer diese Sitzung nicht sichtbar',
      new.version, new.dokument_id
      using errcode = 'insufficient_privilege',
            hint = 'Eine Fassung legt an, wer das Dokument lesen und ablegen darf.';
  end if;
  if v_geloescht is not null then
    raise exception 'Dokument %: es ist geloescht und bekommt keine Fassung', new.dokument_id
      using errcode = 'restrict_violation';
  end if;
  if v_kategorie in ('rechnung', 'beleg', 'buchhaltung') then
    raise exception
      'Dokument % (%): Rechnungen, Belege und Buchhaltungsunterlagen bekommen keine neue '
      'Fassung (DOC-05, GoBD, Paragraf 147 AO)', new.dokument_id, v_kategorie
      using errcode = 'restrict_violation',
            hint = 'Berichtigt wird durch Gegenbuchung oder Storno, nie durch den Austausch '
                   'der Datei.';
  end if;

  select max(v.version) into v_hoechste
    from public.dokument_version v
   where v.dokument_id = new.dokument_id and v.mandant_id = new.mandant_id;
  if v_hoechste is null or new.version <> v_hoechste + 1 then
    raise exception
      'Fassung % zu Dokument %: die Kette ist lueckenlos — erwartet wird Fassung %',
      new.version, new.dokument_id, coalesce(v_hoechste + 1, 1)
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function kern.dokument_fassung_pruefen() is
  'DOC-05, V-219, D-713. Eine Fassung jenseits der ersten folgt lueckenlos der hoechsten, '
  'nie an einem geloeschten Dokument und nie an Rechnung, Beleg oder Buchhaltung (GoBD).';

create trigger trg_dokument_fassung
  before insert on dokument_version
  for each row execute function kern.dokument_fassung_pruefen();
