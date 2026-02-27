require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config(); // fallback a backend/.env si existe
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const fichajesRoutes = require('./routes/fichajes');
const empleadosRoutes = require('./routes/empleados');
const saldosRoutes = require('./routes/saldos');
const configRoutes = require('./routes/config');

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// En producción el CORS no es necesario (mismo origen), pero lo dejamos para dev
app.use(cors({
  origin: process.env.FRONTEND_URL || (isProduction ? false : '*'),
  credentials: true
}));

app.use(express.json());

// Healthcheck antes de cualquier ruta (Railway lo usa)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/fichajes', fichajesRoutes);
app.use('/api/empleados', empleadosRoutes);
app.use('/api/saldos', saldosRoutes);
app.use('/api/config', configRoutes);

// Servir el frontend en producción
// La ruta es relativa a backend/src/ → ../../frontend/dist
const FRONTEND_DIST = process.env.FRONTEND_DIST
  || path.join(__dirname, '..', '..', 'frontend', 'dist');

if (isProduction) {
  if (fs.existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST, { maxAge: '1y', immutable: true }));
    // No hacer caché del index.html para que siempre cargue la última versión
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
    console.log(`📁 Sirviendo frontend desde: ${FRONTEND_DIST}`);
  } else {
    console.warn(`⚠️  Frontend dist no encontrado en: ${FRONTEND_DIST}`);
    app.get('/', (req, res) => res.json({ status: 'API funcionando. Frontend no disponible.' }));
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🍷 Fichajes Bodegas Álvaro — http://0.0.0.0:${PORT} [${isProduction ? 'PRODUCCIÓN' : 'desarrollo'}]`);
});
