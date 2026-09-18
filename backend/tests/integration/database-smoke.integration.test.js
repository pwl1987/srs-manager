const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

test('integration harness uses a real SQLite database', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE contract_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT INTO contract_probe(value) VALUES (?)').run('ok');
  const row = db.prepare('SELECT value FROM contract_probe WHERE id = 1').get();
  assert.equal(row.value, 'ok');
  db.close();
});
