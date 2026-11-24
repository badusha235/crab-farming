const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { authenticateToken } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const speciesRoutes = require('./routes/species');
const inventoryRoutes = require('./routes/inventory');
const boxesRoutes = require('./routes/boxes');
const harvestsRoutes = require('./routes/harvests');
const monitorRoutes = require('./routes/monitor');
const exportRoutes = require('./routes/export');

const app = express();

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// Static frontend
app.use(express.static(path.resolve(__dirname, '../public')));

// Uploaded harvest files
app.use('/uploads', express.static(config.uploadDir));

// Sync & Healthcheck
app.get('/api/sync/status', (req, res) => {
  res.json({
    synced: true,
    engine: db.activeEngine,
    time: new Date().toISOString()
  });
});

// Authentication middleware for /api routes
app.use('/api', authenticateToken);

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/species', speciesRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/boxes', boxesRoutes);
app.use('/api/harvests', harvestsRoutes);
app.use('/api/monitor', monitorRoutes);
app.use('/api/export', exportRoutes);

// Fallback to index.html for SPA routing
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
    return res.sendFile(path.resolve(__dirname, '../public/index.html'));
  }
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function startServer(port = config.port) {
  await db.setupDatabase();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', () => {
      const p = server.address() ? server.address().port : port;
      console.log(`=======================================================`);
      console.log(`🦀 Crab Box Register server running on:`);
      console.log(`   - http://localhost:${p}`);
      console.log(`   - http://127.0.0.1:${p}`);
      console.log(`📊 Storage engine: ${db.activeEngine}`);
      console.log(`=======================================================`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { app, startServer };
