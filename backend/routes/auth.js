const express = require('express');
const userService = require('../services/user');
const { setHttpOnlyCookie } = require('../utils/cookies');
const jwtAuth = require('../middleware/jwt-auth');

const router = express.Router();

router.get('/me', jwtAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const ip = req.ip;
  const result = await userService.login(username, password, ip);
  if (result.error) {
    return res.status(401).json({ error: result.error });
  }

  setHttpOnlyCookie(res, 'refresh_token', result.refreshToken, 7 * 24 * 60 * 60);
  res.json({
    user: result.user,
    access_token: result.accessToken
  });
});

router.post('/refresh', (req, res) => {
  const refreshToken = req.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token provided' });
  }

  const result = userService.refresh(refreshToken);
  if (!result) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  setHttpOnlyCookie(res, 'refresh_token', result.refreshToken, 7 * 24 * 60 * 60);
  res.json({
    user: result.user,
    access_token: result.accessToken
  });
});

router.post('/logout', (req, res) => {
  const refreshToken = req.refreshToken;
  if (refreshToken) {
    userService.logout(refreshToken);
  }
  res.clearCookie('refresh_token');
  res.json({ message: 'Logged out' });
});

module.exports = router;
