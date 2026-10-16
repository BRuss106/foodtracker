// FoodTracker phone screens. Data requests go to localApi() in store.js.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  foods: [],
  mealItems: [],       // {food_id?, name, ingredients}
  editingMealId: null,
  editingSymptomId: null,
};

// ------------------------------------------------------------ helpers

function api(path, options = {}) {
  return localApi(options.method || "GET", path, options.body);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function fmtTime(s) {
  return new Date(s).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtDay(s) {
  return new Date(s).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

function guessLabel() {
  const h = new Date().getHours();
  if (h < 11) return "Breakfast";
  if (h < 15) return "Lunch";
  if (h >= 17 && h < 21) return "Dinner";
  return "Snack";
}

// Split typed text quickly in the browser (the server cleans it again on save).
function splitTyped(text) {
  return text.split(/[,;\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// ------------------------------------------------------------ tabs

function showView(name) {
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  if (name === "timeline") loadTimeline();
  if (name === "triggers") loadTriggers();
  if (name === "foods") loadFoods().then(renderFoodsList);
  if (name === "ingredients") loadIngredients();
  if (name === "symptom") loadKinds();
  if (name === "backup") renderBackupInfo();
  window.scrollTo(0, 0);
}
$$("#tabs button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

// ------------------------------------------------------------ food editor dialog

const editor = { chips: [], onSave: null };

function openFoodEditor({ title, food = null, okLabel = "Add", showSave = true, onSave }) {
  $("#foodDialogTitle").textContent = title;
  $("#fdName").value = food?.name || "";
  $("#fdBrand").value = food?.brand || "";
  $("#fdBarcode").value = food?.barcode || "";
  $("#fdType").value = "";
  $("#fdPaste").value = "";
  $("#fdPhoto").value = "";
  $("#fdPreview").classList.add("hidden");
  $("#fdOcrStatus").textContent = "";
  $("#fdBarcodeStatus").textContent = "Looks the product up in Open Food Facts, a free public database.";
  $("#fdError").textContent = "";
  $("#fdOk").textContent = okLabel;
  $("#fdSaveWrap").classList.toggle("hidden", !showSave);
  $("#fdSave").checked = true;
  editor.chips = [...(food?.ingredients || [])];
  editor.onSave = onSave;
  setMethod("type");
  renderChips();
  $("#foodDialog").showModal();
  $("#fdName").focus();
}

function setMethod(m) {
  if (m !== "barcode") stopScanner();
  $$(".methods button").forEach((b) => b.classList.toggle("active", b.dataset.method === m));
  $$(".method").forEach((d) => d.classList.toggle("hidden", d.dataset.method !== m));
}
$$(".methods button").forEach((b) => b.addEventListener("click", () => setMethod(b.dataset.method)));

function addChips(list) {
  for (const name of list) {
    const n = name.trim().toLowerCase();
    if (n && !editor.chips.includes(n)) editor.chips.push(n);
  }
  renderChips();
}

function renderChips() {
  $("#fdChips").innerHTML = editor.chips.length
    ? editor.chips.map((c, i) =>
        `<span class="chip">${esc(c)}<button type="button" data-i="${i}" title="Remove">×</button></span>`).join("")
    : `<span class="muted">None yet.</span>`;
  $("#fdCount").textContent = editor.chips.length ? `(${editor.chips.length})` : "";
}
$("#fdChips").addEventListener("click", (e) => {
  const i = e.target.dataset.i;
  if (i !== undefined) { editor.chips.splice(Number(i), 1); renderChips(); }
});

$("#fdType").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addChips(splitTyped(e.target.value));
    e.target.value = "";
  }
});

async function parseText(text) {
  const { ingredients } = await api("parse", { method: "POST", body: { text } });
  return ingredients;
}

$("#fdParse").addEventListener("click", async () => {
  const text = $("#fdPaste").value.trim();
  if (!text) return;
  try {
    const found = await parseText(text);
    addChips(found);
    toast(found.length ? `Found ${found.length} ingredients` : "Couldn't find any ingredients in that text");
  } catch (err) { $("#fdError").textContent = err.message; }
});

// --- photo of label (Tesseract.js, loaded only when needed)

let tesseractLoading;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!tesseractLoading) {
    tesseractLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = resolve;
      s.onerror = () => { tesseractLoading = null; reject(new Error("Couldn't load the text reader. Check the internet connection.")); };
      document.head.appendChild(s);
    });
  }
  return tesseractLoading;
}

