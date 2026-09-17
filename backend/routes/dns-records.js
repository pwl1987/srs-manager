const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const dnsService = require('../services/dns-service');

const router = express.Router();
router.use(jwtAuth);

router.get('/', async (req, res) => {
  try {
    const records = await dnsService.listRecords();
    res.json(records);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: 'Internal server error', detail: `Failed to fetch DNS records: ${err.message}` });
  }
});

router.post('/', async (req, res) => {
  try {
    const record = await dnsService.createRecord(req.body);
    res.status(201).json(record);
  } catch (err) {
    if (err.message === 'ALIYUN_AUTH_MISSING') {
      return res.status(400).json({ code: 'EXTERNAL_ALIYUN_AUTH_MISSING', error: 'Aliyun DNS credentials not configured', detail: 'Aliyun DNS credentials not configured' });
    }
    if (err.message === 'DNS_DOMAIN_NOT_CONFIGURED') {
      return res.status(400).json({ code: 'EXTERNAL_DNS_DOMAIN_NOT_CONFIGURED', error: 'DNS base domain not configured in Settings', detail: 'DNS base domain not configured in Settings' });
    }
    if (err.message === 'DNS_RECORD_EXISTS') {
      return res.status(409).json({ code: 'CONFLICT_DNS_RECORD_EXISTS', error: 'DNS record already exists', detail: `Record "${req.body.name}" already exists` });
    }
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: 'Internal server error', detail: `Failed to create DNS record: ${err.message}` });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const record = await dnsService.getRecord(req.params.id);
    if (!record) return res.status(404).json({ code: 'NOT_FOUND_DNS_RECORD', error: 'DNS record not found', detail: `Record ${req.params.id} not found` });
    res.json(record);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: 'Internal server error', detail: `Failed to fetch DNS record: ${err.message}` });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const record = await dnsService.updateRecord(req.params.id, req.body);
    if (!record) return res.status(404).json({ code: 'NOT_FOUND_DNS_RECORD', error: 'DNS record not found', detail: `Record ${req.params.id} not found` });
    res.json(record);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: 'Internal server error', detail: `Failed to update DNS record: ${err.message}` });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await dnsService.deleteRecord(req.params.id);
    res.json({ message: `DNS record "${result.name}" deleted` });
  } catch (err) {
    if (err.message === 'DNS_RECORD_NOT_FOUND') {
      return res.status(404).json({ code: 'NOT_FOUND_DNS_RECORD', error: 'DNS record not found', detail: `Record ${req.params.id} not found` });
    }
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: 'Internal server error', detail: `Failed to delete DNS record: ${err.message}` });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const result = await dnsService.syncFromAliyun();
    res.json(result);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: 'Internal server error', detail: `Failed to sync DNS records: ${err.message}` });
  }
});

module.exports = router;
