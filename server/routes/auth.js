const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { generateToken, requireRole } = require('../middleware/auth');

function cleanPhoneNumber(phone) {
  if (!phone) return '';
  let str = String(phone).replace(/\D/g, '');
  if (str.length === 12 && str.startsWith('91')) {
    str = str.slice(2);
  } else if (str.length === 11 && str.startsWith('0')) {
    str = str.slice(1);
  }
  return str;
}

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const rawPhone = req.body.phone;
    const phone = cleanPhoneNumber(rawPhone);

    if (!phone || phone.length !== 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
    }

    const user = await db.findUserByPhone(phone);
    if (!user) {
      return res.status(404).json({ error: 'No account registered with this mobile number. Please contact your administrator.' });
    }
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    await db.saveOtp(phone, otp, expiresAt);

    console.log(`[OTP] Sent to +91 ${phone}: ${otp}`);

    res.json({
      success: true,
      phone,
      exists: true,
      userName: user.name,
      message: `OTP sent successfully to +91 ${phone}`,
      dev_otp: otp
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { otp, name, role } = req.body;
    const phone = cleanPhoneNumber(req.body.phone);

    if (!phone || phone.length !== 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
    }
    if (!otp || String(otp).trim().length !== 6) {
      return res.status(400).json({ error: 'Please enter a 6-digit OTP' });
    }

    const valid = await db.verifyOtp(phone, otp);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid or expired OTP. Please try again or request a new code.' });
    }

    let user = await db.findUserByPhone(phone);
    if (!user) {
      return res.status(404).json({ error: 'No account registered with this mobile number. Please contact your administrator.' });
    }

    const token = generateToken(user);
    res.json({
      token,
      created: false,
      user: {
        id: user.id,
        name: user.name,
        email: user.email || '',
        phone: user.phone || phone,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login (supports Email or Mobile with Password)
router.post('/login', async (req, res) => {
  try {
    const identifier = req.body.email || req.body.identifier;
    const password = req.body.password;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Mobile / Email and password are required' });
    }

    let user = null;
    const cleanPhone = cleanPhoneNumber(identifier);
    if (cleanPhone.length === 10) {
      user = await db.findUserByPhone(cleanPhone);
    }
    if (!user) {
      user = await db.findUserByEmail(identifier);
    }

    if (!user) {
      return res.status(401).json({ error: 'No account found with this email or mobile number' });
    }

    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account was created with Mobile OTP. Please sign in using OTP.' });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email || '',
        phone: user.phone || '',
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register (public registration with email/password or mobile)
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const cleanP = phone ? cleanPhoneNumber(phone) : null;
    if (cleanP && cleanP.length !== 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
    }

    if (!email && !cleanP) {
      return res.status(400).json({ error: 'Either email or mobile number is required' });
    }

    if (email) {
      const existingEmail = await db.findUserByEmail(email);
      if (existingEmail) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }
    }

    if (cleanP) {
      const existingPhone = await db.findUserByPhone(cleanP);
      if (existingPhone) {
        return res.status(409).json({ error: 'An account with this mobile number already exists' });
      }
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const userRole = (role === 'owner') ? 'owner' : 'staff';
    const user = await db.createUser(trimmedName, email || `${cleanP}@crabfarm.in`, hash, userRole, cleanP);

    const token = generateToken(user);
    res.status(201).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email || '',
        phone: user.phone || '',
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/users
router.get('/users', requireRole('owner'), async (req, res) => {
  try {
    const users = await db.getUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
