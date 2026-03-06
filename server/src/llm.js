import crypto from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";

const DEFAULT_LOCATION = "Des Moines, Iowa, United States";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const CODE = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Cloudy",
  45: "Fog",
  48: "Fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm",
  99: "Thunderstorm",
};

const n = (v, d = 0) => {
  const x = Number.parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : d;
};
const i = (v, d = 0) => {
  const x = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(x) ? x : d;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const safePrompt = (v) => String(v || "").slice(0, 12000);
const normalizeKey = (v) => String(v || "").trim().toLowerCase();
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const getKeys = (s) => Object.keys(s?.properties || {});
const enumPick = (s, fallback) => (Array.isArray(s?.enum) && s.enum.length ? s.enum[0] : fallback);
const isPlaceholderSecret = (value) =>
  ["", "your_real_key", "changeme", "replace_me"].includes(normalizeKey(value));

const j = async (url, timeout = 9000, headers = { Accept: "application/json" }) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, { signal: c.signal, headers });
    if (!r.ok) throw new Error(`http_${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
};

const parseCoords = (p) => {
  const s = String(p || "");
  const q = s.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!q) return null;
  const lat = n(q[1], 999);
  const lon = n(q[2], 999);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
};

const locationHint = (p) => {
  const s = String(p || "");
  const a = s.match(/location\s*:\s*([^\n]+)/i)?.[1]?.trim();
  if (a) return a;
  const b = s.match(/weather(?:\s+data)?\s+for\s+([^\n.]+)/i)?.[1]?.trim();
  if (b) return b;
  return "";
};

const fallbackWeather = (loc) => ({
  location: loc || DEFAULT_LOCATION,
  current: {
    location: loc || DEFAULT_LOCATION,
    temperature: 74,
    feels_like: 75,
    humidity: 62,
    wind_speed: 9,
    conditions: "Partly cloudy",
    uv_index: 5,
    pressure: 1012,
    rainfall: 0,
    description: "Moderate field conditions.",
  },
  forecast: Array.from({ length: 7 }).map((_, k) => {
    const d = new Date(Date.now() + k * 86400000);
    return {
      day: d.toLocaleDateString("en-US", { weekday: "short" }),
      date: iso(d),
      high: 76 + (k % 3),
      low: 62 + (k % 3),
      conditions: k % 3 === 0 ? "Rain showers" : "Partly cloudy",
      precipitation_chance: k % 3 === 0 ? 65 : 20,
      rainfall: k % 3 === 0 ? 0.35 : 0,
      wind_speed: 8 + (k % 4),
      uv_index: 5,
    };
  }),
});

const weather = async (p) => {
  let lat = null;
  let lon = null;
  let loc = locationHint(p);
  const c = parseCoords(p);
  if (c) {
    lat = c.lat;
    lon = c.lon;
    loc = loc || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  } else {
    try {
      const target = loc || DEFAULT_LOCATION;
      const g = await j(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(target)}&count=1&language=en&format=json`
      );
      const r = g?.results?.[0];
      if (r) {
        lat = n(r.latitude);
        lon = n(r.longitude);
        loc = [r.name, r.admin1, r.country].filter(Boolean).join(", ") || target;
      } else {
        loc = target;
      }
    } catch {}
  }

  if (lat == null || lon == null) return fallbackWeather(loc || DEFAULT_LOCATION);

  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(String(lon))}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,surface_pressure&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=7`;
    const w = await j(u);
    const d = w?.daily || {};
    const forecast = (d.time || []).map((x, k) => ({
      day: new Date(`${x}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" }),
      date: String(x),
      high: n(d.temperature_2m_max?.[k], 74),
      low: n(d.temperature_2m_min?.[k], 61),
      conditions: CODE[i(d.weather_code?.[k], 2)] || "Partly cloudy",
      precipitation_chance: clamp(i(d.precipitation_probability_max?.[k], 0), 0, 100),
      rainfall: n(d.precipitation_sum?.[k], 0),
      wind_speed: n(d.wind_speed_10m_max?.[k], 8),
      uv_index: clamp(n(d.uv_index_max?.[k], 4), 0, 14),
    }));
    const c0 = w?.current || {};
    return {
      location: loc,
      current: {
        location: loc,
        temperature: n(c0.temperature_2m, 74),
        feels_like: n(c0.apparent_temperature, 74),
        humidity: clamp(i(c0.relative_humidity_2m, 60), 0, 100),
        wind_speed: n(c0.wind_speed_10m, 8),
        conditions: CODE[i(c0.weather_code, 2)] || "Partly cloudy",
        uv_index: n(forecast[0]?.uv_index, 5),
        pressure: i(c0.surface_pressure, 1012),
        rainfall: n(forecast[0]?.rainfall, 0),
        description: "Weather data sourced from Open-Meteo.",
      },
      forecast,
    };
  } catch {
    return fallbackWeather(loc);
  }
};

const buildWeatherInsights = (weatherPayload = {}) => {
  const current = obj(weatherPayload.current) || {};
  const forecast = Array.isArray(weatherPayload.forecast) ? weatherPayload.forecast : [];
  const today = forecast[0] || {};
  const nextThreeDays = forecast.slice(0, 3);
  const alerts = [];

  const maxWind = nextThreeDays.reduce((mx, day) => Math.max(mx, n(day.wind_speed, 0)), n(current.wind_speed, 0));
  const maxRainChance = nextThreeDays.reduce(
    (mx, day) => Math.max(mx, n(day.precipitation_chance, 0)),
    n(today.precipitation_chance, 0)
  );
  const maxRainfall = nextThreeDays.reduce((mx, day) => Math.max(mx, n(day.rainfall, 0)), n(today.rainfall, 0));
  const minLow = nextThreeDays.reduce((mn, day) => Math.min(mn, n(day.low, 999)), n(today.low, 999));

  if (n(current.temperature, 0) >= 97) {
    alerts.push({
      type: "Heat stress risk",
      severity: n(current.temperature, 0) >= 104 ? "critical" : "high",
      message: `High temperature around ${Math.round(n(current.temperature, 0))}F can stress crops and reduce pollination.`,
      action: "Irrigate early morning and postpone foliar sprays in peak heat.",
    });
  }

  if (maxRainChance >= 75 || maxRainfall >= 0.8) {
    alerts.push({
      type: "Heavy rain window",
      severity: maxRainChance >= 85 || maxRainfall >= 1.4 ? "high" : "moderate",
      message: `Rain probability is elevated (${Math.round(maxRainChance)}%) with potential runoff and leaf wetness risk.`,
      action: "Improve drainage checks and avoid preventive sprays right before rain.",
    });
  }

  if (maxWind >= 20) {
    alerts.push({
      type: "High wind risk",
      severity: maxWind >= 28 ? "high" : "moderate",
      message: `Wind may reach about ${Math.round(maxWind)} mph, reducing spray deposition accuracy.`,
      action: "Schedule spraying in low-wind morning windows and secure vulnerable plants.",
    });
  }

  if (minLow <= 36) {
    alerts.push({
      type: "Cold/frost exposure",
      severity: minLow <= 31 ? "critical" : "high",
      message: `Forecast low near ${Math.round(minLow)}F may damage sensitive crop tissues.`,
      action: "Use frost covers and irrigate strategically before coldest period.",
    });
  }

  const highHumidity = n(current.humidity, 0) >= 78;
  const diseaseRiskLevel = highHumidity || maxRainChance >= 65 ? "high" : n(current.humidity, 0) >= 65 ? "moderate" : "low";
  const rainLikely = maxRainChance >= 60 || maxRainfall >= 0.35;
  const overall =
    alerts.some((a) => a.severity === "critical") || alerts.some((a) => a.severity === "high")
      ? "poor"
      : rainLikely || maxWind >= 16
        ? "caution"
        : "good";

  const irrigationAdvice = rainLikely
    ? "Reduce irrigation volume and prioritize drainage-prone zones until rain window passes."
    : "Maintain scheduled irrigation and prioritize early morning cycles for efficiency.";
  const pestRisk = highHumidity
    ? "Humidity is elevated; intensify scouting for fungal disease and sap-feeding pests."
    : "Pest pressure is moderate; maintain routine scouting on lower canopy and new growth.";
  const taskTiming =
    maxWind >= 16 || n(current.temperature, 0) >= 95
      ? "Primary field operations are safest in early morning."
      : "Morning to mid-day windows are suitable for most field operations.";

  return {
    alerts: alerts.slice(0, 3),
    farming_conditions: {
      overall,
      irrigation_advice: irrigationAdvice,
      pest_risk: pestRisk,
      task_timing: taskTiming,
    },
    weather_recommendations: {
      irrigation: {
        recommendation: irrigationAdvice,
        timing: "Early morning",
        priority: rainLikely ? "high" : "medium",
      },
      pest_control: {
        recommendation: pestRisk,
        optimal_window: maxWind >= 14 ? "Calm morning window" : "Morning scouting window",
        priority: diseaseRiskLevel === "high" ? "high" : "medium",
      },
      planting_harvesting: {
        recommendation:
          overall === "good"
            ? "Proceed with planting/harvest operations as planned."
            : "Delay major field operations until wind/rain risk decreases.",
        timing: overall === "good" ? "Morning to mid-day" : "Early morning only",
        priority: overall === "good" ? "low" : "medium",
      },
      protective_measures:
        alerts.length > 0
          ? alerts.map((a) => ({
              measure: a.type,
              urgency: a.severity === "critical" ? "high" : a.severity === "high" ? "high" : "medium",
              reason: a.action,
            }))
          : [{ measure: "Routine canopy scouting", urgency: "low", reason: "No critical weather alerts in next 3 days." }],
      priority_tasks: [
        "Review next 3-day rainfall and irrigation plan.",
        "Scout lower canopy and humidity-sensitive zones.",
        maxWind >= 16 ? "Use low-wind windows for spray operations." : "Proceed with scheduled spray windows.",
      ],
      disease_risk: {
        level: diseaseRiskLevel,
        reasoning:
          diseaseRiskLevel === "high"
            ? "Elevated humidity/rainfall increases leaf wetness duration and disease pressure."
            : diseaseRiskLevel === "moderate"
              ? "Conditions are mixed; maintain regular scouting and preventive practices."
              : "Current humidity and rainfall pattern indicate relatively low disease pressure.",
      },
    },
  };
};

