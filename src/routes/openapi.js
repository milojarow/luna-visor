const { Router } = require('express');
const spec = require('../openapi');

const router = Router();

router.get('/openapi.json', (_req, res) => {
  res.json(spec);
});

module.exports = router;
