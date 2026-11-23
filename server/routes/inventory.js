const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/inventory
router.get('/', async (req, res) => {
  try {
    const filter = req.query.filter || 'all';
    const crabs = await db.getInventoryCrabs(filter);
    res.json(crabs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inventory/deliveries
router.get('/deliveries', async (req, res) => {
  try {
    const deliveries = await db.getDeliveries();
    res.json(deliveries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inventory/used-batches
router.get('/used-batches', async (req, res) => {
  try {
    const excludeCrab = req.query.excludeCrab ? parseInt(req.query.excludeCrab, 10) : null;
    const excludeBox = req.query.excludeBox ? parseInt(req.query.excludeBox, 10) : null;
    const used = await db.getUsedBatchNumbers(excludeCrab, excludeBox);
    res.json(used);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory/receive
router.post('/receive', async (req, res) => {
  try {
    const { seller, received_date, species, crabs } = req.body;
    const userId = req.user ? req.user.id : null;
    const result = await db.receiveCrabs(seller, received_date, species, crabs, userId);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/inventory/:id
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await db.updateInventoryCrab(id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/inventory/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await db.removeInventoryCrab(id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/inventory/move
router.post('/move', async (req, res) => {
  try {
    const { stock_date, assignments } = req.body;
    const moved = await db.moveToBoxes(stock_date, assignments);
    res.json({ success: true, moved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
