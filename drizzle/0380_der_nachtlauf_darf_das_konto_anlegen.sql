-- 0380 — der Nachtlauf darf das Konto auch anlegen (V-119, V-117, EMP-04/05).
--
-- ===========================================================================
-- Der Befund — und er ist einer in eigener Sache
-- ===========================================================================
--
-- `kontenRollover` (V-008) wurde gebaut, geprueft und ausgeliefert: ein
-- Nachtlauf, der jedem Beschaeftigten sein Stundenkonto des Monats oeffnet.
-- `tests/isolation/konten-rollover.test.ts` deckt ihn mit zwoelf Pruefungen
-- ab — und alle zwoelf rufen den DIENST `eroeffneKonto` als `cse_app`.
--
-- **Der Lauf selbst laeuft aber als `cse_job`.** Und `0060` sagt darueber
-- woertlich:
--
--     /** Der naechtliche Abgleich liest — und schreibt nichts (analog FIN-06). */
--     create policy t_job on stundenkonto for select to cse_job using (true);
--     grant select on stundenkonto to cse_job;
--
-- Kein `insert`, weder als Grant noch als Policy. Der Lauf haette bei seinem
-- ersten naechtlichen Versuch mit „permission denied for table stundenkonto"
-- abgebrochen — und zwar in einem Protokoll, das niemand liest. Genau der
-- Fehler, gegen den der Lauf gebaut wurde, nur eine Ebene tiefer.
--
-- **Dazu die zweite Haelfte:** `alsJobSitzung` setzt `app.readonly` auf `on`,
-- solange der Aufrufer nicht `{ nurLesen: false }` mitgibt. Jeder andere
-- schreibende Lauf im Baum tut das (`akquise`, `belegarchiv`,
-- `bewerberLoeschung`, `mahnlauf`); `kontenRollover` tat es nicht.
--
-- `urlaubskontenJahr` (V-117) traegt dieselbe Bauart und denselben Fehler —
-- er entsteht in derselben Aenderung und wird hier gleich mitbehoben.
--
-- ===========================================================================
-- Warum die Policy NICHT `using (true)` traegt
-- ===========================================================================
--
-- Die beiden `t_job`-Lesepolicies duerfen `using (true)` sein: ein Lauf muss
-- ueber Mandantengrenzen hinweg FINDEN, was faellig ist, und `alsJobRolle`
-- ist genau dafuer da. Geschrieben wird danach je Mandant in
-- `alsJobSitzung`, mit gebundenem `app.aktiver_mandant()`.
--
-- Die Schreibpolicy haengt deshalb an genau diesem Mandanten. Ein
-- `with check (true)` machte den Lauf zu dem einen Weg, auf dem eine Zeile
-- ohne Mandantenbindung entstehen kann — und `mandant_id` ist der Schluessel,
-- an dem jede spaetere Abfrage sie wiederfindet (Invariante 3).
--
-- **Und `not app.ist_readonly()` steht mit drin**, obwohl der Lauf es selbst
-- setzt. Das ist die Kopplung, die den zweiten Teil des Befundes unmoeglich
-- macht: ein Lauf, der vergisst, `nurLesen: false` mitzugeben, schreibt dann
-- nicht etwa doch — er scheitert sichtbar an der Policy statt still nichts zu
-- tun.

create policy j_konto_anlegen on stundenkonto for insert to cse_job
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly());

comment on policy j_konto_anlegen on stundenkonto is
  'V-119, EMP-04. `job:konten_rollover` oeffnet das Konto des Monats. NUR '
  'anlegen: gesperrt wird von einem Menschen mit zeit.konto_abschliessen, und '
  'gebucht wird ueber die Bewegungen. An app.aktiver_mandant() gebunden — der '
  'Lauf findet ueber alle Gesellschaften und schreibt je eine.';

grant insert on stundenkonto to cse_job;

create policy j_urlaubskonto_anlegen on urlaubskonto for insert to cse_job
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly());

comment on policy j_urlaubskonto_anlegen on urlaubskonto is
  'V-119, V-117, EMP-05. `job:urlaubskonten_jahr` oeffnet das Konto des '
  'Jahres — mit anspruch_tage = 0, was „nicht hinterlegt" heisst (O-18). Den '
  'Anspruch traegt ein Mensch nach; dieser Lauf erfindet keinen.';

grant insert on urlaubskonto to cse_job;

-- ---------------------------------------------------------------------------
-- Die alten Lesekommentare stimmen nicht mehr
-- ---------------------------------------------------------------------------
--
-- `0060` und `0061` sagen an ihren `t_job`-Policies „liest — und schreibt
-- nichts". Das war richtig und ist es seit V-008 nicht mehr. Ein Kommentar,
-- der das Gegenteil dessen behauptet, was danebensteht, ist schlimmer als
-- keiner: er beruhigt beim Lesen genau an der Stelle, an der man nachsehen
-- muesste.

comment on policy t_job on stundenkonto is
  'Der Lauf LIEST hier ueber alle Gesellschaften — er findet, was faellig ist. '
  'Geschrieben wird ueber j_konto_anlegen, je Mandant und nur anlegend.';

comment on policy t_job on urlaubskonto is
  'Der Lauf LIEST hier ueber alle Gesellschaften. Geschrieben wird ueber '
  'j_urlaubskonto_anlegen, je Mandant und nur anlegend.';
