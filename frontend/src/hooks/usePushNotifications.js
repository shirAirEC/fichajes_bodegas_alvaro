import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';

export function usePushNotifications(authFetch) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    async function registrar() {
      try {
        const permiso = await PushNotifications.requestPermissions();
        if (permiso.receive !== 'granted') return;

        await PushNotifications.register();

        // Crear canal de notificaciones con máxima prioridad
        // IMPORTANTE: Android congela la config del canal una vez creado.
        // Si se cambia el ID hay que actualizar también AndroidManifest y firebase.js
        await LocalNotifications.createChannel({
          id: 'avisos_v2',
          name: 'Fichajes Bodegas Álvaro',
          description: 'Avisos y notificaciones urgentes de la aplicación',
          importance: 5,        // IMPORTANCE_MAX → banner + sonido máximo + vibración fuerte
          visibility: 1,        // VISIBILITY_PUBLIC
          sound: 'default',
          vibration: true,
          lights: true,
          lightColor: '#8B2635'
        });

        // Registrar token FCM en el backend
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

        // App en PRIMER PLANO: mostrar como notificación local con diseño
        PushNotifications.addListener('pushNotificationReceived', async (notification) => {
          try {
            await LocalNotifications.schedule({
              notifications: [{
                id: Math.floor(Math.random() * 100000),
                title: notification.title || 'Fichajes Bodegas Álvaro',
                body: notification.body || '',
                smallIcon: 'ic_stat_notification',
                channelId: 'avisos_v2',
                iconColor: '#8B2635',
                extra: notification.data || {},
                autoCancel: true
              }]
            });
          } catch (err) {
            console.error('Error mostrando notificación local:', err);
          }
        });

        // Usuario toca la notificación push (app en background/cerrada)
        PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
          const url = notification?.data?.url;
          if (url) {
            navigate(url);
          } else {
            navigate('/plan');
          }
        });

        // Usuario toca la notificación local (app en primer plano)
        LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
          const url = notification?.extra?.url;
          if (url) {
            navigate(url);
          } else {
            navigate('/plan');
          }
        });

      } catch (err) {
        console.error('Error inicializando push notifications:', err);
      }
    }

    registrar();

    return () => {
      PushNotifications.removeAllListeners();
      LocalNotifications.removeAllListeners();
    };
  }, [authFetch, navigate]);
}
