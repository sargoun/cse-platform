-- FIXTURE — must FAIL `geld-nie-numeric` DESPITE the exemption comment.
-- A column whose name says money can never be exempted, however it is
-- annotated; otherwise the guard is only as strong as the discipline of the
-- person adding the comment.
create table rechnungsposition (
  netto_betrag numeric(12,2) not null -- nicht-geld: m²/h
);
