const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const dnsService = require('../services/dns-service');

const router = express.Router();
router.use(jwtAuth);

router.get('/', (req, res) => {
  const auth = dnsService.getCredentials();
  res.json({ auth: auth || null });
});

router.post('/', async (req, res) => {
  try {
    const { access_key_id, access_key_secret } = req.body;
    if (!access_key_id || !access_key_secret) {
      return res.status(400).json({ code: 'EXTERNAL_ALIYUN_AUTH_MISSING', error: 'Aliyun DNS credentials not configured', detail: 'AccessKey ID and Secret are required' });
    }

    const verification = await dnsService.verifyCredentials(access_key_id, access_key_secret);
    if (!verification.valid) {
      return res.status(400).json({ code: 'EXTERNAL_ALIYUN_AUTH_FAILED', error: 'Aliyun DNS authentication failed', detail: verification.error });
    }

    await dnsService.saveCredentials(access_key_id, access_key_secret, true, new Date().toISOString());

    res.status(201).json({
      message: 'Aliyun DNS credentials saved and verified',
      domains: verification.domains
    });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_SAVE_CREDENTIALS_FAILED', error: 'Failed to save credentials', detail: err.message });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const { access_key_id, access_key_secret } = req.body;
    if (!access_key_id || !access_key_secret) {
      return res.status(400).json({ code: 'EXTERNAL_ALIYUN_AUTH_MISSING', error: 'Aliyun DNS credentials not configured', detail: 'AccessKey ID and Secret are required' });
    }

    const verification = await dnsService.verifyCredentials(access_key_id, access_key_secret);
    res.json(verification);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_VERIFICATION_FAILED', error: 'Credential verification failed', detail: err.message });
  }
});

module.exports = router;
