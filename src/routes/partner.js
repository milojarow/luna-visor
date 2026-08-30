const { Router } = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/connection');

const router = Router();

const activePartners = db.prepare('SELECT id, password_hash FROM partners WHERE disabled_at IS NULL');

// Password only, no username: the partner is handed one secret and nothing else.
// The cost is a bcrypt.compare per active partner, which is fine at this scale
// and is rate-limited in server.js. Dozens of partners would want a user field.
router.post('/login', async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  let matched = null;
  for (const p of activePartners.all()) {
    if (await bcrypt.compare(password, p.password_hash)) {
      matched = p.id;
      break;
    }
  }
  if (!matched) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Regenerate so a partner session can never inherit an admin flag from a
  // pre-existing cookie.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.partnerId = matched;
    req.session.save(() => res.json({ ok: true }));
  });
});

module.exports = router;
