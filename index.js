require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const session = require("express-session");
const bodyParser = require("body-parser");
const { Client, LocalAuth, Poll, MessageMedia } = require("whatsapp-web.js");
const fs = require("fs");
const path = require("path");
const fsAwait = fs.promises;
const { createCanvas } = require("canvas");
const QRCode = require("qrcode");
const axios = require("axios");
const db = require("./db");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron");
const gtts = require("gtts");
const dashboardRoutes = require("./routes/dashboard");
const socketManager = require("./utils/socketManager");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const port = 3000;

// Initialize Socket.IO manager
socketManager.setSocketIO(io);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DATA_FILE = path.join(__dirname, "muted.json");
// Support multiple group IDs separated by comma
const MORNING_GROUP_IDS = process.env.MORNING_GROUP_IDS 
  ? process.env.MORNING_GROUP_IDS.split(',').map(id => id.trim())
  : ["120363402403833771@g.us"];
const MORNING_TIME = process.env.MORNING_TIME || "0 7 * * *"; // Default: 07:00 setiap hari

// Multi-language greetings
const GREETINGS = {
  morning: {
    id: "Selamat pagi semuanya",
    en: "Good morning everyone",
    su: "Wilujeng énjing sadayana", // Sunda
    jv: "Sugeng enjing sedoyo" // Jawa
  },
  afternoon: {
    id: "Selamat sore semuanya",
    en: "Good afternoon everyone",
    su: "Wilujeng sonten sadayana", // Sunda
    jv: "Sugeng sonten sedoyo" // Jawa
  }
};

// Language rotation mode: 'rotate' or 'random'
const LANGUAGE_MODE = process.env.LANGUAGE_MODE || "rotate"; // rotate = bergiliran, random = acak

// Group IDs yang akan menerima pesan tambahan setelah voice note
const MORNING_EXTRA_MESSAGE_GROUP_IDS = process.env.MORNING_EXTRA_MESSAGE_GROUP_IDS
  ? process.env.MORNING_EXTRA_MESSAGE_GROUP_IDS.split(',').map(id => id.trim())
  : [];

// Pesan tambahan untuk grup tertentu
const MORNING_EXTRA_MESSAGE = `📢 *REMINDER PEMBAYARAN* 📢

⚠️ Mengingatkan yang merasa belum bayar sama sekali

💰 *KEWAJIBAN BULANAN:*
Dalam sebulan per orang harus masuk *100k*

👕 *JAHIM:* 330k (S-XXL) untuk bulan November
   • Boleh dicicil
   • Size XXXL +15rb
   • *Total: 330k*

💼 *KAS ANGKATAN:* 15k/bulan
   • Boleh nyicil

🏦 *TRANSFER KE:*
*BCA 1381309415*
a/n *Sugesty Ibnaty Wadiaturabby*

⚠️ Aku ga punya dana ya 🙏🏻

Terima kasih atas perhatiannya! 🙏`;

// Store QR code untuk dashboard
let currentQRCode = null;
let isClientReady = false;
let clientStatus = 'disconnected'; // disconnected, qr, connecting, connected

// Express middleware configuration
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "wa-bot-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }, // 24 hours
  })
);

// Dashboard routes
app.use("/", dashboardRoutes);

// Pass sendMorningGreeting function ke dashboard routes
dashboardRoutes.setSendMorningGreeting(sendMorningGreeting);

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "ridho-wa", // folder session unik
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },
  webVersionCache: {
    type: "remote",
    remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html"
  }
});

const saveLastMessage = async (phone, messages) => {
  const upsert = await db("last_messages")
    .insert({
      phone,
      messages,
    })
    .onConflict("phone")
    .merge({
      phone,
      messages,
    });

  return upsert;
};

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ 
      muted: [], 
      log: [], 
      admins: [],
      languageIndex: 0 // Track current language index for rotation
    }, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  // Ensure admins array exists
  if (!data.admins) {
    data.admins = [];
  }
  // Ensure languageIndex exists
  if (data.languageIndex === undefined) {
    data.languageIndex = 0;
  }
  return data;
}

// helper save data
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

client.on("ready", () => {
  console.log("Client is ready!");
  
  // Update status koneksi
  isClientReady = true;
  clientStatus = 'connected';
  currentQRCode = null; // Clear QR code setelah connected
  dashboardRoutes.setQRCode(null);
  dashboardRoutes.setClientStatus(clientStatus);
  
  // Emit to all connected clients
  socketManager.emitConnectionStatus('connected', {
    info: client.info,
    message: '✅ WhatsApp connected successfully!'
  });
  
  // Setup morning greeting scheduler
  setupMorningGreeting();
});

client.on("qr", (qr) => {
  // Hanya generate QR jika belum connected
  if (!isClientReady) {
    qrcode.generate(qr, { small: true });
    
    // Update status
    clientStatus = 'qr';
    
    // Save QR code untuk dashboard
    currentQRCode = qr;
    dashboardRoutes.setQRCode(qr);
    dashboardRoutes.setClientStatus(clientStatus);
    
    // Emit QR code to all connected clients via Socket.IO
    socketManager.emitQRCode(qr);
    
    // Save ke file juga (backward compatibility)
    fs.writeFileSync(path.join(__dirname, "whatsapp.qr"), qr);
    console.log("[QR Code] QR code telah di-generate dan tersedia di dashboard");
  } else {
    console.log("[QR Code] Client sudah terkoneksi, skip QR generation");
  }
});

client.on("authenticated", () => {
  console.log("[WhatsApp] Client authenticated!");
  clientStatus = 'connecting';
  dashboardRoutes.setClientStatus(clientStatus);
  socketManager.emitConnectionStatus('connecting', { message: 'Authenticating...' });
});

client.on("loading_screen", (percent, message) => {
  console.log(`[WhatsApp] Loading... ${percent}% - ${message}`);
  socketManager.emitConnectionStatus('loading', { percent, message });
});

