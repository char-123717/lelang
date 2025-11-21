const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();
const { router: authRouter, verifyToken, users } = require('./authRoutes');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

// ====================== CONFIG ======================
const PORT = process.env.PORT || 3000;
const RPC = process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/7cdaf86234974d4c899f71faa758d7de';
const WS = process.env.SEPOLIA_WS_URL || 'wss://sepolia.infura.io/ws/v3/7cdaf86234974d4c899f71faa758d7de';
const CONTRACT_ADDRESS_101 = process.env.CONTRACT_ADDRESS_101 || '0xF4800bcC6e0690F4c7524e4347e098F618a3ff3F';
const CONTRACT_ADDRESS_102 = process.env.CONTRACT_ADDRESS_102 || '0x036b20234e5A20FB657fA698eB6c9853b40B2FaB';

// ====================== CONTRACT ABI ======================
const CONTRACT_ABI = [
  {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"bidder","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"total","type":"uint256"}],"name":"BidPlaced","type":"event"},
  {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"bidder","type":"address"},{"indexed":false,"internalType":"uint256","name":"total","type":"uint256"}],"name":"NewHighBid","type":"event"},
  {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"bidder","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Withdrawn","type":"event"},
  {"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"winner","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"AuctionEnded","type":"event"},
  {"inputs":[],"name":"auctionEndTime","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"highestBid","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"highestBidder","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"bids","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"bidders","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"biddersCount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"bid","outputs":[],"stateMutability":"payable","type":"function"},
  {"inputs":[],"name":"withdraw","outputs":[],"stateMutability":"nonpayable","type":"function"}
];

// ====================== APP SETUP ======================
const app = express();
app.use(cors());
app.use(express.json());

