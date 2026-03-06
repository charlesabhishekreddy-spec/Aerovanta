const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIN_RELIABLE_CONFIDENCE = 65;
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DIAGNOSIS_PIPELINE_VERSION = "diagnosis-v3-gemini-edge";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const normalizeText = (value) => String(value ?? "").trim().toLowerCase();
const parseJsonSafe = (value) => {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
};
const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const toText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};
const toStringArray = (value) =>
  Array.isArray(value)
    ? value
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];

const createHttpError = (status, message, code = "request_failed") => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const sanitizeMessage = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 360);
const isPlaceholderSecret = (value) => {
  const token = String(value || "").trim().toLowerCase();
  return !token || token === "your_real_key" || token === "changeme" || token === "replace_me";
};

const parseOpenAiError = (detailText = "") => {
  const raw = String(detailText || "").trim();
  if (!raw) return { message: "", code: "" };
  const parsed = parseJsonSafe(raw);
  const errorObj = parsed?.error && typeof parsed.error === "object" ? parsed.error : {};
  return {
    message: sanitizeMessage(errorObj?.message || raw),
    code: String(errorObj?.code || "").trim().toLowerCase(),
  };
};

const parseGeminiError = (detailText = "") => {
  const raw = String(detailText || "").trim();
  if (!raw) return { message: "", status: "", code: "" };
  const parsed = parseJsonSafe(raw);
  const errorObj = parsed?.error && typeof parsed.error === "object" ? parsed.error : {};
  return {
    message: sanitizeMessage(errorObj?.message || raw),
    status: String(errorObj?.status || "").trim().toUpperCase(),
    code: String(errorObj?.code || "").trim(),
  };
};

const parseDataUrl = (value) => {
  const match = String(value || "").match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const base64 = String(match[2] || "").replace(/\s+/g, "");
  const padding = (base64.match(/=+$/)?.[0]?.length || 0);
  const bytes = Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
  if (!bytes) return null;
  if (bytes > MAX_IMAGE_BYTES) {
    throw createHttpError(413, "Uploaded image is too large.", "payload_too_large");
  }
  return {
    mime,
    base64,
    dataUrl: `data:${mime};base64,${base64}`,
  };
};

const getImagePayload = async (fileUrl) => {
  const inline = parseDataUrl(fileUrl);
  if (inline) return inline;
  if (String(fileUrl || "").startsWith("blob:")) {
    throw createHttpError(400, "Image upload failed. Please retry and run diagnosis again.", "upload_failed");
  }
  throw createHttpError(400, "A valid transient image file_url is required for diagnosis.", "invalid_file_url");
};

const parseMessageText = (content) => {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof item.text === "string") return item.text;
      if (item && typeof item === "object" && typeof item.output_text === "string") return item.output_text;
      return "";
    })
    .join("\n")
    .trim();
};

const parseModelJson = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  let text = String(value || "").trim();
  if (!text) return null;
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const direct = parseJsonSafe(text);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const sliced = parseJsonSafe(text.slice(start, end + 1));
    if (sliced && typeof sliced === "object" && !Array.isArray(sliced)) return sliced;
  }
  return null;
};

const deriveSeverity = (infectionLevel) => {
  if (infectionLevel <= 20) return "low";
  if (infectionLevel <= 50) return "medium";
  if (infectionLevel <= 80) return "high";
  return "critical";
};

const toPercent = (value, fallback = 0) => {
  let parsed = toNumber(value, fallback);
  if (parsed >= 0 && parsed <= 1) parsed *= 100;
  return clamp(Math.round(parsed), 0, 100);
};

const inferDiseaseType = (diseaseName, diseaseTypeHint) => {
  const explicit = normalizeText(diseaseTypeHint);
  if (explicit && explicit !== "uncertain") return explicit;

  const disease = normalizeText(diseaseName);
  if (!disease || disease.includes("healthy") || disease.includes("no disease")) return "none";
  if (
    disease.includes("rust") ||
    disease.includes("blight") ||
    disease.includes("mildew") ||
    disease.includes("mold") ||
    disease.includes("spot") ||
    disease.includes("scab") ||
    disease.includes("anthracnose") ||
    disease.includes("rot")
  ) {
    return "fungal";
  }
  if (disease.includes("canker") || disease.includes("bacterial")) return "bacterial";
  if (disease.includes("virus") || disease.includes("mosaic") || disease.includes("viroid")) return "viral";
  if (
    disease.includes("nutrient") ||
    disease.includes("deficiency") ||
    disease.includes("stress") ||
    disease.includes("sunscald") ||
    disease.includes("edema")
  ) {
    return "physiological";
  }
  if (
    disease.includes("aphid") ||
    disease.includes("thrip") ||
    disease.includes("mite") ||
    disease.includes("insect") ||
    disease.includes("pest")
  ) {
    return "pest_related";
  }
  return "uncertain";
};

