const mysql = require('mysql2/promise');
const config = require('../config');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

let pool = null;

async function initMySQL() {
  try {
    // First connect without database selected to create db if needed
    const rootConn = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password
    });

    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await rootConn.end();

    // Now create pool with database
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // Run schema migrations
    const schemaSql = fs.readFileSync(path.resolve(__dirname, '../../schema.sql'), 'utf8');
    const statements = schemaSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.toLowerCase().startsWith('use') && !s.toLowerCase().startsWith('create database'));

    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (e) {
        // Ignore table exists or duplicate errors
      }
    }

    // Seed default settings and users if empty
    const [settings] = await pool.query('SELECT id FROM settings LIMIT 1');
    if (settings.length === 0) {
      await pool.query(`
        INSERT INTO settings (id, farm_name, box_count, temp_min, temp_max, ph_min, ph_max)
        VALUES (1, 'Vertical Crab Farm Kochi', 40, 26.0, 32.0, 7.5, 8.5)
      `);
    }

    const [users] = await pool.query('SELECT id FROM users LIMIT 1');
    if (users.length === 0) {
      const salt = bcrypt.genSaltSync(10);
      const ownerHash = bcrypt.hashSync('admin123', salt);
      const staffHash = bcrypt.hashSync('staff123', salt);
      await pool.query(`
        INSERT INTO users (name, email, password_hash, role)
        VALUES ('Farm Owner', 'admin@crabfarm.in', ?, 'owner'),
               ('Farm Staff', 'staff@crabfarm.in', ?, 'staff')
      `, [ownerHash, staffHash]);
    }

    const [species] = await pool.query('SELECT id FROM species LIMIT 1');
    if (species.length === 0) {
      await pool.query(`
        INSERT INTO species (name) VALUES 
        ('Mud crab (Scylla serrata)'),
        ('Orange mud crab (Scylla olivacea)'),
        ('Green mud crab (Scylla paramamosain)'),
        ('Blue swimmer crab (Portunus pelagicus)'),
        ('Other')
      `);
    }

    return true;
  } catch (err) {
    console.warn('MySQL connection or initialization failed:', err.message);
    return false;
  }
}

class MySQLAdapter {
  async findUserByEmail(email) {
    const [rows] = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
    return rows[0] || null;
  }

