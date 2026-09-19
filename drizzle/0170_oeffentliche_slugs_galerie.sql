/**
 * 0170 — URL-Schlüssel für `referenz` und `beitrag`, und eine KURATIERTE
 * Galerie (SEITENKARTE §1.6 und §2.2, PRO-02, PRO-04, PRO-05, PUB-04).
 *
 * **Warum die Slugs eine Pflicht sind und keine Bequemlichkeit.**
 * `04-SEITENKARTE.md` §1.6 hält es wörtlich fest: „`stelle`, `referenz` und
 * `social_post` brauchen einen URL-Schlüssel und haben heute keinen; ihn
 * hinzuzufügen ist eine Verpflichtung, die diese Karte dem Datenmodell
 * auferlegt." Ohne ihn gibt es
 * `/unternehmen/[bereich]/projekte/[slug]` und
 * `/unternehmen/[bereich]/news/[slug]` nicht — und §2.2 macht genau diese
 * beiden zur KANONISCHEN Adresse eines Projekts und einer Neuigkeit. Die
 * Gruppenlisten `/projekte` und `/news` verweisen dorthin und setzen
 * `<link rel="canonical">` darauf; ohne Slug hätte jede Meldung zwei Adressen,
 * und genau das war der Grund, die vier kurzen Bereichsadressen zu streichen.
 *
 * **Warum eine UUID nicht reicht.** Sie steht in der Adresse, die ein Kunde
 * weitergibt und eine Suchmaschine aufnimmt. Eine UUID ist dort weder lesbar
 * noch beständig gegen ein Umschreiben des Titels — und beständig muss sie
 * sein, denn eine Adresse, die sich mit dem Titel ändert, bricht jeden
 * eingehenden Verweis. Der Slug wird deshalb EINMAL gesetzt und folgt dem
 * Titel danach nicht mehr; das ist eine Regel der Redaktion, nicht des
 * Schemas, und steht so im Kommentar der Spalte.
 *
 * **Eindeutig JE GESELLSCHAFT, nicht global.** Die Adresse trägt den Bereich
 * schon: `/unternehmen/security/news/tag-der-sicherheit` und
 * `/unternehmen/reinigung/news/tag-der-sicherheit` sind zwei Seiten und
 * dürfen es sein. Ein globaler Index zwänge die zweite Gesellschaft, ihre
 * Meldung umzubenennen, weil eine andere Gesellschaft schneller war — eine
 * Kopplung zwischen Mandanten, die Invariante 3 gerade vermeiden will.
 *
 * **Die Galerie ist kuratiert, und das ist der Punkt.**
 * `t_medien_oeffentlich` erlaubt `select` auf `medien` mit `using (true)`:
 * JEDE Zeile ist öffentlich lesbar. Eine Galerie, die einfach `medien` je
 * Mandant liest, zeigt deshalb jedes hochgeladene Bild — den Schnappschuss
 * aus dem Wachbuch, das Foto einer Schadensmeldung, den Scan eines Belegs.
 * Das wäre kein Anzeigefehler, sondern ein Datenschutzvorfall. Sie braucht
 * ein ausdrückliches „dieses Bild gehört in die öffentliche Galerie" —
 * `galerie_rang`: eine Zahl heisst drin und bestimmt zugleich die Reihenfolge,
 * `null` heisst draussen. Zwei Spalten (`in_galerie` plus `sortierung`)
 * könnten sich widersprechen; eine kann es nicht.
 */

-- ---------------------------------------------------------------------------
-- 1. `referenz.slug`
-- ---------------------------------------------------------------------------

alter table referenz add column slug text;

/**
 * Das Format ist dasselbe wie bei `seite.pfad` — Kleinbuchstaben, Ziffern,
 * Bindestrich —, nur EIN Segment statt eines ganzen Pfades. Kein führender
 * und kein doppelter Bindestrich: beide ergäben Adressen, die sich beim
 * Kopieren still unterscheiden.
 */
