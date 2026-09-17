-- 0181 — `rechnung_versand` (05-FINANZEN.md §9.6, 04-SEITENKARTE.md §5.14.1;
-- FIN-11, FIN-12, APR-07, CRM-08, LEG-08, SOC-07, Invariante 7, K-12).
--
-- ===========================================================================
-- Warum es diese Tabelle gibt und nicht eine Spalte auf `rechnung`
-- ===========================================================================
--
-- K-12: an einem festgeschriebenen Beleg aendert sich NICHTS. Der Versand
-- aendert sich aber — er wird freigegeben, dann gesendet, dann geht er zu
-- oder scheitert. Ein `rechnung.versendet_am` waere die eine Spalte, die den
-- Unveraenderlichkeitsausloeser zu einer Erlaubnisliste machen muesste, und
-- eine Erlaubnisliste in diesem Ausloeser liesse Invariante 4 ohne
-- Zusicherung in der Datenbank. Der Versandstand ist deshalb ein KIND.
--
-- ===========================================================================
-- Was es vorher gab und warum es nicht reichte
-- ===========================================================================
--
-- `versand` (0012) traegt `freigabe_id`, `aktion`, `kanal`, `empfaenger`,
-- `nutzlast_hash`, `gesendet_am`, `ergebnis` — und KEIN `rechnung_id`. Der
-- Umweg ueber `freigabe.bezug_typ` / `bezug_id` waere moeglich und ist
-- nirgends so benutzt; das Versandprotokoll einer Rechnung liesse sich damit
-- nur ueber eine Textspalte finden. Und die Freigabekette der Rechnung
-- braucht mehr, als `versand` fuehrt: WELCHES Artefakt hinausging, an welchen
-- Ansprechpartner, mit welcher Leitweg-ID, und wann es zuging (§286 BGB
-- braucht `zugang_am`, nicht `gesendet_am`).
--
-- `versand` bleibt, wie es ist — Lead-Bestaetigung und Mahnung schreiben
-- weiter dorthin. Diese Tabelle nimmt nichts weg.
--
-- ===========================================================================
-- Kein Versandweg ist verbunden, und das Schema sagt es (SOC-07, O-36)
-- ===========================================================================
--
-- Es ist nicht entschieden, welcher EU-gehostete Transaktionsmailer unter
-- welchem Auftragsverarbeitungsvertrag ausliefert (O-36), und kein
-- Peppol-Zugangspunkt ist eingerichtet (O-22). Der Ausloeser unten weist
-- deshalb jede Zeile ab, die fuer einen unverbundenen Kanal einen anderen
-- Zustand als `nicht_verbunden` behauptet: **das Schema weigert sich, einen
-- Versand zu protokollieren, der nicht stattgefunden hat.** Eine vorgetaeuschte
-- Zustellung entdeckt der Empfaenger dadurch, dass er die Rechnung nicht
-- bezahlt — und dann ist der Mahnlauf schon gelaufen.

/**
 * **Das Vokabular gehoert `02-CRM-OPERATIONS.md` §647 und wird hier nicht
 * zweitgeschrieben.** 07-INTEGRATIONEN §12.1 haelt ausdruecklich fest, dass
 * diese Schicht KEIN zweites Wegevokabular praegt: der Weg ist eine
 * Eigenschaft des KUNDEN, weil der Kaeufer ihn bestimmt. Die sechs Werte
 * stehen hier wortwoertlich, wie das CRM-Dokument sie fuehrt; sobald
 * `kunde.uebertragungsweg` dazukommt, nimmt es DIESEN Typ und keinen
 * eigenen. Ein Landesportal (O-22) wird ein siebter Wert dieses Typs, nie
 * ein zweiter Typ.
 */
create type uebertragungsweg as enum
  ('peppol', 'zre', 'ozg_re', 'email', 'kundenportal', 'post');

comment on type uebertragungsweg is
  '02-CRM-OPERATIONS.md §647, 07-INTEGRATIONEN §12.1. Der Uebertragungsweg einer '
  'Rechnung. Eigenschaft des Kunden; diese Schicht praegt kein zweites Vokabular.';

/** §7 der Finanzdomaene, vier Werte — und `nicht_verbunden` ist einer davon. */
create type versand_status as enum
  ('freigegeben', 'gesendet', 'fehlgeschlagen', 'nicht_verbunden');

