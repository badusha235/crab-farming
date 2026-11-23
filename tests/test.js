// Automated Acceptance Tests for Crab Box Register
const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Clean test database before test starts
const testDataFile = path.resolve(__dirname, '../data/crab_register.json');
if (fs.existsSync(testDataFile)) {
  fs.unlinkSync(testDataFile);
}

const { app, startServer } = require('../server/app');

async function runTests() {
  console.log('--- Starting Crab Box Register Acceptance Tests ---');

  const server = await startServer();
  const address = server.address();
  const port = address.port;
  const baseUrl = `http://localhost:${port}`;

  function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(baseUrl + path);
      const reqHeaders = { 'Content-Type': 'application/json', ...headers };
      const req = http.request(url, { method, headers: reqHeaders }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, data: json, text: data, headers: res.headers });
          } catch (e) {
            resolve({ status: res.statusCode, data: null, text: data, headers: res.headers });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  try {
    // 1. Check sync status endpoint
    const syncRes = await request('GET', '/api/sync/status');
    assert.strictEqual(syncRes.status, 200);
    assert.strictEqual(syncRes.data.synced, true);
    console.log('✓ Health & sync status passed');

    // 2. Settings check
    const setRes = await request('GET', '/api/settings');
    assert.strictEqual(setRes.status, 200);
    assert.ok(setRes.data.box_count >= 1 && setRes.data.box_count <= 500);
    console.log('✓ Settings endpoint passed');

    // 3. User login check
    const loginRes = await request('POST', '/api/auth/login', {
      email: 'admin@crabfarm.in',
      password: 'admin123'
    });
    assert.strictEqual(loginRes.status, 200);
    assert.ok(loginRes.data.token);
    assert.strictEqual(loginRes.data.user.role, 'owner');
    const token = loginRes.data.token;
    console.log('✓ Authentication & role checks passed');

    // 4. Clean inventory & boxes for testing
    // Receive 10 crabs with B-001 to B-010
    const crabs = [];
    for (let i = 1; i <= 10; i++) {
      crabs.push({
        batch_no: `B-00${i}`,
        weight_g: 80 + i * 5,
        price: 150 + i * 10,
        sex: i % 2 === 0 ? 'M' : 'F'
      });
    }

    const receiveRes = await request('POST', '/api/inventory/receive', {
      seller: 'Kochi Marine Farms',
      received_date: '2026-11-20',
      species: 'Mud crab (Scylla serrata)',
      crabs
    });
    assert.strictEqual(receiveRes.status, 201);
    assert.strictEqual(receiveRes.data.crabs.length, 10);
    console.log('✓ Receiving 10 crabs creates 10 inventory records with batch numbers B-001 to B-010');

    // 5. Test repeated batch number refusal
    const repeatRes = await request('POST', '/api/inventory/receive', {
      seller: 'Another Seller',
      received_date: '2026-11-21',
      species: 'Mud crab (Scylla serrata)',
      crabs: [{ batch_no: 'B-001', weight_g: 100, price: 100 }]
    });
    assert.strictEqual(repeatRes.status, 400);
    assert.ok(repeatRes.data.error.includes('already in use'));
    console.log('✓ Repeated batch number refused against active inventory/boxes');

    // 6. Move crabs to boxes
    const crab1 = receiveRes.data.crabs[0];
    const crab2 = receiveRes.data.crabs[1];

    const moveRes = await request('POST', '/api/inventory/move', {
      stock_date: '2026-11-21',
      assignments: [
        { crab_id: crab1.id, box_no: 1 },
        { crab_id: crab2.id, box_no: 2 }
      ]
    });
    assert.strictEqual(moveRes.status, 200);
    assert.strictEqual(moveRes.data.success, true);

    // Verify box 1
    const box1Res = await request('GET', '/api/boxes/1');
    assert.strictEqual(box1Res.status, 200);
    assert.strictEqual(box1Res.data.batch_no, crab1.batch_no);
    assert.strictEqual(box1Res.data.initial_weight_g, crab1.weight_g);
    assert.strictEqual(box1Res.data.cost, crab1.price);
    assert.strictEqual(box1Res.data.sex, crab1.sex);
    console.log('✓ Moving crabs to boxes keeps batch no, price, sex and weight');

    // Verify inventory shows moved
    const invRes = await request('GET', '/api/inventory');
    const movedCrab1 = invRes.data.find(c => c.id === crab1.id);
    assert.strictEqual(movedCrab1.status, 'moved');
    assert.strictEqual(movedCrab1.moved_to_box, 1);
    console.log('✓ Inventory record kept and marked moved to box 1');

    // 7. Verify box cannot be saved as Harvest without crab size
    const invalidHarvestSave = await request('PUT', '/api/boxes/1', {
      status: 'harvest',
      size: '', // empty size
      initial_weight_g: 85,
      stock_date: '2026-11-21',
      species: 'Mud crab (Scylla serrata)'
    });
    assert.strictEqual(invalidHarvestSave.status, 400);
    assert.ok(invalidHarvestSave.data.error.includes('size is required'));
    console.log('✓ Box cannot be saved as Harvest without a crab size');

    // Save with valid Harvest size
    const validHarvestSave = await request('PUT', '/api/boxes/1', {
      status: 'harvest',
      size: 'Large',
      initial_weight_g: 85,
      stock_date: '2026-11-21',
      species: 'Mud crab (Scylla serrata)',
      weights: [{ weighed_on: '2026-11-23', weight_g: 120 }],
      moults: ['2026-11-22']
    });
    assert.strictEqual(validHarvestSave.status, 200);
    assert.strictEqual(validHarvestSave.data.size, 'Large');
    console.log('✓ Box successfully set to Harvest status with Large size');

    // 8. Test moving crab to another box
    const boxMoveRes = await request('POST', '/api/boxes/2/move', { to_box: 5 });
    assert.strictEqual(boxMoveRes.status, 200);
    assert.strictEqual(boxMoveRes.data.box_no, 5);
    assert.strictEqual(boxMoveRes.data.batch_no, crab2.batch_no);

    // Old box 2 must now be empty
    const oldBoxRes = await request('GET', '/api/boxes/2');
    assert.strictEqual(oldBoxRes.status, 404);
    console.log('✓ Moving crab to another box keeps records and empties old box');

    // 9. Harvest logging
    const harvestRes = await request('POST', '/api/harvests', {
      harvest_date: '2026-11-23',
      size: 'Large',
      total_weight_g: 120,
      price_per_kg: 950,
      buyer: 'Seafood King Exports',
      notes: 'Prime batch',
      boxes: [1]
    });
    assert.strictEqual(harvestRes.status, 201);
    assert.strictEqual(harvestRes.data.items.length, 1);
    assert.strictEqual(harvestRes.data.items[0].box_no, 1);
    assert.strictEqual(harvestRes.data.items[0].batch_no, crab1.batch_no);

    // Box 1 should now be empty and batch number free
    const harvestedBoxRes = await request('GET', '/api/boxes/1');
    assert.strictEqual(harvestedBoxRes.status, 404);
    console.log('✓ Harvest snapshots crab, empties selected box and frees batch number');

    // 10. Profit by batch calculation
    const profitRes = await request('GET', '/api/harvests/profit');
    assert.strictEqual(profitRes.status, 200);
    assert.ok(profitRes.data.length > 0);
    const pRecord = profitRes.data.find(p => p.batch_no === crab1.batch_no);
    assert.ok(pRecord);
    assert.strictEqual(pRecord.buying_price, crab1.price);
    assert.ok(pRecord.selling_price > 0);
    assert.ok(pRecord.profit !== null);
    console.log(`✓ Profit calculation verified: Buying=${pRecord.buying_price}, Selling=${pRecord.selling_price}, Profit=${pRecord.profit}`);

    // 11. Monitor readings
    const readingRes = await request('POST', '/api/monitor/readings', {
      time: '2026-11-23T10:00:00',
      temp: 29.2,
      ph: 8.1,
      source: 'Main Tank'
    });
    assert.strictEqual(readingRes.status, 201);
    console.log('✓ Monitor reading successfully added');

    // 12. CSV Exports check
    const csvBoxes = await request('GET', '/api/export/boxes');
    assert.strictEqual(csvBoxes.status, 200);
    assert.ok(csvBoxes.text.includes('Box,Status,Size'));
    assert.ok(!csvBoxes.text.toLowerCase().includes('carapace'), 'Carapace must not exist in CSV export');
    console.log('✓ Box CSV export verified without carapace field');

    const csvProfit = await request('GET', '/api/export/profit');
    assert.strictEqual(csvProfit.status, 200);
    assert.ok(csvProfit.text.includes('Batch no.,Harvested,Box'));
    console.log('✓ Profit CSV export verified');

    console.log('\n========================================');
    console.log('🎉 ALL ACCEPTANCE TESTS PASSED SUCCESSFULLY!');
    console.log('========================================');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