// Enlarge small photos and turn them grey; the reader does better that way.
function prepareImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(2.5, Math.max(1, 1800 / img.width));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d");
      ctx.filter = "grayscale(1) contrast(1.4)";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c);
    };
    img.onerror = () => reject(new Error("That file doesn't look like a photo."));
    img.src = URL.createObjectURL(file);
  });
}

$("#fdPhoto").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const status = $("#fdOcrStatus");
  const preview = $("#fdPreview");
  preview.src = URL.createObjectURL(file);
  preview.classList.remove("hidden");
  try {
    status.textContent = "Loading the text reader (first time takes a little longer)...";
    await loadTesseract();
    const canvas = await prepareImage(file);
    const result = await Tesseract.recognize(canvas, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text") status.textContent = `Reading the label... ${Math.round(m.progress * 100)}%`;
      },
    });
    const text = result.data.text.trim();
    if (!text) { status.textContent = "Couldn't read any text. Try a closer, sharper photo in better light."; return; }
    $("#fdPaste").value = text;
    const found = await parseText(text);
    addChips(found);
    status.textContent = "";
    setMethod("paste");
    toast(`Read the label: ${found.length} ingredients. Please check them.`);
  } catch (err) {
    status.textContent = err.message || "Couldn't read that photo.";
  }
});

// --- barcode lookup

$("#fdLookup").addEventListener("click", lookupBarcode);
$("#fdBarcode").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); lookupBarcode(); } });

async function lookupBarcode() {
  const code = $("#fdBarcode").value.trim();
  const status = $("#fdBarcodeStatus");
  if (!code) return;
  status.textContent = "Looking it up...";
  try {
    const r = await api("barcode/" + encodeURIComponent(code));
    if (!r.found) {
      status.textContent = "That product isn't in Open Food Facts. Try a photo of the label instead.";
      return;
    }
    if (!$("#fdName").value) $("#fdName").value = r.name || "";
    if (!$("#fdBrand").value) $("#fdBrand").value = r.brand || "";
    if (r.ingredients_text) $("#fdPaste").value = r.ingredients_text;
    addChips(r.ingredients);
    if (r.allergens?.length) addChips(r.allergens);
    status.textContent = r.ingredients.length
      ? `Found "${r.name || "product"}" with ${r.ingredients.length} ingredients. Please check them against the package.`
      : `Found "${r.name || "product"}" but it has no ingredient list. Try a photo of the label.`;
  } catch (err) { status.textContent = err.message; }
}

$("#fdOk").addEventListener("click", async () => {
  // Anything still sitting in the "type" box counts too.
  addChips(splitTyped($("#fdType").value));
  $("#fdType").value = "";
  const food = {
    name: $("#fdName").value.trim(),
    brand: $("#fdBrand").value.trim(),
    barcode: $("#fdBarcode").value.trim(),
    ingredients: editor.chips,
  };
  if (!food.name) { $("#fdError").textContent = "Give it a name, e.g. \"Chicken soup\"."; return; }
  if (!food.ingredients.length) { $("#fdError").textContent = "Add at least one ingredient."; return; }
  try {
    await editor.onSave(food, $("#fdSave").checked);
    $("#foodDialog").close();
  } catch (err) { $("#fdError").textContent = err.message; }
});
$("#fdCancel").addEventListener("click", () => $("#foodDialog").close());
$("#foodDialog").addEventListener("close", stopScanner);

// --- camera barcode scanning (html5-qrcode, loaded only when needed)

let scanLibLoading, scanner;
function loadScanLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  if (!scanLibLoading) {
    scanLibLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";
      s.onload = resolve;
      s.onerror = () => { scanLibLoading = null; reject(new Error("Couldn't load the scanner. Check the internet connection.")); };
      document.head.appendChild(s);
    });
  }
  return scanLibLoading;
}

function barcodeFormats() {
  const F = Html5QrcodeSupportedFormats;
  return [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E];
}

async function stopScanner() {
  const s = scanner;
  scanner = null;
  $("#fdScanner")?.classList.add("hidden");
  $("#fdScanStop")?.classList.add("hidden");
  if (s) { try { await s.stop(); s.clear(); } catch { /* already stopped */ } }
}