comment on type versand_status is
  'Invariante 7, SOC-07. `nicht_verbunden` ist ein ZUSTAND und keine '
  'Fehlermeldung: ohne konfigurierten Ausliefererweg (O-36, O-22) gibt es keinen '
  'Versand, und die Zeile behauptet keinen.';

create table rechnung_versand (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),
  rechnung_id           uuid not null,

  /**
   * WELCHES Artefakt hinausging.
   *
   * `rechnung_dokument` (§9.5) gibt es in der Datenbank noch nicht, deshalb
   * steht die Kennung hier OHNE Fremdschluessel — dasselbe Verfahren wie
   * `rechnungsposition_quelle.ausgabe_id` in 0107 und mit demselben
   * ausgeschriebenen Grund, statt einer stillen Luecke. Solange sie fehlt,
   * traegt `artefakt` die Art und `nutzlast_sha256` den Nachweis, WELCHE
   * Fassung hinausging; beides zusammen ist pruefbar gegen die Datei, die
   * `/api/finanzen/rechnungen/[id]/xrechnung.xml` und `/zugferd.pdf`
   * ausliefern.
   * TODO(client, O-600): Soll der Versand die erzeugte Datei archivieren
   * (`rechnung_dokument` mit eigener Dokumentversion), oder genuegt der
   * Nachweis ueber den Hash der zum Zeitpunkt erzeugten Nutzlast?
   */
  rechnung_dokument_id  uuid,
  artefakt              text not null
                          check (artefakt in ('xrechnung', 'zugferd', 'pdf')),
  nutzlast_sha256       text not null check (nutzlast_sha256 ~ '^[0-9a-f]{64}$'),

  /**
   * Der Kunde, eingefroren: er ist das erste Glied des zusammengesetzten
   * Schluessels auf `ansprechpartner` (§13, `UNIQUE (mandant_id, kunde_id,
   * id)`) — und er haelt fest, an WELCHEN Kunden das Dokument ging,
   * unabhaengig von der Rechnungszeile.
   */
  kunde_id              uuid not null,

  kanal                 uebertragungsweg not null,

  empfaenger_ansprechpartner_id uuid,
  /** Die tatsaechlich benutzte Adresse, eingefroren: eine E-Mail aendert sich. */
  empfaenger_text       text not null check (btrim(empfaenger_text) <> ''),
  /** Eingefrorene Kopie fuer oeffentliche Auftraggeber (BT-10). */
  leitweg_id            text,

  freigabe_id           uuid,
  /**
   * **Pflicht, und darin besteht Invariante 7.** Es gibt keinen automatischen
   * Versand: ohne benannten Menschen entsteht diese Zeile nicht.
   */
  freigegeben_von       uuid not null references benutzer(id),
  freigegeben_am        timestamptz not null default now(),

  gesendet_am           timestamptz,
  /** §286 BGB rechnet ab ZUGANG, nicht ab Absendung (§7.6). */
  zugang_am             date,
  /** Wie der Zugang festgestellt wurde. NULL heisst: er wurde nicht festgestellt. */
  zugang_grundlage      text,

  status                versand_status not null default 'freigegeben',
  fehlertext            text,
  /** Die Nachrichtenkennung des Anbieters, wo es eine gibt. */
  externe_id            text,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),

  constraint rechnung_versand_mandant_uk unique (mandant_id, id),

  constraint rv_fehlertext_bei_fehler check (
    status <> 'fehlgeschlagen' or length(btrim(coalesce(fehlertext, ''))) >= 3),
  constraint rv_gesendet_hat_zeitpunkt check (
    (status = 'gesendet') = (gesendet_am is not null)),
  constraint rv_zugang_begruendet check (
    (zugang_am is null) = (zugang_grundlage is null)),

  constraint rv_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint rv_rechnung_fk foreign key (mandant_id, rechnung_id)
    references rechnung (mandant_id, id),
  constraint rv_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint rv_ansprechpartner_fk
    foreign key (mandant_id, kunde_id, empfaenger_ansprechpartner_id)
    references ansprechpartner (mandant_id, kunde_id, id),
  constraint rv_freigabe_fk foreign key (mandant_id, freigabe_id)
    references freigabe (mandant_id, id)
);