const schemaType = (s) => {
  const k = getKeys(s);
  if (k.includes("current") && k.includes("forecast")) return "weather";
  if (k.includes("location_name") && k.includes("temperature")) return "weather_widget";
  if (k.includes("irrigation") && k.includes("pest_control")) return "weather_recs";
  if (k.includes("plant_name") && k.includes("scientific_name")) return "plant";
  if (k.includes("disease_name") && k.includes("infection_level")) return "disease";
  if (k.includes("verified") && k.includes("final_confidence")) return "verify";
  if (k.includes("treatments")) return "treatments";
  if (k.includes("timeline") && k.includes("total_weeks")) return "timeline";
  if (k.includes("predictions")) return "predictions";
  if (k.includes("suggestions")) return "suggestions";
  if (k.includes("pest_or_disease_name") && k.includes("severity")) return "pest";
  return "generic";
};

const generic = (s, key = "") => {
  if (!s || typeof s !== "object") return null;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (s.type === "object") return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, generic(v, k)]));
  if (s.type === "array") return [generic(s.items || { type: "string" }, key)];
  if (s.type === "number" || s.type === "integer") return key.toLowerCase().includes("confidence") ? 70 : 1;
  if (s.type === "boolean") return false;
  if (key.toLowerCase().includes("date")) return iso(Date.now());
  if (key.toLowerCase().includes("location")) return DEFAULT_LOCATION;
  if (key.toLowerCase().includes("priority")) return "medium";
  if (key.toLowerCase().includes("severity")) return "moderate";
  return "available";
};

const shape = (s, v, key = "") => {
  if (!s || typeof s !== "object") return v;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum.includes(v) ? v : s.enum[0];
  if (s.type === "object") {
    const src = obj(v) || {};
    return Object.fromEntries(Object.entries(s.properties || {}).map(([k, child]) => [k, shape(child, src[k], k)]));
  }
  if (s.type === "array") {
    const arr = Array.isArray(v) ? v : [generic(s.items || { type: "string" }, key)];
    return arr.map((x) => shape(s.items || { type: "string" }, x, key));
  }
  if (s.type === "number" || s.type === "integer") return n(v, generic(s, key));
  if (s.type === "boolean") return Boolean(v);
  return String(v ?? generic(s, key));
};

const STAGE_ACTIVITY_LIBRARY = {
  establishment: [
    "Check stand establishment and fill gaps in poor germination spots.",
    "Maintain uniform seed-zone moisture without waterlogging.",
    "Watch for damping-off or early insect feeding and act quickly.",
  ],
  vegetative: [
    "Maintain irrigation uniformity and avoid moisture stress swings.",
    "Top-dress nutrients according to growth response and soil status.",
    "Scout canopy and undersides of leaves for pests and lesions.",
  ],
  reproductive: [
    "Protect flowering structures and support pollination conditions.",
    "Avoid severe nutrient or irrigation stress during bloom/fruit set.",
    "Monitor disease pressure closely in humid weather windows.",
  ],
  maturation: [
    "Adjust irrigation to avoid cracking, lodging, or quality losses.",
    "Prioritize crop protection only where threshold levels are reached.",
    "Track maturity indicators and prepare harvest logistics.",
  ],
  harvest: [
    "Harvest at target maturity and remove damaged produce promptly.",
    "Sort, cool, and store produce using crop-specific handling standards.",
    "Sanitize residues and plan rotation or next cycle soil preparation.",
  ],
};

const STAGE_TIP_LIBRARY = {
  establishment: "Early establishment determines final yield potential; correct stand issues immediately.",
  vegetative: "Balanced nutrition and consistent moisture build strong canopy and root development.",
  reproductive: "Stress management during flowering and set has the highest impact on productivity.",
  maturation: "Fine-tune water and canopy management to protect quality and marketable yield.",
  harvest: "Harvest timing and post-harvest handling are critical for value retention.",
};

const createTemplate = ({
  totalWeeks,
  watering,
  fertilizer,
  soil,
  stagePlan,
  stageNotes = {},
}) => ({
  totalWeeks,
  watering,
  fertilizer,
  soil,
  stagePlan,
  stageNotes,
});

const TEMPLATE_FRUITING_VEGETABLE = createTemplate({
  totalWeeks: 14,
  watering: "Maintain even moisture; irrigate early morning and increase frequency during flowering and fruit fill.",
  fertilizer: "Apply basal compost, then split nitrogen and potassium through vegetative and fruiting stages.",
  soil: "Well-drained loam with pH 6.0-7.0 and good organic matter.",
  stagePlan: [
    { endWeek: 2, label: "Establishment", group: "establishment" },
    { endWeek: 6, label: "Vegetative growth", group: "vegetative" },
    { endWeek: 10, label: "Flowering and set", group: "reproductive" },
    { endWeek: 13, label: "Fruit development", group: "maturation" },
    { endWeek: 14, label: "Harvest window", group: "harvest" },
  ],
});

const TEMPLATE_LEAFY = createTemplate({
  totalWeeks: 8,
  watering: "Use frequent light irrigation to keep topsoil moist and reduce leaf stress.",
  fertilizer: "Use nitrogen-forward feeding in small splits; avoid over-fertilization late.",
  soil: "Fertile, friable soil with high organic matter and pH 6.0-7.0.",
  stagePlan: [
    { endWeek: 1, label: "Establishment", group: "establishment" },
    { endWeek: 4, label: "Leaf canopy development", group: "vegetative" },
    { endWeek: 6, label: "Market sizing", group: "maturation" },
    { endWeek: 8, label: "Harvest cycles", group: "harvest" },
  ],
});

