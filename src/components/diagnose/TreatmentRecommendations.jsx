import { useEffect, useMemo, useState } from "react";
import { appClient } from "@/api/appClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Beaker, Leaf, ChevronDown, ChevronUp, RefreshCw, Heart, Star, ShieldAlert } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const normalizeKey = (value) => String(value || "").trim().toLowerCase();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const inferDiseaseBucket = (diagnosis) => {
  const disease = normalizeKey(diagnosis?.disease_name);
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
  if (disease.includes("nutrient") || disease.includes("deficiency") || disease.includes("stress") || disease.includes("sunscald")) {
    return "physiological";
  }
  return "general";
};

const buildFallbackTreatments = (diagnosis) => {
  const plant = diagnosis?.plant_name || "Crop";
  const disease = diagnosis?.disease_name || "observed disease";
  const severity = normalizeKey(diagnosis?.severity);
  const provisional = Boolean(diagnosis?.requires_manual_review);
  const bucket = inferDiseaseBucket(diagnosis);
  const baseSafety = provisional
    ? ["Confirm with a clearer image before aggressive chemical use.", "Follow crop label, PHI, and local restrictions."]
    : ["Wear gloves, eye protection, and follow crop label directions.", "Rotate active ingredient groups to reduce resistance risk."];

  if (bucket === "fungal") {
    return [
      {
        name: `${plant} protectant copper spray`,
        type: "chemical",
        proportions: "Use the crop-labeled copper fungicide rate and ensure thorough coverage of both leaf surfaces.",
        frequency: severity === "high" ? "Repeat every 5-7 days during active infection pressure." : "Repeat every 7-10 days during wet periods.",
        description: `Useful as a protectant treatment for ${disease} on ${plant}, especially before new lesions expand after rain or dew events.`,
        safety_precautions: baseSafety,
        effectiveness_rating: 3,
      },
      {
        name: `${plant} systemic fungicide rotation`,
        type: "chemical",
        proportions: "Use a crop-approved systemic fungicide and rotate FRAC groups between applications.",
        frequency: "Apply at the earliest disease window and repeat at 7-14 day intervals according to label and pressure.",
        description: `Provides stronger suppression when ${disease} is already active on ${plant}.`,
        safety_precautions: [...baseSafety, "Do not repeat the same FRAC group consecutively unless the label allows it."],
        effectiveness_rating: 5,
      },
      {
        name: `${plant} Bacillus biofungicide`,
        type: "organic",
        proportions: "Apply a labeled Bacillus-based biofungicide to upper and lower leaf surfaces.",
        frequency: provisional ? "Reapply every 5-7 days while confirming diagnosis." : "Reapply every 7 days under humid conditions.",
        description: `A lower-risk biological option for suppressing fungal surface activity associated with ${disease}.`,
        safety_precautions: ["Best used preventively or at early symptom stage.", "Check tank-mix compatibility before combining with other sprays."],
        effectiveness_rating: 3,
      },
      {
        name: `${plant} sanitation and canopy drying plan`,
        type: "organic",
        proportions: "Remove heavily infected tissue, improve airflow, and avoid late-day overhead irrigation.",
        frequency: "Scout every 2-3 days and repeat sanitation after rain events.",
        description: `Reduces reinfection pressure and leaf wetness duration that typically worsens ${disease} on ${plant}.`,
        safety_precautions: ["Disinfect tools between plants or rows.", "Discard infected material away from production blocks."],
        effectiveness_rating: 4,
      },
    ];
  }

  if (bucket === "bacterial") {
    return [
      {
        name: `${plant} copper bactericide protectant`,
        type: "chemical",
        proportions: "Use a crop-labeled copper bactericide rate with complete coverage of susceptible tissue.",
        frequency: "Repeat every 5-7 days during rain or splash events.",
        description: `Helps reduce surface bacterial spread linked to ${disease} on ${plant}.`,
        safety_precautions: baseSafety,
        effectiveness_rating: 3,
      },
      {
        name: `${plant} targeted bactericide program`,
        type: "chemical",
        proportions: "Use only crop- and region-approved bactericide options where label and regulation allow.",
        frequency: "Apply within label intervals during active infection pressure.",
        description: `Provides stronger suppression when ${disease} is already established and weather favors bacterial spread.`,
        safety_precautions: [...baseSafety, "Verify local legal approval before using antibiotic-based bactericides."],
        effectiveness_rating: 4,
      },
      {
        name: `${plant} sanitation and splash reduction`,
        type: "organic",
        proportions: "Remove infected tissue and stop overhead irrigation where possible.",
        frequency: "Repeat weekly and after storms.",
        description: `Critical for bacterial issues because splash spread and tool transfer often intensify ${disease}.`,
        safety_precautions: ["Disinfect tools between cuts.", "Avoid handling plants while foliage is wet."],
        effectiveness_rating: 4,
      },
      {
        name: `${plant} biological leaf protectant`,
        type: "organic",
        proportions: "Apply a labeled biological leaf protectant based on Bacillus or related beneficial microbes.",
        frequency: "Reapply every 5-7 days during high humidity periods.",
        description: `Useful as a lower-risk support option for ${disease}, especially in provisional mode.`,
        safety_precautions: ["Use within an integrated program rather than as a stand-alone cure."],
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
        description: `There is no curative chemistry for ${disease}; control focuses on the vectors spreading it in ${plant}.`,
        safety_precautions: baseSafety,
        effectiveness_rating: 4,
      },
      {
        name: `${plant} horticultural oil vector suppression`,
        type: "chemical",
        proportions: "Apply labeled horticultural oil or soap to suppress vector pressure on new growth.",
        frequency: "Repeat every 5-7 days while vector pressure persists.",
        description: `Helps reduce virus spread pressure by lowering active vector feeding.`,
        safety_precautions: ["Do not apply during extreme heat.", "Check compatibility with recent sulfur or oil sprays."],
        effectiveness_rating: 3,
      },
      {
        name: `${plant} rogue infected plants and weeds`,
        type: "organic",
        proportions: "Remove severely symptomatic plants and nearby alternative hosts that can harbor vectors or virus sources.",
        frequency: "Inspect every 2-3 days during spread periods.",
        description: `Reduces secondary spread sources when ${disease} is likely viral and already visible.`,
        safety_precautions: ["Bag infected material and remove it from the field."],
        effectiveness_rating: 5,
      },
      {
        name: `${plant} biological vector management`,
        type: "organic",
        proportions: "Use biological controls or trap-based suppression suitable for the actual vector complex.",
        frequency: "Maintain through the vector activity window.",
        description: `Supports lower-residue vector suppression while managing likely virus transmission in ${plant}.`,
        safety_precautions: ["Match biological controls to the identified vector before release or application."],
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
        frequency: "Monitor soil moisture daily until symptoms stabilize.",
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
        safety_precautions: ["Use only as support; fix the underlying water or nutrient issue first."],
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

const normalizeTreatmentEntry = (candidate, fallback) => {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const type = String(source.type || fallback.type).toLowerCase() === "organic" ? "organic" : "chemical";
  const safety = Array.isArray(source.safety_precautions)
    ? source.safety_precautions.filter(Boolean).slice(0, 6)
    : typeof source.safety === "string" && source.safety.trim()
      ? [source.safety.trim()]
      : fallback.safety_precautions;

  return {
    name: String(source.name || fallback.name),
    type,
    proportions: String(source.proportions || source.application_method || source.instructions || fallback.proportions),
    frequency: String(source.frequency || fallback.frequency),
    description: String(source.description || fallback.description),
    safety_precautions: safety,
    effectiveness_rating: clamp(Math.round(Number.parseFloat(String(source.effectiveness_rating ?? fallback.effectiveness_rating)) || fallback.effectiveness_rating), 1, 5),
    id: source.id || fallback.id || undefined,
  };
};

const normalizeTreatmentSet = (items, diagnosis) => {
  const fallbacks = buildFallbackTreatments(diagnosis);
  const source = Array.isArray(items) ? items : [];
  return fallbacks.map((fallback, index) => normalizeTreatmentEntry(source[index], fallback)).slice(0, 4);
};

export default function TreatmentRecommendations({ diagnosis }) {
  const [treatments, setTreatments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [savedTreatments, setSavedTreatments] = useState([]);
  const [loadError, setLoadError] = useState("");

  const shouldDisableTreatments =
    diagnosis?.is_healthy ||
    !diagnosis?.disease_name ||
    String(diagnosis?.disease_name || "").toLowerCase().includes("uncertain");

  const isProvisional = Boolean(diagnosis?.requires_manual_review);
  const diagnosisSignature = `${normalizeKey(diagnosis?.plant_name)}|${normalizeKey(diagnosis?.disease_name)}`;
  const fallbackTreatments = useMemo(() => normalizeTreatmentSet([], diagnosis), [diagnosis]);

  const fetchTreatments = async ({ forceRefresh = false } = {}) => {
    if (shouldDisableTreatments) {
      setTreatments([]);
      setLoadError("");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError("");
    try {
      const scopedTreatments = await appClient.entities.Treatment.filter({
        disease_name: diagnosis.disease_name,
        diagnosis_signature: diagnosisSignature,
      });
      const normalizedScopedTreatments = normalizeTreatmentSet(
        scopedTreatments.map((t) => ({
          name: t.treatment_name,
          type: t.treatment_type,
          proportions: t.application_method || "See description",
          frequency: t.frequency || "",
          description: t.description,
          safety_precautions: t.safety_precautions,
          effectiveness_rating: t.effectiveness_rating,
          id: t.id,
        })),
        diagnosis
      );
      const hasCompleteScopedSet =
        scopedTreatments.length >= 4 &&
        normalizedScopedTreatments.every(
          (t) => String(t?.name || "").trim() && String(t?.description || "").trim() && String(t?.frequency || "").trim()
        );

      if (hasCompleteScopedSet && !forceRefresh) {
        setTreatments(normalizedScopedTreatments);
      } else {
        const result = await appClient.integrations.Core.InvokeLLM({
          prompt: `You are an expert plant pathologist creating crop-specific, disease-specific treatment recommendations.

Plant: ${diagnosis.plant_name}
Disease: ${diagnosis.disease_name}
Infection Level: ${diagnosis.infection_level || diagnosis.confidence_score}%
Severity: ${diagnosis.severity || "not provided"}
Symptoms: ${(diagnosis.symptoms || []).join(", ") || "not provided"}
Diagnosis Notes: ${diagnosis.diagnosis_notes || "not provided"}
Confidence Mode: ${isProvisional ? "provisional_low_confidence" : "verified_high_confidence"}

Rules:
- Recommendations must be specific to this exact plant and disease pair.
- Do not include treatments that are irrelevant to this disease or host crop.
- Include clear application frequency and timing windows.
- Prefer integrated management and resistance-rotation safe practices.
- If confidence mode is provisional, include lower-risk first-line options before aggressive systemic options.

Provide exactly 4 treatment options: 2 chemical and 2 organic/biological.
For each treatment provide:
1. Treatment name
2. Type (chemical or organic)
3. Application method and proportions
4. Frequency
5. Description (why this is specific to this diagnosis)
6. Safety precautions (array)
7. Effectiveness rating (1-5)`,
          ...(diagnosis?.image_url ? { file_urls: [diagnosis.image_url] } : {}),
          response_json_schema: {
            type: "object",
            properties: {
              treatments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    type: { type: "string", enum: ["chemical", "organic"] },
                    proportions: { type: "string" },
                    frequency: { type: "string" },
                    description: { type: "string" },
                    safety_precautions: { type: "array", items: { type: "string" } },
                    effectiveness_rating: { type: "number" },
                  },
                },
              },
            },
          },
        });

        const nextTreatments = normalizeTreatmentSet(result?.treatments, diagnosis);
        const newlySavedTreatments = [];

        for (let index = 0; index < nextTreatments.length; index += 1) {
          const treatment = nextTreatments[index];
          const payload = {
            disease_name: diagnosis.disease_name,
            treatment_name: treatment.name,
            treatment_type: treatment.type,
            description: treatment.description,
            application_method: treatment.proportions,
            frequency: treatment.frequency || "",
            safety_precautions: treatment.safety_precautions,
            effectiveness_rating: treatment.effectiveness_rating,
            diagnosis_signature: diagnosisSignature,
            plant_name: diagnosis.plant_name,
            is_favorite: false,
          };
          const existing = scopedTreatments[index];
          if (existing?.id) {
            const updated = await appClient.entities.Treatment.update(existing.id, {
              ...payload,
              is_favorite: Boolean(existing.is_favorite),
            });
            newlySavedTreatments.push({ ...treatment, id: updated?.id || existing.id });
          } else {
            const saved = await appClient.entities.Treatment.create(payload);
            newlySavedTreatments.push({ ...treatment, id: saved.id });
          }
        }

        if (forceRefresh && scopedTreatments.length > nextTreatments.length) {
          for (const stale of scopedTreatments.slice(nextTreatments.length)) {
            if (stale?.id) await appClient.entities.Treatment.delete(stale.id);
          }
        }

        setTreatments(newlySavedTreatments.length > 0 ? newlySavedTreatments : fallbackTreatments);
      }
    } catch (fetchError) {
      console.error("Failed to fetch treatments:", fetchError);
      setTreatments(fallbackTreatments);
      setLoadError(fetchError?.message || "Failed to generate treatment recommendations.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTreatments();
  }, [diagnosisSignature, diagnosis?.is_healthy]);

  const toggleExpand = (index) => {
    setExpandedId(expandedId === index ? null : index);
  };

  const saveToWishlist = async (treatment) => {
    try {
      if (treatment.id) {
        await appClient.entities.Treatment.update(treatment.id, { is_favorite: true });
      } else {
        await appClient.entities.Treatment.create({
          disease_name: diagnosis.disease_name,
          treatment_name: treatment.name,
          treatment_type: treatment.type,
          description: treatment.description,
          application_method: treatment.proportions,
          frequency: treatment.frequency || "",
          safety_precautions: treatment.safety_precautions,
          effectiveness_rating: treatment.effectiveness_rating,
          diagnosis_signature: diagnosisSignature,
          plant_name: diagnosis.plant_name,
          is_favorite: true,
        });
      }
      setSavedTreatments([...savedTreatments, treatment.name]);
    } catch (saveError) {
      console.error("Failed to save treatment:", saveError);
    }
  };

  const getTypeIcon = (type) => (type === "chemical" ? Beaker : Leaf);
  const getTypeStyle = (type) => (type === "chemical" ? "text-indigo-700" : "text-violet-700");

  if (isLoading) {
    return (
      <Card className="h-full rounded-3xl border border-white/70 bg-white/75 shadow-xl backdrop-blur-sm">
        <CardContent className="p-8 text-center">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-violet-600" />
          <p className="text-gray-600">Generating treatment recommendations...</p>
        </CardContent>
      </Card>
    );
  }

  if (shouldDisableTreatments) {
    const isHealthy = Boolean(diagnosis?.is_healthy);
    return (
      <Card className="h-full rounded-3xl border border-white/70 bg-white/75 shadow-xl backdrop-blur-sm">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b bg-gradient-to-r from-violet-50/90 to-white p-4">
            <h2 className="text-xl font-bold text-gray-900">Treatment Suggestions</h2>
          </div>
          <div className="p-6">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <ShieldAlert className="h-4 w-4" />
                Treatments paused
              </div>
              {isHealthy
                ? "Plant is marked healthy. Active disease treatments are not required right now."
                : "Recommendations are hidden because disease evidence is unclear."}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full overflow-hidden rounded-3xl border border-white/70 bg-white/75 shadow-xl backdrop-blur-sm">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b bg-gradient-to-r from-violet-50/90 to-white p-4">
          <h2 className="text-xl font-bold text-gray-900">Treatment Suggestions</h2>
          <Button variant="ghost" size="sm" onClick={() => fetchTreatments({ forceRefresh: true })} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refetch Treatments
          </Button>
        </div>

        {loadError ? <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div> : null}

        {isProvisional ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                Provisional recommendations: diagnosis confidence is low. Apply low-risk/organic steps first and verify
                with a clearer image before aggressive chemical treatment.
              </span>
            </div>
          </div>
        ) : null}

        <div className="max-h-[42rem] divide-y overflow-y-auto">
          {treatments.length === 0 ? (
            <div className="space-y-3 p-6 text-sm text-gray-600">
              <p>No treatments are available for this diagnosis yet.</p>
              <Button variant="outline" size="sm" onClick={() => fetchTreatments({ forceRefresh: true })}>
                Retry treatment generation
              </Button>
            </div>
          ) : null}

          {treatments.map((treatment, index) => {
            const Icon = getTypeIcon(treatment.type);
            const isExpanded = expandedId === index;
            const isSaved = savedTreatments.includes(treatment.name);

            return (
              <Collapsible key={index} open={isExpanded} onOpenChange={() => toggleExpand(index)}>
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between p-4 text-left transition-colors hover:bg-violet-50/50">
                    <div className="flex items-center gap-3">
                      <Icon className={`h-5 w-5 ${getTypeStyle(treatment.type)}`} />
                      <span className="font-medium text-gray-900">
                        <span className={`${getTypeStyle(treatment.type)} capitalize`}>{treatment.type}:</span> {treatment.name}
                      </span>
                    </div>
                    {isExpanded ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="space-y-4 bg-violet-50/40 px-4 pb-4">
                    <div>
                      <h4 className="mb-1 font-semibold text-gray-900">Application Method</h4>
                      <p className="text-sm text-gray-700">{treatment.proportions}</p>
                    </div>

                    {treatment.frequency ? (
                      <div>
                        <h4 className="mb-1 font-semibold text-gray-900">Frequency</h4>
                        <p className="text-sm text-gray-700">{treatment.frequency}</p>
                      </div>
                    ) : null}

                    <div>
                      <h4 className="mb-1 font-semibold text-gray-900">Description</h4>
                      <p className="text-sm leading-relaxed text-gray-700">{treatment.description}</p>
                    </div>

                    {treatment.safety_precautions && treatment.safety_precautions.length > 0 ? (
                      <div>
                        <h4 className="mb-1 font-semibold text-gray-900">Safety Precautions</h4>
                        <ul className="space-y-1 text-sm text-gray-700">
                          {treatment.safety_precautions.map((precaution, idx) => (
                            <li key={idx}>- {precaution}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {treatment.effectiveness_rating ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-700">Effectiveness:</span>
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`h-4 w-4 ${star <= treatment.effectiveness_rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        saveToWishlist(treatment);
                      }}
                      disabled={isSaved}
                      className="gap-2"
                    >
                      <Heart className={`h-4 w-4 ${isSaved ? "fill-red-500 text-red-500" : ""}`} />
                      {isSaved ? "Saved to Wishlist" : "Save to Wishlist"}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
