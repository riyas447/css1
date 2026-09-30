const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Root Directory Static File Serving
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 🔴 SPAMHAUS INTEL API CREDENTIALS
const SPAMHAUS_CONFIG = {
  username: "rnlhyavy@92190379",
  password: "qmyaPA1n>=eF8p6C", // 👈 உங்கள் உண்மையான Passcode போடவும்
  realm: "intel"
};

let cachedToken = null;
let tokenExpiry = null;

// Spamhaus Login to Get Bearer Token
async function getSpamhausToken() {
  const now = new Date();
  if (cachedToken && tokenExpiry && now < tokenExpiry) {
    return cachedToken;
  }

  try {
    const response = await axios.post('https://api.spamhaus.org/api/v1/login', {
      username: SPAMHAUS_CONFIG.username,
      password: SPAMHAUS_CONFIG.password,
      realm: SPAMHAUS_CONFIG.realm
    });

    cachedToken = response.data.token || response.data.access_token;
    tokenExpiry = new Date(now.getTime() + 45 * 60 * 1000); // 45 Mins Expiry
    console.log("✅ Authenticated with Spamhaus Intel API!");
    return cachedToken;
  } catch (error) {
    console.error("❌ Authentication Error:", error.response?.data || error.message);
    throw new Error("Spamhaus API Authentication Failed");
  }
}

// Check IP against Spamhaus Intel API
async function checkSingleIP(ip, token) {
  const cleanIp = ip.trim();
  const isCidr = cleanIp.includes('/');
  const objType = isCidr ? 'cidr' : 'ip';

  // Zones to check: SBL, CSS, XBL, PBL
  const zones = ['SBL', 'CSS', 'XBL', 'PBL'];
  const detectedListings = [];

  for (const zone of zones) {
    try {
      const url = `https://api.spamhaus.org/api/intel/v1/byobject/${objType}/${zone}/listed/history/${cleanIp}?limit=1`;
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000
      });

      if (response.data && response.data.length > 0) {
        detectedListings.push(zone);
      }
    } catch (err) {
      // 404 Status means Clean / Not Listed in this specific zone
      if (err.response && err.response.status === 404) {
        continue;
      }
    }
  }

  const isListed = detectedListings.length > 0;
  return {
    ip: cleanIp,
    isListed: isListed,
    status: isListed ? `Listed in ${detectedListings.join(', ')}` : 'Not listed',
    zones: detectedListings,
    url: `https://check.spamhaus.org/results?query=${cleanIp}`
  };
}

// Bulk IP Checking Route
app.post('/api/check-bulk', async (req, res) => {
  const { ips } = req.body;
  if (!ips || !Array.isArray(ips)) {
    return res.status(400).json({ error: "Invalid request payload" });
  }

  try {
    const token = await getSpamhausToken();
    const results = await Promise.all(ips.map(ip => checkSingleIP(ip, token)));
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});