comment on table rechnung_versand is
  'FIN-11, FIN-12, Invariante 7, K-12. Ein freigegebener Versand EINES '
  'Rechnungsartefakts ueber EINEN Kanal. Der Versandstand ist ein Kind, weil ein '
  'festgeschriebener Beleg sich nicht mehr aendert; freigegeben_von ist Pflicht, '
  'weil es keinen automatischen Versand gibt.';

comment on column rechnung_versand.zugang_am is
  '§286 BGB, §7.6. Der Verzug rechnet ab ZUGANG. NULL heisst: nicht festgestellt '
  '— und dann darf kein Mahnlauf ihn unterstellen.';

create index rechnung_versand_rechnung_idx
  on rechnung_versand (mandant_id, rechnung_id, freigegeben_am desc);
/** Die Sendewarteschlange. */
create index rechnung_versand_offen_idx
  on rechnung_versand (mandant_id, status) where status = 'freigegeben';
create index rechnung_versand_kunde_idx on rechnung_versand (mandant_id, kunde_id);
create index rechnung_versand_freigabe_idx on rechnung_versand (mandant_id, freigabe_id)
  where freigabe_id is not null;

/**
 * Der Freigabezeitpunkt kommt von der SERVERUHR (Invariante 5, K-11).
 *
 * **Eine eigene Funktion und nicht `kern.erzwinge_serverzeit()`**: die
 * stempelt fest `eingegangen_am` und scheitert auf jeder Tabelle, die keine
 * solche Spalte hat — hier mit `record "new" has no field "eingegangen_am"`,
 * also bei JEDEM Einfügen. Der Name der Spalte ist verschieden, die Regel ist
 * dieselbe: die Zeit, zu der jemand freigegeben hat, wird nicht mitgeschickt.
 */
create function fin.rechnung_versand_serverzeit() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  new.freigegeben_am := now();
  return new;
end $$;

create trigger rechnung_versand_0_serverzeit
  before insert on rechnung_versand
  for each row execute function fin.rechnung_versand_serverzeit();

-- =========================================================================
-- Nur ein Entwurf hat keinen Versand — und was hinausgeht, ist festgeschrieben
-- =========================================================================

/**
 * Ein Entwurf hat keine Nummer und keine rechtliche Existenz; ihn zu
 * versenden hiesse, ein Dokument ohne Nummer aus dem Haus zu geben. Geprueft
 * wird in der Datenbank und nicht nur im Dienst, weil ein zweiter Schreibweg
 * (Auftrag, Job, Konsole) denselben Fehler sonst ein zweites Mal machen darf.
 */
create function fin.rechnung_versand_nur_festgeschrieben() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_status rechnung_status;
begin
  select r.status into v_status from public.rechnung r where r.id = new.rechnung_id;
  if v_status is distinct from 'festgeschrieben' then
    raise exception
      'Nur eine festgeschriebene Rechnung wird versendet — dieser Beleg ist %.',
      coalesce(v_status::text, 'unbekannt')
      using errcode = 'restrict_violation',
            hint = 'Ein Entwurf traegt keine Nummer; ein Dokument ohne Nummer geht nicht hinaus.';
  end if;
  return new;
end $$;

create trigger rechnung_versand_1_festgeschrieben
  before insert on rechnung_versand
  for each row execute function fin.rechnung_versand_nur_festgeschrieben();

/**
 * **Das Schema weigert sich, einen Versand zu protokollieren, der nicht
 * stattgefunden hat** (SOC-07, hier angewandt).
 *
 * Fuer die drei Portalwege — Peppol, ZRE, OZG-RE — ist kein Zugangspunkt
 * eingerichtet (O-22); fuer E-Mail ist kein Ausliefererweg mit
 * Auftragsverarbeitungsvertrag entschieden (O-36). Solange die Einstellung
 * `versand.<kanal>.verbunden` nicht ausdruecklich `true` sagt, ist der
 * einzige erlaubte Zustand `nicht_verbunden`.
 *
 * `kundenportal` und `post` sind KEIN elektronischer Versand durch diese
 * Plattform: das Portal zeigt das Dokument, und Papier kuvertiert ein Mensch.
 * Beide brauchen deshalb keine Verbindung.
 */
