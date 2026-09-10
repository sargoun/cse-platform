// FIXTURE — must FAIL `tailwind-farbe` DESPITE the CSS block above it.
// Der Ausnahmefall darf nur die DEKLARATION treffen, nicht die Klasse
// zwei Zeilen weiter — sonst versteckt sich jede falsche Farbe hinter
// einem `<style>`.
export function Fixtur() {
  return (
    <article>
      <style>{`
        .blatt { border-bottom: 1px solid #ddd; text-align: left; }
      `}</style>
      <p className="text-gibtesnicht">Falsche Farbe</p>
    </article>
  );
}
