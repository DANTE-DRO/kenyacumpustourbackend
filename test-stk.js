// Manual STK Push test: `node test-stk.js`
// Sends a KES 1 STK push to the number below to verify KCB integration.
require('dotenv').config();
const kcb = require('./kcb');

const TEST_PHONE  = '0797977136';
const TEST_AMOUNT = 1;
const TEST_REF    = 'TESTVOTE';

(async () => {
  console.log('== KCB Buni STK Push Test ==');
  console.log('Phone:  ', TEST_PHONE);
  console.log('Amount: KES', TEST_AMOUNT);
  console.log('Reference:', TEST_REF);
  console.log('Formatted invoice:', kcb.formatInvoiceNumber(TEST_REF));
  console.log('');

  try {
    console.log('Requesting access token...');
    const token = await kcb.getAccessToken();
    console.log('Token OK (first 20 chars):', token.substring(0, 20) + '...');
    console.log('');

    console.log('Sending STK push...');
    const result = await kcb.stkPush({
      phone: TEST_PHONE,
      amount: TEST_AMOUNT,
      reference: TEST_REF,
      description: 'Kenya Campus Tour test'
    });

    console.log('Result:', JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exit(1);
  }
})();