client.on("disconnected", (reason) => {
  console.log("[WhatsApp] Client disconnected:", reason);
  isClientReady = false;
  clientStatus = 'disconnected';
  currentQRCode = null;
  dashboardRoutes.setClientStatus(clientStatus);
  socketManager.emitConnectionStatus('disconnected', { reason });
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fungsi untuk generate voice note dari text
async function generateVoiceNote(text, filePath) {
  return new Promise((resolve, reject) => {
    const speech = new gtts(text, "id"); // "id" untuk bahasa Indonesia
    speech.save(filePath, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(filePath);
      }
    });
  });
}

// Fungsi untuk mengirim morning greeting
async function sendMorningGreeting(greetingType = "morning") {
  try {
    console.log(`[Morning Greeting] Memulai proses pengiriman ${greetingType}...`);
    
    // Cek apakah client sudah ready
    if (!isClientReady) {
      console.log("[Morning Greeting] Client belum ready, skip pengiriman.");
      return;
    }
    
    // Load data untuk language rotation
    const data = loadData();
    const languages = ['id', 'en', 'su', 'jv'];
    let selectedLang;
    
    if (LANGUAGE_MODE === 'random') {
      // Mode random: pilih bahasa acak
      selectedLang = languages[Math.floor(Math.random() * languages.length)];
      console.log(`[Morning Greeting] Mode: Random, Bahasa terpilih: ${selectedLang}`);
    } else {
      // Mode rotate: bergiliran berdasarkan languageIndex
      selectedLang = languages[data.languageIndex % languages.length];
      console.log(`[Morning Greeting] Mode: Rotate, Bahasa terpilih: ${selectedLang} (index: ${data.languageIndex})`);
      
      // Update index untuk hari berikutnya
      data.languageIndex = (data.languageIndex + 1) % languages.length;
      saveData(data);
    }
    
    // Get greeting text berdasarkan bahasa yang dipilih
    const greetingText = GREETINGS[greetingType][selectedLang];
    const voiceFilePath = path.join(__dirname, "morning_greeting.mp3");
    
    // Generate voice note
    await generateVoiceNote(greetingText, voiceFilePath);
    console.log(`[Morning Greeting] Voice note berhasil di-generate (${selectedLang}): "${greetingText}"`);
    
    // Kirim voice note ke semua grup yang terdaftar
    const media = MessageMedia.fromFilePath(voiceFilePath);
    
    for (const groupId of MORNING_GROUP_IDS) {
      try {
        // Validasi format group ID
        if (!groupId.endsWith('@g.us')) {
          console.error(`[Morning Greeting] ID grup tidak valid: ${groupId}`);
          continue;
        }
        
        console.log(`[Morning Greeting] Mencoba mengirim ke ${groupId}...`);
        
        // Langsung kirim tanpa cek chat dulu (lebih reliable)
        // whatsapp-web.js akan otomatis handle jika grup tidak ada
        await client.sendMessage(groupId, media, {
          sendAudioAsVoice: true
        });
        console.log(`[Morning Greeting] ✅ Voice note berhasil dikirim ke grup ${groupId} (${selectedLang})`);
        
        // Emit real-time update
        socketManager.emitMorningGreetingStatus({
          groupId,
          status: 'voice_sent',
          language: selectedLang,
          message: `Voice note (${selectedLang}) berhasil dikirim ke grup ${groupId}`
        });
        
        // Kirim pesan tambahan jika grup ini termasuk dalam daftar extra message
        if (MORNING_EXTRA_MESSAGE && MORNING_EXTRA_MESSAGE_GROUP_IDS.includes(groupId)) {
          await delay(2000); // Delay sebelum kirim pesan text
          await client.sendMessage(groupId, MORNING_EXTRA_MESSAGE);
          console.log(`[Morning Greeting] ✅ Pesan reminder berhasil dikirim ke grup ${groupId}`);
          
          // Emit real-time update
          socketManager.emitMorningGreetingStatus({
            groupId,
            status: 'reminder_sent',
            message: `Pesan reminder berhasil dikirim ke grup ${groupId}`
          });
        }
        
        // Delay antar grup untuk avoid spam detection
        await delay(2000);
      } catch (err) {
        console.error(`[Morning Greeting] ❌ Error mengirim ke ${groupId}:`, err.message || err);
        // Log detail error untuk debugging
        if (err.message.includes('chat not found') || err.message.includes('getChat')) {
          console.error(`[Morning Greeting] ⚠️ Pastikan bot sudah tergabung di grup ${groupId} dan restart bot setelah join grup baru`);
        }
      }
    }
    
    // Hapus file temporary setelah dikirim
    setTimeout(() => {
      if (fs.existsSync(voiceFilePath)) {
        fs.unlinkSync(voiceFilePath);
        console.log("[Morning Greeting] File temporary berhasil dihapus.");
      }
    }, 5000);
    
  } catch (error) {
    console.error("[Morning Greeting] Error:", error.message || error);
  }
}

// Fungsi untuk setup scheduler morning greeting
function setupMorningGreeting() {
  console.log(`[Morning Greeting] Scheduler diaktifkan dengan waktu: ${MORNING_TIME}`);
  console.log(`[Morning Greeting] Language Mode: ${LANGUAGE_MODE} (rotate = bergiliran, random = acak)`);
  console.log(`[Morning Greeting] Target grup (${MORNING_GROUP_IDS.length}):`);
  MORNING_GROUP_IDS.forEach((id, index) => {
    console.log(`  ${index + 1}. ${id}`);
  });
  
  // Schedule task untuk mengirim morning greeting
  cron.schedule(MORNING_TIME, () => {
    console.log("[Morning Greeting] Waktunya mengirim greeting pagi!");
    sendMorningGreeting("morning");
  }, {
    timezone: "Asia/Jakarta" // Sesuaikan dengan timezone Anda
  });

  // Schedule task untuk mengirim afternoon greeting
  const MORNING_TIME_AFTERNOON = process.env.MORNING_TIME_AFTERNOON || "0 17 * * *"; // Default: 17:00 setiap hari
  console.log(`[Morning Greeting] Scheduler afternoon diaktifkan dengan waktu: ${MORNING_TIME_AFTERNOON}`);
  cron.schedule(MORNING_TIME_AFTERNOON, () => {
    console.log("[Morning Greeting] Waktunya mengirim greeting sore!");
    sendMorningGreeting("afternoon");
  }, {
    timezone: "Asia/Jakarta" // Sesuaikan dengan timezone Anda
  });

  console.log("[Morning Greeting] Scheduler berhasil disetup!");
}

