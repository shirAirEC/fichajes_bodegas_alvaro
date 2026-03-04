require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { initializeDatabase } = require('./db/database');
const { initFirebase } = require('./firebase');

const authRoutes = require('./routes/auth');
const fichajesRoutes = require('./routes/fichajes');
const empleadosRoutes = require('./routes/empleados');
const saldosRoutes = require('./routes/saldos');
const configRoutes = require('./routes/config');
const horasRoutes = require('./routes/horas');
const solicitudesRoutes = require('./routes/solicitudes');
const notificacionesRoutes = require('./routes/notificaciones');
const horariosRoutes = require('./routes/horarios');
const reservasRoutes = require('./routes/reservas');
const vacacionesRoutes = require('./routes/vacaciones');
const avisosRoutes = require('./routes/avisos');

const app = express();
const PORT = process.env.PORT || 3001;

const origenesPermitidos = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  // Capacitor Android WebView
  'https://localhost',
  'capacitor://localhost',
  'http://localhost',
  // Vercel producción
  'https://fichajes-bodegas-alvaro.vercel.app',
  // Vercel develop preview
  'https://fichajes-bodegas-alvaro-git-develop-shirairs-projects.vercel.app',
];
if (process.env.FRONTEND_URL) {
  process.env.FRONTEND_URL.split(',').forEach(u => origenesPermitidos.push(u.trim()));
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || process.env.NODE_ENV !== 'production') return callback(null, true);
    // Permitir cualquier subdominio de vercel.app (previews dinámicos)
    if (origin && origin.endsWith('.vercel.app')) return callback(null, true);
    if (origenesPermitidos.includes(origin)) return callback(null, true);
    callback(new Error(`CORS bloqueado: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/fichajes', fichajesRoutes);
app.use('/api/empleados', empleadosRoutes);
app.use('/api/saldos', saldosRoutes);
app.use('/api/config', configRoutes);
app.use('/api/horas', horasRoutes);
app.use('/api/solicitudes', solicitudesRoutes);
app.use('/api/notificaciones', notificacionesRoutes);
app.use('/api/horarios', horariosRoutes);
app.use('/api/reservas', reservasRoutes);
app.use('/api/vacaciones', vacacionesRoutes);
app.use('/api/avisos', avisosRoutes);

app.use('/api/*', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

async function start() {
  try {
    initFirebase();
    console.log('Conectando a PostgreSQL...');
    await initializeDatabase();
    console.log('Base de datos lista.');

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Fichajes Bodegas Alvaro - API en http://0.0.0.0:${PORT}`);
      console.log(`Entorno: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('Error al iniciar el servidor:', err);
    process.exit(1);
  }
}

start();
