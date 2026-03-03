import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Beaker, Leaf, ChevronDown, ChevronUp, RefreshCw, Heart, Star, ShieldAlert } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const normalizeKey = (value) => String(value || "").trim().toLowerCase();

export default function TreatmentRecommendations({ diagnosis }) {
  const [treatments, setTreatments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [savedTreatments, setSavedTreatments] = useState([]);

  const shouldDisableTreatments =
    diagnosis?.is_healthy ||
    !diagnosis?.disease_name ||
    String(diagnosis?.disease_name || "").toLowerCase().includes("uncertain");

  const isProvisional = Boolean(diagnosis?.requires_manual_review);
  const diagnosisSignature = `${normalizeKey(diagnosis?.plant_name)}|${normalizeKey(diagnosis?.disease_name)}`;

  const fetchTreatments = async ({ forceRefresh = false } = {}) => {
    if (shouldDisableTreatments) {
      setTreatments([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const scopedTreatments = await appClient.entities.Treatment.filter({
        disease_name: diagnosis.disease_name,
        diagnosis_signature: diagnosisSignature,
      });
      const hasCompleteScopedSet =
        scopedTreatments.length >= 4 &&
        scopedTreatments.every(
          (t) =>
            String(t?.treatment_name || "").trim() &&
            String(t?.description || "").trim() &&
            String(t?.frequency || "").trim()
        );

      if (hasCompleteScopedSet && !forceRefresh) {
        const formattedTreatments = scopedTreatments.map((t) => ({
          name: t.treatment_name,
          type: t.treatment_type,
          proportions: t.application_method || "See description",
          frequency: t.frequency || "",
          description: t.description,
          safety_precautions: t.safety_precautions,
          effectiveness_rating: t.effectiveness_rating,
          id: t.id,
        }));
        setTreatments(formattedTreatments);
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

        const newlySavedTreatments = [];
        const nextTreatments = Array.isArray(result?.treatments) ? result.treatments.slice(0, 4) : [];

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
            if (stale?.id) {
              await appClient.entities.Treatment.delete(stale.id);
            }
          }
        }

        setTreatments(newlySavedTreatments);
      }
    } catch (fetchError) {
      console.error("Failed to fetch treatments:", fetchError);
      setTreatments([]);
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

        {isProvisional && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                Provisional recommendations: diagnosis confidence is low. Apply low-risk/organic steps first and verify
                with a clearer image before aggressive chemical treatment.
              </span>
            </div>
          </div>
        )}

        <div className="max-h-[42rem] divide-y overflow-y-auto">
          {treatments.length === 0 && (
            <div className="p-6 text-sm text-gray-600">No treatments are available for this diagnosis yet.</div>
          )}

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
                    {isExpanded ? (
                      <ChevronUp className="h-5 w-5 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-gray-400" />
                    )}
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="space-y-4 bg-violet-50/40 px-4 pb-4">
                    <div>
                      <h4 className="mb-1 font-semibold text-gray-900">Application Method</h4>
                      <p className="text-sm text-gray-700">{treatment.proportions}</p>
                    </div>

                    {treatment.frequency && (
                      <div>
                        <h4 className="mb-1 font-semibold text-gray-900">Frequency</h4>
                        <p className="text-sm text-gray-700">{treatment.frequency}</p>
                      </div>
                    )}

                    <div>
                      <h4 className="mb-1 font-semibold text-gray-900">Description</h4>
                      <p className="text-sm leading-relaxed text-gray-700">{treatment.description}</p>
                    </div>

                    {treatment.safety_precautions && treatment.safety_precautions.length > 0 && (
                      <div>
                        <h4 className="mb-1 font-semibold text-gray-900">Safety Precautions</h4>
                        <ul className="space-y-1 text-sm text-gray-700">
                          {treatment.safety_precautions.map((precaution, idx) => (
                            <li key={idx}>- {precaution}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {treatment.effectiveness_rating && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-700">Effectiveness:</span>
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`h-4 w-4 ${
                                star <= treatment.effectiveness_rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {treatment.id && (
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
                    )}
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
