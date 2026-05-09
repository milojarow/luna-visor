const { Router } = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { generateOverlay } = require('../services/cover-generator');

const router = Router();

const overlayLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: req => req.apiKeyClientId ? `overlay-key:${req.apiKeyClientId}` : `overlay-ip:${ipKeyGenerator(req.ip)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many overlay generations, slow down.' },
});

router.post('/generate', overlayLimiter, async (req, res) => {
  const { width = 1080, height = 1920 } = req.body;
  const clientId = req.apiKeyClientId || req.body.client_id;

  if (!clientId) {
    return res.status(400).json({ error: 'client_id required' });
  }

  try {
    const buffer = await generateOverlay({ data: req.body, width, height, clientId });
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error('Overlay generation failed:', err);
    res.status(500).json({ error: 'Overlay generation failed' });
  }
});

module.exports = router;