$("#fdScan").addEventListener("click", async () => {
  const status = $("#fdBarcodeStatus");
  try {
    await stopScanner();
    status.textContent = "Starting the camera...";
    await loadScanLib();
    $("#fdScanner").classList.remove("hidden");
    $("#fdScanStop").classList.remove("hidden");
    scanner = new Html5Qrcode("fdScanner", { formatsToSupport: barcodeFormats(), verbose: false });
    await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 260, height: 140 } },
      (code) => { stopScanner(); $("#fdBarcode").value = code; lookupBarcode(); });
    status.textContent = "Point the camera at the barcode and hold steady.";
  } catch (err) {
    stopScanner();
    status.textContent = /permission|notallowed/i.test(String(err))
      ? "The camera is blocked. Allow camera access for this app in the iPhone's Settings, or type the number."
      : (err.message || "Couldn't start the camera. Type the number instead.");
  }
});
$("#fdScanStop").addEventListener("click", () => { stopScanner(); $("#fdBarcodeStatus").textContent = ""; });

$("#fdBarcodePhoto").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const status = $("#fdBarcodeStatus");
  try {
    status.textContent = "Reading the barcode...";
    await loadScanLib();
    const reader = new Html5Qrcode("fdScanFile", { formatsToSupport: barcodeFormats(), verbose: false });
    const code = await reader.scanFile(file, false);
    $("#fdBarcode").value = code;
    lookupBarcode();
  } catch (err) {
    status.textContent = err.message?.includes("load") ? err.message
      : "Couldn't find a barcode in that photo. Try closer, or type the number.";
  }
});

// ------------------------------------------------------------ log meal

async function loadFoods() {
  state.foods = await api("foods");
  return state.foods;
}

function resetMealForm() {
  state.editingMealId = null;
  state.mealItems = [];
  $("#mealTitle").textContent = "Log a meal";
  $("#mealAt").value = nowLocal();
  $("#mealLabel").value = guessLabel();
  $("#mealNotes").value = "";
  $("#saveMeal").textContent = "Save meal";
  $("#cancelMealEdit").classList.add("hidden");
  renderMealItems();
}

function renderMealItems() {
  $("#mealItems").innerHTML = state.mealItems.map((it, i) => `
    <li><div><b>${esc(it.name)}</b>
      <div class="ings">${esc(it.ingredients.join(", "))}</div></div>
      <button class="small danger" data-i="${i}">Remove</button></li>`).join("");
  $("#mealEmpty").classList.toggle("hidden", state.mealItems.length > 0);
}
$("#mealItems").addEventListener("click", (e) => {
  const i = e.target.dataset.i;
  if (i !== undefined) { state.mealItems.splice(Number(i), 1); renderMealItems(); }
});

function addSavedFoodToMeal(food) {
  state.mealItems.push({ food_id: food.id, name: food.name, ingredients: food.ingredients });
  renderMealItems();
}

const search = $("#foodSearch");
const results = $("#foodResults");
function renderSearch() {
  const q = search.value.trim().toLowerCase();
  const list = state.foods
    .filter((f) => !q || f.name.toLowerCase().includes(q) || f.brand.toLowerCase().includes(q))
    .sort((a, b) => b.times_eaten - a.times_eaten || a.name.localeCompare(b.name))
    .slice(0, 30);
  results.innerHTML = list.length
    ? list.map((f) => `<div data-id="${f.id}"><b>${esc(f.name)}</b>${f.brand ? ` <span class="muted">${esc(f.brand)}</span>` : ""}</div>`).join("")
    : `<div class="muted">${state.foods.length ? "No match. Use \"Add a new food\" below." : "No saved foods yet. Use \"Add a new food\" below."}</div>`;
  results.classList.remove("hidden");
}
search.addEventListener("focus", renderSearch);
search.addEventListener("input", renderSearch);
search.addEventListener("blur", () => setTimeout(() => results.classList.add("hidden"), 150));
results.addEventListener("mousedown", (e) => {
  const row = e.target.closest("[data-id]");
  if (!row) return;
  const food = state.foods.find((f) => f.id === Number(row.dataset.id));
  if (food) { addSavedFoodToMeal(food); search.value = ""; toast(`Added ${food.name}`); }
});

$("#newFoodForMeal").addEventListener("click", () => openFoodEditor({
  title: "Add to this meal",
  okLabel: "Add to meal",
  onSave: async (food, save) => {
    if (save) {
      const created = await api("foods", { method: "POST", body: food });
      await loadFoods();
      addSavedFoodToMeal(created);
    } else {
      state.mealItems.push({ name: food.name, ingredients: food.ingredients });
      renderMealItems();
    }
  },
}));

