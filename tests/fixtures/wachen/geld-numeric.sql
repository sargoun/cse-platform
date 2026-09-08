-- FIXTURE — must FAIL `geld-nie-numeric`.
create table rechnungsposition (
  netto_betrag numeric(12,2) not null
);
