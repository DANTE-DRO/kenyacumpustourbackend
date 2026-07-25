// KCB Buni STK Push Integration
// Docs: https://buni.kcbgroup.com/
const axios = require('axios');

class KCBBuni {
  constructor() {
    this.baseURL       = process.env.KCB_BASE_URL       || 'https://api.buni.kcbgroup.com';
    this.tokenEndpoint = process.env.KCB_TOKEN_ENDPOINT || 'https://api.buni.kcbgroup.com/token';
    this.stkEndpoint   = process.env.KCB_STK_ENDPOINT   || 'https://api.buni.kcbgroup.com/mm/api/request/1.0.0/stkpush';
    this.consumerKey    = process.env.KCB_CONSUMER_KEY;
    this.consumerSecret = process.env.KCB_CONSUMER_SECRET;
    this.callbackURL    = process.env.KCB_CALLBACK_URL;
    this.shortcode      = process.env.KCB_SHORTCODE || '8112320';
    this.till           = process.env.KCB_TILL       || '8112320';

    this.accessToken = null;
    this.tokenExpiry = 0;
  }

  // Format phone to 254XXXXXXXXX
  formatPhone(phone) {
    let p = String(phone || '').replace(/\D/g, '');
    if (p.startsWith('0'))     p = '254' + p.substring(1);
    else if (p.startsWith('+254')) p = p.substring(1);
    else if (p.startsWith('254')) { /* ok */ }
    else if (p.length === 9)    p = '254' + p;
    return p;
  }

  // Format the invoice number correctly per KCB support email:
  // "KCB Till/Account number followed by the account reference separated by a hash (#) or hyphen (-)"
  formatInvoiceNumber(reference) {
    const clean = String(reference || 'VOTE').replace(/[^A-Za-z0-9]/g, '').substring(0, 20) || 'VOTE';
    return `${this.till}#${clean}`;
  }

  async getAccessToken() {
    // Reuse cached token if still valid (60s buffer)
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }
    const credentials = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
    try {
      // KCB Buni token endpoint accepts POST with grant_type in query string OR form body
      const { data } = await axios.post(`${this.tokenEndpoint}?grant_type=client_credentials`, null, {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 20000
      });
      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + (parseInt(data.expires_in || 3599, 10) * 1000);
      return this.accessToken;
    } catch (err) {
      const msg = err.response ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`KCB token request failed: ${msg}`);
    }
  }

  async stkPush({ phone, amount, reference, description }) {
    const token = await this.getAccessToken();
    const formattedPhone = this.formatPhone(phone);
    const invoiceNumber  = this.formatInvoiceNumber(reference);

    // KCB Buni STK Push payload - correct field names per official docs
    const remarks = String(description || `Vote ${reference}`).substring(0, 50) || 'Vote payment';
    const payload = {
      phoneNumber:            formattedPhone,
      amount:                 String(amount),
      invoiceNumber:          invoiceNumber,
      sharedShortCode:        true,
      orgShortCode:           this.shortcode,
      orgPassKey:             '',
      callbackUrl:            this.callbackURL,
      transactionDescription: remarks
    };

    try {
      const { data } = await axios.post(this.stkEndpoint, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        timeout: 30000
      });
      return { success: true, data, request: payload };
    } catch (err) {
      const responseData = err.response ? err.response.data : null;
      const status = err.response ? err.response.status : null;
      return {
        success: false,
        error: err.message,
        status,
        response: responseData,
        request: payload
      };
    }
  }
}

module.exports = new KCBBuni();
