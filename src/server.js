import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import fs from "fs";
import { Budget, Expense, Recurring, User } from "./models.js";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
fs.mkdirSync("uploads", { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: "uploads",
    filename: (_, f, cb) => cb(null, Date.now() + "-" + f.originalname.replace(/[^\w.-]/g, "_")),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, f, cb) => cb(null, /^(image\/|application\/pdf)/.test(f.mimetype)),
});

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json());
app.use("/uploads", express.static("uploads"));

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const monthOf = (req) => (/^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7));
const range = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return { $gte: new Date(Date.UTC(y, mo - 1, 1)), $lt: new Date(Date.UTC(y, mo, 1)) };
};
const notFound = (res, what) => res.status(404).json({ error: `${what} not found` });

// ---- Auth ----
const sign = (u) => jwt.sign({ id: u._id }, SECRET, { expiresIn: "7d" });
const pub = (u) => ({ name: u.name, email: u.email });
app.post("/api/auth/register", wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password || password.length < 6) return res.status(400).json({ error: "Enter an email and a password of at least 6 characters" });
  const u = await User.create({ name, email, password: await bcrypt.hash(password, 10) });
  res.status(201).json({ token: sign(u), user: pub(u) });
}));
app.post("/api/auth/login", wrap(async (req, res) => {
  const u = await User.findOne({ email: String(req.body.email || "").toLowerCase() });
  if (!u || !(await bcrypt.compare(req.body.password || "", u.password))) return res.status(401).json({ error: "Wrong email or password" });
  res.json({ token: sign(u), user: pub(u) });
}));
app.use("/api", (req, res, next) => {
  try { req.uid = jwt.verify((req.headers.authorization || "").slice(7), SECRET).id; next(); }
  catch { res.status(401).json({ error: "Please log in" }); }
});

// ---- Budgets ----
app.get("/api/budgets", wrap(async (req, res) => res.json(await Budget.find({ user: req.uid, month: monthOf(req) }).sort("category"))));
app.post("/api/budgets", wrap(async (req, res) => res.status(201).json(await Budget.create({ ...req.body, user: req.uid }))));
app.put("/api/budgets/:id", wrap(async (req, res) => {
  const { category, limit } = req.body;
  const b = await Budget.findOneAndUpdate({ _id: req.params.id, user: req.uid }, { category, limit }, { new: true, runValidators: true });
  b ? res.json(b) : notFound(res, "Budget");
}));
app.delete("/api/budgets/:id", wrap(async (req, res) => {
  await Budget.deleteOne({ _id: req.params.id, user: req.uid });
  res.status(204).end();
}));

// ---- Expenses (with optional receipt upload) ----
app.get("/api/expenses", wrap(async (req, res) => res.json(await Expense.find({ user: req.uid, date: range(monthOf(req)) }).sort("-date"))));
app.get("/api/expenses/export", wrap(async (req, res) => {
  const rows = await Expense.find({ user: req.uid, date: range(monthOf(req)) }).sort("date").lean();
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = ["Date,Title,Category,Amount,Note", ...rows.map((r) => [r.date.toISOString().slice(0, 10), r.title, r.category, r.amount, r.note].map(q).join(","))].join("\n");
  res.type("text/csv").attachment(`expenses-${monthOf(req)}.csv`).send(csv);
}));
app.post("/api/expenses", upload.single("receipt"), wrap(async (req, res) => {
  const { title, amount, category, date, note } = req.body;
  res.status(201).json(await Expense.create({ title, amount, category, date, note, user: req.uid, receipt: req.file?.filename || "" }));
}));
app.put("/api/expenses/:id", upload.single("receipt"), wrap(async (req, res) => {
  const { title, amount, category, date, note } = req.body;
  const d = { title, amount, category, date, note };
  if (req.file) d.receipt = req.file.filename;
  const e = await Expense.findOneAndUpdate({ _id: req.params.id, user: req.uid }, d, { new: true, runValidators: true });
  e ? res.json(e) : notFound(res, "Expense");
}));
app.delete("/api/expenses/:id", wrap(async (req, res) => {
  const e = await Expense.findOneAndDelete({ _id: req.params.id, user: req.uid });
  if (e?.receipt) fs.unlink(`uploads/${e.receipt}`, () => {});
  res.status(204).end();
}));

// ---- Recurring expenses (added once per month, on the 1st-28th day you pick) ----
app.get("/api/recurring", wrap(async (req, res) => res.json(await Recurring.find({ user: req.uid }).sort("title"))));
app.post("/api/recurring", wrap(async (req, res) => res.status(201).json(await Recurring.create({ ...req.body, user: req.uid, lastApplied: "" }))));
app.delete("/api/recurring/:id", wrap(async (req, res) => {
  await Recurring.deleteOne({ _id: req.params.id, user: req.uid });
  res.status(204).end();
}));
app.post("/api/recurring/apply", wrap(async (req, res) => {
  const now = new Date().toISOString().slice(0, 7);
  const [y, m] = now.split("-").map(Number);
  const due = await Recurring.find({ user: req.uid, lastApplied: { $ne: now } });
  for (const r of due) {
    await Expense.create({ user: r.user, title: r.title, amount: r.amount, category: r.category, note: "Recurring", recurringId: r._id, date: new Date(Date.UTC(y, m - 1, r.dayOfMonth)) });
    r.lastApplied = now;
    await r.save();
  }
  res.json({ added: due.length });
}));

// ---- Summary ----
app.get("/api/summary", wrap(async (req, res) => {
  const month = monthOf(req);
  const match = { user: new mongoose.Types.ObjectId(req.uid), date: range(month) };
  const [budgets, spentByCat, daily] = await Promise.all([
    Budget.find({ user: req.uid, month }).lean(),
    Expense.aggregate([{ $match: match }, { $group: { _id: "$category", spent: { $sum: "$amount" } } }]),
    Expense.aggregate([{ $match: match }, { $group: { _id: { $dayOfMonth: "$date" }, total: { $sum: "$amount" } } }, { $sort: { _id: 1 } }]),
  ]);
  const spentMap = Object.fromEntries(spentByCat.map((s) => [s._id, s.spent]));
  const names = new Set([...budgets.map((b) => b.category), ...Object.keys(spentMap)]);
  const categories = [...names].sort().map((category) => {
    const limit = budgets.find((b) => b.category === category)?.limit ?? 0;
    const spent = spentMap[category] ?? 0;
    return { category, limit, spent, remaining: limit - spent, percent: limit ? Math.round((spent / limit) * 100) : null };
  });
  const totalBudget = categories.reduce((s, c) => s + c.limit, 0);
  const totalSpent = categories.reduce((s, c) => s + c.spent, 0);
  res.json({ month, totalBudget, totalSpent, remaining: totalBudget - totalSpent, categories, daily: daily.map((d) => ({ day: d._id, total: d.total })) });
}));

app.use((err, _req, res, _next) => {
  if (err.code === 11000) return res.status(409).json({ error: err.keyPattern?.email ? "That email is already registered" : "A budget for this category and month already exists" });
  if (err.name === "ValidationError" || err.name === "CastError") return res.status(400).json({ error: err.message });
  if (err.name === "MulterError") return res.status(400).json({ error: "Receipt must be an image or PDF under 5 MB" });
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

const port = process.env.PORT || 5000;
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/budget_manager")
  .then(async () => {
    await Budget.syncIndexes(); // replaces the old category+month index with user+category+month
    app.listen(port, () => console.log(`API running on http://localhost:${port}`));
  })
  .catch((e) => { console.error("MongoDB connection failed:", e.message); process.exit(1); });