const buildProbableCauses = ({ diseaseType, symptoms = [] }) => {
  const causes = [];
  if (diseaseType === "fungal") {
    causes.push("Prolonged leaf wetness and elevated humidity.");
    causes.push("Poor canopy airflow increasing moisture retention.");
  } else if (diseaseType === "bacterial") {
    causes.push("Rain splash or wound-based bacterial entry on tender tissue.");
    causes.push("Tool or handling transmission between plants.");
  } else if (diseaseType === "viral") {
    causes.push("Vector transmission from insects such as aphids or whiteflies.");
    causes.push("Infected plant material or volunteer hosts nearby.");
  } else if (diseaseType === "physiological") {
    causes.push("Nutrient imbalance or uneven nutrient uptake.");
    causes.push("Irrigation stress or abrupt weather stress exposure.");
  }

  const symptomText = symptoms.map((item) => normalizeText(item)).join(" ");
  if (symptomText.includes("yellow") || symptomText.includes("chlorosis")) {
    causes.push("Chlorosis pattern indicates nutrient or vascular stress.");
  }
  if (symptomText.includes("lesion") || symptomText.includes("spot")) {
    causes.push("Lesion progression suggests active tissue damage on foliage.");
  }

  return causes.filter(Boolean).slice(0, 4);
};

const buildImmediateActions = ({ diseaseType, isHealthy, symptoms = [] }) => {
  if (isHealthy) {
    return [
      "Continue routine scouting every 3-4 days.",
      "Maintain balanced irrigation and nutrient schedule.",
      "Re-scan if visible lesions or discoloration develop.",
    ];
  }

  const actions = [
    "Isolate or mark affected plants/rows for targeted monitoring.",
    "Remove heavily affected leaves to reduce spread pressure.",
    "Avoid overhead irrigation during active lesion periods.",
  ];

  if (diseaseType === "fungal") {
    actions.unshift("Start preventive fungicide rotation based on crop label and resistance group guidance.");
  } else if (diseaseType === "bacterial") {
    actions.unshift("Begin bactericide-compatible program where local regulations permit.");
  } else if (diseaseType === "viral") {
    actions.unshift("Prioritize vector control and rogue severely infected plants.");
  } else if (diseaseType === "physiological") {
    actions.unshift("Correct irrigation and nutrition before applying chemical controls.");
  }

  if (!symptoms.length) {
    actions.push("Capture a closer image in daylight for stronger symptom evidence.");
  }

  return actions.slice(0, 5);
};

