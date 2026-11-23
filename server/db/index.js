const config = require('../config');
const storage = require('./storage');
const { initMySQL, MySQLAdapter } = require('./mysql');
const { initSQLite, SQLiteAdapter, dbPath } = require('./sqlite');

let activeEngine = 'sqlite';
let dbInstance = SQLiteAdapter;

async function setupDatabase() {
  if (config.db.type === 'mysql') {
    const connected = await initMySQL();
    if (connected) {
      activeEngine = 'mysql';
      dbInstance = MySQLAdapter;
      console.log('Connected to MySQL 8 database successfully.');
      return;
    }
  }

  // SQLite (Primary choice for sqlite or auto)
  if (config.db.type === 'sqlite' || config.db.type === 'auto' || !config.db.type) {
    try {
      await initSQLite();
      activeEngine = 'sqlite';
      dbInstance = SQLiteAdapter;
      console.log(`Using SQLite database engine (file: ${dbPath}).`);
      return;
    } catch (err) {
      console.warn('SQLite initialization failed, falling back to JSON storage:', err.message);
    }
  }

  activeEngine = 'embedded';
  dbInstance = storage;
  console.log('Using embedded ACID database engine (data stored in ./data/crab_register.json).');
}

// Proxy wrapper so exports always point to the active engine
const dbProxy = new Proxy({}, {
  get(target, prop) {
    if (prop === 'activeEngine') return activeEngine;
    if (prop === 'setupDatabase') return setupDatabase;
    if (typeof dbInstance[prop] === 'function') {
      return (...args) => dbInstance[prop](...args);
    }
    return dbInstance[prop];
  }
});

module.exports = dbProxy;
