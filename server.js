// server.js (REPLACE your existing file)
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

const dataFile = path.join(__dirname, "contactData.json");
const deletedFile = path.join(__dirname, "deletedData.json");
const paymentFile = path.join(__dirname, "paymentData.json");

// create files if not exist
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify([], null, 2));
if (!fs.existsSync(deletedFile)) fs.writeFileSync(deletedFile, JSON.stringify([], null, 2));
if (!fs.existsSync(paymentFile)) fs.writeFileSync(paymentFile, JSON.stringify([], null, 2));

let newMessageFlag = false;

// nodemailer transporter (requires .env GMAIL_USER, GMAIL_APP_PASS, ADMIN_EMAIL)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASS,
  },
});

// Helper read/write
const readJSON = (file) => JSON.parse(fs.readFileSync(file));
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// Submit contact form
app.post("/submit", async (req, res) => {
  const { name, email, phone, event, date, time, place, message, products } = req.body;
  const data = readJSON(dataFile);

  const newEntry = {
    name: name || "",
    email: email || "",
    phone: phone || "",
    event: event || "",
    date: date || "",
    time: time || "",
    place: place || "",
    message: message || "",
    products: products || { camera: 0, drone: 0, light: 0 },
    price: 0,
    confirmed: false,
    submittedAt: new Date().toLocaleString(),
  };

  data.push(newEntry);
  writeJSON(dataFile, data);
  newMessageFlag = true;

  // send admin notification (best-effort)
  if (process.env.ADMIN_EMAIL && process.env.GMAIL_USER && process.env.GMAIL_APP_PASS) {
    const mailOptions = {
      from: `"Black Feather Studio" <${process.env.GMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: "📩 New Event Enquiry Received!",
      html: `<h3>New booking request</h3><p><b>Name:</b> ${newEntry.name}</p><p><b>Event:</b> ${newEntry.event}</p>`,
    };
    transporter.sendMail(mailOptions).catch(err => console.error("Mail error:", err.message));
  }

  res.json({ message: "✅ Request submitted!" });
});

// Get all active bookings
app.get("/data", (req, res) => {
  res.json(readJSON(dataFile));
});

// Get deleted bookings (trash)
app.get("/deleted", (req, res) => {
  res.json(readJSON(deletedFile));
});

// Get all payments
app.get("/payments", (req, res) => {
  res.json(readJSON(paymentFile));
});

// Confirm a booking (set price) - expects { price }
app.post("/confirm/:index", async (req, res) => {
  const index = parseInt(req.params.index);
  const { price } = req.body || {};
  const data = readJSON(dataFile);

  if (index < 0 || index >= data.length) return res.status(404).json({ message: "Invalid index" });

  data[index].confirmed = true;
  if (price !== undefined) data[index].price = Number(price) || 0;
  writeJSON(dataFile, data);

  // send confirmation mail to customer
  const customer = data[index];
  if (customer.email && process.env.GMAIL_USER && process.env.GMAIL_APP_PASS) {
    const mailOptions = {
      from: `"Black Feather Studio" <${process.env.GMAIL_USER}>`,
      to: customer.email,
      subject: "✅ Booking Confirmed - Black Feather Studio",
      html: `
        <h3>Hi ${customer.name || "Customer"},</h3>
        <p>Your booking for <b>${customer.event}</b> is confirmed.</p>
        <p><b>Total:</b> ₹${customer.price || 0}</p>
        <p>We will reach out shortly with more details.</p>
      `,
    };
    transporter.sendMail(mailOptions).catch(err => console.error("Mail err:", err.message));
  }

  res.json({ message: "✅ Confirmed" });
});

// Edit booking (replace object)
app.post("/edit/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const data = readJSON(dataFile);

  if (index < 0 || index >= data.length) return res.status(404).json({ message: "Invalid index" });

  // Keep confirmed/payment fields if not provided
  const preserved = {
    confirmed: data[index].confirmed,
    price: data[index].price,
    submittedAt: data[index].submittedAt,
    products: data[index].products || { camera: 0, drone: 0, light: 0 }
  };

  const updated = { ...req.body, ...preserved };
  data[index] = updated;
  writeJSON(dataFile, data);
  res.json({ message: "✅ Updated" });
});

// Move to deleted (trash) instead of permanent delete
app.delete("/delete/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const data = readJSON(dataFile);
  const deleted = readJSON(deletedFile);

  if (index < 0 || index >= data.length) return res.status(404).json({ message: "Invalid index" });

  const [removed] = data.splice(index, 1);
  // add metadata to deleted record
  removed.deletedAt = new Date().toLocaleString();
  deleted.push(removed);

  writeJSON(dataFile, data);
  writeJSON(deletedFile, deleted);

  res.json({ message: "🗑️ Moved to Deleted (Trash)" });
});

// Restore from deleted back to active list (index = index in deleted file)
app.post("/restore/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const data = readJSON(dataFile);
  const deleted = readJSON(deletedFile);

  if (index < 0 || index >= deleted.length) return res.status(404).json({ message: "Invalid index" });

  const [restored] = deleted.splice(index, 1);
  // remove deletedAt
  delete restored.deletedAt;
  data.push(restored);

  writeJSON(dataFile, data);
  writeJSON(deletedFile, deleted);

  res.json({ message: "✅ Restored successfully" });
});

// Permanently delete from deleted file
app.delete("/delete-permanent/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const deleted = readJSON(deletedFile);

  if (index < 0 || index >= deleted.length) return res.status(404).json({ message: "Invalid index" });

  deleted.splice(index, 1);
  writeJSON(deletedFile, deleted);
  res.json({ message: "🗑️ Permanently deleted" });
});

// Record a payment against a booking (by active index)
app.post("/payment/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const { amount, method, txnId, note } = req.body || {};
  const data = readJSON(dataFile);
  const payments = readJSON(paymentFile);

  if (index < 0 || index >= data.length) return res.status(404).json({ message: "Invalid index" });

  const booking = data[index];
  const paidAmount = Number(amount) || 0;

  // create payment record
  const paymentRecord = {
    bookingIndex: index,
    bookingName: booking.name || "",
    bookingEmail: booking.email || "",
    event: booking.event || "",
    amount: paidAmount,
    method: method || "unknown",
    txnId: txnId || "",
    note: note || "",
    paidAt: new Date().toLocaleString(),
  };

  payments.push(paymentRecord);
  writeJSON(paymentFile, payments);

  res.json({ message: "✅ Payment recorded", payment: paymentRecord });
});

// Get bill (same as before) but now include payments summary for that booking
app.get("/bill/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const data = readJSON(dataFile);
  const payments = readJSON(paymentFile);
  if (index < 0 || index >= data.length) return res.send("Customer not found");

  const c = data[index];
  // sum payments for this booking (by matching bookingName+email+event is robust enough for small app)
  const relatedPayments = payments.filter(p => p.bookingIndex === index || (p.bookingEmail === c.email && p.bookingName === c.name && p.event === c.event));
  const paidTotal = relatedPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balance = (Number(c.price || 0) - paidTotal);

  const html = `
  <html>
  <head>
    <title>Invoice - Black Feather Studio</title>
    <style>
      body { font-family: 'Poppins', sans-serif; background: #f5f6fa; margin:0; padding:0; }
      .invoice-box { background: #fff; max-width: 820px; margin: 40px auto; padding: 36px 48px; border-radius: 12px; box-shadow: 0 0 20px rgba(0,0,0,0.08); }
      header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; }
      .logo { width: 150px; height: auto; display:block; margin: 12px auto; object-fit: contain; }
      .studio-name { font-size: 24px; font-weight: 700; margin: 4px 0; letter-spacing: 1px; }
      .studio-info { color:#333; font-size:14px; margin-top: 6px; line-height:1.4 }
      .details { display:flex; justify-content: space-between; margin-top: 22px; }
      .details div { width:48%; font-size:14px; }
      table { width:100%; border-collapse: collapse; margin-top:18px; font-size:14px; }
      th, td { padding: 10px; border-bottom: 1px solid #e6e6e6; text-align:left; }
      th { background:#111; color:#fff; text-transform: uppercase; font-size:13px; }
      .total { text-align:right; font-size:18px; font-weight:700; margin-top:14px; }
      .payments { margin-top:20px; }
      .payment-item { padding:8px 10px; border-radius:8px; background:#fbfbfb; margin-bottom:8px; border:1px solid #eee; }
      footer { text-align:center; border-top:1px solid #eee; padding-top:12px; color:#555; margin-top:20px; font-size:13px; }
      .print-btn { display:block; margin:20px auto 0; background:#000; color:#fff; padding:10px 18px; border:none; border-radius:8px; cursor:pointer; }
    </style>
  </head>
  <body>
    <div class="invoice-box">
      <header>
        <header>
  <img src="/assets/N__1_-removebg-preview.png" class="logo" alt="Black Feather Studio" />

  <div class="studio-name">BLACK FEATHER STUDIO</div>
  <div class="studio-info">
    123 Main Road, Mayiladuturai – 609001<br>
    📞 +91 98765 43210 | ✉️ blackfeatherstudio@gmail.com<br>
    GSTIN: 33ABCDE1234F1Z5
  </div>
</header>
      <div class="details">
        <div>
          <p><strong>Customer:</strong> ${c.name || ""}</p>
          <p><strong>Email:</strong> ${c.email || ""}</p>
          <p><strong>Phone:</strong> ${c.phone || ""}</p>
        </div>
        <div>
          <p><strong>Event:</strong> ${c.event || ""}</p>
          <p><strong>Date:</strong> ${c.date || ""}</p>
          <p><strong>Place:</strong> ${c.place || ""}</p>
        </div>
      </div>

      <table>
        <thead>
          <tr><th>Item</th><th>Details</th></tr>
        </thead>
        <tbody>
          <tr><td>Camera</td><td>${c.products?.camera || 0}</td></tr>
          <tr><td>Drone</td><td>${c.products?.drone || 0}</td></tr>
          <tr><td>Light Setup</td><td>${c.products?.light || 0}</td></tr>
        </tbody>
      </table>

      <div class="total">Total Amount: ₹${c.price || 0}</div>

      <div class="payments">
        <h4>Payments</h4>
        ${relatedPayments.length === 0 ? `<p>No payments recorded yet.</p>` : relatedPayments.map(p => `
          <div class="payment-item">
            <div><strong>Amount:</strong> ₹${p.amount}</div>
            <div><strong>Method:</strong> ${p.method}</div>
            <div><strong>Txn ID:</strong> ${p.txnId || "-"}</div>
            <div><strong>Date:</strong> ${p.paidAt}</div>
          </div>`).join("")}
        <p style="margin-top:8px;"><strong>Paid total:</strong> ₹${paidTotal}</p>
        <p><strong>Balance:</strong> ₹${balance < 0 ? 0 : balance}</p>
      </div>

      <footer>
        <p>Thank you for choosing Black Feather Studio 🖤</p>
        <p>blackfeatherstudio@gmail.com | +91 98765 43210</p>
        <p><small>GSTIN: 33ABCDE1234F1Z5 | Computer-generated invoice</small></p>
      </footer>

      <button class="print-btn" onclick="window.print()">🖨️ Print / Save PDF</button>
    </div>
  </body>
  </html>
  `;

  res.send(html);
});

// simple notif route
app.get("/notifications", (req, res) => {
  res.json({ newMessage: newMessageFlag });
  newMessageFlag = false;
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
