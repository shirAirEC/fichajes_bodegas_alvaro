const admin = require('firebase-admin');

let messaging = null;

function initFirebase() {
  if (admin.apps.length > 0) return;
  try {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!sa) {
      console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT no configurado. Push notifications desactivadas.');
      return;
    }
    const serviceAccount = JSON.parse(sa);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    messaging = admin.messaging();
    console.log('✅ Firebase Admin SDK inicializado.');
  } catch (err) {
    console.error('❌ Error inicializando Firebase:', err.message);
  }
}

async function enviarPush(token, titulo, cuerpo, datos = {}) {
  if (!messaging) return false;
  try {
    await messaging.send({
      token,
      notification: { title: titulo, body: cuerpo },
      data: datos,
      android: {
        priority: 'high',
        notification: {
          channelId: 'avisos_v4',
          sound: 'default',
          defaultSound: true,
          notificationPriority: 'PRIORITY_HIGH',
          defaultVibrateTimings: true
        }
      }
    });
    return true;
  } catch (err) {
    console.error('Error enviando push:', err.message);
    return false;
  }
}

async function enviarPushMultiple(tokens, titulo, cuerpo, datos = {}) {
  if (!messaging || !tokens.length) return;
  try {
    await messaging.sendEachForMulticast({
      tokens,
      notification: { title: titulo, body: cuerpo },
      data: datos,
      android: {
        priority: 'high',
        notification: {
          channelId: 'avisos_v4',
          sound: 'default',
          defaultSound: true,
          notificationPriority: 'PRIORITY_HIGH',
          defaultVibrateTimings: true
        }
      }
    });
  } catch (err) {
    console.error('Error enviando push múltiple:', err.message);
  }
}

module.exports = { initFirebase, enviarPush, enviarPushMultiple };