  async findUserById(id) {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async createUser(name, email, passwordHash, role = 'staff') {
    const [res] = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, LOWER(?), ?, ?)',
      [name, email, passwordHash, role]
    );
    return { id: res.insertId, name, email: email.toLowerCase(), role, created_at: new Date().toISOString() };
  }

  async getUsers() {
    const [rows] = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY id');
    return rows;
  }

  async getSettings() {
    const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
    return rows[0] || { farm_name: '', box_count: 40, temp_min: 26, temp_max: 32, ph_min: 7.5, ph_max: 8.5 };
  }

  async updateSettings(patch) {
    const cur = await this.getSettings();
    const farmName = patch.farm_name !== undefined ? String(patch.farm_name).trim() : cur.farm_name;
    const boxCount = patch.box_count !== undefined ? parseInt(patch.box_count, 10) : cur.box_count;
    const tMin = patch.temp_min !== undefined ? (patch.temp_min !== null ? Number(patch.temp_min) : null) : cur.temp_min;
    const tMax = patch.temp_max !== undefined ? (patch.temp_max !== null ? Number(patch.temp_max) : null) : cur.temp_max;
    const pMin = patch.ph_min !== undefined ? (patch.ph_min !== null ? Number(patch.ph_min) : null) : cur.ph_min;
    const pMax = patch.ph_max !== undefined ? (patch.ph_max !== null ? Number(patch.ph_max) : null) : cur.ph_max;

    await pool.query(
      `INSERT INTO settings (id, farm_name, box_count, temp_min, temp_max, ph_min, ph_max)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE farm_name = ?, box_count = ?, temp_min = ?, temp_max = ?, ph_min = ?, ph_max = ?`,
      [farmName, boxCount, tMin, tMax, pMin, pMax, farmName, boxCount, tMin, tMax, pMin, pMax]
    );
    return this.getSettings();
  }

  async getSpecies() {
    const [rows] = await pool.query('SELECT id, name FROM species ORDER BY id');
    return rows;
  }

  async addSpecies(name) {
    const trimmed = String(name).trim();
    if (!trimmed) throw new Error('Species name cannot be empty');
    const [res] = await pool.query('INSERT INTO species (name) VALUES (?)', [trimmed]);
    return { id: res.insertId, name: trimmed };
  }

  async getUsedBatchNumbers(excludeCrabId = null, excludeBoxNo = null) {
    const map = {};
    const [invRows] = await pool.query('SELECT id, batch_no FROM inventory_crabs WHERE status = "stock"');
    invRows.forEach(r => {
      if (r.id !== excludeCrabId && r.batch_no) {
        map[r.batch_no.toLowerCase()] = 'the inventory';
      }
    });

    const [boxRows] = await pool.query('SELECT box_no, batch_no FROM boxes');
    boxRows.forEach(r => {
      if (r.box_no !== excludeBoxNo && r.batch_no) {
        map[r.batch_no.toLowerCase()] = `Box ${r.box_no}`;
      }
    });
    return map;
  }

  async getDeliveries() {
    const [rows] = await pool.query('SELECT * FROM deliveries ORDER BY received_date DESC, id DESC');
    return rows;
  }

  async getInventoryCrabs(filter = 'all') {
    let sql = `
      SELECT i.*, d.seller, d.received_date AS date
      FROM inventory_crabs i
      JOIN deliveries d ON d.id = i.delivery_id
    `;
    const params = [];
    if (filter === 'stock') {
      sql += ' WHERE i.status = "stock"';
    } else if (filter === 'moved') {
      sql += ' WHERE i.status = "moved"';
    }
    sql += ' ORDER BY d.received_date DESC, i.id DESC';

    const [rows] = await pool.query(sql, params);
    return rows;
  }

  async receiveCrabs(seller, receivedDate, species, crabs, userId = null) {
    const sName = String(seller).trim();
    if (!sName) throw new Error('Seller name is required');
    if (!receivedDate) throw new Error('Received date is required');
    if (!crabs || !Array.isArray(crabs) || crabs.length === 0) {
      throw new Error('At least one crab is required');
    }

    const usedMap = await this.getUsedBatchNumbers();
    const seen = new Set();
    for (let i = 0; i < crabs.length; i++) {
      const c = crabs[i];
      const bn = String(c.batch_no || '').trim();
      if (!bn) throw new Error(`Batch number required for crab ${i + 1}`);
      const bnLower = bn.toLowerCase();
      if (seen.has(bnLower)) throw new Error(`Batch number ${bn} is repeated in this delivery`);
      seen.add(bnLower);
      if (usedMap[bnLower]) throw new Error(`Batch number ${bn} is already in use in ${usedMap[bnLower]}`);
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [delRes] = await conn.query(
        'INSERT INTO deliveries (seller, received_date, created_by) VALUES (?, ?, ?)',
        [sName, receivedDate, userId]
      );
      const deliveryId = delRes.insertId;

      const createdCrabs = [];
      for (let i = 0; i < crabs.length; i++) {
        const c = crabs[i];
        const bn = String(c.batch_no).trim();
        const price = c.price !== null && c.price !== undefined && c.price !== '' ? Number(c.price) : null;
        const [crabRes] = await conn.query(
          `INSERT INTO inventory_crabs (delivery_id, batch_no, species, sex, weight_g, price, status, notes)
           VALUES (?, ?, ?, ?, ?, ?, 'stock', ?)`,
          [deliveryId, bn, c.species || species, c.sex || null, Math.round(Number(c.weight_g)), price, String(c.notes || '').trim()]
        );
        // insert into batch_numbers_in_use
        await conn.query('INSERT INTO batch_numbers_in_use (batch_no) VALUES (?)', [bn]);

        createdCrabs.push({
          id: crabRes.insertId,
          delivery_id: deliveryId,
          batch_no: bn,
          species: c.species || species,
          sex: c.sex || null,
          weight_g: Math.round(Number(c.weight_g)),
          price: price,
          status: 'stock',
          notes: String(c.notes || '').trim()
        });
      }

      await conn.commit();
      return { delivery: { id: deliveryId, seller: sName, received_date: receivedDate }, crabs: createdCrabs };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async updateInventoryCrab(id, patch) {
    const [rows] = await pool.query('SELECT * FROM inventory_crabs WHERE id = ?', [id]);
    const crab = rows[0];
    if (!crab) throw new Error('Crab not found');
    if (crab.status === 'moved') throw new Error('Moved crabs cannot be edited');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      let newBn = crab.batch_no;
      if (patch.batch_no !== undefined) {
        newBn = String(patch.batch_no).trim();
        if (!newBn) throw new Error('Batch number cannot be empty');
        const usedMap = await this.getUsedBatchNumbers(id);
        if (usedMap[newBn.toLowerCase()]) throw new Error(`Batch number ${newBn} is already in use in ${usedMap[newBn.toLowerCase()]}`);

        if (newBn !== crab.batch_no) {
          await conn.query('DELETE FROM batch_numbers_in_use WHERE batch_no = ?', [crab.batch_no]);
          await conn.query('INSERT INTO batch_numbers_in_use (batch_no) VALUES (?)', [newBn]);
        }
      }

      const weightG = patch.weight_g !== undefined ? parseInt(patch.weight_g, 10) : crab.weight_g;
      const price = patch.price !== undefined ? (patch.price !== null && patch.price !== '' ? Number(patch.price) : null) : crab.price;
      const sex = patch.sex !== undefined ? (patch.sex === 'M' || patch.sex === 'F' ? patch.sex : null) : crab.sex;
      const species = patch.species !== undefined ? String(patch.species).trim() : crab.species;
      const notes = patch.notes !== undefined ? String(patch.notes).trim() : crab.notes;

      await conn.query(
        `UPDATE inventory_crabs SET batch_no = ?, weight_g = ?, price = ?, sex = ?, species = ?, notes = ? WHERE id = ?`,
        [newBn, weightG, price, sex, species, notes, id]
      );

      await conn.commit();
      return { ...crab, batch_no: newBn, weight_g: weightG, price, sex, species, notes };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async removeInventoryCrab(id) {
    const [rows] = await pool.query('SELECT * FROM inventory_crabs WHERE id = ?', [id]);
    const crab = rows[0];
    if (!crab) throw new Error('Crab not found');
    if (crab.status === 'moved') throw new Error('Moved crabs cannot be removed from inventory');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM batch_numbers_in_use WHERE batch_no = ?', [crab.batch_no]);
      await conn.query('DELETE FROM inventory_crabs WHERE id = ?', [id]);
      await conn.commit();
      return { success: true };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async moveToBoxes(stockDate, assignments) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const movedBoxes = [];
      for (const a of assignments) {
        const [cRows] = await conn.query('SELECT * FROM inventory_crabs WHERE id = ?', [a.crab_id]);
        const crab = cRows[0];
        if (!crab) throw new Error(`Crab #${a.crab_id} not found`);
        if (crab.status === 'moved') throw new Error(`Crab ${crab.batch_no} is already moved`);

        const boxNo = parseInt(a.box_no, 10);
        const [bRows] = await conn.query('SELECT box_no FROM boxes WHERE box_no = ?', [boxNo]);
        if (bRows.length > 0) throw new Error(`Box ${boxNo} is already occupied`);

        const [dRows] = await conn.query('SELECT seller, received_date FROM deliveries WHERE id = ?', [crab.delivery_id]);
        const del = dRows[0];
        const batchLabel = del ? `${del.seller} · ${del.received_date}` : 'Stocked';

        await conn.query(
          `INSERT INTO boxes (box_no, status, size, species, sex, batch_no, cost, source, stock_date, initial_weight_g, notes)
           VALUES (?, 'growing', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [boxNo, crab.species, crab.sex, crab.batch_no, crab.price, batchLabel, stockDate, crab.weight_g, crab.notes]
        );

        await conn.query(
          `UPDATE inventory_crabs SET status = 'moved', moved_to_box = ?, moved_date = ? WHERE id = ?`,
          [boxNo, stockDate, crab.id]
        );

        movedBoxes.push({ box_no: boxNo, status: 'growing', batch_no: crab.batch_no });
      }

      await conn.commit();
      return movedBoxes;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async getBoxes() {
    const [boxes] = await pool.query('SELECT * FROM boxes ORDER BY box_no');
    const [weights] = await pool.query('SELECT * FROM box_weights ORDER BY box_no, weighed_on');
    const [moults] = await pool.query('SELECT * FROM box_moults ORDER BY box_no, moulted_on');
    const [moves] = await pool.query('SELECT * FROM box_moves ORDER BY box_no, moved_on');

    const wMap = {}, mMap = {}, mvMap = {};
    weights.forEach(w => { (wMap[w.box_no] = wMap[w.box_no] || []).push(w); });
    moults.forEach(m => { (mMap[m.box_no] = mMap[m.box_no] || []).push(m.moulted_on); });
    moves.forEach(mv => { (mvMap[mv.box_no] = mvMap[mv.box_no] || []).push(mv); });

    return boxes.map(b => ({
      ...b,
      weights: wMap[b.box_no] || [],
      moults: mMap[b.box_no] || [],
      moves: mvMap[b.box_no] || []
    }));
  }

  async getBox(boxNo) {
    const [rows] = await pool.query('SELECT * FROM boxes WHERE box_no = ?', [boxNo]);
    const b = rows[0];
    if (!b) return null;

    const [weights] = await pool.query('SELECT * FROM box_weights WHERE box_no = ? ORDER BY weighed_on', [boxNo]);
    const [moults] = await pool.query('SELECT moulted_on FROM box_moults WHERE box_no = ? ORDER BY moulted_on', [boxNo]);
    const [moves] = await pool.query('SELECT * FROM box_moves WHERE box_no = ? ORDER BY moved_on', [boxNo]);

    return {
      ...b,
      weights,
      moults: moults.map(m => m.moulted_on),
      moves
    };
  }

  async saveBox(boxNo, data) {
    const num = parseInt(boxNo, 10);
    const existing = await this.getBox(num);
    const status = data.status || (existing ? existing.status : 'growing');
    if (status === 'harvest' && !data.size && !(existing && existing.size)) throw new Error('Crab size is required when status is Harvest');

    const w0 = data.initial_weight_g !== undefined ? parseInt(data.initial_weight_g, 10) : (existing ? existing.initial_weight_g : NaN);
    const bn = data.batch_no !== undefined ? (data.batch_no ? String(data.batch_no).trim() : null) : (existing ? existing.batch_no : null);
    const cost = data.cost !== undefined ? (data.cost !== null && data.cost !== '' ? parseFloat(data.cost) : null) : (existing ? existing.cost : null);
    const ended = status === 'harvest' || status === 'dead';
    const endDate = ended ? (data.end_date || (existing && existing.end_date ? existing.end_date : new Date().toISOString().slice(0, 10))) : null;
    const species = data.species !== undefined ? data.species : (existing ? existing.species : 'Mud crab (Scylla serrata)');
    const sex = data.sex !== undefined ? data.sex : (existing ? existing.sex : null);
    const source = data.source !== undefined ? data.source : (existing ? existing.source : '');
    const stockDate = data.stock_date !== undefined ? data.stock_date : (existing ? existing.stock_date : new Date().toISOString().slice(0, 10));
    const notes = data.notes !== undefined ? data.notes : (existing ? existing.notes : '');
    const size = status === 'harvest' ? (data.size || (existing ? existing.size : null)) : (data.size || (existing ? existing.size : null));

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `INSERT INTO boxes (box_no, status, size, species, sex, batch_no, cost, source, stock_date, initial_weight_g, end_date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = ?, size = ?, species = ?, sex = ?, batch_no = ?, cost = ?, source = ?, stock_date = ?, initial_weight_g = ?, end_date = ?, notes = ?`,
        [num, status, size, species, sex, bn, cost, source, stockDate, w0, endDate, notes,
         status, size, species, sex, bn, cost, source, stockDate, w0, endDate, notes]
      );

      if (bn) {
        await conn.query('INSERT IGNORE INTO batch_numbers_in_use (batch_no) VALUES (?)', [bn]);
      }

      if (Array.isArray(data.weights)) {
        await conn.query('DELETE FROM box_weights WHERE box_no = ?', [num]);
        for (const w of data.weights) {
          if (w.weighed_on && w.weight_g) {
            await conn.query('INSERT INTO box_weights (box_no, weighed_on, weight_g) VALUES (?, ?, ?)', [num, w.weighed_on, parseInt(w.weight_g, 10)]);
          }
        }
      }

      if (Array.isArray(data.moults)) {
        await conn.query('DELETE FROM box_moults WHERE box_no = ?', [num]);
        for (const mDate of data.moults) {
          if (mDate) {
            await conn.query('INSERT INTO box_moults (box_no, moulted_on) VALUES (?, ?)', [num, mDate]);
          }
        }
      }

      await conn.commit();
      return this.getBox(num);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async deleteBox(boxNo) {
    const [rows] = await pool.query('SELECT batch_no FROM boxes WHERE box_no = ?', [boxNo]);
    const b = rows[0];
    if (!b) throw new Error('Box already empty');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (b.batch_no) {
        await conn.query('DELETE FROM batch_numbers_in_use WHERE batch_no = ?', [b.batch_no]);
      }
      await conn.query('DELETE FROM boxes WHERE box_no = ?', [boxNo]);
      await conn.commit();
      return { success: true };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async moveBox(fromBoxNo, toBoxNo) {
    const from = parseInt(fromBoxNo, 10);
    const to = parseInt(toBoxNo, 10);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [bRows] = await conn.query('SELECT * FROM boxes WHERE box_no = ?', [from]);
      const sourceBox = bRows[0];
      if (!sourceBox) throw new Error(`Box ${from} has no crab to move`);

      const [tRows] = await conn.query('SELECT box_no FROM boxes WHERE box_no = ?', [to]);
      if (tRows.length > 0) throw new Error(`Target box ${to} already has a crab`);

      await conn.query(
        `INSERT INTO boxes (box_no, status, size, species, sex, batch_no, cost, source, stock_date, initial_weight_g, end_date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [to, sourceBox.status, sourceBox.size, sourceBox.species, sourceBox.sex, sourceBox.batch_no, sourceBox.cost, sourceBox.source, sourceBox.stock_date, sourceBox.initial_weight_g, sourceBox.end_date, sourceBox.notes]
      );

      await conn.query('UPDATE box_weights SET box_no = ? WHERE box_no = ?', [to, from]);
      await conn.query('UPDATE box_moults SET box_no = ? WHERE box_no = ?', [to, from]);
      await conn.query('UPDATE box_moves SET box_no = ? WHERE box_no = ?', [to, from]);

      await conn.query(
        'INSERT INTO box_moves (box_no, from_box, to_box, moved_on) VALUES (?, ?, ?, ?)',
        [to, from, to, new Date().toISOString().slice(0, 10)]
      );

      await conn.query('DELETE FROM boxes WHERE box_no = ?', [from]);

      await conn.commit();
      return this.getBox(to);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async getHarvests() {
    const [harvests] = await pool.query('SELECT * FROM harvests ORDER BY harvest_date DESC, id DESC');
    const [items] = await pool.query('SELECT * FROM harvest_items');
    const [files] = await pool.query('SELECT * FROM harvest_files');

    const iMap = {}, fMap = {};
    items.forEach(it => { (iMap[it.harvest_id] = iMap[it.harvest_id] || []).push(it); });
    files.forEach(f => { (fMap[f.harvest_id] = fMap[f.harvest_id] || []).push(f); });

    return harvests.map(h => ({
      ...h,
      items: iMap[h.id] || [],
      files: fMap[h.id] || []
    }));
  }

  async getHarvest(id) {
    const [rows] = await pool.query('SELECT * FROM harvests WHERE id = ?', [id]);
    const h = rows[0];
    if (!h) return null;
    const [items] = await pool.query('SELECT * FROM harvest_items WHERE harvest_id = ?', [id]);
    const [files] = await pool.query('SELECT * FROM harvest_files WHERE harvest_id = ?', [id]);
    return { ...h, items, files };
  }

  async createHarvest(data, selectedBoxNumbers) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const totalWeightG = parseInt(data.total_weight_g, 10);
      const pricePerKg = data.price_per_kg !== null && data.price_per_kg !== undefined && data.price_per_kg !== ''
        ? parseFloat(data.price_per_kg) : null;

      const [hRes] = await conn.query(
        `INSERT INTO harvests (harvest_date, size, total_weight_g, price_per_kg, buyer, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [data.harvest_date, data.size, totalWeightG, pricePerKg, String(data.buyer || '').trim(), String(data.notes || '').trim()]
      );
      const harvestId = hRes.insertId;

      const createdItems = [];
      for (const bNo of selectedBoxNumbers) {
        const [bRows] = await conn.query('SELECT * FROM boxes WHERE box_no = ?', [bNo]);
        const b = bRows[0];
        if (!b) continue;

        const [wRows] = await conn.query('SELECT weight_g FROM box_weights WHERE box_no = ? ORDER BY weighed_on DESC LIMIT 1', [bNo]);
        const finalWeightG = wRows.length > 0 ? wRows[0].weight_g : b.initial_weight_g;

        const [mRows] = await conn.query('SELECT COUNT(*) AS c FROM box_moults WHERE box_no = ?', [bNo]);
        const moultCount = mRows[0].c;

        const [itRes] = await conn.query(
          `INSERT INTO harvest_items (harvest_id, box_no, batch_no, size, species, sex, stock_date, initial_weight_g, final_weight_g, moult_count, cost)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [harvestId, b.box_no, b.batch_no, b.size || data.size, b.species, b.sex, b.stock_date, b.initial_weight_g, finalWeightG, moultCount, b.cost]
        );

        createdItems.push({
          id: itRes.insertId,
          harvest_id: harvestId,
          box_no: b.box_no,
          batch_no: b.batch_no,
          size: b.size || data.size,
          species: b.species,
          sex: b.sex,
          stock_date: b.stock_date,
          initial_weight_g: b.initial_weight_g,
          final_weight_g: finalWeightG,
          moult_count: moultCount,
          cost: b.cost
        });

        // Delete from batch_numbers_in_use
        if (b.batch_no) {
          await conn.query('DELETE FROM batch_numbers_in_use WHERE batch_no = ?', [b.batch_no]);
        }

        // Delete box
        await conn.query('DELETE FROM boxes WHERE box_no = ?', [b.box_no]);
      }

      await conn.commit();
      return { id: harvestId, ...data, total_weight_g: totalWeightG, price_per_kg: pricePerKg, items: createdItems, files: [] };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async updateHarvest(id, patch) {
    const cur = await this.getHarvest(id);
    if (!cur) throw new Error('Harvest not found');

    const hDate = patch.harvest_date || cur.harvest_date;
    const size = patch.size || cur.size;
    const totalG = patch.total_weight_g !== undefined ? parseInt(patch.total_weight_g, 10) : cur.total_weight_g;
    const priceKg = patch.price_per_kg !== undefined ? (patch.price_per_kg !== null && patch.price_per_kg !== '' ? parseFloat(patch.price_per_kg) : null) : cur.price_per_kg;
    const buyer = patch.buyer !== undefined ? String(patch.buyer).trim() : cur.buyer;
    const notes = patch.notes !== undefined ? String(patch.notes).trim() : cur.notes;

    await pool.query(
      `UPDATE harvests SET harvest_date = ?, size = ?, total_weight_g = ?, price_per_kg = ?, buyer = ?, notes = ? WHERE id = ?`,
      [hDate, size, totalG, priceKg, buyer, notes, id]
    );

    return this.getHarvest(id);
  }

  async deleteHarvest(id) {
    await pool.query('DELETE FROM harvests WHERE id = ?', [id]);
    return { success: true };
  }

  async addHarvestFile(harvestId, fileName, fileUrl, sizeBytes) {
    const [res] = await pool.query(
      `INSERT INTO harvest_files (harvest_id, file_name, file_url, size_bytes) VALUES (?, ?, ?, ?)`,
      [harvestId, fileName, fileUrl, sizeBytes]
    );
    return { id: res.insertId, harvest_id: harvestId, file_name: fileName, file_url: fileUrl, size_bytes: sizeBytes };
  }

  async removeHarvestFile(fileId) {
    await pool.query('DELETE FROM harvest_files WHERE id = ?', [fileId]);
    return { success: true };
  }

  async getProfitByBatch() {
    // Exact SQL query from the prompt!
    const sql = `
      SELECT i.batch_no, h.harvest_date, i.box_no, i.final_weight_g,
             i.cost AS buying_price,
             h.price_per_kg * (h.total_weight_g/1000) * i.final_weight_g
               / SUM(i.final_weight_g) OVER (PARTITION BY h.id) AS selling_price,
             h.price_per_kg * (h.total_weight_g/1000) * i.final_weight_g
               / SUM(i.final_weight_g) OVER (PARTITION BY h.id) - i.cost AS profit
      FROM harvest_items i JOIN harvests h ON h.id = i.harvest_id
      WHERE i.batch_no IS NOT NULL
      ORDER BY h.harvest_date DESC;
    `;
    const [rows] = await pool.query(sql);
    return rows.map(r => ({
      batch_no: r.batch_no,
      harvest_date: r.harvest_date,
      box_no: r.box_no,
      final_weight_g: r.final_weight_g,
      buying_price: r.buying_price !== null ? Number(r.buying_price) : null,
      selling_price: r.selling_price !== null ? Number(Number(r.selling_price).toFixed(2)) : null,
      profit: r.profit !== null ? Number(Number(r.profit).toFixed(2)) : null
    }));
  }

  async getMonitorReadings(sinceTimestamp = null) {
    let sql = 'SELECT * FROM monitor_readings';
    const params = [];
    if (sinceTimestamp) {
      sql += ' WHERE recorded_at >= ?';
      params.push(sinceTimestamp);
    }
    sql += ' ORDER BY recorded_at ASC';
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  async addMonitorReading(recordedAt, tempC, ph, source = 'manual') {
    const t = tempC !== null && tempC !== undefined && tempC !== '' ? parseFloat(tempC) : null;
    const p = ph !== null && ph !== undefined && ph !== '' ? parseFloat(ph) : null;
    const time = recordedAt || new Date().toISOString().slice(0, 19).replace('T', ' ');

    const [res] = await pool.query(
      'INSERT INTO monitor_readings (recorded_at, temperature_c, ph, source) VALUES (?, ?, ?, ?)',
      [time, t, p, source || 'manual']
    );
    return { id: res.insertId, recorded_at: time, temperature_c: t, ph, source };
  }

  async importMonitorReadings(readings) {
    if (!Array.isArray(readings) || readings.length === 0) throw new Error('No readings provided');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let count = 0;
      for (const r of readings) {
        const t = r.temp !== null && r.temp !== undefined && r.temp !== '' ? parseFloat(r.temp) : null;
        const p = r.ph !== null && r.ph !== undefined && r.ph !== '' ? parseFloat(r.ph) : null;
        if (t === null && p === null) continue;
        const time = r.time || new Date().toISOString().slice(0, 19).replace('T', ' ');
        await conn.query(
          'INSERT INTO monitor_readings (recorded_at, temperature_c, ph, source) VALUES (?, ?, ?, ?)',
          [time, t, p, r.source || 'csv_import']
        );
        count++;
      }
      await conn.commit();
      return { count };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = {
  initMySQL,
  MySQLAdapter: new MySQLAdapter()
};
