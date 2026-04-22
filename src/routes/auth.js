const { Router } = require('express');
const bcrypt = require('bcrypt');
const config = require('../config');

const router = Router();

router.get('/status', (req, res) => {
  res.json({
    authenticated: !!(req.session && req.session.authenticated),
    cdn_base_url: config.CDN_BASE_URL,
  });
});

router.post('/login', async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  const match = await bcrypt.compare(password, config.ADMIN_PASSWORD_HASH);
  if (!match) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  req.session.authenticated = true;
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

module.exports = router;
