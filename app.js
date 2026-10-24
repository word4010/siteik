const articlesEl = document.querySelector("#articles");
const countEl = document.querySelector("#articleCount");
document.querySelector("#year").textContent = new Date().getFullYear();

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function prettyDate(value) {
  try { return new Intl.DateTimeFormat("uk-UA", {day:"numeric",month:"long",year:"numeric"}).format(new Date(value)); }
  catch { return ""; }
}
async function loadArticles() {
  try {
    const res = await fetch("/api/articles");
    const articles = await res.json();
    countEl.textContent = `${articles.length} матеріалів`;
    if (!articles.length) {
      articlesEl.innerHTML = '<p>Поки немає статей. Редактор може додати перший матеріал.</p>';
      return;
    }
    articlesEl.innerHTML = articles.map(a => `
      <article class="article-card">
        <div class="article-image">${a.image ? `<img src="${escapeHTML(a.image)}" alt="">` : "ТСН"}</div>
        <div class="article-content">
          <span class="category">${escapeHTML(a.category || "Україна")}</span>
          <h3>${escapeHTML(a.title)}</h3>
          <p>${escapeHTML(a.excerpt || a.body || "")}</p>
          <div class="article-meta">${prettyDate(a.updatedAt || a.date)}</div>
        </div>
      </article>`).join("");
  } catch {
    articlesEl.innerHTML = "<p>Не вдалося завантажити статті. Перевірте, чи запущено сервер.</p>";
  }
}
loadArticles();

const loginDialog = document.querySelector("#loginDialog");
document.querySelector("#editorEntry").addEventListener("click", () => loginDialog.showModal());
document.querySelectorAll("[data-close]").forEach(btn => btn.addEventListener("click", () => loginDialog.close()));
document.querySelector("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const message = document.querySelector("#loginMessage");
  message.textContent = "";
  const res = await fetch("/api/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(Object.fromEntries(form)) });
  const data = await res.json();
  if (!res.ok) { message.textContent = data.error || "Не вдалося увійти."; return; }
  loginDialog.close();
  event.currentTarget.reset();
  openEditor();
});