client.on("message", async (msg) => {
  let senderId;
  let myNumber = ["5544836391092@lid", "6287802337554@c.us", "14091921944658@lid", "6282315629089@c.us"];
    const data = loadData();
  if (msg.from.endsWith("@g.us")) {
    senderId = msg.author;
  } else {
    senderId = msg.from;
  }
  // Check if user is admin (original admin or added via allow him)
  const isAdmin = myNumber.includes(senderId) || (data.admins && data.admins.includes(senderId));
  // const phoneNumber = senderId.split("@")[0];
  // const user = await db("users").where({ phone: phoneNumber }).first();

  // const lastMsg = await db("last_messages").where("phone", phoneNumber).first();
  if (data.muted.includes(msg.author || msg.from)) {
    try {
      // hapus untuk semua orang
      await msg.delete(true);

      // simpan ke log
      data.log = data.log || [];
      data.log.push({
        id: msg.id._serialized,
        author,
        body: msg.body,
        group: msg.from,
        time: new Date().toISOString(),
      });

      // biar log nggak membengkak
      if (data.log.length > 200) data.log.shift();

      saveData(data);

      console.log(`Pesan dari ${author} dihapus (muted).`);
    } catch (err) {
      console.error("Gagal hapus pesan:", err.message || err);
    }
  } else if (msg.body === "!tagall") {
    await msg.reply("Ok sir");
    const chat = await msg.getChat();
    let text = "";
    let mentions = [];

    for (let participant of chat.participants) {
      mentions.push(`${participant.id.user}@c.us`);
      text += `@${participant.id.user} `;
    }

    await chat.sendMessage(text, { mentions });
  } else if (msg.body.toLowerCase() === "!groupid" || msg.body.toLowerCase() === "!idgrup") {
    const chat = await msg.getChat();
    
    if (chat.isGroup) {
      const groupName = chat.name;
      const groupId = chat.id._serialized;
      
      await msg.reply(
        `📋 *Informasi Grup*\n\n` +
        `Nama: *${groupName}*\n` +
        `ID: \`${groupId}\`\n\n` +
        `Copy ID di atas untuk digunakan di konfigurasi bot.`
      );
    } else {
      await msg.reply("⚠️ Command ini hanya bisa digunakan di grup.");
    }
//   } else if (msg.body.toLocaleLowerCase() === "hadir") {
//     const attendance = await db("attendance").where("user_id", user.id);

//     if (!user) {
//       return msg.reply("⚠️ Nomor kamu belum terdaftar.");
//     }

//     if(attendance) {
//       return msg.reply("Kamu sudah melakukan Absen Hari Ini")
//     }
//     const now = new Date();

//     // Simpan absen
//     await db("attendances").insert({
//       user_id: user.id,
//       checkin: now,
//     });

//     msg.reply("✅ Absen berhasil!");

//     // Kirim ke grup
//     const groupId = "120363402403833771@g.us"; // ganti dengan ID grup kamu
//     const userName = user.name || phoneNumber;
//     await delay(5000);
//     client.sendMessage(groupId, `*${userName}* berhasil melakukan absen`);
//   } else if (
//     (msg.body.toLowerCase() === "list absen" ||
//       msg.body.toLowerCase() === "daftar absen") &&
//     isAdmin
//   ) {
//     const results = await db("attendances")
//       .join("users", "attendances.user_id", "users.id")
//       .whereRaw("DATE(attendances.checkin) = CURRENT_DATE")
//       .select("users.name")
//       .orderBy("attendances.checkin", "asc");

//     if (results.length === 0) {
//       return msg.reply("📋 Belum ada yang absen hari ini.");
//     }

//     const listText = results
//       .map((row, i) => `${i + 1}. ${row.name}`)
//       .join("\n");

//     return msg.reply(`✅ *Daftar Absen Hari Ini:*\n\n${listText}`);
//   } else if (msg.body.toLowerCase() === "list peserta" && isAdmin) {
//     try {
//       const users = await db("users").select("name");

//       if (users.length === 0) {
//         return msg.reply("👥 Belum ada peserta yang terdaftar.");
//       }

//       const list = users
//         .map((user, index) => `${index + 1}. ${user.name}`)
//         .join("\n");
//       await msg.reply(`📋 *Daftar Peserta:*\n\n${list}`);
//     } catch (error) {
//       console.error("Gagal mengambil daftar peserta:", error);
//       await msg.reply("❌ Terjadi kesalahan saat mengambil data peserta.");
//     }
  } else if (msg.body.startsWith("ulang")) {
    // if (senderId !== myNumber) {
    //   await msg.reply("Only ridho can use this feature.");
    //   return;
    // }
    const args = msg.body.split(" ");
    const count = parseInt(args[1], 10);

    if (!isNaN(count) && count > 0) {
      const quotedMsg = await msg.getQuotedMessage();
      if (quotedMsg) {
        for (let i = 0; i < count; i++) {
          await msg.reply(quotedMsg.body);
        }
      } else {
        await msg.reply("Silakan reply sebuah pesan untuk mengulangnya.");
      }
    } else {
      await msg.reply(
        'Format salah. Gunakan "ulang [jumlah]" untuk mengulang pesan yang di-reply.'
      );
    }
  } else if (msg.hasMedia && msg.body.startsWith("do")) {
  // Hanya proses jika pengirim adalah Anda
  if (!isAdmin) {
    await msg.reply("Only admins can use this feature.");
    return;
  }

  const media = await msg.downloadMedia();

  // Pastikan media adalah gambar sebelum melanjutkan
  if (media && media.mimetype.startsWith("image/")) {
    console.log("Image received, processing with Gemini Vision...");
    const imageBase64 = media.data;
    const promptText = msg.body.trim() || "What is in this picture? Describe it.";

    try {
      const response = await axios.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        {
          contents: [{
            parts: [{
              text: promptText,
            }, {
              inline_data: {
                mime_type: media.mimetype,
                data: imageBase64,
              },
            }, ],
          }, ],
        }, {
          headers: {
            "x-goog-api-key": GEMINI_API_KEY,
            "Content-Type": "application/json",
          },
        }
      );

      // System instruction untuk model vision perlu diletakkan di dalam contents
      // Namun, untuk menjaga konsistensi, kita bisa memprosesnya di sini.
      // Untuk kesederhanaan, kita akan langsung kirim responsnya.
      const result = response.data.candidates[0].content.parts[0].text;
      const finalResponse = `Of course, Boss. Regarding the image you sent:\n\n${result}`;
      await msg.reply(finalResponse);
    } catch (error) {
      console.error(
        "Error calling Gemini Vision API:",
        error.response?.data || error.message
      );
      await msg.reply("Sorry Boss, I had trouble understanding that image.");
    }
  }
} else if (msg.body.startsWith("do")) {
    if (!myNumber.includes(senderId)) {
      await msg.reply("Only ridho can use this feature.");
      return;
    }
    let userCommand = msg.body.slice(2).trim();
    console.log(userCommand);
    let quotedText = "";

    if (msg.hasQuotedMsg) {
      const quoted = await msg.getQuotedMessage();
      quotedText = quoted.body.trim();
    }

    const prompt = quotedText ? `${userCommand}\n\n${quotedText}` : userCommand;
    console.log(prompt);
    try {
      const response = await axios.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
        {
          system_instruction: {
            parts: [
              {
                text: `You are a personal assistant named Do Assistant.
Always call him "Boss" with respect.
Be helpful, concise, and a little bit witty, but always loyal..`,
              },
            ],
          },
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
        },
        {
          headers: {
            "x-goog-api-key": GEMINI_API_KEY,
            "Content-Type": "application/json",
          },
        }
      );
      console.log(response.data);
      const result = response.data.candidates[0].content.parts[0].text;
      console.log(result);
      await msg.reply(result);
    } catch (error) {
      console.error(
        "Error calling Gemini API:",
        error.response?.data || error.message
      );
    }
  }  else if (msg.body === "silent him") {
  // cek kalau yang jalanin command adalah admin
  if (!isAdmin) {
    await msg.reply("Only admins can use this feature.");
    return;
  }

  const chat = await msg.getChat();
  if (!chat.isGroup) {
    return msg.reply("This command can only be used in groups.");
  }

  const quotedMsg = await msg.getQuotedMessage();
  if (!quotedMsg) {
    return msg.reply("Please reply to a message to silent the sender.");
  }

  const targetId = quotedMsg.author || quotedMsg.from;
  const contact = await client.getContactById(targetId);
  if (!contact) {
    return msg.reply("Failed to get contact information.");
  }

  // ==== bagian save ke JSON ====
  const fs = require("fs");
  const path = require("path");
  const DATA_FILE = path.join(__dirname, "muted.json");

  // load muted list
  let data = { muted: [] };
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }

  if (!data.muted.includes(targetId)) {
    data.muted.push(targetId);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    await msg.reply(`✅ ${contact.pushname || contact.number} is now muted.`);
  } else {
    await msg.reply(`⚠️ ${contact.pushname || contact.number} is already muted.`);
  }
} else if (msg.body === "unsilent him") {
  // cek kalau yang jalanin command adalah admin
  if (!isAdmin) {
    await msg.reply("Only admins can use this feature.");
    return;
  }
  const chat = await msg.getChat();
  if (!chat.isGroup) {
    return msg.reply("This command can only be used in groups.");
  }
  const quotedMsg = await msg.getQuotedMessage();
  if (!quotedMsg) {
    return msg.reply("Please reply to a message to unsilent the sender.");
  }
  const targetId = quotedMsg.author || quotedMsg.from;
  const contact = await client.getContactById(targetId);
  if (!contact) {
    return msg.reply("Failed to get contact information.");
  }
  // ==== bagian save ke JSON ====
  const fs = require("fs");
  const path = require("path");
  const DATA_FILE = path.join(__dirname, "muted.json");
  // load muted list
  let data = { muted: [] };
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
  if (data.muted.includes(targetId)) {
    data.muted = data.muted.filter((id) => id !== targetId);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    await msg.reply(`✅ ${contact.pushname || contact.number} is now unmuted.`);
  } else {
    await msg.reply(`⚠️ ${contact.pushname || contact.number} is not muted.`);
  }
} else if (msg.body === "kick him") {
  // cek kalau yang jalanin command adalah admin
  if (!isAdmin) {
    await msg.reply("Only admins can use this feature.");
    return;
  }
  const chat = await msg.getChat();
  if (!chat.isGroup) {
    return msg.reply("This command can only be used in groups.");
  }
  const quotedMsg = await msg.getQuotedMessage();
  if (!quotedMsg) {
    return msg.reply("Please reply to a message to kick the sender.");
  }
  const targetId = quotedMsg.author || quotedMsg.from;
  const contact = await client.getContactById(targetId);
  if (!contact) {
    return msg.reply("Failed to get contact information.");
  }
  try {
    await chat.removeParticipants([targetId]);
    await msg.reply(`✅ ${contact.pushname || contact.number} has been kicked.`);
  } catch (err) {
    console.error("Failed to kick member:", err);
    await msg.reply("❌ Failed to kick the member. Make sure I have admin rights.");
  }
} else if (msg.body === "allow him") {
  // Only main admin (Ridho) can grant admin access
  if (!myNumber.includes(senderId)) {
    await msg.reply("Only Ridho can use this feature.");
    return;
  }
  
  const chat = await msg.getChat();
  if (!chat.isGroup) {
    return msg.reply("This command can only be used in groups.");
  }
  
  const quotedMsg = await msg.getQuotedMessage();
  if (!quotedMsg) {
    return msg.reply("Please reply to a message to grant admin access to the sender.");
  }
  
  const targetId = quotedMsg.author || quotedMsg.from;
  const contact = await client.getContactById(targetId);
  if (!contact) {
    return msg.reply("Failed to get contact information.");
  }
  
  // Load current data
  const fs = require("fs");
  const path = require("path");
  const DATA_FILE = path.join(__dirname, "muted.json");
  
  let data = { muted: [], log: [], admins: [] };
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!data.admins) data.admins = [];
  }
  
  if (!data.admins.includes(targetId)) {
    data.admins.push(targetId);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    await msg.reply(`✅ ${contact.pushname || contact.number} has been granted admin access.`);
  } else {
    await msg.reply(`⚠️ ${contact.pushname || contact.number} already has admin access.`);
  }
} else if (msg.body === "revoke him") {
  // Only main admin (Ridho) can revoke admin access
  if (!myNumber.includes(senderId)) {
    await msg.reply("Only Ridho can use this feature.");
    return;
  }
  
  const chat = await msg.getChat();
  if (!chat.isGroup) {
    return msg.reply("This command can only be used in groups.");
  }
  
  const quotedMsg = await msg.getQuotedMessage();
  if (!quotedMsg) {
    return msg.reply("Please reply to a message to revoke admin access from the sender.");
  }
  
  const targetId = quotedMsg.author || quotedMsg.from;
  const contact = await client.getContactById(targetId);
  if (!contact) {
    return msg.reply("Failed to get contact information.");
  }
  
  // Load current data
  const fs = require("fs");
  const path = require("path");
  const DATA_FILE = path.join(__dirname, "muted.json");
  
  let data = { muted: [], log: [], admins: [] };
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!data.admins) data.admins = [];
  }
  
  if (data.admins.includes(targetId)) {
    data.admins = data.admins.filter((id) => id !== targetId);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    await msg.reply(`✅ Admin access revoked from ${contact.pushname || contact.number}.`);
  } else {
    await msg.reply(`⚠️ ${contact.pushname || contact.number} does not have admin access.`);
  }
} else if (msg.body === "list admins") {
  // Only main admin can see admin list
  if (!myNumber.includes(senderId)) {
    await msg.reply("Only Ridho can use this feature.");
    return;
  }
  
  const fs = require("fs");
  const path = require("path");
  const DATA_FILE = path.join(__dirname, "muted.json");
  
  let data = { muted: [], log: [], admins: [] };
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
  
  if (!data.admins || data.admins.length === 0) {
    return msg.reply("📋 No additional admins have been added.");
  }
  
  let adminList = "👥 *Admin List:*\n\n";
  for (let i = 0; i < data.admins.length; i++) {
    try {
      const contact = await client.getContactById(data.admins[i]);
      adminList += `${i + 1}. ${contact.pushname || contact.number}\n`;
    } catch (err) {
      adminList += `${i + 1}. ${data.admins[i]}\n`;
    }
  }
  
  await msg.reply(adminList);
} else if (msg.body === "!sticker") {
  // Support quoted message for sticker creation
    if(msg.hasMedia || msg.hasQuotedMsg) {
      let mediaMessage;
      if (msg.hasQuotedMsg) {
        const quotedMsg = await msg.getQuotedMessage();
        mediaMessage = quotedMsg;
      }
      else {
        mediaMessage = msg;
      }

      const media = await mediaMessage.downloadMedia();
      if (media) {
        const stickerMedia = new MessageMedia(media.mimetype, media.data, media.filename);
        await client.sendMessage(msg.from, stickerMedia, { sendMediaAsSticker: true });
      } else {
        await msg.reply("Failed to download media for sticker.");
      }
    } else {
      await msg.reply("Please send or reply to an image/video to create a sticker.");
    }
}


  // } else if (msg.body == "cek vote") {