const normalizeDiagnosis = (raw = {}) => {
  const plantNameHint = toText(raw.plant_name ?? raw.plantName ?? raw.plant, "");
  const isPlantHint = normalizeText(plantNameHint);
  const isPlant =
    Boolean(raw.is_plant ?? raw.isPlant ?? true) &&
    !["not a plant", "non-plant", "not plant", "not applicable"].includes(isPlantHint);

  const diseaseName = toText(raw.disease_name ?? raw.disease ?? raw.diseaseName, "");
  const diseaseText = diseaseName.toLowerCase();
  const diseaseType = inferDiseaseType(diseaseName, raw.disease_type ?? raw.diseaseType);
  const inferredHealthy =
    diseaseText.includes("no disease") ||
    diseaseText.includes("healthy") ||
    diseaseType === "none";
  const isHealthy = Boolean(raw.is_healthy ?? raw.isHealthy) || inferredHealthy;
  const symptoms = toStringArray(raw.symptoms ?? raw.visibleSymptoms ?? raw.keySymptoms);

  const confidenceDefault = isPlant ? (isHealthy ? 82 : symptoms.length > 0 ? 76 : 68) : 22;
  const confidence = toPercent(raw.confidence_score ?? raw.confidence ?? raw.confidenceScore, confidenceDefault);
  const infectionLevel = toPercent(raw.infection_level ?? raw.infectionLevel, 0);
  const probableCausesInput = toStringArray(raw.probable_causes ?? raw.probableCauses);
  const probableCauses = probableCausesInput.length > 0 ? probableCausesInput : buildProbableCauses({ diseaseType, symptoms });
  const immediateActionsInput = toStringArray(raw.immediate_actions ?? raw.immediateActions);
  const immediateActions =
    immediateActionsInput.length > 0
      ? immediateActionsInput
      : buildImmediateActions({ diseaseType, isHealthy, symptoms });

  const requiresManualReview =
    Boolean(raw.requires_manual_review ?? raw.requiresManualReview) ||
    !isPlant ||
    (!isHealthy && diseaseType === "uncertain") ||
    confidence < MIN_RELIABLE_CONFIDENCE;

  return {
    is_plant: isPlant,
    plant_name: isPlant ? toText(raw.plant_name ?? raw.plantName ?? raw.plant, "Unknown plant") : "Not a plant",
    scientific_name: isPlant ? toText(raw.scientific_name ?? raw.scientificName, "Unknown") : "N/A",
    disease_name: isPlant
      ? isHealthy
        ? "Healthy - No Disease Detected"
        : toText(diseaseName, "Uncertain disease pattern")
      : "Non-plant image",
    disease_type: isPlant ? diseaseType : "non_plant",
    infection_level: isPlant && !isHealthy ? infectionLevel : 0,
    severity: isPlant && !isHealthy ? deriveSeverity(infectionLevel) : "low",
    confidence_score: confidence,
    symptoms,
    pathogen_signs: toStringArray(raw.pathogen_signs),
    is_healthy: isPlant ? isHealthy : false,
    requires_manual_review: requiresManualReview,
    diagnosis_notes: toText(raw.diagnosis_notes ?? raw.diagnosisNotes ?? raw.analysis_notes, ""),
    probable_causes: probableCauses,
    immediate_actions: immediateActions,
    rejection_reason: !isPlant ? toText(raw.rejection_reason ?? raw.rejectionReason, "The uploaded image is not a plant image.") : "",
  };
};

const buildPrompt = (plantReference) => `You are an expert in plant pathology. Your task is to analyze the provided image of a plant.

First, identify the plant in the image.

Then, diagnose any potential diseases. To ensure high accuracy, you must cross-reference the visual information from the image with your extensive knowledge base, which includes data from the internet and agricultural websites. Consider symptoms, patterns, and common diseases for the type of plant you identified.

Based on your comprehensive analysis, provide the following:
1. Plant Name: The common name of the plant identified from the image.
2. Disease Diagnosis: Identify the specific disease. If no disease is detected, state that clearly.
3. Infection Level: Estimate the infection level as a percentage from 0 to 100.

If the image is not a real plant (cartoon, anime, toy, object, UI screenshot, person, etc.), return:
- plantName: "Not a plant"
- disease: "Not applicable"
- infectionLevel: 0
- isPlant: false

Known crops in this tenant (for context only):
${plantReference || "No local plant database provided."}

Provide the response as strict JSON with these keys:
plantName, disease, diseaseType, infectionLevel, isPlant, confidence, symptoms, diagnosisNotes, probableCauses, immediateActions

Confidence must be a numeric score between 0 and 100 (not 0-1).

Return 0 for infectionLevel if no disease is detected.`;

const buildOpenAiResponseSchema = () => ({
  type: "json_schema",
  json_schema: {
    name: "plant_diagnosis",
    strict: false,
    schema: {
      type: "object",
      properties: {
        plantName: { type: "string" },
        disease: { type: "string" },
        diseaseType: { type: "string" },
        infectionLevel: { type: "number" },
        isPlant: { type: "boolean" },
        confidence: { type: "number" },
        symptoms: { type: "array", items: { type: "string" } },
        diagnosisNotes: { type: "string" },
        probableCauses: { type: "array", items: { type: "string" } },
        immediateActions: { type: "array", items: { type: "string" } },
      },
      required: ["plantName", "disease", "infectionLevel"],
      additionalProperties: true,
    },
  },
});

