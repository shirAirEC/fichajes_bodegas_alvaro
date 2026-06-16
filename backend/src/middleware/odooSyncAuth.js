function odooSyncAuth(req, res, next) {
  const expected = process.env.ODOO_SYNC_API_KEY;
  if (!expected) {
    console.error('[odoo-sync] ODOO_SYNC_API_KEY no configurada');
    return res.status(503).json({ error: 'Sincronizacion Odoo no configurada' });
  }
  const provided = req.headers['x-odoo-sync-key'];
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'Clave de sincronizacion invalida' });
  }
  req.odooSync = true;
  next();
}

function isOdooSyncRequest(req) {
  return req.headers['x-odoo-sync'] === '1' || req.odooSync === true;
}

module.exports = { odooSyncAuth, isOdooSyncRequest };
