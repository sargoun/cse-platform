-- ===========================================================================
-- 0393 — Logo, Avatar und Titelbild lassen sich setzen (V-100, D-622,
--        01-KERN §6.2, TEN-07, PUB-09, PUB-14, PRO-01, LEG-07)
-- ===========================================================================
-- **Der Befund.** 0200 legte fuenf Bildspalten an und gab `cse_app` bewusst
-- KEIN Schreibrecht darauf: „der Bildupload (O-12/O-13) bringt die
-- Pfadspalten mit". Der Upload kam nie, und die Spalten blieben in jeder
-- Datenbank NULL — eine Gesellschaft ohne eigenes Logo auf ihrer eigenen
-- Website.
--
-- **Was diese Migration bringt, und was nicht.**
--   1. Das Spaltenrecht auf die fuenf Pfade — mit dem Dienst, der sie
--      schreibt (`services/mandant/markenbild.ts`). `platzhalter_medien` und
--      `domain` bleiben ohne Recht: das eine ist eine Tatsache ueber die
--      Fotografie (O-13), das andere eine offene Frage (O-08).
--   2. Ein CHECK, dass ein Pfad nur in den EIGENEN Ordner des Mandanten und
--      nur in das Schluesselformat des Dienstes zeigt:
--      `<mandant_id>/<art>/<sha256>.<svg|png|jpg>`. Ohne ihn koennte ein
--      Schreibweg an der Stelle vorbei — eine Konsole, ein spaeterer Dienst —
--      das Logo einer Gesellschaft auf das Objekt einer anderen zeigen
--      lassen, und die Auslieferung gaebe es unter dem falschen Namen
--      heraus. RLS schuetzt die ZEILE, nicht den Inhalt einer Spalte.
--   3. Den Spaltenkommentar zu `rechnung_fuss` richtigstellen: seit V-099
--      wird die Fusszeile in den kanonischen Payload kopiert (cse.rechnung.v3);
--      0200 sagte noch „die Kopie ist noch nicht gebaut".
--
-- `--`-Kommentare und keine Backticks in einem Blockkommentar: dieselbe Regel
-- wie in 0392.
-- ===========================================================================

grant update (logo_hell_pfad, logo_dunkel_pfad, logo_druck_pfad, avatar_pfad, cover_pfad)
      on mandant_identitaet to cse_app;

alter table mandant_identitaet add constraint mi_bildpfad_eigen check (
      (logo_hell_pfad   is null or logo_hell_pfad
         ~ ('^' || mandant_id::text || '/logo_hell/[0-9a-f]{64}\.(svg|png|jpg)$'))
  and (logo_dunkel_pfad is null or logo_dunkel_pfad
         ~ ('^' || mandant_id::text || '/logo_dunkel/[0-9a-f]{64}\.(svg|png|jpg)$'))
  and (logo_druck_pfad  is null or logo_druck_pfad
         ~ ('^' || mandant_id::text || '/logo_druck/[0-9a-f]{64}\.(svg|png|jpg)$'))
  and (avatar_pfad      is null or avatar_pfad
         ~ ('^' || mandant_id::text || '/avatar/[0-9a-f]{64}\.(png|jpg)$'))
  and (cover_pfad       is null or cover_pfad
         ~ ('^' || mandant_id::text || '/cover/[0-9a-f]{64}\.(png|jpg)$')));

comment on constraint mi_bildpfad_eigen on mandant_identitaet is
  'V-100, D-622: ein Bildpfad zeigt nur in den eigenen Ordner des Mandanten im '
  'Behaelter marke, im Schluesselformat des Dienstes (Inhalt als Name). Avatar '
  'und Titelbild ohne SVG.';

comment on column mandant_identitaet.rechnung_fuss is
  'K-12: wird bei der Festschreibung in den kanonischen Payload KOPIERT '
  '(cse.rechnung.v3, V-099). Eine spaetere Aenderung wirkt auf keine '
  'festgeschriebene Rechnung.';
