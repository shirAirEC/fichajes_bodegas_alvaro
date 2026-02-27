# Despliegue: Frontend en Vercel + Backend en Railway

## Arquitectura

```
┌─────────────────────────────────┐     ┌──────────────────────────────────┐
│          VERCEL                 │     │           RAILWAY                │
│  React SPA (estático)           │────▶│  Node.js API + SQLite            │
│  https://fichajes.vercel.app    │     │  https://fichajes-api.railway.app │
│                                 │     │  + Volume /data (persistente)    │
└─────────────────────────────────┘     └──────────────────────────────────┘
         ▲                                          ▲
         │ Web (PC admin)                           │ API calls (/api/*)
         │                                          │
    💻 Admin                                   📱 App Android
  (navegador)                                (Capacitor + Railway URL)
```

---

## PASO 1 — Desplegar el backend en Railway

### Opción A: Script automático
```powershell
cd C:\Users\acruexp\Desktop\proyectos\fichajes_bodegas_alvaro
.\scripts\setup-railway.ps1
```

### Opción B: Manual paso a paso

```powershell
# 1. Login (abre el navegador)
railway login

# 2. Crear proyecto de la API
railway init --name "fichajes-bodegas-alvaro-api"

# 3. Generar JWT Secret seguro
$jwt = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Variables de entorno
railway variables --set "NODE_ENV=production"
railway variables --set "JWT_SECRET=$jwt"
railway variables --set "DB_PATH=/data/fichajes.db"
# ⚠️ FRONTEND_URL lo añadiremos en el paso 3 con la URL de Vercel

# 5. Desplegar
railway up
```

### ⚠️ Crear Volume para la base de datos (obligatorio)

1. Ve a **https://railway.app** → Tu proyecto
2. Haz clic en **"+ Add Service" → "Volume"**
3. **Mount Path**: `/data`
4. Conéctalo al servicio de la API

> Sin esto la base de datos se pierde en cada redeploy.

### Anotar la URL de Railway

Después del deploy, ejecuta:
```powershell
railway open
```
La URL será algo como: `https://fichajes-bodegas-alvaro-api.up.railway.app`

**Anótala — la necesitarás en el paso 2 y 3.**

---

## PASO 2 — Desplegar el frontend en Vercel

### Opción A: Vercel CLI (más rápido)

```powershell
# Instalar Vercel CLI si no lo tienes
npm install -g vercel

# Desde la carpeta del frontend
cd C:\Users\acruexp\Desktop\proyectos\fichajes_bodegas_alvaro\frontend

# Login y deploy
vercel login
vercel --prod
```

Durante el setup de Vercel CLI, cuando te pregunte:
- **Set up and deploy?** → Yes
- **Which scope?** → Tu cuenta
- **Link to existing project?** → No
- **Project name?** → `fichajes-bodegas-alvaro`
- **In which directory is your code located?** → `./` (ya estamos en frontend/)
- **Want to modify these settings?** → Yes
  - **Build Command**: `npm run build`
  - **Output Directory**: `dist`
  - **Install Command**: `npm install`

### Opción B: Vercel Dashboard (más visual)

1. Ve a **https://vercel.com** → New Project
2. Importa el repositorio Git
3. Configura:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Añade la variable de entorno:
   - `VITE_API_URL` = `https://TU-API.up.railway.app`
5. Haz clic en **Deploy**

### Anotar la URL de Vercel

La URL será algo como: `https://fichajes-bodegas-alvaro.vercel.app`

---

## PASO 3 — Conectar frontend (Vercel) ↔ backend (Railway)

### Configurar CORS en Railway (añadir URL de Vercel)

```powershell
railway variables --set "FRONTEND_URL=https://fichajes-bodegas-alvaro.vercel.app"
```

Si tienes un dominio personalizado en Vercel también:
```powershell
railway variables --set "FRONTEND_URL=https://fichajes-bodegas-alvaro.vercel.app,https://fichajes.bodegas-alvaro.com"
```

### Configurar la URL del backend en Vercel

En el dashboard de Vercel → Tu proyecto → Settings → Environment Variables:

| Nombre | Valor |
|--------|-------|
| `VITE_API_URL` | `https://TU-API.up.railway.app` |

Después de añadir la variable, haz un **Redeploy** para que surta efecto:
```powershell
cd frontend
vercel --prod
```

---

## Variables de entorno completas

### Railway (backend)

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `NODE_ENV` | `production` | Entorno |
| `JWT_SECRET` | *(generar con crypto)* | Secreto tokens |
| `DB_PATH` | `/data/fichajes.db` | Ruta SQLite (Volume) |
| `FRONTEND_URL` | `https://xxx.vercel.app` | CORS permitido |
| `PORT` | *(Railway lo asigna)* | Puerto automático |

### Vercel (frontend)

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `VITE_API_URL` | `https://xxx.up.railway.app` | URL del backend |

---

## Comandos útiles

```powershell
# Railway — Ver logs
railway logs

# Railway — Ver variables
railway variables

# Railway — Redeploy
railway up

# Vercel — Redeploy
cd frontend
vercel --prod

# Vercel — Ver logs
vercel logs
```

---

## Actualizaciones futuras

### Si cambias el backend:
```powershell
cd C:\Users\acruexp\Desktop\proyectos\fichajes_bodegas_alvaro
git add .
git commit -m "fix: descripcion del cambio"
railway up
```

### Si cambias el frontend:
```powershell
cd C:\Users\acruexp\Desktop\proyectos\fichajes_bodegas_alvaro\frontend
git add .
git commit -m "fix: descripcion del cambio"
vercel --prod
```

> Si usas GitHub conectado a Vercel/Railway, simplemente haz `git push` y ambos se redesplegarán automáticamente.

---

## Primer acceso y configuración inicial

1. Abre tu URL de Vercel en el navegador
2. Login con:
   - **Email**: `admin@bodegas-alvaro.com`
   - **Contraseña**: `admin123`
3. **Cambia la contraseña del admin** inmediatamente
4. Ve a **Configuración** → establece las coordenadas GPS de la bodega
5. Crea los empleados en **Empleados → Nuevo empleado**

---

## App Android — URL de producción

Edita `frontend/capacitor.config.json`:
```json
{
  "appId": "com.bodegasalvaro.fichajes",
  "appName": "Fichajes Bodegas Álvaro",
  "webDir": "dist",
  "server": {
    "androidScheme": "https",
    "url": "https://fichajes-bodegas-alvaro.vercel.app"
  }
}
```

> La app Android carga la interfaz desde Vercel y llama a la API en Railway,
> exactamente igual que el navegador web.

Después compila:
```powershell
cd frontend
npm run build:android
npx cap open android
```

---

## Dominio personalizado (opcional)

### Vercel
1. Dashboard → Tu proyecto → Settings → Domains
2. Añade `fichajes.bodegas-alvaro.com`
3. Crea el registro CNAME en tu DNS apuntando a `cname.vercel-dns.com`

### Railway
1. Dashboard → Tu servicio → Settings → Networking → Custom Domain
2. Añade `api.bodegas-alvaro.com`
3. Crea el registro CNAME apuntando a la URL que te dé Railway
4. Actualiza `FRONTEND_URL` con el nuevo dominio