//     const quotedMsg = await msg.getQuotedMessage();
//     if (quotedMsg.type === "poll_creation") {
//       const options = msg.body.slice(6).split("//");
//       const voteCount = {};
//       console.log(quotedMsg);
//       // for (const pollVote of quotedMsg.pollVotes) {
//       //   for (const selectedOption of pollVote.selectedOptions) {
//       //     if (!voteCount[selectedOption]) voteCount[selectedOption] = 0;
//       //     voteCount[selectedOption]++;
//       //   }
//       // }
//       // const voteCountStr = Object.entries(voteCount)
//       //   .map(([vote, number]) => `  -${vote}: ${number}`)
//       //   .join("\n");
//       //   console.log(voteCountStr)
//     }
//   } else if (msg.body.startsWith("do")) {
//     if (!myNumber.includes(senderId)) {
//       await msg.reply("Only ridho can use this feature.");
//       return;
//     }
//     let userCommand = msg.body.slice(2).trim();
//     console.log(userCommand);
//     let quotedText = "";

//     if (msg.hasQuotedMsg) {
//       const quoted = await msg.getQuotedMessage();
//       quotedText = quoted.body.trim();
//     }

//     const prompt = quotedText ? `${userCommand}\n\n${quotedText}` : userCommand;
//     console.log(prompt);
//     try {
//       const response = await axios.post(
//         "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
//         {
//           system_instruction: {
//             parts: [
//               {
//                 text: `You are a personal assistant named Do Assistant.
// Always call him "Boss" with respect.
// Be helpful, concise, and a little bit witty, but always loyal..`,
//               },
//             ],
//           },
//           contents: [
//             {
//               parts: [
//                 {
//                   text: prompt,
//                 },
//               ],
//             },
//           ],
//         },
//         {
//           headers: {
//             "x-goog-api-key": GEMINI_API_KEY,
//             "Content-Type": "application/json",
//           },
//         }
//       );
//       console.log(response.data);
//       const result = response.data.candidates[0].content.parts[0].text;
//       console.log(result);
//       await msg.reply(result);
//     } catch (error) {
//       console.error(
//         "Error calling Gemini API:",
//         error.response?.data || error.message
//       );
//     }
//   } else if (msg.body.startsWith("/addmenu") && isAdmin) {
//     const parts = msg.body.replace("/addmenu", "").trim().split(" - ");
//     if (parts.length !== 2)
//       return msg.reply("⚠️ Format salah. Contoh:\n/addmenu Ayam Bakar - 20000");