// INI YANG PENTING: JANGAN OTOMATIS SERVE index.html
app.use(express.static(__dirname, { index: false }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET","POST"] } });

app.use('/api/auth', authRouter);

// ====================== BLOCKCHAIN SETUP ======================
const provider = new ethers.providers.JsonRpcProvider(RPC);
let wsProvider = null;

const contracts = {
  '101': new ethers.Contract(CONTRACT_ADDRESS_101, CONTRACT_ABI, provider),
  '102': new ethers.Contract(CONTRACT_ADDRESS_102, CONTRACT_ABI, provider)
};

let wsContracts = {};
try {
  wsProvider = new ethers.providers.WebSocketProvider(WS);
  wsContracts = {
    '101': new ethers.Contract(CONTRACT_ADDRESS_101, CONTRACT_ABI, wsProvider),
    '102': new ethers.Contract(CONTRACT_ADDRESS_102, CONTRACT_ABI, wsProvider)
  };
} catch (e) {
  console.warn('WebSocket gagal, pakai polling saja');
}

// ====================== AUCTION STATE ======================
let auctionStates = {
  '101': { highestBid: 0, highestBidder: '-', bidHistory: [], auctionEndTime: 0, ended: false, minBid: 0.0001 },
  '102': { highestBid: 0, highestBidder: '-', bidHistory: [], auctionEndTime: 0, ended: false, minBid: 0.0001 }
};

function shortAddr(a) {
  if (!a || a === ethers.constants.AddressZero) return '-';
  return `${a.substring(0,6)}...${a.substring(a.length-4)}`;
}

// ====================== SYNC FROM CHAIN ======================
async function syncFromChain(auctionId) {
  if (!contracts[auctionId]) return;
  try {
    const [endBn, hbBn, hAddr] = await Promise.all([
      contracts[auctionId].auctionEndTime(),
      contracts[auctionId].highestBid(),
      contracts[auctionId].highestBidder()
    ]);

    const endTime = Number(endBn);
    const highestBidValue = parseFloat(ethers.utils.formatEther(hbBn));
    const highestBidderAddr = hAddr === ethers.constants.AddressZero ? '-' : hAddr;
    const isEnded = endTime <= Math.floor(Date.now() / 1000);

    auctionStates[auctionId].auctionEndTime = endTime;
    auctionStates[auctionId].highestBid = highestBidValue;
    auctionStates[auctionId].highestBidder = highestBidderAddr;
    auctionStates[auctionId].ended = isEnded;

    // Build bid history
    let count = 0;
    try { count = Number(await contracts[auctionId].biddersCount()); } catch {}

    const nameMap = new Map();
    io.sockets.sockets.forEach(s => {
      if (s.handshake.query.id === auctionId && s.handshake.query.name && s.handshake.query.walletAddress) {
        nameMap.set(s.handshake.query.walletAddress.toLowerCase(), s.handshake.query.name);
      }
    });

    const map = new Map();
    for (let i = 0; i < count; i++) {
      try {
        const addr = await contracts[auctionId].bidders(i);
        const totalBn = await contracts[auctionId].bids(addr);
        const total = parseFloat(ethers.utils.formatEther(totalBn));
        if (total > 0) {
          map.set(addr.toLowerCase(), {
            bidderName: nameMap.get(addr.toLowerCase()) || shortAddr(addr),
            walletAddress: addr,
            amount: total,
            ts: Date.now()
          });
        }
      } catch {}
    }

    if (highestBidderAddr !== '-' && highestBidValue > 0) {
      const lc = highestBidderAddr.toLowerCase();
      if (!map.has(lc) || (map.get(lc)?.amount || 0) < highestBidValue) {
        map.set(lc, {
          bidderName: nameMap.get(lc) || shortAddr(highestBidderAddr),
          walletAddress: highestBidderAddr,
          amount: highestBidValue,
          ts: Date.now()
        });
      }
    }

    auctionStates[auctionId].bidHistory = Array.from(map.values())
      .sort((a,b) => (b.amount || 0) - (a.amount || 0));

    // Broadcast
    io.to(auctionId).emit('highestBidUpdate', { auctionId, amount: highestBidValue, bidderName: highestBidderAddr });
    io.to(auctionId).emit('bidHistoryUpdate', auctionStates[auctionId].bidHistory);
    io.to('lobby').emit('auctionStateUpdate', {
      auctionId,
      highestBid: highestBidValue,
      ended: isEnded,
      timeLeft: Math.max(0, endTime - Math.floor(Date.now() / 1000))
    });

  } catch (e) {
    console.error(`syncFromChain error (${auctionId})`, e.message);
  }
}

Object.keys(auctionStates).forEach(id => syncFromChain(id));

// ====================== SOCKET.IO ======================
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    if (socket.handshake.query.id === 'lobby') return next();
    return next(new Error('Authentication required'));
  }
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Invalid token'));
    socket.user = decoded;
    next();
  });
});

io.on('connection', socket => {
  const q = socket.handshake.query || {};
  const auctionId = q.id || '101';

  if (auctionId === 'lobby') {
    socket.join('lobby');
    Object.keys(auctionStates).forEach(id => {
      socket.emit('auctionStateUpdate', {
        auctionId: id,
        highestBid: auctionStates[id].highestBid,
        ended: auctionStates[id].ended,
        timeLeft: Math.max(0, auctionStates[id].auctionEndTime - Math.floor(Date.now() / 1000))
      });
    });
  } else {
    if (!socket.user) return socket.disconnect();
    socket.join(auctionId);
    if (auctionStates[auctionId]) {
      socket.emit('highestBidUpdate', { auctionId, amount: auctionStates[auctionId].highestBid, bidderName: auctionStates[auctionId].highestBidder });
      socket.emit('bidHistoryUpdate', auctionStates[auctionId].bidHistory);
      socket.emit('timerUpdate', {
        id: auctionId,
        seconds: Math.max(0, auctionStates[auctionId].auctionEndTime - Math.floor(Date.now()/1000)),
        ended: auctionStates[auctionId].ended
      });
    }
  }
});

