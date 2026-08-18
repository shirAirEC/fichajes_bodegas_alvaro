import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { initNativeAppUrlOpen, subscribeAppUrl } from '../lib/appUrlOpen';

/**
 * Navega in-app al path+query del App Link (p.ej. /auth/odoo-sso?token=…).
 * El listener nativo se registra en initNativeAppUrlOpen (main.jsx) para
 * no perder el token HMAC (~60s) si el evento llega antes de React.
 */
export function useAppUrlOpen() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    initNativeAppUrlOpen();
    return subscribeAppUrl((dest) => {
      navigate(dest, { replace: true });
    });
  }, [navigate]);
}
