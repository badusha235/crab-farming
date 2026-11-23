const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/boxes
router.get('/', async (req, res) => {
  try {
    const boxes = await db.getBoxes();
    res.json(boxes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/boxes/:num
router.get('/:num', async (req, res) => {
  try {
    const num = parseInt(req.params.num, 10);
    const box = await db.getBox(num);
    if (!box) return res.status(404).json({ error: `Box ${num} is empty` });
    res.json(box);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/boxes/:num
router.put('/:num', async (req, res) => {
  try {
    const num = parseInt(req.params.num, 10);
    const saved = await db.saveBox(num, req.body);
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/boxes/:num
router.delete('/:num', async (req, res) => {
  try {
    const num = parseInt(req.params.num, 10);
    const result = await db.deleteBox(num);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/boxes/:num/move
router.post('/:num/move', async (req, res) => {
  try {
    const from = parseInt(req.params.num, 10);
    const to = parseInt(req.body.to_box, 10);
    const moved = await db.moveBox(from, to);
    res.json(moved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
