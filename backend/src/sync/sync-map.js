const { pool } = require('../db/database');

const ENTITY_TYPES = {
  ATTENDANCE: 'attendance',
  LEAVE: 'leave',
  HORARIO: 'horario',
  RESERVA: 'reserva',
  AJUSTE: 'ajuste',
  SALDO: 'saldo',
};

async function getEntityMapping(entityType, fichajesEntityId) {
  const { rows } = await pool.query(
    `SELECT * FROM sync_odoo_entity_map
     WHERE entity_type = $1 AND fichajes_entity_id = $2`,
    [entityType, fichajesEntityId]
  );
  return rows[0] || null;
}

async function saveEntityMapping(entityType, fichajesEntityId, odooModel, odooRecordId) {
  await pool.query(
    `INSERT INTO sync_odoo_entity_map
       (entity_type, fichajes_entity_id, odoo_model, odoo_record_id, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (entity_type, fichajes_entity_id) DO UPDATE
       SET odoo_model = EXCLUDED.odoo_model,
           odoo_record_id = EXCLUDED.odoo_record_id,
           updated_at = NOW()`,
    [entityType, fichajesEntityId, odooModel, odooRecordId]
  );
}

async function deleteEntityMapping(entityType, fichajesEntityId) {
  await pool.query(
    `DELETE FROM sync_odoo_entity_map
     WHERE entity_type = $1 AND fichajes_entity_id = $2`,
    [entityType, fichajesEntityId]
  );
}

async function getOdooEmployeeId(fichajesEmpleadoId) {
  if (!fichajesEmpleadoId) return null;
  const { rows } = await pool.query(
    `SELECT e.odoo_employee_id, m.odoo_employee_id AS map_odoo_id
     FROM empleados e
     LEFT JOIN sync_odoo_map m ON m.fichajes_empleado_id = e.id
     WHERE e.id = $1`,
    [fichajesEmpleadoId]
  );
  const row = rows[0];
  if (!row) return null;
  return row.odoo_employee_id || row.map_odoo_id || null;
}

async function getFichajesEmployeeId(odooEmployeeId) {
  if (!odooEmployeeId) return null;
  const { rows } = await pool.query(
    `SELECT e.id
     FROM empleados e
     LEFT JOIN sync_odoo_map m ON m.fichajes_empleado_id = e.id
     WHERE e.odoo_employee_id = $1 OR m.odoo_employee_id = $1
     ORDER BY e.id
     LIMIT 1`,
    [odooEmployeeId]
  );
  return rows[0]?.id || null;
}

async function getEntityMappingByOdooId(entityType, odooRecordId) {
  const { rows } = await pool.query(
    `SELECT * FROM sync_odoo_entity_map
     WHERE entity_type = $1 AND odoo_record_id = $2
     LIMIT 1`,
    [entityType, odooRecordId]
  );
  return rows[0] || null;
}

module.exports = {
  ENTITY_TYPES,
  getEntityMapping,
  getEntityMappingByOdooId,
  saveEntityMapping,
  deleteEntityMapping,
  getOdooEmployeeId,
  getFichajesEmployeeId,
};
