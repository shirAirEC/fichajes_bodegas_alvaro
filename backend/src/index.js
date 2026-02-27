require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const fichajesRoutes = require('./routes/fichajes');
const empleadosRoutes = require('./routes/empleados');
const saldosRoutes = require('./routes/saldos');
const configRoutes = require('./routes/config');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: permitir el frontend de Vercel (y localhost en desarrollo)
const origenesPermitidos = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
];

// FRONTEND_URL puede ser una URL o una lista separada por comas
// Ej: FRONTEND_URL=https://fichajes.vercel.app,https://mi-dominio.com
if (process.env.FRONTEND_URL) {
  process.env.FRONTEND_URL.split(',').forEach(url => {
    origenesPermitidos.push(url.trim());
  });
}

app.use(cors({
  origin: (origin, callback) => {
    // Permitir peticiones sin origen (apps nativas, Postman, curl)
    if (!origin) return callback(null, true);
    if (origenesPermitidos.includes(origin)) return callback(null, true);
    // En desarrollo permitir cualquier origen
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    callback(new Error(`CORS: origen no permitido: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Healthcheck (Railway lo usa para verificar que el servicio está vivo)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/fichajes', fichajesRoutes);
app.use('/api/empleados', empleadosRoutes);
app.use('/api/saldos', saldosRoutes);
app.use('/api/config', configRoutes);

// Ruta 404 para rutas de API no existentes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🍷 Fichajes Bodegas Álvaro — API en http://0.0.0.0:${PORT}`);
  console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}`);
  if (process.env.FRONTEND_URL) {
    console.log(`   CORS permitido: ${process.env.FRONTEND_URL}`);
  }
});
