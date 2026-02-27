# Guía para publicar la app en Google Play Store

## Prerrequisitos

1. **Android Studio** instalado: https://developer.android.com/studio
2. **Java JDK 17+** instalado
3. **Node.js 18+**
4. **Cuenta de Google Play Console** ($25 pago único): https://play.google.com/console

---

## Paso 1: Instalar dependencias y generar el proyecto Android

```bash
cd frontend
npm install

# Compilar el frontend
npm run build

# Inicializar el proyecto Android con Capacitor
npx cap add android

# Sincronizar los archivos web al proyecto Android
npx cap sync android
```

Esto generará la carpeta `frontend/android/` con el proyecto nativo de Android.

---

## Paso 2: Configurar la URL del servidor de producción

Edita `frontend/capacitor.config.json` y añade la URL de tu servidor:

```json
{
  "appId": "com.bodegasalvaro.fichajes",
  "appName": "Fichajes Bodegas Álvaro",
  "webDir": "dist",
  "server": {
    "androidScheme": "https",
    "url": "https://TU_DOMINIO_O_IP/api",
    "cleartext": true
  }
}
```

> ℹ️ Si tu servidor usa HTTP (no HTTPS), debes añadir `"cleartext": true`.
> En producción se recomienda HTTPS con certificado SSL.

---

## Paso 3: Abrir en Android Studio

```bash
cd frontend
npx cap open android
```

Esto abre el proyecto en Android Studio.

---

## Paso 4: Crear el keystore de firma

El keystore es necesario para publicar en la Play Store. **Guárdalo en lugar seguro.**

```bash
# Dentro de frontend/android/
mkdir -p keystore
keytool -genkey -v \
  -keystore keystore/bodegas-alvaro.jks \
  -alias fichajes \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

---

## Paso 5: Configurar la firma en Android Studio

En Android Studio, ve a:
**Build → Generate Signed Bundle / APK**

1. Selecciona **Android App Bundle (.aab)** (recomendado para Play Store)
2. Selecciona el keystore creado en el paso 4
3. Compila en modo **Release**

El archivo `.aab` se genera en: `android/app/release/app-release.aab`

---

## Paso 6: Publicar en Google Play Console

1. Accede a https://play.google.com/console
2. Crea una nueva app → "Fichajes Bodegas Álvaro"
3. Completa la información de la app:
   - Descripción: "Sistema de control de presencia para Bodegas Álvaro"
   - Categoría: "Empresas"
   - Capturas de pantalla (mínimo 2)
   - Icono de la app (512x512 px)
4. Sube el `.aab` en **Producción → Nueva versión**
5. Completa la revisión de contenido
6. **Importante:** En "Permisos", declara el uso de ubicación y su motivo

---

## Permisos requeridos en la app

La app solicita los siguientes permisos:
- `ACCESS_FINE_LOCATION` — Para verificar que el empleado está en la bodega
- `ACCESS_COARSE_LOCATION` — Ubicación aproximada (fallback)
- `INTERNET` — Para comunicarse con el servidor

---

## Distribución interna (alternativa a Play Store)

Si no quieres publicar en la Play Store, puedes usar **Google Play Internal Testing** o distribuir el APK directamente:

```bash
# Generar APK (en lugar de .aab)
# En Android Studio: Build → Build Bundle(s) / APK(s) → Build APK(s)
```

Luego comparte el APK por email/WhatsApp con los empleados y diles que activen
"Instalar apps de fuentes desconocidas" en su teléfono.

Esta opción es más rápida y no requiere la revisión de Google.

---

## Actualizar la app

Cada vez que modifiques el frontend:

```bash
cd frontend
npm run build:android   # build + cap sync
```

Luego en Android Studio, incrementa el `versionCode` en `android/app/build.gradle`
y genera un nuevo `.aab` para subir a la Play Store.

---

## Arquitectura multiplataforma

```
┌─────────────────────────────────────┐
│           SERVIDOR (Docker)          │
│  ┌──────────────┐ ┌───────────────┐ │
│  │   Backend    │ │   Frontend    │ │
│  │  Node.js API │ │  React/Nginx  │ │
│  │  Puerto 3001 │ │   Puerto 80   │ │
│  └──────────────┘ └───────────────┘ │
└─────────────────────────────────────┘
          ▲                    ▲
          │ API                │ Web
          │                    │
┌─────────────────┐   ┌─────────────────┐
│  App Android    │   │   Navegador PC  │
│  (Capacitor)    │   │   Admin/Gestora │
│  Empleados      │   │                 │
└─────────────────┘   └─────────────────┘
```

- **Empleados**: solo usan la app Android (dentro de la bodega — geolocalización)
- **Administradora**: usa el navegador web desde el PC (acceso completo)
- **Misma base de código** para web y Android
