const DEFAULT_LOCATION = "Des Moines, Iowa, United States";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const ALLOWED_UPLOAD_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/svg+xml",
]);
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

const n = (value, fallback = 0) => {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const i = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const iso = (value) => new Date(value).toISOString().slice(0, 10);
const safePrompt = (value) => String(value || "").slice(0, 12_000);
const normalizeKey = (value) => String(value || "").trim().toLowerCase();
const obj = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : null);
const getKeys = (schema) => Object.keys(schema?.properties || {});

const createHttpError = (status, message, code = "request_failed") => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const generic = (schema, key = "") => {
  if (!schema || typeof schema !== "object") return null;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.type === "object") {
    return Object.fromEntries(Object.entries(schema.properties || {}).map(([childKey, child]) => [childKey, generic(child, childKey)]));
  }
  if (schema.type === "array") return [generic(schema.items || { type: "string" }, key)];
  if (schema.type === "number" || schema.type === "integer") return key.toLowerCase().includes("confidence") ? 70 : 1;
  if (schema.type === "boolean") return false;
  if (key.toLowerCase().includes("date")) return iso(Date.now());
  if (key.toLowerCase().includes("location")) return DEFAULT_LOCATION;
  if (key.toLowerCase().includes("priority")) return "medium";
  if (key.toLowerCase().includes("severity")) return "moderate";
  return "available";
};

const shape = (schema, value, key = "") => {
  if (!schema || typeof schema !== "object") return value;
  if (Array.isArray(schema.enum) && schema.enum.length) {
    return schema.enum.includes(value) ? value : schema.enum[0];
  }
  if (schema.type === "object") {
    const src = obj(value) || {};
    return Object.fromEntries(Object.entries(schema.properties || {}).map(([childKey, child]) => [childKey, shape(child, src[childKey], childKey)]));
  }
  if (schema.type === "array") {
    const arr = Array.isArray(value) ? value : [generic(schema.items || { type: "string" }, key)];
    return arr.map((entry) => shape(schema.items || { type: "string" }, entry, key));
  }
  if (schema.type === "number" || schema.type === "integer") return n(value, generic(schema, key));
  if (schema.type === "boolean") return Boolean(value);
  return String(value ?? generic(schema, key));
};

const schemaType = (schema) => {
  const keys = getKeys(schema);
  if (keys.includes("current") && keys.includes("forecast")) return "weather";
  if (keys.includes("location_name") && keys.includes("temperature")) return "weather_widget";
  if (keys.includes("irrigation") && keys.includes("pest_control")) return "weather_recs";
  if (keys.includes("timeline") && keys.includes("total_weeks")) return "timeline";
  if (keys.includes("predictions")) return "predictions";
  if (keys.includes("suggestions")) return "suggestions";
  if (keys.includes("treatments")) return "treatments";
  return "generic";
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
  } catch {
    // fall through
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
};

