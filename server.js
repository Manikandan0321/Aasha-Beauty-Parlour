import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import OpenAI from "openai";

// Fix __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load ENV
dotenv.config({ path: path.join(__dirname, ".env") });

console.log("AI KEY:", process.env.OPENAI_API_KEY ? "Loaded ✅" : "Missing ❌");

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// OpenAI Setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// File paths
const dataFile = path.join(__dirname, "contactData.json");
const deletedFile = path.join(__dirname, "deletedData.json");
const paymentFile = path.join(__dirname, "paymentData.json");

// Create files if not exist
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify([], null, 2));
if (!fs.existsSync(deletedFile)) fs.writeFileSync(deletedFile, JSON.stringify([], null, 2));
if (!fs.existsSync(paymentFile)) fs.writeFileSync(paymentFile, JSON.stringify([], null, 2));

// Helpers
const readJSON = (file) => JSON.parse(fs.readFileSync(file));
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// Mail setup
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASS,
  },
});

// ------------------- 🤖 AI CHAT -------------------
app.post("/ask-ai", async (req, res) => {
  try {
    const { message } = req.body;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a beauty parlour assistant. Answer about services, pricing, skincare and booking simply.",
        },
        { role: "user", content: message },
      ],
    });

    res.json({ reply: response.choices[0].message.content });

  } catch (error) {
    console.error("AI ERROR:", error.message);
    res.json({ reply: "AI busy 😢 try later" });
  }
});

// ------------------- 📩 SUBMIT (MAIN UPDATE) -------------------
app.post("/submit", async (req, res) => {
  try {
    const data = readJSON(dataFile);

    const newEntry = {
      ...req.body,
      price: 0,
      confirmed: false,
      submittedAt: new Date().toLocaleString(),
    };

    data.push(newEntry);
    writeJSON(dataFile, data);

    // 📧 SEND EMAIL (FULL DETAILS)
    if (process.env.ADMIN_EMAIL) {
      await transporter.sendMail({
        from: `"Aasha Beauty Parlour" <${process.env.GMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: "💄 New Appointment Booking",
        html: `
          <h2>New Booking Received</h2>
          <p><b>Name:</b> ${newEntry.name}</p>
          <p><b>Email:</b> ${newEntry.email}</p>
          <p><b>Phone:</b> ${newEntry.phone}</p>
          <p><b>Service:</b> ${newEntry.service}</p>
          <p><b>Date:</b> ${newEntry.date}</p>
          <p><b>Time:</b> ${newEntry.time}</p>
          <p><b>Message:</b> ${newEntry.message || "-"}</p>
          <hr/>
          <p><i>Submitted at: ${newEntry.submittedAt}</i></p>
        `,
      });

      console.log("📧 Email sent successfully");
    }

    res.json({ message: "✅ Booking Saved & Email Sent!" });

  } catch (err) {
    console.log("Submit Error:", err.message);
    res.json({ message: "Saved but email failed ❌" });
  }
});

// ------------------- 📊 DATA -------------------
app.get("/data", (req, res) => res.json(readJSON(dataFile)));
app.get("/deleted", (req, res) => res.json(readJSON(deletedFile)));
app.get("/payments", (req, res) => res.json(readJSON(paymentFile)));

// ------------------- CONFIRM -------------------
app.post("/confirm/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const data = readJSON(dataFile);

  if (index < 0 || index >= data.length)
    return res.status(404).json({ message: "Invalid index" });

  data[index].confirmed = true;
  data[index].price = Number(req.body.price) || 0;

  writeJSON(dataFile, data);
  res.json({ message: "✅ Confirmed" });
});

// ------------------- DELETE -------------------
app.delete("/delete/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const data = readJSON(dataFile);
  const deleted = readJSON(deletedFile);

  if (index < 0 || index >= data.length)
    return res.status(404).json({ message: "Invalid index" });

  const [removed] = data.splice(index, 1);
  removed.deletedAt = new Date().toLocaleString();

  deleted.push(removed);

  writeJSON(dataFile, data);
  writeJSON(deletedFile, deleted);

  res.json({ message: "🗑️ Moved to Trash" });
});

// ------------------- RESTORE -------------------
app.post("/restore/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const data = readJSON(dataFile);
  const deleted = readJSON(deletedFile);

  if (index < 0 || index >= deleted.length)
    return res.status(404).json({ message: "Invalid index" });

  const [restored] = deleted.splice(index, 1);
  delete restored.deletedAt;

  data.push(restored);

  writeJSON(dataFile, data);
  writeJSON(deletedFile, deleted);

  res.json({ message: "✅ Restored" });
});

// ------------------- PERMANENT DELETE -------------------
app.delete("/delete-permanent/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const deleted = readJSON(deletedFile);

  if (index < 0 || index >= deleted.length)
    return res.status(404).json({ message: "Invalid index" });

  deleted.splice(index, 1);
  writeJSON(deletedFile, deleted);

  res.json({ message: "🗑️ Permanently deleted" });
});

// ------------------- PAYMENT -------------------
app.post("/payment/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const { amount, method } = req.body;

  const data = readJSON(dataFile);
  const payments = readJSON(paymentFile);

  if (index < 0 || index >= data.length)
    return res.status(404).json({ message: "Invalid index" });

  const booking = data[index];

  const paymentRecord = {
    bookingIndex: index,
    bookingName: booking.name,
    event: booking.event,
    amount: Number(amount),
    method,
    paidAt: new Date().toLocaleString(),
  };

  payments.push(paymentRecord);
  writeJSON(paymentFile, payments);

  res.json({ message: "✅ Payment Saved" });
});

// ------------------- ROOT -------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ------------------- SERVER -------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);