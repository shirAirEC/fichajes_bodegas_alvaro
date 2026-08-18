const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Devolver DATE como string "YYYY-MM-DD" en lugar de objeto Date de JS
types.setTypeParser(1082, val => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL solo para conexiones internas de Railway (.railway.internal)
  // El proxy público (.proxy.rlwy.net) y localhost no usan SSL
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('.railway.internal')
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

  // Migración: solo planificación (cuenta que solo ve planificación y notificaciones)
  await pool.query(`
    ALTER TABLE empleados ADD COLUMN IF NOT EXISTS solo_planificacion INTEGER NOT NULL DEFAULT 0
  `);

  // Migración: fichaje libre (sin restricción de horario ni anticipados)
  await pool.query(`
    ALTER TABLE empleados ADD COLUMN IF NOT EXISTS fichaje_libre INTEGER NOT NULL DEFAULT 0
  `);

  // Migración: configuración de descanso por empleado
  await pool.query(`
    ALTER TABLE empleados ADD COLUMN IF NOT EXISTS descanso_activo BOOLEAN DEFAULT NULL
  `);
  await pool.query(`
    ALTER TABLE empleados ADD COLUMN IF NOT EXISTS descanso_minutos INTEGER DEFAULT NULL
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
      notas TEXT DEFAULT '',
      es_descanso BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  await pool.query(`
    ALTER TABLE fichajes ADD COLUMN IF NOT EXISTS es_descanso BOOLEAN NOT NULL DEFAULT FALSE
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

  // Tabla de reservas / planificación
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservas (
      id SERIAL PRIMARY KEY,
      fecha DATE NOT NULL,
      hora TIME DEFAULT NULL,
      nombre TEXT NOT NULL,
      pax TEXT DEFAULT NULL,
      estado TEXT NOT NULL DEFAULT 'sin_confirmar' CHECK(estado IN ('confirmado', 'pendiente', 'cancelado', 'sin_confirmar')),
      tipo_servicio TEXT DEFAULT '',
      notas TEXT DEFAULT '',
      guia TEXT DEFAULT '',
      menu JSONB DEFAULT '[]'::jsonb,
      necesidades_especiales JSONB DEFAULT '[]'::jsonb,
      orden INTEGER DEFAULT 0,
      admin_id INTEGER REFERENCES empleados(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Migrar/añadir columnas enriquecidas (JSONB para estructura flexible)
  await pool.query(`ALTER TABLE reservas DROP COLUMN IF EXISTS menu`);
  await pool.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS menu JSONB DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS tipo_servicio TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS necesidades_especiales JSONB DEFAULT '[]'::jsonb`);
  // pax como TEXT para soportar rangos como "10/11" o "10-15"
  await pool.query(`ALTER TABLE reservas ALTER COLUMN pax TYPE TEXT USING COALESCE(pax::text, '')`);
  // Columna guía
  await pool.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS guia TEXT DEFAULT ''`);

  // Datos estructurados para facturación automática en Odoo (turoperadora +
  // referencia de bus). Se seleccionan desde un desplegable en el admin
  // (catálogo cargado desde Odoo), nunca texto libre, para que Odoo pueda
  // facturar sin adivinar. turoperador_odoo_id = id del res.partner en Odoo
  // (NULL = particular / sin turoperadora, visita no facturable a un turo).
  await pool.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS turoperador_odoo_id INTEGER DEFAULT NULL`);
  await pool.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS turoperador_nombre TEXT DEFAULT NULL`);
  await pool.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS bus_ref TEXT DEFAULT NULL`);
  // Pax numérico opcional para facturar (prioridad sobre el texto libre de
  // "pax" en Odoo, ver x_pax_real / _bodegas_parse_pax). El texto libre de
  // planificación (pax) no se toca: sigue admitiendo "41(39+2 niños)" etc.
  await pool.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS pax_confirmado INTEGER DEFAULT NULL`);
  // Desglose de niños: cuántos del total son niños y con qué tarifa infantil
  // se les factura. Solo lo usa el panel de administración; los empleados
  // siguen viendo el texto libre de "pax" sin cambios.
  await pool.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS pax_ninos INTEGER DEFAULT NULL`);
  await pool.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS servicio_ninos_odoo_id INTEGER DEFAULT NULL`);
  await pool.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS servicio_ninos_nombre TEXT DEFAULT NULL`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reservas_fecha ON reservas(fecha);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reservas_turoperador ON reservas(turoperador_odoo_id);`);

  // Plantillas semanales de reservas (generan filas en reservas cada lunes)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reserva_plantillas (
      id SERIAL PRIMARY KEY,
      dia_semana INTEGER NOT NULL CHECK(dia_semana >= 1 AND dia_semana <= 7),
      hora TIME DEFAULT NULL,
      nombre TEXT NOT NULL,
      pax TEXT DEFAULT NULL,
      tipo_servicio TEXT DEFAULT '',
      guia TEXT DEFAULT '',
      menu JSONB DEFAULT '[]'::jsonb,
      necesidades_especiales JSONB DEFAULT '[]'::jsonb,
      turoperador_odoo_id INTEGER DEFAULT NULL,
      turoperador_nombre TEXT DEFAULT NULL,
      bus_ref TEXT DEFAULT NULL,
      activa INTEGER NOT NULL DEFAULT 1,
      admin_id INTEGER REFERENCES empleados(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reserva_plantillas_activa ON reserva_plantillas(activa);`);

  // Reservas generadas desde plantilla (evita duplicados por semana)
  await pool.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS plantilla_id INTEGER REFERENCES reserva_plantillas(id) ON DELETE SET NULL`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reservas_plantilla_fecha
      ON reservas(plantilla_id, fecha)
      WHERE plantilla_id IS NOT NULL
  `);

  // Tabla de períodos de ausencia (vacaciones, permiso especial, baja médica)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vacaciones (
      id SERIAL PRIMARY KEY,
      empleado_id INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
      fecha_inicio DATE NOT NULL,
      fecha_fin DATE NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'vacaciones' CHECK(tipo IN ('vacaciones','permiso_especial','baja_medica')),
      motivo TEXT DEFAULT '',
      saldo_id INTEGER REFERENCES saldos(id) ON DELETE SET NULL,
      admin_id INTEGER REFERENCES empleados(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Migraciones por si la tabla ya existía sin las nuevas columnas
  await pool.query(`ALTER TABLE vacaciones ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'vacaciones'`);
  await pool.query(`ALTER TABLE vacaciones ADD COLUMN IF NOT EXISTS saldo_id INTEGER REFERENCES saldos(id) ON DELETE SET NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vacaciones_empleado ON vacaciones(empleado_id);`);

  // Tokens FCM para push notifications
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fcm_tokens (
      id SERIAL PRIMARY KEY,
      empleado_id INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      plataforma TEXT DEFAULT 'android',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(empleado_id)
    )
  `);

  // Fichajes anticipados que requieren aprobación del admin
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fichajes_anticipados (
      id SERIAL PRIMARY KEY,
      empleado_id INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
      hora_intento TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      hora_entrada_programada TIME NOT NULL,
      fecha DATE NOT NULL DEFAULT CURRENT_DATE,
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'aprobado', 'rechazado')),
      admin_id INTEGER REFERENCES empleados(id),
      admin_nota TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fichajes_anticipados_empleado ON fichajes_anticipados(empleado_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fichajes_anticipados_estado ON fichajes_anticipados(estado);`);

  // Registro de excesos en tiempo de descanso
  await pool.query(`
    CREATE TABLE IF NOT EXISTS excesos_descanso (
      id SERIAL PRIMARY KEY,
      empleado_id INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
      fecha DATE NOT NULL DEFAULT CURRENT_DATE,
      hora_inicio_descanso TIMESTAMPTZ NOT NULL,
      hora_fin_descanso TIMESTAMPTZ NOT NULL,
      minutos_real INTEGER NOT NULL,
      minutos_permitido INTEGER NOT NULL,
      minutos_exceso INTEGER NOT NULL,
      fichaje_descanso_id INTEGER REFERENCES fichajes(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_excesos_descanso_empleado ON excesos_descanso(empleado_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_excesos_descanso_fecha ON excesos_descanso(fecha);`);

  // Avisos de planificación creados por el admin
  await pool.query(`
    CREATE TABLE IF NOT EXISTS avisos (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES empleados(id),
      titulo TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Migración: destinatario específico para un aviso (NULL = todos)
  await pool.query(`
    ALTER TABLE avisos ADD COLUMN IF NOT EXISTS destinatario_id INTEGER REFERENCES empleados(id)
  `);

  // Registro de empleados que han confirmado ver el aviso
  await pool.query(`
    CREATE TABLE IF NOT EXISTS avisos_visto (
      id SERIAL PRIMARY KEY,
      aviso_id INTEGER NOT NULL REFERENCES avisos(id) ON DELETE CASCADE,
      empleado_id INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
      visto_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(aviso_id, empleado_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fichajes_empleado ON fichajes(empleado_id);
    CREATE INDEX IF NOT EXISTS idx_fichajes_timestamp ON fichajes(timestamp);
    CREATE INDEX IF NOT EXISTS idx_saldos_empleado ON saldos(empleado_id);
    CREATE INDEX IF NOT EXISTS idx_ajustes_empleado ON ajustes_horas(empleado_id);
  `);

  // Tabla de auditoría — registro inmutable de acciones administrativas
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id            SERIAL PRIMARY KEY,
      usuario_id    INTEGER REFERENCES empleados(id) ON DELETE SET NULL,
      usuario_nombre TEXT NOT NULL,
      accion        TEXT NOT NULL,
      entidad_tipo  TEXT NOT NULL,
      entidad_id    INTEGER,
      detalle       TEXT,
      ip            TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_usuario ON audit_log(usuario_id)`);

  // Nonces one-time para SSO Odoo → Fichajes admin
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sso_nonces (
      nonce TEXT PRIMARY KEY,
      used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Sincronizacion bidireccional con Odoo hr.employee
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_odoo_map (
      fichajes_empleado_id INTEGER UNIQUE REFERENCES empleados(id) ON DELETE CASCADE,
      odoo_employee_id INTEGER UNIQUE NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE empleados ADD COLUMN IF NOT EXISTS odoo_employee_id INTEGER
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_empleados_odoo_id ON empleados(odoo_employee_id)
  `);

  // Mapeo idempotente fichajes -> registros Odoo (asistencia, vacaciones, horarios)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_odoo_entity_map (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      fichajes_entity_id INTEGER NOT NULL,
      odoo_model TEXT NOT NULL,
      odoo_record_id INTEGER NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(entity_type, fichajes_entity_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sync_odoo_entity_type
      ON sync_odoo_entity_map(entity_type, fichajes_entity_id)
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
    ['descanso_activo',       '1',           'Activar botón de descanso para empleados (1=sí, 0=no)'],
    ['descanso_minutos',      '30',          'Duración del descanso en minutos (15 o 30)'],
    ['tv_token',              crypto.randomBytes(8).toString('hex'), 'Token de acceso para la pantalla TV de planificación'],
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
