const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/species
router.get('/', async (req, res) => {
  try {
    const list = await db.getSpecies();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/species
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Species name is required' });
    const s = await db.addSpecies(name);
    res.status(201).json(s);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
