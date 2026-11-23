const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const upload = require('../middleware/upload');

// GET /api/harvests/profit (must be before /:id)
router.get('/profit', async (req, res) => {
  try {
    const profitData = await db.getProfitByBatch();
    res.json(profitData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/harvests
router.get('/', async (req, res) => {
  try {
    const harvests = await db.getHarvests();
    res.json(harvests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/harvests/:id
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const harvest = await db.getHarvest(id);
    if (!harvest) return res.status(404).json({ error: 'Harvest record not found' });
    res.json(harvest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/harvests
router.post('/', async (req, res) => {
  try {
    const { harvest_date, size, total_weight_g, price_per_kg, buyer, notes, boxes } = req.body;
    const harvest = await db.createHarvest(
      { harvest_date, size, total_weight_g, price_per_kg, buyer, notes },
      boxes
    );
    res.status(201).json(harvest);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/harvests/:id
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await db.updateHarvest(id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/harvests/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await db.deleteHarvest(id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/harvests/:id/files
router.post('/:id/files', upload.single('file'), async (req, res) => {
  try {
    const harvestId = parseInt(req.params.id, 10);
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    const file = await db.addHarvestFile(
      harvestId,
      req.file.originalname,
      fileUrl,
      req.file.size
    );
    res.status(201).json(file);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/harvests/:id/files/:fileId
router.delete('/:id/files/:fileId', async (req, res) => {
  try {
    const fileId = parseInt(req.params.fileId, 10);
    const removed = await db.removeHarvestFile(fileId);
    if (removed && removed.file_url) {
      const filePath = path.resolve(process.cwd(), '.' + removed.file_url);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