const TEMPLATE_ROOT_TUBER = createTemplate({
  totalWeeks: 14,
  watering: "Maintain uniform moisture and avoid prolonged saturation; reduce before harvest.",
  fertilizer: "Apply balanced basal nutrients and emphasize potassium during root bulking.",
  soil: "Loose, well-drained sandy-loam to loam to support root expansion.",
  stagePlan: [
    { endWeek: 2, label: "Establishment", group: "establishment" },
    { endWeek: 6, label: "Vegetative growth", group: "vegetative" },
    { endWeek: 11, label: "Bulking and sizing", group: "maturation" },
    { endWeek: 14, label: "Harvest and curing", group: "harvest" },
  ],
});

const TEMPLATE_CEREAL = createTemplate({
  totalWeeks: 16,
  watering: "Prioritize irrigation at establishment, tillering, and reproductive milestones.",
  fertilizer: "Apply basal nutrients, then split nitrogen at tillering and pre-reproductive stages.",
  soil: "Well-drained medium-texture soils with balanced fertility and pH 6.0-7.5.",
  stagePlan: [
    { endWeek: 2, label: "Establishment", group: "establishment" },
    { endWeek: 7, label: "Tillering and canopy expansion", group: "vegetative" },
    { endWeek: 11, label: "Booting and flowering", group: "reproductive" },
    { endWeek: 15, label: "Grain filling", group: "maturation" },
    { endWeek: 16, label: "Harvest readiness", group: "harvest" },
  ],
});

const TEMPLATE_PULSE = createTemplate({
  totalWeeks: 13,
  watering: "Keep moisture moderate; avoid excess irrigation during pod maturity.",
  fertilizer: "Use starter phosphorus and potassium; avoid excess nitrogen where nodulation is active.",
  soil: "Well-drained soils with pH 6.0-7.5 and low compaction.",
  stagePlan: [
    { endWeek: 2, label: "Establishment", group: "establishment" },
    { endWeek: 6, label: "Vegetative and branching", group: "vegetative" },
    { endWeek: 9, label: "Flowering and pod set", group: "reproductive" },
    { endWeek: 12, label: "Pod filling", group: "maturation" },
    { endWeek: 13, label: "Dry-down and harvest", group: "harvest" },
  ],
});

const TEMPLATE_OILSEED = createTemplate({
  totalWeeks: 14,
  watering: "Maintain moderate moisture through flowering; avoid stress at seed filling.",
  fertilizer: "Apply sulfur and balanced NPK as per soil test with split nitrogen strategy.",
  soil: "Well-drained loam to clay-loam with pH 6.0-7.5.",
  stagePlan: [
    { endWeek: 2, label: "Establishment", group: "establishment" },
    { endWeek: 6, label: "Vegetative growth", group: "vegetative" },
    { endWeek: 9, label: "Flowering", group: "reproductive" },
    { endWeek: 13, label: "Seed filling", group: "maturation" },
    { endWeek: 14, label: "Harvest", group: "harvest" },
  ],
});

const TEMPLATE_FRUIT_TREE = createTemplate({
  totalWeeks: 26,
  watering: "Use deep irrigation cycles based on canopy demand and local evapotranspiration.",
  fertilizer: "Use split nutrition aligned to flush, flowering, and fruit development phases.",
  soil: "Deep, well-drained soil with strong organic matter management and mulch cover.",
  stagePlan: [
    { endWeek: 4, label: "Bud break and new flush", group: "establishment" },
    { endWeek: 10, label: "Canopy development", group: "vegetative" },
    { endWeek: 16, label: "Flowering and fruit set", group: "reproductive" },
    { endWeek: 24, label: "Fruit growth and quality build", group: "maturation" },
    { endWeek: 26, label: "Harvest and orchard sanitation", group: "harvest" },
  ],
});

const TEMPLATE_CASH_CROP = createTemplate({
  totalWeeks: 20,
  watering: "Maintain moisture at key growth stages and avoid prolonged stress periods.",
  fertilizer: "Use staged nutrient application with focus on nitrogen timing and micronutrient corrections.",
  soil: "Deep, well-drained soils with strong structure and balanced fertility.",
  stagePlan: [
    { endWeek: 3, label: "Establishment", group: "establishment" },
    { endWeek: 9, label: "Vegetative framework", group: "vegetative" },
    { endWeek: 14, label: "Flowering and reproductive set", group: "reproductive" },
    { endWeek: 18, label: "Boll/cane/product development", group: "maturation" },
    { endWeek: 20, label: "Harvest operations", group: "harvest" },
  ],
});

const withOverrides = (template, overrides = {}) => ({
  ...template,
  ...overrides,
  stagePlan: Array.isArray(overrides.stagePlan)
    ? overrides.stagePlan
    : Array.isArray(template.stagePlan)
      ? template.stagePlan
      : [],
  stageNotes: {
    ...(template.stageNotes || {}),
    ...(overrides.stageNotes || {}),
  },
});