//     const [name, priceStr] = parts;
//     const price = parseInt(priceStr.replace(/\D/g, ""), 10);

//     if (!price) return msg.reply("⚠️ Harga tidak valid.");

//     const [insertedId] = await db("menus")
//       .insert({ name: name.trim(), price })
//       .returning("id");

//     return msg.reply(
//       `✅ Menu *${name.trim()}* (Rp${price.toLocaleString()}) berhasil ditambahkan dengan ID *${
//         insertedId.id
//       }*.`
//     );
//   } else if (msg.body === "/menu") {
//     const existing = await db("menu_choices").where("user_id", user.id).first();
//     if (existing) {
//       return msg.reply(
//         "✅ Kamu sudah memilih menu sebelumnya.\n\nJika ingin mengganti pilihan, silakan hubungi no berikut https://wa.me/6287802337554 terlebih dahulu."
//       );
//     }
//     const menus = await db("menus").select();
//     if (!menus.length) return msg.reply("📭 Belum ada menu.");

//     const list = menus
//       .map((m, i) => `${i + 1}. ${m.name} (Rp${m.price.toLocaleString()})`)
//       .join("\n");
//     await saveLastMessage(phoneNumber, "#WAITING_MENU");
//     const caption = `📋 *Daftar Menu:*\n\n${list}\n\nBalas dengan nomor atau nama menu.`;
//     await delay(2000);
//     try {
//       const media = MessageMedia.fromFilePath("./menu.jpeg");
//       await msg.reply(media, undefined, { caption });
//     } catch (err) {
//       console.error("❌ Gagal kirim gambar:", err);
//       await delay(2000);
//       await msg.reply(caption);
//     }
//   } else if (msg.body === "gathering") {
//     if (user) {
//       await delay(2000);

