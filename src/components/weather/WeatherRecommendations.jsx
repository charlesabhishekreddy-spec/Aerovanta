import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lightbulb, Droplets, Bug, Sprout, Calendar, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getBrowserLocation } from "@/lib/browserLocation";

export default function WeatherRecommendations({ className = "" }) {
  const [recommendations, setRecommendations] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRecommendations = async () => {
      try {
        const user = await appClient.auth.me();
        const profileLocation = String(user?.location || "").trim();
        const crops = user?.primary_crops || [];
        const farmingMethod = user?.farming_method || "conventional";
        const browserLocation = await getBrowserLocation();
        const locationLabel = browserLocation
          ? `${browserLocation.latitude.toFixed(4)}, ${browserLocation.longitude.toFixed(4)}`
          : profileLocation || "Des Moines, Iowa, United States";
        const coordinateContext = browserLocation
          ? `Use these exact coordinates:
Latitude: ${browserLocation.latitude}
Longitude: ${browserLocation.longitude}`
          : `Use this location name: ${locationLabel}`;

        const result = await appClient.integrations.Core.InvokeLLM({
          prompt: `Based on real-time weather conditions, provide AI-driven farming recommendations.

USER CONTEXT:
- Location: ${locationLabel}
- Primary Crops: ${crops.join(', ') || 'various crops'}
- Farming Method: ${farmingMethod}
${coordinateContext}

Analyze current and upcoming weather to provide:
1. Irrigation recommendations (timing, amount, method)
2. Pest control timing (optimal windows based on weather)
3. Planting/harvesting advice (timing based on conditions)
4. Protective measures needed (frost protection, wind breaks, rain covers)
5. Priority tasks for today and next 3 days
6. Disease risk assessment based on humidity/temperature

Be specific and actionable. Consider real-time weather patterns.`,
          add_context_from_internet: true,
          response_json_schema: {
            type: "object",
            properties: {
              irrigation: {
                type: "object",
                properties: {
                  recommendation: { type: "string" },
                  timing: { type: "string" },
                  priority: { type: "string", enum: ["low", "medium", "high"] }
                }
              },
              pest_control: {
                type: "object",
                properties: {
                  recommendation: { type: "string" },
                  optimal_window: { type: "string" },
                  priority: { type: "string", enum: ["low", "medium", "high"] }
                }
              },
              planting_harvesting: {
                type: "object",
                properties: {
                  recommendation: { type: "string" },
                  timing: { type: "string" },
                  priority: { type: "string", enum: ["low", "medium", "high"] }
                }
              },
              protective_measures: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    measure: { type: "string" },
                    urgency: { type: "string", enum: ["low", "medium", "high"] },
                    reason: { type: "string" }
                  }
                }
              },
              priority_tasks: {
                type: "array",
                items: { type: "string" }
              },
              disease_risk: {
                type: "object",
                properties: {
                  level: { type: "string", enum: ["low", "moderate", "high"] },
                  reasoning: { type: "string" }
                }
              }
            }
          }
        });

        setRecommendations(result);
      } catch (error) {
        console.error("Failed to fetch recommendations:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRecommendations();
  }, []);

  const getPriorityColor = (priority) => {
    const colors = {
      low: "bg-green-100 text-green-800",
      medium: "bg-yellow-100 text-yellow-800",
      high: "bg-red-100 text-red-800"
    };
    return colors[priority] || "bg-gray-100 text-gray-800";
  };

  if (isLoading) {
    return (
      <Card className={`border-none shadow-lg rounded-3xl ${className}`.trim()}>
        <CardContent className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600 mx-auto mb-4" />
          <p className="text-gray-600">Generating AI recommendations...</p>
        </CardContent>
      </Card>
    );
  }

  if (!recommendations) return null;

  return (
    <Card className={`border-none shadow-lg rounded-3xl flex h-full flex-col overflow-hidden ${className}`.trim()}>
      <CardHeader className="border-b bg-violet-50/70">
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-violet-600" />
          AI Weather Recommendations
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto p-6 space-y-6 pr-3">
        {/* Irrigation */}
        {recommendations.irrigation && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Droplets className="w-5 h-5 text-violet-600" />
                <h3 className="font-semibold text-gray-900">Irrigation</h3>
              </div>
              <Badge className={getPriorityColor(recommendations.irrigation.priority)}>
                {recommendations.irrigation.priority} priority
              </Badge>
            </div>
            <p className="text-gray-700">{recommendations.irrigation.recommendation}</p>
            {recommendations.irrigation.timing && (
              <p className="text-sm text-violet-600">⏰ {recommendations.irrigation.timing}</p>
            )}
          </div>
        )}

        {/* Pest Control */}
        {recommendations.pest_control && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bug className="w-5 h-5 text-orange-600" />
                <h3 className="font-semibold text-gray-900">Pest Control</h3>
              </div>
              <Badge className={getPriorityColor(recommendations.pest_control.priority)}>
                {recommendations.pest_control.priority} priority
              </Badge>
            </div>
            <p className="text-gray-700">{recommendations.pest_control.recommendation}</p>
            {recommendations.pest_control.optimal_window && (
              <p className="text-sm text-orange-600">⏰ {recommendations.pest_control.optimal_window}</p>
            )}
          </div>
        )}

        {/* Planting/Harvesting */}
        {recommendations.planting_harvesting && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sprout className="w-5 h-5 text-violet-600" />
                <h3 className="font-semibold text-gray-900">Planting/Harvesting</h3>
              </div>
              <Badge className={getPriorityColor(recommendations.planting_harvesting.priority)}>
                {recommendations.planting_harvesting.priority} priority
              </Badge>
            </div>
            <p className="text-gray-700">{recommendations.planting_harvesting.recommendation}</p>
            {recommendations.planting_harvesting.timing && (
              <p className="text-sm text-violet-600">⏰ {recommendations.planting_harvesting.timing}</p>
            )}
          </div>
        )}

        {/* Protective Measures */}
        {recommendations.protective_measures && recommendations.protective_measures.length > 0 && (
          <div className="border-t pt-4">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-violet-600" />
              Protective Measures Needed
            </h3>
            <div className="space-y-2">
              {recommendations.protective_measures.map((measure, idx) => (
                <div key={idx} className="p-3 bg-violet-50/70 rounded-lg border border-violet-200/80">
                  <div className="flex items-start justify-between mb-1">
                    <p className="font-medium text-gray-900">{measure.measure}</p>
                    <Badge className={getPriorityColor(measure.urgency)}>
                      {measure.urgency}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600">{measure.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Priority Tasks */}
        {recommendations.priority_tasks && recommendations.priority_tasks.length > 0 && (
          <div className="border-t pt-4">
            <h3 className="font-semibold text-gray-900 mb-3">Priority Tasks (Next 3 Days)</h3>
            <ul className="space-y-2">
              {recommendations.priority_tasks.map((task, idx) => (
                <li key={idx} className="flex items-start gap-2 text-gray-700">
                  <span className="text-violet-600 mt-1">✓</span>
                  {task}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Disease Risk */}
        {recommendations.disease_risk && (
          <div className="border-t pt-4">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold text-gray-900">Disease Risk Assessment</h3>
              <Badge className={getPriorityColor(recommendations.disease_risk.level)}>
                {recommendations.disease_risk.level}
              </Badge>
            </div>
            <p className="text-sm text-gray-700">{recommendations.disease_risk.reasoning}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
