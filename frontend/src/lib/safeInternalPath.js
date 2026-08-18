/** Ruta interna segura (evita open-redirect a otro origen). */
export function safeInternalPath(value) {
  if (!value || typeof value !== 'string') return '';
  const v = value.trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('://')) return '';
  return v;
}
