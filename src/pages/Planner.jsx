import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Sprout,
  Calendar,
  Droplet,
  Trash2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  FlaskConical,
  MapPin,
  Target,
} from "lucide-react";

const SOIL_TYPES = [
  "Sandy",
  "Sandy-Loam",
  "Loam",
  "Clay-Loam",
  "Clay",
  "Silt-Loam",
  "Silty-Clay",
  "Peaty",
  "Chalky",
  "Unknown / Mixed",
];

const EXAMPLE_CROPS = [
  "Tomatoes", "Corn", "Wheat", "Soybeans", "Potatoes", "Lettuce",
  "Carrots", "Peppers", "Cucumbers", "Rice", "Beans", "Peas",
  "Onions", "Spinach", "Broccoli", "Squash", "Watermelon",
  "Eggplant", "Sweet Potatoes", "Strawberries", "Sunflowers", "Garlic",
];

const STATUS_BADGE = {
  active: "bg-green-100 text-green-700",
  planning: "bg-blue-100 text-blue-700",
  completed: "bg-gray-100 text-gray-500",
  abandoned: "bg-red-100 text-red-500",
};

const STAGE_COLORS = {
  seed_prep: "bg-gray-100 text-gray-700",
  germination: "bg-yellow-100 text-yellow-700",
  seedling: "bg-lime-100 text-lime-700",
  vegetative: "bg-green-100 text-green-700",
  flowering: "bg-pink-100 text-pink-700",
  fruiting: "bg-orange-100 text-orange-700",
  maturity: "bg-amber-100 text-amber-700",
  harvest: "bg-emerald-100 text-emerald-700",
};

/**
 * Compute the current week number (1-based) given a planting date string.
 * Returns null if the planting date is in the future or past harvest.
 */
const getCurrentWeek = (plantingDateStr, totalWeeks) => {
  if (!plantingDateStr) return null;
  const planting = new Date(`${plantingDateStr}T12:00:00`);
  const today = new Date();
  const daysSincePlanting = Math.floor((today - planting) / (1000 * 60 * 60 * 24));
  if (daysSincePlanting < 0) return null;
  const week = Math.floor(daysSincePlanting / 7) + 1;
  if (week > totalWeeks) return null;
  return week;
};

