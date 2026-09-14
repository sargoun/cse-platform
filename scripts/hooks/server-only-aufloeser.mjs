/** Der Aufloeser hinter `server-only.mjs` — laeuft im Loader-Thread von Node. */
const LEER = new URL('./leer.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: LEER, shortCircuit: true };
  return next(specifier, context);
}