const jsonFetch = async (url, timeout = 9000, headers = { Accept: "application/json" }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`http_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const parseCoords = (prompt) => {
  const text = String(prompt || "");
  const pairMatch = text.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  const namedMatch = text.match(/latitude\s*[:=]?\s*(-?\d{1,2}(?:\.\d+)?)[^\d-]+longitude\s*[:=]?\s*(-?\d{1,3}(?:\.\d+)?)/i);
  const match = pairMatch || namedMatch;
  if (!match) return null;
  const lat = n(match[1], 999);
  const lon = n(match[2], 999);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
};

const locationHint = (prompt) => {
  const text = String(prompt || "");
  const explicit = text.match(/location\s*:\s*([^\n]+)/i)?.[1]?.trim();
  if (explicit) return explicit;
  const weatherFor = text.match(/weather(?:\s+data)?\s+for\s+([^\n.]+)/i)?.[1]?.trim();
  if (weatherFor) return weatherFor;
  return "";
};

const fallbackWeather = (location) => ({
  location: location || DEFAULT_LOCATION,
  current: {
    location: location || DEFAULT_LOCATION,
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
  forecast: Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(Date.now() + index * 86400000);
    return {
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      date: iso(date),
      high: 76 + (index % 3),
      low: 62 + (index % 3),
      conditions: index % 3 === 0 ? "Rain showers" : "Partly cloudy",
      precipitation_chance: index % 3 === 0 ? 65 : 20,
      rainfall: index % 3 === 0 ? 0.35 : 0,
      wind_speed: 8 + (index % 4),
      uv_index: 5,
    };
  }),
});

const weather = async (prompt) => {
  let lat = null;
  let lon = null;
  let location = locationHint(prompt);
  const coords = parseCoords(prompt);
  if (coords) {
    lat = coords.lat;
    lon = coords.lon;
    const hintedLocation = String(location || "").trim();
    location = /^-?\d/.test(hintedLocation) && !/latitude|longitude/i.test(hintedLocation)
      ? hintedLocation
      : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  } else {
    try {
      const target = location || DEFAULT_LOCATION;
      const geocode = await jsonFetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(target)}&count=1&language=en&format=json`
      );
      const result = geocode?.results?.[0];
      if (result) {
        lat = n(result.latitude);
        lon = n(result.longitude);
        location = [result.name, result.admin1, result.country].filter(Boolean).join(", ") || target;
      } else {
        location = target;
      }
    } catch {
      // fall back below
    }
  }

  if (lat == null || lon == null) return fallbackWeather(location || DEFAULT_LOCATION);

  try {
    const forecast = await jsonFetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(String(lon))}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,surface_pressure&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=7`
    );
    const daily = forecast?.daily || {};
    const days = (daily.time || []).map((dateValue, index) => ({
      day: new Date(`${dateValue}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" }),
      date: String(dateValue),
      high: n(daily.temperature_2m_max?.[index], 74),
      low: n(daily.temperature_2m_min?.[index], 61),
      conditions: CODE[i(daily.weather_code?.[index], 2)] || "Partly cloudy",
      precipitation_chance: clamp(i(daily.precipitation_probability_max?.[index], 0), 0, 100),
      rainfall: n(daily.precipitation_sum?.[index], 0),
      wind_speed: n(daily.wind_speed_10m_max?.[index], 8),
      uv_index: clamp(n(daily.uv_index_max?.[index], 4), 0, 14),
    }));
    const current = forecast?.current || {};
    return {
      location,
      current: {
        location,
        temperature: n(current.temperature_2m, 74),
        feels_like: n(current.apparent_temperature, 74),
        humidity: clamp(i(current.relative_humidity_2m, 60), 0, 100),
        wind_speed: n(current.wind_speed_10m, 8),
        conditions: CODE[i(current.weather_code, 2)] || "Partly cloudy",
        uv_index: n(days[0]?.uv_index, 5),
        pressure: i(current.surface_pressure, 1012),
        rainfall: n(days[0]?.rainfall, 0),
        description: "Weather data sourced from Open-Meteo.",
      },
      forecast: days,
    };
  } catch {
    return fallbackWeather(location || DEFAULT_LOCATION);
  }
};

const buildWeatherInsights = (weatherPayload = {}) => {
  const current = obj(weatherPayload.current) || {};
  const forecast = Array.isArray(weatherPayload.forecast) ? weatherPayload.forecast : [];
  const today = forecast[0] || {};
  const nextThreeDays = forecast.slice(0, 3);
  const alerts = [];

  const maxWind = nextThreeDays.reduce((max, day) => Math.max(max, n(day.wind_speed, 0)), n(current.wind_speed, 0));
  const maxRainChance = nextThreeDays.reduce(
    (max, day) => Math.max(max, n(day.precipitation_chance, 0)),
    n(today.precipitation_chance, 0)
  );
  const maxRainfall = nextThreeDays.reduce((max, day) => Math.max(max, n(day.rainfall, 0)), n(today.rainfall, 0));
  const minLow = nextThreeDays.reduce((min, day) => Math.min(min, n(day.low, 999)), n(today.low, 999));

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
    alerts.some((alert) => alert.severity === "critical") || alerts.some((alert) => alert.severity === "high")
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
          ? alerts.map((alert) => ({
              measure: alert.type,
              urgency: alert.severity === "critical" || alert.severity === "high" ? "high" : "medium",
              reason: alert.action,
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
            ? "Elevated humidity and rainfall increase leaf wetness duration and disease pressure."
            : diseaseRiskLevel === "moderate"
              ? "Conditions are mixed; maintain regular scouting and preventive practices."
              : "Current humidity and rainfall pattern indicate relatively low disease pressure.",
      },
    },
  };
};

