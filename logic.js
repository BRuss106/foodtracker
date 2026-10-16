// Ingredient-label parsing and trigger analysis.
// JavaScript port of the same functions in the PC version's server.py.

// Words that only describe a category; when a label says
// "preservative (sodium benzoate)" we keep just "sodium benzoate".
const CLASS_WORDS = new Set([
  "preservative", "preservatives", "emulsifier", "emulsifiers", "stabilizer",
  "stabilizers", "stabiliser", "stabilisers", "thickener", "thickeners",
  "color", "colors", "colour", "colours", "coloring", "acidity regulator",
  "acidity regulators", "antioxidant", "antioxidants", "raising agent",
  "raising agents", "leavening", "leavening agent", "leavening agents",
  "sweetener", "sweeteners", "flavor enhancer", "flavour enhancer",
  "gelling agent", "humectant", "firming agent", "anti-caking agent",
  "acid", "acidulant", "dough conditioner", "dough conditioners",
  "vitamins and minerals", "vitamins", "minerals", "to preserve freshness",
  "for freshness", "to maintain freshness", "to preserve color",
]);

const SPELLING = [
  [/\bflavour/g, "flavor"], [/\bcolour/g, "color"], [/\bstabiliser/g, "stabilizer"],
  [/\bfibre\b/g, "fiber"], [/\byoghurt\b/g, "yogurt"],
];

const FILLER_PATTERNS = [
  /contains\s+(?:\d+(?:\.\d+)?\s*%|two percent|2 percent)\s+or\s+less\s+of(?:\s+each\s+of)?(?:\s+the\s+following)?:?/gi,
  /(?:\d+(?:\.\d+)?\s*%|two percent)\s+or\s+less\s+of(?:\s+each\s+of)?(?:\s+the\s+following)?:?/gi,
  /less\s+than\s+\d+(?:\.\d+)?\s*%\s+of:?/gi,
  /contains\s+one\s+or\s+more\s+of\s+the\s+following:?/gi,
  /one\s+or\s+more\s+of\s+the\s+following:?/gi,
  /\bmade\s+with:?/gi,
  /\b(?:to|for)\s+(?:preserve|maintain|retain|protect|promote)\s+(?:freshness|flavou?r|colou?r|quality)\b/gi,
];

// Plain water is in so many foods that it only adds noise to the trigger list.
const IGNORED_IN_ANALYSIS = new Set(["water", "filtered water"]);

function cleanName(name) {
  let s = String(name).toLowerCase().trim();
  for (const [pat, rep] of SPELLING) s = s.replace(pat, rep);
  s = s.replace(/\d+(?:\.\d+)?\s*%/g, "");
  s = s.replace(/[*†‡]/g, "");
  s = s.replace(/^(?:and|or|&)\s+/, "");
  s = s.replace(/\b(?:certified\s+)?organic\s+/g, "");
  s = s.replace(/[^\p{L}\p{N}_\s\-'&/]/gu, " ");
  s = s.replace(/\s+/g, " ").trim().replace(/^[\s\-'&/]+|[\s\-'&/]+$/g, "");
  return s;
}

// Split on commas/semicolons that are not inside brackets.
// Returns [head, innerTextOrNull] pairs.
function splitTop(text) {
  const parts = [];
  let depth = 0, buf = "", inner = null, innerBuf = "";
  for (const ch of text) {
    if (ch === "(") {
      if (depth === 0) innerBuf = ""; else innerBuf += ch;
      depth++;
    } else if (ch === ")") {
      depth = Math.max(depth - 1, 0);
      if (depth === 0) inner = inner ? inner + ", " + innerBuf : innerBuf;
      else innerBuf += ch;
    } else if ((ch === "," || ch === ";") && depth === 0) {
      parts.push([buf, inner]);
      buf = ""; inner = null;
    } else if (depth > 0) {
      innerBuf += ch;
    } else {
      buf += ch;
    }
  }
  if (depth > 0 && innerBuf) inner = inner ? inner + ", " + innerBuf : innerBuf; // unclosed bracket from a photo
  parts.push([buf, inner]);
  return parts;
}

// The word INGREDIENTS, allowing for common photo-reading slips
// (l/1/| for i, 3 for e, stray spaces, missing final s).
const HEADING_RE = /(?:^|[^a-z])([il1|!]\s?n\s?g\s?r\s?[e3]\s?d\s?[il1|!]\s?[e3]\s?n\s?t\s?s?)(?![a-z])\s*([:;.,\-]?)/gi;

// Text that comes after the ingredient list on a package.
const SECTION_END_RE = new RegExp("\\b(?:" + [
  "may (?:also )?contain", "produced in a", "processed in a", "made in a facility", "manufactured (?:in|on|by|for)",
  "made on shared", "distributed by", "made by", "packed (?:by|in|for)", "produced by", "imported by",
  "nutrition (?:facts|information)", "serving size", "servings per", "amount per", "calories", "daily value",
  "keep (?:refrigerated|frozen|cool)", "refrigerate", "store (?:in|at|below)", "storage", "best (?:before|by)",
  "use by", "sell by", "net (?:wt|weight)", "directions", "preparation", "cooking instructions",
  "allergy advice", "questions", "www\\.", "product of", "warning", "recycle",
].join("|") + ")", "i");

// Find just the ingredient list inside text read from a whole package.
// Returns { found, text } - found is false when there's no INGREDIENTS heading.
function extractIngredientSection(text) {
  const s = String(text || "");
  const matches = [...s.matchAll(HEADING_RE)];
  if (!matches.length) {
    const end = s.search(SECTION_END_RE);
    return { found: false, text: end > 0 ? s.slice(0, end) : s };
  }
  // Prefer a heading followed by a colon ("Ingredients:") over a passing mention.
  const m = matches.find((x) => /[:;]/.test(x[2])) || matches[0];
  let rest = s.slice(m.index + m[0].length);

  // The list ends at the first full stop outside brackets, but a following
  // "Contains: milk, soy." allergen sentence is kept.
  let depth = 0, cut = rest.length;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "." && depth === 0 && (i + 1 === rest.length || /\s/.test(rest[i + 1]))) {
      if (/^\s*(?:contains|allergens?)\b/i.test(rest.slice(i + 1))) continue;
      cut = i;
      break;
    }
  }
  rest = rest.slice(0, cut);
  const end = rest.search(SECTION_END_RE);
  if (end >= 0) rest = rest.slice(0, end);
  return { found: true, text: rest.trim() };
}