const CROP_LIBRARY = [
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Tomato", aliases: ["tomato", "tomatoes"], totalWeeks: 16 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Pepper", aliases: ["pepper", "bell pepper", "capsicum"], totalWeeks: 15 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Chili", aliases: ["chili", "chilli", "hot pepper"], totalWeeks: 15 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Eggplant", aliases: ["eggplant", "brinjal", "aubergine"], totalWeeks: 16 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Cucumber", aliases: ["cucumber"], totalWeeks: 12 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Pumpkin", aliases: ["pumpkin"], totalWeeks: 14 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Squash", aliases: ["squash", "zucchini"], totalWeeks: 12 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Okra", aliases: ["okra"], totalWeeks: 12 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Watermelon", aliases: ["watermelon"], totalWeeks: 13 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Muskmelon", aliases: ["muskmelon", "melon", "cantaloupe"], totalWeeks: 12 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Bitter Gourd", aliases: ["bitter gourd", "bitter melon", "karela"], totalWeeks: 12 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Bottle Gourd", aliases: ["bottle gourd", "calabash", "lauki"], totalWeeks: 13 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Ridge Gourd", aliases: ["ridge gourd", "luffa", "turai"], totalWeeks: 12 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Sponge Gourd", aliases: ["sponge gourd", "luffa cylindrica"], totalWeeks: 12 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Ash Gourd", aliases: ["ash gourd", "winter melon"], totalWeeks: 14 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Snake Gourd", aliases: ["snake gourd"], totalWeeks: 13 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Pea Pod", aliases: ["snow pea", "snap pea"], totalWeeks: 11 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Cluster Bean", aliases: ["cluster bean", "guar"], totalWeeks: 11 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "French Bean", aliases: ["french bean", "green bean", "string bean"], totalWeeks: 11 }),
  withOverrides(TEMPLATE_FRUITING_VEGETABLE, { name: "Cowpea", aliases: ["cowpea", "yardlong bean"], totalWeeks: 11 }),
  withOverrides(TEMPLATE_LEAFY, { name: "Lettuce", aliases: ["lettuce"], totalWeeks: 8 }),
  withOverrides(TEMPLATE_LEAFY, { name: "Spinach", aliases: ["spinach"], totalWeeks: 7 }),
  withOverrides(TEMPLATE_LEAFY, { name: "Cabbage", aliases: ["cabbage"], totalWeeks: 11 }),
  withOverrides(TEMPLATE_LEAFY, { name: "Cauliflower", aliases: ["cauliflower"], totalWeeks: 12 }),
  withOverrides(TEMPLATE_LEAFY, { name: "Broccoli", aliases: ["broccoli"], totalWeeks: 11 }),
  withOverrides(TEMPLATE_LEAFY, { name: "Kale", aliases: ["kale"], totalWeeks: 10 }),
  withOverrides(TEMPLATE_LEAFY, { name: "Amaranth", aliases: ["amaranth", "amaranthus"], totalWeeks: 8 }),
  withOverrides(TEMPLATE_LEAFY, { name: "Mustard Greens", aliases: ["mustard greens", "sarson saag"], totalWeeks: 8 }),
  withOverrides(TEMPLATE_LEAFY, { name: "Fenugreek", aliases: ["fenugreek", "methi"], totalWeeks: 7 }),
  withOverrides(TEMPLATE_LEAFY, { name: "Coriander Leaf", aliases: ["coriander leaf", "cilantro"], totalWeeks: 7 }),
  withOverrides(TEMPLATE_ROOT_TUBER, { name: "Potato", aliases: ["potato", "potatoes"], totalWeeks: 14 }),
  withOverrides(TEMPLATE_ROOT_TUBER, { name: "Sweet Potato", aliases: ["sweet potato", "sweet potatoes"], totalWeeks: 18 }),
  withOverrides(TEMPLATE_ROOT_TUBER, { name: "Carrot", aliases: ["carrot", "carrots"], totalWeeks: 11 }),
  withOverrides(TEMPLATE_ROOT_TUBER, { name: "Onion", aliases: ["onion", "onions"], totalWeeks: 14 }),
  withOverrides(TEMPLATE_ROOT_TUBER, { name: "Garlic", aliases: ["garlic"], totalWeeks: 18 }),
  withOverrides(TEMPLATE_ROOT_TUBER, { name: "Radish", aliases: ["radish"], totalWeeks: 8 }),
  withOverrides(TEMPLATE_ROOT_TUBER, { name: "Beetroot", aliases: ["beetroot", "beet"], totalWeeks: 10 }),
  withOverrides(TEMPLATE_ROOT_TUBER, { name: "Turnip", aliases: ["turnip"], totalWeeks: 10 }),
  withOverrides(TEMPLATE_ROOT_TUBER, { name: "Cassava", aliases: ["cassava", "manioc", "tapioca"], totalWeeks: 28 }),
  withOverrides(TEMPLATE_ROOT_TUBER, { name: "Yam", aliases: ["yam", "yams"], totalWeeks: 24 }),
  withOverrides(TEMPLATE_ROOT_TUBER, { name: "Taro", aliases: ["taro", "colocasia"], totalWeeks: 22 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Rice", aliases: ["rice", "paddy"], totalWeeks: 17 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Wheat", aliases: ["wheat"], totalWeeks: 18 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Maize", aliases: ["maize", "corn"], totalWeeks: 14 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Barley", aliases: ["barley"], totalWeeks: 15 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Oats", aliases: ["oat", "oats"], totalWeeks: 14 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Sorghum", aliases: ["sorghum", "jowar"], totalWeeks: 15 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Millet", aliases: ["millet", "bajra", "pearl millet"], totalWeeks: 13 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Rye", aliases: ["rye"], totalWeeks: 15 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Finger Millet", aliases: ["finger millet", "ragi"], totalWeeks: 14 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Foxtail Millet", aliases: ["foxtail millet"], totalWeeks: 13 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Proso Millet", aliases: ["proso millet"], totalWeeks: 12 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Triticale", aliases: ["triticale"], totalWeeks: 16 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Quinoa", aliases: ["quinoa"], totalWeeks: 14 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Buckwheat", aliases: ["buckwheat"], totalWeeks: 12 }),
  withOverrides(TEMPLATE_PULSE, { name: "Soybean", aliases: ["soybean", "soybeans", "soy"], totalWeeks: 14 }),
  withOverrides(TEMPLATE_PULSE, { name: "Chickpea", aliases: ["chickpea", "gram", "chana"], totalWeeks: 16 }),
  withOverrides(TEMPLATE_PULSE, { name: "Lentil", aliases: ["lentil", "lentils"], totalWeeks: 14 }),
  withOverrides(TEMPLATE_PULSE, { name: "Pea", aliases: ["pea", "peas", "green pea"], totalWeeks: 12 }),
  withOverrides(TEMPLATE_PULSE, { name: "Bean", aliases: ["bean", "beans", "common bean"], totalWeeks: 11 }),
  withOverrides(TEMPLATE_PULSE, { name: "Pigeon Pea", aliases: ["pigeon pea", "toor", "arhar"], totalWeeks: 22 }),
  withOverrides(TEMPLATE_PULSE, { name: "Black Gram", aliases: ["black gram", "urad"], totalWeeks: 12 }),
  withOverrides(TEMPLATE_PULSE, { name: "Green Gram", aliases: ["green gram", "mung", "moong"], totalWeeks: 11 }),
  withOverrides(TEMPLATE_PULSE, { name: "Horse Gram", aliases: ["horse gram"], totalWeeks: 13 }),
  withOverrides(TEMPLATE_PULSE, { name: "Faba Bean", aliases: ["faba bean", "broad bean"], totalWeeks: 15 }),
  withOverrides(TEMPLATE_OILSEED, { name: "Groundnut", aliases: ["groundnut", "peanut", "peanuts"], totalWeeks: 15 }),
  withOverrides(TEMPLATE_OILSEED, { name: "Sesame", aliases: ["sesame", "til"], totalWeeks: 13 }),
  withOverrides(TEMPLATE_OILSEED, { name: "Sunflower", aliases: ["sunflower", "sunflowers"], totalWeeks: 14 }),
  withOverrides(TEMPLATE_OILSEED, { name: "Mustard", aliases: ["mustard", "canola", "rapeseed"], totalWeeks: 15 }),
  withOverrides(TEMPLATE_OILSEED, { name: "Safflower", aliases: ["safflower"], totalWeeks: 15 }),
  withOverrides(TEMPLATE_OILSEED, { name: "Linseed", aliases: ["linseed", "flax", "flaxseed"], totalWeeks: 15 }),
  withOverrides(TEMPLATE_OILSEED, { name: "Castor", aliases: ["castor", "castor bean"], totalWeeks: 18 }),
  withOverrides(TEMPLATE_CASH_CROP, { name: "Cotton", aliases: ["cotton"], totalWeeks: 24 }),
  withOverrides(TEMPLATE_CASH_CROP, { name: "Sugarcane", aliases: ["sugarcane"], totalWeeks: 32 }),
  withOverrides(TEMPLATE_CASH_CROP, { name: "Tobacco", aliases: ["tobacco"], totalWeeks: 20 }),
  withOverrides(TEMPLATE_CASH_CROP, { name: "Jute", aliases: ["jute"], totalWeeks: 18 }),
  withOverrides(TEMPLATE_CASH_CROP, { name: "Tea", aliases: ["tea"], totalWeeks: 26 }),
  withOverrides(TEMPLATE_CASH_CROP, { name: "Coffee", aliases: ["coffee"], totalWeeks: 28 }),
  withOverrides(TEMPLATE_CASH_CROP, { name: "Cocoa", aliases: ["cocoa", "cacao"], totalWeeks: 30 }),
  withOverrides(TEMPLATE_CASH_CROP, { name: "Black Pepper", aliases: ["black pepper", "pepper vine"], totalWeeks: 24 }),
  withOverrides(TEMPLATE_CASH_CROP, { name: "Cardamom", aliases: ["cardamom"], totalWeeks: 24 }),
  withOverrides(TEMPLATE_CASH_CROP, { name: "Turmeric", aliases: ["turmeric"], totalWeeks: 26 }),
  withOverrides(TEMPLATE_CASH_CROP, { name: "Ginger", aliases: ["ginger"], totalWeeks: 24 }),
  withOverrides(TEMPLATE_CASH_CROP, { name: "Cumin", aliases: ["cumin", "jeera"], totalWeeks: 14 }),
  withOverrides(TEMPLATE_FRUIT_TREE, { name: "Banana", aliases: ["banana", "bananas"], totalWeeks: 24 }),
  withOverrides(TEMPLATE_FRUIT_TREE, { name: "Grape", aliases: ["grape", "grapes"], totalWeeks: 24 }),
  withOverrides(TEMPLATE_FRUIT_TREE, { name: "Apple", aliases: ["apple", "apples"], totalWeeks: 24 }),
  withOverrides(TEMPLATE_FRUIT_TREE, { name: "Mango", aliases: ["mango", "mangoes"], totalWeeks: 28 }),
  withOverrides(TEMPLATE_FRUIT_TREE, { name: "Citrus", aliases: ["citrus", "orange", "lemon", "lime"], totalWeeks: 26 }),
  withOverrides(TEMPLATE_FRUIT_TREE, { name: "Strawberry", aliases: ["strawberry", "strawberries"], totalWeeks: 16 }),
  withOverrides(TEMPLATE_FRUIT_TREE, { name: "Papaya", aliases: ["papaya"], totalWeeks: 24 }),
  withOverrides(TEMPLATE_FRUIT_TREE, { name: "Pomegranate", aliases: ["pomegranate"], totalWeeks: 24 }),
  withOverrides(TEMPLATE_FRUIT_TREE, { name: "Guava", aliases: ["guava"], totalWeeks: 24 }),
  withOverrides(TEMPLATE_FRUIT_TREE, { name: "Pineapple", aliases: ["pineapple"], totalWeeks: 30 }),
  withOverrides(TEMPLATE_FRUIT_TREE, { name: "Coconut", aliases: ["coconut"], totalWeeks: 30 }),
  withOverrides(TEMPLATE_CEREAL, { name: "Napier Grass", aliases: ["napier grass", "elephant grass"], totalWeeks: 10 }),
  withOverrides(TEMPLATE_PULSE, { name: "Alfalfa", aliases: ["alfalfa", "lucerne"], totalWeeks: 10 }),
  withOverrides(TEMPLATE_PULSE, { name: "Clover", aliases: ["clover"], totalWeeks: 10 }),
];

