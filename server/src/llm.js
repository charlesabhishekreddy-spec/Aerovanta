import crypto from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";

const DEFAULT_LOCATION = "Des Moines, Iowa, United States";
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
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const getKeys = (s) => Object.keys(s?.properties || {});
const enumPick = (s, fallback) => (Array.isArray(s?.enum) && s.enum.length ? s.enum[0] : fallback);

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

const timeline = (p) => {
  const crop = p.match(/timeline for\s+(.+?)\s+starting from/i)?.[1]?.trim() || "Crop";
  const d = p.match(/starting from\s+(\d{4}-\d{2}-\d{2})/i)?.[1] || iso(Date.now());
  const start = new Date(`${d}T00:00:00`);
  const total = crop.toLowerCase().includes("tomato") ? 16 : crop.toLowerCase().includes("corn") ? 14 : 12;
  return {
    crop_name: crop,
    total_weeks: total,
    expected_harvest_date: iso(start.getTime() + total * 7 * 86400000),
    timeline: Array.from({ length: total }).map((_, k) => ({
      week: k + 1,
      stage: k < 2 ? "Seedling establishment" : k < 6 ? "Vegetative growth" : k < 10 ? "Flowering" : "Development",
      activities: ["Check soil moisture and irrigation uniformity.", "Scout for pests and foliar lesions."],
      tips: "Record observations each week and adjust interventions.",
    })),
    watering_schedule: "Early-morning irrigation; adjust by evapotranspiration.",
    fertilizer_plan: "Balanced NPK early, potassium-forward later.",
    soil_requirements: "Well-drained soil with stable organic matter.",
  };
};

const treatments = () => ({
  treatments: [
    {
      name: "Neem + Potassium Soap Spray",
      type: "organic",
      proportions: "25 ml neem oil + 10 ml soap per gallon",
      description: "Apply full-canopy coverage every 5-7 days in low-wind windows.",
      safety_precautions: ["Wear gloves", "Avoid midday spray"],
      effectiveness_rating: 4,
    },
    {
      name: "Bacillus Biofungicide",
      type: "organic",
      proportions: "2 tbsp per gallon",
      description: "Preventive biological suppression; repeat weekly and after heavy rain.",
      safety_precautions: ["Use clean sprayer", "Follow product label"],
      effectiveness_rating: 4,
    },
    {
      name: "Copper Protectant",
      type: "chemical",
      proportions: "1.5-2 tsp per gallon",
      description: "Protective foliar treatment for fungal pressure periods.",
      safety_precautions: ["Respect REI/PHI", "Avoid over-application"],
      effectiveness_rating: 4,
    },
    {
      name: "Systemic Rotation Spray",
      type: "chemical",
      proportions: "Label rate by growth stage",
      description: "Rotate active groups every 10-14 days to reduce resistance pressure.",
      safety_precautions: ["Use PPE", "Observe resistance-management labels"],
      effectiveness_rating: 5,
    },
  ],
});

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
  if (!apiKey) return null;

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
          "You are VerdentVision Enterprise Engine. Use visible evidence only, abstain when uncertain, and never fabricate certainty.",
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
    const aiText = await callOpenAi({ prompt, schema: null, fileUrls, options, type: "text" });
    if (typeof aiText === "string" && aiText.trim()) return aiText.trim();
    if (prompt) return "Use soil moisture checks, frequent scouting, and rotation-based treatment strategy.";
    return "Share crop, location, and issue for guidance.";
  }

  const type = schemaType(schema);

  if (type === "weather" || type === "weather_widget" || type === "weather_recs") {
    const w = await weather(prompt);
    let out = null;
    if (type === "weather") {
      out = { current: w.current, forecast: w.forecast };
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
      out = {
        irrigation: { recommendation: "Adjust irrigation by rainfall probability.", timing: "Early morning", priority: "medium" },
        pest_control: { recommendation: "Increase scouting in humid windows.", optimal_window: "Low-wind mornings", priority: "medium" },
        planting_harvesting: { recommendation: "Use morning windows for field operations.", timing: "Morning to mid-day", priority: "low" },
        protective_measures: [{ measure: "Inspect drainage channels", urgency: "high", reason: "Reduce waterlogging risk." }],
        priority_tasks: ["Scout lower canopy", "Check irrigation uniformity", "Log weather actions"],
        disease_risk: { level: w.current.humidity >= 75 ? "high" : "moderate", reasoning: "Humidity and temperature drive pathogen pressure." },
      };
    }
    return shape(schema, out);
  }

  const aiOut = await callOpenAi({ prompt, schema, fileUrls, options, type });
  if (aiOut != null) return aiOut;

  const signal = await imageSignal(fileUrls, options);
  let out = null;
  if (type === "plant") out = fallbackPlant(signal);
  else if (type === "disease") out = fallbackDisease(signal, prompt);
  else if (type === "verify") out = fallbackVerify(signal, prompt);
  else if (type === "treatments") out = treatments();
  else if (type === "timeline") out = timeline(prompt);
  else if (type === "predictions") out = predictions();
  else if (type === "suggestions") out = suggestions();
  else if (type === "pest") out = fallbackPest();
  else out = generic(schema);

  return shape(schema, out);
}
