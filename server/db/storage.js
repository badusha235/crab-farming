const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.resolve(process.cwd(), './data');
const DATA_FILE = path.join(DATA_DIR, 'crab_register.json');

const DEFAULT_SPECIES = [
  'Mud crab (Scylla serrata)',
  'Orange mud crab (Scylla olivacea)',
  'Green mud crab (Scylla paramamosain)',
  'Blue swimmer crab (Portunus pelagicus)',
  'Other'
];

class StorageEngine {
  constructor() {
    this.data = null;
    this.init();
  }

  init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(DATA_FILE)) {
      try {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        this.data = JSON.parse(raw);
      } catch (e) {
        console.warn('Corrupted data file, resetting database:', e.message);
        this.data = this.getDefaultState();
        this.save();
      }
    } else {
      this.data = this.getDefaultState();
      this.save();
    }
  }

  getDefaultState() {
    const salt = bcrypt.genSaltSync(10);
    const ownerHash = bcrypt.hashSync('admin123', salt);
    const staffHash = bcrypt.hashSync('staff123', salt);

    return {
      users: [
        { id: 1, name: 'Farm Owner', email: 'admin@crabfarm.in', password_hash: ownerHash, role: 'owner', created_at: new Date().toISOString() },
        { id: 2, name: 'Farm Staff', email: 'staff@crabfarm.in', password_hash: staffHash, role: 'staff', created_at: new Date().toISOString() }
      ],
      settings: {
        id: 1,
        farm_name: 'Vertical Crab Farm Kochi',
        box_count: 40,
        temp_min: 26.0,
        temp_max: 32.0,
        ph_min: 7.5,
        ph_max: 8.5
      },
      species: DEFAULT_SPECIES.map((name, i) => ({ id: i + 1, name })),
      batch_numbers_in_use: [], // array of strings
      deliveries: [],
      inventory_crabs: [],
      boxes: {}, // box_no -> box object
      box_weights: [], // { id, box_no, weighed_on, weight_g }
      box_moults: [],  // { id, box_no, moulted_on }
      box_moves: [],   // { id, box_no, from_box, to_box, moved_on }
      harvests: [],    // { id, harvest_date, size, total_weight_g, price_per_kg, buyer, notes, created_at }
      harvest_items: [], // { id, harvest_id, box_no, batch_no, size, species, sex, stock_date, initial_weight_g, final_weight_g, moult_count, cost }
      harvest_files: [], // { id, harvest_id, file_name, file_url, size_bytes }
      monitor_readings: [], // { id, recorded_at, temperature_c, ph, source }
      seq: {
        users: 3,
        species: 6,
        deliveries: 1,
        inventory_crabs: 1,
        box_weights: 1,
        box_moults: 1,
        box_moves: 1,
        harvests: 1,
        harvest_items: 1,
        harvest_files: 1,
        monitor_readings: 1
      }
    };
  }

  save() {
    try {
      const tempPath = DATA_FILE + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tempPath, DATA_FILE);
    } catch (err) {
      console.error('Failed to save database file:', err);
    }
  }

  // --- Users & Auth ---
  findUserByEmail(email) {
    if (!email) return null;
    return this.data.users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
  }

  findUserByPhone(phone) {
    if (!phone) return null;
    return this.data.users.find(u => u.phone === phone);
  }

  findUserByIdentifier(identifier) {
    if (!identifier) return null;
    const val = String(identifier).trim();
    return this.data.users.find(u => u.phone === val || (u.email && u.email.toLowerCase() === val.toLowerCase()));
  }

  findUserById(id) {
    return this.data.users.find(u => u.id === id);
  }

  createUser(name, email, passwordHash, role = 'staff', phone = null) {
    const id = this.data.seq.users++;
    const user = { id, name, email: email ? email.toLowerCase() : null, phone, password_hash: passwordHash || '', role, created_at: new Date().toISOString() };
    this.data.users.push(user);
    this.save();
    return user;
  }

  createUserWithPhone(name, phone, role = 'staff', email = null) {
    const id = this.data.seq.users++;
    const user = { id, name, phone, email: email ? email.toLowerCase() : null, password_hash: '', role, created_at: new Date().toISOString() };
    this.data.users.push(user);
    this.save();
    return user;
  }

  saveOtp(phone, otp, expiresAtMs) {
    this.otps = this.otps || {};
    this.otps[phone] = { otp, expiresAt: expiresAtMs };
  }

  verifyOtp(phone, otp) {
    this.otps = this.otps || {};
    const item = this.otps[phone];
    if (!item) return false;
    if (Date.now() > item.expiresAt) {
      delete this.otps[phone];
      return false;
    }
    const match = String(item.otp).trim() === String(otp).trim();
    if (match) {
      delete this.otps[phone];
    }
    return match;
  }

  getUsers() {
    return this.data.users.map(({ password_hash, ...u }) => u);
  }

  // --- Settings ---
  getSettings() {
    return { ...this.data.settings };
  }

  updateSettings(patch) {
    if (patch.farm_name !== undefined) this.data.settings.farm_name = String(patch.farm_name).trim();
    if (patch.box_count !== undefined) {
      const c = parseInt(patch.box_count, 10);
      if (c >= 1 && c <= 500) this.data.settings.box_count = c;
    }
    if (patch.temp_min !== undefined) this.data.settings.temp_min = patch.temp_min !== null ? Number(patch.temp_min) : null;
    if (patch.temp_max !== undefined) this.data.settings.temp_max = patch.temp_max !== null ? Number(patch.temp_max) : null;
    if (patch.ph_min !== undefined) this.data.settings.ph_min = patch.ph_min !== null ? Number(patch.ph_min) : null;
    if (patch.ph_max !== undefined) this.data.settings.ph_max = patch.ph_max !== null ? Number(patch.ph_max) : null;
    this.save();
    return this.getSettings();
  }

  // --- Species ---
  getSpecies() {
    return [...this.data.species];
  }

  addSpecies(name) {
    const trimmed = String(name).trim();
    if (!trimmed) throw new Error('Species name cannot be empty');
    if (this.data.species.some(s => s.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('Species already exists');
    }
    const id = this.data.seq.species++;
    const s = { id, name: trimmed };
    this.data.species.push(s);
    this.save();
    return s;
  }

  // --- Batch Numbers In Use ---
  isBatchNoInUse(batchNo, excludeCrabId = null, excludeBoxNo = null) {
    const bn = String(batchNo).trim().toLowerCase();
    // Check in inventory
    const inStock = this.data.inventory_crabs.some(c => 
      c.status === 'stock' && c.batch_no && c.batch_no.toLowerCase() === bn && c.id !== excludeCrabId
    );
    if (inStock) return true;

    // Check in boxes
    for (const bNo in this.data.boxes) {
      const b = this.data.boxes[bNo];
      if (b && b.batch_no && b.batch_no.toLowerCase() === bn && b.box_no !== excludeBoxNo) {
        return true;
      }
    }
    return false;
  }

  getUsedBatchNumbers(excludeCrabId = null, excludeBoxNo = null) {
    const map = {};
    this.data.inventory_crabs.forEach(c => {
      if (c.status === 'stock' && c.batch_no && c.id !== excludeCrabId) {
        map[c.batch_no.toLowerCase()] = 'the inventory';
      }
    });
    for (const bNo in this.data.boxes) {
      const b = this.data.boxes[bNo];
      if (b && b.batch_no && b.box_no !== excludeBoxNo) {
        map[b.batch_no.toLowerCase()] = `Box ${b.box_no}`;
      }
    }
    return map;
  }

  // --- Deliveries & Inventory ---
  getDeliveries() {
    return [...this.data.deliveries].sort((a, b) => b.received_date.localeCompare(a.received_date));
  }

  getInventoryCrabs(filter = 'all') {
    let list = this.data.inventory_crabs.map(c => {
      const del = this.data.deliveries.find(d => d.id === c.delivery_id);
      return {
        ...c,
        seller: del ? del.seller : '',
        date: del ? del.received_date : c.moved_date
      };
    });

    if (filter === 'stock') {
      list = list.filter(c => c.status === 'stock');
    } else if (filter === 'moved') {
      list = list.filter(c => c.status === 'moved');
    }

    return list.sort((a, b) => {
      if (a.date !== b.date) return (b.date || '').localeCompare(a.date || '');
      return b.id - a.id;
    });
  }

  receiveCrabs(seller, receivedDate, species, crabs, userId = null) {
    const sName = String(seller).trim();
    if (!sName) throw new Error('Seller name is required');
    if (!receivedDate) throw new Error('Received date is required');
    if (!crabs || !Array.isArray(crabs) || crabs.length === 0) {
      throw new Error('At least one crab is required');
    }

    // Check unique batch numbers inside delivery and globally
    const seen = new Set();
    const usedMap = this.getUsedBatchNumbers();

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

    // Create delivery
    const deliveryId = this.data.seq.deliveries++;
    const delivery = {
      id: deliveryId,
      seller: sName,
      received_date: receivedDate,
      created_by: userId,
      created_at: new Date().toISOString()
    };
    this.data.deliveries.push(delivery);

    // Create crabs
    const createdCrabs = [];
    crabs.forEach((c, idx) => {
      const id = this.data.seq.inventory_crabs++;
      const bn = String(c.batch_no).trim();
      const crab = {
        id,
        delivery_id: deliveryId,
        batch_no: bn,
        species: c.species || species || DEFAULT_SPECIES[0],
        sex: c.sex === 'M' || c.sex === 'F' ? c.sex : null,
        weight_g: Math.round(Number(c.weight_g)),
        price: c.price !== null && c.price !== undefined && c.price !== '' ? Number(c.price) : null,
        status: 'stock',
        moved_to_box: null,
        moved_date: null,
        notes: String(c.notes || '').trim()
      };
      this.data.inventory_crabs.push(crab);
      createdCrabs.push(crab);
    });

    this.save();
    return { delivery, crabs: createdCrabs };
  }

  updateInventoryCrab(id, patch) {
    const crab = this.data.inventory_crabs.find(c => c.id === id);
    if (!crab) throw new Error('Crab not found');
    if (crab.status === 'moved') throw new Error('Moved crabs cannot be edited');

    if (patch.batch_no !== undefined) {
      const bn = String(patch.batch_no).trim();
      if (!bn) throw new Error('Batch number cannot be empty');
      const bnLower = bn.toLowerCase();
      const usedMap = this.getUsedBatchNumbers(crab.id);
      if (usedMap[bnLower]) throw new Error(`Batch number ${bn} is already in use in ${usedMap[bnLower]}`);
      crab.batch_no = bn;
    }

    if (patch.weight_g !== undefined) {
      const g = parseInt(patch.weight_g, 10);
      if (isNaN(g) || g <= 0) throw new Error('Weight must be positive');
      crab.weight_g = g;
    }

    if (patch.price !== undefined) {
      if (patch.price === null || patch.price === '') {
        crab.price = null;
      } else {
        const p = parseFloat(patch.price);
        if (isNaN(p) || p < 0) throw new Error('Price cannot be negative');
        crab.price = p;
      }
    }

    if (patch.sex !== undefined) {
      crab.sex = patch.sex === 'M' || patch.sex === 'F' ? patch.sex : null;
    }

    if (patch.species !== undefined) {
      crab.species = String(patch.species).trim() || DEFAULT_SPECIES[0];
    }

    if (patch.notes !== undefined) {
      crab.notes = String(patch.notes).trim();
    }

    this.save();
    return crab;
  }

  removeInventoryCrab(id) {
    const idx = this.data.inventory_crabs.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Crab not found');
    const crab = this.data.inventory_crabs[idx];
    if (crab.status === 'moved') throw new Error('Moved crabs cannot be removed from inventory');

    this.data.inventory_crabs.splice(idx, 1);
    this.save();
    return { success: true };
  }

  // --- Move to Boxes ---
  moveToBoxes(stockDate, assignments) {
    if (!stockDate) throw new Error('Stocking date is required');
    if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
      throw new Error('Assignments required');
    }

    // Validation
    const targetBoxes = new Set();
    const crabsToMove = [];

    for (const a of assignments) {
      const crab = this.data.inventory_crabs.find(c => c.id === a.crab_id);
      if (!crab) throw new Error(`Crab #${a.crab_id} not found`);
      if (crab.status === 'moved') throw new Error(`Crab ${crab.batch_no} is already moved`);
      
      const boxNo = parseInt(a.box_no, 10);
      if (isNaN(boxNo) || boxNo < 1 || boxNo > 500) {
        throw new Error(`Box number must be between 1 and 500 (got ${a.box_no})`);
      }
      if (targetBoxes.has(boxNo)) {
        throw new Error(`Box ${boxNo} is assigned more than once`);
      }
      targetBoxes.add(boxNo);

      if (this.data.boxes[boxNo]) {
        throw new Error(`Box ${boxNo} already has an occupied crab`);
      }

      crabsToMove.push({ crab, boxNo });
    }

    const movedBoxes = [];
    crabsToMove.forEach(({ crab, boxNo }) => {
      // Find delivery info for batch label
      const del = this.data.deliveries.find(d => d.id === crab.delivery_id);
      const batchLabel = del ? `${del.seller} · ${del.received_date}` : 'Stocked';

      // Create box
      const box = {
        box_no: boxNo,
        status: 'growing',
        size: null,
        species: crab.species || DEFAULT_SPECIES[0],
        sex: crab.sex,
        batch_no: crab.batch_no,
        cost: crab.price !== null ? Number(crab.price) : null,
        source: batchLabel,
        stock_date: stockDate,
        initial_weight_g: crab.weight_g,
        end_date: null,
        notes: crab.notes || '',
        updated_at: new Date().toISOString()
      };

      this.data.boxes[boxNo] = box;

      // Update inventory crab
      crab.status = 'moved';
      crab.moved_to_box = boxNo;
      crab.moved_date = stockDate;

      movedBoxes.push(box);
    });

    this.save();
    return movedBoxes;
  }

  // --- Boxes ---
  getBoxes() {
    const list = [];
    for (const bNo in this.data.boxes) {
      const b = this.data.boxes[bNo];
      if (!b) continue;

      const weights = this.data.box_weights
        .filter(w => w.box_no === b.box_no)
        .sort((x, y) => x.weighed_on.localeCompare(y.weighed_on));

      const moults = this.data.box_moults
        .filter(m => m.box_no === b.box_no)
        .map(m => m.moulted_on)
        .sort();

      const moves = this.data.box_moves
        .filter(m => m.box_no === b.box_no)
        .sort((x, y) => x.moved_on.localeCompare(y.moved_on));

      list.push({
        ...b,
        weights,
        moults,
        moves
      });
    }

    return list.sort((a, b) => a.box_no - b.box_no);
  }

  getBox(boxNo) {
    const b = this.data.boxes[boxNo];
    if (!b) return null;

    const weights = this.data.box_weights
      .filter(w => w.box_no === b.box_no)
      .sort((x, y) => x.weighed_on.localeCompare(y.weighed_on));

    const moults = this.data.box_moults
      .filter(m => m.box_no === b.box_no)
      .map(m => m.moulted_on)
      .sort();

    const moves = this.data.box_moves
      .filter(m => m.box_no === b.box_no)
      .sort((x, y) => x.moved_on.localeCompare(y.moved_on));

    return {
      ...b,
      weights,
      moults,
      moves
    };
  }

  saveBox(boxNo, data) {
    const num = parseInt(boxNo, 10);
    if (isNaN(num) || num < 1 || num > 500) throw new Error('Box number must be between 1 and 500');

    const status = data.status || 'growing';
    const allowedStatuses = ['growing', 'molting', 'harvest', 'dead'];
    if (!allowedStatuses.includes(status)) throw new Error('Invalid status');

    if (status === 'harvest') {
      if (!data.size) throw new Error('Crab size is required when status is Harvest');
      const allowedSizes = ['Large', 'Medium', 'Small', 'Soft shell', 'Other'];
      if (!allowedSizes.includes(data.size)) throw new Error('Invalid crab size');
    }

    const existing = this.data.boxes[num];

    const w0 = data.initial_weight_g !== undefined ? parseInt(data.initial_weight_g, 10) : (existing ? existing.initial_weight_g : NaN);
    if (isNaN(w0) || w0 <= 0) throw new Error('Initial weight must be positive');

    const stockDate = data.stock_date !== undefined ? data.stock_date : (existing ? existing.stock_date : null);
    if (!stockDate) throw new Error('Stocking date is required');

    // Batch number check
    const bn = data.batch_no !== undefined
      ? (data.batch_no ? String(data.batch_no).trim() : null)
      : (existing ? existing.batch_no : null);

    if (bn && (!existing || existing.batch_no !== bn)) {
      const usedMap = this.getUsedBatchNumbers(null, num);
      if (usedMap[bn.toLowerCase()]) {
        throw new Error(`Batch number ${bn} is already used in ${usedMap[bn.toLowerCase()]}`);
      }
    }

    let cost = null;
    if (data.cost !== undefined) {
      cost = data.cost !== null && data.cost !== '' ? parseFloat(data.cost) : null;
    } else if (existing) {
      cost = existing.cost;
    }
    if (cost !== null && cost < 0) throw new Error('Cost cannot be negative');

    const ended = status === 'harvest' || status === 'dead';
    const species = data.species !== undefined ? (data.species ? String(data.species).trim() : DEFAULT_SPECIES[0]) : (existing ? existing.species : DEFAULT_SPECIES[0]);
    const sex = data.sex !== undefined ? (data.sex === 'M' || data.sex === 'F' ? data.sex : null) : (existing ? existing.sex : null);

    const box = {
      box_no: num,
      status: status,
      size: status === 'harvest' ? data.size : (data.size || (existing ? existing.size : null)),
      species: species,
      sex: sex,
      batch_no: bn,
      cost: cost,
      source: data.source !== undefined ? String(data.source).trim() : (existing ? existing.source : ''),
      stock_date: stockDate,
      initial_weight_g: w0,
      end_date: ended ? (data.end_date || (existing && existing.end_date ? existing.end_date : new Date().toISOString().slice(0, 10))) : null,
      notes: data.notes !== undefined ? String(data.notes).trim() : (existing ? existing.notes : ''),
      updated_at: new Date().toISOString()
    };

    this.data.boxes[num] = box;

    // Replace weights if provided
    if (Array.isArray(data.weights)) {
      this.data.box_weights = this.data.box_weights.filter(w => w.box_no !== num);
      data.weights.forEach(w => {
        const wg = parseInt(w.weight_g, 10);
        if (w.weighed_on && !isNaN(wg) && wg > 0) {
          this.data.box_weights.push({
            id: this.data.seq.box_weights++,
            box_no: num,
            weighed_on: w.weighed_on,
            weight_g: wg
          });
        }
      });
    }

    // Replace moults if provided
    if (Array.isArray(data.moults)) {
      this.data.box_moults = this.data.box_moults.filter(m => m.box_no !== num);
      data.moults.forEach(mDate => {
        if (mDate) {
          this.data.box_moults.push({
            id: this.data.seq.box_moults++,
            box_no: num,
            moulted_on: mDate
          });
        }
      });
    }

    this.save();
    return this.getBox(num);
  }

  deleteBox(boxNo) {
    const num = parseInt(boxNo, 10);
    if (!this.data.boxes[num]) throw new Error(`Box ${num} is already empty`);

    delete this.data.boxes[num];
    this.data.box_weights = this.data.box_weights.filter(w => w.box_no !== num);
    this.data.box_moults = this.data.box_moults.filter(m => m.box_no !== num);
    this.data.box_moves = this.data.box_moves.filter(m => m.box_no !== num);

    this.save();
    return { success: true };
  }

  moveBox(fromBoxNo, toBoxNo) {
    const from = parseInt(fromBoxNo, 10);
    const to = parseInt(toBoxNo, 10);

    if (isNaN(from) || isNaN(to) || to < 1 || to > 500) {
      throw new Error('Target box number must be between 1 and 500');
    }
    if (from === to) throw new Error('Target box is the same as current box');

    const sourceBox = this.data.boxes[from];
    if (!sourceBox) throw new Error(`Box ${from} has no crab to move`);
    if (this.data.boxes[to]) throw new Error(`Target box ${to} already has a crab`);

    const todayDate = new Date().toISOString().slice(0, 10);

    // Create target box with same details
    const targetBox = {
      ...sourceBox,
      box_no: to,
      updated_at: new Date().toISOString()
    };
    this.data.boxes[to] = targetBox;

    // Migrate weights, moults, moves
    this.data.box_weights.forEach(w => {
      if (w.box_no === from) w.box_no = to;
    });
    this.data.box_moults.forEach(m => {
      if (m.box_no === from) m.box_no = to;
    });
    this.data.box_moves.forEach(m => {
      if (m.box_no === from) m.box_no = to;
    });

    // Add new move record
    this.data.box_moves.push({
      id: this.data.seq.box_moves++,
      box_no: to,
      from_box: from,
      to_box: to,
      moved_on: todayDate
    });

    // Remove source box
    delete this.data.boxes[from];

    this.save();
    return this.getBox(to);
  }

  // --- Harvests ---
  getHarvests() {
    return this.data.harvests.map(h => {
      const items = this.data.harvest_items.filter(i => i.harvest_id === h.id);
      const files = this.data.harvest_files.filter(f => f.harvest_id === h.id);
      return {
        ...h,
        items,
        files
      };
    }).sort((a, b) => b.harvest_date.localeCompare(a.harvest_date));
  }

  getHarvest(id) {
    const h = this.data.harvests.find(x => x.id === id);
    if (!h) return null;
    const items = this.data.harvest_items.filter(i => i.harvest_id === h.id);
    const files = this.data.harvest_files.filter(f => f.harvest_id === h.id);
    return { ...h, items, files };
  }

  createHarvest(data, selectedBoxNumbers) {
    if (!data.harvest_date) throw new Error('Harvest date is required');
    if (!data.size) throw new Error('Crab size grade is required');
    if (!selectedBoxNumbers || !Array.isArray(selectedBoxNumbers) || selectedBoxNumbers.length === 0) {
      throw new Error('At least one box in Harvest status must be selected');
    }

    const totalWeightG = parseInt(data.total_weight_g, 10);
    if (isNaN(totalWeightG) || totalWeightG <= 0) {
      throw new Error('Total weight must be positive');
    }

    const pricePerKg = data.price_per_kg !== null && data.price_per_kg !== undefined && data.price_per_kg !== ''
      ? parseFloat(data.price_per_kg) : null;
    if (pricePerKg !== null && pricePerKg < 0) {
      throw new Error('Price per kg cannot be negative');
    }

    // Check all selected boxes are in Harvest status
    const boxesToHarvest = [];
    for (const bNo of selectedBoxNumbers) {
      const box = this.getBox(bNo);
      if (!box) throw new Error(`Box ${bNo} is empty`);
      if (box.status !== 'harvest') {
        throw new Error(`Box ${bNo} is in status '${box.status}', not 'harvest'`);
      }
      boxesToHarvest.push(box);
    }

    // Create harvest row
    const harvestId = this.data.seq.harvests++;
    const harvest = {
      id: harvestId,
      harvest_date: data.harvest_date,
      size: data.size,
      total_weight_g: totalWeightG,
      price_per_kg: pricePerKg,
      buyer: String(data.buyer || '').trim(),
      notes: String(data.notes || '').trim(),
      created_at: new Date().toISOString()
    };
    this.data.harvests.push(harvest);

    // Create snapshots in harvest_items and clear boxes
    const createdItems = [];
    boxesToHarvest.forEach(b => {
      // derive final weight
      const latestWeight = b.weights && b.weights.length > 0 
        ? b.weights[b.weights.length - 1].weight_g 
        : b.initial_weight_g;

      const item = {
        id: this.data.seq.harvest_items++,
        harvest_id: harvestId,
        box_no: b.box_no,
        batch_no: b.batch_no || null,
        size: b.size || data.size,
        species: b.species,
        sex: b.sex,
        stock_date: b.stock_date,
        initial_weight_g: b.initial_weight_g,
        final_weight_g: latestWeight,
        moult_count: b.moults ? b.moults.length : 0,
        cost: b.cost !== null ? Number(b.cost) : null
      };

      this.data.harvest_items.push(item);
      createdItems.push(item);

      // Delete the box record so it becomes Empty and frees batch number!
      delete this.data.boxes[b.box_no];
      this.data.box_weights = this.data.box_weights.filter(w => w.box_no !== b.box_no);
      this.data.box_moults = this.data.box_moults.filter(m => m.box_no !== b.box_no);
      this.data.box_moves = this.data.box_moves.filter(m => m.box_no !== b.box_no);
    });

    this.save();
    return { ...harvest, items: createdItems, files: [] };
  }

  updateHarvest(id, patch) {
    const h = this.data.harvests.find(x => x.id === id);
    if (!h) throw new Error('Harvest record not found');

    if (patch.harvest_date) h.harvest_date = patch.harvest_date;
    if (patch.size) h.size = patch.size;
    if (patch.total_weight_g !== undefined) {
      const tw = parseInt(patch.total_weight_g, 10);
      if (isNaN(tw) || tw <= 0) throw new Error('Total weight must be positive');
      h.total_weight_g = tw;
    }
    if (patch.price_per_kg !== undefined) {
      if (patch.price_per_kg === null || patch.price_per_kg === '') {
        h.price_per_kg = null;
      } else {
        const p = parseFloat(patch.price_per_kg);
        if (isNaN(p) || p < 0) throw new Error('Price per kg cannot be negative');
        h.price_per_kg = p;
      }
    }
    if (patch.buyer !== undefined) h.buyer = String(patch.buyer).trim();
    if (patch.notes !== undefined) h.notes = String(patch.notes).trim();

    this.save();
    return this.getHarvest(id);
  }

  deleteHarvest(id) {
    const idx = this.data.harvests.findIndex(x => x.id === id);
    if (idx === -1) throw new Error('Harvest not found');

    this.data.harvests.splice(idx, 1);
    this.data.harvest_items = this.data.harvest_items.filter(i => i.harvest_id !== id);
    this.data.harvest_files = this.data.harvest_files.filter(f => f.harvest_id !== id);

    this.save();
    return { success: true };
  }

  addHarvestFile(harvestId, fileName, fileUrl, sizeBytes) {
    const h = this.data.harvests.find(x => x.id === harvestId);
    if (!h) throw new Error('Harvest record not found');

    const file = {
      id: this.data.seq.harvest_files++,
      harvest_id: harvestId,
      file_name: fileName,
      file_url: fileUrl,
      size_bytes: sizeBytes
    };

    this.data.harvest_files.push(file);
    this.save();
    return file;
  }

  removeHarvestFile(fileId) {
    const idx = this.data.harvest_files.findIndex(f => f.id === fileId);
    if (idx === -1) throw new Error('File not found');
    const removed = this.data.harvest_files.splice(idx, 1)[0];
    this.save();
    return removed;
  }

  // --- Profit by Batch Number (Window Query calculation) ---
  getProfitByBatch() {
    // Exact logic of the query:
    // SELECT i.batch_no, h.harvest_date, i.box_no, i.final_weight_g,
    //        i.cost AS buying_price,
    //        h.price_per_kg * (h.total_weight_g/1000) * i.final_weight_g
    //          / SUM(i.final_weight_g) OVER (PARTITION BY h.id) AS selling_price,
    //        h.price_per_kg * (h.total_weight_g/1000) * i.final_weight_g
    //          / SUM(i.final_weight_g) OVER (PARTITION BY h.id) - i.cost AS profit
    // FROM harvest_items i JOIN harvests h ON h.id = i.harvest_id
    // WHERE i.batch_no IS NOT NULL
    // ORDER BY h.harvest_date DESC;

    const results = [];
    const harvestsById = {};
    this.data.harvests.forEach(h => { harvestsById[h.id] = h; });

    // Calculate sum of final_weight_g per harvest (PARTITION BY h.id)
    const partitionWeightSums = {};
    this.data.harvest_items.forEach(item => {
      partitionWeightSums[item.harvest_id] = (partitionWeightSums[item.harvest_id] || 0) + item.final_weight_g;
    });

    this.data.harvest_items.forEach(item => {
      if (!item.batch_no) return;
      const h = harvestsById[item.harvest_id];
      if (!h) return;

      const sumWeightLot = partitionWeightSums[h.id] || 0;
      let sellingPrice = null;
      let profit = null;

      if (h.price_per_kg !== null && h.price_per_kg !== undefined && sumWeightLot > 0) {
        const lotRevenue = h.price_per_kg * (h.total_weight_g / 1000);
        sellingPrice = (lotRevenue * item.final_weight_g) / sumWeightLot;

        if (item.cost !== null && item.cost !== undefined) {
          profit = sellingPrice - item.cost;
        }
      }

      results.push({
        batch_no: item.batch_no,
        harvest_date: h.harvest_date,
        box_no: item.box_no,
        final_weight_g: item.final_weight_g,
        buying_price: item.cost !== null ? Number(item.cost) : null,
        selling_price: sellingPrice !== null ? Number(sellingPrice.toFixed(2)) : null,
        profit: profit !== null ? Number(profit.toFixed(2)) : null
      });
    });

    return results.sort((a, b) => b.harvest_date.localeCompare(a.harvest_date));
  }

  // --- Monitor Readings ---
  getMonitorReadings(sinceTimestamp = null) {
    let list = this.data.monitor_readings;
    if (sinceTimestamp) {
      const sinceDate = new Date(sinceTimestamp);
      list = list.filter(r => new Date(r.recorded_at) >= sinceDate);
    }
    return [...list].sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
  }

  addMonitorReading(recordedAt, tempC, ph, source = 'manual') {
    const t = tempC !== null && tempC !== undefined && tempC !== '' ? parseFloat(tempC) : null;
    const p = ph !== null && ph !== undefined && ph !== '' ? parseFloat(ph) : null;

    if (t === null && p === null) throw new Error('At least temperature or pH must be provided');
    if (p !== null && (p < 0 || p > 14)) throw new Error('pH must be between 0 and 14');

    const reading = {
      id: this.data.seq.monitor_readings++,
      recorded_at: recordedAt || new Date().toISOString(),
      temperature_c: t,
      ph: p,
      source: String(source || 'manual').trim()
    };

    this.data.monitor_readings.push(reading);
    if (this.data.monitor_readings.length > 10000) {
      this.data.monitor_readings = this.data.monitor_readings.slice(-10000);
    }

    this.save();
    return reading;
  }

  importMonitorReadings(readings) {
    if (!Array.isArray(readings) || readings.length === 0) {
      throw new Error('No readings provided');
    }

    const inserted = [];
    readings.forEach(r => {
      const t = r.temp !== null && r.temp !== undefined && r.temp !== '' ? parseFloat(r.temp) : null;
      const p = r.ph !== null && r.ph !== undefined && r.ph !== '' ? parseFloat(r.ph) : null;
      if (t === null && p === null) return;
      if (p !== null && (p < 0 || p > 14)) return;

      const reading = {
        id: this.data.seq.monitor_readings++,
        recorded_at: r.time || new Date().toISOString(),
        temperature_c: t,
        ph: p,
        source: String(r.source || 'csv_import').trim()
      };
      this.data.monitor_readings.push(reading);
      inserted.push(reading);
    });

    if (this.data.monitor_readings.length > 10000) {
      this.data.monitor_readings = this.data.monitor_readings.slice(-10000);
    }

    this.save();
    return { count: inserted.length };
  }
}

module.exports = new StorageEngine();
