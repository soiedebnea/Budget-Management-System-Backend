import mongoose from "mongoose";
const { Schema, model } = mongoose;
const owner = { type: Schema.Types.ObjectId, ref: "User", required: true, index: true };

const User = model("User", new Schema({
  name: { type: String, trim: true, default: "" },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
}, { timestamps: true }));

const budgetSchema = new Schema({
  user: owner,
  category: { type: String, required: true, trim: true },
  limit: { type: Number, required: true, min: 0 },
  month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
}, { timestamps: true });
budgetSchema.index({ user: 1, category: 1, month: 1 }, { unique: true });

const expenseSchema = new Schema({
  user: owner,
  title: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0.01 },
  category: { type: String, required: true, trim: true },
  date: { type: Date, required: true },
  note: { type: String, trim: true, default: "" },
  receipt: { type: String, default: "" },
  recurringId: Schema.Types.ObjectId,
}, { timestamps: true });
expenseSchema.index({ user: 1, date: -1 });

const recurringSchema = new Schema({
  user: owner,
  title: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0.01 },
  category: { type: String, required: true, trim: true },
  dayOfMonth: { type: Number, min: 1, max: 28, default: 1 },
  lastApplied: { type: String, default: "" }, // YYYY-MM of last generated expense
}, { timestamps: true });

export { User };
export const Budget = model("Budget", budgetSchema);
export const Expense = model("Expense", expenseSchema);
export const Recurring = model("Recurring", recurringSchema);