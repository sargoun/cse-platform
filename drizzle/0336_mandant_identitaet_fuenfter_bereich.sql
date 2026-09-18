-- ===========================================================================
-- 0336 — Ein fuenfter Bereich ist eine ZEILE, keine Codeaenderung
--        (TEN-08, TEN-07, 01-KERN §6.1/§6.2, DESIGN §1/§9, D-10, CLAUDE.md)
-- ===========================================================================
--
-- **Der Befund.** 0200 haengt an `mandant` den Ausloeser
-- `kern.mandant_identitaet_anlegen()`. Der bricht jedes `insert into mandant`
-- ab, dessen Slug nicht `reinigung`, `security`, `bau` oder `operations`
-- heisst:
--
--     raise exception 'Fuer den Bereich % gibt es kein Identitaetstoken …'
--
-- Damit kann die Gruppe keine fuenfte Gesellschaft mehr anlegen, ohne dass
-- jemand eine Migration schreibt. TEN-08 sagt das Gegenteil, und zwar als
-- Zusage, nicht als Wunsch: „ein fuenfter Bereich ist eine Datenbankzeile und
-- keine Codeaenderung". `tests/isolation/mandanten-trennung.test.ts` fuehrt
-- sie namentlich, und zwei weitere Suiten legen im Test eine Gesellschaft an
-- (`bau-nachtrag`, `reinigung`) — alle drei sind an diesem `raise` gescheitert.
--
-- **Die Begruendung in 0200 ist richtig, die Schlussfolgerung nicht.** Eine
-- Ersatzfarbe zu waehlen — etwa `area-operations` fuer einen Logistikbereich —
-- waere der erfundene Gestaltungswert, den CLAUDE.md und DESIGN §1 verbieten:
-- der neue Bereich saehe aus wie „Digital & KI", und niemand suchte den Grund
-- in einem Ausloeser. Das bleibt so. Aber aus „ich darf keine Farbe erfinden"
-- folgt nicht „dann darf es die Gesellschaft nicht geben". CLAUDE.md nennt
-- fuer genau diesen Fall einen anderen Weg: Schnittstelle bauen, einen klar
-- bezeichneten PLATZHALTER setzen, `// TODO(client, O-NN)` daneben, und die
-- offene Frage ins Register.
--
-- **Der Platzhalter ist NULL.** `identitaets_token` wird nullable; der `CHECK`
-- bleibt Zeichen fuer Zeichen derselbe fuer jeden NICHT-NULL-Wert. NULL heisst
-- hier genau eine Sache: „fuer diesen Bereich steht in DESIGN §1 noch kein
-- Bereichston". Das ist derselbe neutrale Zustand, den `mandant
-- .ist_rechtseinheit` (O-01) und `pruefverfahren.bestehensschwelle_prozent`
-- (O-29) schon tragen — eine unbeantwortete Frage, als NULL geschrieben und
-- nicht als geratene Antwort.
--
-- Erfunden wird dabei nichts: `services/mandant/identitaet.ts` gibt fuer ein
-- Token ohne Farbe schon heute `null` zurueck und ausdruecklich nicht Grau,
-- und `/einstellungen/identitaet` rendert dafuer bereits den Leerzustand —
-- ein Feld mit Rahmen und ohne Flaeche, daneben der Satz, dass der Eintrag
-- fehlt und nicht die Farbe. Diese Migration setzt den Datenbankzustand, den
-- diese beiden Stellen bereits erwarten.
--
-- **Was sich NICHT aendert.** Ein erfundener Tokenname bleibt abgewiesen: der
-- `CHECK` laesst weiterhin nur die vier Namen aus DESIGN §1 durch. Der Weg zu
-- einer Farbe ist unveraendert derselbe — zuerst ein Eintrag in
-- `docs/DESIGN.md` (Farbe mit geprueftem Kontrast, DESIGN §9), dann eine
-- Migration, die den `CHECK` erweitert. Neu ist nur, dass die Gesellschaft
-- solange existieren, arbeiten und abrechnen darf, statt gar nicht erst
-- angelegt zu werden.
--
-- // TODO(client, O-750): Welcher Bereichston (DESIGN §1, Kontrast nach §9) gilt fuer eine fuenfte Gesellschaft, und darf ihr Profil oeffentlich gehen, bevor er eingetragen ist?
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Der Platzhalterzustand der Spalte
-- ---------------------------------------------------------------------------

alter table mandant_identitaet alter column identitaets_token drop not null;

alter table mandant_identitaet drop constraint mi_token;

/**
 * Die vier Tokens aus DESIGN §1 — und NULL fuer „noch keiner eingetragen".
 * Ein fuenfter Name kommt hier nur nach einem DESIGN.md-Eintrag hinein; das
 * ist unveraendert die Reihenfolge aus CLAUDE.md.
 */
alter table mandant_identitaet add constraint mi_token check (
  identitaets_token is null
  or identitaets_token in
     ('area-reinigung', 'area-security', 'area-bau', 'area-operations'));

comment on column mandant_identitaet.identitaets_token is
  'Token-NAME aus DESIGN §1, kein Hex-Wert; den Farbwert liefert globals.css. '
  'NULL = PLATZHALTER: fuer diesen Bereich steht in DESIGN §1 noch kein '
  'Bereichston (TEN-08, O-750). Die Zeile entsteht trotzdem, und die '
  'Oberflaeche markiert sie sichtbar als unhinterlegt.';

-- ---------------------------------------------------------------------------
-- 2. Der Ausloeser legt an, statt abzubrechen
-- ---------------------------------------------------------------------------

/**
 * Die 1:1-Zeile entsteht MIT dem Mandanten (§6.1 „Triggers") — jetzt fuer
 * JEDEN Mandanten.
 *
 * **Warum das ein Ausloeser ist und keine Zeile im Anlagedienst.** TEN-07 ist
 * die 3px-Leiste in der Bereichsfarbe; sie laeuft auf JEDER Portalseite. Ein
 * Mandant ohne Identitaetszeile faellt damit nicht beim Anlegen auf, sondern
 * beim ersten Seitenaufruf danach — und dort als fehlender Wert in einer
 * Kopfzeile, nicht als benannter Fehler.
 *
 * **Ein unbekannter Slug ist ein Platzhalter, kein Abbruch und keine geratene
 * Farbe** (siehe Kopf, TEN-08). `identitaets_token` bleibt NULL,
 * `platzhalter_medien` steht ohnehin auf `true`, und `oeffentlich_sichtbar`
 * auf `false`: die neue Gesellschaft existiert und arbeitet, ihr oeffentliches
 * Profil bleibt zu, bis jemand sie eingerichtet hat.
 */
create or replace function kern.mandant_identitaet_anlegen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_token text := 'area-' || new.slug;
begin
  if v_token not in ('area-reinigung', 'area-security', 'area-bau', 'area-operations') then
    /*
     * Kein Ersatz und kein Abbruch: die Frage bleibt offen und steht als NULL
     * in der Zeile (O-750). Eine Ersatzfarbe waere der verbotene
     * Gestaltungswert, ein Abbruch waere der Bruch von TEN-08.
     */
    v_token := null;
  end if;

  insert into public.mandant_identitaet (mandant_id, kurzname, identitaets_token)
  values (new.id, new.name, v_token);
  return null;
end $$;

/** K-01: eine `security definer`-Funktion gehoert `cse_definer`, nie der Migrationsrolle. */
alter function kern.mandant_identitaet_anlegen() owner to cse_definer;

comment on function kern.mandant_identitaet_anlegen() is
  '§6.1/§6.2: legt die 1:1-Identitaetszeile mit Platzhalterwerten an, damit '
  'TEN-07 nie ohne Wert laeuft. Unbekannter Slug: Token NULL (Platzhalter, '
  'TEN-08, O-750) — kein Abbruch und keine geratene Farbe.';

-- ---------------------------------------------------------------------------
-- 3. Die Zeilen nachtragen, die 0200 uebersprungen hat
-- ---------------------------------------------------------------------------

/**
 * 0200 hat Bereiche mit einem Slug ausserhalb der vier bewusst ohne Zeile
 * gelassen — es gab keinen Zustand, in dem sie eine haben konnten. Jetzt gibt
 * es ihn, und die 1:1-Zusage aus §6.2 („es gibt keinen Zustand ‚diese
 * Gesellschaft hat kein Erscheinungsbild', nur Felder ohne Wert") gilt wieder
 * fuer den ganzen Bestand.
 */
insert into mandant_identitaet (mandant_id, kurzname, identitaets_token)
select m.id,
       m.name,
       case when 'area-' || m.slug in
                 ('area-reinigung', 'area-security', 'area-bau', 'area-operations')
            then 'area-' || m.slug end
  from mandant m
 where not exists (select 1 from mandant_identitaet mi where mi.mandant_id = m.id);
