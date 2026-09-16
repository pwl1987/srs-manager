const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const wangsuService = require('../services/wangsu');
const db = require('../database');

const router = express.Router();
router.use(jwtAuth);

router.get('/', (req, res) => {
  const auth = db.prepare('SELECT id, access_key_id, auth_method, verified, verified_at, created_at FROM wangsu_auth ORDER BY id DESC LIMIT 1').get();
  res.json({ auth: auth || null });
});

router.post('/', async (req, res) => {
  try {
    const { access_key_id, access_key_secret, auth_method } = req.body;
    if (!access_key_id || !access_key_secret) {
      return res.status(400).json({ error: 'AccessKey ID and Secret are required' });
    }

    // Verify credentials before saving
    const verification = await wangsuService.verifyCredentials(access_key_id, access_key_secret);
    if (!verification.valid) {
      return res.status(400).json({ error: `Credential verification failed: ${verification.error}` });
    }

    db.prepare(`
      INSERT INTO wangsu_auth (access_key_id, access_key_secret, auth_method, verified, verified_at)
      VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
    `).run(access_key_id, access_key_secret, auth_method || 'AKSK');

    res.status(201).json({
      message: 'Wangsu credentials saved and verified',
      totalChannels: verification.totalChannels
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to save credentials: ${err.message}` });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const { access_key_id, access_key_secret } = req.body;
    if (!access_key_id || !access_key_secret) {
      return res.status(400).json({ error: 'AccessKey ID and Secret are required' });
    }

    const verification = await wangsuService.verifyCredentials(access_key_id, access_key_secret);
    res.json(verification);
  } catch (err) {
    res.status(500).json({ error: `Verification failed: ${err.message}` });
  }
});

module.exports = router;