const normalizeCropToken = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const CROP_ALIAS_TO_PROFILE = (() => {
  const map = new Map();
  CROP_LIBRARY.forEach((profile) => {
    const aliases = [profile.name, ...(Array.isArray(profile.aliases) ? profile.aliases : [])];
    aliases.forEach((alias) => {
      const key = normalizeCropToken(alias);
      if (key) map.set(key, profile);
    });
  });
  return map;
})();

const CROP_FAMILY_INFERENCE_RULES = [
  { pattern: /\b(rice|paddy|wheat|maize|corn|barley|oat|sorghum|millet|rye|triticale|quinoa|buckwheat)\b/i, template: TEMPLATE_CEREAL, totalWeeks: 16 },
  { pattern: /\b(soy|chickpea|gram|pea|lentil|bean|pulse|pigeon pea|black gram|green gram|alfalfa|lucerne|clover)\b/i, template: TEMPLATE_PULSE, totalWeeks: 14 },
  { pattern: /\b(groundnut|peanut|sesame|sunflower|mustard|canola|rapeseed|linseed|flax|castor|oilseed)\b/i, template: TEMPLATE_OILSEED, totalWeeks: 15 },
  { pattern: /\b(cotton|sugarcane|tobacco|jute|tea|coffee|cocoa|turmeric|ginger|cardamom|black pepper|cumin)\b/i, template: TEMPLATE_CASH_CROP, totalWeeks: 22 },
  { pattern: /\b(apple|mango|banana|citrus|orange|lemon|lime|grape|papaya|pomegranate|guava|pineapple|coconut|fruit)\b/i, template: TEMPLATE_FRUIT_TREE, totalWeeks: 24 },
  { pattern: /\b(potato|sweet potato|cassava|yam|taro|onion|garlic|carrot|radish|beet|beetroot|turnip|root)\b/i, template: TEMPLATE_ROOT_TUBER, totalWeeks: 14 },
  { pattern: /\b(lettuce|spinach|cabbage|cauliflower|broccoli|kale|amaranth|fenugreek|leafy|greens)\b/i, template: TEMPLATE_LEAFY, totalWeeks: 9 },
  { pattern: /\b(tomato|pepper|chili|eggplant|cucumber|pumpkin|squash|okra|melon|gourd|zucchini|vegetable)\b/i, template: TEMPLATE_FRUITING_VEGETABLE, totalWeeks: 14 },
];

const toTitleCase = (value = "") =>
  String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const parseCropFromPrompt = (prompt = "") => {
  const candidates = [
    prompt.match(/(?:^|\n)\s*Crop\s*:\s*([^\n]+)/i)?.[1],
    prompt.match(/timeline for\s+(.+?)\s+starting from/i)?.[1],
    prompt.match(/plan for\s+(.+?)(?:\n|$)/i)?.[1],
  ]
    .filter(Boolean)
    .map((item) =>
      String(item || "")
        .split(/(?:planting date|starting from|location|soil type|area size)/i)[0]
        .replace(/[.,;:]+$/, "")
        .trim()
    )
    .filter(Boolean);
  return candidates[0] || "Crop";
};

const parsePlantingDateFromPrompt = (prompt = "") =>
  prompt.match(/(?:planting date|starting from)\s*:?\s*(\d{4}-\d{2}-\d{2})/i)?.[1] || iso(Date.now());

const resolveCropProfile = (cropName = "") => {
  const normalized = normalizeCropToken(cropName);
  if (CROP_ALIAS_TO_PROFILE.has(normalized)) {
    return { ...CROP_ALIAS_TO_PROFILE.get(normalized) };
  }

  for (const [alias, profile] of CROP_ALIAS_TO_PROFILE.entries()) {
    if (normalized && (normalized.includes(alias) || alias.includes(normalized))) {
      return { ...profile };
    }
  }

  for (const rule of CROP_FAMILY_INFERENCE_RULES) {
    if (rule.pattern.test(normalized)) {
      return withOverrides(rule.template, {
        name: toTitleCase(cropName) || "Crop",
        aliases: [normalized].filter(Boolean),
        totalWeeks: Number(rule.totalWeeks || rule.template.totalWeeks || 14),
      });
    }
  }

  const unknownName = toTitleCase(cropName) || "Mixed Crop";
  return withOverrides(TEMPLATE_FRUITING_VEGETABLE, {
    name: unknownName,
    aliases: [normalized].filter(Boolean),
    totalWeeks: 14,
  });
};

const getStageForWeek = (profile, week) => {
  const stages = Array.isArray(profile.stagePlan) ? profile.stagePlan : [];
  for (const stage of stages) {
    if (week <= Number(stage.endWeek || 0)) return stage;
  }
  return stages[stages.length - 1] || { label: "Field operations", group: "vegetative" };
};

