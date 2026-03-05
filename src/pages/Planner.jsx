import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Search,
  Sprout,
  Trash2,
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

const PLAN_STATUS = ["active", "planning", "completed", "abandoned"];

const STATUS_BADGE_CLASS = {
  active: "bg-emerald-100 text-emerald-700",
  planning: "bg-blue-100 text-blue-700",
  completed: "bg-slate-100 text-slate-700",
  abandoned: "bg-rose-100 text-rose-700",
};

const FIELD_WRAPPER_CLASS = "space-y-1.5";
const FIELD_LABEL_CLASS = "text-slate-800 leading-none";
const FIELD_CONTROL_CLASS = "h-12 rounded-xl";

const toDateOnly = (value) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const formatDateLabel = (value) => {
  const dateOnly = toDateOnly(value);
  if (!dateOnly) return "Not set";
  const parsed = new Date(`${dateOnly}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateOnly;
  return parsed.toLocaleDateString();
};

const getCurrentWeek = (plantingDate, totalWeeks) => {
  const dateOnly = toDateOnly(plantingDate);
  const weeks = Number(totalWeeks);
  if (!dateOnly || !Number.isFinite(weeks) || weeks <= 0) return null;

  const start = new Date(`${dateOnly}T12:00:00`);
  const now = new Date();
  const daysSinceStart = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  if (daysSinceStart < 0) return null;

  const week = Math.floor(daysSinceStart / 7) + 1;
  return week > weeks ? null : week;
};

const toStageKey = (stageValue) =>
  String(stageValue || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeWeek = (week, index) => ({
  week:
    Number.isFinite(Number(week?.week)) && Number(week.week) > 0
      ? Number(week.week)
      : index + 1,
  stage: String(week?.stage || `Week ${index + 1}`).trim(),
  activities: Array.isArray(week?.activities)
    ? week.activities
      .map((activity) => String(activity || "").trim())
      .filter(Boolean)
    : [],
  tips: String(week?.tips || "").trim(),
});

const normalizePlanResult = (raw, cropName, plantingDate) => {
  const timeline = Array.isArray(raw?.timeline)
    ? raw.timeline.map(normalizeWeek).sort((a, b) => a.week - b.week)
    : [];
  if (!timeline.length) {
    throw new Error("No timeline data was returned. Please retry.");
  }

  const totalWeeks =
    Number.isFinite(Number(raw?.total_weeks)) && Number(raw.total_weeks) > 0
      ? Number(raw.total_weeks)
      : timeline.length;
  const rawHarvestDate = toDateOnly(raw?.expected_harvest_date);

  let fallbackHarvestDate = "";
  const start = toDateOnly(plantingDate);
  if (!rawHarvestDate && start && totalWeeks > 0) {
    const parsed = new Date(`${start}T12:00:00`);
    parsed.setDate(parsed.getDate() + totalWeeks * 7);
    fallbackHarvestDate = parsed.toISOString().slice(0, 10);
  }

  return {
    crop_name: String(raw?.crop_name || cropName || "Unknown Crop").trim(),
    total_weeks: totalWeeks,
    expected_harvest_date: rawHarvestDate || fallbackHarvestDate,
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
  const [planResult, setPlanResult] = useState(null);
  const [planPlantingDate, setPlanPlantingDate] = useState("");
  const [expandedWeeks, setExpandedWeeks] = useState({});
  const [savedGeneratedPlanId, setSavedGeneratedPlanId] = useState("");

  const [formError, setFormError] = useState("");
  const [generateError, setGenerateError] = useState("");
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

  const persistPlan = async (nextPlan) => {
    if (!nextPlan) return;
    setIsSaving(true);
    setSaveError("");

    try {
      const created = await appClient.entities.CropPlan.create({
        crop_name: nextPlan.crop_name,
        planting_date: planPlantingDate || toDateOnly(plantingDate),
        expected_harvest_date: nextPlan.expected_harvest_date || null,
        timeline: nextPlan.timeline,
        water_schedule: nextPlan.watering_schedule,
        fertilizer_plan: nextPlan.fertilizer_plan,
        soil_requirements: nextPlan.soil_requirements,
        location: location.trim(),
        area_size: areaSize.trim(),
        status: "active",
        growth_stage: toStageKey(nextPlan.timeline[0]?.stage) || "seed_prep",
      });

      setSavedGeneratedPlanId(String(created?.id || ""));
      setSuccessMessage("Crop plan generated and saved.");
      await queryClient.invalidateQueries({ queryKey: ["cropPlans"] });
    } catch (error) {
      setSaveError(`Plan generated, but save failed: ${error?.message || "Unknown error."}`);
    } finally {
      setIsSaving(false);
    }
  };

  const generateTimeline = async () => {
    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError("");
    setGenerateError("");
    setSaveError("");
    setActionError("");
    setSuccessMessage("");
    setSavedGeneratedPlanId("");
    setIsGenerating(true);

    try {
      const result = await appClient.integrations.Core.InvokeLLM({
        prompt: `Generate a practical week-by-week crop plan.
Crop: ${cropName.trim()}
Planting date: ${toDateOnly(plantingDate)}
${location.trim() ? `Location: ${location.trim()}` : ""}
${soilType ? `Soil type: ${soilType}` : ""}
${areaSize.trim() ? `Area size: ${areaSize.trim()}` : ""}

Requirements:
- Include realistic growth stages by week.
- Include weekly activities and one concise tip.
- Include watering, fertilizer, and soil guidance.
- Include expected harvest date.`,
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
      setPlanResult(normalized);
      setPlanPlantingDate(toDateOnly(plantingDate));

      const currentWeek = getCurrentWeek(plantingDate, normalized.total_weeks);
      const initialExpanded = {};
      normalized.timeline.forEach((entry) => {
        initialExpanded[entry.week] =
          currentWeek == null ? entry.week <= 3 : entry.week >= currentWeek && entry.week <= currentWeek + 2;
      });
      setExpandedWeeks(initialExpanded);

      await persistPlan(normalized);
    } catch (error) {
      setGenerateError(error?.message || "Failed to generate plan. Please retry.");
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
    const ok = window.confirm(`Delete "${plan?.crop_name || "this plan"}"? This action cannot be undone.`);
    if (!ok) return;

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
    const query = savedSearch.trim().toLowerCase();
    return savedPlans.filter((plan) => {
      if (savedStatusFilter !== "all" && plan.status !== savedStatusFilter) return false;
      if (!query) return true;
      const searchable = [plan.crop_name, plan.location, plan.status]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return searchable.includes(query);
    });
  }, [savedPlans, savedSearch, savedStatusFilter]);

  const currentWeekNumber = planResult
    ? getCurrentWeek(planPlantingDate, planResult.total_weeks)
    : null;
  const progressPercent =
    planResult && currentWeekNumber
      ? Math.round((currentWeekNumber / planResult.total_weeks) * 100)
      : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-3xl font-bold text-slate-900">
          <Sprout className="h-8 w-8 text-violet-600" />
          AI Crop Planner
        </h2>
        <p className="text-slate-600">Generate and manage detailed crop timelines.</p>
      </div>

      <Card className="rounded-3xl border-none shadow-lg">
        <CardContent className="space-y-5 p-7">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
            <div className={`md:col-span-4 ${FIELD_WRAPPER_CLASS}`}>
              <Label htmlFor="crop" className={FIELD_LABEL_CLASS}>
                Crop Name *
              </Label>
              <Input
                id="crop"
                value={cropName}
                onChange={(event) => setCropName(event.target.value)}
                className={FIELD_CONTROL_CLASS}
              />
            </div>
            <div className={`md:col-span-2 ${FIELD_WRAPPER_CLASS}`}>
              <Label htmlFor="date" className={FIELD_LABEL_CLASS}>
                Planting Date *
              </Label>
              <Input
                id="date"
                type="date"
                value={plantingDate}
                onChange={(event) => setPlantingDate(event.target.value)}
                className={FIELD_CONTROL_CLASS}
              />
            </div>

            <div className={`md:col-span-2 ${FIELD_WRAPPER_CLASS}`}>
              <Label htmlFor="location" className={FIELD_LABEL_CLASS}>
                Location
              </Label>
              <Input
                id="location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                className={FIELD_CONTROL_CLASS}
              />
            </div>
            <div className={`md:col-span-2 ${FIELD_WRAPPER_CLASS}`}>
              <Label htmlFor="soil" className={FIELD_LABEL_CLASS}>
                Soil Type
              </Label>
              <Select value={soilType} onValueChange={setSoilType}>
                <SelectTrigger id="soil" className={FIELD_CONTROL_CLASS}>
                  <SelectValue placeholder="Select soil type" />
                </SelectTrigger>
                <SelectContent>
                {SOIL_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                    {type}
                    </SelectItem>
                ))}
                </SelectContent>
              </Select>
            </div>
            <div className={`md:col-span-2 ${FIELD_WRAPPER_CLASS}`}>
              <Label htmlFor="area" className={FIELD_LABEL_CLASS}>
                Area Size
              </Label>
              <Input
                id="area"
                value={areaSize}
                onChange={(event) => setAreaSize(event.target.value)}
                className={FIELD_CONTROL_CLASS}
              />
            </div>

            <div className="md:col-span-6">
              <div className="flex flex-wrap gap-3 pt-1">
                <Button
                  onClick={generateTimeline}
                  disabled={isGenerating || isSaving}
                  className="h-12 rounded-xl bg-violet-600 px-7 text-lg hover:bg-violet-700"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Calendar className="mr-2 h-4 w-4" />
                      Generate Crop Plan
                    </>
                  )}
                </Button>
                {planResult && !savedGeneratedPlanId ? (
                  <Button variant="outline" className="h-12 rounded-xl" onClick={() => persistPlan(planResult)} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Retry Save
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          {[formError, generateError, saveError].filter(Boolean).map((message) => (
            <Alert key={message} variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ))}

          {successMessage ? (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {planResult ? (
        <Card className="rounded-3xl border-none shadow-lg">
          <CardHeader className="rounded-t-3xl border-b bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 text-white">
            <CardTitle>{planResult.crop_name} Plan</CardTitle>
            <div className="flex flex-wrap gap-4 text-sm text-white/90">
              <span>Duration: {planResult.total_weeks} weeks</span>
              <span>Harvest: {formatDateLabel(planResult.expected_harvest_date)}</span>
              {currentWeekNumber ? <span>Current week: {currentWeekNumber}</span> : null}
              <span>{savedGeneratedPlanId ? "Saved" : "Not saved"}</span>
            </div>
            {progressPercent !== null ? (
              <div className="mt-2">
                <div className="mb-1 flex justify-between text-xs text-white/80">
                  <span>Progress</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-white/25">
                  <div className="h-2 rounded-full bg-white" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            {planResult.timeline.map((week) => (
              <div key={week.week} className="overflow-hidden rounded-xl border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
                  onClick={() =>
                    setExpandedWeeks((previous) => ({
                      ...previous,
                      [week.week]: !previous[week.week],
                    }))
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">Week {week.week}</span>
                    <span className="text-xs font-medium text-violet-700">{week.stage}</span>
                  </div>
                  {expandedWeeks[week.week] ? (
                    <ChevronUp className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  )}
                </button>
                {expandedWeeks[week.week] ? (
                  <div className="space-y-2 border-t px-4 pb-4 pt-3">
                    {(week.activities.length ? week.activities : ["Monitor crop condition and record observations."]).map((activity, index) => (
                      <p key={`${week.week}-${index}`} className="text-sm text-slate-700">
                        - {activity}
                      </p>
                    ))}
                    {week.tips ? (
                      <p className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800">
                        {week.tips}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-3xl border-none shadow-lg">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-violet-600" />
            Saved Crop Plans
          </CardTitle>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="h-11 rounded-xl pl-9"
                value={savedSearch}
                onChange={(event) => setSavedSearch(event.target.value)}
                placeholder="Search plans..."
              />
            </div>
            <select
              value={savedStatusFilter}
              onChange={(event) => setSavedStatusFilter(event.target.value)}
              className="h-11 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">All statuses</option>
              {PLAN_STATUS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
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
            <div className="flex min-h-[140px] items-center justify-center text-slate-700">
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
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
              {savedPlans.length === 0
                ? "No plans yet. Generate your first crop plan above."
                : "No plans match your search/filter."}
            </div>
          ) : null}

          {!isLoadingSavedPlans && !isSavedPlansError ? (
            filteredSavedPlans.map((plan) => {
              const timelineWeeks = Array.isArray(plan.timeline) ? plan.timeline.length : 0;
              const currentWeek = getCurrentWeek(plan.planting_date, timelineWeeks);
              return (
                <div key={plan.id} className="overflow-hidden rounded-xl border">
                  <div className="flex flex-col gap-3 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold text-slate-900">{plan.crop_name || "Unnamed Crop"}</h4>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[plan.status] || STATUS_BADGE_CLASS.planning}`}>
                          {String(plan.status || "planning")}
                        </span>
                        {currentWeek ? (
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                            Week {currentWeek}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                        <span>Planting: {formatDateLabel(plan.planting_date)}</span>
                        <span>Harvest: {formatDateLabel(plan.expected_harvest_date)}</span>
                        {plan.location ? <span>Location: {plan.location}</span> : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={PLAN_STATUS.includes(plan.status) ? plan.status : "planning"}
                        onChange={(event) => updatePlanStatus(plan.id, event.target.value)}
                        disabled={updatingStatusId === plan.id}
                        className="h-9 rounded-lg border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {PLAN_STATUS.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-slate-500 hover:text-slate-700"
                        onClick={() => setExpandedPlanId(expandedPlanId === plan.id ? "" : plan.id)}
                      >
                        {expandedPlanId === plan.id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-rose-400 hover:bg-rose-50 hover:text-rose-600"
                        onClick={() => deletePlan(plan)}
                        disabled={deletingId === plan.id}
                      >
                        {deletingId === plan.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {expandedPlanId === plan.id ? (
                    <div className="space-y-2 border-t p-4">
                      {(Array.isArray(plan.timeline) ? plan.timeline : []).slice(0, 8).map((week, index) => {
                        const normalized = normalizeWeek(week, index);
                        return (
                          <div key={`${plan.id}-${normalized.week}-${index}`} className="text-xs">
                            <p className="font-medium text-slate-700">
                              Week {normalized.week}: {normalized.stage}
                            </p>
                            {normalized.activities.slice(0, 2).map((activity, activityIndex) => (
                              <p key={`${activityIndex}-${activity}`} className="text-slate-500">
                                - {activity}
                              </p>
                            ))}
                          </div>
                        );
                      })}
                      {!Array.isArray(plan.timeline) || plan.timeline.length === 0 ? (
                        <p className="text-xs text-slate-500">No timeline details were saved.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
