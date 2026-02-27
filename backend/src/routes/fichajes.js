const express = require('express');
const db = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/fichajes/fichar
// El empleado ficha entrada o salida
router.post('/fichar', authMiddleware, (req, res) => {
  const { latitud, longitud, precision_metros, notas = '' } = req.body;
  const empleadoId = req.user.id;

  // Validar geolocalización si está activada
  const geoActivo = db.prepare("SELECT valor FROM configuracion WHERE clave = 'geo_activo'").get();
  if (geoActivo?.valor === '1') {
    if (latitud == null || longitud == null) {
      return res.status(400).json({
        error: 'Se requiere geolocalización para fichar. Activa el GPS y vuelve a intentarlo.',
        requiereGeo: true
      });
    }

    const geoLat = parseFloat(db.prepare("SELECT valor FROM configuracion WHERE clave = 'geo_lat'").get()?.valor || '0');
    const geoLng = parseFloat(db.prepare("SELECT valor FROM configuracion WHERE clave = 'geo_lng'").get()?.valor || '0');
    const radioMetros = parseFloat(db.prepare("SELECT valor FROM configuracion WHERE clave = 'geo_radio_metros'").get()?.valor || '150');

    const distancia = calcularDistanciaMetros(latitud, longitud, geoLat, geoLng);

    if (distancia > radioMetros) {
      return res.status(403).json({
        error: `Solo puedes fichar desde la bodega. Estás a ${Math.round(distancia)}m (máximo permitido: ${radioMetros}m).`,
        distancia: Math.round(distancia),
        radioPermitido: radioMetros
      });
    }
  }

  // Determinar tipo: si el último fichaje es entrada, el siguiente es salida, y viceversa
  const ultimo = db.prepare(`
    SELECT tipo FROM fichajes 
    WHERE empleado_id = ? 
    ORDER BY timestamp DESC 
    LIMIT 1
  `).get(empleadoId);

  const tipo = (!ultimo || ultimo.tipo === 'salida') ? 'entrada' : 'salida';

  const result = db.prepare(`
    INSERT INTO fichajes (empleado_id, tipo, latitud, longitud, precision_metros, notas)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(empleadoId, tipo, latitud ?? null, longitud ?? null, precision_metros ?? null, notas);

  const fichaje = db.prepare('SELECT * FROM fichajes WHERE id = ?').get(result.lastInsertRowid);

  res.status(201).json({ fichaje, tipo });
});

// GET /api/fichajes/estado
// Estado actual del empleado (dentro o fuera)
router.get('/estado', authMiddleware, (req, res) => {
  const ultimo = db.prepare(`
    SELECT * FROM fichajes 
    WHERE empleado_id = ? 
    ORDER BY timestamp DESC 
    LIMIT 1
  `).get(req.user.id);

  const dentroDelTrabajo = ultimo?.tipo === 'entrada';
  res.json({ 
    dentro: dentroDelTrabajo,
    ultimoFichaje: ultimo || null,
    proximoTipo: dentroDelTrabajo ? 'salida' : 'entrada'
  });
});

// GET /api/fichajes/mis-fichajes
// Historial del empleado autenticado con paginación
router.get('/mis-fichajes', authMiddleware, (req, res) => {
  const { desde, hasta, pagina = 1, limite = 30 } = req.query;
  const offset = (parseInt(pagina) - 1) * parseInt(limite);
  let condiciones = ['empleado_id = ?'];
  let params = [req.user.id];

  if (desde) { condiciones.push("date(timestamp) >= date(?)"); params.push(desde); }
  if (hasta) { condiciones.push("date(timestamp) <= date(?)"); params.push(hasta); }

  const where = condiciones.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) as n FROM fichajes WHERE ${where}`).get(...params).n;
  const fichajes = db.prepare(`
    SELECT * FROM fichajes WHERE ${where}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limite), offset);

  res.json({ fichajes, total, pagina: parseInt(pagina), limite: parseInt(limite) });
});

// GET /api/fichajes/resumen-hoy
// Resumen de horas trabajadas hoy para el empleado autenticado
router.get('/resumen-hoy', authMiddleware, (req, res) => {
  const fichajesHoy = db.prepare(`
    SELECT * FROM fichajes 
    WHERE empleado_id = ? AND date(timestamp) = date('now', 'localtime')
    ORDER BY timestamp ASC
  `).all(req.user.id);

  let minutosHoy = calcularMinutosTrabajados(fichajesHoy);
  res.json({ fichajesHoy, minutosHoy, horasHoy: minutosHoy / 60 });
});

// ─── RUTAS DE ADMIN ────────────────────────────────────────────────

// GET /api/fichajes/admin/todos
router.get('/admin/todos', authMiddleware, adminMiddleware, (req, res) => {
  const { empleado_id, desde, hasta, pagina = 1, limite = 50 } = req.query;
  const offset = (parseInt(pagina) - 1) * parseInt(limite);
  let condiciones = [];
  let params = [];

  if (empleado_id) { condiciones.push('f.empleado_id = ?'); params.push(empleado_id); }
  if (desde) { condiciones.push("date(f.timestamp) >= date(?)"); params.push(desde); }
  if (hasta) { condiciones.push("date(f.timestamp) <= date(?)"); params.push(hasta); }

  const where = condiciones.length > 0 ? 'WHERE ' + condiciones.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) as n FROM fichajes f ${where}`).get(...params).n;
  const fichajes = db.prepare(`
    SELECT f.*, e.nombre, e.apellidos, e.departamento
    FROM fichajes f
    JOIN empleados e ON f.empleado_id = e.id
    ${where}
    ORDER BY f.timestamp DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limite), offset);

  res.json({ fichajes, total, pagina: parseInt(pagina), limite: parseInt(limite) });
});

// GET /api/fichajes/admin/resumen
// Resumen de todos los empleados hoy
router.get('/admin/resumen', authMiddleware, adminMiddleware, (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().split('T')[0];

  const empleados = db.prepare('SELECT id, nombre, apellidos, departamento FROM empleados WHERE activo = 1').all();

  const resumen = empleados.map(emp => {
    const fichajes = db.prepare(`
      SELECT * FROM fichajes 
      WHERE empleado_id = ? AND date(timestamp) = ?
      ORDER BY timestamp ASC
    `).all(emp.id, fecha);

    const ultimoFichaje = fichajes[fichajes.length - 1] || null;
    const dentro = ultimoFichaje?.tipo === 'entrada';
    const minutos = calcularMinutosTrabajados(fichajes);

    return {
      ...emp,
      dentro,
      minutosTrabajados: minutos,
      horasTrabajadas: (minutos / 60).toFixed(2),
      ultimoFichaje,
      fichajesToday: fichajes.length
    };
  });

  res.json({ fecha, resumen });
});

// GET /api/fichajes/admin/exportar
// Exportar CSV de fichajes
router.get('/admin/exportar', authMiddleware, adminMiddleware, (req, res) => {
  const { desde, hasta, empleado_id } = req.query;
  let condiciones = [];
  let params = [];

  if (empleado_id) { condiciones.push('f.empleado_id = ?'); params.push(empleado_id); }
  if (desde) { condiciones.push("date(f.timestamp) >= date(?)"); params.push(desde); }
  if (hasta) { condiciones.push("date(f.timestamp) <= date(?)"); params.push(hasta); }

  const where = condiciones.length > 0 ? 'WHERE ' + condiciones.join(' AND ') : '';

  const fichajes = db.prepare(`
    SELECT f.timestamp, e.nombre, e.apellidos, e.departamento, f.tipo, f.ubicacion, f.notas
    FROM fichajes f
    JOIN empleados e ON f.empleado_id = e.id
    ${where}
    ORDER BY e.apellidos, f.timestamp ASC
  `).all(...params);

  const cabecera = 'Fecha y Hora,Nombre,Apellidos,Departamento,Tipo,Ubicacion,Notas\n';
  const filas = fichajes.map(f =>
    `"${f.timestamp}","${f.nombre}","${f.apellidos}","${f.departamento}","${f.tipo}","${f.ubicacion}","${f.notas}"`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="fichajes_${desde || 'todo'}_${hasta || 'todo'}.csv"`);
  res.send('\uFEFF' + cabecera + filas);
});

// DELETE /api/fichajes/admin/:id
router.delete('/admin/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  const fichaje = db.prepare('SELECT * FROM fichajes WHERE id = ?').get(id);
  if (!fichaje) return res.status(404).json({ error: 'Fichaje no encontrado' });
  db.prepare('DELETE FROM fichajes WHERE id = ?').run(id);
  res.json({ message: 'Fichaje eliminado' });
});

// Fórmula Haversine para distancia entre dos coordenadas GPS en metros
function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radio de la Tierra en metros
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Función auxiliar para calcular minutos trabajados
function calcularMinutosTrabajados(fichajes) {
  let minutos = 0;
  let entradaTimestamp = null;

  for (const f of fichajes) {
    if (f.tipo === 'entrada') {
      entradaTimestamp = new Date(f.timestamp);
    } else if (f.tipo === 'salida' && entradaTimestamp) {
      const salida = new Date(f.timestamp);
      minutos += (salida - entradaTimestamp) / 60000;
      entradaTimestamp = null;
    }
  }

  return Math.round(minutos);
}

module.exports = router;
