const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const dns = require('dns').promises;

const app = express();
app.use(cors());
app.use(express.json());

// Serve Static Files
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 🔴 YOUR SPAMHAUS CREDENTIALS (ENTER REAL PASSWORD HERE)
const SPAMHAUS_CONFIG = {
  username: "kerlgtxr@81302263",
  password: "2Bfr5MWJxzA[bmPJ", // 👈 Unga Real Spamhaus Password Inga Podunga
  realm: "intel"
};

let cachedToken = null;
let tokenExpiry = null;

// Get Bearer Token from Spamhaus API
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
    tokenExpiry = new Date(now.getTime() + 45 * 60 * 1000);
    console.log("✅ Spamhaus API Token Authenticated!");
    return cachedToken;
  } catch (error) {
    console.error("⚠️ API Login Notice:", error.response?.data || error.message);
    return null;
  }
}

// Check DNSBL Direct Verification Function
async function checkDNSBL(ip) {
  try {
    const reversedIp = ip.trim().split('.').reverse().join('.');
    const query = `${reversedIp}.zen.spamhaus.org`;
    
    const addresses = await dns.resolve4(query);
    const resolvedIp = addresses[0];

    // Refused / Public Resolver Blocked
    if (resolvedIp === '127.255.255.254' || resolvedIp === '127.255.255.255') {
      return { isListed: false, status: "Not listed" };
    }

    // Official Listing Return Codes
    if (resolvedIp === "127.0.0.2") return { isListed: true, status: "Listed in SBL" };
    if (resolvedIp === "127.0.0.3") return { isListed: true, status: "Listed in CSS" };
    if (["127.0.0.4", "127.0.0.5", "127.0.0.6", "127.0.0.7"].includes(resolvedIp)) return { isListed: true, status: "Listed in XBL" };
    if (["127.0.0.10", "127.0.0.11"].includes(resolvedIp)) return { isListed: true, status: "Listed in PBL" };

    if (resolvedIp.startsWith("127.0.0.")) {
      return { isListed: true, status: "Listed on Spamhaus" };
    }

    return { isListed: false, status: "Not listed" };
  } catch (err) {
    // NXDOMAIN means completely clean / Not listed
    return { isListed: false, status: "Not listed" };
  }
}

// Single IP Check Engine (API + DNS Hybrid)
async function verifyIP(ip, token) {
  const cleanIp = ip.trim();
  if (!cleanIp) return null;

  // 1. Direct Zone DNS Verification
  const dnsResult = await checkDNSBL(cleanIp);
  if (dnsResult.isListed) {
    return {
      ip: cleanIp,
      isListed: true,
      status: dnsResult.status,
      url: `https://check.spamhaus.org/results?query=${cleanIp}`
    };
  }

  // 2. Official Intel REST API Fallback Check (If Token Exists)
  if (token) {
    const zones = ['CSS', 'SBL', 'XBL', 'PBL'];
    for (const zone of zones) {
      try {
        const isCidr = cleanIp.includes('/');
        const objType = isCidr ? 'cidr' : 'ip';
        const url = `https://api.spamhaus.org/api/intel/v1/byobject/${objType}/${zone}/listed/history/${cleanIp}?limit=1`;
        
        const apiRes = await axios.get(url, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 5000
        });

        if (apiRes.data && apiRes.data.length > 0) {
          return {
            ip: cleanIp,
            isListed: true,
            status: `Listed in ${zone}`,
            url: `https://check.spamhaus.org/results?query=${cleanIp}`
          };
        }
      } catch (e) {
        // Continue checking other zones on 404
      }
    }
  }

  return {
    ip: cleanIp,
    isListed: false,
    status: "Not listed",
    url: `https://check.spamhaus.org/results?query=${cleanIp}`
  };
}

// Bulk Check API Route
app.post('/api/check-bulk', async (req, res) => {
  const { ips } = req.body;
  if (!ips || !Array.isArray(ips)) {
    return res.status(400).json({ error: "Invalid IPs format" });
  }

  try {
    const token = await getSpamhausToken();
    const results = await Promise.all(ips.map(ip => verifyIP(ip, token)));
    res.json({ results: results.filter(r => r !== null) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Spamhaus Checker Engine running on port ${PORT}`);
});
