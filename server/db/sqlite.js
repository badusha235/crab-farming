const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.resolve(process.cwd(), './data');
const DB_PATH = path.join(DATA_DIR, 'crab_register.sqlite');
const JSON_BACKUP = path.join(DATA_DIR, 'crab_register.json');

let db = null;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, err => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function initSQLite() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new sqlite3.Database(DB_PATH);

  // Enable foreign keys and WAL mode for high concurrency & ACID durability
  await exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

  // Schema creation
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NULL UNIQUE,
      phone TEXT NULL UNIQUE,
      password_hash TEXT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS otps (
      phone TEXT PRIMARY KEY,
      otp TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      farm_name TEXT NOT NULL DEFAULT '',
      box_count INTEGER NOT NULL DEFAULT 40,
      temp_min REAL NULL,
      temp_max REAL NULL,
      ph_min REAL NULL,
      ph_max REAL NULL
    );

    CREATE TABLE IF NOT EXISTS species (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS batch_numbers_in_use (
      batch_no TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller TEXT NOT NULL,
      received_date TEXT NOT NULL,
      created_by INTEGER NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_crabs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL,
      batch_no TEXT NOT NULL,
      species TEXT NOT NULL,
      sex TEXT NULL,
      weight_g INTEGER NOT NULL,
      price REAL NULL,
      status TEXT NOT NULL DEFAULT 'stock',
      moved_to_box INTEGER NULL,
      moved_date TEXT NULL,
      notes TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_inv_status ON inventory_crabs(status);
    CREATE INDEX IF NOT EXISTS idx_inv_batch ON inventory_crabs(batch_no);

    CREATE TABLE IF NOT EXISTS boxes (
      box_no INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'growing',
      size TEXT NULL,
      species TEXT NOT NULL,
      sex TEXT NULL,
      batch_no TEXT NULL UNIQUE,
      cost REAL NULL,
      source TEXT NOT NULL DEFAULT '',
      stock_date TEXT NOT NULL,
      initial_weight_g INTEGER NOT NULL,
      end_date TEXT NULL,
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS box_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      box_no INTEGER NOT NULL,
      weighed_on TEXT NOT NULL,
      weight_g INTEGER NOT NULL,
      FOREIGN KEY (box_no) REFERENCES boxes(box_no) ON DELETE CASCADE ON UPDATE CASCADE
    );

    CREATE TABLE IF NOT EXISTS box_moults (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      box_no INTEGER NOT NULL,
      moulted_on TEXT NOT NULL,
      FOREIGN KEY (box_no) REFERENCES boxes(box_no) ON DELETE CASCADE ON UPDATE CASCADE
    );

    CREATE TABLE IF NOT EXISTS box_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      box_no INTEGER NOT NULL,
      from_box INTEGER NOT NULL,
      to_box INTEGER NOT NULL,
      moved_on TEXT NOT NULL,
      FOREIGN KEY (box_no) REFERENCES boxes(box_no) ON DELETE CASCADE ON UPDATE CASCADE
    );

    CREATE TABLE IF NOT EXISTS harvests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      harvest_date TEXT NOT NULL,
      size TEXT NULL,
      total_weight_g INTEGER NOT NULL,
      price_per_kg REAL NULL,
      buyer TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS harvest_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      harvest_id INTEGER NOT NULL,
      box_no INTEGER NOT NULL,
      batch_no TEXT NULL,
      size TEXT NULL,
      species TEXT NULL,
      sex TEXT NULL,
      stock_date TEXT NULL,
      initial_weight_g INTEGER NULL,
      final_weight_g INTEGER NOT NULL,
      moult_count INTEGER NOT NULL DEFAULT 0,
      cost REAL NULL,
      FOREIGN KEY (harvest_id) REFERENCES harvests(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_harvest_batch ON harvest_items(batch_no);

    CREATE TABLE IF NOT EXISTS harvest_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      harvest_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      FOREIGN KEY (harvest_id) REFERENCES harvests(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS monitor_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT NOT NULL,
      temperature_c REAL NULL,
      ph REAL NULL,
      source TEXT NOT NULL DEFAULT 'manual'
    );
    CREATE INDEX IF NOT EXISTS idx_mon_recorded ON monitor_readings(recorded_at);
  `);

  // Check if users exist; if not seed or import from json
  const userCount = await get('SELECT COUNT(*) as c FROM users');
  if (userCount.c === 0) {
    if (fs.existsSync(JSON_BACKUP)) {
      await importFromJson(JSON_BACKUP);
    } else {
      await seedDefaults();
    }
  }

  return true;
}

async function seedDefaults() {
  const salt = bcrypt.genSaltSync(10);
  const ownerHash = bcrypt.hashSync('admin123', salt);
  const staffHash = bcrypt.hashSync('staff123', salt);

  await run(`
    INSERT INTO users (name, email, password_hash, role)
    VALUES ('Farm Owner', 'admin@crabfarm.in', ?, 'owner'),
           ('Farm Staff', 'staff@crabfarm.in', ?, 'staff')
  `, [ownerHash, staffHash]);

  await run(`
    INSERT INTO settings (id, farm_name, box_count, temp_min, temp_max, ph_min, ph_max)
    VALUES (1, 'Vertical Crab Farm Kochi', 40, 26.0, 32.0, 7.5, 8.5)
  `);

  const speciesList = [
    'Mud crab (Scylla serrata)',
    'Orange mud crab (Scylla olivacea)',
    'Green mud crab (Scylla paramamosain)',
    'Blue swimmer crab (Portunus pelagicus)',
    'Other'
  ];
  for (const s of speciesList) {
    await run('INSERT OR IGNORE INTO species (name) VALUES (?)', [s]);
  }
}

async function importFromJson(jsonPath) {
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);

    // Users
    if (Array.isArray(data.users) && data.users.length) {
      for (const u of data.users) {
        await run('INSERT OR REPLACE INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [u.id, u.name, u.email, u.password_hash, u.role, u.created_at || new Date().toISOString()]);
      }
    } else {
      await seedDefaults();
    }

    // Settings
    if (data.settings) {
      const s = data.settings;
      await run('INSERT OR REPLACE INTO settings (id, farm_name, box_count, temp_min, temp_max, ph_min, ph_max) VALUES (1, ?, ?, ?, ?, ?, ?)',
        [s.farm_name, s.box_count, s.temp_min, s.temp_max, s.ph_min, s.ph_max]);
    }

    // Species
    if (Array.isArray(data.species)) {
      for (const sp of data.species) {
        await run('INSERT OR REPLACE INTO species (id, name) VALUES (?, ?)', [sp.id, sp.name]);
      }
    }

    // Deliveries
    if (Array.isArray(data.deliveries)) {
      for (const d of data.deliveries) {
        await run('INSERT OR REPLACE INTO deliveries (id, seller, received_date, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
          [d.id, d.seller, d.received_date, d.created_by, d.created_at]);
      }
    }

    // Inventory crabs
    if (Array.isArray(data.inventory_crabs)) {
      for (const c of data.inventory_crabs) {
        await run('INSERT OR REPLACE INTO inventory_crabs (id, delivery_id, batch_no, species, sex, weight_g, price, status, moved_to_box, moved_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [c.id, c.delivery_id, c.batch_no, c.species, c.sex, c.weight_g, c.price, c.status, c.moved_to_box, c.moved_date, c.notes || '']);
        if (c.status === 'stock' && c.batch_no) {
          await run('INSERT OR IGNORE INTO batch_numbers_in_use (batch_no) VALUES (?)', [c.batch_no]);
        }
      }
    }

    // Boxes
    if (data.boxes && typeof data.boxes === 'object') {
      for (const bNo in data.boxes) {
        const b = data.boxes[bNo];
        if (!b) continue;
        await run('INSERT OR REPLACE INTO boxes (box_no, status, size, species, sex, batch_no, cost, source, stock_date, initial_weight_g, end_date, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [b.box_no, b.status, b.size, b.species, b.sex, b.batch_no, b.cost, b.source || '', b.stock_date, b.initial_weight_g, b.end_date, b.notes || '', b.updated_at || new Date().toISOString()]);
        if (b.batch_no) {
          await run('INSERT OR IGNORE INTO batch_numbers_in_use (batch_no) VALUES (?)', [b.batch_no]);
        }
      }
    }

    // Box weights, moults, moves
    if (Array.isArray(data.box_weights)) {
      for (const w of data.box_weights) {
        await run('INSERT OR REPLACE INTO box_weights (id, box_no, weighed_on, weight_g) VALUES (?, ?, ?, ?)',
          [w.id, w.box_no, w.weighed_on, w.weight_g]);
      }
    }
    if (Array.isArray(data.box_moults)) {
      for (const m of data.box_moults) {
        await run('INSERT OR REPLACE INTO box_moults (id, box_no, moulted_on) VALUES (?, ?, ?)',
          [m.id, m.box_no, m.moulted_on]);
      }
    }
    if (Array.isArray(data.box_moves)) {
      for (const mv of data.box_moves) {
        await run('INSERT OR REPLACE INTO box_moves (id, box_no, from_box, to_box, moved_on) VALUES (?, ?, ?, ?, ?)',
          [mv.id, mv.box_no, mv.from_box, mv.to_box, mv.moved_on]);
      }
    }

    // Harvests
    if (Array.isArray(data.harvests)) {
      for (const h of data.harvests) {
        await run('INSERT OR REPLACE INTO harvests (id, harvest_date, size, total_weight_g, price_per_kg, buyer, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [h.id, h.harvest_date, h.size, h.total_weight_g, h.price_per_kg, h.buyer || '', h.notes || '', h.created_at || new Date().toISOString()]);
      }
    }
    if (Array.isArray(data.harvest_items)) {
      for (const it of data.harvest_items) {
        await run('INSERT OR REPLACE INTO harvest_items (id, harvest_id, box_no, batch_no, size, species, sex, stock_date, initial_weight_g, final_weight_g, moult_count, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [it.id, it.harvest_id, it.box_no, it.batch_no, it.size, it.species, it.sex, it.stock_date, it.initial_weight_g, it.final_weight_g, it.moult_count || 0, it.cost]);
      }
    }
    if (Array.isArray(data.harvest_files)) {
      for (const f of data.harvest_files) {
        await run('INSERT OR REPLACE INTO harvest_files (id, harvest_id, file_name, file_url, size_bytes) VALUES (?, ?, ?, ?, ?)',
          [f.id, f.harvest_id, f.file_name, f.file_url, f.size_bytes]);
      }
    }

    // Monitor readings
    if (Array.isArray(data.monitor_readings)) {
      for (const r of data.monitor_readings) {
        await run('INSERT OR REPLACE INTO monitor_readings (id, recorded_at, temperature_c, ph, source) VALUES (?, ?, ?, ?, ?)',
          [r.id, r.recorded_at, r.temperature_c, r.ph, r.source || 'manual']);
      }
    }
    console.log('Migrated data from crab_register.json into SQLite successfully.');
  } catch (err) {
    console.warn('Failed to import JSON data into SQLite:', err.message);
    await seedDefaults();
  }
}

class SQLiteAdapter {
  async findUserByEmail(email) {
    return get('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
  }

  async findUserById(id) {
    return get('SELECT * FROM users WHERE id = ?', [id]);
  }

  async createUser(name, email, passwordHash, role = 'staff') {
    const res = await run(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, LOWER(?), ?, ?)',
      [name, email, passwordHash, role]
    );
    return { id: res.lastID, name, email: email.toLowerCase(), role, created_at: new Date().toISOString() };
  }

  async getUsers() {
    return all('SELECT id, name, email, role, created_at FROM users ORDER BY id');
  }

  async getSettings() {
    const s = await get('SELECT * FROM settings WHERE id = 1');
    return s || { farm_name: '', box_count: 40, temp_min: 26, temp_max: 32, ph_min: 7.5, ph_max: 8.5 };
  }

  async updateSettings(patch) {
    const cur = await this.getSettings();
    const farmName = patch.farm_name !== undefined ? String(patch.farm_name).trim() : cur.farm_name;
    const boxCount = patch.box_count !== undefined ? parseInt(patch.box_count, 10) : cur.box_count;
    const tMin = patch.temp_min !== undefined ? (patch.temp_min !== null ? Number(patch.temp_min) : null) : cur.temp_min;
    const tMax = patch.temp_max !== undefined ? (patch.temp_max !== null ? Number(patch.temp_max) : null) : cur.temp_max;
    const pMin = patch.ph_min !== undefined ? (patch.ph_min !== null ? Number(patch.ph_min) : null) : cur.ph_min;
    const pMax = patch.ph_max !== undefined ? (patch.ph_max !== null ? Number(patch.ph_max) : null) : cur.ph_max;

    await run(
      `INSERT INTO settings (id, farm_name, box_count, temp_min, temp_max, ph_min, ph_max)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET farm_name = excluded.farm_name, box_count = excluded.box_count, temp_min = excluded.temp_min, temp_max = excluded.temp_max, ph_min = excluded.ph_min, ph_max = excluded.ph_max`,
      [farmName, boxCount, tMin, tMax, pMin, pMax]
    );
    return this.getSettings();
  }

  async getSpecies() {
    return all('SELECT id, name FROM species ORDER BY id');
  }

  async addSpecies(name) {
    const trimmed = String(name).trim();
    if (!trimmed) throw new Error('Species name cannot be empty');
    const res = await run('INSERT INTO species (name) VALUES (?)', [trimmed]);
    return { id: res.lastID, name: trimmed };
  }

  async getUsedBatchNumbers(excludeCrabId = null, excludeBoxNo = null) {
    const map = {};
    const invRows = await all('SELECT id, batch_no FROM inventory_crabs WHERE status = "stock"');
    invRows.forEach(r => {
      if (r.batch_no && r.id !== excludeCrabId) {
        map[r.batch_no.toLowerCase()] = 'the inventory';
      }
    });

    const boxRows = await all('SELECT box_no, batch_no FROM boxes');
    boxRows.forEach(r => {
      if (r.batch_no && r.box_no !== excludeBoxNo) {
        map[r.batch_no.toLowerCase()] = `Box ${r.box_no}`;
      }
    });

    return map;
  }

  async getDeliveries() {
    return all('SELECT * FROM deliveries ORDER BY received_date DESC, id DESC');
  }

  async getInventoryCrabs(filter = 'all') {
    let sql = `
      SELECT c.*, d.seller, d.received_date as date
      FROM inventory_crabs c
      JOIN deliveries d ON d.id = c.delivery_id
    `;
    const params = [];
    if (filter === 'stock') {
      sql += ' WHERE c.status = "stock"';
    } else if (filter === 'moved') {
      sql += ' WHERE c.status = "moved"';
    }
    sql += ' ORDER BY d.received_date DESC, c.id DESC';
    return all(sql, params);
  }

  async receiveCrabs(seller, receivedDate, species, crabs, userId = null) {
    const sName = String(seller).trim();
    if (!sName) throw new Error('Seller name is required');
    if (!receivedDate) throw new Error('Received date is required');
    if (!crabs || !Array.isArray(crabs) || crabs.length === 0) throw new Error('At least one crab is required');

    const seen = new Set();
    const usedMap = await this.getUsedBatchNumbers();

    for (let i = 0; i < crabs.length; i++) {
      const c = crabs[i];
      const bn = String(c.batch_no || '').trim();
      if (!bn) throw new Error(`Batch number required for crab ${i + 1}`);
      const bnLower = bn.toLowerCase();
      if (seen.has(bnLower)) throw new Error(`Batch number ${bn} is repeated in this delivery`);
      seen.add(bnLower);
      if (usedMap[bnLower]) throw new Error(`Batch number ${bn} is already in use in ${usedMap[bnLower]}`);

      const g = parseInt(c.weight_g, 10);
      if (isNaN(g) || g <= 0) throw new Error(`Weight must be positive for crab ${i + 1}`);
      if (c.price !== null && c.price !== undefined && c.price !== '') {
        const p = parseFloat(c.price);
        if (isNaN(p) || p < 0) throw new Error(`Price cannot be negative for crab ${i + 1}`);
      }
    }

    await exec('BEGIN TRANSACTION');
    try {
      const dRes = await run(
        'INSERT INTO deliveries (seller, received_date, created_by) VALUES (?, ?, ?)',
        [sName, receivedDate, userId]
      );
      const deliveryId = dRes.lastID;

      const createdCrabs = [];
      for (const c of crabs) {
        const bn = String(c.batch_no).trim();
        const weightG = parseInt(c.weight_g, 10);
        const price = c.price !== null && c.price !== undefined && c.price !== '' ? parseFloat(c.price) : null;
        const sex = c.sex === 'M' || c.sex === 'F' ? c.sex : null;
        const notes = c.notes ? String(c.notes).trim() : '';

        const cRes = await run(
          `INSERT INTO inventory_crabs (delivery_id, batch_no, species, sex, weight_g, price, status, notes)
           VALUES (?, ?, ?, ?, ?, ?, 'stock', ?)`,
          [deliveryId, bn, species, sex, weightG, price, notes]
        );

        await run('INSERT OR IGNORE INTO batch_numbers_in_use (batch_no) VALUES (?)', [bn]);

        createdCrabs.push({
          id: cRes.lastID,
          delivery_id: deliveryId,
          batch_no: bn,
          species,
          sex,
          weight_g: weightG,
          price,
          status: 'stock',
          moved_to_box: null,
          moved_date: null,
          notes,
          seller: sName,
          date: receivedDate
        });
      }

      await exec('COMMIT');
      return {
        delivery: { id: deliveryId, seller: sName, received_date: receivedDate, created_by: userId },
        crabs: createdCrabs
      };
    } catch (err) {
      await exec('ROLLBACK');
      throw err;
    }
  }

  async updateInventoryCrab(id, patch) {
    const crab = await get('SELECT * FROM inventory_crabs WHERE id = ?', [id]);
    if (!crab) throw new Error('Crab not found');
    if (crab.status === 'moved') throw new Error('Moved crabs cannot be edited');

    await exec('BEGIN TRANSACTION');
    try {
      let newBn = crab.batch_no;
      if (patch.batch_no !== undefined) {
        newBn = String(patch.batch_no).trim();
        if (!newBn) throw new Error('Batch number cannot be empty');
        const usedMap = await this.getUsedBatchNumbers(id);
        if (usedMap[newBn.toLowerCase()]) throw new Error(`Batch number ${newBn} is already in use in ${usedMap[newBn.toLowerCase()]}`);

        if (newBn !== crab.batch_no) {
          await run('DELETE FROM batch_numbers_in_use WHERE batch_no = ?', [crab.batch_no]);
          await run('INSERT OR IGNORE INTO batch_numbers_in_use (batch_no) VALUES (?)', [newBn]);
        }
      }

      const weightG = patch.weight_g !== undefined ? parseInt(patch.weight_g, 10) : crab.weight_g;
      const price = patch.price !== undefined ? (patch.price !== null && patch.price !== '' ? Number(patch.price) : null) : crab.price;
      const sex = patch.sex !== undefined ? (patch.sex === 'M' || patch.sex === 'F' ? patch.sex : null) : crab.sex;
      const species = patch.species !== undefined ? String(patch.species).trim() : crab.species;
      const notes = patch.notes !== undefined ? String(patch.notes).trim() : crab.notes;

      await run(
        `UPDATE inventory_crabs SET batch_no = ?, weight_g = ?, price = ?, sex = ?, species = ?, notes = ? WHERE id = ?`,
        [newBn, weightG, price, sex, species, notes, id]
      );

      await exec('COMMIT');
      return { ...crab, batch_no: newBn, weight_g: weightG, price, sex, species, notes };
    } catch (err) {
      await exec('ROLLBACK');
      throw err;
    }
  }

  async removeInventoryCrab(id) {
    const crab = await get('SELECT * FROM inventory_crabs WHERE id = ?', [id]);
    if (!crab) throw new Error('Crab not found');
    if (crab.status === 'moved') throw new Error('Moved crabs cannot be removed from inventory');

    await exec('BEGIN TRANSACTION');
    try {
      await run('DELETE FROM batch_numbers_in_use WHERE batch_no = ?', [crab.batch_no]);
      await run('DELETE FROM inventory_crabs WHERE id = ?', [id]);
      await exec('COMMIT');
      return { success: true };
    } catch (err) {
      await exec('ROLLBACK');
      throw err;
    }
  }

  async moveToBoxes(stockDate, assignments) {
    await exec('BEGIN TRANSACTION');
    try {
      const movedBoxes = [];
      for (const a of assignments) {
        const crab = await get('SELECT * FROM inventory_crabs WHERE id = ?', [a.crab_id]);
        if (!crab) throw new Error(`Crab #${a.crab_id} not found`);
        if (crab.status === 'moved') throw new Error(`Crab ${crab.batch_no} is already moved`);

        const boxNo = parseInt(a.box_no, 10);
        const existing = await get('SELECT box_no FROM boxes WHERE box_no = ?', [boxNo]);
        if (existing) throw new Error(`Box ${boxNo} is already occupied`);

        const del = await get('SELECT seller, received_date FROM deliveries WHERE id = ?', [crab.delivery_id]);
        const batchLabel = del ? `${del.seller} · ${del.received_date}` : 'Stocked';

        await run(
          `INSERT INTO boxes (box_no, status, size, species, sex, batch_no, cost, source, stock_date, initial_weight_g, notes)
           VALUES (?, 'growing', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [boxNo, crab.species, crab.sex, crab.batch_no, crab.price, batchLabel, stockDate, crab.weight_g, crab.notes]
        );

        await run(
          `UPDATE inventory_crabs SET status = 'moved', moved_to_box = ?, moved_date = ? WHERE id = ?`,
          [boxNo, stockDate, crab.id]
        );

        movedBoxes.push({ box_no: boxNo, status: 'growing', batch_no: crab.batch_no });
      }

      await exec('COMMIT');
      return movedBoxes;
    } catch (err) {
      await exec('ROLLBACK');
      throw err;
    }
  }

  async getBoxes() {
    const boxes = await all('SELECT * FROM boxes ORDER BY box_no');
    const weights = await all('SELECT * FROM box_weights ORDER BY box_no, weighed_on');
    const moults = await all('SELECT * FROM box_moults ORDER BY box_no, moulted_on');
    const moves = await all('SELECT * FROM box_moves ORDER BY box_no, moved_on');

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
    const b = await get('SELECT * FROM boxes WHERE box_no = ?', [boxNo]);
    if (!b) return null;

    const weights = await all('SELECT * FROM box_weights WHERE box_no = ? ORDER BY weighed_on', [boxNo]);
    const moults = await all('SELECT moulted_on FROM box_moults WHERE box_no = ? ORDER BY moulted_on', [boxNo]);
    const moves = await all('SELECT * FROM box_moves WHERE box_no = ? ORDER BY moved_on', [boxNo]);

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
    const size = data.size !== undefined ? data.size : (existing ? existing.size : null);

    await exec('BEGIN TRANSACTION');
    try {
      await run(
        `INSERT INTO boxes (box_no, status, size, species, sex, batch_no, cost, source, stock_date, initial_weight_g, end_date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(box_no) DO UPDATE SET
           status = excluded.status,
           size = excluded.size,
           species = excluded.species,
           sex = excluded.sex,
           batch_no = excluded.batch_no,
           cost = excluded.cost,
           source = excluded.source,
           stock_date = excluded.stock_date,
           initial_weight_g = excluded.initial_weight_g,
           end_date = excluded.end_date,
           notes = excluded.notes,
           updated_at = CURRENT_TIMESTAMP`,
        [num, status, size, species, sex, bn, cost, source, stockDate, w0, endDate, notes]
      );

      if (bn) {
        await run('INSERT OR IGNORE INTO batch_numbers_in_use (batch_no) VALUES (?)', [bn]);
      }

      if (Array.isArray(data.weights)) {
        await run('DELETE FROM box_weights WHERE box_no = ?', [num]);
        for (const w of data.weights) {
          if (w.weighed_on && w.weight_g) {
            await run('INSERT INTO box_weights (box_no, weighed_on, weight_g) VALUES (?, ?, ?)', [num, w.weighed_on, parseInt(w.weight_g, 10)]);
          }
        }
      }

      if (Array.isArray(data.moults)) {
        await run('DELETE FROM box_moults WHERE box_no = ?', [num]);
        for (const mDate of data.moults) {
          if (mDate) {
            await run('INSERT INTO box_moults (box_no, moulted_on) VALUES (?, ?)', [num, mDate]);
          }
        }
      }

      await exec('COMMIT');
      return this.getBox(num);
    } catch (err) {
      await exec('ROLLBACK');
      throw err;
    }
  }

  async deleteBox(boxNo) {
    const num = parseInt(boxNo, 10);
    const existing = await this.getBox(num);
    if (!existing) return { success: true };

    await exec('BEGIN TRANSACTION');
    try {
      if (existing.batch_no) {
        await run('DELETE FROM batch_numbers_in_use WHERE batch_no = ?', [existing.batch_no]);
      }
      await run('DELETE FROM boxes WHERE box_no = ?', [num]);
      await exec('COMMIT');
      return { success: true };
    } catch (err) {
      await exec('ROLLBACK');
      throw err;
    }
  }

  async moveBox(fromBoxNo, toBoxNo) {
    const from = parseInt(fromBoxNo, 10);
    const to = parseInt(toBoxNo, 10);

    if (isNaN(from) || isNaN(to) || to < 1 || to > 500) {
      throw new Error('Target box number must be between 1 and 500');
    }
    if (from === to) {
      throw new Error('Target box is the same as current box');
    }

    await exec('BEGIN TRANSACTION');
    try {
      const sourceBox = await get('SELECT * FROM boxes WHERE box_no = ?', [from]);
      if (!sourceBox) throw new Error(`Box ${from} has no crab to move`);

      const targetBox = await get('SELECT box_no FROM boxes WHERE box_no = ?', [to]);
      if (targetBox) throw new Error(`Target box ${to} already has a crab`);

      // 1. Update the box number directly on the boxes table so batch_no is never duplicated
      await run('UPDATE boxes SET box_no = ? WHERE box_no = ?', [to, from]);

      // 2. Ensure related tables point to target box (if not cascaded automatically)
      await run('UPDATE box_weights SET box_no = ? WHERE box_no = ?', [to, from]);
      await run('UPDATE box_moults SET box_no = ? WHERE box_no = ?', [to, from]);
      await run('UPDATE box_moves SET box_no = ? WHERE box_no = ?', [to, from]);

      // 3. Record this move
      const todayDate = new Date().toISOString().slice(0, 10);
      await run(
        'INSERT INTO box_moves (box_no, from_box, to_box, moved_on) VALUES (?, ?, ?, ?)',
        [to, from, to, todayDate]
      );

      // 4. Update inventory_crabs reference if this crab originated from inventory
      if (sourceBox.batch_no) {
        await run(
          'UPDATE inventory_crabs SET moved_to_box = ? WHERE batch_no = ? AND status = "moved"',
          [to, sourceBox.batch_no]
        );
      }

      await exec('COMMIT');
      return this.getBox(to);
    } catch (err) {
      await exec('ROLLBACK');
      throw err;
    }
  }

  async getHarvests() {
    const harvests = await all('SELECT * FROM harvests ORDER BY harvest_date DESC, id DESC');
    const items = await all('SELECT * FROM harvest_items');
    const files = await all('SELECT * FROM harvest_files');

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
    const h = await get('SELECT * FROM harvests WHERE id = ?', [id]);
    if (!h) return null;
    const items = await all('SELECT * FROM harvest_items WHERE harvest_id = ?', [id]);
    const files = await all('SELECT * FROM harvest_files WHERE harvest_id = ?', [id]);
    return { ...h, items, files };
  }

  async createHarvest(data, selectedBoxNumbers) {
    await exec('BEGIN TRANSACTION');
    try {
      const totalWeightG = parseInt(data.total_weight_g, 10);
      const pricePerKg = data.price_per_kg !== null && data.price_per_kg !== undefined && data.price_per_kg !== ''
        ? parseFloat(data.price_per_kg) : null;

      const hRes = await run(
        `INSERT INTO harvests (harvest_date, size, total_weight_g, price_per_kg, buyer, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [data.harvest_date, data.size, totalWeightG, pricePerKg, String(data.buyer || '').trim(), String(data.notes || '').trim()]
      );
      const harvestId = hRes.lastID;

      const createdItems = [];
      for (const bNo of selectedBoxNumbers) {
        const b = await get('SELECT * FROM boxes WHERE box_no = ?', [bNo]);
        if (!b) continue;

        const wRow = await get('SELECT weight_g FROM box_weights WHERE box_no = ? ORDER BY weighed_on DESC, id DESC LIMIT 1', [bNo]);
        const finalWeightG = wRow ? wRow.weight_g : b.initial_weight_g;

        const mRow = await get('SELECT COUNT(*) AS c FROM box_moults WHERE box_no = ?', [bNo]);
        const moultCount = mRow ? mRow.c : 0;

        const itRes = await run(
          `INSERT INTO harvest_items (harvest_id, box_no, batch_no, size, species, sex, stock_date, initial_weight_g, final_weight_g, moult_count, cost)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [harvestId, b.box_no, b.batch_no, b.size || data.size, b.species, b.sex, b.stock_date, b.initial_weight_g, finalWeightG, moultCount, b.cost]
        );

        createdItems.push({
          id: itRes.lastID,
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

        if (b.batch_no) {
          await run('DELETE FROM batch_numbers_in_use WHERE batch_no = ?', [b.batch_no]);
        }

        await run('DELETE FROM boxes WHERE box_no = ?', [b.box_no]);
      }

      await exec('COMMIT');
      return { id: harvestId, ...data, total_weight_g: totalWeightG, price_per_kg: pricePerKg, items: createdItems, files: [] };
    } catch (err) {
      await exec('ROLLBACK');
      throw err;
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

    await run(
      `UPDATE harvests SET harvest_date = ?, size = ?, total_weight_g = ?, price_per_kg = ?, buyer = ?, notes = ? WHERE id = ?`,
      [hDate, size, totalG, priceKg, buyer, notes, id]
    );

    return this.getHarvest(id);
  }

  async deleteHarvest(id) {
    await run('DELETE FROM harvests WHERE id = ?', [id]);
    return { success: true };
  }

  async addHarvestFile(harvestId, fileName, fileUrl, sizeBytes) {
    const res = await run(
      `INSERT INTO harvest_files (harvest_id, file_name, file_url, size_bytes) VALUES (?, ?, ?, ?)`,
      [harvestId, fileName, fileUrl, sizeBytes]
    );
    return { id: res.lastID, harvest_id: harvestId, file_name: fileName, file_url: fileUrl, size_bytes: sizeBytes };
  }

  async removeHarvestFile(fileId) {
    await run('DELETE FROM harvest_files WHERE id = ?', [fileId]);
    return { success: true };
  }

  async getProfitByBatch() {
    const sql = `
      SELECT i.batch_no, h.harvest_date, i.box_no, i.final_weight_g,
             i.cost AS buying_price,
             h.price_per_kg * (CAST(h.total_weight_g AS REAL) / 1000.0) * i.final_weight_g
               / SUM(i.final_weight_g) OVER (PARTITION BY h.id) AS selling_price,
             h.price_per_kg * (CAST(h.total_weight_g AS REAL) / 1000.0) * i.final_weight_g
               / SUM(i.final_weight_g) OVER (PARTITION BY h.id) - i.cost AS profit
      FROM harvest_items i JOIN harvests h ON h.id = i.harvest_id
      WHERE i.batch_no IS NOT NULL
      ORDER BY h.harvest_date DESC;
    `;
    const rows = await all(sql);
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
    return all(sql, params);
  }

  async addMonitorReading(recordedAt, tempC, ph, source = 'manual') {
    const t = tempC !== null && tempC !== undefined && tempC !== '' ? parseFloat(tempC) : null;
    const p = ph !== null && ph !== undefined && ph !== '' ? parseFloat(ph) : null;
    const time = recordedAt || new Date().toISOString().slice(0, 19).replace('T', ' ');

    const res = await run(
      'INSERT INTO monitor_readings (recorded_at, temperature_c, ph, source) VALUES (?, ?, ?, ?)',
      [time, t, p, source || 'manual']
    );
    return { id: res.lastID, recorded_at: time, temperature_c: t, ph, source };
  }

  async importMonitorReadings(readings) {
    if (!Array.isArray(readings) || readings.length === 0) throw new Error('No readings provided');
    await exec('BEGIN TRANSACTION');
    try {
      let count = 0;
      for (const r of readings) {
        const t = r.temp !== null && r.temp !== undefined && r.temp !== '' ? parseFloat(r.temp) : null;
        const p = r.ph !== null && r.ph !== undefined && r.ph !== '' ? parseFloat(r.ph) : null;
        if (t === null && p === null) continue;
        const time = r.time || new Date().toISOString().slice(0, 19).replace('T', ' ');
        await run(
          'INSERT INTO monitor_readings (recorded_at, temperature_c, ph, source) VALUES (?, ?, ?, ?)',
          [time, t, p, r.source || 'csv_import']
        );
        count++;
      }
      await exec('COMMIT');
      return { count };
    } catch (err) {
      await exec('ROLLBACK');
      throw err;
    }
  }
}

module.exports = {
  initSQLite,
  SQLiteAdapter: new SQLiteAdapter(),
  dbPath: DB_PATH
};
