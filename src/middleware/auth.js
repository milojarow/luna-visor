const publicPaths = ['/api/auth/login', '/api/auth/status', '/login.html'];

function requireAuth(req, res, next) {
  if (publicPaths.includes(req.path)) return next();
  if (req.path === '/login.html' || req.path === '/favicon.ico') return next();

  if (!req.session || !req.session.authenticated) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login.html');
  }
  next();
}

module.exports = requireAuth;
