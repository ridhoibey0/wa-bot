require("dotenv").config();
const express = require("express");
const { Client, LocalAuth, Poll, MessageMedia } = require("whatsapp-web.js");
const fs = require("fs");
const fsAwait = fs.promises;
const { createCanvas } = require("canvas");
const QRCode = require("qrcode");
const axios = require("axios");
const db = require("./db");
const qrcode = require("qrcode-terminal");

const app = express();
const port = 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--unhandled-rejections=strict",
      "--disable-extensions",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process", // <- this one doesn't works in Windows
      "--disable-gpu",
    ],
    // session: sessionConfig
  },
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

client.on("ready", () => {
  console.log("Client is ready!");
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

client.on("message", async (msg) => {
  let senderId;
  let myNumber = ["5544836391092@lid", "6287802337554@c.us"];
  if (msg.from.endsWith("@g.us")) {
    senderId = msg.author;
  } else {
    senderId = msg.from;
  }
  console.log(senderId.split("@")[0]);
  console.log(msg.from)
  const isAdmin = myNumber.includes(senderId);
  const phoneNumber = senderId.split("@")[0];
  const user = await db("users").where({ phone: phoneNumber }).first();

  const lastMsg = await db("last_messages").where("phone", phoneNumber).first();

  if (msg.body === "!tagall") {
    await msg.reply("Ok sir");
    const chat = await msg.getChat();
    let text = "";
    let mentions = [];

    for (let participant of chat.participants) {
      mentions.push(`${participant.id.user}@c.us`);
      text += `@${participant.id.user} `;
    }

    await chat.sendMessage(text, { mentions });
  } else if (msg.body === "absen") {
    if (!user) {
      return msg.reply("⚠️ Nomor kamu belum terdaftar.");
    }
    const now = new Date();

    // Simpan absen
    await db("attendances").insert({
      user_id: user.id,
      checkin: now,
    });

    msg.reply("✅ Absen berhasil!");

    // Kirim ke grup
    const groupId = "120363402403833771@g.us"; // ganti dengan ID grup kamu
    const userName = user.name || phoneNumber;

    client.sendMessage(
      groupId,
      `📋 ${userName} telah melakukan absen pada ${now.toLocaleString("id-ID")}`
    );
  } else if (msg.body.startsWith("ulang")) {
    if (senderId !== myNumber) {
      await msg.reply("Only ridho can use this feature.");
      return;
    }
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
  } else if (msg.body == "cek vote") {
    const quotedMsg = await msg.getQuotedMessage();
    if (quotedMsg.type === "poll_creation") {
      const options = msg.body.slice(6).split("//");
      const voteCount = {};
      console.log(quotedMsg);
      // for (const pollVote of quotedMsg.pollVotes) {
      //   for (const selectedOption of pollVote.selectedOptions) {
      //     if (!voteCount[selectedOption]) voteCount[selectedOption] = 0;
      //     voteCount[selectedOption]++;
      //   }
      // }
      // const voteCountStr = Object.entries(voteCount)
      //   .map(([vote, number]) => `  -${vote}: ${number}`)
      //   .join("\n");
      //   console.log(voteCountStr)
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
  } else if (msg.body.startsWith("/addmenu") && isAdmin) {
    const parts = msg.body.replace("/addmenu", "").trim().split(" - ");
    if (parts.length !== 2)
      return msg.reply("⚠️ Format salah. Contoh:\n/addmenu Ayam Bakar - 20000");

    const [name, priceStr] = parts;
    const price = parseInt(priceStr.replace(/\D/g, ""), 10);

    if (!price) return msg.reply("⚠️ Harga tidak valid.");

    const [insertedId] = await db("menus")
      .insert({ name: name.trim(), price })
      .returning("id");

    return msg.reply(
      `✅ Menu *${name.trim()}* (Rp${price.toLocaleString()}) berhasil ditambahkan dengan ID *${
        insertedId.id
      }*.`
    );
  } else if (msg.body === "/menu") {
    const existing = await db("menu_choices").where("user_id", user.id).first();
    if (existing) {
      return msg.reply(
        "✅ Kamu sudah memilih menu sebelumnya.\n\nJika ingin mengganti pilihan, silakan hubungi no berikut https://wa.me/6287802337554 terlebih dahulu."
      );
    }
    const menus = await db("menus").select();
    if (!menus.length) return msg.reply("📭 Belum ada menu.");

    const list = menus
      .map((m, i) => `${i + 1}. ${m.name} (Rp${m.price.toLocaleString()})`)
      .join("\n");
    await saveLastMessage(phoneNumber, "#WAITING_MENU");
    const caption = `📋 *Daftar Menu:*\n\n${list}\n\nBalas dengan nomor atau nama menu.`;
    await delay(2000);
    try {
      const media = MessageMedia.fromFilePath("./menu.jpeg");
      await msg.reply(media, undefined, { caption });
    } catch (err) {
      console.error("❌ Gagal kirim gambar:", err);
      await delay(2000);
      await msg.reply(caption);
    }
  } else if (msg.body === "gathering") {
    if (user) {
      await delay(2000);

      return msg.reply(
        `Halo *${user.name}*, kamu sudah terdaftar. Ketik /menu untuk pilih makanan 🍽️`
      );
    } else {
      await delay(2000);

      await saveLastMessage(phoneNumber, "#REGIST");
      return msg.reply(
        "Silakan ketik nama lengkap kamu untuk registrasi mengikuti gathering."
      );
    }
  } else if (lastMsg && lastMsg.messages == "#REGIST") {
    const name = msg.body.replace(/\s+/g, " ").trim();
    if (name.length < 3) {
      return msg.reply(
        "⚠️ Nama terlalu pendek, silakan ketik ulang nama lengkap kamu."
      );
    }

    // Simpan user ke DB
    await db("users").insert({
      phone: phoneNumber,
      name,
    });

    // Update status last message
    await saveLastMessage(phoneNumber, "#REGISTERED");
    await delay(2000);
    return msg.reply(
      `✅ Terima kasih *${name}*, kamu sudah terdaftar! Ketik /menu untuk pilih makanan.`
    );
  } else if (lastMsg && lastMsg.messages == "#WAITING_MENU") {
    const existing = await db("menu_choices").where("user_id", user.id).first();
    await delay(2000);
    if (existing) {
      const chosen = await db("menus").where("id", existing.menu_id).first();
      return msg.reply(
        `✅ Kamu sudah memilih: *${
          chosen.name
        }* (Rp${chosen.price.toLocaleString()})`
      );
    }

    const menus = await db("menus").select();
    let chosenMenu;

    if (/^\d+$/.test(msg.body)) {
      const index = parseInt(msg.body) - 1;
      if (menus[index]) chosenMenu = menus[index];
    } else {
      chosenMenu = menus.find(
        (m) => m.name.toLowerCase() === msg.body.toLowerCase()
      );
    }

    if (chosenMenu) {
      await db("menu_choices").insert({
        user_id: user.id,
        menu_id: chosenMenu.id,
        status: "pending",
      });
      await saveLastMessage(phoneNumber, "#CHOOSEN_MENU");
      const basePrice = chosenMenu.price;
      const tax = basePrice * 0.1;
      const soundFee = 10000;
      const total = basePrice + tax + soundFee;

      return msg.reply(
        `✅ Terima kasih, kamu memilih: *${
          chosenMenu.name
        }* (Rp${basePrice.toLocaleString()})\n\n` +
          `📊 *Rincian Biaya:*\n` +
          `• Harga menu: Rp${basePrice.toLocaleString()}\n` +
          `• Pajak 10%: Rp${tax.toLocaleString()}\n` +
          `• Biaya sound system: Rp${soundFee.toLocaleString()}\n` +
          `• *Total yang harus ditransfer: Rp${total.toLocaleString()}*\n\n` +
          `💳 *Silakan transfer sejumlah Rp${total.toLocaleString()} ke rekening berikut:*\n` +
          `Bank: *Seabank*\n` +
          `No. Rekening: *901609178460*\n` +
          `a.n. *Nazwa Nurul Ramadani*\n\n` +
          `E-Wallet: *Dana*\n` +
          `No Hp: *087847713098*\n` +
          `a.n. *Shaumi Isna Humaira*\n\n` +
          `📩 Setelah transfer, harap konfirmasi dan kirimkan bukti transfer ke panitia melalui WhatsApp:\n` +
          `👉 https://wa.me/+6289676300479\n\n` +
          `💡 *Catatan:* Jika kamu transfer ke DANA melalui bank (ATM, m-banking, dsb), mohon *lebihkan Rp500 atau Rp1.000* untuk menghindari potongan dari pihak dana.`
      );
    }

    return msg.reply(
      "⚠️ Pilihan tidak dikenali. Ketik /menu untuk lihat daftar."
    );
  } else if (msg.body === "data lengkap gathering" && isAdmin) {
    const data = await db("menu_choices as mc")
      .join("users as u", "u.id", "mc.user_id")
      .join("menus as m", "m.id", "mc.menu_id")
      .select("u.name", "u.phone", "m.name as menu", "m.price", "mc.status");

    if (data.length === 0) {
      return msg.reply("📭 Belum ada yang mendaftar atau memilih menu.");
    }

    let text = `📋 *Data Lengkap Gathering*\n\n`;

    data.forEach((row, i) => {
      const statusText = row.status === "paid" ? "✅ Lunas" : "⏳ Belum bayar";
      const basePrice = row.price;
      const tax = basePrice * 0.1;
      const soundFee = 10000;
      const total = basePrice + tax + soundFee;
      text += `${i + 1}. *${row.name}*\n`;
      text += `   📞 ${row.phone}\n`;
      text += `   🍽️ Menu: ${row.menu}\n`;
      text += `       - Harga: Rp${basePrice.toLocaleString()}\n`;
      text += `       - PPN 10%: Rp${tax.toLocaleString()}\n`;
      text += `       - Biaya sound: Rp${soundFee.toLocaleString()}\n`;
      text += `       - Total: Rp${total.toLocaleString()}\n`;
      text += `   💳 Status: ${statusText}\n\n`;
    });

    await msg.reply(text);
  } else if (msg.body.startsWith("/success") && isAdmin) {
    const parts = msg.body.trim().split(/\s+/); // split by any whitespace
    if (parts.length < 2) {
      return msg.reply(
        "⚠️ Format salah. Gunakan: */success <nomor1> <nomor2> ...*"
      );
    }

    const numbers = parts.slice(1).map((phone) => {
      const digits = phone.replace(/\D/g, "");
      return digits.startsWith("62") ? digits : "62" + digits.slice(1);
    });

    const results = [];

    for (const phone of numbers) {
      try {
        const user = await db("users").where("phone", phone).first();

        if (!user) {
          results.push(`❌ *${phone}* tidak ditemukan.`);
          continue;
        }

        const updated = await db("menu_choices")
          .where("user_id", user.id)
          .update({ status: "paid" });

        if (updated > 0) {
          results.push(`✅ *${phone}* -> status diperbarui ke *success*.`);
        } else {
          results.push(`⚠️ *${phone}* -> tidak ada data menu ditemukan.`);
        }
      } catch (err) {
        console.error(`Gagal update untuk ${phone}:`, err);
        results.push(`❌ *${phone}* -> terjadi kesalahan saat update.`);
      }
    }

    return msg.reply(results.join("\n"));
  }
});

client.on("message_revoke_everyone", async (after, before) => {
  // Pastikan before ada dan berasal dari grup
  if (before && before.from.endsWith("@g.us")) {
    const chatId = before.from; // ID grup
    const senderId = before.author || before.id.participant; // Pengirim pesan asli

    const chat = await before.getChat();
    const contact = await client.getContactById(senderId);

    const message = `*Deleted message*\n\n👤 *Sender:* ${
      contact.pushname || senderId
    }\n *Message:* ${before.body}`;

    await client.sendMessage(chatId, message);
    console.log(
      `[Deleted in group ${chat.name}] ${contact.pushname || senderId}: ${
        before.body
      }`
    );
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

app.get("/", async (req, res) => {
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

app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});

client.initialize();
