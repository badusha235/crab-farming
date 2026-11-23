const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/monitor/readings
router.get('/readings', async (req, res) => {
  try {
    const since = req.query.since || null;
    const readings = await db.getMonitorReadings(since);
    res.json(readings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/monitor/readings (IoT or manual entry)
router.post('/readings', async (req, res) => {
  try {
    const { time, temp, ph, source } = req.body;
    const reading = await db.addMonitorReading(time, temp, ph, source || 'manual');
    res.status(201).json(reading);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/monitor/import
router.post('/import', async (req, res) => {
  try {
    const { readings } = req.body;
    if (!readings || !Array.isArray(readings)) {
      return res.status(400).json({ error: 'Array of readings is required' });
    }
    const result = await db.importMonitorReadings(readings);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