const parseDataUrl = (value = "") => {
  const match = String(value || "").match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: String(match[1] || "application/octet-stream").toLowerCase(),
    data: String(match[2] || "").replace(/\s+/g, ""),
  };
};

const callGemini = async ({ prompt, schema, fileUrls = [], env }) => {
  const apiKey = String(env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return null;

  const model = String(env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const baseUrl = String(env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE_URL).trim() || DEFAULT_GEMINI_BASE_URL;
  const parts = [{ text: prompt || "Provide response." }];

  for (const url of Array.isArray(fileUrls) ? fileUrls : []) {
    const inline = parseDataUrl(url);
    if (!inline || !ALLOWED_UPLOAD_MIME.has(inline.mimeType)) continue;
    parts.push({
      inlineData: {
        mimeType: inline.mimeType,
        data: inline.data,
      },
    });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1400,
      ...(schema ? { responseMimeType: "application/json" } : {}),
    },
  };

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
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

const buildTimelineFallback = (schema, prompt) => {
  const cropMatch = String(prompt || "").match(/crop\s*name\s*[:\-]?\s*([^\n]+)/i);
  const cropName = cropMatch?.[1]?.trim() || "Crop";
  const out = {
    total_weeks: 12,
    summary: `${cropName} plan focused on establishment, vegetative growth, and harvest readiness.`,
    timeline: [
      {
        week: 1,
        stage: "Establishment",
        focus: "Prepare soil and maintain uniform germination moisture.",
      },
      {
        week: 4,
        stage: "Vegetative growth",
        focus: "Monitor crop vigor, irrigation, and nutrient response.",
      },
      {
        week: 8,
        stage: "Reproductive phase",
        focus: "Protect flowering and manage stress-sensitive operations.",
      },
      {
        week: 12,
        stage: "Harvest readiness",
        focus: "Check maturity, quality, and harvest logistics.",
      },
    ],
  };
  return shape(schema, out);
};

const buildSuggestionsFallback = (schema) =>
  shape(schema, {
    suggestions: [
      {
        title: "Scout high-humidity zones",
        task_type: "monitoring",
        due_date: iso(Date.now() + 86400000),
        priority: "medium",
        description: "Inspect lower canopy and shaded blocks for early disease or pest pressure.",
        weather_dependent: true,
        crop_name: "Mixed crops",
        reason: "Routine scouting reduces delayed response to disease and pest outbreaks.",
      },
      {
        title: "Review irrigation schedule",
        task_type: "irrigation",
        due_date: iso(Date.now() + 2 * 86400000),
        priority: "medium",
        description: "Adjust irrigation volumes based on recent weather and soil moisture.",
        weather_dependent: true,
        crop_name: "Mixed crops",
        reason: "Current weather conditions can shift water demand quickly.",
      },
    ],
  });

const buildPredictionsFallback = (schema) =>
  shape(schema, {
    predictions: [
      {
        pest_or_disease: "Humidity-driven foliar disease pressure",
        risk_level: "moderate",
        probability: 62,
        affected_crops: ["Mixed crops"],
        expected_timeframe: "Next 2 weeks",
        preventative_measures: ["Increase scouting frequency", "Improve canopy airflow", "Avoid late-day irrigation"],
        reasoning: "Weather uncertainty fallback indicates moderate disease-conducive conditions.",
      },
    ],
  });

const promptField = (prompt, label) => {
  const match = String(prompt || "").match(new RegExp(`${label}\\s*:\\s*([^\\n]+)`, "i"));
  return String(match?.[1] || "").trim();
};

const inferDiseaseBucket = (diseaseName = "") => {
  const disease = normalizeKey(diseaseName);
  if (!disease || disease.includes("healthy") || disease.includes("no disease")) return "healthy";
  if (
    disease.includes("rust") ||
    disease.includes("blight") ||
    disease.includes("mildew") ||
    disease.includes("mold") ||
    disease.includes("spot") ||
    disease.includes("scab") ||
    disease.includes("anthracnose") ||
    disease.includes("rot")
  ) return "fungal";
  if (disease.includes("canker") || disease.includes("bacterial")) return "bacterial";
  if (disease.includes("virus") || disease.includes("mosaic") || disease.includes("viroid")) return "viral";
  if (disease.includes("deficiency") || disease.includes("stress") || disease.includes("sunscald") || disease.includes("nutrient")) {
    return "physiological";
  }
  return "general";
};

const buildTreatmentFallbackSet = (prompt = "") => {
  const plant = promptField(prompt, "Plant") || "crop";
  const disease = promptField(prompt, "Disease") || "observed disease";
  const severity = normalizeKey(promptField(prompt, "Severity"));
  const provisional = /Confidence Mode:\s*provisional/i.test(String(prompt || ""));
  const bucket = inferDiseaseBucket(disease);
  const baseSafety = provisional
    ? ["Confirm with a clearer image before aggressive chemical use.", "Follow local label and pre-harvest interval requirements."]
    : ["Wear gloves, eye protection, and follow crop label restrictions.", "Rotate modes of action to reduce resistance pressure."];

  if (bucket === "fungal") {
    return [
      {
        name: `${plant} protectant copper spray`,
        type: "chemical",
        proportions: "Use labeled copper fungicide rate for this crop; ensure full leaf coverage.",
        frequency: severity === "high" ? "Repeat every 5-7 days during active pressure." : "Repeat every 7-10 days during wet periods.",
        description: `Useful as a protectant option for ${disease} on ${plant}, especially before new lesion spread after rain or dew events.`,
        safety_precautions: baseSafety,
        effectiveness_rating: 3,
      },
      {
        name: `${plant} systemic fungicide rotation`,
        type: "chemical",
        proportions: "Use a crop-labeled systemic fungicide with resistance-group rotation; avoid repeating the same group back-to-back.",
        frequency: "Apply at the earliest disease window and rotate every 7-14 days based on label and weather pressure.",
        description: `Targets active ${disease} pressure more effectively than protectant-only programs when lesions are already present on ${plant}.`,
        safety_precautions: [...baseSafety, "Do not exceed seasonal application limits for the active ingredient."],
        effectiveness_rating: 5,
      },
      {
        name: `${plant} Bacillus biofungicide`,
        type: "organic",
        proportions: "Apply labeled Bacillus-based biofungicide to upper and lower leaf surfaces.",
        frequency: provisional ? "Reapply every 5-7 days while confirming diagnosis." : "Reapply every 7 days under humid conditions.",
        description: `A lower-risk first-line biological option that can suppress fungal surface activity linked to ${disease}.`,
        safety_precautions: ["Best used preventively or at early symptom stage.", "Do not mix incompatibly with strong alkaline sprays unless label permits."],
        effectiveness_rating: 3,
      },
      {
        name: `${plant} sanitation and canopy drying plan`,
        type: "organic",
        proportions: "Remove heavily infected tissue, improve airflow, and avoid overhead irrigation late in the day.",
        frequency: "Scout every 2-3 days and repeat sanitation after rain events.",
        description: `Reduces reinfection pressure and leaf wetness duration that typically worsens ${disease} on ${plant}.`,
        safety_precautions: ["Disinfect tools between plants or blocks.", "Dispose of infected tissue away from production areas."],
        effectiveness_rating: 4,
      },
    ];
  }

  if (bucket === "bacterial") {
    return [
      {
        name: `${plant} copper bactericide protectant`,
        type: "chemical",
        proportions: "Use a crop-labeled copper bactericide rate and maintain even coverage on susceptible tissue.",
        frequency: "Repeat every 5-7 days during rain or splash events.",
        description: `Helps reduce surface bacterial spread associated with ${disease} on ${plant}.`,
        safety_precautions: baseSafety,
        effectiveness_rating: 3,
      },
      {
        name: `${plant} targeted bactericide program`,
        type: "chemical",
        proportions: "Use region- and crop-approved bactericide options only where label and local regulation allow.",
        frequency: "Apply within label intervals during active infection pressure.",
        description: `Provides stronger suppression when ${disease} is already established and weather favors bacterial spread.`,
        safety_precautions: [...baseSafety, "Verify local legal approval before use of antibiotic-based bactericides."],
        effectiveness_rating: 4,
      },
      {
        name: `${plant} sanitation and splash reduction`,
        type: "organic",
        proportions: "Prune or remove heavily infected tissue and stop overhead irrigation where possible.",
        frequency: "Repeat sanitation weekly and after storms.",
        description: `Critical for bacterial issues because splash spread and tool transfer often intensify ${disease}.`,
        safety_precautions: ["Disinfect tools between cuts.", "Avoid handling plants while foliage is wet."],
        effectiveness_rating: 4,
      },
      {
        name: `${plant} biological leaf protectant`,
        type: "organic",
        proportions: "Apply a labeled biological protectant based on Bacillus or related beneficial microbes.",
        frequency: "Reapply every 5-7 days during high humidity periods.",
        description: `Useful as a lower-risk support program for ${disease}, especially in provisional diagnosis mode.`,
        safety_precautions: ["Use as part of an integrated program, not as the only action under severe pressure."],
        effectiveness_rating: 3,
      },
    ];
  }

  if (bucket === "viral") {
    return [
      {
        name: `${plant} vector-targeted insecticide rotation`,
        type: "chemical",
        proportions: "Use crop-labeled insecticide groups targeting aphids, whiteflies, or other likely vectors.",
        frequency: "Apply according to scouting thresholds and rotate modes of action.",
        description: `There is no curative chemistry for ${disease}; control focuses on the insect vectors that spread it in ${plant}.`,
        safety_precautions: baseSafety,
        effectiveness_rating: 4,
      },
      {
        name: `${plant} horticultural oil or soap vector suppression`,
        type: "chemical",
        proportions: "Apply labeled horticultural oil or insecticidal soap to suppress vector populations on new growth.",
        frequency: "Repeat every 5-7 days while vector pressure persists.",
        description: `Useful for reducing virus spread pressure by lowering active vector feeding.`,
        safety_precautions: ["Do not apply during extreme heat.", "Check compatibility with sulfur or recent oil sprays."],
        effectiveness_rating: 3,
      },
      {
        name: `${plant} rogue infected plants and weeds`,
        type: "organic",
        proportions: "Remove severely symptomatic plants and nearby alternative hosts that can harbor vectors or virus sources.",
        frequency: "Inspect every 2-3 days during spread periods.",
        description: `Reduces secondary spread sources when ${disease} is likely viral and already visible in the field.`,
        safety_precautions: ["Bag infected material and remove it from the production area."],
        effectiveness_rating: 5,
      },
      {
        name: `${plant} biological vector management`,
        type: "organic",
        proportions: "Use biological controls or trap-based suppression suitable for the identified vector complex.",
        frequency: "Maintain through the vector activity window.",
        description: `Supports lower-residue vector suppression when managing likely virus transmission in ${plant}.`,
        safety_precautions: ["Match biological controls to the actual vector before release or application."],
        effectiveness_rating: 3,
      },
    ];
  }

  if (bucket === "physiological") {
    return [
      {
        name: `${plant} corrective foliar nutrient program`,
        type: "chemical",
        proportions: "Use a crop-labeled foliar nutrient correction based on the suspected deficiency pattern.",
        frequency: "Reassess in 5-7 days before repeating.",
        description: `Targets visual stress patterns that are more consistent with ${disease} than with an infectious outbreak.`,
        safety_precautions: ["Do not exceed label concentration to avoid leaf burn."],
        effectiveness_rating: 4,
      },
      {
        name: `${plant} root-zone nutrition reset`,
        type: "chemical",
        proportions: "Adjust fertigation or soil-applied nutrition using recent soil/tissue test guidance.",
        frequency: "Review weekly until vigor stabilizes.",
        description: `Addresses underlying nutrient imbalance or uptake issues associated with the current stress pattern.`,
        safety_precautions: ["Base changes on soil or tissue data where possible."],
        effectiveness_rating: 4,
      },
      {
        name: `${plant} irrigation uniformity correction`,
        type: "organic",
        proportions: "Correct dry/wet zone imbalance and reduce sudden swings in root-zone moisture.",
        frequency: "Monitor soil moisture daily until stress symptoms stabilize.",
        description: `Helps reverse non-pathogenic stress symptoms that often worsen with inconsistent watering.`,
        safety_precautions: ["Avoid overcorrection that causes waterlogging."],
        effectiveness_rating: 5,
      },
      {
        name: `${plant} low-risk biostimulant recovery support`,
        type: "organic",
        proportions: "Use crop-labeled seaweed, humic, or amino-acid support products where appropriate.",
        frequency: "Repeat every 7-10 days during recovery.",
        description: `Supports recovery while you correct the root cause of the observed stress pattern on ${plant}.`,
        safety_precautions: ["Use only as a support measure; fix the underlying water/nutrient issue first."],
        effectiveness_rating: 3,
      },
    ];
  }

  return [
    {
      name: `${plant} targeted protective spray`,
      type: "chemical",
      proportions: "Use a crop-labeled protective spray matched to the diagnosed issue and local guidance.",
      frequency: "Repeat per label during active pressure windows.",
      description: `Provides a conservative first chemical option while confirming the exact ${disease} management program for ${plant}.`,
      safety_precautions: baseSafety,
      effectiveness_rating: 3,
    },
    {
      name: `${plant} rotation-safe systemic program`,
      type: "chemical",
      proportions: "Use a crop-approved rotation partner only if symptoms continue to expand.",
      frequency: "Apply within label interval and rotate modes of action.",
      description: `Escalation option for persistent ${disease} pressure after confirming crop-label fit.`,
      safety_precautions: [...baseSafety, "Check residue and pre-harvest interval restrictions."],
      effectiveness_rating: 4,
    },
    {
      name: `${plant} sanitation and scouting block plan`,
      type: "organic",
      proportions: "Remove heavily affected tissue and scout surrounding plants systematically.",
      frequency: "Scout every 2-3 days.",
      description: `Reduces spread pressure and improves confidence in how ${disease} is progressing.`,
      safety_precautions: ["Disinfect tools between plants or rows."],
      effectiveness_rating: 4,
    },
    {
      name: `${plant} biological support spray`,
      type: "organic",
      proportions: "Apply a crop-labeled biological support product appropriate for foliar disease pressure.",
      frequency: "Reapply every 5-7 days as preventive support.",
      description: `Useful as a lower-risk integrated option while refining the exact disease program for ${plant}.`,
      safety_precautions: ["Use alongside scouting and environmental management, not as the only control in severe outbreaks."],
      effectiveness_rating: 3,
    },
  ];
};

const normalizeTreatmentOutput = (schema, prompt, items) => {
  const fallbacks = buildTreatmentFallbackSet(prompt);
  const raw = Array.isArray(items) ? items : [];
  const normalized = fallbacks.map((fallback, index) => {
    const candidate = raw[index] && typeof raw[index] === "object" ? raw[index] : {};
    const type = String(candidate.type || fallback.type).toLowerCase() === "organic" ? "organic" : "chemical";
    const safety = Array.isArray(candidate.safety_precautions)
      ? candidate.safety_precautions.filter(Boolean).slice(0, 6)
      : typeof candidate.safety === "string" && candidate.safety.trim()
        ? [candidate.safety.trim()]
        : fallback.safety_precautions;
    return {
      name: String(candidate.name || fallback.name),
      type,
      proportions: String(candidate.proportions || candidate.application_method || candidate.instructions || fallback.proportions),
      frequency: String(candidate.frequency || fallback.frequency),
      description: String(candidate.description || fallback.description),
      safety_precautions: safety,
      effectiveness_rating: clamp(Math.round(n(candidate.effectiveness_rating, fallback.effectiveness_rating)), 1, 5),
    };
  });
  return shape(schema, { treatments: normalized.slice(0, 4) });
};

const buildTreatmentsFallback = (schema, prompt) => normalizeTreatmentOutput(schema, prompt, []);

export const uploadTransientFile = (payload = {}) => {
  const fileName = String(payload.file_name || "upload").trim() || "upload";
  const fileType = String(payload.file_type || "").toLowerCase().trim();
  const contentBase64 = String(payload.content_base64 || "")
    .replace(/^data:[^;]+;base64,/i, "")
    .replace(/\s+/g, "");

  if (!contentBase64) throw createHttpError(400, "File payload is required.", "invalid_upload");
  if (!ALLOWED_UPLOAD_MIME.has(fileType)) {
    throw createHttpError(415, "Unsupported file type.", "unsupported_media_type");
  }

  return {
    file_url: `data:${fileType};base64,${contentBase64}`,
    file_name: fileName,
    storage: "transient",
  };
};

export const invokeLlm = async (payload = {}, env = {}) => {
  const prompt = safePrompt(payload?.prompt);
  const schema = obj(payload?.response_json_schema);
  const fileUrls = Array.isArray(payload?.file_urls) ? payload.file_urls.filter((value) => typeof value === "string") : [];

  if (!schema) {
    if (/(weather|forecast|humidity|rain|wind|temperature)/i.test(prompt)) {
      const weatherPayload = await weather(prompt);
      const current = weatherPayload.current || {};
      const today = weatherPayload.forecast?.[0] || {};
      return `Current weather for ${current.location || DEFAULT_LOCATION}: ${Math.round(n(current.temperature, 74))}F, ${(current.conditions || "moderate").toLowerCase()}, humidity ${Math.round(n(current.humidity, 60))}%, wind ${Math.round(n(current.wind_speed, 8))} mph. Today forecast: high ${Math.round(n(today.high, 76))}F, low ${Math.round(n(today.low, 62))}F, precipitation chance ${Math.round(n(today.precipitation_chance, 20))}%.`;
    }
    const text = await callGemini({ prompt, schema: null, fileUrls, env });
    if (typeof text === "string" && text.trim()) return text.trim();
    return prompt ? "Use soil moisture checks, frequent scouting, and rotation-based treatment strategy." : "Share crop, location, and issue for guidance.";
  }

  const type = schemaType(schema);
  if (type === "weather" || type === "weather_widget" || type === "weather_recs") {
    const weatherPayload = await weather(prompt);
    const insights = buildWeatherInsights(weatherPayload);
    let out = null;
    if (type === "weather") {
      out = {
        current: weatherPayload.current,
        forecast: weatherPayload.forecast,
        alerts: insights.alerts,
        farming_conditions: insights.farming_conditions,
      };
    } else if (type === "weather_widget") {
      out = {
        location_name: weatherPayload.current.location,
        temperature: weatherPayload.current.temperature,
        temperature_low: weatherPayload.forecast?.[0]?.low ?? weatherPayload.current.temperature - 8,
        humidity: weatherPayload.current.humidity,
        wind_speed: weatherPayload.current.wind_speed,
        conditions: weatherPayload.current.conditions,
        rainfall: weatherPayload.current.rainfall,
        description: weatherPayload.current.description,
        uv_index: weatherPayload.current.uv_index,
        feels_like: weatherPayload.current.feels_like,
      };
    } else {
      out = insights.weather_recommendations;
    }
    return shape(schema, out);
  }

  const aiOut = await callGemini({ prompt, schema, fileUrls, env });
  if (aiOut != null) {
    if (type === "treatments") return normalizeTreatmentOutput(schema, prompt, aiOut?.treatments);
    return aiOut;
  }

  if (type === "timeline") return buildTimelineFallback(schema, prompt);
  if (type === "suggestions") return buildSuggestionsFallback(schema);
  if (type === "predictions") return buildPredictionsFallback(schema);
  if (type === "treatments") return buildTreatmentsFallback(schema, prompt);
  return shape(schema, generic(schema));
};