$("#saveMeal").addEventListener("click", async () => {
  if (!state.mealItems.length) { toast("Add at least one food first"); return; }
  const body = {
    eaten_at: $("#mealAt").value || nowLocal(),
    label: $("#mealLabel").value,
    notes: $("#mealNotes").value.trim(),
    items: state.mealItems.map((it) => it.food_id ? { food_id: it.food_id } : { name: it.name, ingredients: it.ingredients }),
  };
  try {
    if (state.editingMealId) {
      await api("meals/" + state.editingMealId, { method: "PUT", body });
      toast("Meal updated");
      resetMealForm();
      showView("timeline");
    } else {
      await api("meals", { method: "POST", body });
      toast("Meal saved");
      resetMealForm();
    }
    loadFoods();
  } catch (err) { toast(err.message); }
});
$("#cancelMealEdit").addEventListener("click", () => { resetMealForm(); showView("timeline"); });

function editMeal(meal) {
  state.editingMealId = meal.id;
  // Saved foods are referenced by id; one-off items are copied so they stay one-offs.
  state.mealItems = meal.items.map((it) => it.saved
    ? { food_id: it.food_id, name: it.name, ingredients: it.ingredients }
    : { name: it.name, ingredients: it.ingredients });
  $("#mealTitle").textContent = "Edit meal";
  $("#mealAt").value = meal.eaten_at;
  $("#mealLabel").value = meal.label;
  $("#mealNotes").value = meal.notes;
  $("#saveMeal").textContent = "Save changes";
  $("#cancelMealEdit").classList.remove("hidden");
  renderMealItems();
  showView("meal");
}

// ------------------------------------------------------------ log symptom

async function loadKinds() {
  const kinds = await api("symptom-kinds");
  $("#kindList").innerHTML = kinds.map((k) => `<option value="${esc(k)}">`).join("");
  $("#kindButtons").innerHTML = kinds.slice(0, 9).map((k) =>
    `<button type="button" class="secondary" data-kind="${esc(k)}">${esc(k)}</button>`).join("");
  return kinds;
}
$("#kindButtons").addEventListener("click", (e) => {
  if (e.target.dataset.kind) $("#symptomKind").value = e.target.dataset.kind;
});
$("#symptomSev").addEventListener("input", (e) => { $("#sevValue").textContent = e.target.value; });

function resetSymptomForm() {
  state.editingSymptomId = null;
  $("#symptomTitle").textContent = "Log a symptom";
  $("#symptomKind").value = "";
  $("#symptomAt").value = nowLocal();
  $("#symptomSev").value = 5;
  $("#sevValue").textContent = "5";
  $("#symptomNotes").value = "";
  $("#saveSymptom").textContent = "Save symptom";
  $("#cancelSymptomEdit").classList.add("hidden");
}

$("#saveSymptom").addEventListener("click", async () => {
  const body = {
    kind: $("#symptomKind").value.trim(),
    started_at: $("#symptomAt").value || nowLocal(),
    severity: Number($("#symptomSev").value),
    notes: $("#symptomNotes").value.trim(),
  };
  if (!body.kind) { toast("Pick or type a symptom"); return; }
  try {
    if (state.editingSymptomId) {
      await api("symptoms/" + state.editingSymptomId, { method: "PUT", body });
      toast("Symptom updated");
      resetSymptomForm();
      showView("timeline");
    } else {
      await api("symptoms", { method: "POST", body });
      toast("Symptom saved");
      resetSymptomForm();
      loadKinds();
    }
  } catch (err) { toast(err.message); }
});
$("#cancelSymptomEdit").addEventListener("click", () => { resetSymptomForm(); showView("timeline"); });

function editSymptom(s) {
  state.editingSymptomId = s.id;
  $("#symptomTitle").textContent = "Edit symptom";
  $("#symptomKind").value = s.kind;
  $("#symptomAt").value = s.started_at;
  $("#symptomSev").value = s.severity;
  $("#sevValue").textContent = s.severity;
  $("#symptomNotes").value = s.notes;
  $("#saveSymptom").textContent = "Save changes";
  $("#cancelSymptomEdit").classList.remove("hidden");
  showView("symptom");
}

// ------------------------------------------------------------ timeline

let timelineData = { meals: [], symptoms: [] };

