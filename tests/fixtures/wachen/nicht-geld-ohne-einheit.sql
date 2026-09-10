-- FIXTURE — must FAIL. Ambiguous name, `numeric`, and no unit named.
create table belagsart_fixture (
  leistungswert_qm_pro_stunde numeric(10,3) not null
);
