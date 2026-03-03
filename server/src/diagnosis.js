import path from "node:path";
import { readFile } from "node:fs/promises";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIN_RELIABLE_CONFIDENCE = 65;
const DEFAULT_MODEL = "gpt-4o-mini";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

const MIME_BY_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

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

const parseJsonSafe = (value) => {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
};

const makeError = (status, code, message) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const sanitizeOpenAiMessage = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 360);

const normalizeUploadsPublicPath = (value) => `/${String(value || "/uploads").replace(/^\/+|\/+$/g, "")}`;

const parseDataUrl = (value) => {
  const match = String(value || "").match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) return null;
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw makeError(413, "payload_too_large", "Uploaded image is too large.");
  }
  return {
    mime: match[1].toLowerCase(),
    dataUrl: value,
  };
};

const resolveUploadedImage = async (fileUrl, options = {}) => {
  const uploadDir = String(options.uploadDir || "");
  if (!uploadDir) {
    throw makeError(500, "upload_dir_unavailable", "Upload directory is not configured.");
  }
  const uploadsPublicPath = normalizeUploadsPublicPath(options.uploadsPublicPath || "/uploads");
  if (!String(fileUrl || "").startsWith(`${uploadsPublicPath}/`)) {
    throw makeError(400, "invalid_file_url", "Diagnosis expects an uploaded image path.");
  }

  const fileName = path.basename(String(fileUrl));
  const uploadRoot = path.resolve(uploadDir);
  const absolutePath = path.resolve(uploadRoot, fileName);
  if (!absolutePath.startsWith(uploadRoot)) {
    throw makeError(400, "invalid_file_url", "Invalid file path.");
  }

  const buffer = await readFile(absolutePath);
  if (!buffer.length) {
    throw makeError(400, "invalid_image", "Uploaded image is empty.");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw makeError(413, "payload_too_large", "Uploaded image is too large.");
  }

  const ext = path.extname(fileName).toLowerCase();
  const mime = MIME_BY_EXTENSION[ext] || "image/jpeg";
  return {
    mime,
    dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
  };
};