async function loadTimeline() {
  const [meals, symptoms] = await Promise.all([api("meals"), api("symptoms")]);
  timelineData = { meals, symptoms };
  const entries = [
    ...meals.map((m) => ({ type: "meal", at: m.eaten_at, data: m })),
    ...symptoms.map((s) => ({ type: "symptom", at: s.started_at, data: s })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (!entries.length) {
    $("#timeline").innerHTML = `<p class="muted">Nothing logged yet. Start with "Log meal" or "Log symptom".</p>`;
    return;
  }
  let html = "", day = "";
  for (const e of entries) {
    const d = e.at.slice(0, 10);
    if (d !== day) { if (day) html += "</div>"; day = d; html += `<div class="day"><h3>${esc(fmtDay(e.at))}</h3>`; }
    if (e.type === "meal") {
      const m = e.data;
      html += `<div class="entry"><div>
        <div class="time">${esc(fmtTime(m.eaten_at))} · ${esc(m.label || "Meal")}</div>
        ${m.items.map((it) => `<div><b>${esc(it.name)}</b> <span class="muted small">${esc(it.ingredients.join(", "))}</span></div>`).join("")}
        ${m.notes ? `<div class="muted small">${esc(m.notes)}</div>` : ""}
        </div><div class="btns">
        <button class="small secondary" data-act="edit-meal" data-id="${m.id}">Edit</button>
        <button class="small danger" data-act="del-meal" data-id="${m.id}">Delete</button></div></div>`;
    } else {
      const s = e.data;
      html += `<div class="entry symptom"><div>
        <div class="time">${esc(fmtTime(s.started_at))} · Symptom</div>
        <div><b>${esc(s.kind)}</b>, severity ${s.severity}/10</div>
        ${s.notes ? `<div class="muted small">${esc(s.notes)}</div>` : ""}
        </div><div class="btns">
        <button class="small secondary" data-act="edit-sym" data-id="${s.id}">Edit</button>
        <button class="small danger" data-act="del-sym" data-id="${s.id}">Delete</button></div></div>`;
    }
  }
  $("#timeline").innerHTML = html + "</div>";
}

$("#timeline").addEventListener("click", async (e) => {
  const { act, id } = e.target.dataset;
  if (!act) return;
  const n = Number(id);
  try {
    if (act === "edit-meal") editMeal(timelineData.meals.find((m) => m.id === n));
    if (act === "edit-sym") editSymptom(timelineData.symptoms.find((s) => s.id === n));
    if (act === "del-meal" && confirm("Delete this meal?")) { await api("meals/" + n, { method: "DELETE" }); loadTimeline(); }
    if (act === "del-sym" && confirm("Delete this symptom?")) { await api("symptoms/" + n, { method: "DELETE" }); loadTimeline(); }
  } catch (err) { toast(err.message); }
});

// ------------------------------------------------------------ likely triggers

const BADGE = {
  "Stronger signal": "b-strong", "Possible": "b-possible", "Too early to tell": "b-early",
  "In every meal": "b-every", "Probably fine": "b-fine",
};

async function fillKindSelect() {
  const symptoms = await api("symptoms");
  const kinds = [...new Set(symptoms.map((s) => s.kind))].sort();
  const sel = $("#trigKind");
  const current = sel.value;
  sel.innerHTML = `<option value="">Any symptom</option>` + kinds.map((k) => `<option>${esc(k)}</option>`).join("");
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
}

function pct(x) { return x === null || x === undefined ? "–" : Math.round(x * 100) + "%"; }

async function loadTriggers() {
  await fillKindSelect();
  const preset = $("#trigPreset").value;
  $("#customWindow").classList.toggle("hidden", preset !== "custom");
  let min, max;
  if (preset === "custom") { min = $("#trigMin").value; max = $("#trigMax").value; }
  else [min, max] = preset.split("-");
  const kind = $("#trigKind").value;
  let r;
  try {
    r = await api(`triggers?min=${min}&max=${max}&kind=${encodeURIComponent(kind)}`);
  } catch (err) { $("#trigSummary").textContent = err.message; $("#trigTable").innerHTML = ""; return; }

  const what = kind ? `"${kind}"` : "any symptom";
  let summary = `${r.meals_total} meals and ${r.episodes} episodes of ${what} logged over ${r.days_logged} day(s). `;
  summary += `${r.meals_judged} meals are old enough to judge; ${r.meals_followed} of them were followed by ${what} within ${min} to ${max} hours.`;
  if (r.meals_judged < 20 || r.episodes < 3) {
    summary += " Keep logging: patterns usually need 2 to 4 weeks of meals and several symptom episodes before they mean much.";
  }
  $("#trigSummary").textContent = summary;

  let rows = r.rows;
  if (!$("#trigAll").checked) rows = rows.filter((x) => x.level === "Stronger signal" || x.level === "Possible").concat(
    rows.filter((x) => x.level !== "Stronger signal" && x.level !== "Possible" && x.followed_with > 0).slice(0, 10));
  if (!rows.length) {
    $("#trigTable").innerHTML = `<p class="muted">${r.rows.length ? "No ingredient stands out yet. Tick \"Show every ingredient\" to see the full list." : "Not enough data yet."}</p>`;
    return;
  }
  $("#trigTable").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Ingredient</th><th>Signal</th><th>After meals with it</th><th>After meals without it</th>
    <th>Times more often</th><th>Before episodes</th><th>Avg severity</th><th>Note</th></tr></thead>
    <tbody>${rows.map((x) => `<tr>
      <td><b>${esc(x.ingredient)}</b></td>
      <td><span class="badge ${BADGE[x.level]}">${esc(x.level)}</span></td>
      <td class="num" data-label="After meals with it">${x.followed_with} of ${x.meals_with} (${pct(x.rate_with)})</td>
      <td class="num" data-label="After meals without it">${x.meals_without ? `${x.followed_without} of ${x.meals_without} (${pct(x.rate_without)})` : "–"}</td>
      <td class="num" data-label="Times more often">${x.ratio === null ? "–" : x.ratio + "×"}</td>
      <td class="num" data-label="Before episodes">${x.episodes_preceded} of ${r.episodes}</td>
      <td class="num" data-label="Avg severity">${x.avg_severity ?? "–"}</td>
      <td class="small muted${x.eaten_together_with?.length ? "" : " empty"}">${x.eaten_together_with?.length ? "Always eaten with: " + esc(x.eaten_together_with.join(", ")) : ""}</td>
    </tr>`).join("")}</tbody></table></div>`;
}
["#trigKind", "#trigPreset", "#trigMin", "#trigMax", "#trigAll"].forEach((s) =>
  $(s).addEventListener("change", loadTriggers));

// ------------------------------------------------------------ my foods

function renderFoodsList() {
  const q = $("#foodsFilter").value.trim().toLowerCase();
  const list = state.foods.filter((f) => !q || f.name.toLowerCase().includes(q) ||
    f.ingredients.some((i) => i.includes(q)));
  $("#foodsList").innerHTML = list.length ? list.map((f) => `
    <div class="food-row"><div><b>${esc(f.name)}</b>${f.brand ? ` <span class="muted">${esc(f.brand)}</span>` : ""}
      <div class="muted small">${esc(f.ingredients.join(", "))}</div>
      <div class="muted small">Eaten ${f.times_eaten} time(s)</div></div>
      <div class="btns"><button class="small secondary" data-act="edit" data-id="${f.id}">Edit</button>
      <button class="small danger" data-act="del" data-id="${f.id}">Delete</button></div></div>`).join("")
    : `<p class="muted">${state.foods.length ? "No match." : "No saved foods yet. Foods you save while logging a meal show up here."}</p>`;
}
$("#foodsFilter").addEventListener("input", renderFoodsList);

$("#newFood").addEventListener("click", () => openFoodEditor({
  title: "New food", okLabel: "Save food", showSave: false,
  onSave: async (food) => { await api("foods", { method: "POST", body: food }); await loadFoods(); renderFoodsList(); toast("Food saved"); },
}));

$("#foodsList").addEventListener("click", async (e) => {
  const { act, id } = e.target.dataset;
  if (!act) return;
  const food = state.foods.find((f) => f.id === Number(id));
  if (act === "edit") {
    openFoodEditor({
      title: "Edit food", food, okLabel: "Save changes", showSave: false,
      onSave: async (f) => {
        await api("foods/" + food.id, { method: "PUT", body: f });
        await loadFoods(); renderFoodsList(); toast("Food updated (past meals with it are updated too)");
      },
    });
  }
  if (act === "del" && confirm(`Remove "${food.name}" from My foods? Past meals keep it.`)) {
    try { await api("foods/" + food.id, { method: "DELETE" }); await loadFoods(); renderFoodsList(); }
    catch (err) { toast(err.message); }
  }
});

// ------------------------------------------------------------ ingredients

let ingredients = [];

async function loadIngredients() {
  ingredients = await api("ingredients");
  renderIngredients();
}

function renderIngredients() {
  const q = $("#ingFilter").value.trim().toLowerCase();
  const list = ingredients.filter((i) => !q || i.name.includes(q));
  const options = ingredients.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join("");
  $("#ingList").innerHTML = list.length ? list.map((i) => `
    <div class="ing-row"><div><b>${esc(i.name)}</b>
      <div class="muted small">In ${i.foods} food(s), eaten in ${i.meals} meal(s)</div></div>
      <div class="btns"><button class="small secondary" data-act="rename" data-id="${esc(i.id)}">Rename</button>
      <select data-act="merge" data-id="${esc(i.id)}"><option value="">Merge into...</option>${options}</select></div></div>`).join("")
    : `<p class="muted">${ingredients.length ? "No match." : "No ingredients yet."}</p>`;
}
$("#ingFilter").addEventListener("input", renderIngredients);

$("#ingList").addEventListener("click", async (e) => {
  if (e.target.dataset.act !== "rename") return;
  const ing = ingredients.find((i) => i.id === e.target.dataset.id);
  const name = prompt("New name for this ingredient:", ing.name);
  if (!name || name.trim().toLowerCase() === ing.name) return;
  try { await api("ingredients/" + encodeURIComponent(ing.id), { method: "PUT", body: { name } }); toast("Renamed"); loadIngredients(); }
  catch (err) { toast(err.message); }
});
$("#ingList").addEventListener("change", async (e) => {
  if (e.target.dataset.act !== "merge" || !e.target.value) return;
  const from = ingredients.find((i) => i.id === e.target.dataset.id);
  const into = ingredients.find((i) => i.id === e.target.value);
  if (from.id === into.id) { e.target.value = ""; return; }
  if (!confirm(`Merge "${from.name}" into "${into.name}"? Every food with "${from.name}" will list "${into.name}" instead.`)) {
    e.target.value = ""; return;
  }
  try { await api("merge-ingredients", { method: "POST", body: { from_id: from.id, into_id: into.id } }); toast("Merged"); loadIngredients(); }
  catch (err) { toast(err.message); }
});

// ------------------------------------------------------------ backup and export

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// On iPhone this opens the share sheet ("Save to Files", AirDrop, Mail...);
// elsewhere it downloads the file.
async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err.name === "AbortError") return false;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}

function daysSince(s) {
  return s ? Math.floor((Date.now() - new Date(s).getTime()) / 86400000) : null;
}

function renderBackupInfo() {
  const days = daysSince(data.lastBackup);
  $("#backupInfo").textContent =
    `This phone holds ${data.meals.length} meals and ${data.symptoms.length} symptoms. ` +
    (days === null ? "You haven't saved a backup yet." :
      days === 0 ? "Last backup: today." : `Last backup: ${days} day(s) ago.`);
  // Nudge for a backup once there's something worth losing.
  const due = data.meals.length + data.symptoms.length >= 5 && (days === null || days >= 7);
  $("#backupNudge").classList.toggle("hidden", !due);
}

$("#saveBackup").addEventListener("click", async () => {
  if (await saveFile(`foodtracker-backup-${stamp()}.json`, backupJson(), "application/json")) {
    data.lastBackup = new Date().toISOString();
    await saveStore();
    renderBackupInfo();
    toast("Backup saved");
  }
});

$("#restoreFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!confirm("Replace everything on this phone with the backup? Anything logged since that backup will be lost.")) return;
  try {
    restoreBackup(await file.text());
    await saveStore();
    await loadFoods();
    renderBackupInfo();
    toast("Backup restored");
  } catch (err) { toast(err.message); }
});

$("#exportCsv").addEventListener("click", () =>
  saveFile(`foodtracker-${stamp()}.csv`, "﻿" + exportCsv(), "text/csv"));
$("#backupNudge").addEventListener("click", () => showView("backup"));

// ------------------------------------------------------------ start

async function start() {
  try {
    await loadStore();
  } catch {
    toast("Couldn't open saved data. Private Browsing can block it.");
  }
  resetMealForm();
  resetSymptomForm();
  loadFoods();
  loadKinds();
  renderBackupInfo();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
start();