const makeOpenAiCallError = (status, detailText = "") => {
  const details = parseOpenAiError(detailText);
  if (status === 401 || status === 403 || isGeminiAuthError(details)) {
    return createHttpError(502, details.message || "Diagnosis AI authentication failed. Check OPENAI_API_KEY and model access.", "ai_auth_failed");
  }
  if (status === 429) {
    if (details.code === "insufficient_quota") {
      return createHttpError(503, "Diagnosis AI quota exceeded. Add billing/credits or switch provider.", "ai_quota_exceeded");
    }
    return createHttpError(503, details.message || "Diagnosis AI rate limit reached. Retry shortly.", "ai_rate_limited");
  }
  if (status === 400 || status === 404 || status === 422) {
    return createHttpError(502, details.message || "Diagnosis model rejected the request. Check model configuration and payload.", "ai_bad_request");
  }
  return createHttpError(502, details.message || "Unable to complete diagnosis model request.", "ai_call_failed");
};

const makeGeminiCallError = (status, detailText = "") => {
  const details = parseGeminiError(detailText);
  if (status === 401 || status === 403 || isGeminiAuthError(details)) {
    return createHttpError(502, details.message || "Gemini authentication failed. Check GEMINI_API_KEY and model access.", "ai_auth_failed");
  }
  if (status === 429 || details.status === "RESOURCE_EXHAUSTED") {
    return createHttpError(503, details.message || "Gemini rate limit reached. Retry shortly.", "ai_rate_limited");
  }
  if (status === 400 || status === 404 || status === 422 || details.status === "INVALID_ARGUMENT") {
    return createHttpError(502, details.message || "Gemini rejected the diagnosis request. Check model and payload.", "ai_bad_request");
  }
  return createHttpError(502, details.message || "Unable to complete Gemini diagnosis request.", "ai_call_failed");
};

const callOpenAiDiagnosis = async ({ image, plantReference, env }) => {
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (isPlaceholderSecret(apiKey)) {
    throw createHttpError(503, "OpenAI key is not configured.", "ai_not_configured");
  }

  const model = String(env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
  const timeoutMs = clamp(toNumber(env.OPENAI_TIMEOUT_MS, 20000), 5000, 60000);
  const maxOutputTokens = clamp(Math.round(toNumber(env.AI_MAX_OUTPUT_TOKENS, 1200)), 300, 4096);

  const basePayload = {
    model,
    temperature: 0,
    max_tokens: maxOutputTokens,
    messages: [
      {
        role: "system",
        content: "You are a strict crop diagnosis engine. Respond with JSON only, use visible evidence, and avoid fabricated certainty.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: buildPrompt(plantReference) },
          { type: "image_url", image_url: { url: image.dataUrl, detail: "high" } },
        ],
      },
    ],
  };

  const attempts = [
    { ...basePayload, response_format: buildOpenAiResponseSchema() },
    { ...basePayload, response_format: { type: "json_object" } },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let lastError = null;
    for (let idx = 0; idx < attempts.length; idx += 1) {
      const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(attempts[idx]),
      });

      if (!response.ok) {
        const details = await response.text();
        lastError = makeOpenAiCallError(response.status, details);
        if ((response.status === 400 || response.status === 422) && idx === 0) continue;
        throw lastError;
      }

      const json = await response.json();
      const messageText = parseMessageText(json?.choices?.[0]?.message?.content);
      const parsed = parseModelJson(messageText);
      if (!parsed) {
        lastError = createHttpError(502, "Diagnosis model returned invalid JSON.", "ai_invalid_response");
        continue;
      }
      return { raw: parsed, provider: "openai", model };
    }
    throw lastError || createHttpError(502, "Diagnosis model returned invalid JSON.", "ai_invalid_response");
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createHttpError(504, "Diagnosis model timed out.", "ai_timeout");
    }
    if (error?.status) throw error;
    throw createHttpError(502, "Unable to complete diagnosis model request.", "ai_call_failed");
  } finally {
    clearTimeout(timer);
  }
};

