const aliyunDns = require('./aliyun-dns');
const db = require('../database');
const settingsService = require('./settings-service');

function loadCredentials() {
  const row = db.prepare('SELECT access_key_id, access_key_secret, verified FROM aliyun_dns_auth ORDER BY id DESC LIMIT 1').get();
  if (row) {
    aliyunDns.setCredentials(row.access_key_id, row.access_key_secret);
    return { ...row, access_key_secret: undefined };
  }
  return null;
}

async function verifyCredentials(accessKeyId, accessKeySecret) {
  aliyunDns.setCredentials(accessKeyId, accessKeySecret);
  return aliyunDns.verifyCredentials();
}

async function saveCredentials(accessKeyId, accessKeySecret, verified, verifiedAt) {
  const id = db.prepare('INSERT INTO aliyun_dns_auth (access_key_id, access_key_secret, verified, verified_at) VALUES (?, ?, ?, ?)')
    .run(accessKeyId, accessKeySecret, verified ? 1 : 0, verifiedAt || null).lastInsertRowId;
  loadCredentials();
  return { id };
}

function getCredentials() {
  return loadCredentials();
}

async function listRecords() {
  return db.prepare('SELECT * FROM dns_records ORDER BY created_at DESC').all();
}

async function getRecord(id) {
  return db.prepare('SELECT * FROM dns_records WHERE id = ?').get(id) || null;
}

async function createRecord({ name, type, value, ttl, channel_id, source }) {
  const auth = getCredentials();
  if (!auth) throw new Error('ALIYUN_AUTH_MISSING');

  const baseDomain = settingsService.getSetting('dns_domain');
  if (!baseDomain) throw new Error('DNS_DOMAIN_NOT_CONFIGURED');

  const fullDomain = name.endsWith('.') ? name : `${name}.${baseDomain}`;
  const rr = name.includes('.') ? name : name;

  const result = await aliyunDns.addDomainRecord(baseDomain, rr, type, value, ttl || 600);

  db.prepare(`
    INSERT INTO dns_records (domain_id, record_id, name, type, value, ttl, status, source, channel_id)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    result.DomainId || baseDomain,
    result.RecordId || null,
    fullDomain,
    type,
    value,
    ttl || 600,
    source || 'manual',
    channel_id || null
  );

  return db.prepare('SELECT * FROM dns_records WHERE record_id = ?').get(result.RecordId) ||
         db.prepare('SELECT * FROM dns_records ORDER BY id DESC LIMIT 1').get();
}

async function createCnameRecord(channel, baseDomainOverride) {
  const baseDomain = baseDomainOverride || settingsService.getSetting('dns_domain');
  if (!baseDomain) throw new Error('DNS_DOMAIN_NOT_CONFIGURED');

  const targetDomain = `${channel.pull_url_hls ? new URL(channel.pull_url_hls).hostname : channel.push_domain}.wscdn.com`;

  return createRecord({
    name: channel.channel_name,
    type: 'CNAME',
    value: targetDomain,
    ttl: 600,
    channel_id: channel.id,
    source: 'cdn_channel'
  });
}

async function updateRecord(id, { name, type, value, ttl }) {
  const record = db.prepare('SELECT * FROM dns_records WHERE id = ?').get(id);
  if (!record) throw new Error('DNS_RECORD_NOT_FOUND');

  if (record.record_id) {
    await aliyunDns.updateDomainRecord(record.record_id, record.name, type || record.type, value || record.value, ttl || record.ttl);
  }

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (type !== undefined) updates.type = type;
  if (value !== undefined) updates.value = value;
  if (ttl !== undefined) updates.ttl = ttl;

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE dns_records SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), id);

  return db.prepare('SELECT * FROM dns_records WHERE id = ?').get(id);
}

async function deleteRecord(id) {
  const record = db.prepare('SELECT * FROM dns_records WHERE id = ?').get(id);
  if (!record) throw new Error('DNS_RECORD_NOT_FOUND');

  if (record.record_id) {
    await aliyunDns.deleteDomainRecord(record.record_id);
  }
  db.prepare('DELETE FROM dns_records WHERE id = ?').run(id);
  return { name: record.name };
}

async function syncFromAliyun() {
  const auth = getCredentials();
  if (!auth) throw new Error('ALIYUN_AUTH_MISSING');

  const baseDomain = settingsService.getSetting('dns_domain');
  if (!baseDomain) throw new Error('DNS_DOMAIN_NOT_CONFIGURED');

  const result = await aliyunDns.describeDomainRecords(baseDomain);
  const records = result.RecordSets ? result.RecordSets.RecordSet : [];

  for (const rec of records) {
    const existing = db.prepare('SELECT id FROM dns_records WHERE record_id = ?').get(rec.RecordId);
    if (!existing) {
      db.prepare(`
        INSERT INTO dns_records (domain_id, record_id, name, type, value, ttl, status, source)
        VALUES (?, ?, ?, ?, ?, ?, 'active', 'synced')
      `).run(rec.DomainName, rec.RecordId, rec.RR + '.' + rec.DomainName, rec.Type, rec.Value, rec.TTL);
    }
  }

  return { synced: records.length };
}

module.exports = {
  verifyCredentials,
  saveCredentials,
  getCredentials,
  listRecords,
  getRecord,
  createRecord,
  createCnameRecord,
  updateRecord,
  deleteRecord,
  syncFromAliyun
};