async function openEditor() {
  let session = await fetch("/api/session").then(r => r.json());
  if (!session.loggedIn) return;
  let panel = document.querySelector("#editorPanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "editorPanel";
    panel.className = "editor-panel";
    panel.innerHTML = `
      <div class="editor-top"><h1>ТСН · Панель редактора</h1><span class="spacer"></span><button class="button secondary" id="logoutBtn">Вийти</button><button class="button secondary" id="closeEditorBtn">На сайт</button></div>
      <div class="editor-wrap">
        <aside class="editor-box"><h2>Статті</h2><button id="newArticleBtn" class="button primary" style="width:100%;margin-bottom:12px">+ Створити статтю</button><div id="editorArticleList" class="article-list"></div><p class="hint">Вибери матеріал зі списку, щоб редагувати його.</p></aside>
        <section class="editor-box"><h2 id="editorHeading">Нова стаття</h2>
          <form id="articleForm" class="editor-form">
            <input type="hidden" name="id">
            <label>Заголовок<input name="title" maxlength="220" required></label>
            <label>Розділ<select name="category"><option>Україна</option><option>Політика</option><option>Суспільство</option><option>Економіка</option><option>Світ</option><option>Культура</option><option>Технології</option></select></label>
            <label>Короткий опис<textarea name="excerpt" rows="2" maxlength="500"></textarea></label>
            <label>Текст статті<textarea name="body" required></textarea></label>
            <label>Посилання на фотографію (необов'язково)<input name="image" placeholder="/uploads/photo.jpg або https://..."></label>
            <div class="editor-actions"><button class="button primary" type="submit">Зберегти й опублікувати</button><button class="button secondary" type="button" id="clearFormBtn">Очистити форму</button><button class="button danger hidden" type="button" id="deleteArticleBtn">Видалити</button></div>
            <p id="editorMessage" class="message"></p>
          </form>
          <div class="editor-box" style="padding:14px;margin-top:18px">
            <h2>Імпорт матеріалу</h2>
            <label class="hint">Посилання на джерело<input id="importUrl" type="url" placeholder="https://example.com/article"></label>
            <div class="import-row" style="margin-top:8px"><button class="button secondary" id="importUrlBtn" type="button">Перевірити посилання</button></div>
            <p id="importMessage" class="hint"></p>
            <label class="hint" style="display:block;margin-top:12px">Завантажити текстовий файл<input id="importFile" type="file" accept=".txt,.md,.html,.htm,.png,.jpg,.jpeg,.webp,.gif"></label>
            <div class="import-row" style="margin-top:8px"><button class="button secondary" id="uploadFileBtn" type="button">Завантажити файл</button></div>
            <p class="hint">TXT/MD/HTML можна імпортувати в текст статті; зображення завантажуються й повертають посилання. DOCX не підтримується в цій стартовій версії.</p>
          </div>
        </section>
      </div>`;
    document.body.appendChild(panel);
    wireEditor(panel);
  }
  panel.classList.add("open");
  await refreshEditorList();
}
function wireEditor(panel) {
  const form = panel.querySelector("#articleForm");
  const msg = panel.querySelector("#editorMessage");
  const fields = name => form.elements.namedItem(name);
  panel.querySelector("#closeEditorBtn").onclick = () => panel.classList.remove("open");
  panel.querySelector("#logoutBtn").onclick = async () => {
    await fetch("/api/logout", {method:"POST"});
    panel.classList.remove("open");
  };
  panel.querySelector("#newArticleBtn").onclick = () => {
    form.reset(); fields("id").value = ""; panel.querySelector("#editorHeading").textContent = "Нова стаття";
    panel.querySelector("#deleteArticleBtn").classList.add("hidden"); msg.textContent = "";
    panel.querySelectorAll(".article-pick").forEach(x => x.classList.remove("active"));
  };
  panel.querySelector("#clearFormBtn").onclick = () => panel.querySelector("#newArticleBtn").click();
  panel.querySelector("#deleteArticleBtn").onclick = async () => {
    const id = fields("id").value;
    if (!id || !confirm("Точно видалити цю статтю?")) return;
    const res = await fetch(`/api/articles/${encodeURIComponent(id)}`, {method:"DELETE"});
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error || "Помилка видалення."; return; }
    form.reset(); fields("id").value = ""; panel.querySelector("#deleteArticleBtn").classList.add("hidden");
    await refreshEditorList(); await loadArticles(); msg.textContent = "Статтю видалено.";
  };
  form.onsubmit = async e => {
    e.preventDefault(); msg.textContent = "Зберігаємо…";
    const payload = Object.fromEntries(new FormData(form));
    const id = payload.id; delete payload.id;
    const res = await fetch(id ? `/api/articles/${encodeURIComponent(id)}` : "/api/articles", {
      method: id ? "PUT" : "POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error || "Не вдалося зберегти."; return; }
    fields("id").value = data.id; panel.querySelector("#editorHeading").textContent = "Редагування статті";
    panel.querySelector("#deleteArticleBtn").classList.remove("hidden");
    msg.textContent = "Збережено й опубліковано.";
    await refreshEditorList(); await loadArticles();
  };
  panel.querySelector("#importUrlBtn").onclick = async () => {
    const url = panel.querySelector("#importUrl").value.trim();
    const out = panel.querySelector("#importMessage");
    out.textContent = "Перевіряємо…";
    const res = await fetch("/api/import-url", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url})});
    const data = await res.json();
    out.textContent = data.error || `${data.note} Посилання: ${data.url}`;
  };
  panel.querySelector("#uploadFileBtn").onclick = async () => {
    const fileInput = panel.querySelector("#importFile");
    const file = fileInput.files[0]; const out = panel.querySelector("#importMessage");
    if (!file) { out.textContent = "Спочатку вибери файл."; return; }
    const fd = new FormData(); fd.append("file", file);
    out.textContent = "Завантажуємо…";
    const res = await fetch("/api/upload", {method:"POST", body:fd});
    const data = await res.json();
    if (!res.ok) { out.textContent = data.error || "Не вдалося завантажити."; return; }
    if (/\.(txt|md|html?)$/i.test(file.name)) {
      const text = await file.text();
      fields("body").value = text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      if (!fields("title").value) fields("title").value = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
      out.textContent = "Текст завантажено у форму. Перевір його перед публікацією.";
    } else {
      fields("image").value = data.url;
      out.textContent = `Зображення завантажено: ${data.url}`;
    }
  };
}
async function refreshEditorList() {
  const list = document.querySelector("#editorArticleList");
  if (!list) return;
  const articles = await fetch("/api/articles").then(r => r.json());
  list.innerHTML = articles.map(a => `<button class="article-pick" data-id="${escapeHTML(a.id)}">${escapeHTML(a.title)}</button>`).join("") || "<p class='hint'>Статей поки немає.</p>";
  list.querySelectorAll("[data-id]").forEach(button => button.addEventListener("click", async () => {
    const article = articles.find(a => a.id === button.dataset.id);
    const form = document.querySelector("#articleForm");
    for (const key of ["id","title","category","excerpt","body","image"]) form.elements.namedItem(key).value = article[key] || "";
    document.querySelector("#editorHeading").textContent = "Редагування статті";
    document.querySelector("#deleteArticleBtn").classList.remove("hidden");
    document.querySelector("#editorMessage").textContent = "";
    list.querySelectorAll(".article-pick").forEach(x => x.classList.toggle("active", x === button));
  }));
}
