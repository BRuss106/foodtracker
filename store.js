// On-phone storage. Keeps all data in memory and saves it to the browser's
// IndexedDB after every change. localApi() answers the same requests the PC
// version's server.py does, so the screens work the same way.

const DB_NAME = "foodtracker";
let data = emptyData();

function emptyData() {
  return { version: 1, nextId: 1, foods: [], meals: [], symptoms: [], lastBackup: null };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadStore() {
  const db = await openDb();
  const saved = await new Promise((resolve, reject) => {
    const req = db.transaction("kv").objectStore("kv").get("data");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (saved) data = saved;
  // Ask Safari to keep our data even when the phone is low on space.
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}

async function saveStore() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(data, "data");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

const newId = () => data.nextId++;
const nowStr = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

function cleanDt(v) {
  const s = String(v || "").slice(0, 16);
  if (isNaN(new Date(s).getTime())) throw new Error("That date and time doesn't look right.");
  return s;
}

const foodById = (id) => data.foods.find((f) => f.id === id);
const timesEaten = (fid) => data.meals.reduce((n, m) => n + m.items.filter((i) => i === fid).length, 0);

function foodView(f) {
  return {
    id: f.id, name: f.name, brand: f.brand, barcode: f.barcode, saved: f.saved,
    ingredients: [...f.ingredients].sort(), times_eaten: timesEaten(f.id),
  };
}

function createFood(body, saved = true) {
  const name = (body.name || "").trim();
  if (!name) throw new Error("A food needs a name.");
  const f = {
    id: newId(), name, brand: (body.brand || "").trim(), barcode: (body.barcode || "").trim(),
    saved, created_at: nowStr(), ingredients: normalizeList(body.ingredients),
  };
  data.foods.push(f);
  return f;
}

function mealView(m) {
  return {
    id: m.id, eaten_at: m.eaten_at, label: m.label, notes: m.notes,
    items: m.items.map(foodById).filter(Boolean).map((f) => ({
      food_id: f.id, name: f.name, saved: f.saved, ingredients: [...f.ingredients].sort(),
    })),
  };
}

function mealItems(items) {
  if (!items?.length) throw new Error("Add at least one food or ingredient to the meal.");
  // A one-off item is stored as a hidden food so it still counts.
  return items.map((it) => it.food_id ? Number(it.food_id)
    : createFood({ name: it.name || "Other", ingredients: it.ingredients }, false).id);
}

function cleanupOrphanFoods() {
  const used = new Set(data.meals.flatMap((m) => m.items));
  data.foods = data.foods.filter((f) => f.saved || used.has(f.id));
}

function symptomFields(b) {
  let kind = (b.kind || "").split(/\s+/).join(" ").trim();
  if (!kind) throw new Error("Choose or type a symptom.");
  kind = kind[0].toUpperCase() + kind.slice(1);
  const severity = Number(b.severity) || 0;
  if (severity < 1 || severity > 10) throw new Error("Severity must be between 1 and 10.");
  return { kind, started_at: cleanDt(b.started_at), severity, notes: b.notes || "" };
}

function symptomKinds() {
  const defaults = ["Stomach ache", "Bloating", "Headache", "Nausea", "Diarrhea", "Constipation",
    "Fatigue", "Skin rash / hives", "Brain fog", "Heartburn"];
  const counts = new Map();
  for (const s of data.symptoms) counts.set(s.kind, (counts.get(s.kind) || 0) + 1);
  const used = [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  return used.concat(defaults.filter((d) => !used.includes(d)));
}

function ingredientList() {
  const byName = new Map();
  for (const f of data.foods) for (const n of f.ingredients) {
    if (!byName.has(n)) byName.set(n, { foods: new Set(), meals: new Set() });
    byName.get(n).foods.add(f.id);
  }
  for (const m of data.meals) for (const fid of m.items) {
    for (const n of foodById(fid)?.ingredients || []) byName.get(n)?.meals.add(m.id);
  }
  // Ingredients have no ids of their own here, so the name is the id.
  return [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, v]) => ({ id: name, name, foods: v.foods.size, meals: v.meals.size }));
}

function renameIngredient(from, to) {
  const name = cleanName(to);
  if (!name) throw new Error("Name can't be empty.");
  for (const f of data.foods) {
    if (f.ingredients.includes(from)) f.ingredients = [...new Set(f.ingredients.map((n) => n === from ? name : n))];
  }
  return name;
}

function exportCsv() {
  const q = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [];
  for (const m of data.meals.map(mealView)) for (const it of m.items) {
    rows.push(["meal" + (m.label ? " - " + m.label : ""), m.eaten_at.replace("T", " "), it.name,
      it.ingredients.join("; "), "", m.notes]);
  }
  for (const s of data.symptoms) rows.push(["symptom", s.started_at.replace("T", " "), s.kind, "", s.severity, s.notes]);
  rows.sort((a, b) => a[1].localeCompare(b[1]));
  return [["type", "date_time", "what", "ingredients", "severity_1_to_10", "notes"], ...rows]
    .map((r) => r.map(q).join(",")).join("\r\n");
}

function backupJson() {
  return JSON.stringify({ app: "FoodTracker", exported_at: nowStr(), ...data, lastBackup: undefined });
}

function restoreBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error("That file isn't a FoodTracker backup."); }
  if (b.app !== "FoodTracker" || !Array.isArray(b.foods) || !Array.isArray(b.meals) || !Array.isArray(b.symptoms)) {
    throw new Error("That file isn't a FoodTracker backup.");
  }
  const maxId = Math.max(0, ...b.foods.map((f) => f.id), ...b.meals.map((m) => m.id), ...b.symptoms.map((s) => s.id));
  data = {
    version: 1, nextId: Math.max(b.nextId || 0, maxId + 1),
    foods: b.foods.map((f) => ({ ...f, saved: !!f.saved, ingredients: normalizeList(f.ingredients) })),
    meals: b.meals, symptoms: b.symptoms, lastBackup: data.lastBackup,
  };
}

