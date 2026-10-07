-- 0496 — wer eine Bau-Rechtserklaerung vorlegt, gibt sie nicht selbst frei
-- (V-383, O-260, D-805).
--
-- Behinderungsanzeige (Paragraf 6 Abs. 1 VOB/B) und Nachtragseinreichung
-- (Paragraf 2 VOB/B) gehen nach einer genehmigten Freigabe hinaus. Das Tor
-- (server/agent/policy.ts) prueft Status, Person und Nutzlast — nicht, dass
-- Entscheider und Verfasser verschieden sind; und freigabe.entscheiden haelt
-- seit 0136 auch die Leitung. Die Voreinstellung zu O-260 (D-800) ist das
-- Vier-Augen-Prinzip: wer die Erklaerung verfasst und vorlegt, gibt sie
-- nicht selbst frei.
--
-- Die Pruefung steht als Ausloeser an der Freigabe und nicht im Dienst: sie
-- gilt damit fuer jeden Weg, der eine Freigabe genehmigt — den Definer
-- app.freigabe_entscheiden, einen Stapel, einen kuenftigen zweiten Weg.
-- Verfasser ist erstellt_von der Freigabe: wer die Erklaerung zur Freigabe
-- vorlegt. Eine Freigabe ohne erstellt_von (vom Nachtlauf oder einem Agenten
-- vorgelegt) hat keinen menschlichen Verfasser, den die Regel trennen
-- koennte; dort entscheidet ohnehin ein Mensch.

create function kern.freigabe_vier_augen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.status = 'genehmigt'
     and new.aktion in ('behinderung_senden', 'nachtrag_einreichen')
     and new.erstellt_von is not null
     and new.freigegeben_von is not distinct from new.erstellt_von
  then
    raise exception
      'Vier-Augen-Prinzip: wer die Erklaerung vorlegt, gibt sie nicht selbst frei (O-260).'
      using errcode = 'insufficient_privilege',
            hint = 'Die Freigabe entscheidet eine andere Person, die Freigaben entscheiden darf.';
  end if;
  return new;
end $$;

comment on function kern.freigabe_vier_augen() is
  'V-383, O-260, D-805: Behinderungsanzeige und Nachtragseinreichung werden nicht '
  'von der Person genehmigt, die sie vorgelegt hat (erstellt_von).';

create trigger trg_freigabe_vier_augen
  before insert or update of status, freigegeben_von on freigabe
  for each row execute function kern.freigabe_vier_augen();
