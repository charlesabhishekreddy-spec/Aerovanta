import { useMemo, useState } from "react";
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
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Search,
  Trash2,
} from "lucide-react";

const SOIL_TYPES = ["Sandy", "Loam", "Clay", "Silt-Loam", "Peaty", "Chalky", "Unknown / Mixed"];
const PLAN_STATUS = ["planning", "active", "completed", "abandoned"];
const STATUS_BADGE = {
  planning: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  completed: "bg-slate-100 text-slate-700",
  abandoned: "bg-rose-100 text-rose-700",
};

const toDateOnly = (value) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const formatDate = (value) => {
  const dateOnly = toDateOnly(value);
  if (!dateOnly) return "Not set";
  const date = new Date(`${dateOnly}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateOnly : date.toLocaleDateString();
};

const getCurrentWeek = (plantingDate, totalWeeks) => {
  const start = toDateOnly(plantingDate);
  if (!start || !Number.isFinite(Number(totalWeeks)) || Number(totalWeeks) <= 0) return null;
  const planting = new Date(`${start}T12:00:00`);
  const today = new Date();
  const days = Math.floor((today - planting) / (1000 * 60 * 60 * 24));
  if (days < 0) return null;
  const week = Math.floor(days / 7) + 1;
  return week > Number(totalWeeks) ? null : week;
};

const normalizeWeek = (week, index) => ({
  week: Number.isFinite(Number(week?.week)) && Number(week.week) > 0 ? Number(week.week) : index + 1,
  stage: String(week?.stage || `Week ${index + 1}`).trim(),
  activities: Array.isArray(week?.activities)
    ? week.activities.map((item) => String(item || "").trim()).filter(Boolean)
    : [],
  tips: String(week?.tips || "").trim(),
});

const normalizePlanResult = (raw, cropName, plantingDate) => {
  const timeline = Array.isArray(raw?.timeline) ? raw.timeline.map(normalizeWeek).sort((a, b) => a.week - b.week) : [];
  if (!timeline.length) throw new Error("No timeline data was returned. Please retry.");
  const totalWeeks = Number.isFinite(Number(raw?.total_weeks)) && Number(raw.total_weeks) > 0
    ? Number(raw.total_weeks)
    : timeline.length;
  const harvestDate = toDateOnly(raw?.expected_harvest_date);
  const fallbackHarvest = (() => {
    const start = toDateOnly(plantingDate);
    if (!start || !totalWeeks) return "";
    const date = new Date(`${start}T12:00:00`);
    date.setDate(date.getDate() + totalWeeks * 7);
    return date.toISOString().slice(0, 10);
  })();
  return {
    crop_name: String(raw?.crop_name || cropName).trim(),
    total_weeks: totalWeeks,
    expected_harvest_date: harvestDate || fallbackHarvest,
    timeline,
    watering_schedule: String(raw?.watering_schedule || "").trim(),
    fertilizer_plan: String(raw?.fertilizer_plan || "").trim(),
    soil_requirements: String(raw?.soil_requirements || "").trim(),
  };
};

export default function Planner() {
  const queryClient = useQueryClient();

  const [cropName, setCropName] = useState("");
  const [plantingDate, setPlantingDate] = useState("");
  const [location, setLocation] = useState("");
  const [soilType, setSoilType] = useState("");
  const [areaSize, setAreaSize] = useState("");

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [timeline, setTimeline] = useState(null);
  const [timelinePlantingDate, setTimelinePlantingDate] = useState("");
  const [savedGeneratedPlanId, setSavedGeneratedPlanId] = useState("");
  const [expandedWeeks, setExpandedWeeks] = useState({});

  const [formError, setFormError] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [savedSearch, setSavedSearch] = useState("");
  const [savedStatusFilter, setSavedStatusFilter] = useState("all");
  const [expandedPlanId, setExpandedPlanId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [updatingStatusId, setUpdatingStatusId] = useState("");

  const {
    data: savedPlans = [],
    isLoading: isLoadingSavedPlans,
    isError: isSavedPlansError,
    error: savedPlansError,
  } = useQuery({
    queryKey: ["cropPlans"],
    queryFn: () => appClient.entities.CropPlan.list("-created_date"),
  });

  const validateForm = () => {
    if (cropName.trim().length < 2) return "Enter a crop name with at least 2 characters.";
    if (!toDateOnly(plantingDate)) return "Select a valid planting date.";
    if (areaSize.trim().length > 80) return "Area size must be 80 characters or less.";
    return "";
  };

  const persistGeneratedPlan = async (generated) => {
    if (!generated) return;
    setIsSaving(true);
    setSaveError("");
    try {
      const created = await appClient.entities.CropPlan.create({
        crop_name: generated.crop_name,
        planting_date: timelinePlantingDate || toDateOnly(plantingDate),
        expected_harvest_date: generated.expected_harvest_date || null,
        timeline: generated.timeline,
        water_schedule: generated.watering_schedule,
        fertilizer_plan: generated.fertilizer_plan,
        soil_requirements: generated.soil_requirements,
        location: location.trim() || "",
        area_size: areaSize.trim() || "",
        status: "planning",
        growth_stage: "seed_prep",
      });
      setSavedGeneratedPlanId(String(created?.id || ""));
      setSuccessMessage("Plan generated and saved.");
      await queryClient.invalidateQueries({ queryKey: ["cropPlans"] });
    } catch (error) {
      setSaveError(`Plan generated, but save failed: ${error?.message || "Unknown error."}`);
    } finally {
      setIsSaving(false);
    }
  };

  const generateTimeline = async () => {
    const inputError = validateForm();
    if (inputError) {
      setFormError(inputError);
      return;
    }
    setFormError("");
    setGenerationError("");
    setSaveError("");
    setActionError("");
    setSuccessMessage("");
    setSavedGeneratedPlanId("");
    setIsGenerating(true);
    try {
      const result = await appClient.integrations.Core.InvokeLLM({
        prompt: `Generate a realistic week-by-week crop plan.
Crop: ${cropName.trim()}
Planting date: ${toDateOnly(plantingDate)}
${location.trim() ? `Location: ${location.trim()}` : ""}
${soilType ? `Soil type: ${soilType}` : ""}
${areaSize.trim() ? `Area size: ${areaSize.trim()}` : ""}
Include growth stage, weekly activities, one weekly tip, watering schedule, fertilizer plan, and expected harvest date.`,
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
          required: ["crop_name", "timeline"],
        },
      });

      const normalized = normalizePlanResult(result, cropName, plantingDate);
      setTimeline(normalized);
      setTimelinePlantingDate(toDateOnly(plantingDate));
      const currentWeek = getCurrentWeek(plantingDate, normalized.total_weeks);
      const expanded = {};
      normalized.timeline.forEach((entry) => {
        expanded[entry.week] = currentWeek == null ? entry.week <= 3 : entry.week >= currentWeek && entry.week <= currentWeek + 2;
      });
      setExpandedWeeks(expanded);
      await persistGeneratedPlan(normalized);
    } catch (error) {
      setGenerationError(error?.message || "Failed to generate plan. Please retry.");
    } finally {
      setIsGenerating(false);
    }
  };

  const updatePlanStatus = async (id, status) => {
    if (!PLAN_STATUS.includes(status)) return;
    setActionError("");
    setUpdatingStatusId(id);
    try {
      await appClient.entities.CropPlan.update(id, { status });
      await queryClient.invalidateQueries({ queryKey: ["cropPlans"] });
    } catch (error) {
      setActionError(error?.message || "Failed to update plan status.");
    } finally {
      setUpdatingStatusId("");
    }
  };

  const deletePlan = async (plan) => {
    const id = String(plan?.id || "");
    if (!id) return;
    if (!window.confirm(`Delete "${plan?.crop_name || "this plan"}"? This cannot be undone.`)) return;
    setActionError("");
    setDeletingId(id);
    try {
      await appClient.entities.CropPlan.delete(id);
      if (expandedPlanId === id) setExpandedPlanId("");
      await queryClient.invalidateQueries({ queryKey: ["cropPlans"] });
    } catch (error) {
      setActionError(error?.message || "Failed to delete plan.");
    } finally {
      setDeletingId("");
    }
  };

  const filteredSavedPlans = useMemo(() => {
    const q = savedSearch.trim().toLowerCase();
    return savedPlans.filter((plan) => {
      if (savedStatusFilter !== "all" && plan.status !== savedStatusFilter) return false;
      if (!q) return true;
      return [plan.crop_name, plan.location, plan.status].some((value) => String(value || "").toLowerCase().includes(q));
    });
  }, [savedPlans, savedSearch, savedStatusFilter]);

  const currentWeekNumber = timeline ? getCurrentWeek(timelinePlantingDate, timeline.total_weeks) : null;
  const progressPercent = timeline && currentWeekNumber
    ? Math.round((currentWeekNumber / timeline.total_weeks) * 100)
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Sprout className="h-7 w-7 text-violet-600" />
          AI Crop Planner
        </h2>
        <p className="text-gray-600">Generate and manage detailed crop timelines.</p>
      </div>

      <Card className="border-none shadow-lg">
        <CardContent className="space-y-4 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="crop">Crop Name *</Label>
              <Input id="crop" value={cropName} onChange={(e) => setCropName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="date">Planting Date *</Label>
              <Input id="date" type="date" value={plantingDate} onChange={(e) => setPlantingDate(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="location" className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                Location
              </Label>
              <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="soil">Soil Type</Label>
              <select
                id="soil"
                value={soilType}
                onChange={(e) => setSoilType(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select soil type</option>
                {SOIL_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="area">Area Size</Label>
              <Input id="area" value={areaSize} onChange={(e) => setAreaSize(e.target.value)} className="mt-1" />
            </div>
          </div>

          {[formError, generationError, saveError].filter(Boolean).map((message) => (
            <Alert key={message} variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ))}

          {successMessage ? (
            <Alert className="border-green-200 bg-green-50 text-green-800">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={generateTimeline} disabled={isGenerating || isSaving} className="bg-violet-600 hover:bg-violet-700">
              {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calendar className="mr-2 h-4 w-4" />}
              {isGenerating ? "Generating..." : "Generate Crop Plan"}
            </Button>
            {timeline && !savedGeneratedPlanId ? (
              <Button variant="outline" onClick={() => persistGeneratedPlan(timeline)} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Retry Save
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {timeline ? (
        <Card className="border-none shadow-lg">
          <CardHeader className="border-b bg-gradient-to-r from-violet-600/90 via-purple-600/85 to-fuchsia-600/85 text-white">
            <CardTitle>{timeline.crop_name} Plan</CardTitle>
            <div className="flex flex-wrap gap-4 text-sm text-white/90">
              <span>Duration: {timeline.total_weeks} weeks</span>
              <span>Harvest: {formatDate(timeline.expected_harvest_date)}</span>
              {currentWeekNumber ? <span>Current week: {currentWeekNumber}</span> : null}
              <span>{savedGeneratedPlanId ? "Saved" : "Not saved"}</span>
            </div>
            {progressPercent !== null ? (
              <div className="mt-2">
                <div className="mb-1 flex justify-between text-xs text-white/80"><span>Progress</span><span>{progressPercent}%</span></div>
                <div className="h-2 w-full rounded-full bg-white/20">
                  <div className="h-2 rounded-full bg-white" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            {timeline.timeline.map((week) => (
              <div key={week.week} className="rounded-lg border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between p-3 text-left hover:bg-gray-50"
                  onClick={() => setExpandedWeeks((prev) => ({ ...prev, [week.week]: !prev[week.week] }))}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Week {week.week}</span>
                    <span className="text-xs text-violet-700">{week.stage}</span>
                  </div>
                  {expandedWeeks[week.week] ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                </button>
                {expandedWeeks[week.week] ? (
                  <div className="border-t px-4 pb-4 pt-3">
                    <div className="space-y-1">
                      {(week.activities.length ? week.activities : ["Monitor crop condition and record observations."]).map((activity, index) => (
                        <p key={`${week.week}-${index}`} className="text-sm text-gray-700">- {activity}</p>
                      ))}
                    </div>
                    {week.tips ? <p className="mt-2 rounded-md bg-violet-50 p-2 text-sm text-violet-800">{week.tips}</p> : null}
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-none shadow-lg">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-violet-600" />
            Saved Crop Plans
          </CardTitle>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input value={savedSearch} onChange={(e) => setSavedSearch(e.target.value)} className="pl-9" placeholder="Search plans..." />
            </div>
            <select
              value={savedStatusFilter}
              onChange={(e) => setSavedStatusFilter(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">All statuses</option>
              {PLAN_STATUS.map((status) => (
                <option key={status} value={status}>{status.replace("_", " ")}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-6">
          {actionError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
          {isLoadingSavedPlans ? (
            <div className="flex min-h-[120px] items-center justify-center text-gray-700">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-violet-600" />
              Loading saved plans...
            </div>
          ) : null}
          {isSavedPlansError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{savedPlansError?.message || "Failed to load saved plans."}</AlertDescription>
            </Alert>
          ) : null}
          {!isLoadingSavedPlans && !isSavedPlansError && filteredSavedPlans.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
              {savedPlans.length ? "No plans match the selected filters." : "No plans yet. Generate one above."}
            </div>
          ) : null}
          {!isLoadingSavedPlans && !isSavedPlansError
            ? filteredSavedPlans.map((plan) => {
              const timelineItems = Array.isArray(plan.timeline) ? plan.timeline : [];
              const currentWeek = getCurrentWeek(plan.planting_date, timelineItems.length);
              return (
                <div key={plan.id} className="overflow-hidden rounded-lg border">
                  <div className="flex flex-col gap-3 bg-gray-50 p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold text-gray-900">{plan.crop_name || "Unnamed crop"}</h4>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[plan.status] || STATUS_BADGE.planning}`}>
                          {String(plan.status || "planning").replace("_", " ")}
                        </span>
                        {currentWeek ? <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">Week {currentWeek}</span> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                        <span>Planting: {formatDate(plan.planting_date)}</span>
                        <span>Harvest: {formatDate(plan.expected_harvest_date)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={PLAN_STATUS.includes(plan.status) ? plan.status : "planning"}
                        onChange={(e) => updatePlanStatus(plan.id, e.target.value)}
                        disabled={updatingStatusId === plan.id}
                        className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {PLAN_STATUS.map((status) => (
                          <option key={status} value={status}>{status.replace("_", " ")}</option>
                        ))}
                      </select>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-gray-500 hover:text-gray-700" onClick={() => setExpandedPlanId(expandedPlanId === plan.id ? "" : plan.id)}>
                        {expandedPlanId === plan.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-red-400 hover:bg-red-50 hover:text-red-600" onClick={() => deletePlan(plan)} disabled={deletingId === plan.id}>
                        {deletingId === plan.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  {expandedPlanId === plan.id ? (
                    <div className="space-y-2 border-t p-4">
                      {(timelineItems.length ? timelineItems : []).slice(0, 8).map((week, index) => {
                        const normalized = normalizeWeek(week, index);
                        return (
                          <div key={`${plan.id}-${normalized.week}-${index}`} className="text-xs">
                            <p className="font-medium text-gray-700">Week {normalized.week}: {normalized.stage}</p>
                            {normalized.activities.slice(0, 2).map((activity, activityIndex) => (
                              <p key={`${activityIndex}-${activity}`} className="text-gray-500">- {activity}</p>
                            ))}
                          </div>
                        );
                      })}
                      {!timelineItems.length ? <p className="text-xs text-gray-500">No timeline details were saved.</p> : null}
                    </div>
                  ) : null}
                </div>
              );
            })
            : null}
        </CardContent>
      </Card>
    </div>
  );
}
