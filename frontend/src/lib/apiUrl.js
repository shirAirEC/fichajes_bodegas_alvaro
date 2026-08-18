import { Capacitor } from '@capacitor/core';

/**
 * URL base del backend.
 *
 * Web (Vercel / Vite):
 *   '' → /api/* relativo al host actual.
 *   Vercel (vercel.json) reescribe a Railway prod o develop según hostname.
 *   Vite dev proxy reenvía a localhost:3001.
 *
 * Android nativo (APK empaquetada, sin server.url):
 *   El WebView sirve dist local con origin https://fichajes-bodegas-alvaro.vercel.app
 *   (capacitor hostname). Un fetch relativo /api NO llega a Vercel: Capacitor (o el
 *   service worker de la PWA) sirve index.html → JSON.parse → Unexpected token '<'.
 *   Hay que usar la API de Railway en absoluto.
 *
 * `npm run build:android` fija VITE_CAPACITOR y VITE_API_URL de producción
 * (ganan a .env.local de Vercel CLI, que apunta al Railway de pruebas).
 */
export const PRODUCTION_API = 'https://fichajesbodegasalvaro-production.up.railway.app';

function esHostLocal(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  } catch {
    return true;
  }
}

function limpiarBase(raw) {
  let url = String(raw || '').trim().replace(/^["']|["']$/g, '');
  url = url.replace(/\/+$/, '');
  // Evitar https://host/api + /api/login → /api/api/login
  url = url.replace(/\/api$/i, '');
  return url;
}

export function esNativo() {
  if (import.meta.env.VITE_CAPACITOR === 'true') return true;
  try {
    if (Capacitor.isNativePlatform()) return true;
  } catch {
    /* Capacitor no disponible */
  }
  return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true;
}

export function getApiUrl() {
  if (!esNativo()) return '';

  const url = limpiarBase(import.meta.env.VITE_API_URL || PRODUCTION_API);
  if (!url || esHostLocal(url)) return PRODUCTION_API;

  // Play / `vite build` (mode production): nunca el backend de pruebas.
  // `build:android:dev` usa --mode dev y sí puede apuntar a -developed.
  if (import.meta.env.MODE === 'production' && /developed/i.test(url)) {
    return PRODUCTION_API;
  }

  return url;
}

/** Concatena base + path sin dobles barras ni /api duplicado. */
export function apiUrl(path) {
  if (!path) path = '/';
  if (/^https?:\/\//i.test(path)) return path;
  const base = getApiUrl();
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!base) return p;
  return `${base}${p}`;
}

/**
 * Si la respuesta no es JSON (p.ej. HTML de Express/Capacitor/Vercel),
 * lanza un error claro en lugar de Unexpected token '<' en res.json().
 * No consume el body cuando Content-Type ya es JSON.
 */
export async function ensureJsonResponse(res) {
  if (res.status === 204) return res;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) return res;

  const text = await res.text();
  if (!text.trim()) return res;
  if (/^\s*[{[]/.test(text)) {
    return new Response(text, {
      status: res.status,
      statusText: res.statusText,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const html = /^\s*</.test(text);
  throw new Error(
    html
      ? `El servidor devolvió HTML (${res.status}) en lugar de JSON. La app no está hablando con la API.`
      : (text.slice(0, 180).trim() || `Error del servidor (${res.status})`)
  );
}

export async function parseJsonResponse(res) {
  const ensured = await ensureJsonResponse(res);
  const text = await ensured.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Respuesta JSON inválida (${res.status}).`);
  }
}
