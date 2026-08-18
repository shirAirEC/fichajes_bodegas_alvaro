import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/** Host de App Links (mismo hostname que Capacitor `server.hostname`). */
const APP_LINK_HOST = 'fichajes-bodegas-alvaro.vercel.app';
/** Scheme nativo: no depende de Digital Asset Links / SHA de Play. */
const CUSTOM_SCHEME = 'fichajes';

let started = false;
let lastDest = '';
const subscribers = new Set();

function destFromHttps(parsed) {
  const dest = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if ((!parsed.pathname || parsed.pathname === '/') && !parsed.search && !parsed.hash) {
    return null;
  }
  return dest;
}

/**
 * Convierte un App Link https://… o `fichajes://auth/odoo-sso?token=…`
 * en path+query+hash interno. Ignora otros hosts/schemes.
 */
export function pathFromAppUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl);
    const proto = (parsed.protocol || '').replace(/:$/, '').toLowerCase();
    if (proto === CUSTOM_SCHEME) {
      // fichajes://auth/odoo-sso?token= → host=auth, path=/odoo-sso
      // fichajes:///auth/odoo-sso?token= → host='', path=/auth/odoo-sso
      let path = parsed.pathname || '';
      if (parsed.hostname) {
        path = `/${parsed.hostname}${path === '/' ? '' : path}`;
      }
      if (!path.startsWith('/')) path = `/${path}`;
      const dest = `${path}${parsed.search}${parsed.hash}`;
      if (!dest || dest === '/') return null;
      return dest;
    }
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname.toLowerCase() !== APP_LINK_HOST) return null;
    return destFromHttps(parsed);
  } catch {
    return null;
  }
}

export function subscribeAppUrl(cb) {
  subscribers.add(cb);
  if (lastDest) cb(lastDest);
  return () => subscribers.delete(cb);
}

function applyAppUrl(rawUrl) {
  const dest = pathFromAppUrl(rawUrl);
  if (!dest || dest === lastDest) return;
  lastDest = dest;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== dest) {
    // Cold start: BrowserRouter aún no ha montado y leerá esta location.
    window.history.replaceState(null, '', dest);
  }
  subscribers.forEach((cb) => {
    try {
      cb(dest);
    } catch (err) {
      console.error('[appUrlOpen] subscriber', err);
    }
  });
}

/**
 * Cold start: getLaunchUrl (el evento puede haberse emitido antes del JS).
 * Warm start (singleTask): listener appUrlOpen / onNewIntent.
 * En web/PWA no hace nada (Capacitor.isNativePlatform() === false).
 */
export async function initNativeAppUrlOpen() {
  if (!Capacitor.isNativePlatform() || started) return;
  started = true;
  try {
    await App.addListener('appUrlOpen', (event) => {
      applyAppUrl(event?.url);
    });
    const launch = await App.getLaunchUrl();
    if (launch?.url) applyAppUrl(launch.url);
  } catch (err) {
    console.error('[appUrlOpen]', err);
  }
}
