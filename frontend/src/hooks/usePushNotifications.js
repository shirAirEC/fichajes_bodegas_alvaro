import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

export function usePushNotifications(authFetch) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    async function registrar() {
      try {
        const permiso = await PushNotifications.requestPermissions();
        if (permiso.receive !== 'granted') return;

        await PushNotifications.register();

        // Cuando FCM devuelve el token, lo enviamos al backend
        PushNotifications.addListener('registration', async ({ value: token }) => {
          try {
            await authFetch('/api/avisos/token', {
              method: 'POST',
              body: JSON.stringify({ token, plataforma: 'android' })
            });
          } catch (err) {
            console.error('Error registrando token FCM:', err);
          }
        });

        PushNotifications.addListener('registrationError', err => {
          console.error('Error registro push:', err);
        });

        // Notificación recibida en primer plano: no hacer nada especial
        PushNotifications.addListener('pushNotificationReceived', () => {});

        // Usuario toca la notificación → navegar directamente a Planificación
        PushNotifications.addListener('pushNotificationActionPerformed', () => {
          navigate('/plan');
        });
      } catch (err) {
        console.error('Error inicializando push notifications:', err);
      }
    }

    registrar();

    return () => {
      PushNotifications.removeAllListeners();
    };
  }, [authFetch, navigate]);
}
