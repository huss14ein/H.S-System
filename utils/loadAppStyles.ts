/** Loads the full Tailwind bundle (index.css) once — only for the authenticated app shell. */
let loadPromise: Promise<void> | null = null;

export function loadAppStyles(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = import('../index.css').then(() => undefined);
  return loadPromise;
}
