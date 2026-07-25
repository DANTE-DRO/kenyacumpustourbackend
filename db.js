// ==========================================================================
//  Pure-JavaScript JSON database using lowdb v1 (NO native build required)
//  - Persists to db.json in project root
//  - Safe on Render free plan (no better-sqlite3 gyp issues)
//  - NOTE: On Render free plan the disk is ephemeral (reset on redeploy/sleep),
//    so nominees are ALSO persisted permanently to data/registeredNominees.js
//    (a real .js file appended to disk) as a code-level backup source.
// ==========================================================================
const low       = require('lowdb');
const FileSync  = require('lowdb/adapters/FileSync');
const path      = require('path');
const fs        = require('fs');

const DB_FILE = path.join(__dirname, 'db.json');
const adapter = new FileSync(DB_FILE);
const db      = low(adapter);

// Seed default structure on first run
db.defaults({
  nominees:     [],   // { id, name, email, phone, location, university, category, votes, createdAt }
  votes:        [],   // { id, nomineeId, amount, phone, status, checkoutRequestID, ... }
  voters:       [],   // { phone, totalVotes, totalAmount, lastVoteAt }
  settings: {
    registrationDaysTotal: 30,
    registrationStartDate: new Date().toISOString(),
    votingActive: true,
    registrationOpen: true,
    walletBalance: 0,
    totalSuccessfulVotes: 0
  },
  transactions: []
}).write();

// --------------------------------------------------------------------------
//  Load registered nominees FROM CODE (data/registeredNominees.js) on start
//  This ensures nominees survive even if db.json is wiped by Render redeploy.
// --------------------------------------------------------------------------
try {
  const codeFilePath = path.join(__dirname, 'data', 'registeredNominees.js');
  if (fs.existsSync(codeFilePath)) {
    // Clear require cache so we always read the latest disk content
    delete require.cache[require.resolve('./data/registeredNominees.js')];
    const codeNominees = require('./data/registeredNominees.js');
    if (Array.isArray(codeNominees) && codeNominees.length) {
      const existing = db.get('nominees').value() || [];
      const existingIds = new Set(existing.map(n => n.id));
      const existingEmails = new Set(existing.map(n => `${(n.email||'').toLowerCase()}|${n.category}`));
      let added = 0;
      codeNominees.forEach(n => {
        const key = `${(n.email||'').toLowerCase()}|${n.category}`;
        if (!existingIds.has(n.id) && !existingEmails.has(key)) {
          db.get('nominees').push({ votes: 0, ...n }).write();
          added++;
        }
      });
      if (added) console.log(`[DB] Loaded ${added} nominee(s) from data/registeredNominees.js (permanent code storage)`);
    }
  }
} catch (e) {
  console.error('[DB] Failed to load nominees from code file:', e.message);
}

// --------------------------------------------------------------------------
//  Append a nominee to data/registeredNominees.js so it becomes PERMANENT
//  (survives Render redeploys / free-plan sleep resets).
// --------------------------------------------------------------------------
db.persistNomineeToCode = function persistNomineeToCode(nominee) {
  try {
    const dir      = path.join(__dirname, 'data');
    const filePath = path.join(dir, 'registeredNominees.js');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let list = [];
    if (fs.existsSync(filePath)) {
      try {
        delete require.cache[require.resolve('./data/registeredNominees.js')];
        list = require('./data/registeredNominees.js');
        if (!Array.isArray(list)) list = [];
      } catch { list = []; }
    }
    // Avoid duplicate by id or (email+category)
    const key = `${(nominee.email||'').toLowerCase()}|${nominee.category}`;
    const already = list.some(n =>
      n.id === nominee.id ||
      `${(n.email||'').toLowerCase()}|${n.category}` === key
    );
    if (!already) {
      list.push(nominee);
      const header = '// ==========================================================================\n' +
                     '//  Registered nominees - AUTO-GENERATED permanent storage.\n' +
                     '//  This file is appended to whenever someone completes the registration\n' +
                     '//  form so nominees survive Render free-plan restarts / redeploys.\n' +
                     '//  DO NOT hand-edit while the server is running.\n' +
                     '// ==========================================================================\n';
      const body = 'module.exports = ' + JSON.stringify(list, null, 2) + ';\n';
      fs.writeFileSync(filePath, header + body, 'utf8');
    }
  } catch (e) {
    console.error('[DB] persistNomineeToCode failed:', e.message);
  }
};

module.exports = db;
