const jwt = require('jsonwebtoken');
const Admin = require('../models/shared/admin.model');

exports.isAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

      const admin = await Admin.findById(decoded.aud);
      if (!admin) {
        return res.status(401).json({ error: 'Not authorized' });
      }

      req.admin = admin;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