function parseIngredients(text) {
  if (!text) return [];
  let s = String(text).replace(/(\w)-\s*\n\s*(\w)/g, "$1$2"); // words split across label lines
  s = s.split(/\s+/).join(" ");
  s = s.replace(/\[|\{/g, "(").replace(/\]|\}/g, ")");
  s = extractIngredientSection(s).text;
  // "May contain" / "processed in a facility" are cross-contact warnings.
  s = s.split(/\b(?:may contain|may also contain|produced in a|processed in a|made in a facility|manufactured in a|manufactured on|made on shared)\b/i)[0];
  // "Contains: milk, soy" lists real allergens - keep those as ingredients.
  s = s.replace(/\b(?:contains|allergens?)\s*:/gi, ",");
  for (const pat of FILLER_PATTERNS) s = s.replace(pat, ",");
  s = s.replace(/\band\/or\b/gi, ",");
  s = s.replace(/\.(?=\s|$)/g, ",");
  s = s.replace(/:/g, ",");

  const out = [];
  const walk = (chunk) => {
    for (const [head, inner] of splitTop(chunk)) {
      const name = cleanName(head);
      if (name && !CLASS_WORDS.has(name) && !/^\d+$/.test(name) && name.length <= 60) out.push(name);
      if (inner) walk(inner);
    }
  };
  walk(s);
  return [...new Set(out)];
}

function normalizeList(items) {
  return [...new Set((items || []).map(cleanName).filter(Boolean))];
}

// ------------------------------------------------------------ statistics

const logFactCache = [0];
function logFact(n) {
  for (let i = logFactCache.length; i <= n; i++) logFactCache[i] = logFactCache[i - 1] + Math.log(i);
  return logFactCache[n];
}
function logComb(n, k) {
  return logFact(n) - logFact(k) - logFact(n - k);
}

// One-sided Fisher exact p-value that a/(a+b) is higher than c/(c+d) by chance.
function fisherGreater(a, b, c, d) {
  const n1 = a + b, n0 = c + d, k = a + c, n = n1 + n0;
  const denom = logComb(n, k);
  let p = 0;
  for (let x = a; x <= Math.min(n1, k); x++) {
    if (k - x > n0) continue;
    p += Math.exp(logComb(n1, x) + logComb(n0, k - x) - denom);
  }
  return Math.min(p, 1);
}

const HOUR = 3600 * 1000;
const parseDt = (s) => new Date(s).getTime();