export default function Planner() {
  const queryClient = useQueryClient();

  // Form inputs
  const [cropName, setCropName] = useState("");
  const [plantingDate, setPlantingDate] = useState("");
  const [location, setLocation] = useState("");
  const [soilType, setSoilType] = useState("");
  const [areaSize, setAreaSize] = useState("");

  // UI state
  const [isGenerating, setIsGenerating] = useState(false);
  const [timeline, setTimeline] = useState(null);
  const [savedPlantingDate, setSavedPlantingDate] = useState(null);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [expandedWeeks, setExpandedWeeks] = useState({});
  const [expandedPlanId, setExpandedPlanId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Load saved plans
  const { data: savedPlans = [] } = useQuery({
    queryKey: ["cropPlans"],
    queryFn: () => appClient.entities.CropPlan.list("-created_date"),
  });

  const toggleWeek = (weekNum) => {
    setExpandedWeeks((prev) => ({ ...prev, [weekNum]: !prev[weekNum] }));
  };

  const generateTimeline = async () => {
    if (!cropName || !plantingDate) return;

    setIsGenerating(true);
    setError(null);
    setSuccessMessage(null);
    setTimeline(null);

    try {
      const prompt = `Generate a detailed week-by-week crop timeline for ${cropName} starting from ${plantingDate}.

Include:
1. Complete growth phases from seed to harvest
2. Weekly activities and care instructions
3. Watering schedule
4. Fertilization plan
5. Pest prevention tips
6. Expected harvest date
7. Seasonal considerations
${location ? `8. Location context: ${location}` : ""}
${soilType ? `9. Soil type: ${soilType}` : ""}

Format as a structured timeline with specific weeks and actionable tasks.`;

      const result = await appClient.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            crop_name: { type: "string" },
            total_weeks: { type: "number" },
            expected_harvest_date: { type: "string" },
            timeline: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  week: { type: "number" },
                  stage: { type: "string" },
                  activities: { type: "array", items: { type: "string" } },
                  tips: { type: "string" },
                },
              },
            },
            watering_schedule: { type: "string" },
            fertilizer_plan: { type: "string" },
            soil_requirements: { type: "string" },
          },
        },
      });

      if (!result || !result.timeline || result.timeline.length === 0) {
        throw new Error("No timeline data was returned. Please try again.");
      }

      setTimeline(result);
      setSavedPlantingDate(plantingDate);
      // Expand the current week and the next 2 weeks by default; collapse the rest
      const currentWeek = getCurrentWeek(plantingDate, result.total_weeks);
      const expanded = {};
      result.timeline.forEach((w) => {
        expanded[w.week] =
          currentWeek === null ||
          (w.week >= currentWeek && w.week <= currentWeek + 2);
      });
      // Always open at least the first week if no current week
      if (currentWeek === null) {
        result.timeline.forEach((w) => { expanded[w.week] = true; });
      }
      setExpandedWeeks(expanded);

      await appClient.entities.CropPlan.create({
        crop_name: cropName,
        planting_date: plantingDate,
        expected_harvest_date: result.expected_harvest_date,
        timeline: result.timeline,
        water_schedule: result.watering_schedule,
        fertilizer_plan: result.fertilizer_plan,
        soil_requirements: result.soil_requirements,
        location: location || undefined,
        area_size: areaSize || undefined,
        status: "active",
        growth_stage: "seed_prep",
      });

      queryClient.invalidateQueries({ queryKey: ["cropPlans"] });
      setSuccessMessage(
        `Your ${cropName} plan has been saved! Expected harvest: ${result.expected_harvest_date}`
      );
    } catch (err) {
      console.error("Failed to generate timeline:", err);
      setError(
        err?.message || "Failed to generate plan. Please check your inputs and try again."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const deletePlan = async (id) => {
    setDeletingId(id);
    try {
      await appClient.entities.CropPlan.delete(id);
      queryClient.invalidateQueries({ queryKey: ["cropPlans"] });
      if (expandedPlanId === id) setExpandedPlanId(null);
    } catch (err) {
      console.error("Failed to delete plan:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const updatePlanStatus = async (id, status) => {
    try {
      await appClient.entities.CropPlan.update(id, { status });
      queryClient.invalidateQueries({ queryKey: ["cropPlans"] });
    } catch (err) {
      console.error("Failed to update plan status:", err);
    }
  };

  // For the generated timeline, compute current week
  const currentWeekNumber = timeline
    ? getCurrentWeek(savedPlantingDate, timeline.total_weeks)
    : null;
  const progressPercent = timeline && currentWeekNumber
    ? Math.round((currentWeekNumber / timeline.total_weeks) * 100)
    : null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Sprout className="w-7 h-7 text-violet-600" />
          AI Crop Planner
        </h2>
        <p className="text-gray-600">
          Generate a detailed week-by-week growing plan tailored to your crop and conditions
        </p>
      </div>

      {/* Input Form */}
      <Card className="border-none shadow-lg">
        <CardContent className="p-6 space-y-5">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="crop">Crop Name *</Label>
              <Input
                id="crop"
                value={cropName}
                onChange={(e) => setCropName(e.target.value)}
                placeholder="e.g., Tomatoes, Rice, Garlic, Beans…"
                className="mt-1"
              />
              <p className="text-xs text-gray-400 mt-1">
                Supported: {EXAMPLE_CROPS.slice(0, 10).join(", ")}, and more
              </p>
            </div>
            <div>
              <Label htmlFor="date">Planting Date *</Label>
              <Input
                id="date"
                type="date"
                value={plantingDate}
                onChange={(e) => setPlantingDate(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="location" className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" /> Location
              </Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g., Texas, Zone 8b"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="soil">Soil Type</Label>
              <select
                id="soil"
                value={soilType}
                onChange={(e) => setSoilType(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select soil type…</option>
                {SOIL_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="area">Area Size</Label>
              <Input
                id="area"
                value={areaSize}
                onChange={(e) => setAreaSize(e.target.value)}
                placeholder="e.g., 100 sq ft, 0.5 acres"
                className="mt-1"
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {successMessage && (
            <Alert className="border-green-200 bg-green-50 text-green-800">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={generateTimeline}
            disabled={!cropName || !plantingDate || isGenerating}
            className="w-full bg-violet-600 hover:bg-violet-700 gap-2"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating Plan…
              </>
            ) : (
              <>
                <Calendar className="w-5 h-5" />
                Generate Crop Plan
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Generated Timeline */}
      {timeline && (
        <div className="space-y-6">
          {/* Overview */}
          <Card className="border-none shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-violet-600/90 via-purple-600/85 to-fuchsia-600/85 p-6 text-white">
              <h3 className="text-2xl font-bold mb-2">{timeline.crop_name} Growing Plan</h3>
              <div className="flex flex-wrap gap-4 text-sm mb-4">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  <span>Duration: {timeline.total_weeks} weeks</span>
                </div>
                <div className="flex items-center gap-2">
                  <Sprout className="w-4 h-4" />
                  <span>Expected Harvest: {timeline.expected_harvest_date}</span>
                </div>
                {location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    <span>{location}</span>
                  </div>
                )}
                {currentWeekNumber && (
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    <span>Currently: Week {currentWeekNumber} of {timeline.total_weeks}</span>
                  </div>
                )}
              </div>

              {/* Progress bar */}
              {progressPercent !== null && (
                <div>
                  <div className="flex justify-between text-xs text-white/80 mb-1">
                    <span>Growing Progress</span>
                    <span>{progressPercent}%</span>
                  </div>
                  <div className="w-full bg-white/20 rounded-full h-2">
                    <div
                      className="bg-white rounded-full h-2 transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
            <CardContent className="p-6">
              <div className="grid md:grid-cols-3 gap-4">
                <div className="rounded-lg border border-violet-200/80 bg-violet-50/70 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Droplet className="w-5 h-5 text-violet-600" />
                    <h4 className="font-semibold text-gray-900">Watering</h4>
                  </div>
                  <p className="text-sm text-gray-700">{timeline.watering_schedule}</p>
                </div>
                <div className="rounded-lg border border-violet-200/80 bg-violet-50/70 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <FlaskConical className="w-5 h-5 text-violet-600" />
                    <h4 className="font-semibold text-gray-900">Fertilizer</h4>
                  </div>
                  <p className="text-sm text-gray-700">{timeline.fertilizer_plan}</p>
                </div>
                <div className="rounded-lg border border-violet-200/80 bg-violet-50/70 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sprout className="w-5 h-5 text-violet-600" />
                    <h4 className="font-semibold text-gray-900">Soil Requirements</h4>
                  </div>
                  <p className="text-sm text-gray-700">{timeline.soil_requirements}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Week-by-Week Timeline */}
          <Card className="border-none shadow-lg">
            <CardHeader className="border-b">
              <div className="flex items-center justify-between">
                <CardTitle>Week-by-Week Timeline</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-gray-500"
                    onClick={() => {
                      const allExpanded = {};
                      timeline.timeline.forEach((w) => { allExpanded[w.week] = true; });
                      setExpandedWeeks(allExpanded);
                    }}
                  >
                    Expand All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-gray-500"
                    onClick={() => setExpandedWeeks({})}
                  >
                    Collapse All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-3">
                {timeline.timeline?.map((week) => {
                  const isCurrent = currentWeekNumber === week.week;
                  const isPast = currentWeekNumber !== null && week.week < currentWeekNumber;
                  return (
                    <div
                      key={week.week}
                      className={`relative pl-10 border-l-2 last:border-0 pb-3 ${
                        isCurrent ? "border-violet-500" : isPast ? "border-gray-200" : "border-violet-200"
                      }`}
                    >
                      <div
                        className={`absolute left-0 top-0 -translate-x-1/2 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm shadow ${
                          isCurrent
                            ? "bg-violet-700 ring-2 ring-violet-400 ring-offset-2"
                            : isPast
                            ? "bg-gray-400"
                            : "bg-violet-600"
                        }`}
                      >
                        {isPast ? "✓" : week.week}
                      </div>
                      <div
                        className={`bg-white border rounded-lg overflow-hidden ${
                          isCurrent ? "border-violet-400 shadow-sm shadow-violet-100" : ""
                        }`}
                      >
                        <button
                          className={`w-full flex items-center justify-between p-3 transition-colors text-left ${
                            isCurrent ? "bg-violet-50 hover:bg-violet-100" : "hover:bg-gray-50"
                          }`}
                          onClick={() => toggleWeek(week.week)}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`font-semibold text-sm ${
                                isCurrent ? "text-violet-800" : isPast ? "text-gray-400" : "text-gray-900"
                              }`}
                            >
                              Week {week.week}
                            </span>
                            {isCurrent && (
                              <span className="text-xs bg-violet-600 text-white px-2 py-0.5 rounded-full font-medium">
                                📍 Current Week
                              </span>
                            )}
                            <span className="text-xs text-gray-500 hidden sm:block">—</span>
                            <span
                              className={`text-xs font-medium hidden sm:block ${
                                isCurrent ? "text-violet-700" : isPast ? "text-gray-400" : "text-violet-700"
                              }`}
                            >
                              {week.stage}
                            </span>
                          </div>
                          {expandedWeeks[week.week] ? (
                            <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                          )}
                        </button>

                        {expandedWeeks[week.week] && (
                          <div className="px-4 pb-4 border-t">
                            <p className="text-xs font-medium text-violet-600 uppercase tracking-wide mt-3 mb-2">
                              {week.stage}
                            </p>
                            <div className="space-y-1.5 mb-3">
                              {week.activities?.map((activity, i) => (
                                <div key={activity || i} className="flex items-start gap-2">
                                  <div
                                    className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                                      isCurrent ? "bg-violet-600" : isPast ? "bg-gray-300" : "bg-violet-500"
                                    }`}
                                  />
                                  <span
                                    className={`text-sm ${
                                      isPast ? "text-gray-400 line-through" : "text-gray-700"
                                    }`}
                                  >
                                    {activity}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {week.tips && (
                              <div className="rounded-lg border border-violet-200/80 bg-violet-50/70 p-3">
                                <p className="text-sm text-violet-900">💡 {week.tips}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Saved Plans */}
      {savedPlans.length > 0 && (
        <Card className="border-none shadow-lg">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-violet-600" />
              Saved Crop Plans ({savedPlans.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            {savedPlans.map((plan) => {
              const planCurrentWeek = plan.planting_date && Array.isArray(plan.timeline)
                ? getCurrentWeek(plan.planting_date, plan.timeline.length)
                : null;
              const planProgress = planCurrentWeek && Array.isArray(plan.timeline)
                ? Math.round((planCurrentWeek / plan.timeline.length) * 100)
                : null;
              return (
                <div key={plan.id} className="border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between p-4 bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold text-gray-900">{plan.crop_name}</h4>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            STATUS_BADGE[plan.status] || STATUS_BADGE.planning
                          }`}
                        >
                          {plan.status}
                        </span>
                        {plan.growth_stage && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              STAGE_COLORS[plan.growth_stage] || "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {plan.growth_stage.replace(/_/g, " ")}
                          </span>
                        )}
                        {planCurrentWeek && (
                          <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium">
                            Week {planCurrentWeek}{Array.isArray(plan.timeline) ? ` / ${plan.timeline.length}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 flex-wrap">
                        {plan.planting_date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> Planted: {plan.planting_date}
                          </span>
                        )}
                        {plan.expected_harvest_date && (
                          <span className="flex items-center gap-1">
                            <Sprout className="w-3 h-3" /> Harvest: {plan.expected_harvest_date}
                          </span>
                        )}
                        {plan.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {plan.location}
                          </span>
                        )}
                      </div>
                      {/* Inline progress bar for active plans */}
                      {planProgress !== null && plan.status === "active" && (
                        <div className="mt-2">
                          <div className="flex justify-between text-xs text-gray-400 mb-0.5">
                            <span>Growing progress</span>
                            <span>{planProgress}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div
                              className="bg-violet-500 rounded-full h-1.5 transition-all"
                              style={{ width: `${planProgress}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      {plan.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-green-600 hover:text-green-700 hover:bg-green-50 text-xs h-7 px-2"
                          onClick={() => updatePlanStatus(plan.id, "completed")}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                          Complete
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-gray-500 hover:text-gray-700 h-7 px-2"
                        onClick={() =>
                          setExpandedPlanId(expandedPlanId === plan.id ? null : plan.id)
                        }
                      >
                        {expandedPlanId === plan.id ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:text-red-600 hover:bg-red-50 h-7 px-2"
                        onClick={() => deletePlan(plan.id)}
                        disabled={deletingId === plan.id}
                      >
                        {deletingId === plan.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {expandedPlanId === plan.id && (
                    <div className="p-4 border-t space-y-4">
                      {(plan.water_schedule || plan.fertilizer_plan || plan.soil_requirements) && (
                        <div className="grid md:grid-cols-3 gap-3">
                          {plan.water_schedule && (
                            <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                              <div className="flex items-center gap-1 mb-1 text-blue-700 font-medium text-xs">
                                <Droplet className="w-3.5 h-3.5" /> Watering
                              </div>
                              <p className="text-xs text-gray-700">{plan.water_schedule}</p>
                            </div>
                          )}
                          {plan.fertilizer_plan && (
                            <div className="rounded-lg border border-green-100 bg-green-50/60 p-3">
                              <div className="flex items-center gap-1 mb-1 text-green-700 font-medium text-xs">
                                <FlaskConical className="w-3.5 h-3.5" /> Fertilizer
                              </div>
                              <p className="text-xs text-gray-700">{plan.fertilizer_plan}</p>
                            </div>
                          )}
                          {plan.soil_requirements && (
                            <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                              <div className="flex items-center gap-1 mb-1 text-amber-700 font-medium text-xs">
                                <Sprout className="w-3.5 h-3.5" /> Soil
                              </div>
                              <p className="text-xs text-gray-700">{plan.soil_requirements}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {Array.isArray(plan.timeline) && plan.timeline.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                            {plan.timeline.length}-Week Timeline
                          </p>
                          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                            {plan.timeline.map((week) => {
                              const isCurr = planCurrentWeek === week.week;
                              return (
                                <div key={week.week} className="flex items-start gap-2 text-xs">
                                  <span
                                    className={`rounded-full w-6 h-6 flex items-center justify-center font-bold shrink-0 ${
                                      isCurr
                                        ? "bg-violet-600 text-white"
                                        : "bg-violet-100 text-violet-700"
                                    }`}
                                  >
                                    {week.week}
                                  </span>
                                  <div>
                                    <p className={`font-medium ${isCurr ? "text-violet-700" : "text-gray-700"}`}>
                                      {week.stage}{isCurr ? " 📍" : ""}
                                    </p>
                                    {week.activities?.slice(0, 2).map((act, i) => (
                                      <p key={act || i} className="text-gray-500 mt-0.5">
                                        • {act}
                                      </p>
                                    ))}
                                    {week.activities?.length > 2 && (
                                      <p className="text-gray-400 mt-0.5">
                                        +{week.activities.length - 2} more tasks
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
