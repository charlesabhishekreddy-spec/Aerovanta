import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Beaker, Leaf, ChevronDown, ChevronUp, RefreshCw, Heart, Star, ShieldAlert } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export default function TreatmentRecommendations({ diagnosis }) {
  const [treatments, setTreatments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [savedTreatments, setSavedTreatments] = useState([]);

  const shouldDisableTreatments =
    diagnosis?.is_healthy ||
    diagnosis?.requires_manual_review ||
    !diagnosis?.disease_name ||
    String(diagnosis?.disease_name || "").toLowerCase().includes("uncertain");

  const fetchTreatments = async () => {
    if (shouldDisableTreatments) {
      setTreatments([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const existingTreatments = await appClient.entities.Treatment.filter({
        disease_name: diagnosis.disease_name,
      });

      if (existingTreatments.length > 0) {
        const formattedTreatments = existingTreatments.map((t) => ({
          name: t.treatment_name,
          type: t.treatment_type,
          proportions: t.application_method || "See description",
          description: t.description,
          safety_precautions: t.safety_precautions,
          effectiveness_rating: t.effectiveness_rating,
          id: t.id,
        }));
        setTreatments(formattedTreatments);
      } else {
        const result = await appClient.integrations.Core.InvokeLLM({
          prompt: `You are an expert plant pathologist. Provide detailed treatment recommendations for:

Plant: ${diagnosis.plant_name}
Disease: ${diagnosis.disease_name}
Infection Level: ${diagnosis.infection_level || diagnosis.confidence_score}%

Provide exactly 4 treatment options: 2 chemical and 2 organic.
For each treatment provide:
1. Treatment name
2. Type (chemical or organic)
3. Application method and proportions
4. Description
5. Safety precautions (array)
6. Effectiveness rating (1-5)`,
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
        for (const treatment of result.treatments || []) {
          const saved = await appClient.entities.Treatment.create({
            disease_name: diagnosis.disease_name,
            treatment_name: treatment.name,
            treatment_type: treatment.type,
            description: treatment.description,
            application_method: treatment.proportions,
            safety_precautions: treatment.safety_precautions,
            effectiveness_rating: treatment.effectiveness_rating,
            is_favorite: false,
          });
          newlySavedTreatments.push({ ...treatment, id: saved.id });
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
  }, [diagnosis?.disease_name, diagnosis?.requires_manual_review, diagnosis?.is_healthy]);

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
          safety_precautions: treatment.safety_precautions,
          effectiveness_rating: treatment.effectiveness_rating,
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
              Recommendations are hidden until diagnosis confidence is verified and disease evidence is clear.
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
          <Button variant="ghost" size="sm" onClick={fetchTreatments} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refetch Treatments
          </Button>
        </div>

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