Object.keys(wsContracts).forEach(id => {
  const c = wsContracts[id];
  ['BidPlaced', 'NewHighBid', 'Withdrawn', 'AuctionEnded'].forEach(ev => {
    try { c.on(ev, () => syncFromChain(id)); } catch {}
  });
});

// ====================== TIMER & PERIODIC SYNC ======================
setInterval(() => {
  Object.keys(auctionStates).forEach(id => {
    const now = Math.floor(Date.now() / 1000);
    const timeLeft = Math.max(0, auctionStates[id].auctionEndTime - now);
    const ended = timeLeft <= 0 || auctionStates[id].ended;

    io.to(id).emit('timerUpdate', { id, seconds: timeLeft, ended });
    io.to('lobby').emit('auctionStateUpdate', { auctionId: id, highestBid: auctionStates[id].highestBid, ended, timeLeft });

    if (ended && !auctionStates[id].ended) {
      auctionStates[id].ended = true;
      syncFromChain(id);
    }
  });
}, 1000);

setInterval(() => Object.keys(auctionStates).forEach(id => syncFromChain(id).catch(()=>{})), 30000);

// ====================== API ENDPOINTS ======================
app.get('/api/auction-details', (req, res) => {
  const id = req.query.id || '101';
  if (!auctionStates[id]) return res.status(404).json({ ok: false });
  res.json({
    ok: true,
    auctionId: id,
    contractAddress: contracts[id].address,
    minBid: auctionStates[id].minBid,
    highestBid: auctionStates[id].highestBid,
    auctionEndTime: auctionStates[id].auctionEndTime,
    ended: auctionStates[id].ended
  });
});

app.post('/api/withdrawn', (req, res) => {
  try {
    const { walletAddress, auctionId } = req.body;
    if (!walletAddress || !auctionId) return res.status(400).json({ ok:false });
    const entry = auctionStates[auctionId]?.bidHistory.find(e => e.walletAddress?.toLowerCase() === walletAddress.toLowerCase());
    if (entry) entry.amount = 0;
    auctionStates[auctionId]?.bidHistory.sort((a,b)=> (b.amount||0)-(a.amount||0));
    io.to(auctionId).emit('bidHistoryUpdate', auctionStates[auctionId].bidHistory);
    setTimeout(() => syncFromChain(auctionId), 1500);
    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ====================== HTML ROUTES (SEMUA FILE TETAP DI ROOT) ======================

// ROOT — Kalau belum login → langsung ke signin.html
app.get('/', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.redirect('/signin.html');

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = users.get(decoded.email);
    if (user && user.verified) {
      return res.sendFile(path.join(__dirname, 'index.html'));   // ← TETAP DI ROOT
    }
    return res.redirect('/signin.html?error=unverified');
  } catch {
    return res.redirect('/signin.html');
  }
});

app.get('/signin.html',  (req, res) => res.sendFile(path.join(__dirname, 'signin.html')));
app.get('/signup.html',  (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));
app.get('/forgot.html',  (req, res) => res.sendFile(path.join(__dirname, 'forgot.html')));
app.get('/reset.html', verifyToken, (req, res) => {
  const user = users.get(req.user.email);
  if (!user || !user.requiresPasswordReset) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'reset.html'));
});

app.get('/auction.html', verifyToken, async (req, res) => {
  try {
    const auctionId = req.query.id || '101';
    if (!contracts[auctionId]) return res.redirect('/');
    const user = users.get(req.user.email);
    if (!user || !user.verified) return res.redirect('/signin.html?error=unverified');

    const endTime = await contracts[auctionId].auctionEndTime();
    const now = Math.floor(Date.now() / 1000);
    if (now > endTime || auctionStates[auctionId].ended) return res.redirect('/');

    res.sendFile(path.join(__dirname, 'auction.html'));   // ← TETAP DI ROOT
  } catch (e) {
    console.error(e);
    res.redirect('/');
  }
});

// ====================== START SERVER ======================
server.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  Object.keys(auctionStates).forEach(id => syncFromChain(id));
});