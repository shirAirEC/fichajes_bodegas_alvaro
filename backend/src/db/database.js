const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// En Railway: DB_PATH=/data/fichajes.db (Volume montado en /data)
// En desarrollo local: DB_PATH=./data/fichajes.db (o sin variable)
const DB_PATH = process.env.DB_PATH
  || (process.env.NODE_ENV === 'production'
    ? '/data/fichajes.db'
    : path.join(__dirname, '../../data/fichajes.db'));

// Asegurar que el directorio de datos exista
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Habilitar WAL mode para mejor rendimiento concurrente
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS empleados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      apellidos TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'empleado' CHECK(rol IN ('empleado', 'admin')),
      departamento TEXT DEFAULT '',
      activo INTEGER NOT NULL DEFAULT 1,
      fecha_alta TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fichajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empleado_id INTEGER NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('entrada', 'salida')),
      timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      latitud REAL DEFAULT NULL,
      longitud REAL DEFAULT NULL,
      precision_metros REAL DEFAULT NULL,
      notas TEXT DEFAULT '',
      FOREIGN KEY (empleado_id) REFERENCES empleados(id)
    );

    CREATE TABLE IF NOT EXISTS saldos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empleado_id INTEGER NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('vacaciones', 'horas_extra', 'permiso_especial', 'baja_medica')),
      cantidad REAL NOT NULL,
      concepto TEXT NOT NULL,
      admin_id INTEGER NOT NULL,
      fecha_referencia TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (empleado_id) REFERENCES empleados(id),
      FOREIGN KEY (admin_id) REFERENCES empleados(id)
    );

    CREATE TABLE IF NOT EXISTS configuracion (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      descripcion TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_fichajes_empleado ON fichajes(empleado_id);
    CREATE INDEX IF NOT EXISTS idx_fichajes_timestamp ON fichajes(timestamp);
    CREATE INDEX IF NOT EXISTS idx_saldos_empleado ON saldos(empleado_id);
  `);

  // Crear admin por defecto si no existe ningún empleado
  const count = db.prepare('SELECT COUNT(*) as n FROM empleados').get();
  if (count.n === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO empleados (nombre, apellidos, email, password, rol, departamento)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('Administrador', 'Bodegas Álvaro', 'admin@bodegas-alvaro.com', hash, 'admin', 'Dirección');

    console.log('✅ Base de datos inicializada.');
    console.log('👤 Usuario admin creado: admin@bodegas-alvaro.com / admin123');
    console.log('⚠️  Cambia la contraseña del admin en el primer inicio de sesión.');
  }

  // Insertar configuración por defecto si no existe
  const insertConf = db.prepare(`
    INSERT OR IGNORE INTO configuracion (clave, valor, descripcion) VALUES (?, ?, ?)
  `);
  insertConf.run('geo_activo', '0', 'Activar validación de geolocalización al fichar (1=sí, 0=no)');
  insertConf.run('geo_lat', '28.476200', 'Latitud de la bodega');
  insertConf.run('geo_lng', '-16.325300', 'Longitud de la bodega');
  insertConf.run('geo_radio_metros', '150', 'Radio permitido en metros desde la bodega');
  insertConf.run('empresa_nombre', 'Bodegas Álvaro', 'Nombre de la empresa');
  insertConf.run('empresa_direccion', 'Tacoronte, Tenerife', 'Dirección de la empresa');
}

initializeDatabase();

module.exports = db;
