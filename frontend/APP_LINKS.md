# App Links: Odoo móvil → APK

Sin SHA-256 reales + nueva build Play Store, Android 12+ abre Chrome.

## SHA-256 (`public/.well-known/assetlinks.json`)

El keystore pide contraseña; extraer a mano:

```bash
# Release real (android/app/build.gradle → storeFile ../bodegas-alvaro.keystore)
cd frontend/android
keytool -list -v -keystore bodegas-alvaro.keystore -alias bodegas-alvaro
```

Copia «Huella de certificado SHA256» (`AA:BB:CC:...`) a `REPLACE_ME_UPLOAD_KEY_SHA256_COLON_HEX`.

Play Console → App integrity → App signing → huella SHA-256 de **App signing key** → `REPLACE_ME_PLAY_APP_SIGNING_SHA256_COLON_HEX` (imprescindible si Play re-firma).

Tras deploy Vercel, debe ser JSON (no el login HTML):
https://fichajes-bodegas-alvaro.vercel.app/.well-known/assetlinks.json

## Nueva build Play Store

1. Rellenar las SHA-256 y desplegar frontend a Vercel.
2. `cd frontend && npm run build:android`
3. Subir `versionCode` en `android/app/build.gradle` y generar AAB firmado.
4. Subir el AAB a Play Console.

Probar con **release** (el debug usa `com.bodegasalvaro.fichajes.dev` y no verifica).