const getImageDataUrl = async (fileUrl, options = {}) => {
  const inline = parseDataUrl(fileUrl);
  if (inline) return inline.dataUrl;
  if (String(fileUrl || "").startsWith("blob:")) {
    throw makeError(400, "upload_failed", "Image upload failed. Please retry and run diagnosis again.");
  }
  const uploaded = await resolveUploadedImage(fileUrl, options);
  return uploaded.dataUrl;
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

const normalizeDiagnosis = (raw = {}) => {
  const plantNameHint = toText(raw.plant_name ?? raw.plantName, "");
  const isPlantHint = normalizeText(plantNameHint);
  const isPlant =
    Boolean(raw.is_plant ?? raw.isPlant ?? true) &&
    !["not a plant", "non-plant", "not plant", "not applicable"].includes(isPlantHint);
  const diseaseText = toText(raw.disease_name ?? raw.disease, "").toLowerCase();
  const diseaseType = toText(raw.disease_type, "uncertain").toLowerCase();
  const inferredHealthy =
    diseaseText.includes("no disease") ||
    diseaseText.includes("healthy") ||
    diseaseType === "none";
  const isHealthy = Boolean(raw.is_healthy ?? raw.isHealthy) || inferredHealthy;
  const confidenceRaw =
    raw.confidence_score ??
    raw.confidence ??
    (isPlant ? (isHealthy ? 78 : 72) : 25);
  const confidence = clamp(Math.round(toNumber(confidenceRaw, 0)), 0, 100);
  const infectionLevel = clamp(
    Math.round(toNumber(raw.infection_level ?? raw.infectionLevel, 0)),
    0,
    100
  );

  const requiresManualReview =
    Boolean(raw.requires_manual_review) ||
    !isPlant ||
    diseaseType === "uncertain" ||
    confidence < MIN_RELIABLE_CONFIDENCE;

  return {
    is_plant: isPlant,
    plant_name: isPlant ? toText(raw.plant_name ?? raw.plantName, "Unknown plant") : "Not a plant",
    scientific_name: isPlant ? toText(raw.scientific_name, "Unknown") : "N/A",
    disease_name: isPlant
      ? isHealthy
        ? "Healthy - No Disease Detected"
        : toText(raw.disease_name ?? raw.disease, "Uncertain disease pattern")
      : "Non-plant image",
    disease_type: isPlant ? diseaseType : "non_plant",
    infection_level: isPlant && !isHealthy ? infectionLevel : 0,
    severity: isPlant && !isHealthy ? deriveSeverity(infectionLevel) : "low",
    confidence_score: confidence,
    symptoms: toStringArray(raw.symptoms ?? raw.visibleSymptoms),
    pathogen_signs: toStringArray(raw.pathogen_signs),
    is_healthy: isPlant ? isHealthy : false,
    requires_manual_review: requiresManualReview,
    diagnosis_notes: toText(raw.diagnosis_notes ?? raw.diagnosisNotes, ""),
    probable_causes: toStringArray(raw.probable_causes),
    immediate_actions: toStringArray(raw.immediate_actions),
    rejection_reason: !isPlant ? toText(raw.rejection_reason, "The uploaded image is not a plant image.") : "",
  };
};

const normalizeText = (value) => String(value ?? "").trim().toLowerCase();

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
plantName, disease, infectionLevel, isPlant, confidence, symptoms, diagnosisNotes

Return 0 for infectionLevel if no disease is detected.`;

const buildResponseSchema = () => ({
  type: "json_schema",
  json_schema: {
    name: "plant_diagnosis",
    strict: false,
    schema: {
      type: "object",
      properties: {
        plantName: { type: "string" },
        disease: { type: "string" },
        infectionLevel: { type: "number" },
        isPlant: { type: "boolean" },
        confidence: { type: "number" },
        symptoms: {
          type: "array",
          items: { type: "string" },
        },
        diagnosisNotes: { type: "string" },
      },
      required: ["plantName", "disease", "infectionLevel"],
      additionalProperties: true,
    },
  },
});

const makeAiCallError = (status, detailText = "") => {
  const details = sanitizeOpenAiMessage(detailText);
  if (status === 401 || status === 403) {
    return makeError(
      502,
      "ai_auth_failed",
      details || "Diagnosis AI authentication failed. Check OPENAI_API_KEY and model access."
    );
  }
  if (status === 429) {
    return makeError(
      503,
      "ai_rate_limited",
      details || "Diagnosis AI rate limit reached. Please retry in a moment."
    );
  }
  if (status === 400 || status === 404 || status === 422) {
    return makeError(
      502,
      "ai_bad_request",
      details || "Diagnosis model rejected the request. Check model configuration and payload."
    );
  }
  return makeError(502, "ai_call_failed", details || "Unable to complete diagnosis model request.");
};

const callOpenAiDiagnosis = async ({ dataUrl, plantReference, ai }) => {
  const apiKey = String(ai?.openAiApiKey || "").trim();
  if (!apiKey) {
    throw makeError(503, "ai_not_configured", "Diagnosis AI is not configured on the server.");
  }

  const model = String(ai?.openAiModel || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const timeoutMs = clamp(toNumber(ai?.openAiTimeoutMs, 18000), 5000, 60000);
  const maxOutputTokens = clamp(Math.round(toNumber(ai?.maxOutputTokens, 1200)), 300, 4096);

  const basePayload = {
    model,
    temperature: 0,
    max_tokens: maxOutputTokens,
    messages: [
      {
        role: "system",
        content:
          "You are a strict crop diagnosis engine. Respond with JSON only, use visible evidence, and avoid fabricated certainty.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: buildPrompt(plantReference) },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
  };

  const attempts = [
    { ...basePayload, response_format: buildResponseSchema() },
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
        lastError = makeAiCallError(response.status, details);
        // Some models reject json_schema. Retry once with json_object.
        if ((response.status === 400 || response.status === 422) && idx === 0) {
          continue;
        }
        throw lastError;
      }

      const json = await response.json();
      const messageText = parseMessageText(json?.choices?.[0]?.message?.content);
      const parsed = parseModelJson(messageText);
      if (!parsed) {
        lastError = makeError(502, "ai_invalid_response", "Diagnosis model returned invalid JSON.");
        continue;
      }
      return parsed;
    }
    throw lastError || makeError(502, "ai_invalid_response", "Diagnosis model returned invalid JSON.");
  } catch (error) {
    if (error?.name === "AbortError") {
      throw makeError(504, "ai_timeout", "Diagnosis model timed out.");
    }
    if (error?.status) throw error;
    throw makeError(502, "ai_call_failed", "Unable to complete diagnosis model request.");
  } finally {
    clearTimeout(timer);
  }
};

export async function diagnosePlantImage({ fileUrl, plantDatabase = [], ai = {}, uploadDir, uploadsPublicPath }) {
  if (!fileUrl || typeof fileUrl !== "string") {
    throw makeError(400, "invalid_file_url", "A valid file_url is required for diagnosis.");
  }

  const plantReference = Array.isArray(plantDatabase)
    ? plantDatabase
        .slice(0, 250)
        .map((entry) => {
          const common = toText(entry?.common_name, "Unknown");
          const scientific = toText(entry?.scientific_name, "Unknown");
          return `${common} (${scientific})`;
        })
        .join(", ")
    : "";

  const dataUrl = await getImageDataUrl(fileUrl, { uploadDir, uploadsPublicPath });
  const raw = await callOpenAiDiagnosis({ dataUrl, plantReference, ai });
  return normalizeDiagnosis(raw);
}