const BARCODE_FIELDS = "product_name,product_name_en,brands,ingredients_text,ingredients_text_en,allergens_tags";

async function fetchProduct(code) {
  code = String(code).replace(/\D/g, "");
  if (!code) throw new Error("Type the numbers under the barcode.");
  let res;
  try {
    res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${BARCODE_FIELDS}`);
  } catch {
    throw new Error("Couldn't reach Open Food Facts. Check the internet connection.");
  }
  if (res.status === 404) return { found: false, barcode: code };
  if (!res.ok) throw new Error(`Open Food Facts returned an error (${res.status}).`);
  const d = await res.json();
  if (d.status !== 1) return { found: false, barcode: code };
  const p = d.product || {};
  const text = p.ingredients_text_en || p.ingredients_text || "";
  return {
    found: true, barcode: code,
    name: p.product_name_en || p.product_name || "",
    brand: (p.brands || "").split(",")[0].trim(),
    ingredients_text: text,
    ingredients: parseIngredients(text),
    allergens: (p.allergens_tags || []).map((t) => t.split(":").pop().replace(/-/g, " ")),
  };
}

// Answers "api" requests the same way server.py does.
async function localApi(method, path, body) {
  const url = new URL(path, "http://x/");
  const [res, rawId] = url.pathname.split("/").filter(Boolean);
  const q = Object.fromEntries(url.searchParams);
  const id = rawId === undefined ? null : Number(rawId);
  let result, changed = method !== "GET";

  if (res === "foods") {
    if (method === "GET") result = data.foods.filter((f) => f.saved)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })).map(foodView);
    else if (method === "POST") result = foodView(createFood(body));
    else if (method === "PUT") {
      const f = foodById(id);
      const name = (body.name || "").trim();
      if (!name) throw new Error("A food needs a name.");
      Object.assign(f, { name, brand: (body.brand || "").trim(), barcode: (body.barcode || "").trim(),
        ingredients: normalizeList(body.ingredients) });
      result = { ok: true };
    } else if (method === "DELETE") {
      // Past meals still need it for the analysis; just hide it from the library.
      if (timesEaten(id)) foodById(id).saved = false;
      else data.foods = data.foods.filter((f) => f.id !== id);
      result = { ok: true };
    }
  } else if (res === "meals") {
    if (method === "GET") result = [...data.meals]
      .sort((a, b) => b.eaten_at.localeCompare(a.eaten_at) || b.id - a.id).map(mealView);
    else if (method === "POST") {
      const m = { id: newId(), eaten_at: cleanDt(body.eaten_at), label: body.label || "", notes: body.notes || "", items: [] };
      m.items = mealItems(body.items);
      data.meals.push(m);
      result = { id: m.id };
    } else if (method === "PUT") {
      const m = data.meals.find((x) => x.id === id);
      const items = mealItems(body.items);
      Object.assign(m, { eaten_at: cleanDt(body.eaten_at), label: body.label || "", notes: body.notes || "", items });
      cleanupOrphanFoods();
      result = { ok: true };
    } else if (method === "DELETE") {
      data.meals = data.meals.filter((m) => m.id !== id);
      cleanupOrphanFoods();
      result = { ok: true };
    }
  } else if (res === "symptoms") {
    if (method === "GET") result = [...data.symptoms]
      .sort((a, b) => b.started_at.localeCompare(a.started_at) || b.id - a.id);
    else if (method === "POST") {
      const s = { id: newId(), ...symptomFields(body) };
      data.symptoms.push(s);
      result = { id: s.id };
    } else if (method === "PUT") {
      Object.assign(data.symptoms.find((s) => s.id === id), symptomFields(body));
      result = { ok: true };
    } else if (method === "DELETE") {
      data.symptoms = data.symptoms.filter((s) => s.id !== id);
      result = { ok: true };
    }
  } else if (res === "symptom-kinds") {
    result = symptomKinds();
  } else if (res === "ingredients") {
    if (method === "GET") result = ingredientList();
    else if (method === "PUT") result = { id: renameIngredient(decodeURIComponent(rawId), body.name || "") };
  } else if (res === "merge-ingredients") {
    renameIngredient(body.from_id, body.into_id);
    result = { ok: true };
  } else if (res === "parse") {
    result = { ingredients: parseIngredients(body.text || "") };
    changed = false;
  } else if (res === "barcode") {
    result = await fetchProduct(rawId);
  } else if (res === "triggers") {
    const lo = Number(q.min ?? 2), hi = Number(q.max ?? 48);
    if (!(lo >= 0) || !(hi > lo)) throw new Error("The window's end must be later than its start.");
    result = computeTriggers(data, q.kind || null, lo, hi);
  }
  if (result === undefined) throw new Error("Not found");
  if (changed) await saveStore();
  return result;
}
