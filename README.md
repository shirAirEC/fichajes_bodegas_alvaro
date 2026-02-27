# Sistema de Fichajes — Bodegas Álvaro

Sistema de control de presencia para empleados de Bodegas Álvaro. Inspirado en el módulo de asistencia de OrangeHRM, construido con tecnología moderna y fácil de desplegar.

## Características

- **Login seguro** con JWT (12h de sesión)
- **Fichar entrada/salida** con un solo clic — el sistema detecta automáticamente el tipo
- **Reloj en tiempo real** en la pantalla de fichaje
- **Historial personal** con filtros por fecha
- **Panel de administración** con vista en tiempo real de quién está dentro
- **Gestión de empleados** (crear, editar, activar/desactivar)
- **Exportar CSV** de fichajes con filtros
- **Base de datos SQLite** — sin configuración de servidor de BD
- **Diseño corporativo** con los colores y tipografía de Bodegas Álvaro

## Requisitos

### Para desarrollo local
- Node.js 18+
- npm

### Para producción (servidor)
- Docker
- Docker Compose

---

## Desarrollo local

### 1. Backend

```bash
cd backend
cp .env.example .env    # Editar el .env si quieres cambiar el secreto JWT
npm install
npm run dev             # Arranca en http://localhost:3001
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev             # Arranca en http://localhost:5173
```

El frontend en modo dev hace proxy automático de `/api/*` → `localhost:3001`.

**Credenciales iniciales:**
- Email: `admin@bodegas-alvaro.com`
- Contraseña: `admin123`

> ⚠️ **Cambia la contraseña del admin inmediatamente** desde el panel de administración.

---

## Despliegue en servidor con Docker

### Paso a paso

**1. Copia el proyecto al servidor:**
```bash
scp -r fichajes_bodegas_alvaro/ usuario@tu-servidor:/opt/fichajes/
```

**2. Configura el entorno:**
```bash
cd /opt/fichajes
cp .env.example .env
```

Edita `.env` y **cambia** `JWT_SECRET` por un valor seguro:
```bash
# Genera un secreto seguro:
openssl rand -hex 32
```

**3. Construye y arranca:**
```bash
docker compose up -d --build
```

La app estará disponible en `http://tu-servidor` (puerto 80 por defecto).

Para usar otro puerto, edita `.env`:
```
PORT=8080
```

### Comandos útiles

```bash
# Ver logs
docker compose logs -f

# Parar la app
docker compose down

# Actualizar tras cambios de código
docker compose up -d --build

# Backup de la base de datos
docker cp fichajes_backend:/app/data/fichajes.db ./backup_$(date +%Y%m%d).db
```

---

## Estructura del proyecto

```
fichajes_bodegas_alvaro/
├── backend/
│   ├── src/
│   │   ├── db/database.js       # SQLite + inicialización
│   │   ├── middleware/auth.js   # JWT middleware
│   │   ├── routes/
│   │   │   ├── auth.js          # Login, /me, cambiar contraseña
│   │   │   ├── fichajes.js      # Fichar, historial, admin
│   │   │   └── empleados.js     # CRUD empleados
│   │   └── index.js             # Servidor Express
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── hooks/useAuth.js     # Contexto de autenticación
│   │   ├── components/          # Navbar, LoadingScreen
│   │   └── pages/
│   │       ├── LoginPage        # Página de login
│   │       ├── DashboardEmpleado
│   │       │   ├── FicharPage   # Pantalla principal de fichaje
│   │       │   └── HistorialPage
│   │       └── DashboardAdmin
│   │           ├── AdminPanelPage    # Resumen tiempo real
│   │           ├── AdminFichajesPage # Todos los fichajes + exportar CSV
│   │           └── AdminEmpleadosPage
│   ├── Dockerfile
│   ├── nginx.conf
│   └── vite.config.js
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## API

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Iniciar sesión | — |
| GET | `/api/auth/me` | Datos del usuario actual | Empleado |
| PUT | `/api/auth/cambiar-password` | Cambiar contraseña | Empleado |
| POST | `/api/fichajes/fichar` | Registrar entrada/salida | Empleado |
| GET | `/api/fichajes/estado` | Estado actual (dentro/fuera) | Empleado |
| GET | `/api/fichajes/mis-fichajes` | Historial propio | Empleado |
| GET | `/api/fichajes/resumen-hoy` | Resumen del día actual | Empleado |
| GET | `/api/fichajes/admin/todos` | Todos los fichajes | Admin |
| GET | `/api/fichajes/admin/resumen` | Resumen todos los empleados | Admin |
| GET | `/api/fichajes/admin/exportar` | Exportar CSV | Admin |
| DELETE | `/api/fichajes/admin/:id` | Eliminar fichaje | Admin |
| GET | `/api/empleados` | Lista de empleados | Admin |
| POST | `/api/empleados` | Crear empleado | Admin |
| PUT | `/api/empleados/:id` | Actualizar empleado | Admin |
| DELETE | `/api/empleados/:id` | Desactivar empleado | Admin |

---

## Personalización visual

Los colores corporativos están definidos en `frontend/src/index.css`:

```css
--color-primary: #8B2635;    /* Burdeos */
--color-secondary: #c9a961;  /* Dorado */
```

Para cambiar el logo, reemplaza `frontend/public/logo.svg`.
