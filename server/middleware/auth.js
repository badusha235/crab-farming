const jwt = require('jsonwebtoken');
const config = require('../config');

function generateToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: '30d' }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    // If no token provided, set default guest/local user
    req.user = { id: 1, name: 'Farm Staff', email: 'staff@crabfarm.in', role: 'staff' };
    return next();
  }

  jwt.verify(token, config.jwtSecret, (err, decoded) => {
    if (err) {
      req.user = { id: 1, name: 'Farm Staff', email: 'staff@crabfarm.in', role: 'staff' };
    } else {
      req.user = decoded;
    }
    next();
  });
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || (req.user.role !== role && req.user.role !== 'owner')) {
      return res.status(403).json({ error: `Permission denied. Requires '${role}' role.` });
    }
    next();
  };
}

module.exports = {
  generateToken,
  authenticateToken,
  requireRole
};
