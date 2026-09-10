import { alsApp, seed, sql, schliessen } from './tests/isolation/harness.js';
const f = await seed();
const [u] = await sql.unsafe<{id:string}[]>(`insert into auth.users (email) values ('dbg@x.test') returning id`);
await sql.unsafe(`insert into benutzer (id,email,name,status,person_id) values ($1,'dbg@x.test','dbg','aktiv',$2)`, [u!.id, f.fatima] as never[]);
const [r] = await sql.unsafe<{id:string}[]>(`select id from rolle where schluessel='mitarbeiter' and mandant_id is null`);
await sql.unsafe(`insert into benutzer_mandant (benutzer_id,mandant_id,rolle_id) values ($1,$2,$3)`, [u!.id, f.reinigung, r!.id] as never[]);
await alsApp({scope:'mandant', mandantId:f.reinigung, benutzerId:u!.id, personId:f.fatima, portal:'mitarbeiter', readonly:false}, async (tx) => {
  const chk = await tx.unsafe(`select
      ($1 = app.aktiver_mandant()) as m_ok,
      (not app.ist_readonly()) as rw,
      exists (select 1 from anstellung a where a.mandant_id = $1 and a.id = $2 and a.person_id = app.aktuelle_person()) as self_ok,
      ($2 in (select a.id from anstellung a where a.person_id = app.aktuelle_person())) as decke_ok`,
    [f.reinigung, f.fatimaReinigung] as never[]);
  console.log('checks', chk);
  try {
    const res = await tx.unsafe(`insert into zeit_einwand (mandant_id, anstellung_id, art, betrifft_datum, begruendung, eingereicht_von_benutzer_id) values ($1,$2,'eintrag_fehlt','2026-10-21','x',$3) returning id`, [f.reinigung, f.fatimaReinigung, u!.id] as never[]);
    console.log('insert ok', res);
  } catch (e) { console.log('insert failed:', (e as Error).message); }
});
await schliessen();
