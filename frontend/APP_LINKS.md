# App Links + scheme nativo: Odoo móvil → APK

La APK debe **consumir** el intent (`@capacitor/app` → `appUrlOpen` + `getLaunchUrl`) y navegar a `path+query` (p.ej. `/auth/odoo-sso?token=…`). Si no, Capacitor 6 carga `appUrl` (Vercel `/`) y se pierde el token HMAC (~60s).

**Scheme `fichajes://` (preferido hoy):** no espera Digital Asset Links. Odoo móvil abre `fichajes://auth/odoo-sso?token=…` y Android lanza `com.bodegasalvaro.fichajes`. Si la APK no está instalada, Odoo muestra el portal **dentro de su WebView** (iframe); nunca como único resultado Chrome. Requiere AAB **versionCode 18+**.

Código: `frontend/src/lib/appUrlOpen.js` (registro en `main.jsx` antes del primer render + `useAppUrlOpen` en `App.jsx`). En web/PWA el plugin no se llama (`Capacitor.isNativePlatform()`). `OdooSsoRedirectPage` sigue haciendo fetch JSON in-app; solo hay que **llegar** a esa ruta con el token.

Residual: sin SHA-256 de **Play App Signing** + build en Play, Android 12+ puede abrir Chrome en lugar de la APK. El upload key ya está en `assetlinks.json`. **No** añadir un SHA de Play inventado.

## SHA-256 (`public/.well-known/assetlinks.json`)

Upload key (release) rellenado desde `frontend/android/bodegas-alvaro.keystore` alias `bodegas-alvaro`:

`0B:63:DA:05:0B:9D:6E:0E:09:0B:B9:99:00:93:A0:FA:80:5C:12:9A:A7:0A:1E:83:92:59:4D:5D:D5:90:03:5D`

El JSON de producción **solo** incluye fingerprints reales (un placeholder rompe Digital Asset Links).

`frontend/keystore/bodegas-alvaro.jks` (alias `fichajes` en `capacitor.config.json`) **no existe** en el repo. El signing real de Gradle es `android/app/build.gradle` → `../bodegas-alvaro.keystore`.

### Play App Signing (pendiente, imprescindible si Play re-firma)

No hay huella de **App signing key** documentada en el repo. Tras publicar, añade como segundo valor en `sha256_cert_fingerprints`:

1. Play Console → App integrity → App signing
2. Copia SHA-256 de **App signing key certificate** (formato `AA:BB:CC:...`)
3. Añade esa huella junto a la del upload key y redespliega el frontend a Vercel

Re-extraer upload key (pide contraseña del keystore; no la inventes):

```bash
cd frontend/android
keytool -list -v -keystore bodegas-alvaro.keystore -alias bodegas-alvaro
```

Tras deploy Vercel, debe ser JSON (no el login HTML):
https://fichajes-bodegas-alvaro.vercel.app/.well-known/assetlinks.json

## Probar sideload (APK release, no Play)

El debug usa `com.bodegasalvaro.fichajes.dev` y **no** verifica App Links. Sideload de **release** (mismo package que `assetlinks.json`). No hace falta token HMAC real para comprobar que la URL se consume: con `token=PRUEBA` debe abrirse `OdooSsoRedirectPage` (texto «Conectando con Odoo...» y luego error SSO), **no** el login (`/`).

```bash
cd frontend
npm install
npm run build:android
cd android
.\gradlew.bat assembleRelease
adb install -r app\build\outputs\apk\release\app-release.apk
```

Cold start (`singleTask` + proceso muerto):

```bash
adb shell am force-stop com.bodegasalvaro.fichajes
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://fichajes-bodegas-alvaro.vercel.app/auth/odoo-sso?token=PRUEBA" com.bodegasalvaro.fichajes
```

Warm start (app en segundo plano, `onNewIntent`):

```bash
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://fichajes-bodegas-alvaro.vercel.app/auth/odoo-sso?token=PRUEBA" com.bodegasalvaro.fichajes
```

`am start` con package explícito abre la APK aunque `autoVerify` aún falle (SHA de Play pendiente). PWA/Chrome: la misma URL en el navegador no debe romperse (el listener nativo no corre).

Scheme nativo (no depende de Play SHA):

```bash
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "fichajes://auth/odoo-sso?token=PRUEBA" com.bodegasalvaro.fichajes
```

## Nueva build Play Store

1. Confirmar SHA-256 en Vercel (y añadir Play App Signing cuando exista).
2. `cd frontend && npm run build:android`
3. Subir `versionCode` en `android/app/build.gradle` y generar AAB firmado.
4. Subir el AAB a Play Console (paso humano; no hay upload automático).

Probar con **release** (el debug usa `com.bodegasalvaro.fichajes.dev` y no verifica).
