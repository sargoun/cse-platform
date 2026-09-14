-- 0154 · Das Modellregister — der einzige Ort, an dem ein Modell aufrufbar wird
--
-- `07-INTEGRATIONEN.md` §3.6 und §8. Bis hierher fragte die Plattform zwei
-- Umgebungsvariablen und nannte das „verbunden"; das ist kein Nachweis. Ein
-- Modell wird aufrufbar, wenn DREI Dinge in einer Zeile stehen:
-- EU-Verarbeitung, Nullspeicherung, Freigabe — mit Namen und Datum daneben.
--
-- **Die Vorgaben sind alle `false`.** Ein Modell, das eine unachtsame Migration
-- hinzufügt, ist damit nicht aufrufbar. Das ist die Richtung, in die ein
-- Fehler fallen soll.
--
-- **Der Aufrufer fragt nach einer FÄHIGKEIT, nie nach einem Modell** (§8). Wer
-- „gib mir gpt-4o" schreibt, hat die Residenzfrage umgangen, bevor sie
-- gestellt wurde; wer „ich brauche `entwurf_text`" schreibt, bekommt entweder
-- ein freigegebenes Modell oder ein ehrliches Nein.

create type ki_faehigkeit as enum (
  'chat_intern', 'entwurf_text', 'extraktion_dokument', 'extraktion_beleg',
  'klassifikation', 'embedding', 'vision'
);

create table modell_register (
  id                uuid primary key default gen_random_uuid(),

  /**
   * **Wer verarbeitet.** `demo` heisst: niemand — es läuft im eigenen Prozess.
   * Jeder andere Wert benennt einen Auftragsverarbeiter, und daran hängt, ob
   * die Freigabe einen Menschen braucht (siehe die beiden Riegel unten).
   */
  anbieter          text not null check (anbieter ~ '^[a-z][a-z0-9_-]*$'),
  /** Die Kennung beim Anbieter — oder `demo:…` für den hausinternen Betrieb. */
  modell            text not null check (length(btrim(modell)) > 0),
  faehigkeit        ki_faehigkeit not null,

  /**
   * **Die drei Flaggen, und warum sie einzeln stehen.**
   *
   * Ein einzelnes `freigegeben` wäre bequemer und wertlos: es verschwiege,
   * WAS geprüft wurde. Ein Anbieter kann EU-Verarbeitung anbieten und
   * Nullspeicherung nicht, und das ist ein anderer Sachverhalt als eine
   * fehlende Unterschrift. Die Regel ist die Konjunktion, nicht die Summe.
   */
  eu_verarbeitung   boolean not null default false,
  zero_retention    boolean not null default false,
  freigegeben       boolean not null default false,

  /** Wer den Nachweis gesehen hat, und wann — nicht „das System". */
  geprueft_am       timestamptz,
  geprueft_von      uuid references benutzer(id),
  /** Das Dokument des Anbieters, auf dem die Prüfung ruht. */
  nachweis_url      text,

  /**
   * Warum diese Zeile so steht, wie sie steht — bei `demo` der Satz, der die
   * Zahlen als Demowerte kennzeichnet.
   */
  bemerkung         text,

  erstellt_am       timestamptz not null default now(),
  geaendert_am      timestamptz,

  constraint mr_uk unique (modell, faehigkeit),
  /** Eine Freigabe ohne Zeitpunkt ist keine Freigabe. */
  constraint mr_freigabe_hat_zeitpunkt check (
    not freigegeben or geprueft_am is not null),
  /**
   * **Ein fremder Anbieter braucht einen Menschen mit Namen.**
   *
   * Beim Demobetrieb gibt es keinen Nachweis zu sehen, weil es keinen
   * Anbieter gibt — dort wäre ein Prüfername eine Unterschrift unter nichts.
   * Bei jedem anderen hängt an dieser Zeile, dass Vertragstext das Haus
   * verlässt; wer das freigibt, steht mit Namen daneben (LEG-09).
   */
  constraint mr_fremder_anbieter_braucht_menschen check (
    anbieter = 'demo' or not freigegeben or geprueft_von is not null)
);

comment on table modell_register is
  '07-INTEGRATIONEN §3.6, §8, D-04, LEG-09. Der einzige Ort, an dem ein Modell aufrufbar '
  'wird: aufrufbar := eu_verarbeitung AND zero_retention AND freigegeben. Preise stehen '
  'NICHT hier, sondern in agent_preisliste (Join ueber modell), damit Preisaenderung und '
  'Residenzfreigabe nicht in zwei Tabellen auseinanderlaufen.';

create trigger trg_modell_register_geaendert before update on modell_register
  for each row execute function kern.setze_geaendert_am();

/**
 * Die eine Frage, die der Aufrufer stellt: **welches Modell kann diese
 * Fähigkeit** — und schweigt, wenn keines.
 *
 * Kein `raise`: „kein Modell freigegeben" ist ein normaler Betriebszustand
 * (§8), kein Fehler. Die Oberfläche sagt dann „KI-Funktion nicht verfügbar",
 * und die Arbeit läuft von Hand weiter.
 */
