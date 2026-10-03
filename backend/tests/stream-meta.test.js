const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-stream-meta-'));
process.env.DATA_DIR = dataDir;
process.env.SRS_API_URL = 'http://127.0.0.1:1985/api/v1';

const db = require('../database');
const streamService = require('../services/stream-service');

test.after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('fresh schema exposes remark and business_unit columns', () => {
  const columns = db.prepare('PRAGMA table_info(streams)').all().map(column => column.name);
  assert.equal(columns.includes('remark'), true);
  assert.equal(columns.includes('business_unit'), true);
});

test('createStream persists trimmed identity fields and defaults them to null', async () => {
  const created = await streamService.createStream('任意社会学', 'rtmp', null, {
    remark: '  晚间新闻演播室 ',
    business_unit: '新闻中心'
  });
  assert.equal(created.remark, '晚间新闻演播室');
  assert.equal(created.business_unit, '新闻中心');

  const plain = await streamService.createStream('文艺工程学', 'rtmp');
  assert.equal(plain.remark, null);
  assert.equal(plain.business_unit, null);
});

test('updateStream follows PHASE-09 partial-update semantics', async () => {
  const stream = await streamService.createStream('partial-update-room', 'rtmp', null, {
    remark: '原始备注',
    business_unit: '原业务归属'
  });

  const untouched = await streamService.updateStream(stream.id, {});
  assert.equal(untouched.remark, '原始备注');
  assert.equal(untouched.business_unit, '原业务归属');

  const trimmed = await streamService.updateStream(stream.id, { remark: '  新备注  ' });
  assert.equal(trimmed.remark, '新备注');
  assert.equal(trimmed.business_unit, '原业务归属');

  const clearedByNull = await streamService.updateStream(stream.id, { remark: null });
  assert.equal(clearedByNull.remark, null);

  const clearedByEmpty = await streamService.updateStream(stream.id, { business_unit: '   ' });
  assert.equal(clearedByEmpty.business_unit, null);
});

test('updateStream rejects identity fields longer than 200 characters', async () => {
  const stream = await streamService.createStream('field-length-room', 'rtmp');
  const tooLong = '长'.repeat(201);
  await assert.rejects(
    () => streamService.updateStream(stream.id, { remark: tooLong }),
    /Stream field too long: remark/
  );
  await assert.rejects(
    () => streamService.createStream('field-length-room-2', 'rtmp', null, { business_unit: tooLong }),
    /Stream field too long: business_unit/
  );
});
