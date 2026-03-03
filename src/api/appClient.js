const STORAGE_KEY = "verdent_vision_db_v3";
const SESSION_KEY = "verdent_vision_session_token_v1";
const LEGACY_PROFILE_SESSION_KEY = "verdent_vision_profile_v1";
const ADMIN_EMAIL = "charlesabhishekreddy@gmail.com";
const DEFAULT_SESSION_HOURS = 8;
const REMEMBER_SESSION_DAYS = 30;
const RESET_TOKEN_MINUTES = 15;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_MIN_LENGTH = 12;

/* ================= ENTERPRISE SESSION HELPERS ================= */

const DEVICE_KEY = "verdent_device_id";

const getDeviceId = () => {
  let id = storage.getItem(DEVICE_KEY);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    storage.setItem(DEVICE_KEY, id);
  }
  return id;
};

const getCookieValue = (name) => {
  if (typeof document === "undefined") return "";
  const key = `${name}=`;
  const part = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(key));
  if (!part) return "";
  return decodeURIComponent(part.slice(key.length));
};

const readJsonSafe = async (response) => {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const isMutatingMethod = (method) => !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });

const request = async (path, { method = "GET", body, useCsrf = true } = {}) => {
  const headers = {
    Accept: "application/json",
    "X-Device-Id": getDeviceId(),
  };

  const upperMethod = String(method || "GET").toUpperCase();
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (useCsrf && isMutatingMethod(upperMethod)) {
    const csrfToken = getCookieValue(CSRF_COOKIE_NAME);
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: upperMethod,
      credentials: "include",
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error("Unable to connect to API server.");
  }

  const payload = await readJsonSafe(response);
  if (!response.ok) {
    const apiMessage = payload?.error?.message || payload?.message || `Request failed with status ${response.status}.`;
    const apiCode = payload?.error?.code;
    throw new Error(
      apiCode ? `${apiMessage} (${apiCode})` : apiMessage
    );
  }

  if (!payload) return null;
  return Object.prototype.hasOwnProperty.call(payload, "data") ? payload.data : payload;
};

