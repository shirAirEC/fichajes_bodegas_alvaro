# App Links: Odoo móvil → APK

Sin SHA-256 reales + nueva build Play Store, Android 12+ abre Chrome.

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

## Nueva build Play Store

1. Confirmar SHA-256 en Vercel (y añadir Play App Signing cuando exista).
2. `cd frontend && npm run build:android`
3. Subir `versionCode` en `android/app/build.gradle` y generar AAB firmado.
4. Subir el AAB a Play Console (paso humano; no hay upload automático).

Probar con **release** (el debug usa `com.bodegasalvaro.fichajes.dev` y no verifica).
