-- 0142 · Der Schemastand fuer die Verfahrensdokumentation (ACC-10, PR 66, D-485)
--
-- Die Verfahrensdokumentation nach GoBD Rz. 151 ff. muss sagen, in welcher
-- Fassung das System laeuft. Fuer die Datenbank ist das die zuletzt angewendete
-- Migration — und die steht in `__drizzle_migrations`, dem Journal des
-- Migrators (`src/server/db/migrate.ts`). Das Journal gehoert dem Migrator;
-- `cse_app` liest es nicht, und soll es nicht: eine Anwendungsrolle, die
-- Systemtabellen lesen darf, ist eine, der man beim naechsten Mal auch das
-- Schreiben zutraut.
--
-- Deshalb eine Definer-Funktion mit genau einer Auskunft: Name und Zeitpunkt
-- jeder angewendeten Migration, geordnet, unter dem Recht, das auch die
-- Verfahrensdokumentation oeffnet. Nichts sonst — keine Inhalte, keine
-- Rollen, keine Verbindungsdaten.
--
-- **Ohne Journal eine leere Menge, kein Fehler.** Die Isolationsdatenbank
-- (`scripts/test-db.sh`) wendet die Dateien per `psql` an und fuehrt kein
-- Journal; dort gibt es diesen Stand nicht, und die Dokumentation sagt das
-- (D-485) — sie erfindet keinen aus dem Dateisystem.
--
-- `execute` statt einer statischen Abfrage, damit die Funktion auch dort
-- anlegbar bleibt, wo das Journal (noch) fehlt; der Name ist fest, kein
-- Parameter fliesst hinein.

create function app.migrationsstand()
returns table (name text, angewendet_am timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if app.aktiver_mandant() is null
     or not app.hat_recht('buchhaltung_konfiguration.lesen', app.aktiver_mandant()) then
    raise insufficient_privilege using message =
      'Der Schemastand ist Teil der Verfahrensdokumentation (buchhaltung_konfiguration.lesen).';
  end if;
  if to_regclass('public.__drizzle_migrations') is null then return; end if;
  return query execute
    'select m.name::text, m.angewendet_am from public.__drizzle_migrations m order by m.name';
end $$;

comment on function app.migrationsstand() is
  'Name und Zeitpunkt jeder angewendeten Migration aus dem Journal des Migrators — fuer die '
  'Verfahrensdokumentation (ACC-10, D-485). Leer, wo kein Journal gefuehrt wird; nie erfunden.';

alter function app.migrationsstand() owner to cse_definer;
revoke execute on function app.migrationsstand() from public;
grant execute on function app.migrationsstand() to cse_app;

-- Das Journal existiert, wo der Migrator lief (Auslieferung, `scripts/e2e-db.sh`);
-- nur dort gibt es etwas zu gewaehren. Die Isolationsdatenbank hat keins.
do $$
begin
  if to_regclass('public.__drizzle_migrations') is not null then
    grant select on public.__drizzle_migrations to cse_definer;
  end if;
end $$;