const entityApi = (entityName) => ({
  async list(sort = "", limit) {
    const params = new URLSearchParams();
    if (sort) params.set("sort", sort);
    if (Number.isFinite(limit)) params.set("limit", String(limit));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/entities/${encodeURIComponent(entityName)}${suffix}`);
  },

  async filter(filters = {}, sort = "", limit) {
    const params = new URLSearchParams();
    params.set("filters", JSON.stringify(filters || {}));
    if (sort) params.set("sort", sort);
    if (Number.isFinite(limit)) params.set("limit", String(limit));
    return request(`/entities/${encodeURIComponent(entityName)}?${params.toString()}`);
  },

  async create(data = {}) {
    return request(`/entities/${encodeURIComponent(entityName)}`, {
      method: "POST",
      body: data,
    });
  },

  async update(id, data = {}) {
    return request(`/entities/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: data,
    });
  },

  async delete(id) {
    return request(`/entities/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
});

const entities = new Proxy({}, { get: (_t, prop) => entityApi(prop) });

/* ================= SESSION STORAGE ================= */

const touchDeviceSession = (email) => {
  const db = readDb();
  const deviceId = getDeviceId();
  const now = nowIso();

  db.DeviceSessions = db.DeviceSessions || [];

  db.DeviceSessions = db.DeviceSessions.filter(
    (s) => !(normalizeEmail(s.user_email) === normalizeEmail(email) && s.device_id === deviceId)
  );

  db.DeviceSessions.unshift({
    id: makeId(),
    user_email: normalizeEmail(email),
    device_id: deviceId,
    device_info: getDeviceInfo(),
    last_active: now,
  });

  writeDb(db);
};

/* ================= LOCAL "LLM" STUBS (STOPS CRASHES) ================= */

const demoWeather = (loc = "Your area") => {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const today = new Date();
  const forecast = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return {
      day: days[d.getDay() === 0 ? 6 : d.getDay() - 1],
      date: d.toISOString().split("T")[0],
      high: 86 - i,
      low: 72 - i,
      conditions: i % 3 === 0 ? "Partly Cloudy" : i % 3 === 1 ? "Sunny" : "Light Rain",
      precipitation_chance: i % 3 === 2 ? 35 : 10,
      wind_speed: 8 + i,
      icon: "sun",
    };
  });

  return {
    current: {
      location: loc,
      temperature: 84,
      feels_like: 86,
      humidity: 62,
      wind_speed: 10,
      wind_direction: "NE",
      conditions: "Partly Cloudy",
      description: "Warm with light clouds",
      uv_index: 7,
      pressure: 1012,
    },
    forecast,
    alerts: [],
    farming_conditions: {
      overall: "good",
      irrigation_advice: "Check soil moisture; irrigate early morning if needed.",
      pest_risk: "Moderate — scout for aphids/leaf spots after humid periods.",
      task_timing: "Best time: morning/evening to avoid heat stress.",
    },
  };
};

const buildFarmAdvice = (prompt = "") => {
  const lower = prompt.toLowerCase();
  if (lower.includes("tomato") && lower.includes("blight"))
    return "For blight on tomatoes: remove infected leaves, improve airflow, avoid overhead watering, and consider a copper-based fungicide.";
  if (lower.includes("aphid"))
    return "For aphids: spray neem oil/soap solution, introduce ladybugs, and reduce excess nitrogen fertilizer.";
  return "Maintain soil health, monitor crops regularly, and act early when symptoms appear.";
};

/* ---- CROP PLANNER KNOWLEDGE BASE ---- */

const CROP_KNOWLEDGE = {
  tomato: {
    aliases: ["tomatoes", "tomato", "roma", "cherry tomato", "beefsteak"],
    weeks: 12,
    soil: "Well-drained, fertile loam with pH 6.0–6.8. Amend with 4–6 inches of compost and balanced pre-plant fertilizer (10-10-10).",
    water: "1–2 inches per week. Water deeply 2–3 times weekly at soil level; increase to near-daily in summer heat. Avoid overhead watering to prevent fungal disease.",
    fertilizer: "Week 1: balanced 10-10-10 at planting. Weeks 4–5: switch to low-N, high-P/K fertilizer to encourage fruiting. Week 8: calcium spray (0.5% calcium chloride) to prevent blossom-end rot.",
    phases: [
      { weeks: [1], stage: "Bed Preparation & Transplanting", activities: ["Prepare planting bed with 4–6 inches of compost tilled in", "Test and adjust soil pH to 6.0–6.8", "Transplant seedlings 18–24 inches apart in rows 3 feet wide", "Install tomato cages or stakes at planting time", "Water in with diluted starter fertilizer (high-phosphorus)"], tips: "Plant on a cloudy day or in the evening to reduce transplant shock. Bury the stem up to the lowest leaves to encourage strong root development." },
      { weeks: [2, 3], stage: "Establishment & Root Development", activities: ["Water deeply 2–3×/week (1 inch per session)", "Mulch 2–3 inches of straw around plants to retain moisture", "Watch for cutworms — use cardboard collars around stems", "Remove any flowers appearing before week 3 to focus energy on roots"], tips: "Consistent moisture is critical in the first 3 weeks. Uneven watering causes blossom-end rot later in the season." },
      { weeks: [4, 5], stage: "Vegetative Growth", activities: ["Side-dress with nitrogen fertilizer (1 tbsp per plant)", "Prune suckers in leaf axils (indeterminate varieties only)", "Check for aphids and whiteflies; apply neem oil if detected", "Tie main stem to stake when plant reaches 12 inches tall"], tips: "Only prune suckers on indeterminate varieties. Determinate tomatoes should NOT be suckered — it reduces yield." },
      { weeks: [6, 7], stage: "Pre-Flowering", activities: ["Switch to low-nitrogen, high-potassium fertilizer", "Inspect lower leaves daily for early blight (yellow-brown spots)", "Ensure 6–8 hours of direct sunlight per day", "Thin to 1–2 strong main stems for larger fruit"], tips: "Drought stress at this stage reduces flower set significantly. Keep soil consistently moist going into flowering." },
      { weeks: [8, 9], stage: "Flowering & Fruit Set", activities: ["Gently shake plants in the morning to aid pollination", "Apply calcium spray (0.5% calcium chloride) to prevent blossom-end rot", "Increase watering to 2 inches per week", "Scout for tomato hornworms; remove by hand or apply Bt if severe"], tips: "Temperatures above 95°F (35°C) or below 55°F (13°C) at night cause flowers to drop. Shade cloth can help in extreme heat." },
      { weeks: [10, 11], stage: "Fruit Development & Ripening", activities: ["Reduce nitrogen; increase potassium to improve flavor and firmness", "Watch for late blight (dark greasy patches on leaves and stems)", "Check for fruit cracking — indicates uneven watering; mulch well", "Remove leaves touching the soil to reduce disease splash"], tips: "Uniform irrigation is the best defence against fruit cracking. Drip irrigation is ideal at this stage." },
      { weeks: [12], stage: "Harvest & Season-End", activities: ["Harvest when fruits are fully colored and slightly soft to the touch", "Pick every 2–3 days to encourage continued production", "Store harvested tomatoes at room temperature — never refrigerate", "Remove and compost (or dispose of diseased) plant material", "Amend soil and plan for crop rotation next season"], tips: "Tomatoes picked slightly early will continue ripening indoors at room temperature. Refrigeration destroys flavor and texture." },
    ],
  },
  corn: {
    aliases: ["corn", "maize", "sweet corn", "field corn", "popcorn"],
    weeks: 14,
    soil: "Deep, well-drained loam or sandy-loam with pH 5.8–7.0. Till 8–10 inches deep. Apply nitrogen-rich amendments based on soil test.",
    water: "1–1.5 inches per week. Most critical periods: silking/tasseling and grain fill — never let plants wilt during these stages.",
    fertilizer: "Pre-plant: 30-30-30 NPK. Side-dress with nitrogen (urea or ammonium nitrate) at knee-high stage (week 4–5). Foliar micronutrients (zinc, boron) at tasseling.",
    phases: [
      { weeks: [1], stage: "Soil Preparation & Planting", activities: ["Till soil 8–10 inches deep and remove previous crop debris", "Apply pre-plant fertilizer (30-30-30 NPK) and incorporate", "Plant seeds 1–1.5 inches deep, 8–12 inches apart in rows", "Space rows 30–36 inches apart for wind pollination", "Plant in blocks of at least 4 rows (not single rows) for good pollination"], tips: "Soil temperature must be at least 50°F (10°C) for germination; ideal is 60–65°F (16–18°C). Cold soils cause uneven emergence." },
      { weeks: [2, 3], stage: "Germination & Emergence", activities: ["Keep soil moist but not waterlogged during germination", "Thin seedlings to 8–10 inches apart once they reach 3–4 inches tall", "Watch for seed corn maggots; check germination rate by day 7–10", "Apply pre-emergent herbicide if weed pressure is anticipated"], tips: "Uniform plant spacing is critical for consistent yields. Crowded plants produce smaller ears." },
      { weeks: [4, 5, 6], stage: "Vegetative Growth (V1–V6)", activities: ["Side-dress with nitrogen fertilizer when plants are knee-high (V4–V5)", "Cultivate between rows to control weeds (most critical at V3–V6)", "Scout for corn rootworm beetles; apply soil insecticide if heavy population", "Water 1–1.5 inches per week; increase in hot, dry weather"], tips: "Each 'V' stage represents one visible leaf collar. V6 means 6 leaves fully emerged. Weed control here has the highest yield impact." },
      { weeks: [7, 8, 9], stage: "Tasseling & Silking", activities: ["Maintain consistent soil moisture — critical for pollination success", "Check that silks are green and moist (dry silks = poor kernel set)", "Scout for corn earworm in silk tips; apply Bt or spinosad if present", "Do NOT cultivate near roots during tasseling — root damage reduces yield"], tips: "Pollen from tassels must reach silks (each silk = one potential kernel). Wind is the pollinator — block planting ensures cross-pollination." },
      { weeks: [10, 11, 12], stage: "Grain Fill (Blister–Dough Stage)", activities: ["Check kernel development by peeling back husks — look for milky fluid", "Maintain irrigation through the dough stage", "Watch for gibberella ear rot (pink mold at tip); improve airflow if detected", "Scout for stalk borers — push on stalks to check for internal damage"], tips: "Kernel moisture drops from ~85% at silking to ~35% at maturity. Grain fill is the most yield-determining stage." },
      { weeks: [13], stage: "Maturity & Pre-Harvest", activities: ["Allow husks to dry and turn brown/tan", "Check for black layer formation at the base of kernels (= physiological maturity)", "Plan harvest equipment, logistics, and storage", "Scout for stalk lodging — harvest early if >10% of stalks are compromised"], tips: "The 'black layer' forms when grain moisture is ~30–35%. For grain storage, wait until moisture is below 15%." },
      { weeks: [14], stage: "Harvest & Post-Harvest", activities: ["Harvest when grain moisture is 14–20% for storage or when milky for sweet corn", "Set combine/harvester to minimize kernel cracking and grain loss", "Test grain for mycotoxins (aflatoxin) if drought stress occurred", "Till under crop residue or manage as mulch; apply potassium to replenish"], tips: "Store grain corn below 15% moisture and below 50°F to prevent mold and mycotoxin development." },
    ],
  },
  wheat: {
    aliases: ["wheat", "winter wheat", "spring wheat", "hard wheat", "soft wheat"],
    weeks: 17,
    soil: "Well-drained loam or clay-loam with pH 6.0–7.0. Apply phosphorus and potassium pre-plant based on soil test. Avoid compacted soils.",
    water: "15–20 inches total over the season. Critical periods: tillering and heading. Supplement with irrigation in dry springs if available.",
    fertilizer: "Pre-plant: phosphorus and potassium based on soil test. Spring topdress: split nitrogen at green-up. Foliar sulfur at flag-leaf stage for protein quality.",
    phases: [
      { weeks: [1, 2], stage: "Seedbed Preparation & Planting", activities: ["Prepare firm, well-drained seedbed (avoid fluffy, freshly tilled soil)", "Apply pre-plant P and K fertilizer based on soil test results", "Drill seed at 1–1.5 inch depth, 60–120 lbs/acre or 4–8 lbs/1000 sq ft", "Calibrate seeder for target population (1.0–1.4 million plants/acre)", "Treat seed with fungicide if smut or bunt disease is present in the area"], tips: "Avoid planting too early — early planting increases Hessian fly and aphid (Barley Yellow Dwarf virus vector) pressure significantly." },
      { weeks: [3, 4, 5], stage: "Germination & Tillering", activities: ["Scout for Hessian fly adults (small flies near base of plants)", "Scout for aphids which can vector Barley Yellow Dwarf Virus", "Control winter annual weeds (cheatgrass, wild garlic) before they compete", "Monitor for powdery mildew in humid conditions; apply fungicide if widespread"], tips: "Tillering determines yield potential. Each healthy tiller can produce a head. Good establishment before dormancy is essential." },
      { weeks: [6, 7, 8], stage: "Winter Dormancy (Winter Wheat)", activities: ["Ensure adequate ground cover to prevent frost heaving", "Monitor for ice sheeting over plants — break up if possible to allow gas exchange", "Check plant survival after severe cold events (walk fields in early spring)", "Finalize spring fertility plan based on fall tiller counts and soil test"], tips: "Winter wheat requires 6–8 weeks of vernalization (temperatures below 40°F) to transition from vegetative to reproductive growth." },
      { weeks: [9, 10], stage: "Spring Green-Up & Jointing", activities: ["Apply spring nitrogen topdress at green-up (split into 2 applications if rate is high)", "Scout intensively for aphids, Hessian fly, and early foliar diseases", "Apply herbicide for winter broadleaf weeds before the jointing stage", "Evaluate stand — consider replanting if fewer than 3 plants per square foot"], tips: "Spring nitrogen application timing and rate is the single most impactful management decision for winter wheat yield." },
      { weeks: [11, 12], stage: "Heading & Anthesis (Flowering)", activities: ["Scout daily for powdery mildew, stripe rust, and leaf rust", "Apply fungicide at Feekes 10.5 (full head emergence) if Fusarium scab risk is high", "Monitor for aphids in the flag leaf canopy; treat if >10–15 per tiller", "Irrigate if rainfall has been less than 1 inch in the past 10 days"], tips: "Fusarium head blight (scab) is most damaging at anthesis in warm, wet conditions. Prothioconazole or metconazole fungicides are most effective." },
      { weeks: [13, 14, 15], stage: "Grain Fill & Maturation", activities: ["Maintain moisture through the soft-dough stage", "Scout for aphids in the canopy — still capable of yield loss through this stage", "Check for ergot (purple-black sclerotia replacing kernels in the head)", "Monitor for lodging risk, especially in heavy-yield varieties"], tips: "Grain moisture drops rapidly in the final 2 weeks before harvest. Plan harvest logistics and equipment in advance." },
      { weeks: [16, 17], stage: "Harvest & Post-Harvest", activities: ["Harvest when grain moisture is 13–14% (dry enough for long-term storage)", "Set combine header and threshing for minimum grain damage and loss", "Manage straw residue — incorporate or manage as mulch for the next crop", "Test grain for protein content, test weight, and falling number for quality assessment"], tips: "Delaying harvest after physiological maturity by even a few days in wet weather can cause significant quality losses (sprouting, mycotoxins)." },
    ],
  },
  soybean: {
    aliases: ["soybean", "soybeans", "soya", "soya bean", "soya beans"],
    weeks: 16,
    soil: "Well-drained loam with pH 6.0–6.8. Soybeans fix their own nitrogen — do NOT apply heavy pre-plant N fertilizer. Inoculate seed with Bradyrhizobium inoculant.",
    water: "18–25 inches total. Most critical: pod fill (R3–R6 stages). Yield loss is severe from drought during pod fill.",
    fertilizer: "Inoculate seed with rhizobium inoculant. Apply phosphorus and potassium pre-plant. Sulfur application may benefit high-yield environments.",
    phases: [
      { weeks: [1], stage: "Seed Inoculation & Planting", activities: ["Inoculate seed with Bradyrhizobium japonicum inoculant (especially on first-time fields)", "Apply phosphorus and potassium fertilizer based on soil test", "Plant at 1–1.5 inch depth once soil temperature reaches 50°F (10°C)", "Target population of 140,000–160,000 plants/acre (adjust for row width)", "Row spacing 15–30 inches; narrow rows boost early-season canopy closure"], tips: "Do NOT apply high nitrogen fertilizer — soybeans fix atmospheric nitrogen through root nodules. Excess N suppresses nodulation." },
      { weeks: [2, 3, 4], stage: "Emergence & Vegetative Growth", activities: ["Check emergence uniformity; expect 75–85% emergence under good conditions", "Scout for bean leaf beetles and soybean aphids early", "Control broadleaf and grass weeds — critical through V3 stage", "Thin or evaluate plant population if emergence was uneven"], tips: "Soybeans have strong yield compensation ability — fewer plants per acre can produce more pods per plant to compensate." },
      { weeks: [5, 6, 7], stage: "Late Vegetative & Branching", activities: ["Scout weekly for soybean aphids (threshold: 250 aphids/plant on >80% of plants)", "Monitor for sudden death syndrome (SDS) and brown stem rot in wet soils", "Control any remaining weeds before canopy closure", "Watch for spider mites in hot, dry conditions"], tips: "Once the canopy closes (V6–V8), weed competition is suppressed naturally. Focus scouting on insects and disease." },
      { weeks: [8, 9, 10], stage: "Flowering (R1–R2)", activities: ["Protect pollinators — minimize insecticide applications during bloom", "Scout for bean pod mottle virus (ragged, mottled leaves)", "Apply foliar fungicide if white mold or frogeye leaf spot are present", "Ensure adequate moisture — drought stress during bloom reduces pod set"], tips: "Soybeans are self-pollinating but benefit from insect activity. Each flower that sets a pod represents yield potential." },
      { weeks: [11, 12, 13], stage: "Pod Fill (R3–R6)", activities: ["Maintain irrigation if rainfall is insufficient — this is the highest-yield-impact period", "Scout for stink bugs which damage developing seeds", "Apply fungicide for foliar diseases if canopy is wet and disease is present", "Monitor for late-season aphid flares"], tips: "Yield is almost entirely determined during pod fill. A week of drought stress at R5 (bean fill) can reduce yield by 10–20%." },
      { weeks: [14, 15], stage: "Maturation & Dry-Down", activities: ["Allow pods to turn brown and seeds to rattle — indicates maturity", "Scout for phytophthora root rot or sudden death syndrome symptoms", "Plan harvest logistics and equipment preparation", "Evaluate desiccant application if uneven maturity is a concern (commercial scale)"], tips: "Harvest when seed moisture is 13–15%. Early harvest at high moisture requires artificial drying but reduces harvest losses from pod shatter." },
      { weeks: [16], stage: "Harvest", activities: ["Harvest when moisture is 13–15% to minimize pod shatter losses", "Set combine for minimum gathering losses and cylinder/concave damage", "Evaluate yield monitor data across the field for management zones", "Apply soil amendments as needed; plan crop rotation for next season"], tips: "Soybean harvest losses can easily be 5–10% of yield. Slow down at field edges and adjust settings often." },
    ],
  },
  potato: {
    aliases: ["potato", "potatoes", "russet", "red potato", "yukon gold"],
    weeks: 16,
    soil: "Loose, well-drained sandy-loam to loam with pH 5.0–6.0. High pH causes scab disease. Hill rows for tuber development. Avoid compacted soils.",
    water: "1–2 inches per week. Most critical: tuber initiation and bulking. Maintain even moisture — uneven irrigation causes hollow heart and growth cracks.",
    fertilizer: "Pre-plant: high phosphorus starter. At-planting nitrogen band. Side-dress additional nitrogen and potassium at hilling. Foliar calcium during bulking.",
    phases: [
      { weeks: [1, 2], stage: "Seed Piece Preparation & Planting", activities: ["Cut certified seed pieces to 1.5–2 oz, each with 1–2 eyes", "Allow cut pieces to suberize (heal) for 2–3 days before planting", "Plant 3–4 inches deep in loosened soil, 10–12 inches apart in rows", "Space rows 30–36 inches apart for hilling access", "Apply pre-plant herbicide and incorporate starter fertilizer"], tips: "Use certified disease-free seed potatoes. Never plant grocery store potatoes — they may carry diseases and are often chemically sprouted." },
      { weeks: [3, 4], stage: "Emergence & Early Growth", activities: ["Monitor for stand establishment — expect emergence in 2–3 weeks", "Scout for wireworms and Colorado potato beetle eggs", "Control weeds early — potatoes are poor weed competitors", "Apply foliar nitrogen if early growth appears stunted"], tips: "Early weed control is critical — potatoes do not shade out weeds well until hilling." },
      { weeks: [5, 6], stage: "Vegetative Growth & Hilling", activities: ["Hill soil 6–8 inches up around stems when plants are 8–10 inches tall", "Colorado potato beetle scouting — treat if >1 adult/plant (use Bt or spinosad)", "Apply additional nitrogen and potassium during hilling", "Watch for early blight (brown concentric rings on lower leaves)"], tips: "Hilling is essential — exposed tubers will turn green (solanine) and become toxic. Hill at least twice during the season." },
      { weeks: [7, 8, 9], stage: "Tuber Initiation", activities: ["Maintain even, consistent soil moisture — critical for uniform tuber set", "Scout for late blight (dark water-soaked lesions on leaves)", "Apply fungicide if late blight is present in the region", "Avoid excessive nitrogen after tuber initiation — it delays maturity"], tips: "Tuber initiation occurs on stolons just below the soil surface. Cool nights (50–65°F) and long days promote tuber set." },
      { weeks: [10, 11, 12], stage: "Tuber Bulking", activities: ["Maintain 1.5–2 inches of water per week — most critical period for yield", "Apply foliar calcium to reduce internal defects (hollow heart)", "Scout for late blight; apply protectant fungicide on a regular schedule", "Avoid mechanical damage to tubers during cultivation"], tips: "Tubers gain 75% of their final weight during bulking. Drought stress here dramatically reduces yield and quality." },
      { weeks: [13, 14], stage: "Maturation & Vine Kill", activities: ["Reduce irrigation gradually to allow skin set", "Desiccate or mechanically kill vines 10–14 days before harvest (commercial scale)", "Test tuber skin set — rub thumb across skin; set skin does not slip", "Scout for late blight in vines — infected vines can spread rot to tubers"], tips: "Skin set is critical for harvest quality and storage. Harvest before vine kill risks skinning injuries that invite rot." },
      { weeks: [15, 16], stage: "Harvest & Curing", activities: ["Harvest when soil temperature is below 65°F to reduce bruising", "Set digger or harvester to minimize mechanical damage", "Cure potatoes at 50–60°F and 85–90% humidity for 2 weeks to heal skin", "Sort and discard diseased, damaged, or green tubers before storage"], tips: "Potatoes harvested in cool soils bruise less. Never store potatoes with apples or onions — ethylene gas causes sprouting." },
    ],
  },
  lettuce: {
    aliases: ["lettuce", "iceberg", "romaine", "leaf lettuce", "butterhead", "salad"],
    weeks: 7,
    soil: "Loose, well-drained loam or sandy-loam with pH 6.0–7.0. Rich in nitrogen. Raised beds improve drainage and root growth.",
    water: "1–1.5 inches per week. Lettuce is shallow-rooted — keep top 6 inches consistently moist. Overhead irrigation is fine for this crop.",
    fertilizer: "Pre-plant: nitrogen-rich fertilizer (21-0-0 or composted manure). Side-dress with diluted liquid nitrogen at week 3 if growth is slow.",
    phases: [
      { weeks: [1], stage: "Bed Preparation & Seeding", activities: ["Prepare fine, loose seedbed — lettuce needs good seed-soil contact", "Amend soil with nitrogen-rich compost (3–4 inches)", "Sow seed 1/8 inch deep (do not bury too deep — needs light to germinate)", "Space rows 12–18 inches apart; seed in rows or scatter in wide beds", "Water gently after seeding — avoid displacing seeds"], tips: "Lettuce seed needs light for germination — do not bury deeply. Germination fails at soil temperatures above 85°F. Plant in spring or fall." },
      { weeks: [2, 3], stage: "Germination & Thinning", activities: ["Keep soil consistently moist for germination (expect 7–10 days)", "Thin seedlings to 8–12 inches apart once they have 2 true leaves", "Scout for cutworms and slugs — apply diatomaceous earth if present", "Weed carefully between plants — lettuces are easily out-competed"], tips: "Thinning is critical — crowded lettuce does not form heads and bolts quickly. Use thinnings as micro-greens." },
      { weeks: [4, 5], stage: "Leaf Development & Head Formation", activities: ["Side-dress with liquid nitrogen fertilizer if leaves appear pale yellow", "Water consistently — lettuce wilts quickly and does not recover well", "Protect from heat if temperatures exceed 80°F (shade cloth)", "Scout for aphids (check undersides of leaves) and thrips"], tips: "Heat causes bolting (premature flowering) which makes lettuce bitter. Cool, consistent temperatures produce the best quality." },
      { weeks: [6], stage: "Head Maturity", activities: ["Check head firmness — press on top of head; firm = ready to harvest", "Reduce watering slightly in the final week to concentrate flavor", "Harvest romaine and butterhead types when heads reach full size", "Loose-leaf types can be harvested leaf-by-leaf from week 4 onward"], tips: "Harvest in the morning for the best flavor and shelf-life. Lettuce stored at near-freezing (34°F) lasts 2–3 weeks." },
      { weeks: [7], stage: "Final Harvest & Succession Planning", activities: ["Harvest all remaining plants before they bolt in heat", "Remove all plant debris to prevent disease carryover", "Re-amend soil with compost for the next succession planting", "Plan next planting date for 2–3 weeks later for continuous harvest"], tips: "Plant new seeds every 2–3 weeks for continuous harvests. Lettuce is ideal for quick succession cropping." },
    ],
  },
  carrot: {
    aliases: ["carrot", "carrots", "baby carrot", "nantes", "chantenay"],
    weeks: 11,
    soil: "Deep, loose, stone-free sandy-loam with pH 6.0–6.8. Avoid heavy clay or compacted soils — causes forked, stunted roots. Till 12 inches deep.",
    water: "1 inch per week. Consistent moisture is critical — alternating wet and dry causes cracking and forking. Drip irrigation is ideal.",
    fertilizer: "Pre-plant: low-nitrogen, high-phosphorus and potassium (avoid excess N which promotes tops over roots). Side-dress with potassium at week 5 for root development.",
    phases: [
      { weeks: [1, 2], stage: "Seedbed Preparation & Seeding", activities: ["Till 12 inches deep to remove rocks, clods, and debris", "Apply pre-plant fertilizer (low N, high P/K)", "Sow seeds 1/4 inch deep in rows 12–18 inches apart", "Cover with fine soil and firm gently for seed-soil contact", "Water gently — avoid crusting which prevents emergence"], tips: "Carrot seeds are tiny and slow to germinate (14–21 days). Mark rows and consider inter-seeding with fast-germinating radishes as row markers." },
      { weeks: [3, 4], stage: "Germination & Thinning", activities: ["Keep seedbed consistently moist during germination (14–21 days)", "Thin seedlings to 2–3 inches apart once they reach 2 inches tall", "Weed carefully — young carrots are weak competitors", "Watch for carrot rust fly maggots; use row covers if detected"], tips: "Thinning is the most important and most neglected step. Un-thinned carrots produce forked, unusable roots." },
      { weeks: [5, 6, 7], stage: "Active Root Development", activities: ["Maintain consistent moisture — 1 inch per week", "Apply potassium side-dress to support root development", "Continue weed control — hand weed or use shallow cultivation only", "Scout for leafhoppers and aphids; use row covers if pressure is high"], tips: "Avoid high nitrogen during root development — it promotes leafy tops at the expense of roots." },
      { weeks: [8, 9], stage: "Root Maturation & Color Development", activities: ["Reduce irrigation slightly to concentrate sugars in roots", "Check root shoulder color and size by exposing top of roots", "Continue scouting for carrot weevil and aster yellows disease", "Harvest baby carrots can begin at this stage"], tips: "Cool temperatures (below 60°F) during the final weeks dramatically improve sweetness and color intensity in carrots." },
      { weeks: [10, 11], stage: "Harvest & Storage", activities: ["Harvest when roots are 3/4 to 1 inch in diameter at the shoulder", "Loosen soil with fork before pulling to avoid root breakage", "Twist off tops immediately after harvest to prevent moisture loss", "Store in cool, humid conditions (34–38°F, 95% humidity) for up to 6 months"], tips: "Carrots left in the ground after heavy frost can be very sweet and can remain there until needed in mild climates." },
    ],
  },
  pepper: {
    aliases: ["pepper", "peppers", "bell pepper", "jalapeño", "chili", "chilli", "capsicum"],
    weeks: 14,
    soil: "Well-drained, fertile loam with pH 6.0–6.8. Avoid waterlogged soils. Amend with compost. Requires warm soil (above 65°F) for strong establishment.",
    water: "1–2 inches per week. Deep, infrequent watering encourages deep roots. Reduce slightly when fruit is setting. Avoid wet foliage.",
    fertilizer: "At planting: balanced 10-10-10. Week 4: nitrogen side-dress. When fruit sets: switch to high-K, low-N formula. Apply calcium throughout to prevent blossom-end rot.",
    phases: [
      { weeks: [1], stage: "Transplanting & Establishment", activities: ["Transplant seedlings after last frost when soil is above 65°F", "Space plants 18 inches apart in rows 24 inches wide", "Water in with high-phosphorus starter fertilizer", "Mulch with 2–3 inches of straw to retain soil warmth", "Use floating row covers if late cold is forecast"], tips: "Peppers are extremely sensitive to cold — a single frost kills them. Transplant only after the last frost date is reliably past." },
      { weeks: [2, 3, 4], stage: "Establishment & Early Vegetative Growth", activities: ["Water consistently 1–2 inches per week", "Apply first nitrogen side-dress at 3 weeks", "Remove first flowers to encourage vegetative growth and a stronger plant", "Scout for aphids and mites — apply neem oil if detected"], tips: "Removing the first flowers seems counter-intuitive but results in significantly larger, more productive plants." },
      { weeks: [5, 6, 7], stage: "Vegetative Growth & Branching", activities: ["Continue nitrogen fertilization every 2 weeks", "Stake or cage larger varieties to prevent breakage", "Control weeds — peppers are poor competitors against established weeds", "Watch for bacterial leaf spot (water-soaked spots on leaves)"], tips: "Peppers benefit from consistent temperatures between 70–85°F during the day and above 60°F at night for optimal growth." },
      { weeks: [8, 9], stage: "Flowering & Fruit Set", activities: ["Switch to high-K, low-N fertilizer when flowering begins", "Apply calcium spray to prevent blossom-end rot", "Scout for thrips which can damage flowers and spread viruses", "Maintain consistent moisture — drought stress during flowering drops blossoms"], tips: "High temperatures (above 95°F) and low temperatures (below 60°F) both cause flower drop. Shade cloth helps in extreme heat." },
      { weeks: [10, 11, 12], stage: "Fruit Development & Color Change", activities: ["Continue consistent irrigation; reduce slightly to intensify flavor", "Apply foliar calcium every 2 weeks to prevent blossom-end rot", "Scout for pepper weevil and corn earworm in fruit", "Begin harvesting green peppers if desired — promotes continued production"], tips: "All peppers start green and transition to their final color (red, yellow, orange) with time on the plant. Green harvest extends the season." },
      { weeks: [13, 14], stage: "Peak Harvest & Season-End", activities: ["Harvest continuously every 3–4 days to maximize production", "Allow desired fruits to fully ripen to final color for maximum nutrition", "Watch for Phytophthora root rot in wet soils at season-end", "Prepare soil for next season — amend and rotate crops"], tips: "Peppers can continue producing until the first frost. Bring potted peppers indoors for a second season in mild climates." },
    ],
  },
  cucumber: {
    aliases: ["cucumber", "cucumbers", "pickling cucumber", "english cucumber", "slicing cucumber"],
    weeks: 10,
    soil: "Well-drained, fertile loam with pH 6.0–7.0. Warm soil required (above 60°F). Avoid waterlogged areas. Amend with compost.",
    water: "1–2 inches per week. Consistent moisture is critical — irregular watering causes bitterness and fruit curling. Drip irrigation preferred.",
    fertilizer: "At planting: balanced fertilizer. Week 3: nitrogen side-dress when vines begin to run. When fruit sets: high-K fertilizer. Avoid excessive nitrogen which promotes vines over fruit.",
    phases: [
      { weeks: [1, 2], stage: "Planting & Germination", activities: ["Plant seeds 1 inch deep when soil temperature is above 60°F", "Space hills 3 feet apart with 4–5 seeds per hill", "Thin to 2–3 plants per hill after emergence", "Install trellis for vining types (saves space and reduces disease)", "Water in with diluted starter fertilizer"], tips: "Cucumbers are fast-growing warm-season crops. Direct seeding is preferred — they do not transplant well due to sensitive taproots." },
      { weeks: [3, 4], stage: "Vine Establishment", activities: ["Train vines to trellis as they begin to run", "Apply nitrogen side-dress fertilizer when vines are 6–8 inches long", "Scout for cucumber beetle (striped or spotted) — vector for bacterial wilt", "Control weeds while plants are small"], tips: "Cucumber beetles are the most serious pest. Bacterial wilt they transmit kills plants quickly. Row covers early; remove at flowering." },
      { weeks: [5, 6], stage: "Flowering & Pollination", activities: ["Remove row covers when first female flowers appear (flowers with tiny cucumber behind them)", "Ensure adequate bee presence for pollination", "Scout for powdery mildew (white powder on leaves)", "Switch to high-K fertilizer when flowering begins"], tips: "Male flowers appear first; female flowers (with tiny cucumber at base) come 1–2 weeks later. Poor pollination causes misshapen fruit." },
      { weeks: [7, 8, 9], stage: "Fruit Development & Harvest", activities: ["Harvest slicing cucumbers at 6–8 inches long; pickling types at 2–4 inches", "Harvest every 2–3 days — leaving overripe fruits signals the plant to stop producing", "Apply foliar fungicide if powdery mildew spreads to more than 20% of leaf area", "Maintain consistent irrigation to prevent bitterness"], tips: "Overripe cucumbers left on the vine tell the plant it has successfully reproduced and it stops producing. Harvest frequently!" },
      { weeks: [10], stage: "Late Season & Final Harvest", activities: ["Harvest all remaining cucumbers before vines die back", "Remove and compost vines to reduce disease inoculum", "Clean trellis and garden beds for next season", "Plan for crop rotation — do not plant cucurbits in same spot for 2–3 years"], tips: "Cucumber plants naturally decline after 8–10 weeks. Plant a second succession crop 4–6 weeks after the first for extended harvest." },
    ],
  },
  rice: {
    aliases: ["rice", "paddy", "basmati", "jasmine rice", "long grain rice", "short grain rice"],
    weeks: 18,
    soil: "Heavy clay or clay-loam that retains water, pH 5.5–6.5. Lowland (paddy) rice needs level fields that can be flooded 2–4 inches. Upland rice needs well-drained loam.",
    water: "Paddy: flood field to 2–4 inches after tillering and maintain through grain fill; drain 2 weeks before harvest. Upland: 1.5 inches/week. Total seasonal requirement: 35–60 inches.",
    fertilizer: "Basal: phosphorus and potassium pre-flood. Top-dress urea nitrogen in 2 splits: at active tillering (week 4–5) and at panicle initiation (week 10–11). Zinc application on deficient soils.",
    phases: [
      { weeks: [1, 2], stage: "Land Preparation & Planting", activities: ["Plow or puddle field 6–8 inches deep and level carefully", "Apply basal phosphorus and potassium fertilizer", "Transplant 25-day-old seedlings from nursery (2–3 per hill, 8×8 inch spacing) OR direct seed at 100 lbs/acre", "Establish shallow flood of 1–2 inches after transplanting", "Scout for rats and birds which attack new transplants"], tips: "Good land leveling is the most critical factor in paddy rice — uneven fields result in patchy flooding and inconsistent yields." },
      { weeks: [3, 4, 5], stage: "Establishment & Early Tillering", activities: ["Maintain 1–2 inch flood depth; drain briefly to control algae if needed", "Apply first nitrogen top-dressing (urea) at early tillering", "Scout for stem borers (dead hearts) and leaffolders — treat with insecticide if threshold exceeded", "Control weeds in drained periods; use herbicide or hand-weed"], tips: "Tillering is the most yield-determining phase — each tiller can produce a panicle. Nitrogen timing here is critical for tiller count." },
      { weeks: [6, 7, 8], stage: "Active Tillering & Canopy Closure", activities: ["Increase flood depth to 2–3 inches to suppress late-germinating weeds", "Scout for rice blast (gray-brown lesions on leaves) — apply fungicide if present", "Apply mid-season nitrogen if leaf color charts indicate deficiency", "Check for golden apple snail damage in flooded fields"], tips: "The 'critical period for weed competition' is weeks 3–8. Weeds controlled during this window give the biggest yield response." },
      { weeks: [9, 10, 11], stage: "Panicle Initiation & Booting", activities: ["Apply second nitrogen top-dressing at panicle initiation (PI)", "Maintain 3–4 inch flood depth through booting and heading", "Scout intensively for stem borers (white ears = dead panicles)", "Apply fungicide at booting for sheath blight and blast management"], tips: "Panicle initiation (PI) occurs when the growing point becomes reproductive. Nitrogen here increases grain number per panicle." },
      { weeks: [12, 13, 14], stage: "Heading & Flowering (Anthesis)", activities: ["Maintain flood through flowering — water stress during anthesis is devastating", "Scout for brown planthopper and other hopper insects in the canopy", "Avoid insecticide applications that harm pollinators during anthesis", "Apply foliar zinc if interveinal chlorosis is present on flag leaf"], tips: "Rice is self-pollinating but wind assists. Anthesis lasts only 1–2 hours per day per panicle. Do not disturb fields during this period." },
      { weeks: [15, 16], stage: "Grain Fill & Ripening", activities: ["Maintain shallow flood through grain fill (milky stage)", "Begin drainage cycle — alternate wetting and drying reduces methane and saves water", "Scout for grain discoloration from grain bugs (stink bugs) and diseases", "Plan harvest logistics; check that combine or thresher is serviced"], tips: "Alternate wetting and drying (AWD) during grain fill can save 20–30% of irrigation water with no yield penalty if managed carefully." },
      { weeks: [17, 18], stage: "Maturity & Harvest", activities: ["Drain field completely 7–10 days before harvest", "Harvest when 80–85% of panicles are straw-colored and grains are hard", "Set combine for minimal threshing damage and grain loss", "Dry paddy immediately to 14% moisture for storage; avoid delay in hot weather", "Incorporate or burn (where allowed) straw; plan soil fertility for next crop"], tips: "Delayed harvest causes grain shattering and quality losses. Rapid drying after harvest is essential in humid environments." },
    ],
  },
  beans: {
    aliases: ["beans", "bean", "green beans", "snap beans", "bush beans", "pole beans", "string beans", "french beans"],
    weeks: 9,
    soil: "Well-drained loam or sandy-loam with pH 6.0–7.0. Beans fix nitrogen — avoid heavy N application. Moderate organic matter. Avoid poorly drained areas (root rot).",
    water: "1–1.5 inches per week. Most critical: flowering and pod fill. Avoid water stress during bloom (causes flower and pod drop). Avoid overhead irrigation during bloom.",
    fertilizer: "Minimal nitrogen needed (beans fix their own). Pre-plant: phosphorus and potassium based on soil test. Inoculate seed with Rhizobium inoculant on new bean ground.",
    phases: [
      { weeks: [1], stage: "Planting", activities: ["Plant seeds 1–1.5 inches deep when soil temperature is above 60°F", "Space seeds 3–6 inches apart in rows 18–24 inches wide (bush) or 24–36 inches (pole)", "Install poles, trellis, or strings for pole beans before or at planting", "Inoculate seed with Rhizobium if beans have not been grown in this field before", "Avoid working with plants when leaves are wet — spreads bacterial diseases"], tips: "Never plant beans in cold, wet soil — they rot. Soil temperature of 65°F gives fast, uniform germination within 5–7 days." },
      { weeks: [2, 3], stage: "Germination & Emergence", activities: ["Scout for bean leaf beetles which attack seedlings immediately after emergence", "Thin bush beans to 4–6 inches apart once seedlings emerge", "Control weeds early — beans are poor competitors in early growth", "Watch for damping-off in cool, wet conditions; improve drainage if needed"], tips: "Beans emerge by pushing their cotyledons above the soil (epigeal germination). Soil crusting at this stage can cause poor stands." },
      { weeks: [4, 5], stage: "Vegetative Growth", activities: ["Train pole bean vines to support as they reach 6–8 inches tall", "Apply phosphorus and potassium side-dress if growth appears slow", "Control aphids with insecticidal soap or neem oil if colonies form", "Continue weed control between rows — beans do not shade weeds well"], tips: "Bush beans branch naturally and do not need training. Pole beans must be guided to supports or they will sprawl and underperform." },
      { weeks: [6, 7], stage: "Flowering & Pod Set", activities: ["Maintain consistent moisture — critical period for fruit set", "Avoid overhead irrigation during blooming hours to prevent flower damage", "Scout for Mexican bean beetle (yellow with black spots, lacy leaf feeding)", "Apply balanced foliar fertilizer if plants appear pale or growth is slow"], tips: "Each bean flower produces one pod. High temperatures (above 95°F) or drought during flowering causes significant pod drop." },
      { weeks: [8, 9], stage: "Pod Fill & Harvest", activities: ["Harvest snap beans when pods are firm and crisp, 4–6 inches long, before seeds bulge", "Harvest every 2–3 days — regular picking extends the season significantly", "For dry beans: allow pods to turn brown and dry on the plant before harvest", "Remove all pods at end of season — leaving them signals the plant to stop producing"], tips: "Snap beans are ready 50–60 days from planting. Pick before seeds develop inside for best texture. Harvest dry beans at 15–16% moisture." },
    ],
  },
  peas: {
    aliases: ["peas", "pea", "garden peas", "sugar snap peas", "snow peas", "sweet peas", "english peas"],
    weeks: 10,
    soil: "Well-drained loam with pH 6.0–7.5. Peas tolerate cool, moist soils. Avoid heavy clay or warm soils. Inoculate with Rhizobium for nitrogen fixation.",
    water: "1 inch per week. Peas are cool-season and tolerate some dryness. Most critical: flowering and pod fill. Avoid wet foliage during cool weather (promotes fungal diseases).",
    fertilizer: "Peas fix nitrogen — apply minimal N. Pre-plant: phosphorus and potassium. Rhizobium inoculant at seeding. Avoid high nitrogen which promotes vines over pods.",
    phases: [
      { weeks: [1], stage: "Planting (Cool Season)", activities: ["Plant as soon as soil can be worked in spring (soil temp 40–65°F)", "Sow seeds 1–2 inches deep, 2–3 inches apart in rows 18–24 inches", "Install trellis, netting, or pea brush for vining types before or at planting", "Inoculate seed with Rhizobium inoculant for maximum nitrogen fixation", "Direct seed — peas do not transplant well"], tips: "Peas are cold-tolerant and should be planted early. Hot weather (above 75°F) stops production. Aim to harvest before summer heat arrives." },
      { weeks: [2, 3], stage: "Germination & Emergence", activities: ["Germination takes 7–14 days in cool soil; be patient", "Protect seedlings from birds and mice which eat pea seeds and seedlings", "Scout for pea weevils — check for half-moon feeding notches on leaf margins", "Weed carefully — peas are poor early-season competitors"], tips: "Peas are one of the few crops where cool soil is actually preferred for germination. They can germinate in soil as cold as 40°F." },
      { weeks: [4, 5, 6], stage: "Vegetative Growth & Climbing", activities: ["Guide vines to trellis as they grow — peas climb by tendrils", "Scout for aphids which are a major pest of peas; treat with soap spray if present", "Watch for powdery mildew in warm, dry conditions — apply sulfur fungicide", "Weed control is critical through canopy closure"], tips: "Pea tendrils grab supports automatically but may need initial guidance. Adequate support prevents lodging and improves harvest efficiency." },
      { weeks: [7, 8], stage: "Flowering & Pod Set", activities: ["Maintain consistent moisture during flowering (avoid drought)", "Harvest snap peas when pods are plump but before seeds mature inside", "Harvest snow peas when pods are flat and seeds are just beginning to form", "Continue scouting for aphids which peak during flowering"], tips: "Peas produce blooms from the bottom of the plant upward. Picking pods regularly encourages continued production at higher nodes." },
      { weeks: [9, 10], stage: "Harvest & Season-End", activities: ["Harvest garden (shelling) peas when pods are full and bright green", "Shell and refrigerate or freeze immediately for best sweetness — sugars convert to starch quickly", "Remove plants when production declines and hot weather arrives", "Till plant material into soil — residue adds nitrogen to the soil"], tips: "Pea quality declines rapidly after harvest. Freshly picked peas left at room temperature for even a few hours lose significant sweetness." },
    ],
  },
  onion: {
    aliases: ["onion", "onions", "yellow onion", "red onion", "white onion", "bulb onion", "shallot"],
    weeks: 16,
    soil: "Well-drained loam or sandy-loam with pH 6.0–7.0. Fine, loose seedbed for direct seeding. High organic matter improves yield. Avoid heavy clay (poor bulb formation).",
    water: "1–1.5 inches per week. Critical periods: bulb initiation and development. Reduce irrigation 2–3 weeks before harvest to allow outer scales to dry for curing.",
    fertilizer: "Pre-plant: nitrogen, phosphorus, potassium based on soil test. Side-dress nitrogen at weeks 4 and 8. Apply sulfur on sulfur-deficient soils for pungency. Stop nitrogen at bulb initiation.",
    phases: [
      { weeks: [1, 2], stage: "Transplanting or Direct Seeding", activities: ["Transplant 6–8 week old transplants OR plant sets 1 inch deep, 4–6 inches apart in rows 12 inches wide", "Apply starter fertilizer high in phosphorus at planting", "Firm soil around transplants; water in thoroughly", "Direct-seeded onions require 10–12 weeks to reach transplant size — plan ahead", "Install drip irrigation if available — onions benefit greatly from precise irrigation"], tips: "Onion day-length response (short-day vs long-day varieties) is critical — use the wrong type for your latitude and bulbs will not form. Short-day: south of 36°N; long-day: north of 36°N." },
      { weeks: [3, 4, 5], stage: "Establishment & Leaf Development", activities: ["Apply first nitrogen side-dress when plants are established (2–3 leaves)", "Scout for onion thrips (silvery streaks on leaves) — threshold is 1 thrip/leaf", "Control weeds aggressively — onions are extremely poor weed competitors (narrow, upright leaves)", "Thin direct-seeded stands to 4–6 inches when plants are 3–4 inches tall"], tips: "Weed control in onions is the most labor-intensive and yield-critical practice. Each leaf an onion plant produces represents one ring of the future bulb." },
      { weeks: [6, 7, 8], stage: "Canopy Growth & Pre-Bulbing", activities: ["Apply second nitrogen side-dress (last N application — stop before bulbing begins)", "Continue aggressive weed management", "Scout for onion thrips and apply insecticide if populations exceed threshold", "Scout for downy mildew and purple blotch in humid conditions"], tips: "Each leaf that an onion produces corresponds to one ring. A plant with 13 leaves will have 13 rings. More leaves = bigger bulb." },
      { weeks: [9, 10, 11, 12], stage: "Bulb Initiation & Development", activities: ["Cease all nitrogen fertilization once bulbing begins (excess N delays maturity)", "Maintain consistent irrigation during bulb development — critical yield period", "Scout for pink root and fusarium bulb rot in wet soils", "Control weeds that can shade bulbs — shading reduces bulb size"], tips: "Bulbing is triggered by day-length. Once initiated, bulbs grow rapidly — keep irrigation consistent. Nitrogen after bulbing delays maturity and reduces curing quality." },
      { weeks: [13, 14], stage: "Maturation & Neck Fall", activities: ["Monitor for neck fall (tops falling over naturally) — indicates maturity in 50–60% of plants", "Reduce irrigation to allow outer skin to dry", "Scout for botrytis neck rot — ensure good airflow in canopy", "Prepare harvest equipment and curing facilities"], tips: "Onions are mature when 50–80% of tops have fallen over naturally. Do not harvest too early (short storage life) or too late (disease entry)." },
      { weeks: [15, 16], stage: "Harvest & Curing", activities: ["Pull or undercut onions when tops are fully fallen and necks are tight", "Cure in the field for 1–3 weeks in dry, sunny weather OR cure in forced-air facility at 95°F", "After curing, clip tops to 1 inch and roots to 0.5 inch before storage", "Store cured onions at 32–35°F and 65–70% humidity for 6–8 months"], tips: "Proper curing is the key to long storage life. Onions not fully cured will rot in storage. Cure until neck is completely dry and papery." },
    ],
  },
  spinach: {
    aliases: ["spinach", "baby spinach", "flat leaf spinach", "savoy spinach"],
    weeks: 7,
    soil: "Well-drained, fertile loam with pH 6.5–7.5 (spinach is one of the most pH-sensitive vegetables — below 6.0 causes iron/manganese toxicity). High organic matter. Cool soil preferred.",
    water: "1–1.5 inches per week. Spinach is shallow-rooted — keep top 4 inches moist. Avoid water stress which triggers bolting. Overhead irrigation is fine.",
    fertilizer: "Pre-plant: high-nitrogen fertilizer (compost or 21-0-0). Side-dress with diluted liquid nitrogen at week 2–3 if growth is slow. Stop nitrogen as plants approach harvest.",
    phases: [
      { weeks: [1], stage: "Bed Preparation & Planting", activities: ["Prepare loose, fertile seedbed — amend with compost or aged manure", "Test and adjust pH to 6.5–7.5 (lime if below 6.5)", "Sow seeds 0.5 inch deep, 2 inches apart in rows 12 inches wide", "Water gently after seeding — avoid crusting", "Spinach is cold-tolerant — plant 4–6 weeks before last frost in spring"], tips: "Spinach can be planted in early spring when soil is still cold (35°F). It is one of the first crops that can go in the ground each year." },
      { weeks: [2, 3], stage: "Germination & Thinning", activities: ["Keep soil moist during germination (7–14 days)", "Thin seedlings to 4–6 inches apart once they have 2 true leaves", "Scout for aphids and flea beetles on young plants", "Weed carefully between rows — spinach is poor at competing with weeds"], tips: "Spinach has slow germination in warm soil (above 75°F). Pre-soak seeds in cold water for 24 hours to improve germination in warm conditions." },
      { weeks: [4, 5], stage: "Leaf Development", activities: ["Side-dress with diluted nitrogen fertilizer if leaves appear yellow", "Water consistently — drought stress triggers bolting (premature flowering)", "Protect from hot weather with shade cloth if temperatures exceed 75°F", "Scout for downy mildew (purple patches under leaves) in humid conditions"], tips: "Spinach bolts (goes to seed) in response to day-lengths above 14 hours and temperatures above 75°F. Grow in spring or fall for best results." },
      { weeks: [6], stage: "Harvest — Baby Leaf Stage", activities: ["Begin harvesting outer leaves when plants have 5–6 leaves", "Cut leaves 1 inch above crown for regrowth (cut-and-come-again method)", "Harvest in early morning for best taste and shelf-life", "Scout for downy mildew which accelerates as canopy closes"], tips: "Baby leaf spinach can be harvested at 25–30 days from seeding. Full-size plants take 40–50 days." },
      { weeks: [7], stage: "Final Harvest & Succession", activities: ["Harvest all remaining plants before bolting in warm weather", "Pull entire plants for a full harvest if bolt stems are forming", "Remove all plant debris to prevent disease carryover", "Plan succession planting — spinach can be replanted every 3–4 weeks for continuous harvest"], tips: "As soon as the growing point elongates, spinach becomes bitter. Harvest before any sign of bolting for best flavor." },
    ],
  },
  broccoli: {
    aliases: ["broccoli", "broccolini", "broccoli raab", "calabrese"],
    weeks: 12,
    soil: "Well-drained, fertile loam or clay-loam with pH 6.0–7.0. High fertility required. Amend with 4 inches of compost. Consistent moisture essential.",
    water: "1–1.5 inches per week. Consistent moisture is critical throughout. Dry spells cause hollow stems and loose, poor-quality heads. Avoid overhead irrigation on mature heads.",
    fertilizer: "Pre-plant: high-nitrogen, high-phosphorus fertilizer. Side-dress nitrogen at weeks 3–4 and at head formation (week 7–8). Boron application prevents hollow stem.",
    phases: [
      { weeks: [1, 2], stage: "Transplanting & Establishment", activities: ["Transplant 5–6 week old seedlings 18–24 inches apart in rows 24–36 inches wide", "Plant in early spring (4–6 weeks before last frost) or late summer for fall crop", "Water in with starter fertilizer; mulch to retain moisture and regulate soil temperature", "Protect from cabbageworm adults (white butterflies) — install row covers at transplanting", "Firm soil around root ball to eliminate air pockets"], tips: "Broccoli thrives in cool weather (60–70°F). Hot weather causes premature heading (buttoning) and poor head quality. Time planting for cool season." },
      { weeks: [3, 4, 5], stage: "Vegetative Growth", activities: ["Apply first nitrogen side-dress when plants are established", "Scout for imported cabbageworm, cabbage looper, and aphids under leaves", "Apply Bt (Bacillus thuringiensis) for caterpillar pests — safe and effective", "Control weeds — broccoli is a poor weed competitor in early growth"], tips: "Caterpillar pests (cabbage loopers and imported cabbageworms) are the most serious broccoli pests. They hide inside heads and are difficult to see at harvest." },
      { weeks: [6, 7], stage: "Head Initiation (Bud Formation)", activities: ["Apply second nitrogen side-dress at early head formation", "Apply boron foliar spray (0.1%) if boron deficiency is suspected (hollow stems)", "Maintain consistent moisture — water stress now causes loose, poor-quality heads", "Scout for thrips inside developing head buds"], tips: "Broccoli heads (curds) are actually immature flower buds. They must be harvested before buds open (turn yellow). Hot weather accelerates opening." },
      { weeks: [8, 9, 10], stage: "Head Development & Maturity", activities: ["Harvest central head when compact, tight, and 4–8 inches diameter, before buds show any yellow", "Cut with 5–6 inches of stem at a 45° angle — promotes side-shoot development", "After central head harvest, side shoots will develop and can be harvested for several more weeks", "Scout for downy mildew (gray fuzzy growth on head) in humid, cool conditions"], tips: "Broccoli heads mature quickly in warm weather — check daily once head size exceeds 2 inches. A day or two of delay can mean over-mature, bitter broccoli." },
      { weeks: [11, 12], stage: "Side Shoot Harvest & Season-End", activities: ["Harvest side shoots every 2–3 days as they form and reach 2–3 inches diameter", "Continue scouting for caterpillar pests in side shoots", "Apply foliar fertilizer to maintain side shoot production", "Remove plants when side shoot production declines and soil temperature rises above 75°F"], tips: "Side shoot production can extend the harvest season by 4–6 weeks after the central head is harvested. Consistent picking promotes more shoot development." },
    ],
  },
  squash: {
    aliases: ["squash", "zucchini", "courgette", "summer squash", "yellow squash", "patty pan", "crookneck"],
    weeks: 8,
    soil: "Well-drained, fertile loam with pH 6.0–7.5. Warm soil required (above 65°F). High organic matter. Raised hills improve drainage and soil warmth.",
    water: "1–2 inches per week. Consistent moisture critical during fruit set. Water at soil level to prevent leaf wetness and powdery mildew. Reduce toward season end.",
    fertilizer: "Pre-plant: balanced 10-10-10. Side-dress nitrogen when vines begin running (week 3–4). High-K fertilizer when fruiting. Avoid excess nitrogen which promotes vines over fruit.",
    phases: [
      { weeks: [1, 2], stage: "Planting & Germination", activities: ["Plant 3–4 seeds per hill, 1 inch deep, once soil is above 65°F", "Space hills 4–6 feet apart (vining) or 2–3 feet (bush types)", "Thin to 2–3 strongest plants per hill once established", "Install row covers to protect from cucumber beetles and squash vine borers", "Water in with starter fertilizer"], tips: "Squash germinates very quickly (5–7 days) in warm soil. Cold soil causes rot. For a head start, use transplants started 2–3 weeks indoors." },
      { weeks: [3, 4], stage: "Vine Development & Runner Stage", activities: ["Remove row covers when first female flowers appear (before bees are excluded)", "Apply nitrogen side-dress as vines begin to run", "Scout for squash vine borer moths — apply Bt or wrap stems with foil", "Control weeds before vines make cultivation impossible"], tips: "Squash vine borer is the most destructive squash pest. The moth lays eggs at the base of stems. Wrapping stems with foil or injecting Bt prevents damage." },
      { weeks: [5, 6], stage: "Flowering & Fruit Set", activities: ["Ensure adequate pollinator presence — reduced bee activity causes poor fruit set", "Scout for powdery mildew (white powder on leaves) — apply sulfur fungicide if present", "Switch to high-K fertilizer to support fruiting", "Remove any deformed or diseased fruit early"], tips: "Male flowers appear 1–2 weeks before female flowers. If female flowers appear but fruit does not set, the cause is usually inadequate pollination." },
      { weeks: [7, 8], stage: "Heavy Production & Harvest", activities: ["Harvest zucchini and summer squash every 2–3 days at 6–8 inches long (or smaller for tenderness)", "Leaving oversize fruit on plants dramatically reduces further production — pick often", "Scout for cucumber beetles and squash bugs; treat if populations cause economic damage", "Remove and compost spent plants at end of season"], tips: "Zucchini can go from perfect to over-large in 24–48 hours in warm weather. Harvest size of a fat marker (1.5 inches diameter) is ideal for best flavor." },
    ],
  },
  watermelon: {
    aliases: ["watermelon", "water melon", "seedless watermelon", "mini watermelon"],
    weeks: 13,
    soil: "Sandy-loam with pH 6.0–7.0. Warm (above 70°F), well-drained, loose soil. Watermelons need deep, loose soil for vigorous root development. Avoid clay soils.",
    water: "1–2 inches per week. Most critical: vine growth and fruit set. Reduce sharply 2 weeks before harvest to concentrate sweetness. Overwatering after veraison dilutes sugar.",
    fertilizer: "Pre-plant: phosphorus-rich starter. Week 2: nitrogen side-dress for vine growth. At fruit set: switch to high-K, low-N formula. Avoid excessive N which promotes vines over fruit.",
    phases: [
      { weeks: [1, 2], stage: "Planting & Establishment", activities: ["Plant seeds 1 inch deep or transplant 3–4 week old transplants once soil is above 70°F", "Space plants 2–3 feet apart in rows 6–8 feet wide (give vines room to run)", "Install black plastic mulch to warm soil and reduce weeds", "Apply pre-plant fertilizer high in phosphorus", "Use row covers to protect from cucumber beetles — remove at flowering"], tips: "Watermelons are heat-lovers. Cold, wet soil causes rot and stunted growth. Soil temperature of 70°F is the minimum; 80°F is ideal for transplants." },
      { weeks: [3, 4, 5], stage: "Vine Growth & Canopy Establishment", activities: ["Apply nitrogen side-dress as vines begin to run", "Train and direct vines to utilize space efficiently", "Scout for cucumber beetles and aphids", "Maintain consistent moisture for maximum vine growth"], tips: "Watermelon vines can grow 10–15 feet in each direction. Adequate spacing prevents overcrowding, poor airflow, and disease." },
      { weeks: [6, 7], stage: "Flowering & Fruit Set", activities: ["Remove row covers before flowering to allow bee pollination", "Ensure adequate bee population — poor pollination causes malformed fruit", "Switch to high-K, low-N fertilizer at first flower", "Scout for powdery mildew and gummy stem blight"], tips: "Each watermelon plant needs 8–10 bee visits per female flower for full fruit set. Poor pollination results in crooked or hollow fruit." },
      { weeks: [8, 9, 10], stage: "Fruit Development & Sizing", activities: ["Maintain consistent irrigation through fruit sizing", "Place cardboard or straw under developing fruit to prevent rot", "Apply fungicide preventively for gummy stem blight and downy mildew", "Monitor for squash bugs which can damage developing fruit"], tips: "Watermelons double in size every few days during peak growth. Keep irrigation consistent — water stress during sizing reduces final fruit size dramatically." },
      { weeks: [11, 12], stage: "Sugar Accumulation & Pre-Harvest", activities: ["Sharply reduce irrigation once fruits reach full size (2 weeks before harvest)", "Check for maturity signs: curly tendril nearest fruit dries up; bottom spot turns creamy-yellow", "Thump test: hollow sound indicates ripeness; dull thud means not yet ripe", "Control late-season pest pressure which can damage rinds"], tips: "Reducing water at this stage is the most important step for sweetness. The plant concentrates sugars when mildly stressed. Over-watering at this stage dilutes flavor." },
      { weeks: [13], stage: "Harvest", activities: ["Harvest when: tendril nearest fruit is dried; bottom spot is creamy-yellow; rind resists scratching; hollow thump sound", "Cut the vine cleanly — do not pull or tear", "Handle carefully — internal bruising is invisible but ruins texture", "Store uncut watermelons at 50–60°F for up to 2 weeks; refrigerate after cutting"], tips: "Seedless watermelons require a seeded pollinator variety planted nearby. Without adequate pollination, seedless types produce hollow or misshapen fruit." },
    ],
  },
  eggplant: {
    aliases: ["eggplant", "aubergine", "brinjal", "japanese eggplant", "italian eggplant"],
    weeks: 14,
    soil: "Well-drained, fertile loam or sandy-loam with pH 5.5–6.8. Eggplant needs warm soil (above 65°F) and warm nights. Rich in organic matter.",
    water: "1–1.5 inches per week. Consistent moisture is essential — water stress causes fruit drop and poor quality. Mulch heavily to retain moisture in summer heat.",
    fertilizer: "At planting: balanced 10-10-10. Week 3: nitrogen side-dress. At fruit set: high-K, moderate-N formula. Apply calcium to prevent fruit defects.",
    phases: [
      { weeks: [1], stage: "Transplanting", activities: ["Transplant 8–10 week old seedlings after all frost danger is past and soil is above 65°F", "Space 18–24 inches apart in rows 24–36 inches", "Install stakes or cages at planting — eggplants become heavy", "Mulch 3–4 inches to retain moisture and soil warmth", "Water in with high-phosphorus starter fertilizer"], tips: "Eggplant is even more heat-loving than tomatoes. Cold soil (below 60°F) causes severe growth setback. Wait until conditions are truly warm." },
      { weeks: [2, 3, 4], stage: "Establishment & Vegetative Growth", activities: ["Apply first nitrogen side-dress at 3 weeks after transplanting", "Scout for flea beetles (tiny holes in leaves) — floating row covers help early", "Remove first 1–2 flowers to let plant establish before fruit load", "Control weeds — eggplant grows slowly early and is easily out-competed"], tips: "Flea beetles are the most common early-season eggplant pest. They riddle leaves with small holes but rarely kill established plants." },
      { weeks: [5, 6, 7, 8], stage: "Vigorous Growth & Branching", activities: ["Continue nitrogen fertilization every 3–4 weeks", "Prune to 3–4 main branches for higher-quality, larger fruit", "Scout for spider mites (speckling, webbing) in hot, dry weather", "Watch for phomopsis fruit rot (brown spots on fruit near calyx)"], tips: "Eggplant is one of the most productive warm-season vegetables once established. Plants can produce fruit for 3–4 months with good care." },
      { weeks: [9, 10, 11], stage: "Flowering & Fruit Set", activities: ["Switch to high-K, moderate-N fertilizer at full bloom", "Maintain consistent irrigation — flower and fruit drop from water stress", "Scout for tobacco hornworm and Colorado potato beetle adults and larvae", "Apply calcium spray to prevent blossom-end rot on fruit"], tips: "Eggplant flowers are self-pollinating but benefit from vibration. Lightly shake plants or use an electric pollinator for better fruit set in tunnels." },
      { weeks: [12, 13, 14], stage: "Harvest & Continued Production", activities: ["Harvest when fruit is glossy, firm, and full-sized (varies by variety: 3–10 inches)", "Cut with a short stem — do not pull", "Harvest every 3–4 days — overripe fruit becomes bitter and seeds harden", "Remove any fruit that has turned dull/brown — they signal the plant to slow production"], tips: "Eggplant is harvested before fully ripe. Test by pressing the skin — it should spring back slowly. If it springs back quickly, it's not ready; if it doesn't spring back, it's overripe." },
    ],
  },
  sweetpotato: {
    aliases: ["sweet potato", "sweet potatoes", "yam", "yams", "batata"],
    weeks: 18,
    soil: "Loose, well-drained sandy-loam with pH 5.5–6.5. Do NOT add excessive compost or nitrogen (promotes tops over roots). Avoid heavy clay soils — causes misshapen roots.",
    water: "1–1.5 inches per week. Critical periods: vine establishment and root initiation (weeks 2–6). Reduce in final 4 weeks to concentrate sugars. Too much water promotes vines.",
    fertilizer: "Pre-plant: phosphorus and potassium (low nitrogen). Minimal N after planting — excess N produces huge vines with small roots. Apply potassium side-dress at weeks 6 and 12.",
    phases: [
      { weeks: [1, 2], stage: "Slip Planting & Establishment", activities: ["Plant certified sweet potato slips (rooted cuttings) 12–18 inches apart in ridged rows", "Ridges should be 8–10 inches tall and 12 inches wide for drainage and root formation", "Plant slips 4–5 inches deep — bury at least 3–4 nodes for best rooting", "Water in well; slips will wilt initially — this is normal", "Irrigate daily for first week until slips are established and standing upright"], tips: "Sweet potato slips are the rooted cuttings that become plants. Do NOT plant whole sweet potatoes. Never plant slips from grocery stores — they carry disease." },
      { weeks: [3, 4, 5, 6], stage: "Vine Establishment & Root Initiation", activities: ["Maintain soil moisture during critical root initiation period", "Apply potassium side-dress at week 4–6", "Vine training: lift and re-direct vines to prevent adventitious rooting (rerooting depletes energy from main roots)", "Scout for wireworms and sweet potato weevil which attack roots"], tips: "Lifting vines is important — if vines root at nodes, energy is diverted from the main storage roots you want to harvest." },
      { weeks: [7, 8, 9, 10, 11, 12], stage: "Active Vine Growth & Root Development", activities: ["Maintain consistent irrigation throughout active growth", "Apply second potassium side-dress at week 12", "Continue vine lifting every 2–3 weeks to prevent rooting", "Scout for sweet potato whitefly and aphids in vine canopy"], tips: "Sweet potato roots grow continuously until harvest. The longer they stay in the ground (up to the frost), the larger they grow — within limits." },
      { weeks: [13, 14, 15], stage: "Pre-Harvest Maturation", activities: ["Begin reducing irrigation to concentrate sugars in roots", "Check root development by carefully digging near one plant", "Apply no more fertilizer at this stage", "Watch for disease symptoms that could spread during harvest"], tips: "Root sizing accelerates in cooler fall temperatures. A light frost actually improves sweetness. But a hard freeze kills roots — harvest before a killing frost." },
      { weeks: [16, 17, 18], stage: "Harvest & Curing", activities: ["Harvest before the first killing frost (below 28°F)", "Dig carefully with a fork — damaged roots rot in storage", "Cure at 80–85°F and 85–90% humidity for 5–7 days to heal wounds", "After curing, store at 55–60°F and 85–90% humidity for up to a year", "Do NOT store sweet potatoes below 50°F — they develop chilling injury"], tips: "Curing is essential and non-negotiable. Uncured sweet potatoes taste starchy and rot quickly. Cured sweet potatoes develop their characteristic sweetness during 3–4 weeks of storage." },
    ],
  },
  strawberry: {
    aliases: ["strawberry", "strawberries", "june bearing strawberry", "everbearing strawberry", "day-neutral strawberry"],
    weeks: 16,
    soil: "Well-drained sandy-loam with pH 5.5–6.5. Rich in organic matter. Raised beds improve drainage and fruit quality. Avoid heavy clay and poorly drained soils.",
    water: "1–1.5 inches per week. Critical during establishment and fruiting. Drip irrigation is ideal — keeps leaves and fruit dry, reducing disease. Never let plants dry out.",
    fertilizer: "Pre-plant: balanced fertilizer with moderate P and K. After renovation (year 1): nitrogen application. Avoid excess nitrogen during fruiting — causes soft, watery fruit.",
    phases: [
      { weeks: [1, 2], stage: "Planting & Establishment", activities: ["Plant bare-root crowns or transplants in spring (after frost) or fall", "Space 12–18 inches apart in rows 3 feet wide; plant crown at soil level (not too deep, not too shallow)", "Water in immediately and keep consistently moist for 2–3 weeks", "Remove all flowers in year 1 (June-bearing) to direct energy to runners and root development", "Apply pre-plant fertilizer high in phosphorus to encourage root development"], tips: "Planting depth is critical — the crown (where leaves emerge) must be at soil level. Too deep = crown rot; too shallow = drying out. This single factor determines establishment success." },
      { weeks: [3, 4, 5], stage: "Runner Development & Establishment", activities: ["Allow runners to root 8–12 inches from mother plant for next year's plants", "Water consistently — 1 inch per week", "Scout for strawberry weevil and two-spotted spider mites", "Remove weeds as they emerge — mulch to suppress new germination"], tips: "Each runner tip will root and become a daughter plant. Allow 4–6 daughter plants per mother plant, then remove excess runners." },
      { weeks: [6, 7, 8], stage: "Vegetative Growth", activities: ["Apply nitrogen fertilizer 4–6 weeks after planting to encourage leaf growth", "Continue runner management — root new daughter plants, remove excess", "Scout for leaf diseases (angular leaf spot, anthracnose) in humid conditions", "Keep beds weed-free through mulching and hand removal"], tips: "Healthy, vigorous plants in year 1 produce the best fruit in year 2. Year 1 investment in establishment pays off in yield the following spring." },
      { weeks: [9, 10], stage: "Flower Bud Initiation (Fall, Short Days)", activities: ["Flower buds form in short days and cool temperatures of fall", "Apply potassium fertilizer to promote flower bud development", "Winterize plants — apply 3–4 inches of straw mulch after hard frost", "Cut off all remaining runners and old leaves before mulching"], tips: "June-bearing strawberries initiate flowers in fall when day-length falls below 12 hours and temperatures drop below 60°F. Day-neutral types fruit regardless of day-length." },
      { weeks: [11, 12, 13], stage: "Dormancy & Winter (Mulched)", activities: ["Maintain mulch cover through winter — prevents frost heaving", "Check mulch coverage after thaw events", "In late winter/early spring: remove some mulch to allow growth when temperatures rise", "Leave some mulch between rows as weed control and fruit support"], tips: "Straw mulch is essential in climates with freeze-thaw cycles. Roots exposed to repeated freezing and thawing are heaved out of the soil and die." },
      { weeks: [14, 15], stage: "Spring Green-Up & Bloom", activities: ["Remove mulch from crowns once consistent temperatures above 40°F", "Apply spring nitrogen fertilizer after growth resumes", "Scout for tarnished plant bug which causes 'cat-faced' distorted fruit", "Protect blooms from late frost with row covers (covers critical when temperatures below 28°F during bloom)"], tips: "A single frost during bloom destroys the pistils of open flowers. The center of a frost-damaged flower turns black. Use row covers when frost is forecast." },
      { weeks: [16], stage: "Harvest", activities: ["Harvest June-bearing strawberries when fully red and easily pull from stem", "Harvest daily — fruit quality declines rapidly in warm weather", "Handle gently — strawberries bruise easily and do not store long after harvest", "After harvest: renovate beds (mow to 3–4 inches, narrow rows to 12 inches, fertilize)"], tips: "Strawberries must be harvested with the cap (calyx) attached for maximum shelf life. Refrigerate immediately after picking — field heat reduces shelf life dramatically." },
    ],
  },
  sunflower: {
    aliases: ["sunflower", "sunflowers", "oil sunflower", "confectionery sunflower"],
    weeks: 12,
    soil: "Well-drained loam to sandy-loam with pH 6.0–7.5. Moderate fertility. Sunflowers tolerate poor soils but respond to good fertility. Avoid waterlogged areas (stem and root rot).",
    water: "1–1.5 inches per week. Most critical: bud formation through seed fill. Drought-tolerant but yield is dramatically improved with supplemental irrigation at critical periods.",
    fertilizer: "Pre-plant: phosphorus and potassium based on soil test. Nitrogen side-dress at knee-high stage (V6). Avoid excessive N which causes lodging and delays maturity.",
    phases: [
      { weeks: [1], stage: "Planting", activities: ["Plant seeds 1–1.5 inches deep when soil temperature is above 50°F", "Space 6–12 inches apart in rows 24–30 inches for oil types; 12–18 inches for ornamental", "Apply pre-plant fertilizer; incorporate", "Firm soil over seeds for good seed-soil contact"], tips: "Sunflowers are extremely easy to establish. They have high germination rates and emerge quickly in warm soil (5–7 days at 65°F)." },
      { weeks: [2, 3], stage: "Emergence & Early Vegetative Growth", activities: ["Thin to final stand once plants have 2 true leaves", "Control weeds aggressively through V4 — sunflowers are poor early competitors", "Scout for cutworms which cut seedlings at soil level", "Bright yellow cotyledons emerging is a sign of healthy emergence"], tips: "Sunflowers are uncompetitive with weeds until V6 stage. Weed control in weeks 2–5 has the largest yield impact." },
      { weeks: [4, 5, 6], stage: "Vegetative Growth (V4–V12)", activities: ["Apply nitrogen side-dress at knee-high (V6)", "Continue weed control", "Scout for sunflower stem weevil and sunflower beetle", "Assess for boron deficiency (distorted, cupped leaves) — apply borax foliar if deficient"], tips: "Sunflowers grow rapidly once established — 1–3 inches per day in good conditions. Support is not needed for field types; tall ornamental types may need staking." },
      { weeks: [7, 8], stage: "Bud Formation & Pre-Bloom", activities: ["Maintain irrigation during bud formation — critical period for head size and seed set", "Scout for sunflower head moth and lygus bugs in developing buds", "Apply fungicide for phomopsis/sclerotinia head rot if disease pressure is high", "Inspect for lodging risk — tall varieties may need support in high-wind areas"], tips: "Head size is determined during bud development. Water stress here permanently limits the number and size of seeds, not the harvested head size." },
      { weeks: [9, 10], stage: "Bloom & Pollination", activities: ["Maximum bee visitation occurs during open bloom (R5)", "Avoid insecticide applications during bloom — bees are essential pollinators", "Scout for head-feeding insects (sunflower moth larvae, head-clipping weevils)", "Maintain irrigation through early seed fill"], tips: "Sunflower heads track the sun only while the plant is young (heliotropism). Mature, open flowers face east to warm bees on cool mornings and maximize pollination." },
      { weeks: [11, 12], stage: "Seed Fill, Maturity & Harvest", activities: ["Monitor seed moisture: harvest oil types at 10–12% moisture; confectionery at 10–12% moisture", "Dry seeds to 9–10% for long-term storage", "Cover or net heads if bird pressure is severe", "Harvest before prolonged rain or frost which cause quality losses"], tips: "Sunflower seeds can be eaten fresh (at 35% moisture, milky stage) for a sweet treat. For storage, dry to below 10% moisture promptly after harvest." },
    ],
  },
  garlic: {
    aliases: ["garlic", "hardneck garlic", "softneck garlic", "elephant garlic"],
    weeks: 30,
    soil: "Well-drained, loose loam or sandy-loam with pH 6.0–7.0. High organic matter. Excellent drainage is critical — garlic is extremely sensitive to waterlogging.",
    water: "0.5–1 inch per week during active growth. Reduce in May–June to allow bulb drying before harvest. Stop irrigation 2–3 weeks before harvest.",
    fertilizer: "At planting: phosphorus and potassium. Spring: nitrogen application at green-up and again at 4–6 inch height. Stop nitrogen by late spring — it delays maturity and reduces bulb quality.",
    phases: [
      { weeks: [1, 2], stage: "Clove Planting (Fall)", activities: ["Break heads into individual cloves and plant largest cloves for best bulb size", "Plant pointed end up, 2 inches deep, 4–6 inches apart in rows 12–18 inches", "Apply pre-plant compost and phosphorus/potassium fertilizer; mix into top 6 inches", "Mulch with 3–4 inches of straw after planting to insulate and suppress weeds", "In cold climates, plant 4–6 weeks before hard frost for root establishment before dormancy"], tips: "Planting clove size directly correlates to final bulb size. Always plant the largest cloves. Small cloves produce small bulbs — save them for cooking." },
      { weeks: [3, 4, 5], stage: "Root Development & Early Shoots", activities: ["Green tops may emerge before winter depending on climate — this is normal", "Maintain mulch cover to prevent frost heaving and insulate roots", "Water if fall is dry — roots need moisture to establish", "No fertilizer needed until spring growth resumes"], tips: "Garlic cloves root and may show green tops before winter dormancy. This is normal and healthy — the tops will survive winter temperatures." },
      { weeks: [6, 7, 8, 9, 10], stage: "Winter Dormancy (Cold Climate)", activities: ["Maintain mulch through winter — check after ice events", "No action needed during dormancy", "Mark row ends clearly — they will be invisible under mulch by spring", "Plan spring fertility applications"], tips: "Garlic requires vernalization — cold temperatures (below 40°F) for 6–8 weeks trigger bulb formation. Without vernalization, garlic forms a single-clove bulb (round)." },
      { weeks: [11, 12, 13, 14], stage: "Spring Green-Up & Active Growth", activities: ["Remove or rake back mulch partially when consistent growth resumes", "Apply spring nitrogen fertilizer when tops reach 4–6 inches", "Apply second nitrogen application 3–4 weeks later", "Scout for onion thrips and garlic bloat nematode (stunted, yellowing plants)"], tips: "Spring is the most critical growth period for garlic. Adequate nitrogen in early spring directly determines bulb size. Nitrogen after late May reduces quality." },
      { weeks: [15, 16, 17, 18, 19, 20, 21, 22], stage: "Bulb Development & Scape Formation", activities: ["Stop nitrogen fertilization by late spring (for northern growers: Memorial Day)", "Hardneck varieties: cut scapes when they curl to redirect energy to bulbs (increases bulb size 15–20%)", "Reduce irrigation as leaves begin to brown at the tips", "Scout for white rot and rust diseases"], tips: "Garlic scapes are the curling flower stalks on hardneck varieties. Remove them for larger bulbs and eat them — they are delicious. Softneck varieties do not produce scapes." },
      { weeks: [23, 24, 25, 26], stage: "Maturation & Pre-Harvest", activities: ["Monitor leaf browning — harvest when 50–60% of leaves have turned brown/yellow", "Stop all irrigation 3–4 weeks before harvest", "Lift one bulb to check wrapper development and clove separation", "Prepare curing area: well-ventilated, dry, shaded space"], tips: "Harvesting too early gives poor wrapper development (papery skin peels away). Harvesting too late causes clove separation and poor storage. 50% brown leaves is the target." },
      { weeks: [27, 28, 29, 30], stage: "Harvest & Curing", activities: ["Gently loosen soil with fork before lifting to avoid bruising", "Brush off soil gently — do not wash bulbs", "Hang in bundles of 10–12 or lay flat on screens in a dry, ventilated area", "Cure for 4–6 weeks until outer wrappers are dry and papery and necks are tight", "After curing, trim roots to 0.5 inch and top to 2 inches for storage"], tips: "Proper curing is essential for storage. Garlic cured correctly stores for 6–12 months. Garlic not properly cured will mold within weeks." },
    ],
  },
};

/**
 * Build a generic 10-week growing plan for crops not in the knowledge base.
 * Uses general agricultural principles applicable to most food crops.
 * @param {string} cropName
 * @param {Date} plantingDate
 */
const buildGenericTimeline = (cropName, plantingDate) => {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const displayName = cropName ? cropName.split(" ").map(cap).join(" ") : "Crop";
  const weeks = 12;
  const harvestDate = new Date(plantingDate);
  harvestDate.setDate(harvestDate.getDate() + weeks * 7);

  return {
    crop_name: displayName,
    total_weeks: weeks,
    expected_harvest_date: harvestDate.toISOString().slice(0, 10),
    watering_schedule: `1–1.5 inches of water per week, either from rainfall or irrigation. Water deeply and less frequently to encourage deep root growth. The most critical periods are during germination, flowering, and fruit/seed development.`,
    fertilizer_plan: `Apply a balanced starter fertilizer (10-10-10 NPK) at planting. Side-dress with nitrogen fertilizer when plants are knee-high. Switch to a lower-nitrogen, higher-potassium formula once flowering begins to promote quality harvest over vegetative growth.`,
    soil_requirements: `Well-drained, fertile loam or sandy-loam with pH 6.0–7.0. Amend with 3–4 inches of compost before planting. Ensure good drainage — most crops will not tolerate waterlogged soils.`,
    timeline: [
      { week: 1, stage: "Soil Preparation & Planting", activities: [`Prepare planting area: loosen soil 8–10 inches deep and remove debris`, `Apply and incorporate balanced starter fertilizer`, `Plant seeds at the recommended depth (typically 2–3× seed diameter) or transplant seedlings`, `Water in thoroughly after planting`, `Mark rows for easy identification`], tips: `Good soil preparation is the foundation of a successful crop. Loose, well-aerated soil encourages rapid root establishment and reduces transplant shock.` },
      { week: 2, stage: "Germination & Emergence", activities: [`Keep soil consistently moist — do not let it dry out during germination`, `Check for uniform emergence after the expected germination period`, `Scout for cutworms, slugs, or birds which attack seedlings`, `Note any gaps in germination for possible replanting`], tips: `Soil temperature is the primary factor controlling germination speed. Most crops germinate best at 65–75°F. Cold soils significantly slow germination.` },
      { week: 3, stage: "Seedling Establishment", activities: [`Thin seedlings to the recommended final spacing if direct seeded`, `Apply a gentle watering 2–3 times per week to encourage establishment`, `Begin weed control — weeds are most competitive in the first 3–4 weeks`, `Check transplants for signs of wilting or stress`], tips: `The first 2–3 weeks after germination or transplanting are critical. Plants stressed at this stage may never fully recover their yield potential.` },
      { week: 4, stage: "Early Vegetative Growth", activities: [`Apply first fertilizer side-dress once plants are established`, `Increase watering frequency during warm, dry weather`, `Continue weed removal — especially important before plants shade the ground`, `Scout for aphids, mites, and leaf-chewing insects; treat with neem oil if present`], tips: `Regular scouting from week 4 onward prevents small pest or disease problems from becoming yield-threatening. Early action is always more effective.` },
      { week: 5, stage: "Active Vegetative Growth", activities: [`Ensure plants are receiving 6–8 hours of direct sunlight daily`, `Stake, cage, or trellis tall or vining varieties before they need support`, `Continue consistent irrigation — 1–1.5 inches per week`, `Apply mulch (2–3 inches) around plants to retain moisture and suppress weeds`], tips: `Mulching at this stage returns significant benefits for the rest of the season: cooler root zones, reduced watering frequency, and suppressed weed competition.` },
      { week: 6, stage: "Pre-Flowering / Rapid Growth", activities: [`Switch to a lower-nitrogen, higher-phosphorus and potassium fertilizer`, `Ensure plants are well-supported and have adequate space`, `Scout for disease (spots, mold, wilting) and pest pressure`, `Maintain consistent irrigation — drought stress before flowering reduces yields`], tips: `The transition from vegetative to reproductive growth is a critical pivot point. Switching fertilizer at this stage encourages flowering and fruiting rather than excessive leaf growth.` },
      { week: 7, stage: "Flowering / Reproductive Stage", activities: [`Maintain consistent soil moisture during flowering — the most yield-sensitive period`, `Minimize insecticide use to protect pollinators`, `Hand-pollinate if bee activity appears low`, `Apply foliar fertilizer if plants show pale or deficient leaf color`], tips: `Water stress during flowering is the single most common cause of crop yield loss. Even brief dry spells during pollination can cause flower drop and significantly reduce final harvest.` },
      { week: 8, stage: "Fruit / Seed Development", activities: [`Increase irrigation during fruit or seed development — high water demand`, `Apply high-potassium fertilizer to promote quality and fruit development`, `Scout for fruit-feeding insects and diseases affecting developing fruit`, `Remove any diseased or damaged fruit promptly to prevent spread`], tips: `Most of the final harvest weight accumulates during fruit fill or seed development. Adequate water and potassium during this stage directly determine the size and quality of the harvest.` },
      { week: 9, stage: "Maturation", activities: [`Reduce irrigation slightly as harvest approaches to concentrate flavors and dry skin`, `Check for maturity indicators appropriate to the crop`, `Monitor closely for late-season pests and diseases`, `Prepare storage or processing facilities in advance`], tips: `Most crops signal readiness through color change, size, firmness, or aroma. Learn the specific harvest indicators for your crop — harvesting too early or too late both reduce quality.` },
      { week: 10, stage: "Harvest Preparation", activities: [`Perform final scout for pests, diseases, and fruit quality`, `Harvest a small sample to assess readiness`, `Prepare clean bins, baskets, or storage containers`, `Plan harvest for early morning when temperatures are coolest for best quality`], tips: `Harvesting in the cool early morning and cooling produce quickly preserves quality. Field heat is the primary driver of post-harvest quality loss for most vegetables and fruits.` },
      { week: 11, stage: "Main Harvest", activities: [`Harvest main crop at peak maturity`, `Handle produce carefully to minimize mechanical damage`, `Cool harvested crop immediately — refrigerate or store in a shaded, cool area`, `Process, preserve, or market the harvest promptly`], tips: `Most fresh produce has a very short window of peak quality. Plan harvest, transport, and storage to minimize the time from field to table or market.` },
      { week: 12, stage: "Post-Harvest & Soil Amendment", activities: [`Remove and compost crop residue`, `Apply soil amendments based on what the crop removed`, `Prepare for next crop — consider cover crops to protect and improve soil over winter`, `Note lessons learned from this season for next year`], tips: `Crop rotation (not planting the same crop family in the same spot for 2–3 years) is the most cost-effective pest and disease management strategy available.` },
    ],
  };
};

/**
 * Generate a realistic week-by-week crop timeline from the LLM prompt.
 * @param {string} prompt
 */
const buildCropTimeline = (prompt = "") => {
  // Extract crop name from "crop timeline for <cropName> starting from"
  const cropMatch = prompt.match(/crop timeline for (.+?) starting from/i);
  const cropRaw = cropMatch ? cropMatch[1].trim().toLowerCase() : "";

  // Extract planting date
  const dateMatch = prompt.match(/starting from (\d{4}-\d{2}-\d{2})/i);
  const plantingDateStr = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);
  const plantingDate = new Date(`${plantingDateStr}T12:00:00`);

  // Display name: preserve original casing from prompt
  const displayName = cropMatch
    ? cropMatch[1]
        .trim()
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    : cropRaw || "Crop";

  // Find best matching crop using word-boundary matching to avoid false positives
  const wordBoundaryMatch = (text, word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\s)${escaped}(?:\\s|s\\b|es\\b|$)`, "i");
    return re.test(text);
  };
  let cropData = null;
  for (const [, data] of Object.entries(CROP_KNOWLEDGE)) {
    if (data.aliases.some((alias) => wordBoundaryMatch(cropRaw, alias) || wordBoundaryMatch(alias, cropRaw))) {
      cropData = data;
      break;
    }
  }

  // If no crop matched, return a smart generic plan for the actual crop entered
  if (!cropData) {
    return buildGenericTimeline(displayName, plantingDate);
  }

  // Build flat week-by-week timeline from phases
  const timeline = [];
  for (const phase of cropData.phases) {
    for (const weekNum of phase.weeks) {
      timeline.push({
        week: weekNum,
        stage: phase.stage,
        activities: phase.activities,
        tips: phase.tips,
      });
    }
  }

  // Calculate expected harvest date
  const harvestDate = new Date(plantingDate);
  harvestDate.setDate(harvestDate.getDate() + cropData.weeks * 7);

  return {
    crop_name: displayName,
    total_weeks: cropData.weeks,
    expected_harvest_date: harvestDate.toISOString().slice(0, 10),
    timeline,
    watering_schedule: cropData.water,
    fertilizer_plan: cropData.fertilizer,
    soil_requirements: cropData.soil,
  };
};