create function app.modell_fuer(p_faehigkeit ki_faehigkeit) returns text
language sql stable set search_path = pg_catalog, public as $$
  select r.modell
    from public.modell_register r
   where r.faehigkeit = p_faehigkeit
     and r.eu_verarbeitung and r.zero_retention and r.freigegeben
   order by
     /* Ein echter Anbieter schlaegt den Demobetrieb, sobald einer freigegeben ist. */
     (r.anbieter = 'demo')::int,
     r.geprueft_am desc nulls last,
     r.modell
   limit 1
$$;

comment on function app.modell_fuer(ki_faehigkeit) is
  '07-INTEGRATIONEN §8. Faehigkeit rein, Modellkennung raus — oder NULL. Ein echtes Modell '
  'schlaegt den Demobetrieb, sobald eines freigegeben ist.';

alter table modell_register enable row level security;
alter table modell_register force  row level security;

/**
 * Nachschlagetabelle ohne `mandant_id`: sie gilt für die ganze Gruppe, und sie
 * ist lesend für jede angemeldete Sitzung — welches Modell freigegeben ist,
 * ist keine Vertraulichkeit, sondern eine Angabe, die auf dem Bildschirm
 * stehen soll.
 */
create policy t_modell_register_lesen on modell_register for select to cse_app
  using (app.aktueller_benutzer() is not null);
create policy j_modell_register on modell_register for select to cse_job using (true);

grant select on modell_register to cse_app, cse_job;

-- ---------------------------------------------------------------------------
-- Der Demobetrieb — und warum er die drei Flaggen mit Recht trägt
-- ---------------------------------------------------------------------------

/**
 * **`demo:…` läuft im eigenen Prozess. Es verlässt nichts das Haus.**
 *
 * Deshalb sind `eu_verarbeitung` und `zero_retention` hier keine Behauptung
 * über einen Anbieter, sondern eine Tatsache über den Betrieb: es gibt keinen
 * Anbieter. Kein Netzverkehr, kein Auftragsverarbeiter, keine Speicherung
 * ausserhalb dieser Datenbank. Das Residenztor ist damit nicht umgangen,
 * sondern erfüllt.
 *
 * **Was der Demobetrieb NICHT ist:** ein Sprachmodell. Er formuliert aus
 * Vorlagen und aus dem, was die Werkzeuge gerechnet haben — deterministisch,
 * wiederholbar, ohne Erfindung. Jede Zahl kommt aus einer geprüften Funktion
 * (Invariante 6); der Demobetrieb setzt Sätze darum. Das ist genau das, was
 * ein echtes Modell an dieser Stelle auch dürfte, und nicht mehr.
 *
 * **Er ist als solcher gekennzeichnet**, in der Modellkennung und in der
 * Bemerkung — damit der Tausch auf einen echten Anbieter eine Zeile ist und
 * niemand hinterher raten muss, welche Entwürfe aus welcher Quelle stammten.
 */
insert into modell_register
  (anbieter, modell, faehigkeit, eu_verarbeitung, zero_retention, freigegeben,
   geprueft_am, bemerkung)
select 'demo', 'demo:hausintern-v1', f, true, true, true, now(),
       'Demobetrieb: laeuft im eigenen Prozess, kein Anbieter, kein Netzverkehr. '
       || 'Formuliert aus Vorlagen und gerechneten Werten — kein Sprachmodell, keine '
       || 'Erfindung. Ersetzen heisst: echten Anbieter eintragen, dann schlaegt er '
       || 'diese Zeile (app.modell_fuer ordnet danach).'
  from unnest(enum_range(null::ki_faehigkeit)) as f;

/** Preise: der Demobetrieb kostet nichts, und das steht als Zahl da. */
insert into agent_preisliste
  (modell, gueltig_ab, preis_eingabe_je_mio_token_mikrocent,
   preis_ausgabe_je_mio_token_mikrocent, preis_gedanken_je_mio_token_mikrocent,
   waehrung_original, version)
values ('demo:hausintern-v1', now(), 0, 0, 0, 'EUR', 'demo-1')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Die vier Agenten gehen an — weil es jetzt ein Modell gibt
-- ---------------------------------------------------------------------------

/**
 * **`agent.ist_aktiv` stand auf `false`, und der Grund ist entfallen.**
 *
 * 0128 hat die vier bewusst ausgeschaltet angelegt: es gab kein Modell, und
 * ein eingeschalteter Agent ohne Modell ist ein Knopf, der nichts tut
 * (D-435). Seit dieser Migration gibt es eines — den Demobetrieb, der im
 * eigenen Prozess läuft und im Register mit drei zutreffenden Flaggen steht.
 *
 * **Eingeschaltet heisst nicht „läuft von selbst".** Ein Lauf entsteht auf
 * Knopfdruck oder durch einen Zeitplan, er endet mit einem VORSCHLAG im
 * Freigabe-Posteingang, und was daraus wird, entscheidet ein Mensch
 * (Invariante 7). Wer einen Agenten wieder aus haben will, setzt die Spalte
 * zurück — die Oberfläche sagt dann, dass er aus ist, und der Knopf
 * verschwindet.
 */
update agent set ist_aktiv = true, geaendert_am = now()
 where kennung in ('ceo_assistent', 'akquise', 'backoffice', 'finanzen');

/** Die Werkzeuge, die ohne Modell auskommen, waren schon frei — die übrigen folgen jetzt. */
update agent_werkzeug set ist_aktiv = true, geaendert_am = now()
 where not ist_aktiv;