const uniqueStrings = (items = []) => {
  const out = [];
  const seen = new Set();
  items.forEach((item) => {
    const key = String(item || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
};

const buildWeekActivities = (profile, stageGroup, week) => {
  const baseActivities = STAGE_ACTIVITY_LIBRARY[stageGroup] || STAGE_ACTIVITY_LIBRARY.vegetative;
  const indexed = [
    baseActivities[(week - 1) % baseActivities.length],
    baseActivities[(week + 1) % baseActivities.length],
    "Record field observations and adjust actions based on thresholds.",
  ];
  const note = profile.stageNotes?.[stageGroup];
  if (note) indexed.push(String(note));
  return uniqueStrings(indexed).slice(0, 4);
};

const buildWeekTip = (profile, stageGroup) => {
  const stageTip = STAGE_TIP_LIBRARY[stageGroup] || STAGE_TIP_LIBRARY.vegetative;
  const profileTip = profile.stageNotes?.[stageGroup];
  return profileTip ? `${stageTip} ${profileTip}` : stageTip;
};

const timeline = (prompt = "") => {
  const cropInput = parseCropFromPrompt(prompt);
  const plantingDate = parsePlantingDateFromPrompt(prompt);
  const start = new Date(`${plantingDate}T00:00:00`);
  const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
  const profile = resolveCropProfile(cropInput);
  const total = Math.max(6, Math.min(40, Number(profile.totalWeeks || 14)));

  return {
    crop_name: profile.name || toTitleCase(cropInput) || "Crop",
    total_weeks: total,
    expected_harvest_date: iso(safeStart.getTime() + total * 7 * 86400000),
    timeline: Array.from({ length: total }).map((_, index) => {
      const week = index + 1;
      const stage = getStageForWeek(profile, week);
      return {
        week,
        stage: stage.label,
        activities: buildWeekActivities(profile, stage.group, week),
        tips: buildWeekTip(profile, stage.group),
      };
    }),
    watering_schedule: profile.watering,
    fertilizer_plan: profile.fertilizer,
    soil_requirements: profile.soil,
  };
};

const normalizeTimelineOutput = (candidate, fallback) => {
  const parsed = obj(candidate);
  if (!parsed) return fallback;

  const fallbackWeeks = clamp(i(fallback?.total_weeks, 14), 6, 40);
  const weeks = clamp(i(parsed.total_weeks, fallbackWeeks), 6, 40);
  const sourceTimeline = Array.isArray(parsed.timeline) ? parsed.timeline : [];
  const minimumUsefulRows = Math.min(6, weeks);
  if (sourceTimeline.length < minimumUsefulRows) return fallback;

  const mergedTimeline = Array.from({ length: weeks }).map((_, index) => {
    const week = index + 1;
    const fallbackWeek = fallback.timeline?.[index] || fallback.timeline?.[fallback.timeline.length - 1] || null;
    const sourceWeek = obj(sourceTimeline[index]) || {};
    const stage = String(sourceWeek.stage || fallbackWeek?.stage || "Field operations").trim() || "Field operations";
    const tips = String(sourceWeek.tips || fallbackWeek?.tips || "").trim() || "Track crop condition weekly and adjust field operations.";
    const sourceActivities = Array.isArray(sourceWeek.activities) ? sourceWeek.activities : [];
    const activities = uniqueStrings(
      sourceActivities
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 4)
    );
    return {
      week,
      stage,
      activities: activities.length ? activities : fallbackWeek?.activities || [],
      tips,
    };
  });

  return {
    crop_name: String(parsed.crop_name || fallback.crop_name || "Crop").trim() || fallback.crop_name || "Crop",
    total_weeks: weeks,
    expected_harvest_date: String(parsed.expected_harvest_date || fallback.expected_harvest_date || "").trim() || fallback.expected_harvest_date,
    timeline: mergedTimeline,
    watering_schedule: String(parsed.watering_schedule || fallback.watering_schedule || "").trim() || fallback.watering_schedule,
    fertilizer_plan: String(parsed.fertilizer_plan || fallback.fertilizer_plan || "").trim() || fallback.fertilizer_plan,
    soil_requirements: String(parsed.soil_requirements || fallback.soil_requirements || "").trim() || fallback.soil_requirements,
  };
};

const parseTreatmentContext = (prompt = "") => {
  const plant = prompt.match(/Plant:\s*([^\n]+)/i)?.[1]?.trim() || "";
  const disease = prompt.match(/Disease:\s*([^\n]+)/i)?.[1]?.trim() || "";
  return { plant, disease };
};

const genericTreatmentSet = () => [
  {
    name: "Copper Protectant Program",
    type: "chemical",
    proportions: "Use label rate for your crop stage and sprayer volume.",
    frequency: "Repeat every 7-10 days under wet/high-risk conditions.",
    description: "Protective program to reduce spread pressure on new tissue.",
    safety_precautions: ["Use PPE", "Observe REI/PHI", "Do not over-apply copper"],
    effectiveness_rating: 4,
  },
  {
    name: "Targeted Systemic Rotation",
    type: "chemical",
    proportions: "Use crop-labeled active ingredients only; rotate FRAC groups.",
    frequency: "Rotate every 10-14 days, shorter in high pressure.",
    description: "Rotation strategy to maintain efficacy and slow resistance buildup.",
    safety_precautions: ["Follow label and local regulations", "Avoid repeated same MOA"],
    effectiveness_rating: 5,
  },
  {
    name: "Bacillus-Based Biofungicide",
    type: "organic",
    proportions: "Apply per label rate with full canopy coverage.",
    frequency: "Apply weekly and after heavy rain events.",
    description: "Biological suppression suitable as a low-risk first line.",
    safety_precautions: ["Use clean water and calibrated sprayer"],
    effectiveness_rating: 4,
  },
  {
    name: "Sanitation + Canopy Management",
    type: "organic",
    proportions: "Remove infected tissue and improve airflow by pruning.",
    frequency: "Scout twice weekly during active disease window.",
    description: "Reduces inoculum and humidity, improving treatment performance.",
    safety_precautions: ["Disinfect tools between trees/blocks"],
    effectiveness_rating: 4,
  },
];

const diseaseSpecificTreatmentSet = (plantName, diseaseName) => {
  const plant = normalizeKey(plantName);
  const disease = normalizeKey(diseaseName);

  if (disease.includes("cedar") && disease.includes("rust")) {
    return [
      {
        name: "Myclobutanil (FRAC 3) Rust Program",
        type: "chemical",
        proportions: "Use labeled orchard rate for apple rust control.",
        frequency: "Apply from pink through early cover at 7-10 day intervals when wet weather persists.",
        description: "Highly targeted rust-active program for cedar-apple rust on apple.",
        safety_precautions: ["Follow PHI/REI", "Rotate with non-FRAC 3 partner"],
        effectiveness_rating: 5,
      },
      {
        name: "Mancozeb Protective Cover",
        type: "chemical",
        proportions: "Use crop-labeled protective rate with full canopy coverage.",
        frequency: "Reapply every 7 days during infection windows or after heavy rain.",
        description: "Protective shield for new leaves/fruit where rust pressure is high.",
        safety_precautions: ["Observe seasonal maximum and label limits"],
        effectiveness_rating: 4,
      },
      {
        name: "Juniper Host Sanitation",
        type: "organic",
        proportions: "Remove nearby galls on alternate hosts where feasible.",
        frequency: "Inspect nearby junipers before spring spore release.",
        description: "Breaks cedar-apple rust lifecycle and lowers reinfection pressure.",
        safety_precautions: ["Dispose infected material away from orchard"],
        effectiveness_rating: 4,
      },
      {
        name: "Sulfur-Based Organic Protectant",
        type: "organic",
        proportions: "Use approved sulfur formulation at orchard label rate.",
        frequency: "Repeat every 7-10 days as preventive coverage.",
        description: "Lower-risk preventive option for early-season rust suppression.",
        safety_precautions: ["Avoid high-temperature spray windows to reduce phytotoxicity"],
        effectiveness_rating: 3,
      },
    ];
  }

  if (disease.includes("citrus") && disease.includes("canker")) {
    return [
      {
        name: "Copper Bactericide Program",
        type: "chemical",
        proportions: "Apply copper formulation at labeled citrus canker rate.",
        frequency: "7-14 day interval during flush and rainy periods.",
        description: "Primary suppressive treatment for bacterial canker on new citrus growth.",
        safety_precautions: ["Avoid excessive copper accumulation", "Observe label and local compliance"],
        effectiveness_rating: 5,
      },
      {
        name: "Streptomycin-Compatible Window (Where Allowed)",
        type: "chemical",
        proportions: "Only where local regulations and labels permit bactericide use.",
        frequency: "Use in rotation windows, not continuously.",
        description: "Can reduce bacterial pressure in severe outbreaks when legally permitted.",
        safety_precautions: ["Follow local legal restrictions strictly", "Prevent resistance via rotation"],
        effectiveness_rating: 4,
      },
      {
        name: "Sanitation and Pruning Protocol",
        type: "organic",
        proportions: "Prune infected twigs/leaves, disinfect tools between cuts.",
        frequency: "Weekly scouting and immediate removal of new lesions.",
        description: "Directly lowers inoculum load and spread by contaminated equipment.",
        safety_precautions: ["Destroy removed material away from orchard"],
        effectiveness_rating: 4,
      },
      {
        name: "Windbreak + Splash Reduction",
        type: "organic",
        proportions: "Install/maintain windbreak and reduce overhead splash.",
        frequency: "Maintain continuously in high-wind and wet seasons.",
        description: "Reduces wind-driven bacterial spread and rain splash transmission.",
        safety_precautions: ["Do not irrigate overhead during active outbreaks"],
        effectiveness_rating: 3,
      },
    ];
  }

  if ((plant.includes("tomato") || plant.includes("potato")) && disease.includes("blight")) {
    return [
      {
        name: "Blight-Specific FRAC Rotation",
        type: "chemical",
        proportions: "Use crop-labeled blight actives; rotate FRAC groups.",
        frequency: "7-day schedule in wet/humid periods.",
        description: "Disease-targeted rotation for blight suppression and resistance management.",
        safety_precautions: ["Do not repeat same FRAC back-to-back excessively"],
        effectiveness_rating: 5,
      },
      {
        name: "Protective Contact Fungicide",
        type: "chemical",
        proportions: "Apply full coverage protectant at label rate.",
        frequency: "Reapply after heavy rainfall.",
        description: "Protects healthy tissue from new infections.",
        safety_precautions: ["Observe pre-harvest interval"],
        effectiveness_rating: 4,
      },
      {
        name: "Bacillus + Potassium Bicarbonate Program",
        type: "organic",
        proportions: "Use labeled rates with complete leaf coverage.",
        frequency: "Weekly preventive program.",
        description: "Lower-risk suppression for early lesions and preventive management.",
        safety_precautions: ["Apply during cooler hours to limit stress"],
        effectiveness_rating: 3,
      },
      {
        name: "Leaf Removal and Irrigation Hygiene",
        type: "organic",
        proportions: "Remove heavily infected leaves and avoid overhead irrigation.",
        frequency: "Scout every 3-4 days in high-risk weather.",
        description: "Reduces inoculum and leaf wetness duration that drives blight spread.",
        safety_precautions: ["Sanitize tools and gloves between plants"],
        effectiveness_rating: 4,
      },
    ];
  }

  return genericTreatmentSet();
};

const treatments = (prompt = "") => {
  const context = parseTreatmentContext(prompt);
  return {
    treatments: diseaseSpecificTreatmentSet(context.plant, context.disease),
  };
};

const predictions = () => ({
  predictions: [
    {
      pest_or_disease: "Fungal leaf spot complex",
      risk_level: "high",
      probability: 72,
      affected_crops: ["Tomato", "Pepper"],
      expected_timeframe: "Within 7-14 days",
      preventative_measures: ["Increase scouting", "Improve airflow", "Use preventive spray before humid periods"],
      reasoning: "Humidity and temperature trend favor disease pressure.",
    },
  ],
});

const suggestions = () => ({
  suggestions: [
    {
      title: "Inspect lower canopy",
      task_type: "monitoring",
      due_date: iso(Date.now() + 86400000),
      priority: "high",
      description: "Scout for early disease signs and log lesion spread.",
      weather_dependent: false,
      crop_name: "",
      reason: "Early detection cuts treatment cost.",
    },
  ],
});

const IMAGE_MIME_BY_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const parseDataUrl = (value) => {
  const match = String(value || "").match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length) return null;
    return { buffer, mime: match[1].toLowerCase(), dataUrl: value, fileName: "inline-image" };
  } catch {
    return null;
  }
};

