const express = require("express");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "editor";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  console.error("Помилка: задай ADMIN_PASSWORD і SESSION_SECRET у змінних середовища хостингу.");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "data");
const ARTICLES_FILE = path.join(DATA_DIR, "articles.json");
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(ARTICLES_FILE)) {
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify([
    {
      id: crypto.randomUUID(),
      title: "Вітаємо на сайті онлайн-газети",
      category: "Суспільство",
      date: new Date().toISOString(),
      image: "",
      excerpt: "Це демонстраційна стаття. Увійдіть до редакторської панелі, щоб змінити її або створити власну.",
      body: "Це стартовий шаблон навчального новинного сайту. Замініть цей текст власним матеріалом перед публікацією."
    }
  ], null, 2));
}

app.disable("x-powered-by");
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(session({
  name: "tsn_editor_session",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 8 }
}));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "");
    cb(null, `${Date.now()}-${crypto.randomBytes(5).toString("hex")}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(png|jpe?g|webp|gif|txt|md|html?)$/i.test(file.originalname);
    cb(allowed ? null : new Error("Дозволені файли: PNG, JPG, WEBP, GIF, TXT, MD, HTML."), allowed);
  }
});

function readArticles() {
  try { return JSON.parse(fs.readFileSync(ARTICLES_FILE, "utf8")); }
  catch { return []; }
}
function writeArticles(items) {
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(items, null, 2), "utf8");
}
function requireEditor(req, res, next) {
  if (req.session && req.session.editor === true) return next();
  return res.status(401).json({ error: "Потрібен вхід редактора." });
}
function safeText(value, max = 20000) {
  return String(value || "").trim().slice(0, max);
}
function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

app.use(express.static(path.join(__dirname, "public")));
app.get("/api/articles", (_req, res) => {
  const items = readArticles().sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(items);
});
app.get("/api/session", (req, res) => res.json({ loggedIn: req.session?.editor === true, username: req.session?.editor ? ADMIN_USER : null }));
app.post("/api/login", (req, res) => {
  const username = safeText(req.body.username, 100);
  const password = String(req.body.password || "");
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Неправильний логін або пароль." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Не вдалося створити сесію." });
    req.session.editor = true;
    res.json({ ok: true });
  });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.post("/api/upload", requireEditor, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не вибрано." });
  res.json({ url: `/uploads/${req.file.filename}`, originalName: req.file.originalname });
});

app.post("/api/import-url", requireEditor, async (req, res) => {
  const url = safeText(req.body.url, 2000);
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Введи правильне посилання." }); }
  if (!["http:", "https:"].includes(parsed.protocol)) return res.status(400).json({ error: "Дозволені лише HTTP/HTTPS посилання." });
  // Intentionally do not fetch arbitrary URLs on the server: prevents SSRF and avoids bypassing source-site protections.
  res.status(200).json({
    url,
    note: "Посилання збережено. Автоматичне витягування тексту з довільних сайтів вимкнено для безпеки. Відкрий джерело, скопіюй дозволений тобою текст і встав його в поле статті."
  });
});

app.post("/api/articles", requireEditor, (req, res) => {
  const title = safeText(req.body.title, 220);
  const body = safeText(req.body.body, 50000);
  if (!title || !body) return res.status(400).json({ error: "Заповни заголовок і текст статті." });
  const items = readArticles();
  const article = {
    id: crypto.randomUUID(),
    title,
    category: safeText(req.body.category, 80) || "Україна",
    date: new Date().toISOString(),
    image: safeText(req.body.image, 1000),
    excerpt: safeText(req.body.excerpt, 500) || body.slice(0, 180),
    body
  };
  items.push(article);
  writeArticles(items);
  res.json(article);
});
app.put("/api/articles/:id", requireEditor, (req, res) => {
  const items = readArticles();
  const index = items.findIndex(item => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Статтю не знайдено." });
  const title = safeText(req.body.title, 220);
  const body = safeText(req.body.body, 50000);
  if (!title || !body) return res.status(400).json({ error: "Заповни заголовок і текст статті." });
  items[index] = {
    ...items[index],
    title,
    body,
    category: safeText(req.body.category, 80) || "Україна",
    image: safeText(req.body.image, 1000),
    excerpt: safeText(req.body.excerpt, 500) || body.slice(0, 180),
    updatedAt: new Date().toISOString()
  };
  writeArticles(items);
  res.json(items[index]);
});
app.delete("/api/articles/:id", requireEditor, (req, res) => {
  const items = readArticles();
  const next = items.filter(item => item.id !== req.params.id);
  if (next.length === items.length) return res.status(404).json({ error: "Статтю не знайдено." });
  writeArticles(next);
  res.json({ ok: true });
});

app.get("/api/article-source-note", (_req, res) => res.type("text").send("Імпортуйте лише матеріали, на які маєте право."));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Сталася помилка." });
});

app.listen(PORT, "0.0.0.0", () => console.log(`Газета працює на порті ${PORT}`));
