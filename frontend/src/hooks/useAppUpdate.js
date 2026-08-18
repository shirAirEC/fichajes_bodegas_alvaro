import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { apiUrl, parseJsonResponse } from '../lib/apiUrl';

/**
 * Compara dos versiones semver simplificadas ("1.5" > "1.4" → true).
 */
function versionMenor(instalada, minima) {
  const partes = v => String(v).split('.').map(n => parseInt(n) || 0);
  const [ia, ib] = partes(instalada);
  const [ma, mb] = partes(minima);
  if (ia !== ma) return ia < ma;
  return ib < mb;
}

/**
 * Solo activo en la app nativa Android (Capacitor).
 * Compara la versión instalada (VITE_APP_VERSION del build) con
 * la versión mínima requerida que devuelve el backend.
 *
 * @returns {{ necesitaActualizar: boolean, versionMinima: string }}
 */
export function useAppUpdate() {
  const [necesitaActualizar, setNecesitaActualizar] = useState(false);
  const [versionMinima, setVersionMinima] = useState('');

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const versionInstalada = import.meta.env.VITE_APP_VERSION || '1.0';

    fetch(apiUrl('/api/config/version'))
      .then(r => parseJsonResponse(r))
      .then(data => {
        const minima = data.version_minima || '1.0';
        setVersionMinima(minima);
        if (versionMenor(versionInstalada, minima)) {
          setNecesitaActualizar(true);
        }
      })
      .catch(() => {});
  }, []);

  return { necesitaActualizar, versionMinima };
}
