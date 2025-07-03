const Web3 = require("web3");
const axios = require("axios");

// --- CONFIGURATION ---
const RPC_URL = "https://testnet.hashio.io/api";
const PRIVATE_KEY =
  "7b5c03deb9f5056f07d3f4e934c1d051832fc62a088ba361d02af083eb07b5f7";
const CONTRACT_ADDRESS = "0x5310E12D33A1Cdcf8CE105EDC2E9A66B9D61eed0";
const MAX_RETRIES = 3;

const CONTRACT_ABI = [
  {
    inputs: [{ internalType: "int256", name: "price", type: "int256" }],
    name: "startNewRound",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "int256",
        name: "actualPrice",
        type: "int256",
      },
    ],
    name: "resolveRound",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "hasBetsInCurrentRound",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

// --- SETUP ---
let web3 = new Web3(new Web3.providers.HttpProvider(RPC_URL));
let account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
web3.eth.accounts.wallet.add(account);
web3.eth.defaultAccount = account.address;

const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

// --- Utilities ---
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

const recreateProvider = () => {
  web3.setProvider(new Web3.providers.HttpProvider(RPC_URL));
  log("🔄 Web3 provider reset.");
};

const isRPCAlive = async () => {
  try {
    await web3.eth.net.isListening();
    return true;
  } catch (err) {
    log(`❌ RPC not available: ${err.message}`);
    return false;
  }
};

const fetchBTCPrice = async () => {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get(
        "https://api.binance.com/api/v3/ticker/price",
        {
          params: { symbol: "BTCUSDT" },
        }
      );
      const price = Math.round(parseFloat(response.data.price));
      return price;
    } catch (err) {
      log(`⚠️ BTC price fetch failed (attempt ${attempt + 1}): ${err.message}`);
      await sleep(3000);
    }
  }
  return null;
};

const startRoundWithRetry = async (price) => {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const tx = await contract.methods.startNewRound(price).send({
        from: account.address,
        gas: 300000, // Gas limit for startNewRound
      });
      return tx;
    } catch (err) {
      log(`⚠️ startNewRound failed (attempt ${attempt + 1}): ${err.message}`);
      if (err.message.includes("CONNECTION ERROR")) {
        recreateProvider();
      }
      await sleep(3000);
    }
  }

  log(`❌ startNewRound failed after ${MAX_RETRIES} attempts. Restarting app.`);
  process.exit(1);
};

const resolveRoundWithRetry = async (actualPrice) => {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const tx = await contract.methods.resolveRound(actualPrice).send({
        from: account.address,
        gas: 1000000, // Gas limit for resolveRound
      });
      return tx;
    } catch (err) {
      log(`⚠️ resolveRound failed (attempt ${attempt + 1}): ${err.message}`);
      if (err.message.includes("CONNECTION ERRO")) {
        recreateProvider();
      }
      await sleep(3000);
    }
  }

  log(`❌ resolveRound failed after ${MAX_RETRIES} attempts. Restarting app.`);
  process.exit(1);
};

// --- Main Loop ---
const mainLoop = async () => {
  while (true) {
    try {
      log("⏳ Phase 1: Waiting 20s for players to join...");
      await sleep(10000);

      if (!(await isRPCAlive())) {
        log("🚫 RPC down. Skipping this round.");
        await sleep(5000);
        continue;
      }

      const startPrice = await fetchBTCPrice();
      if (!startPrice) {
        log("❌ Failed to fetch BTC start price. Restarting app.");
        process.exit(1);
      }

      log(`🚀 Starting round with BTC price: ${startPrice}`);
      await startRoundWithRetry(startPrice);
      log("✅ Round started");

      log("⏳ Waiting 40s for bets...");
      await sleep(25000);

      const hasBets = await contract.methods.hasBetsInCurrentRound().call();

      if (!hasBets) {
        log("🚫 No bets in current round. Skipping resolveRound.");
      } else {
        const endPrice = await fetchBTCPrice();
        if (!endPrice) {
          log("❌ Failed to fetch BTC end price. Restarting app.");
          process.exit(1);
        }

        log(`🔚 Resolving round with BTC price: ${endPrice}`);
        await resolveRoundWithRetry(endPrice);
        log("🏁 Round resolved");
      }

      log("🔄 Restarting cycle...");
    } catch (err) {
      log(`🔥 Error in main loop: ${err.message}`);
      log("🛑 Restarting due to fatal error.");
      process.exit(1);
    }

    await sleep(5000);
  }
};

// --- Error Handlers ---
process.on("uncaughtException", (err) => {
  log(`🔥 Uncaught Exception: ${err.message}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log(`🔥 Unhandled Rejection: ${reason}`);
  process.exit(1);
});

// --- Start ---
mainLoop();