// Catálogo de "turoperadoras" y "tipos de servicio facturables" para los
// desplegables de la planificación (AdminReservasPage).
//
// Fuente de verdad: Odoo (single source of truth, ver FICHAJES_PLANIFICACION.md).
// Fichajes NUNCA duplica manualmente esta lista: la lee en caliente de Odoo
// vía JSON-RPC y la cachea en memoria un rato corto para no golpear Odoo en
// cada tecla del admin ni depender de su disponibilidad en cada petición.
//
//  - Turoperadoras: res.partner con x_is_turoperadora = true (importadas del
//    Excel de clientes + las de cruceros dadas de alta en Odoo).
//  - Tipos de servicio: bodegas.servicio.tarifa con x_show_in_planning = true
//    y producto del catálogo "turoperadora" (Degustaciones/Almuerzos/talleres),
//    NUNCA platos de bar ni productos de tienda.
const odoo = require('./odoo-client');

const TTL_MS = 5 * 60 * 1000; // 5 minutos

const cache = {
  turoperadoras: [],
  tiposServicio: [],
  updatedAt: null,
  lastError: null,
};

function isStale() {
  return !cache.updatedAt || (Date.now() - cache.updatedAt) > TTL_MS;
}

async function fetchTuroperadoras() {
  const rows = await odoo.searchRead(
    'res.partner',
    [['x_is_turoperadora', '=', true], ['active', '=', true]],
    ['id', 'name'],
    { order: 'name asc' }
  );
  return rows.map((r) => ({ id: r.id, nombre: r.name })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

async function fetchTiposServicio() {
  const rows = await odoo.searchRead(
    'bodegas.servicio.tarifa',
    [
      ['active', '=', true],
      ['x_show_in_planning', '=', true],
      ['product_id.x_bodegas_grupo', '=', 'turoperadora'],
    ],
    ['id', 'tipo_servicio', 'x_es_infantil'],
    { order: 'tipo_servicio asc' }
  );
  return rows
    .map((r) => ({ id: r.id, nombre: r.tipo_servicio, infantil: Boolean(r.x_es_infantil) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Devuelve el catálogo cacheado. Si está caducado (o forceRefresh=true)
 * intenta refrescar desde Odoo; si Odoo falla, sirve la última copia buena
 * conocida (stale-while-error) para que el admin pueda seguir trabajando.
 */
async function getCatalogoPlanificacion({ forceRefresh = false } = {}) {
  if (!odoo.isConfigured()) {
    return {
      ...listasPublicas(),
      updatedAt: cache.updatedAt,
      odooConfigured: false,
      stale: cache.updatedAt !== null,
      error: 'Odoo no está configurado en este entorno.',
    };
  }

  if (forceRefresh || isStale()) {
    try {
      const [turoperadoras, tiposServicio] = await Promise.all([
        fetchTuroperadoras(),
        fetchTiposServicio(),
      ]);
      cache.turoperadoras = turoperadoras;
      cache.tiposServicio = tiposServicio;
      cache.updatedAt = Date.now();
      cache.lastError = null;
    } catch (err) {
      cache.lastError = err.message;
      console.error('[catalogo-planificacion] Error refrescando desde Odoo:', err.message);
    }
  }

  return {
    ...listasPublicas(),
    updatedAt: cache.updatedAt,
    odooConfigured: true,
    stale: cache.lastError !== null,
    error: cache.lastError,
  };
}

/**
 * Separa el catálogo en lo que se ofrece en cada desplegable: el servicio de
 * la visita (tarifas de adultos) y el servicio de los niños (las que en Odoo
 * están marcadas como infantiles).
 */
function listasPublicas() {
  return {
    turoperadoras: cache.turoperadoras,
    tiposServicio: cache.tiposServicio.filter((t) => !t.infantil),
    tarifasNinos: cache.tiposServicio.filter((t) => t.infantil),
  };
}

module.exports = { getCatalogoPlanificacion };