alter table referenz add constraint referenz_slug_form check (
  slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

comment on column referenz.slug is
  'Der URL-Schlüssel unter /unternehmen/<bereich>/projekte/. EINMAL gesetzt und '
  'danach nicht dem Titel nachgeführt: eine Adresse, die sich mit dem Titel '
  'ändert, bricht jeden eingehenden Verweis (SEITENKARTE §2.2).';

/**
 * **Der Bestand bekommt einen Slug, bevor die Spalte Pflicht wird.**
 *
 * `unaccent` steht nicht zur Verfügung und wäre auch das falsche Werkzeug: im
 * Deutschen wird `ä` zu `ae`, nicht zu `a`. `translate` kann das nicht — es
 * bildet Zeichen auf Zeichen ab, und `ä → ae` sind zwei. Deshalb die vier
 * Ersetzungen von Hand, danach alles Übrige zu Bindestrichen und die Ränder
 * gestutzt.
 *
 * **Die Funktion bleibt im Schema und ist nicht nur für diese Migration da.**
 * Eine in `pg_temp` lebte nur in dieser einen Verbindung; der nächste Leser
 * fände den Ausdruck nirgends wieder. Und die Redaktion braucht denselben
 * Vorschlag beim Anlegen einer Referenz — zweimal abgeschrieben liefe er beim
 * ersten Sonderzeichen auseinander, und dann hätte dieselbe Überschrift im
 * Bestand einen anderen Slug als im Formular.
 */
/**
 * **Die GROSSEN Umlaute stehen hier, und das ist kein Übereifer.**
 *
 * Diese Datenbank läuft mit `datcollate = 'C'` — und in `C` senkt `lower()`
 * ausschliesslich ASCII. `lower('Ä')` ist `'Ä'`, nicht `'ä'`. Wer nur die
 * kleinen Umlaute ersetzt und sich auf `lower()` verlässt, verliert jeden
 * grossen: aus „Änderung der Öffnungszeiten" wird
 * `nderung-der-ffnungszeiten`, weil `[^a-z0-9]` die übrig gebliebenen
 * Zeichen wegwirft. Gemessen, nicht vermutet — der erste Probelauf gab für
 * „Grüße & Ärger" genau `gruesse-und-rger` zurück.
 *
 * Deshalb: erst BEIDE Schreibweisen ersetzen, dann senken. Die Reihenfolge
 * ist die Aussage.
 */
create or replace function app.slug_aus_titel(p_titel text) returns text
language sql immutable as $$
  select coalesce(nullif(btrim(regexp_replace(
           regexp_replace(
             lower(
               replace(replace(replace(replace(
               replace(replace(replace(replace(replace(p_titel,
                 'Ä', 'Ae'), 'Ö', 'Oe'), 'Ü', 'Ue'), 'ß', 'ss'), '&', ' und '),
                 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ẞ', 'ss')),
             '[^a-z0-9]+', '-', 'g'),
           '(^-+|-+$)', '', 'g'), '-'), ''), 'eintrag')
$$;

comment on function app.slug_aus_titel(text) is
  'Erzeugt einen URL-Schluessel aus einem deutschen Titel (0170). `immutable`, '
  'weil er nur von seiner Eingabe abhaengt — er darf deshalb in einem Index stehen. '
  'Die vier Umlaute und das Eszett werden ZWEISTELLIG ersetzt, wie im Deutschen '
  'ueblich; `translate` koennte das nicht.';

revoke all on function app.slug_aus_titel(text) from public;
grant execute on function app.slug_aus_titel(text) to cse_app, cse_job, cse_definer;

update referenz r set slug = app.slug_aus_titel(r.titel) where r.slug is null;

-- Doppelte je Mandant durchnummerieren — die erste behält ihren Slug.
with nummeriert as (
  select mandant_id, id, slug,
         row_number() over (partition by mandant_id, slug order by erstellt_am, id) as n
    from referenz
)
update referenz r
   set slug = r.slug || '-' || n.n::text
  from nummeriert n
 where n.mandant_id = r.mandant_id and n.id = r.id and n.n > 1;

alter table referenz alter column slug set not null;
alter table referenz add constraint referenz_slug_uk unique (mandant_id, slug);

grant update (slug) on referenz to cse_app;

-- ---------------------------------------------------------------------------
-- 2. `beitrag.slug`
-- ---------------------------------------------------------------------------

alter table beitrag add column slug text;

alter table beitrag add constraint beitrag_slug_form check (
  slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

comment on column beitrag.slug is
  'Der URL-Schlüssel unter /unternehmen/<bereich>/news/ und /beitraege/. '
  'Kanonisch nach SEITENKARTE §2.2: die Gruppenliste /news verweist hierher '
  'und setzt rel=canonical darauf.';

update beitrag b set slug = app.slug_aus_titel(b.titel) where b.slug is null;

with nummeriert as (
  select mandant_id, id, slug,
         row_number() over (partition by mandant_id, slug order by erstellt_am, id) as n
    from beitrag
)
update beitrag b
   set slug = b.slug || '-' || n.n::text
  from nummeriert n
 where n.mandant_id = b.mandant_id and n.id = b.id and n.n > 1;

alter table beitrag alter column slug set not null;
alter table beitrag add constraint beitrag_slug_uk unique (mandant_id, slug);

grant update (slug) on beitrag to cse_app;

-- ---------------------------------------------------------------------------
-- 3. Die kuratierte Galerie
-- ---------------------------------------------------------------------------

alter table medien add column galerie_rang integer;

alter table medien add constraint medien_galerie_rang_positiv check (
  galerie_rang is null or galerie_rang >= 0);

/**
 * **Ein Bild ohne Mandanten kann nicht in eine Gesellschaftsgalerie.**
 * `medien.mandant_id` ist `null`-fähig (die Gruppenbilder der Startseite), und
 * eine Galerie ohne Gesellschaft gibt es nicht. Ohne diesen Riegel stünde ein
 * Gruppenbild mit einem Rang in der Datenbank und in keiner Galerie — ein
 * Zustand, den niemand je auflöst, weil ihn niemand sieht.
 */
alter table medien add constraint medien_galerie_braucht_mandant check (
  galerie_rang is null or mandant_id is not null);

comment on column medien.galerie_rang is
  'PUB-04: eine Zahl heisst „in der oeffentlichen Galerie dieser Gesellschaft, '
  'an dieser Stelle", null heisst „nicht darin". EINE Spalte statt Flagge plus '
  'Sortierung, damit die beiden sich nicht widersprechen koennen.';

create index medien_galerie_idx on medien (mandant_id, galerie_rang)
  where galerie_rang is not null;

grant update (galerie_rang) on medien to cse_app;

-- ---------------------------------------------------------------------------
-- 4. Der Slug füllt sich selbst, wenn niemand einen mitgibt
-- ---------------------------------------------------------------------------

/**
 * **Warum ein Auslöser und nicht „die Aufrufer sollen daran denken".**
 *
 * Es gibt mehr als einen Weg, eine Referenz anzulegen: die Redaktion, der
 * Seed, und mit PR 27 der Auftrag mit Kundenfreigabe. Eine Pflichtspalte, die
 * jeder dieser Wege selbst füllen muss, wird beim dritten vergessen — und
 * zwar als `not null`-Verstoss mitten im Betrieb, nicht als Fehler beim
 * Schreiben des Codes. Der Seed hat es beim ersten Lauf nach dieser Migration
 * prompt vorgeführt.
 *
 * **Er füllt nur, er überschreibt nie.** Gibt die Redaktion einen Slug mit,
 * bleibt er stehen — auch wenn der Titel später ein anderer wird. Genau das
 * ist die Regel aus dem Spaltenkommentar: die Adresse folgt dem Titel NICHT,
 * weil sie sonst jeden eingehenden Verweis bricht.
 *
 * **Eindeutigkeit macht er nicht.** Zwei gleichnamige Referenzen derselben
 * Gesellschaft laufen in `referenz_slug_uk` und damit in eine klare
 * Fehlermeldung. Ein Auslöser, der still eine `-2` anhängte, verschöbe das
 * Problem auf die Adresse, die dann niemand erwartet hat.
 */
create function app.slug_fuellen() returns trigger
language plpgsql as $$
begin
  if new.slug is null then
    new.slug := app.slug_aus_titel(new.titel);
  end if;
  return new;
end;
$$;

comment on function app.slug_fuellen() is
  'BEFORE INSERT auf referenz und beitrag (0170): fuellt `slug` aus `titel`, '
  'wenn keiner mitgegeben wurde. Ueberschreibt nie einen vorhandenen.';

revoke all on function app.slug_fuellen() from public;

create trigger trg_referenz_slug before insert on referenz
  for each row execute function app.slug_fuellen();

create trigger trg_beitrag_slug before insert on beitrag
  for each row execute function app.slug_fuellen();