// data: { foods: [{id, ingredients}], meals: [{id, eaten_at, items:[food_id]}], symptoms: [...] }
function computeTriggers(data, kind = null, minHours = 2, maxHours = 48, now = Date.now()) {
  const lo = minHours * HOUR, hi = maxHours * HOUR;
  const foodIngs = new Map(data.foods.map((f) => [f.id, f.ingredients]));

  const meals = data.meals.map((m) => {
    const ings = new Set();
    for (const fid of m.items) for (const n of foodIngs.get(fid) || []) if (!IGNORED_IN_ANALYSIS.has(n)) ings.add(n);
    return { id: m.id, at: parseDt(m.eaten_at), ings };
  });
  const symptoms = data.symptoms
    .filter((s) => !kind || s.kind === kind)
    .map((s) => ({ at: parseDt(s.started_at), sev: s.severity }));

  // Only meals whose whole reaction window has already passed can be judged.
  const judged = meals.filter((m) => m.at + hi <= now);
  for (const m of judged) {
    const hits = symptoms.filter((s) => s.at >= m.at + lo && s.at <= m.at + hi).map((s) => s.sev);
    m.followed = hits.length > 0;
    m.sev = hits.length ? Math.max(...hits) : 0;
  }
  const total = judged.length;
  const totalFollowed = judged.filter((m) => m.followed).length;

  // For each symptom episode, what was eaten in the window before it?
  const preceded = new Map();
  for (const s of symptoms) {
    const before = new Set();
    for (const m of meals) if (m.at >= s.at - hi && m.at <= s.at - lo) m.ings.forEach((n) => before.add(n));
    before.forEach((n) => preceded.set(n, (preceded.get(n) || 0) + 1));
  }

  const mealSets = new Map();
  for (const m of judged) for (const n of m.ings) {
    if (!mealSets.has(n)) mealSets.set(n, new Set());
    mealSets.get(n).add(m.id);
  }

  const rows = [];
  for (const [name, ids] of mealSets) {
    const withIt = judged.filter((m) => ids.has(m.id));
    const n1 = ids.size;
    const a = withIt.filter((m) => m.followed).length;
    const n0 = total - n1;
    const c = totalFollowed - a;
    const rate1 = n1 ? a / n1 : 0;
    const rate0 = n0 ? c / n0 : null;
    // Smoothed ratio so tiny counts don't produce huge numbers.
    const ratio = n0 ? ((a + 0.5) / (n1 + 1)) / ((c + 0.5) / (n0 + 1)) : null;
    const p = n0 ? fisherGreater(a, n1 - a, c, n0 - c) : 1;
    const sevs = withIt.filter((m) => m.followed).map((m) => m.sev);
    let level;
    if (n0 === 0) level = "In every meal";
    else if (n1 >= 5 && a >= 3 && p < 0.05 && rate1 > (rate0 || 0)) level = "Stronger signal";
    else if (n1 >= 3 && a >= 2 && p < 0.25 && rate1 > (rate0 || 0)) level = "Possible";
    else if (a === 0 && n1 >= 5) level = "Probably fine";
    else level = "Too early to tell";
    rows.push({
      ingredient: name, meals_with: n1, followed_with: a, rate_with: rate1,
      meals_without: n0, followed_without: c, rate_without: rate0,
      ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
      p_value: p, level,
      avg_severity: sevs.length ? Math.round((sevs.reduce((x, y) => x + y, 0) / sevs.length) * 10) / 10 : null,
      episodes_preceded: preceded.get(name) || 0,
    });
  }

  const order = { "Stronger signal": 0, "Possible": 1, "Too early to tell": 2, "In every meal": 3, "Probably fine": 4 };
  rows.sort((x, y) => order[x.level] - order[y.level] || (y.ratio || 0) - (x.ratio || 0) ||
    y.followed_with - x.followed_with || x.ingredient.localeCompare(y.ingredient));

  // Flag ingredients that are (almost) always eaten together - the data
  // can't tell them apart, so the person should know.
  for (const r of rows.slice(0, 40)) {
    const mine = mealSets.get(r.ingredient);
    if (mine.size < 2) continue;
    const twins = [];
    for (const [other, theirs] of mealSets) {
      if (other === r.ingredient) continue;
      let inter = 0;
      for (const id of mine) if (theirs.has(id)) inter++;
      if (inter / (mine.size + theirs.size - inter) >= 0.9) twins.push(other);
    }
    r.eaten_together_with = twins.sort().slice(0, 6);
  }

  const first = meals.length ? Math.min(...meals.map((m) => m.at)) : null;
  return {
    kind, min_hours: minHours, max_hours: maxHours,
    meals_total: meals.length, meals_judged: total, meals_followed: totalFollowed,
    episodes: symptoms.length,
    days_logged: first === null ? 0 : Math.floor((now - first) / (24 * HOUR)) + 1,
    rows,
  };
}

if (typeof module !== "undefined") module.exports = { parseIngredients, extractIngredientSection, cleanName, computeTriggers, fisherGreater };
