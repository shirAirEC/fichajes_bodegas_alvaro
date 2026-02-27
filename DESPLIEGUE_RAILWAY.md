# Despliegue en Railway — Guía completa

## Requisitos previos

- [Railway CLI](https://docs.railway.app/develop/cli) instalado (`npm install -g @railway/cli`)
- Cuenta en [Railway.app](https://railway.app) (el plan gratuito Hobby soporta esto)

---

## Opción A: Deploy directo (más rápido) ⭐ Recomendado

### Paso 1 — Abrir PowerShell en la carpeta del proyecto

```
cd C:\Users\acruexp\Desktop\proyectos\fichajes_bodegas_alvaro
```

### Paso 2 — Ejecutar el script de configuración

```powershell
.\scripts\setup-railway.ps1
```

Este script hace todo automáticamente:
- Login a Railway (abre el navegador)
- Crea el proyecto
- Configura variables de entorno con JWT Secret seguro
- Despliega la app

---

## Opción B: Paso a paso manual

### 1. Login en Railway

```powershell
railway login
```
Se abrirá el navegador para autenticarte con tu cuenta de Railway.

### 2. Crear el proyecto

```powershell
railway init --name "fichajes-bodegas-alvaro"
```

### 3. Generar y configurar variables de entorno

```powershell
# Genera el JWT Secret seguro
$jwt = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Configura las variables
railway variables --set "NODE_ENV=production"
railway variables --set "JWT_SECRET=$jwt"
railway variables --set "DB_PATH=/data/fichajes.db"
```

### 4. Crear el Volume para la base de datos ⚠️ OBLIGATORIO

La base de datos SQLite necesita almacenamiento persistente.

1. Ve a https://railway.app → Tu proyecto
2. Haz clic en **"+ Add Service"** → **"Volume"**
3. Configura:
   - **Name**: `fichajes-data`
   - **Mount Path**: `/data`
4. Conéctalo al servicio de la app

### 5. Desplegar

```powershell
railway up
```

Railway detectará automáticamente la configuración con `railway.json` y `nixpacks.toml` e hará el build completo.

### 6. Ver la URL de tu app

```powershell
railway open
```

---

## Variables de entorno en Railway

| Variable | Descripción | Valor en Railway |
|----------|-------------|------------------|
| `NODE_ENV` | Entorno de ejecución | `production` |
| `JWT_SECRET` | Secreto para tokens JWT | Generar con `openssl rand -hex 32` |
| `DB_PATH` | Ruta de la base de datos | `/data/fichajes.db` |
| `PORT` | Puerto del servidor | *(Railway lo asigna automáticamente)* |

---

## Comandos útiles

```powershell
# Ver logs en tiempo real
railway logs

# Ver estado del deploy
railway status

# Abrir la app en el navegador
railway open

# Re-desplegar tras cambios
.\scripts\deploy.ps1

# Abrir el shell del servidor (para diagnóstico)
railway shell
```

---

## Actualizar la app después de cambios

```powershell
cd C:\Users\acruexp\Desktop\proyectos\fichajes_bodegas_alvaro
.\scripts\deploy.ps1
```

O manualmente:
```powershell
git add .
git commit -m "descripcion del cambio"
railway up
```

---

## Configurar dominio personalizado (opcional)

En Railway Dashboard → Settings → Domains:
1. Haz clic en **"+ Custom Domain"**
2. Introduce tu dominio (ej: `fichajes.bodegas-alvaro.com`)
3. Añade el registro CNAME en tu DNS:
   - **Nombre**: `fichajes`
   - **Valor**: El dominio que te dé Railway (ej: `xxxxx.up.railway.app`)
4. Railway gestiona el certificado SSL automáticamente

---

## Primer acceso y configuración inicial

1. Accede a tu URL de Railway (ej: `https://fichajes-bodegas-alvaro.up.railway.app`)
2. Inicia sesión con:
   - **Email**: `admin@bodegas-alvaro.com`
   - **Contraseña**: `admin123`
3. **Cambia la contraseña del admin** (Navbar → icono usuario → Cambiar contraseña)
4. Ve a **Configuración** → Establece las coordenadas GPS de la bodega
5. Crea los empleados en **Empleados → Nuevo empleado**

---

## App Android (después del deploy)

Una vez que la app esté desplegada en Railway, configura la URL en `frontend/capacitor.config.json`:

```json
{
  "appId": "com.bodegasalvaro.fichajes",
  "appName": "Fichajes Bodegas Álvaro",
  "webDir": "dist",
  "server": {
    "androidScheme": "https",
    "url": "https://TU-APP.up.railway.app",
    "cleartext": false
  }
}
```

Luego compila la app Android:
```powershell
cd frontend
npm run build:android
npx cap open android
```

---

## Arquitectura en Railway

```
┌─────────────────────────────────────────┐
│           Railway Service               │
│                                         │
│  Node.js (Express)                      │
│  ├── /api/auth      → Auth JWT          │
│  ├── /api/fichajes  → Fichajes          │
│  ├── /api/empleados → Empleados         │
│  ├── /api/saldos    → Saldos            │
│  ├── /api/config    → Configuración     │
│  └── /*             → React SPA        │
│                                         │
│  Railway Volume (/data/fichajes.db)     │
│  → Base de datos SQLite persistente     │
└─────────────────────────────────────────┘
         │
         ├── 💻 Admin (navegador web PC)
         └── 📱 Empleados (app Android)
```

---

## Solución de problemas

**Error "Module not found" al compilar**
```powershell
railway shell
cd /app && npm run build
```

**La base de datos se resetea en cada deploy**
- Verifica que el Volume está montado en `/data`
- Comprueba `DB_PATH=/data/fichajes.db` en las variables de entorno

**La app no arranca**
```powershell
railway logs --tail 50
```

**El build falla**
- Railway usa Node.js 20 por defecto (configurado en `nixpacks.toml`)
- Verifica que `nixpacks.toml` y `railway.json` están en la raíz del repo