//       return msg.reply(
//         `Halo *${user.name}*, kamu sudah terdaftar. Ketik /menu untuk pilih makanan 🍽️`
//       );
//     } else {
//       await delay(2000);

//       await saveLastMessage(phoneNumber, "#REGIST");
//       return msg.reply(
//         "Silakan ketik nama lengkap kamu untuk registrasi mengikuti gathering."
//       );
//     }
//   } else if (lastMsg && lastMsg.messages == "#REGIST") {
//     const name = msg.body.replace(/\s+/g, " ").trim();
//     if (name.length < 3) {
//       return msg.reply(
//         "⚠️ Nama terlalu pendek, silakan ketik ulang nama lengkap kamu."
//       );
//     }

//     // Simpan user ke DB
//     await db("users").insert({
//       phone: phoneNumber,
//       name,
//     });

//     // Update status last message
//     await saveLastMessage(phoneNumber, "#REGISTERED");
//     await delay(2000);
//     return msg.reply(
//       `✅ Terima kasih *${name}*, kamu sudah terdaftar! Ketik /menu untuk pilih makanan.`
//     );
//   } else if (lastMsg && lastMsg.messages == "#WAITING_MENU") {
//     const existing = await db("menu_choices").where("user_id", user.id).first();
//     await delay(2000);
//     if (existing) {
//       const chosen = await db("menus").where("id", existing.menu_id).first();
//       return msg.reply(
//         `✅ Kamu sudah memilih: *${
//           chosen.name
//         }* (Rp${chosen.price.toLocaleString()})`
//       );
//     }

//     const menus = await db("menus").select();
//     let chosenMenu;

//     if (/^\d+$/.test(msg.body)) {
//       const index = parseInt(msg.body) - 1;
//       if (menus[index]) chosenMenu = menus[index];
//     } else {
//       chosenMenu = menus.find(
//         (m) => m.name.toLowerCase() === msg.body.toLowerCase()
//       );
//     }

//     if (chosenMenu) {
//       await db("menu_choices").insert({
//         user_id: user.id,
//         menu_id: chosenMenu.id,
//         status: "pending",
//       });
//       await saveLastMessage(phoneNumber, "#CHOOSEN_MENU");
//       const basePrice = chosenMenu.price;
//       const tax = basePrice * 0.1;
//       const soundFee = 10000;
//       const total = basePrice + tax + soundFee;

//       return msg.reply(
//         `✅ Terima kasih, kamu memilih: *${
//           chosenMenu.name
//         }* (Rp${basePrice.toLocaleString()})\n\n` +
//           `📊 *Rincian Biaya:*\n` +
//           `• Harga menu: Rp${basePrice.toLocaleString()}\n` +
//           `• Pajak 10%: Rp${tax.toLocaleString()}\n` +
//           `• Biaya sound system: Rp${soundFee.toLocaleString()}\n` +
//           `• *Total yang harus ditransfer: Rp${total.toLocaleString()}*\n\n` +
//           `💳 *Silakan transfer sejumlah Rp${total.toLocaleString()} ke rekening berikut:*\n` +
//           `Bank: *Seabank*\n` +
//           `No. Rekening: *901609178460*\n` +
//           `a.n. *Nazwa Nurul Ramadani*\n\n` +
//           `E-Wallet: *Dana*\n` +
//           `No Hp: *087847713098*\n` +
//           `a.n. *Shaumi Isna Humaira*\n\n` +
//           `📩 Setelah transfer, harap konfirmasi dan kirimkan bukti transfer ke panitia melalui WhatsApp:\n` +
//           `👉 https://wa.me/+6289676300479\n\n` +
//           `💡 *Catatan:* Jika kamu transfer ke DANA melalui bank (ATM, m-banking, dsb), mohon *lebihkan Rp500 atau Rp1.000* untuk menghindari potongan dari pihak dana.`
//       );
//     }

