const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway PostgreSQL interno no necesita SSL; conexiones externas sí
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS empleados (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      apellidos TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'empleado' CHECK(rol IN ('empleado', 'admin')),
      departamento TEXT DEFAULT '',
      activo INTEGER NOT NULL DEFAULT 1,
      sin_restriccion_ip INTEGER NOT NULL DEFAULT 0,
      fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Migración: añadir columna sin_restriccion_ip si no existe
  await pool.query(`
    ALTER TABLE empleados ADD COLUMN IF NOT EXISTS sin_restriccion_ip INTEGER NOT NULL DEFAULT 0
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fichajes (
      id SERIAL PRIMARY KEY,
      empleado_id INTEGER NOT NULL REFERENCES empleados(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('entrada', 'salida')),
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      latitud DOUBLE PRECISION DEFAULT NULL,
      longitud DOUBLE PRECISION DEFAULT NULL,
      precision_metros DOUBLE PRECISION DEFAULT NULL,
      notas TEXT DEFAULT ''
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS saldos (
      id SERIAL PRIMARY KEY,
      empleado_id INTEGER NOT NULL REFERENCES empleados(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('vacaciones', 'horas_extra', 'permiso_especial', 'baja_medica')),
      cantidad DOUBLE PRECISION NOT NULL,
      concepto TEXT NOT NULL,
      admin_id INTEGER NOT NULL REFERENCES empleados(id),
      fecha_referencia DATE DEFAULT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS configuracion (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      descripcion TEXT DEFAULT ''
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS horas_objetivo (
      id SERIAL PRIMARY KEY,
      empleado_id INTEGER NOT NULL UNIQUE REFERENCES empleados(id),
      horas_semana DOUBLE PRECISION,
      horas_mes DOUBLE PRECISION,
      admin_id INTEGER REFERENCES empleados(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ajustes_horas (
      id SERIAL PRIMARY KEY,
      empleado_id INTEGER NOT NULL REFERENCES empleados(id),
      cantidad_horas DOUBLE PRECISION NOT NULL,
      concepto TEXT NOT NULL,
      admin_id INTEGER NOT NULL REFERENCES empleados(id),
      fecha DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS solicitudes_correccion (
      id SERIAL PRIMARY KEY,
      empleado_id INTEGER NOT NULL REFERENCES empleados(id),
      fichaje_id INTEGER REFERENCES fichajes(id) ON DELETE SET NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('correccion', 'nuevo', 'eliminar')),
      fecha_solicitada DATE NOT NULL,
      hora_solicitada TIME NOT NULL,
      tipo_fichaje TEXT NOT NULL CHECK(tipo_fichaje IN ('entrada', 'salida')),
      motivo TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'aprobada', 'rechazada')),
      admin_id INTEGER REFERENCES empleados(id),
      admin_nota TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notificaciones (
      id SERIAL PRIMARY KEY,
      empleado_id INTEGER NOT NULL REFERENCES empleados(id),
      mensaje TEXT NOT NULL,
      leida INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notificaciones_empleado ON notificaciones(empleado_id);
  `);

  // Tabla de horarios programados (para tiempo de gracia por turno)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS horarios (
      id SERIAL PRIMARY KEY,
      empleado_id INTEGER REFERENCES empleados(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK(tipo IN ('diario','semanal','rango','fecha')),
      dias_semana TEXT DEFAULT NULL,
      fecha DATE DEFAULT NULL,
      fecha_inicio DATE DEFAULT NULL,
      fecha_fin DATE DEFAULT NULL,
      hora_entrada TIME NOT NULL,
      hora_salida TIME DEFAULT NULL,
      activo INTEGER NOT NULL DEFAULT 1,
      admin_id INTEGER REFERENCES empleados(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_horarios_empleado ON horarios(empleado_id);`);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fichajes_empleado ON fichajes(empleado_id);
    CREATE INDEX IF NOT EXISTS idx_fichajes_timestamp ON fichajes(timestamp);
    CREATE INDEX IF NOT EXISTS idx_saldos_empleado ON saldos(empleado_id);
    CREATE INDEX IF NOT EXISTS idx_ajustes_empleado ON ajustes_horas(empleado_id);
  `);

  // Admin por defecto
  const { rows } = await pool.query('SELECT COUNT(*) AS n FROM empleados');
  if (parseInt(rows[0].n) === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query(
      `INSERT INTO empleados (nombre, apellidos, email, password, rol, departamento)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['Administrador', 'Bodegas Álvaro', 'admin@bodegas-alvaro.com', hash, 'admin', 'Dirección']
    );
    console.log('✅ Base de datos inicializada.');
    console.log('👤 Usuario admin: admin@bodegas-alvaro.com / admin123');
    console.log('⚠️  Cambia la contraseña del admin en el primer acceso.');
  }

  // Configuración por defecto
  const defaults = [
    ['geo_activo',         '0',              'Activar validación de geolocalización (1=sí, 0=no)'],
    ['geo_lat',            '28.476200',      'Latitud de la bodega'],
    ['geo_lng',            '-16.325300',     'Longitud de la bodega'],
    ['geo_radio_metros',   '150',            'Radio permitido en metros desde la bodega'],
    ['empresa_nombre',     'Bodegas Álvaro', 'Nombre de la empresa'],
    ['empresa_direccion',  'Tacoronte, Tenerife', 'Dirección de la empresa'],
    ['horas_objetivo_semana', '40',          'Horas de trabajo objetivo por semana (defecto para todos los empleados)'],
    ['horas_objetivo_mes',    '160',         'Horas de trabajo objetivo por mes (defecto para todos los empleados)'],
    ['ip_activo',             '0',           'Activar restricción de fichaje por red WiFi (1=sí, 0=no)'],
    ['ip_permitidas',         '',            'IPs públicas permitidas para fichar (separadas por comas)'],
    ['gracia_minutos',        '5',           'Minutos de gracia al fichar para redondear a la hora exacta'],
  ];
  for (const [clave, valor, descripcion] of defaults) {
    await pool.query(
      `INSERT INTO configuracion (clave, valor, descripcion) VALUES ($1, $2, $3)
       ON CONFLICT (clave) DO NOTHING`,
      [clave, valor, descripcion]
    );
  }
}

module.exports = { pool, initializeDatabase };