create function fin.rechnung_versand_kanal_verbunden() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_verbunden jsonb;
begin
  if new.kanal in ('kundenportal', 'post') then return new; end if;
  if new.status = 'nicht_verbunden' then return new; end if;

  /* Der Mandant der ZEILE und nicht `app.aktiver_mandant()`: ein Job hat
     keinen aktiven Mandanten, und dann las die einstellungslose Fassung
     still `null` — also „nicht verbunden" fuer eine Gesellschaft, die es
     ist, oder umgekehrt. */
  v_verbunden := app.einstellung(new.mandant_id,
                                 'versand.' || new.kanal::text || '.verbunden');
  if coalesce(v_verbunden, 'false'::jsonb) <> 'true'::jsonb then
    raise exception
      'Fuer den Kanal % ist kein Ausliefererweg verbunden (O-36, O-22) — ein Versand wird nicht behauptet.',
      new.kanal
      using errcode = 'restrict_violation',
            hint = 'Zulaessig ist allein status = nicht_verbunden; die Datei laesst sich herunterladen und von Hand versenden.';
  end if;
  return new;
end $$;

create trigger rechnung_versand_2_kanal_verbunden
  before insert or update on rechnung_versand
  for each row execute function fin.rechnung_versand_kanal_verbunden();

/**
 * Append-only bis auf den Zustandsteil. Was einmal protokolliert ist — WER
 * freigegeben hat, WELCHES Artefakt, an WEN —, aendert sich nicht; was danach
 * geschieht, schon.
 */
create function fin.rechnung_versand_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.rechnung_id          is distinct from old.rechnung_id
  or new.rechnung_dokument_id is distinct from old.rechnung_dokument_id
  or new.artefakt             is distinct from old.artefakt
  or new.nutzlast_sha256      is distinct from old.nutzlast_sha256
  or new.kunde_id             is distinct from old.kunde_id
  or new.kanal                is distinct from old.kanal
  or new.empfaenger_ansprechpartner_id is distinct from old.empfaenger_ansprechpartner_id
  or new.empfaenger_text      is distinct from old.empfaenger_text
  or new.leitweg_id           is distinct from old.leitweg_id
  or new.freigabe_id          is distinct from old.freigabe_id
  or new.freigegeben_von      is distinct from old.freigegeben_von
  or new.freigegeben_am       is distinct from old.freigegeben_am then
    raise exception
      'Ein protokollierter Versand aendert sich nicht — nur sein Zustand (K-12, Invariante 7).'
      using errcode = 'restrict_violation',
            hint = 'Aenderbar sind gesendet_am, zugang_am, zugang_grundlage, status, fehlertext, externe_id.';
  end if;
  return new;
end $$;

create trigger rechnung_versand_3_append_only
  before update on rechnung_versand
  for each row execute function fin.rechnung_versand_append_only();

-- =========================================================================
-- RLS (§1.1–§1.4, K-03) — Modul `versand`
-- =========================================================================

alter table rechnung_versand enable row level security;
alter table rechnung_versand force  row level security;

/**
 * Lesen mit `versand.lesen`, schreiben mit `versand.freigeben` — und das ist
 * kein Schreibfehler: es GIBT hier keinen anderen Schreibvorgang als die
 * Freigabe. Wer protokolliert, dass etwas hinausging, gibt es damit frei.
 */
create policy t_mandant on rechnung_versand for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('versand.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('versand.freigeben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

/**
 * KEINE Gruppenpolicy. Der Katalog fuehrt kein `gruppe.versand.lesen`
 * (05-FINANZEN.md §1.3 laesst die Spalte „Group read" fuer dieses Modul
 * ausdruecklich leer), und `app.hat_recht` antwortet auf einen Schluessel,
 * den es nicht kennt, mit `false` — eine Policy darauf waere eine, die nie
 * greift und die beim Lesen des Codes das Gegenteil behauptet.
 */

create policy p_intern_ceiling on rechnung_versand as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

grant select, insert, update on rechnung_versand to cse_app;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0181)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- rechnung_versand (append): FIN-11, FIN-12, Invariante 7, LEG-08, §286 BGB. Die Zeile IST der Nachweis, dass ein Mensch den Versand freigegeben hat, und sie traegt den Zugang, ab dem der Verzug rechnet. Sie zu loeschen liesse eine Mahnung ohne Grundlage und eine Freigabe ohne Spur zurueck.
create trigger trg_rechnung_versand_kein_hard_delete
  before delete on rechnung_versand
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnung_versand_kein_truncate
  before truncate on rechnung_versand
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnung_versand from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
