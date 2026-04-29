import express from "express";
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
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ------------------- 🤖 OPENAI SAFE -------------------
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ------------------- FILE PATHS -------------------

const dataDir = path.join(__dirname, "data");

// create data folder
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const dataFile = path.join(dataDir, "contactData.json");
const deletedFile = path.join(dataDir, "deletedData.json");
const paymentFile = path.join(dataDir, "paymentData.json");

// create json files
[dataFile, deletedFile, paymentFile].forEach((file) => {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "[]");
  }
});

// Helpers
const readJSON = (file) => JSON.parse(fs.readFileSync(file));
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// ------------------- 📧 MAIL SETUP -------------------
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
    if (!openai) {
      return res.json({ reply: "AI not configured ❌" });
    }

    const { message } = req.body;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a beauty parlour assistant. Give simple answers.",
        },
        { role: "user", content: message },
      ],
    });

    res.json({ reply: response.choices[0].message.content });

  } catch (err) {
    console.log("AI ERROR:", err.message);
    res.json({ reply: "AI error 😢" });
  }
});

app.post("/submit", async (req, res) => {
  try {
    console.log("🔥 Incoming Data:", req.body);

    const data = readJSON(dataFile);

    // ✅ STRONG SERVICE FIX (FINAL)
    const serviceValue =
      typeof req.body.event === "string" && req.body.event.trim() !== ""
        ? req.body.event.trim()
        : typeof req.body.service === "string" && req.body.service.trim() !== ""
        ? req.body.service.trim()
        : "Not Selected";

    console.log("✅ Final Service:", serviceValue);

    // ✅ CREATE ENTRY
    const newEntry = {
      name: req.body.name || "No Name",
      email: req.body.email || "No Email",
      phone: req.body.phone || "No Phone",
      event: serviceValue, // 🔥 முக்கிய fix
      date: req.body.date || "No Date",
      time: req.body.time || "No Time",
      message: req.body.message || "",
      place: req.body.place || "Salon Visit",
      price: 0,
      confirmed: false,
      submittedAt: new Date().toLocaleString(),
    };

    // ✅ SAVE DATA
    data.push(newEntry);
    writeJSON(dataFile, data);

    // ✅ SEND EMAIL (FINAL FIX)
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
          <p><b>Service:</b> ${serviceValue}</p>
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
    console.log("❌ Submit Error:", err.message);
    res.status(500).json({ message: "❌ Server Error" });
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

  if (!data[index]) return res.status(404).json({ message: "Invalid index" });

  data[index].confirmed = true;
  data[index].price = Number(req.body.price) || 0;

  writeJSON(dataFile, data);
  res.json({ message: "✅ Confirmed" });
});

// 🔥 👉 ADD EDIT API HERE 👇
app.post("/edit/:index",(req,res)=>{
  const i=parseInt(req.params.index);
  const data=readJSON(dataFile);

  if (!data[i]) return res.status(404).json({ message: "Invalid index" });

  data[i]={...data[i],...req.body};

  writeJSON(dataFile,data);
  res.json({msg:"updated"});
});

// ------------------- DELETE -------------------
app.delete("/delete/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const data = readJSON(dataFile);
  const deleted = readJSON(deletedFile);

  if (!data[index]) return res.status(404).json({ message: "Invalid index" });

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

  if (!deleted[index]) return res.status(404).json({ message: "Invalid index" });

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

  if (!deleted[index]) return res.status(404).json({ message: "Invalid index" });

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

  if (!data[index]) return res.status(404).json({ message: "Invalid index" });

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

// ------------------- 🧾 BILL -------------------
app.get("/bill/:index", (req, res) => {

  const index = parseInt(req.params.index);

  const data = readJSON(dataFile);

  if (!data[index]) {
    return res.send("Bill not found");
  }

  const booking = data[index];

  res.send(`
  <!DOCTYPE html>
  <html lang="en">

  <head>

    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>Aasha Beauty Bill</title>

    <link href="https://cdn.jsdelivr.net/npm/remixicon@4.1.0/fonts/remixicon.css" rel="stylesheet"/>

    <style>

      *{
        margin:0;
        padding:0;
        box-sizing:border-box;
        font-family:Arial,sans-serif;
      }

      body{
        background:#f4f4f4;
        padding:30px;
      }

      .bill-container{

        max-width:700px;
        margin:auto;

        background:white;

        border-radius:15px;

        overflow:hidden;

        box-shadow:0 5px 20px rgba(0,0,0,0.15);

      }

      /* TOP HEADER */
      .bill-header{

        background:#111;
        color:white;

        padding:30px;
        text-align:center;
      }

      .bill-header img{
        width:120px;
        margin-bottom:10px;
      }

      .bill-header h1{
        font-size:28px;
        margin-bottom:5px;
      }

      .bill-header p{
        color:#ddd;
      }

      /* BODY */
      .bill-body{
        padding:30px;
      }

      .row{

        display:flex;
        justify-content:space-between;

        padding:12px 0;

        border-bottom:1px solid #eee;
      }

      .label{
        font-weight:bold;
        color:#333;
      }

      .value{
        color:#555;
      }

      /* TOTAL */
      .total{

        margin-top:25px;

        background:#111;
        color:white;

        padding:20px;

        border-radius:10px;

        text-align:center;
      }

      .total h2{
        font-size:32px;
      }

      /* FOOTER */
      .footer{
        text-align:center;
        padding:20px;
        color:#777;
        font-size:14px;
      }

      /* BUTTONS */
      .actions{

        display:flex;
        gap:10px;

        margin-top:25px;
      }

      .btn{

        flex:1;

        padding:14px;

        border:none;

        border-radius:8px;

        cursor:pointer;

        font-size:16px;

        color:white;
      }

      .print-btn{
        background:#111;
      }

      .close-btn{
        background:#e63946;
      }

      .status{

        display:inline-block;

        padding:6px 12px;

        border-radius:20px;

        font-size:14px;

        font-weight:bold;
      }

      .confirmed{
        background:#d4edda;
        color:#155724;
      }

      .pending{
        background:#fff3cd;
        color:#856404;
      }

      @media(max-width:600px){

        .row{
          flex-direction:column;
          gap:5px;
        }

        .actions{
          flex-direction:column;
        }

      }

    </style>

  </head>

  <body>

    <div class="bill-container">

      <!-- HEADER -->
      <div class="bill-header">

        <img src="/assets/logo-1.png" alt="logo">

        <h1>Aasha Beauty Parlour</h1>

        <p>Men & Women Beauty Parlour</p>

      </div>

      <!-- BODY -->
      <div class="bill-body">

        <div class="row">
          <div class="label">Customer Name</div>
          <div class="value">${booking.name}</div>
        </div>

        <div class="row">
          <div class="label">Phone Number</div>
          <div class="value">${booking.phone}</div>
        </div>

        <div class="row">
          <div class="label">Email</div>
          <div class="value">${booking.email}</div>
        </div>

        <div class="row">
          <div class="label">Service</div>
          <div class="value">${booking.event}</div>
        </div>

        <div class="row">
          <div class="label">Appointment Date</div>
          <div class="value">${booking.date}</div>
        </div>

        <div class="row">
          <div class="label">Appointment Time</div>
          <div class="value">${booking.time}</div>
        </div>

        <div class="row">
          <div class="label">Place</div>
          <div class="value">${booking.place}</div>
        </div>

        <div class="row">
          <div class="label">Status</div>

          <div class="value">

            ${
              booking.confirmed
              ? `<span class="status confirmed">Confirmed</span>`
              : `<span class="status pending">Pending</span>`
            }

          </div>
        </div>

        <div class="total">

          <p>Total Amount</p>

          <h2>₹${booking.price || 0}</h2>

        </div>

        <!-- ACTIONS -->
        <div class="actions">

          <button
            class="btn print-btn"
            onclick="window.print()"
          >
            <i class="ri-printer-line"></i>
            Print Bill
          </button>

          <button
            class="btn close-btn"
            onclick="window.close()"
          >
            <i class="ri-close-line"></i>
            Close
          </button>

        </div>

      </div>

      <!-- FOOTER -->
      <div class="footer">

        Thank you for visiting Aasha Beauty Parlour 💖

      </div>

    </div>

  </body>
  </html>
  `);

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