//     return msg.reply(
//       "⚠️ Pilihan tidak dikenali. Ketik /menu untuk lihat daftar."
//     );
//   } else if (msg.body === "data lengkap gathering" && isAdmin) {
//     const data = await db("menu_choices as mc")
//       .join("users as u", "u.id", "mc.user_id")
//       .join("menus as m", "m.id", "mc.menu_id")
//       .select("u.name", "u.phone", "m.name as menu", "m.price", "mc.status");

//     if (data.length === 0) {
//       return msg.reply("📭 Belum ada yang mendaftar atau memilih menu.");
//     }

//     let text = `📋 *Data Lengkap Gathering*\n\n`;

//     data.forEach((row, i) => {
//       const statusText = row.status === "paid" ? "✅ Lunas" : "⏳ Belum bayar";
//       const basePrice = row.price;
//       const tax = basePrice * 0.1;
//       const soundFee = 10000;
//       const total = basePrice + tax + soundFee;
//       text += `${i + 1}. *${row.name}*\n`;
//       text += `   📞 ${row.phone}\n`;
//       text += `   🍽️ Menu: ${row.menu}\n`;
//       text += `       - Harga: Rp${basePrice.toLocaleString()}\n`;
//       text += `       - PPN 10%: Rp${tax.toLocaleString()}\n`;
//       text += `       - Biaya sound: Rp${soundFee.toLocaleString()}\n`;
//       text += `       - Total: Rp${total.toLocaleString()}\n`;
//       text += `   💳 Status: ${statusText}\n\n`;
//     });

//     await msg.reply(text);
//   } else if (msg.body.startsWith("/success") && isAdmin) {
//     const parts = msg.body.trim().split(/\s+/); // split by any whitespace
//     if (parts.length < 2) {
//       return msg.reply(
//         "⚠️ Format salah. Gunakan: */success <nomor1> <nomor2> ...*"
//       );
//     }

//     const numbers = parts.slice(1).map((phone) => {
//       const digits = phone.replace(/\D/g, "");
//       return digits.startsWith("62") ? digits : "62" + digits.slice(1);
//     });

//     const results = [];

//     for (const phone of numbers) {
//       try {
//         const user = await db("users").where("phone", phone).first();

//         if (!user) {
//           results.push(`❌ *${phone}* tidak ditemukan.`);
//           continue;
//         }

//         const updated = await db("menu_choices")
//           .where("user_id", user.id)
//           .update({ status: "paid" });

//         if (updated > 0) {
//           results.push(`✅ *${phone}* -> status diperbarui ke *success*.`);
//         } else {
//           results.push(`⚠️ *${phone}* -> tidak ada data menu ditemukan.`);
//         }
//       } catch (err) {
//         console.error(`Gagal update untuk ${phone}:`, err);
//         results.push(`❌ *${phone}* -> terjadi kesalahan saat update.`);
//       }
//     }

//     return msg.reply(results.join("\n"));
//   }
});

client.on("message_revoke_everyone", async (after, before) => {
  // Pastikan before ada dan berasal dari grup
  if (before && before.from.endsWith("@g.us")) {
    const chatId = before.from; // ID grup
    const senderId = before.author || before.id.participant; // Pengirim pesan asli

    try {
      const chat = await before.getChat();
      
      // Try to get contact info, fallback to sender ID if failed
      let senderName = senderId.split('@')[0];
      try {
        const contact = await client.getContactById(senderId);
        senderName = contact.pushname || contact.number || senderName;
      } catch (err) {
        console.log('Could not get contact info for deleted message sender:', err.message);
      }

      const message = `*Deleted message*\n\n👤 *Sender:* ${senderName}\n📝 *Message:* ${before.body || '(Media/Sticker)'}`;
      const img = before.hasMedia ? await before.downloadMedia() : null;
      const sticker = MessageMedia.fromFilePath("./delete.png");
      await client.sendMessage(chatId, sticker, {sendMediaAsSticker: true});
      if (img) {
        const mediaMsg = new MessageMedia(img.mimetype, img.data, img.filename);
        await client.sendMessage(chatId, mediaMsg, { caption: message });
      } else {
      await client.sendMessage(chatId, message);
      }
      console.log(`[Deleted in group ${chat.name}] ${senderName}: ${before.body || '(Media)'}`);
    } catch (error) {
      console.error('Error handling deleted message:', error.message);
    }
  }
});

client.on("message_edit", async (message, newBody, prevBody) => {
  // Only track edits in groups
  if (message.from.endsWith("@g.us")) {
    const chatId = message.from;
    const senderId = message.author || message.from;

    try {
      const chat = await message.getChat();
      
      // Try to get contact info, fallback to sender ID if failed
      let senderName = senderId.split('@')[0];
      try {
        const contact = await client.getContactById(senderId);
        senderName = contact.pushname || contact.number || senderName;
      } catch (err) {
        console.log('Could not get contact info for edited message sender:', err.message);
      }

      const notificationMessage = `*Edited message*\n\n *Sender:* ${senderName}\n\n *Previous:* ${prevBody || '(empty)'}\n *New:* ${newBody || '(empty)'}`;

      await client.sendMessage(chatId, notificationMessage);
      console.log(`[Edited in group ${chat.name}] ${senderName}: "${prevBody}" → "${newBody}"`);
    } catch (error) {
      console.error('Error handling edited message:', error.message);
    }
  }
});