const callGeminiDiagnosis = async ({ image, plantReference, env }) => {
  const apiKey = String(env.GEMINI_API_KEY || "").trim();
  if (isPlaceholderSecret(apiKey)) {
    throw createHttpError(503, "Gemini API key is not configured. Replace GEMINI_API_KEY with a real key.", "ai_not_configured");
  }

  const model = String(env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const baseUrl = String(env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE_URL).trim() || DEFAULT_GEMINI_BASE_URL;
  const timeoutMs = clamp(toNumber(env.GEMINI_TIMEOUT_MS, 25000), 5000, 90000);
  const maxOutputTokens = clamp(Math.round(toNumber(env.AI_MAX_OUTPUT_TOKENS, 1200)), 300, 4096);
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: buildPrompt(plantReference) },
          {
            inlineData: {
              mimeType: image.mime,
              data: image.base64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens,
      responseMimeType: "application/json",
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const details = await response.text();
      throw makeGeminiCallError(response.status, details);
    }

    const json = await response.json();
    if (json?.promptFeedback?.blockReason) {
      throw createHttpError(422, "Diagnosis request was blocked by safety filters. Upload a clear crop-only image.", "ai_safety_blocked");
    }

    const messageText = parseMessageText(json?.candidates?.[0]?.content?.parts);
    const parsed = parseModelJson(messageText);
    if (!parsed) {
      throw createHttpError(502, "Gemini returned invalid JSON.", "ai_invalid_response");
    }
    return { raw: parsed, provider: "gemini", model };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createHttpError(504, "Diagnosis model timed out.", "ai_timeout");
    }
    if (error?.status) throw error;
    throw createHttpError(502, "Unable to complete Gemini diagnosis request.", "ai_call_failed");
  } finally {
    clearTimeout(timer);
  }
};

const shouldFallback = (errorCode) => ["ai_not_configured", "ai_quota_exceeded", "ai_rate_limited", "ai_auth_failed"].includes(String(errorCode || ""));

const resolveProviderOrder = (env) => {
  const requested = normalizeText(env.AI_PROVIDER || "auto");
  const hasGemini = Boolean(String(env.GEMINI_API_KEY || "").trim());
  const hasOpenAi = Boolean(String(env.OPENAI_API_KEY || "").trim());

  if (requested === "gemini") return ["gemini"];
  if (requested === "openai") return ["openai"];
  if (hasGemini && hasOpenAi) return ["gemini", "openai"];
  if (hasGemini) return ["gemini"];
  if (hasOpenAi) return ["openai"];
  return ["gemini", "openai"];
};

const runDiagnosisByProvider = async ({ image, plantReference, env }) => {
  const allowFallback = String(env.ALLOW_AI_PROVIDER_FALLBACK || "true").toLowerCase() !== "false";
  const order = resolveProviderOrder(env);
  let lastError = null;

  for (let index = 0; index < order.length; index += 1) {
    const provider = order[index];
    try {
      if (provider === "gemini") return await callGeminiDiagnosis({ image, plantReference, env });
      return await callOpenAiDiagnosis({ image, plantReference, env });
    } catch (error) {
      lastError = error;
      const isLast = index === order.length - 1;
      if (isLast || !allowFallback || !shouldFallback(error?.code)) {
        throw error;
      }
    }
  }

  throw lastError || createHttpError(503, "No AI provider is configured for diagnosis.", "ai_not_configured");
};

const listPlantReference = async (env) => {
  if (!env?.DB) return [];
  try {
    const result = await env.DB.prepare(
      "SELECT payload_json FROM entity_records WHERE entity_name = ?1 ORDER BY updated_date DESC LIMIT 250"
    )
      .bind("PlantDatabase")
      .all();
    const rows = Array.isArray(result?.results) ? result.results : [];
    return rows
      .map((row) => parseJsonSafe(row?.payload_json))
      .filter((entry) => entry && typeof entry === "object");
  } catch {
    return [];
  }
};

export const diagnosePlantImage = async ({ fileUrl, env }) => {
  if (!fileUrl || typeof fileUrl !== "string") {
    throw createHttpError(400, "A valid file_url is required for diagnosis.", "invalid_file_url");
  }

  const plantDatabase = await listPlantReference(env);
  const plantReference = plantDatabase
    .slice(0, 250)
    .map((entry) => {
      const common = toText(entry?.common_name, "Unknown");
      const scientific = toText(entry?.scientific_name, "Unknown");
      return `${common} (${scientific})`;
    })
    .join(", ");

  const image = await getImagePayload(fileUrl);
  const diagnosisRun = await runDiagnosisByProvider({ image, plantReference, env });
  const normalized = normalizeDiagnosis(diagnosisRun.raw);

  return {
    ...normalized,
    model_provider: diagnosisRun.provider,
    model_name: diagnosisRun.model,
    pipeline_version: DIAGNOSIS_PIPELINE_VERSION,
    confidence_threshold: MIN_RELIABLE_CONFIDENCE,
  };
};

