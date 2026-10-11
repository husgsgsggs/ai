import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================
// CONFIGURATION
// ============================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BOT_NAME = process.env.BOT_NAME || 'Hakari Kinji';
const COMMAND_PREFIX = '.';
const AUTH_DIR = process.env.AUTH_DIR || 'auth_info_baileys';

const logger = pino({ level: 'silent' });

// ============================================================
// GEMINI SETUP
// ============================================================
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash'
});

// ============================================================
// .alive MESSAGE (STYLISH)
// ============================================================
function getAliveMessage() {
  return `
┏━━━━━━━━━━━━━━━━━━━━━━━┓
┃  ⚡ *FEVER MODE ACTIVATED* ⚡  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━┛

  🎰 *I AM ALIVE* 🎰

  ┌─────────────────────┐
  │  Owner  : ${BOT_NAME}
  │  Status : ✦ ONLINE ✦
  │  Mode   : 🔥 JACKPOT 🔥
  └─────────────────────┘

  ╔══════════════════════╗
  ║  "Life itself is a    ║
  ║   gamble. I love      ║
  ║   the fever!"         ║
  ╚══════════════════════╝

  ⚡ Powered by Gemini AI
  ━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();
}

// ============================================================
// GEMINI QUERY
// ============================================================
async function askGemini(question) {
  try {
    const prompt = question.trim();
    if (!prompt) return '❌ Please provide a question. Usage: .ai [your question]';

    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    if (!text || text.trim() === '') {
      return '🤖 Gemini returned an empty response. Try rephrasing.';
    }

    return text.trim();
  } catch (error) {
    console.error('[Gemini Error]', error.message);
    return `❌ AI Error: ${error.message}`;
  }
}

// ============================================================
// START WHATSAPP BOT
// ============================================================
async function startBot() {
  // Load persistent session from disk
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    logger,
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '120.0.0'],
    generateHighQualityLinkPreview: false,
    keepAliveIntervalMs: 30000,
    connectTimeoutMs: 60000
  });

  // ---------- CONNECTION EVENTS ----------
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Scan this QR code (expires in ~20s):\n');
      qrcode.generate(qr, { small: true });
      console.log('\n⚠️ If it expires, restart the process for a new code.\n');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`\n⚠️ Connection closed. Status: ${statusCode}`);
      console.log(`   Reconnect: ${shouldReconnect ? 'YES' : 'NO (logged out)'}`);

      if (shouldReconnect) {
        setTimeout(() => startBot(), 5000);
      } else {
        console.log('❌ Session logged out. Delete auth folder and scan again.');
      }
    } else if (connection === 'open') {
      console.log('\n✅ WhatsApp Userbot Connected!');
      console.log(`   Bot: ${BOT_NAME}`);
      console.log(`   Commands: ${COMMAND_PREFIX}alive | ${COMMAND_PREFIX}ai [question]\n`);
    }
  });

  // Persist credentials on every update
  sock.ev.on('creds.update', saveCreds);

  // ---------- MESSAGE HANDLER ----------
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    const msg = messages[0];
    if (!msg?.message) return;

    // Ignore own messages to prevent loops
    if (msg.key.fromMe) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      '';

    if (!text) return;

    const senderJid = msg.key.remoteJid;
    const trimmed = text.trim();

    // ---------- .alive ----------
    if (trimmed.toLowerCase() === `${COMMAND_PREFIX}alive`) {
      await sock.sendMessage(senderJid, {
        text: getAliveMessage()
      }, { quoted: msg });

      console.log(`[.alive] Replied to ${senderJid}`);
      return;
    }

    // ---------- .ai [question] ----------
    if (trimmed.toLowerCase().startsWith(`${COMMAND_PREFIX}ai `)) {
      const question = trimmed.slice(4).trim();

      await sock.sendPresenceUpdate('composing', senderJid);

      const answer = await askGemini(question);

      await sock.sendMessage(senderJid, {
        text: `🤖 *Gemini AI*\n\n${answer}`
      }, { quoted: msg });

      console.log(`[.ai] "${question}" → replied to ${senderJid}`);
      return;
    }
  });

  return sock;
}

// ============================================================
// GLOBAL ERROR HANDLERS
// ============================================================
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});

startBot().catch((err) => {
  console.error('❌ Fatal startup error:', err);
  process.exit(1);
});