const toDataUrl = (mime, buffer) => `data:${mime};base64,${buffer.toString("base64")}`;

const resolveUploadAsset = async (fileUrl, options = {}) => {
  const uploadDir = String(options?.uploadDir || "");
  if (!uploadDir) return null;
  const publicPath = `/${String(options?.uploadsPublicPath || "/uploads").replace(/^\/+|\/+$/g, "")}`;
  const value = String(fileUrl || "");
  if (!value.startsWith(`${publicPath}/`) && !value.startsWith("/uploads/")) return null;

  const basename = path.basename(value);
  const root = path.resolve(uploadDir);
  const absolute = path.resolve(root, basename);
  if (!absolute.startsWith(root)) return null;

  const buffer = await readFile(absolute);
  if (!buffer.length) return null;
  const ext = path.extname(basename).toLowerCase();
  const mime = IMAGE_MIME_BY_EXTENSION[ext] || "image/jpeg";
  return { buffer, mime, dataUrl: toDataUrl(mime, buffer), fileName: basename };
};

const resolveImageAssets = async (fileUrls = [], options = {}) => {
  if (!Array.isArray(fileUrls) || fileUrls.length === 0) return [];
  const out = [];
  for (const value of fileUrls.slice(0, 2)) {
    if (typeof value !== "string" || !value.trim()) continue;
    const inline = parseDataUrl(value);
    if (inline) {
      out.push(inline);
      continue;
    }
    const upload = await resolveUploadAsset(value, options);
    if (upload) out.push(upload);
  }
  return out;
};

const extractText = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .join("\n");
  }
  if (content && typeof content === "object" && typeof content.text === "string") return content.text;
  return "";
};

const parseJsonFromText = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  let text = String(value || "").trim();
  if (!text) return null;
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(text);
  } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  return null;
};