export const appClient = {
  entities,

  integrations: {
    Core: {
      /**
       * Local-mode stub for InvokeLLM used across pages.
       * - If a JSON schema for weather exists → return weather-shaped object.
       * - Otherwise return a plain string.
       */
      async InvokeLLM(/** @type {any} */ { prompt = "", response_json_schema } = {}) {
        const p = String(prompt || "").toLowerCase();

        // Crop Planner requests expect a structured timeline object
        const looksLikeCropPlan =
          p.includes("crop timeline") ||
          p.includes("week-by-week crop") ||
          p.includes("crop plan") ||
          (response_json_schema?.properties?.timeline && response_json_schema?.properties?.total_weeks);

        if (looksLikeCropPlan) {
          return buildCropTimeline(prompt);
        }

        // Weather widgets expect structured object
        const looksLikeWeather =
          response_json_schema?.properties?.current ||
          p.includes("weather") ||
          p.includes("forecast") ||
          p.includes("real-time weather");

        if (looksLikeWeather) {
          const loc = "Your area";
          return demoWeather(loc);
        }

        // Chat and other pages expect a string
        return buildFarmAdvice(prompt);
      },

      /**
       * Local-mode upload: return blob URL for previews.
       */
      async UploadFile({ file }) {
        if (!file) throw new Error("No file provided");
        const file_url = URL.createObjectURL(file);
        return { file_url };
      },
    },
  },

  enterprise: {
    async listSessions(email) {
      const params = new URLSearchParams();
      if (email) params.set("email", email);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      return request(`/enterprise/sessions${suffix}`);
    },

    async logoutOtherDevices(email) {
      return request("/enterprise/sessions/logout-others", {
        method: "POST",
        body: { email },
      });
    },
  },

  auth: {
    async me() {
      return request("/auth/me");
    },

    async signInWithSocial(payload = {}) {
      return request("/auth/social", {
        method: "POST",
        body: payload,
        useCsrf: false,
      });
    },

    async signInWithEmail(payload = {}) {
      return request("/auth/login/email", {
        method: "POST",
        body: payload,
        useCsrf: false,
      });
    },

    async registerWithEmail(payload = {}) {
      return request("/auth/register/email", {
        method: "POST",
        body: payload,
        useCsrf: false,
      });
    },

    async requestPasswordReset(payload = {}) {
      return request("/auth/password-reset/request", {
        method: "POST",
        body: payload,
        useCsrf: false,
      });
    },

    async validateResetToken(token) {
      const params = new URLSearchParams();
      if (token) params.set("token", token);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      return request(`/auth/password-reset/validate${suffix}`, {
        useCsrf: false,
      });
    },

    async resetPassword(payload = {}) {
      return request("/auth/password-reset/complete", {
        method: "POST",
        body: payload,
        useCsrf: false,
      });
    },

    async updateMe(updateData = {}) {
      return request("/auth/me", {
        method: "PATCH",
        body: updateData,
      });
    },

    async changePassword(payload = {}) {
      return request("/auth/change-password", {
        method: "POST",
        body: payload,
      });
    },

    async logout(redirectTo) {
      await request("/auth/logout", {
        method: "POST",
      });
      if (redirectTo) window.location.href = redirectTo;
    },

    redirectToLogin(redirectTo) {
      const next = encodeURIComponent(redirectTo || window.location.href);
      window.location.href = `/login?next=${next}`;
    },
  },

  users: {
    async listUsers(limit = 200) {
      return request(`/users?limit=${encodeURIComponent(String(limit))}`);
    },

    async updateUser(userId, updates = {}) {
      return request(`/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: updates,
      });
    },

    async inviteUser(email) {
      return request("/users/invite", {
        method: "POST",
        body: { email },
      });
    },
  },

  security: {
    async listAuthEvents(limit = 100) {
      return request(`/security/auth-events?limit=${encodeURIComponent(String(limit))}`);
    },
  },

  ai: {
    async getFarmAdvice(prompt) {
      return request("/ai/farm-advice", {
        method: "POST",
        body: { prompt },
      });
    },

    async diagnosePlant(fileUrl) {
      return request("/ai/diagnose-plant", {
        method: "POST",
        body: { file_url: fileUrl },
      });
    },
  },
};
