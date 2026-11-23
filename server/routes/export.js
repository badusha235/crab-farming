const express = require('express');
const router = express.Router();
const db = require('../db');

function formatCsvCell(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(rows) {
  return rows.map(r => r.map(formatCsvCell).join(',')).join('\r\n');
}

// GET /api/export/boxes
router.get('/boxes', async (req, res) => {
  try {
    const boxes = await db.getBoxes();
    const rows = [
      ['Box', 'Status', 'Size', 'Species', 'Sex', 'Batch no.', 'Purchase cost (INR)', 'Batch / source', 'Stocking date', 'Age (days)', 'Initial weight (kg)', 'Latest weight (kg)', 'Gain (kg)', 'Gain per day (kg)', 'Moults', 'Weighings', 'Notes']
    ];

    const todayDate = new Date().toISOString().slice(0, 10);
    boxes.forEach(b => {
      const isEnded = (b.status === 'harvest' || b.status === 'dead') && b.end_date;
      const endDate = isEnded ? b.end_date : todayDate;
      const ageDays = b.stock_date ? Math.max(0, Math.round((new Date(endDate) - new Date(b.stock_date)) / 864e5)) : 0;

      const latestWeight = b.weights && b.weights.length > 0 ? b.weights[b.weights.length - 1].weight_g : b.initial_weight_g;
      const gain = latestWeight - b.initial_weight_g;
      const gainPerDay = ageDays > 0 ? Number(((gain / 1000) / ageDays).toFixed(4)) : '';

      rows.push([
        b.box_no,
        b.status === 'growing' ? 'Growing' : b.status === 'molting' ? 'Moulting' : b.status === 'harvest' ? 'Harvest' : 'Dead',
        b.size || '',
        b.species || '',
        b.sex === 'M' ? 'Male' : b.sex === 'F' ? 'Female' : '',
        b.batch_no || '',
        b.cost !== null ? b.cost : '',
        b.source || '',
        b.stock_date || '',
        ageDays,
        (b.initial_weight_g / 1000).toFixed(3),
        (latestWeight / 1000).toFixed(3),
        (gain / 1000).toFixed(3),
        gainPerDay,
        b.moults ? b.moults.length : 0,
        b.weights ? b.weights.length : 0,
        b.notes || ''
      ]);
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="crab-boxes-${todayDate}.csv"`);
    res.send(toCsv(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export/inventory
router.get('/inventory', async (req, res) => {
  try {
    const crabs = await db.getInventoryCrabs('all');
    const todayDate = new Date().toISOString().slice(0, 10);
    const rows = [
      ['Batch no.', 'Seller', 'Received', 'Species', 'Sex', 'Weight (kg)', 'Buying price (INR)', 'Status', 'Box', 'Notes']
    ];

    crabs.forEach(c => {
      rows.push([
        c.batch_no || '',
        c.seller || '',
        c.date || '',
        c.species || '',
        c.sex === 'M' ? 'Male' : c.sex === 'F' ? 'Female' : '',
        (c.weight_g / 1000).toFixed(3),
        c.price !== null ? c.price : '',
        c.status === 'stock' ? 'In stock' : 'Moved',
        c.moved_to_box || '',
        c.notes || ''
      ]);
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="crab-inventory-${todayDate}.csv"`);
    res.send(toCsv(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export/harvest
router.get('/harvest', async (req, res) => {
  try {
    const harvests = await db.getHarvests();
    const todayDate = new Date().toISOString().slice(0, 10);
    const rows = [
      ['Date', 'Boxes', 'Crabs', 'Batch numbers', 'Total weight (kg)', 'Size', 'Price (INR per kg)', 'Revenue (INR)', 'Buyer', 'Avg days in box', 'Notes']
    ];

    harvests.forEach(h => {
      const boxNums = (h.items || []).map(i => i.box_no).sort((a, b) => a - b).join(' ');
      const batchNos = (h.items || []).map(i => i.batch_no).filter(Boolean).join(' ');
      const crabCount = h.items ? h.items.length : 1;
      const revenue = h.price_per_kg ? ((h.total_weight_g / 1000) * h.price_per_kg).toFixed(2) : '';

      let avgDays = '';
      if (h.items && h.items.length > 0) {
        let totalDays = 0, countDays = 0;
        h.items.forEach(i => {
          if (i.stock_date) {
            totalDays += Math.max(0, Math.round((new Date(h.harvest_date) - new Date(i.stock_date)) / 864e5));
            countDays++;
          }
        });
        if (countDays > 0) avgDays = Math.round(totalDays / countDays);
      }

      rows.push([
        h.harvest_date,
        boxNums,
        crabCount,
        batchNos,
        (h.total_weight_g / 1000).toFixed(3),
        h.size || '',
        h.price_per_kg || '',
        revenue,
        h.buyer || '',
        avgDays,
        h.notes || ''
      ]);
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="crab-harvest-${todayDate}.csv"`);
    res.send(toCsv(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export/profit
router.get('/profit', async (req, res) => {
  try {
    const profits = await db.getProfitByBatch();
    const todayDate = new Date().toISOString().slice(0, 10);
    const rows = [
      ['Batch no.', 'Harvested', 'Box', 'Weight (kg)', 'Buying price (INR)', 'Selling price (INR)', 'Profit (INR)']
    ];

    profits.forEach(p => {
      rows.push([
        p.batch_no,
        p.harvest_date,
        p.box_no,
        (p.final_weight_g / 1000).toFixed(3),
        p.buying_price !== null ? p.buying_price : '',
        p.selling_price !== null ? p.selling_price : '',
        p.profit !== null ? p.profit : ''
      ]);
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="crab-profit-${todayDate}.csv"`);
    res.send(toCsv(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export/readings
router.get('/readings', async (req, res) => {
  try {
    const readings = await db.getMonitorReadings();
    const todayDate = new Date().toISOString().slice(0, 10);
    const rows = [
      ['time', 'sensor', 'temp', 'ph']
    ];

    readings.forEach(r => {
      const d = new Date(r.recorded_at);
      const timeStr = isNaN(d.getTime()) ? r.recorded_at : d.toISOString().slice(0, 19).replace('T', ' ');
      rows.push([
        timeStr,
        r.source || 'manual',
        r.temperature_c !== null ? r.temperature_c : '',
        r.ph !== null ? r.ph : ''
      ]);
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="water-readings-${todayDate}.csv"`);
    res.send(toCsv(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