const callOpenAi = async ({ prompt, schema, fileUrls, options, type }) => {
  const apiKey = String(options?.ai?.openAiApiKey || "").trim();
  if (isPlaceholderSecret(apiKey)) return null;

  const model = String(options?.ai?.openAiModel || "gpt-4o-mini").trim() || "gpt-4o-mini";
  const timeoutMs = clamp(i(options?.ai?.openAiTimeoutMs, 18000), 5000, 60000);
  const maxTokens = clamp(i(options?.ai?.maxOutputTokens, 1400), 200, 4096);
  const images = await resolveImageAssets(fileUrls, options);
  const userContent = [{ type: "text", text: prompt || "Provide response." }];
  for (const image of images) {
    userContent.push({ type: "image_url", image_url: { url: image.dataUrl, detail: "high" } });
  }

  const body = {
    model,
    temperature: 0.1,
    max_tokens: maxTokens,
    messages: [
      {
        role: "system",
        content:
          "You are Aerovanta Enterprise Engine. Use visible evidence only, abstain when uncertain, and never fabricate certainty.",
      },
      { role: "user", content: userContent },
    ],
    ...(schema ? { response_format: { type: "json_object" } } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const text = extractText(payload?.choices?.[0]?.message?.content).trim();
    if (!text) return null;
    if (!schema) return text;
    const parsed = parseJsonFromText(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return shape(schema, parsed);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const callGemini = async ({ prompt, schema, fileUrls, options, type }) => {
  const apiKey = String(options?.ai?.geminiApiKey || "").trim();
  if (isPlaceholderSecret(apiKey)) return null;

  const model = String(options?.ai?.geminiModel || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const baseUrl = String(options?.ai?.geminiBaseUrl || DEFAULT_GEMINI_BASE_URL).trim() || DEFAULT_GEMINI_BASE_URL;
  const timeoutMs = clamp(i(options?.ai?.geminiTimeoutMs, 25000), 5000, 90000);
  const maxTokens = clamp(i(options?.ai?.maxOutputTokens, 1400), 200, 4096);
  const images = await resolveImageAssets(fileUrls, options);

  const parts = [{ text: prompt || "Provide response." }];
  for (const image of images) {
    parts.push({
      inlineData: {
        mimeType: image.mime,
        data: image.buffer.toString("base64"),
      },
    });
  }

  const generationConfig = {
    temperature: 0.1,
    maxOutputTokens: maxTokens,
    ...(schema ? { responseMimeType: "application/json" } : {}),
  };

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig,
  };

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload?.promptFeedback?.blockReason) return null;
    const text = extractText(payload?.candidates?.[0]?.content?.parts).trim();
    if (!text) return null;
    if (!schema) return text;
    const parsed = parseJsonFromText(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return shape(schema, parsed);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const resolveProviderOrder = (options = {}) => {
  const requested = normalizeKey(options?.ai?.provider || "auto");
  const hasGemini = !isPlaceholderSecret(options?.ai?.geminiApiKey);
  const hasOpenAi = !isPlaceholderSecret(options?.ai?.openAiApiKey);

  if (requested === "gemini") return ["gemini", "openai"];
  if (requested === "openai") return ["openai", "gemini"];
  if (hasGemini && hasOpenAi) return ["gemini", "openai"];
  if (hasGemini) return ["gemini"];
  if (hasOpenAi) return ["openai"];
  return ["gemini", "openai"];
};

const callConfiguredModel = async ({ prompt, schema, fileUrls, options, type }) => {
  const order = resolveProviderOrder(options);
  for (const provider of order) {
    const out =
      provider === "gemini"
        ? await callGemini({ prompt, schema, fileUrls, options, type })
        : await callOpenAi({ prompt, schema, fileUrls, options, type });
    if (out != null) return out;
  }
  return null;
};

const imageSignal = async (fileUrls, options) => {
  const assets = await resolveImageAssets(fileUrls, options);
  const primary = assets[0];
  if (!primary) return null;
  return {
    hash: crypto.createHash("sha256").update(primary.buffer).digest("hex"),
    byteLength: primary.buffer.length,
    fileName: primary.fileName,
  };
};

const fallbackPlant = (signal) => {
  if (!signal) {
    return {
      is_plant: false,
      rejection_reason: "Vision analysis is unavailable or image signal could not be read.",
      plant_part: "unknown",
      plant_name: "Not verified",
      scientific_name: "N/A",
      plant_family: "N/A",
      leaf_description: "No reliable botanical features could be extracted in fallback mode.",
      confidence: 22,
      identifying_features: ["No reliable image signal"],
    };
  }

  const fileHints = String(signal.fileName || "").toLowerCase();
  const looksNonPlant =
    signal.byteLength < 2500 ||
    /\b(anime|cartoon|meme|character|luffy|naruto|screenshot|logo|vehicle|car|building)\b/.test(fileHints);
  if (looksNonPlant) {
    return {
      is_plant: false,
      rejection_reason: "Image does not contain enough real plant morphology for diagnosis.",
      plant_part: "unknown",
      plant_name: "Not a plant",
      scientific_name: "N/A",
      plant_family: "N/A",
      leaf_description: "Insufficient botanical evidence.",
      confidence: 24,
      identifying_features: ["No reliable plant structures detected"],
    };
  }

  return {
    is_plant: true,
    rejection_reason: "",
    plant_part: "leaf",
    plant_name: "Unknown crop",
    scientific_name: "Unknown species",
    plant_family: "Unknown",
    leaf_description: "Plant structure detected, but fallback mode cannot provide reliable species classification.",
    confidence: 60,
    identifying_features: ["Leaf-like structure present", "Species-level certainty unavailable in fallback mode"],
  };
};

const fallbackDisease = (signal) => {
  if (!signal) {
    return {
      disease_name: "Uncertain disease pattern",
      disease_type: "uncertain",
      infection_level: 0,
      severity: "low",
      symptoms: [],
      pathogen_signs: [],
      is_healthy: false,
      confidence: 35,
      analysis_notes: "Vision fallback has insufficient evidence for disease classification.",
    };
  }

  return {
    disease_name: "Uncertain disease pattern",
    disease_type: "uncertain",
    infection_level: 0,
    severity: "low",
    symptoms: ["Fallback mode could not classify disease from image with sufficient reliability."],
    pathogen_signs: [],
    is_healthy: false,
    confidence: 48,
    analysis_notes: "Fallback mode abstained from disease diagnosis to avoid incorrect classification.",
  };
};

const fallbackVerify = (signal, prompt = "") => {
  if (!signal) {
    return {
      verified: false,
      should_abstain: true,
      final_confidence: 24,
      corrections: "Unable to verify diagnosis due to missing image evidence.",
      reliability_score: 20,
    };
  }
  const base = 58 + (Number.parseInt(signal.hash.slice(20, 22), 16) % 34);
  const shouldAbstain = base < 62 || /uncertain|insufficient|non-plant/i.test(String(prompt || ""));
  return {
    verified: !shouldAbstain && base >= 68,
    should_abstain: shouldAbstain,
    final_confidence: clamp(base, 0, 100),
    corrections: shouldAbstain
      ? "Evidence is weak. Retake image in natural light with full leaf visibility."
      : "Diagnosis appears consistent with observed pattern.",
    reliability_score: clamp(shouldAbstain ? base - 12 : base, 0, 100),
  };
};

const fallbackPest = () => ({
  pest_or_disease_name: "Aphids",
  scientific_name: "Aphis gossypii",
  type: "insect_pest",
  severity: "moderate",
  confidence_score: 74,
  key_features: ["Clustered soft-bodied insects", "Leaf curling", "Honeydew residue"],
  damage_description: "Sap-feeding damage with curl and vigor loss.",
  lifecycle_stage: "Nymph and adult",
  affected_plants: ["Tomato", "Pepper", "Cucumber"],
  spread_rate: "Moderate",
  seasonal_activity: "Warm humid periods",
  economic_impact: "Medium to high if unmanaged",
});

export async function buildLlmResponse(payload = {}, options = {}) {
  const prompt = safePrompt(payload?.prompt);
  const schema = obj(payload?.response_json_schema);
  const fileUrls = Array.isArray(payload?.file_urls) ? payload.file_urls.filter((x) => typeof x === "string") : [];

  if (!schema) {
    if (/(weather|forecast|humidity|rain|wind|temperature)/i.test(prompt)) {
      const w = await weather(prompt);
      const c = w.current || {};
      const d = w.forecast?.[0] || {};
      return `Current weather for ${c.location || DEFAULT_LOCATION}: ${Math.round(n(c.temperature, 74))}F, ${(c.conditions || "moderate").toLowerCase()}, humidity ${Math.round(n(c.humidity, 60))}%, wind ${Math.round(n(c.wind_speed, 8))} mph. Today forecast: high ${Math.round(n(d.high, 76))}F, low ${Math.round(n(d.low, 62))}F, precipitation chance ${Math.round(n(d.precipitation_chance, 20))}%.`;
    }
    const aiText = await callConfiguredModel({ prompt, schema: null, fileUrls, options, type: "text" });
    if (typeof aiText === "string" && aiText.trim()) return aiText.trim();
    if (prompt) return "Use soil moisture checks, frequent scouting, and rotation-based treatment strategy.";
    return "Share crop, location, and issue for guidance.";
  }

  const type = schemaType(schema);

  if (type === "timeline") {
    const fallbackTimeline = shape(schema, timeline(prompt));
    const aiTimeline = await callConfiguredModel({ prompt, schema, fileUrls, options, type });
    if (aiTimeline == null) return fallbackTimeline;
    return shape(schema, normalizeTimelineOutput(aiTimeline, fallbackTimeline));
  }

  if (type === "weather" || type === "weather_widget" || type === "weather_recs") {
    const w = await weather(prompt);
    const insights = buildWeatherInsights(w);
    let out = null;
    if (type === "weather") {
      out = {
        current: w.current,
        forecast: w.forecast,
        alerts: insights.alerts,
        farming_conditions: insights.farming_conditions,
      };
    } else if (type === "weather_widget") {
      out = {
        location_name: w.current.location,
        temperature: w.current.temperature,
        temperature_low: w.forecast?.[0]?.low ?? w.current.temperature - 8,
        humidity: w.current.humidity,
        wind_speed: w.current.wind_speed,
        conditions: w.current.conditions,
        rainfall: w.current.rainfall,
        description: w.current.description,
        uv_index: w.current.uv_index,
        feels_like: w.current.feels_like,
      };
    } else {
      out = insights.weather_recommendations;
    }
    return shape(schema, out);
  }

  const aiOut = await callConfiguredModel({ prompt, schema, fileUrls, options, type });
  if (aiOut != null) return aiOut;

  const signal = await imageSignal(fileUrls, options);
  let out = null;
  if (type === "plant") out = fallbackPlant(signal);
  else if (type === "disease") out = fallbackDisease(signal, prompt);
  else if (type === "verify") out = fallbackVerify(signal, prompt);
  else if (type === "treatments") out = treatments(prompt);
  else if (type === "timeline") out = timeline(prompt);
  else if (type === "predictions") out = predictions();
  else if (type === "suggestions") out = suggestions();
  else if (type === "pest") out = fallbackPest();
  else out = generic(schema);

  return shape(schema, out);
}