client.on("group_join", async (notification) => {
  try {
    const chat = await notification.getChat();
    const newMemberId = notification.recipientIds?.[0] || notification.author;

    if (!newMemberId) {
      console.log("Tidak bisa deteksi ID member baru.");
      return;
    }

    const isValid = newMemberId.endsWith("@c.us");
    const contact = await client.getContactById(newMemberId);
    const displayName = contact.pushname || contact.name || "anggota baru";

    if (chat.isGroup) {
      if (isValid) {
        const mentionTag = `@${contact.id.user}`;
        await chat.sendMessage(
          `Selamat datang ${mentionTag}! 🎉\nSilakan cek deskripsi grup ya.`,
          {
            mentions: [contact],
          }
        );
      } else {
        // Gak bisa tag, hanya pakai nama
        await chat.sendMessage(
          `Selamat datang ${displayName}! 🎉\nSilakan cek deskripsi grup ya.`
        );
      }
    }
  } catch (err) {
    console.error("Error welcoming new member:", err);
  }
});

client.on("group_leave", async (notification) => {
  try {
    const chat = await notification.getChat();
    const leftMemberId = notification.author;

    if (!leftMemberId) {
      console.log("Gagal mendeteksi member yang keluar.");
      return;
    }

    const isValid = leftMemberId.endsWith("@c.us");
    const contact = await client.getContactById(leftMemberId);
    const displayName =
      contact.pushname || contact.name || `@${leftMemberId.split("@")[0]}`;

    if (chat.isGroup) {
      if (isValid) {
        await chat.sendMessage(
          `👋 @${contact.id.user} telah meninggalkan grup.`,
          {
            mentions: [contact],
          }
        );
      } else {
        await chat.sendMessage(`👋 ${displayName} telah meninggalkan grup.`);
      }
    }
  } catch (err) {
    console.error("Error handling member leave:", err);
  }
});

client.on("vote_update", (vote) => {
  console.log("Masuk sini");
  /**
   * The {@link vote} that was affected:
   *
   * {
   *   voter: 'number@c.us',
   *   selectedOptions: [ { name: 'B', localId: 1 } ],
   *   interractedAtTs: 1698195555555,
   *   parentMessage: {
   *     ...,
   *     pollName: 'PollName',
   *     pollOptions: [
   *       { name: 'A', localId: 0 },
   *       { name: 'B', localId: 1 }
   *     ],
   *     allowMultipleAnswers: true,
   *     messageSecret: [
   *        1, 2, 3, 0, 0, 0, 0, 0,
   *        0, 0, 0, 0, 0, 0, 0, 0,
   *        0, 0, 0, 0, 0, 0, 0, 0,
   *        0, 0, 0, 0, 0, 0, 0, 0
   *     ]
   *   }
   * }
   */
  console.log(vote);
});

// client.on("poll_vote", async (pollVote) => {
//   const voterId = pollVote.voter; // ID user yang vote
//   const selectedOptions = pollVote.selectedOptions; // Index opsi yang dipilih

//   console.log(
//     `User ${voterId} voted for option(s): ${selectedOptions.join(", ")}`
//   );

//   const chat = await pollVote.getChat();
//   const contact = await pollVote.getContact();

//   console.log(`In chat: ${chat.name}`);
//   console.log(`Voter name: ${contact.pushname || contact.number}`);
// });

// QR Code endpoint - dipindahkan ke dashboard routes, tapi tetap keep ini untuk backward compatibility
app.get("/qrcode", async (req, res) => {
  let imageType = req.query.type;
  if (imageType === "image") {
    res.setHeader("Content-Type", "image/png");
  }
  let canvasSize = 650;
  const canvas = createCanvas(canvasSize, canvasSize);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvasSize, canvasSize);

  let barcodeOptions = {
    errorCorrectionLevel: "M",
    type: "image/jpeg",
    quality: 1,
    margin: 3,
    width: canvasSize,
    height: canvasSize,
  };

  try {
    let whatsappBarcode = await fsAwait.readFile("whatsapp.qr");
    QRCode.toCanvas(
      canvas,
      [{ data: whatsappBarcode.toString(), mode: "byte" }],
      barcodeOptions,
      (error) => {
        if (imageType === "image") {
          canvas.pngStream().pipe(res);
        }
      }
    );
  } catch (error) {
    let responseMessage = "";

    responseMessage = "ERROR UNKNOWN-3";
    if (imageType === "image") {
      canvas.pngStream().pipe(res);
    }
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('👤 Client connected:', socket.id);
  
  // Send current status on connection
  socket.emit('connection_status', { 
    status: clientStatus,
    ready: isClientReady
  });
  
  // Send current QR if available
  if (currentQRCode && clientStatus === 'qr') {
    socket.emit('qr_update', { qr: currentQRCode, status: 'qr' });
  }
  
  socket.on('disconnect', () => {
    console.log('👤 Client disconnected:', socket.id);
  });
  
  socket.on('request_status', () => {
    socket.emit('connection_status', { 
      status: clientStatus,
      ready: isClientReady,
      info: client.info || null
    });
  });
  
  socket.on('request_qr', () => {
    if (currentQRCode && clientStatus === 'qr') {
      socket.emit('qr_update', { qr: currentQRCode, status: 'qr' });
    }
  });
});

// Start server
server.listen(port, () => {
  console.log(`🌟 Server running on http://localhost:${port}`);
  console.log(`📱 Dashboard: http://localhost:${port}/dashboard`);
});

// Initialize WhatsApp client
client.initialize();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  
  if (client) {
    await client.destroy();
    console.log('✅ WhatsApp client destroyed');
  }
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('🔄 SIGTERM received, shutting down gracefully...');
  
  if (client) {
    await client.destroy();
  }
  
  server.close(() => {
    process.exit(0);
  });
});
