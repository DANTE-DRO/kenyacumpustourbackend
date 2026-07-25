// ==========================================================================
//  Kenya Campus Tour - Crown Awards  |  Backend Server
//  - Express + lowdb (JSON) - no native builds (works on Render free plan)
//  - KCB Buni STK Push integration
//  - Professional admin panel served from /public
// ==========================================================================
require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const bodyParser   = require('body-parser');
const session      = require('express-session');
const helmet       = require('helmet');
const morgan       = require('morgan');
const path         = require('path');
const { v4: uuid } = require('uuid');

const db           = require('./db');
const kcb          = require('./kcb');
const universities = require('./data/universities');
const categories   = require('./data/categories');

const app  = express();
const PORT = process.env.PORT || 10000;

// ---------- Middleware ----------
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan('tiny'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'kenya-campus-tour-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }   // 8h
}));

// Serve the admin panel and any static assets from /public
app.use('/admin',  express.static(path.join(__dirname, 'public', 'admin')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// ==========================================================================
//  PUBLIC API
// ==========================================================================

// Health
app.get('/', (_req, res) => res.json({
  service: 'Kenya Campus Tour Crown Awards API',
  status:  'online',
  time:    new Date().toISOString()
}));

// Get reference data
app.get('/api/universities', (_req, res) => res.json(universities));
app.get('/api/categories',   (_req, res) => res.json(categories));

// Get settings (with days-left computation)
app.get('/api/settings', (_req, res) => {
  const s = db.get('settings').value();
  const start = new Date(s.registrationStartDate);
  const elapsed = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
  const daysLeft = Math.max(0, s.registrationDaysTotal - elapsed);
  res.json({
    ...s,
    daysLeft,
    registrationOpen: s.registrationOpen && daysLeft > 0
  });
});

// List nominees, optionally filter by category
app.get('/api/nominees', (req, res) => {
  const { category } = req.query;
  let q = db.get('nominees');
  if (category) q = q.filter({ category });
  const list = q.value()
    .slice()
    .sort((a, b) => (b.votes || 0) - (a.votes || 0));
  res.json(list);
});

// Register a nominee
app.post('/api/nominees', (req, res) => {
  const s = db.get('settings').value();
  const start = new Date(s.registrationStartDate);
  const elapsed = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
  const daysLeft = Math.max(0, s.registrationDaysTotal - elapsed);

  if (!s.registrationOpen || daysLeft <= 0) {
    return res.status(403).json({ error: 'Registration is currently closed.' });
  }

  const { name, email, phone, location, university, category } = req.body || {};
  if (!name || !email || !phone || !location || !category) {
    return res.status(400).json({ error: 'Please fill in all required fields.' });
  }
  const cat = categories.find(c => c.id === category);
  if (!cat) return res.status(400).json({ error: 'Invalid category selected.' });
  if (cat.requiresUniversity && !university) {
    return res.status(400).json({ error: `Please specify a university for "${cat.name}".` });
  }

  // Enforce cap of 20 per category
  const MAX = parseInt(process.env.MAX_NOMINEES_PER_CATEGORY || '20', 10);
  const existingCount = db.get('nominees').filter({ category }).size().value();
  if (existingCount >= MAX) {
    return res.status(409).json({
      error: `Sorry, this category is full (max ${MAX} nominees).`,
      full: true
    });
  }

  // Prevent duplicates (same email + category)
  const dup = db.get('nominees').find({ email: email.toLowerCase().trim(), category }).value();
  if (dup) return res.status(409).json({ error: 'You have already registered in this category.' });

  const nominee = {
    id: uuid(),
    name:       String(name).trim(),
    email:      String(email).toLowerCase().trim(),
    phone:      String(phone).trim(),
    location:   String(location).trim(),
    university: university ? String(university).trim() : '',
    category,
    votes: 0,
    createdAt: new Date().toISOString()
  };
  db.get('nominees').push(nominee).write();
  res.json({ success: true, nominee });
});

// Initiate a vote (triggers STK push)
app.post('/api/vote', async (req, res) => {
  const s = db.get('settings').value();
  if (!s.votingActive) return res.status(403).json({ error: 'Voting is not active right now.' });

  const { nomineeId, votes, phone } = req.body || {};
  const nominee = db.get('nominees').find({ id: nomineeId }).value();
  if (!nominee) return res.status(404).json({ error: 'Nominee not found.' });

  const amt = parseInt(votes, 10);
  if (!amt || amt < 10 || amt > 1000) {
    return res.status(400).json({ error: 'Vote amount must be between KES 10 and KES 1,000.' });
  }
  if (!phone) return res.status(400).json({ error: 'Phone number is required.' });

  // Short, alphanumeric reference (KCB requires this)
  const refShort = nominee.name.replace(/[^A-Za-z0-9]/g, '').substring(0, 12) || 'VOTE';

  const result = await kcb.stkPush({
    phone,
    amount: amt,
    reference: refShort,
    description: `Vote ${nominee.name}`
  });

  const record = {
    id: uuid(),
    nomineeId,
    nomineeName: nominee.name,
    category:    nominee.category,
    amount:      amt,
    phone:       kcb.formatPhone(phone),
    status:      result.success ? 'PENDING' : 'FAILED',
    // KCB response is nested under data.response
    checkoutRequestID: result.data ? ((result.data.response && result.data.response.CheckoutRequestID) || result.data.CheckoutRequestID || result.data.checkoutRequestID || null) : null,
    merchantRequestID: result.data ? ((result.data.response && result.data.response.MerchantRequestID) || result.data.MerchantRequestID || result.data.merchantRequestID || null) : null,
    rawResponse: result.data || result.response,
    error:       result.success ? null : (result.error || 'STK request failed'),
    createdAt:   new Date().toISOString()
  };
  db.get('votes').push(record).write();

  if (!result.success) {
    return res.status(502).json({
      error: 'STK push failed. Please try again.',
      details: result.response || result.error,
      voteId: record.id
    });
  }
  res.json({
    success: true,
    message: 'STK push sent - enter your M-PESA/KCB PIN on your phone.',
    voteId: record.id,
    checkoutRequestID: record.checkoutRequestID
  });
});

// Polling endpoint - frontend checks vote status
app.get('/api/vote/:voteId', (req, res) => {
  const v = db.get('votes').find({ id: req.params.voteId }).value();
  if (!v) return res.status(404).json({ error: 'Vote not found' });
  res.json({ status: v.status, amount: v.amount, nomineeName: v.nomineeName });
});

// ==========================================================================
//  KCB CALLBACK
// ==========================================================================
app.post('/callback', (req, res) => {
  console.log('[KCB CALLBACK]', JSON.stringify(req.body));
  db.get('transactions').push({
    id: uuid(),
    body: req.body,
    receivedAt: new Date().toISOString()
  }).write();

  try {
    const body = req.body || {};
    // KCB Buni callback shapes vary - handle common ones
    const stk = body.Body && body.Body.stkCallback ? body.Body.stkCallback : body;
    const resultCode = stk.ResultCode !== undefined ? stk.ResultCode : (stk.resultCode !== undefined ? stk.resultCode : (body.resultCode !== undefined ? body.resultCode : null));
    const checkoutRequestID = stk.CheckoutRequestID || stk.checkoutRequestID || body.CheckoutRequestID || body.checkoutRequestID || body.merchantRequestID || null;
    const transactionId = (stk.CallbackMetadata && stk.CallbackMetadata.Item)
      ? (stk.CallbackMetadata.Item.find(i => i.Name === 'MpesaReceiptNumber') || {}).Value
      : (body.transactionId || body.mpesaReceiptNumber || null);

    if (checkoutRequestID) {
      const vote = db.get('votes').find({ checkoutRequestID }).value();
      if (vote) {
        if (Number(resultCode) === 0) {
          // SUCCESS
          db.get('votes').find({ id: vote.id })
            .assign({ status: 'SUCCESS', transactionId: transactionId || null, completedAt: new Date().toISOString() })
            .write();

          // Increment nominee votes (1 KES == 1 vote)
          db.get('nominees').find({ id: vote.nomineeId })
            .update('votes', v => (v || 0) + vote.amount)
            .write();

          // Update settings wallet
          db.get('settings')
            .update('walletBalance', v => (v || 0) + vote.amount)
            .update('totalSuccessfulVotes', v => (v || 0) + 1)
            .write();

          // Update voter aggregate
          const voter = db.get('voters').find({ phone: vote.phone }).value();
          if (voter) {
            db.get('voters').find({ phone: vote.phone })
              .assign({
                totalVotes:  (voter.totalVotes  || 0) + vote.amount,
                totalAmount: (voter.totalAmount || 0) + vote.amount,
                lastVoteAt:  new Date().toISOString()
              }).write();
          } else {
            db.get('voters').push({
              phone: vote.phone,
              totalVotes: vote.amount,
              totalAmount: vote.amount,
              lastVoteAt: new Date().toISOString()
            }).write();
          }
        } else {
          db.get('votes').find({ id: vote.id })
            .assign({ status: 'FAILED', failureReason: stk.ResultDesc || stk.resultDesc || 'Payment failed', completedAt: new Date().toISOString() })
            .write();
        }
      }
    }
  } catch (e) {
    console.error('Callback processing error:', e);
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// ==========================================================================
//  ADMIN AUTH + API
// ==========================================================================
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === (process.env.ADMIN_USERNAME || 'admin') &&
      password === (process.env.ADMIN_PASSWORD || 'admin123')) {
    req.session.admin = username;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/admin/me', (req, res) => {
  if (req.session && req.session.admin) return res.json({ authenticated: true, user: req.session.admin });
  res.status(401).json({ authenticated: false });
});

// Dashboard stats
app.get('/api/admin/stats', requireAdmin, (_req, res) => {
  const nominees = db.get('nominees').value();
  const votes    = db.get('votes').value();
  const s        = db.get('settings').value();
  const start    = new Date(s.registrationStartDate);
  const elapsed  = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
  const daysLeft = Math.max(0, s.registrationDaysTotal - elapsed);

  res.json({
    totalNominees:   nominees.length,
    totalCategories: categories.length,
    totalVotesCast:  nominees.reduce((sum, n) => sum + (n.votes || 0), 0),
    successfulTx:    votes.filter(v => v.status === 'SUCCESS').length,
    pendingTx:       votes.filter(v => v.status === 'PENDING').length,
    failedTx:        votes.filter(v => v.status === 'FAILED').length,
    walletBalance:   s.walletBalance,
    daysLeft,
    registrationOpen: s.registrationOpen && daysLeft > 0,
    votingActive:     s.votingActive
  });
});

// Nominee management
app.get('/api/admin/nominees', requireAdmin, (_req, res) => {
  res.json(db.get('nominees').value());
});

app.delete('/api/admin/nominees/:id', requireAdmin, (req, res) => {
  db.get('nominees').remove({ id: req.params.id }).write();
  res.json({ success: true });
});

app.post('/api/admin/nominees/:id/add-votes', requireAdmin, (req, res) => {
  const add = parseInt(req.body.votes, 10) || 0;
  if (add === 0) return res.status(400).json({ error: 'Vote count required' });
  const n = db.get('nominees').find({ id: req.params.id }).value();
  if (!n) return res.status(404).json({ error: 'Not found' });
  db.get('nominees').find({ id: req.params.id })
    .update('votes', v => Math.max(0, (v || 0) + add))
    .write();
  res.json({ success: true, nominee: db.get('nominees').find({ id: req.params.id }).value() });
});

// Voters / voters info
app.get('/api/admin/voters', requireAdmin, (_req, res) => {
  res.json(db.get('voters').value());
});

// All votes/transactions
app.get('/api/admin/votes', requireAdmin, (_req, res) => {
  res.json(db.get('votes').value().slice().reverse());
});

app.get('/api/admin/transactions', requireAdmin, (_req, res) => {
  res.json(db.get('transactions').value().slice().reverse());
});

// Settings management
app.get('/api/admin/settings', requireAdmin, (_req, res) => {
  res.json(db.get('settings').value());
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const { registrationDaysTotal, registrationStartDate, votingActive, registrationOpen, walletBalance } = req.body || {};
  const patch = {};
  if (registrationDaysTotal !== undefined) patch.registrationDaysTotal = parseInt(registrationDaysTotal, 10);
  if (registrationStartDate !== undefined) patch.registrationStartDate = new Date(registrationStartDate).toISOString();
  if (votingActive !== undefined)          patch.votingActive          = !!votingActive;
  if (registrationOpen !== undefined)      patch.registrationOpen      = !!registrationOpen;
  if (walletBalance !== undefined)         patch.walletBalance         = parseFloat(walletBalance);
  db.get('settings').assign(patch).write();
  res.json({ success: true, settings: db.get('settings').value() });
});

app.post('/api/admin/settings/reset-days', requireAdmin, (req, res) => {
  const days = parseInt(req.body.days, 10) || 30;
  db.get('settings').assign({
    registrationDaysTotal: days,
    registrationStartDate: new Date().toISOString(),
    registrationOpen: true
  }).write();
  res.json({ success: true, settings: db.get('settings').value() });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`\n🎓 Kenya Campus Tour Crown Awards - Backend running on port ${PORT}`);
  console.log(`   Public API:  http://localhost:${PORT}`);
  console.log(`   Admin Panel: http://localhost:${PORT}/admin`);
  console.log(`   Callback:    ${process.env.KCB_CALLBACK_URL}`);
});
