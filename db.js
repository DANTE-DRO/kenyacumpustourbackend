// Pure-JavaScript JSON database using lowdb v1 (no native build required)
// Persists to db.json - safe on Render free plan (no better-sqlite3 gyp issues)
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, 'db.json'));
const db = low(adapter);

// Seed the database with default structure on first run
db.defaults({
  nominees: [],           // { id, name, email, phone, location, university, category, votes, createdAt }
  votes: [],              // { id, nomineeId, amount, phone, status, checkoutRequestID, merchantRequestID, transactionId, createdAt }
  voters: [],             // { phone, totalVotes, totalAmount, lastVoteAt }
  settings: {
    registrationDaysTotal: 30,
    registrationStartDate: new Date().toISOString(),
    votingActive: true,
    registrationOpen: true,
    walletBalance: 0,
    totalSuccessfulVotes: 0
  },
  transactions: []        // full callback log
}).write();

module.exports = db;
