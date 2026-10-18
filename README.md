# Budget Manager: Backend

Node.js + Express + MongoDB (Mongoose) REST API with JWT login, receipt uploads, CSV export and recurring expenses.

## Requirements
- Node.js 18+
- MongoDB running locally, or a MongoDB Atlas connection string

## Setup
```bash
npm install
cp .env.example .env     # then edit the values
npm run dev              # or: npm start
```
The API runs at `http://localhost:5000`.

## Environment variables (`.env`)
| Variable | Example | Purpose |
|---|---|---|
| `PORT` | `5000` | Port the API listens on |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/budget_manager` | MongoDB connection string |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Frontend URL allowed by CORS |
| `JWT_SECRET` | long random string | Signs login tokens. Keep it private |

## File structure
```
backend/
├── src/
│   ├── server.js      # Routes, auth, uploads, CSV, recurring, summary, MongoDB connection
│   └── models.js      # Schemas: User, Budget, Expense, Recurring
├── uploads/           # Receipt files (created automatically, not committed)
├── .env.example       # Template for .env
├── .gitignore         # node_modules/, .env, uploads/
├── package.json
└── README.md
```

## File management
| File | Purpose | Edit when you want to... |
|---|---|---|
| `src/server.js` | All API routes | Add endpoints or change validation |
| `src/models.js` | Database schemas and indexes | Add fields to a model |
| `.env` | Local settings and secrets | Change database, port or secret |
| `uploads/` | Uploaded receipts | Back up or clean old receipts |
| `package.json` | Dependencies and scripts | Add packages |

**Adding a feature:** define the schema in `models.js`, add routes in `server.js`, then call them from `frontend/src/api.js`.

## Data models
- **User:** `name`, `email` (unique), `password` (bcrypt hash)
- **Budget:** `user`, `category`, `limit`, `month` (`YYYY-MM`). Unique per user, category and month
- **Expense:** `user`, `title`, `amount`, `category`, `date`, `note`, `receipt`
- **Recurring:** `user`, `title`, `amount`, `category`, `dayOfMonth` (1-28), `lastApplied`

## Endpoints
All routes except `/api/auth/*` need the header `Authorization: Bearer <token>`. List routes accept `?month=YYYY-MM` (default: current month).

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create an account, returns `token` and `user` |
| POST | `/api/auth/login` | Log in, returns `token` and `user` |
| GET, POST | `/api/budgets` | List or create budgets |
| PUT, DELETE | `/api/budgets/:id` | Edit or delete a budget |
| GET, POST | `/api/expenses` | List or create expenses (POST is `multipart/form-data`, optional `receipt` file) |
| PUT, DELETE | `/api/expenses/:id` | Edit or delete an expense |
| GET | `/api/expenses/export` | Download the month's expenses as CSV |
| GET, POST | `/api/recurring` | List or create recurring expenses |
| DELETE | `/api/recurring/:id` | Stop a recurring expense |
| POST | `/api/recurring/apply` | Add this month's recurring expenses (once per item per month) |
| GET | `/api/summary` | Totals, budget vs spent per category, daily spending |

## Upgrading from the first version
Records created before accounts existed have no owner and will not appear. Clear them in `mongosh`:
```js
use budget_manager
db.budgets.drop(); db.expenses.drop()
```
The server rebuilds the budget index automatically on startup.

## Notes
- Receipts must be images or PDFs up to 5 MB. They are served at `/uploads/<name>` without a login check, so add authenticated downloads before storing sensitive documents.
- Recurring expenses are only added for the current month; past months are not backfilled.
- Before deploying, use HTTPS, a strong `JWT_SECRET`, and set `CLIENT_ORIGIN` to your real frontend URL.
