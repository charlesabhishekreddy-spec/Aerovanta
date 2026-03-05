import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Plus, X, Loader2, CloudRain, Bug, Sprout, AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const toDateOnly = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const defaultDueDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
};

const normalizeSuggestion = (entry = {}) => {
  const dueDate = toDateOnly(entry.due_date) || defaultDueDate();
  const priority = String(entry.priority || "medium").toLowerCase();
  const normalizedPriority = ["low", "medium", "high", "urgent"].includes(priority) ? priority : "medium";
  const taskType = String(entry.task_type || "monitoring").toLowerCase();
  return {
    title: String(entry.title || "").trim(),
    task_type: taskType || "monitoring",
    due_date: dueDate,
    priority: normalizedPriority,
    description: String(entry.description || "").trim(),
    weather_dependent: Boolean(entry.weather_dependent),
    crop_name: String(entry.crop_name || "").trim(),
    reason: String(entry.reason || "").trim(),
  };
};

export default function AITaskSuggestions() {
  const [suggestions, setSuggestions] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [dismissedIds, setDismissedIds] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const queryClient = useQueryClient();

  const createTaskMutation = useMutation({
    mutationFn: (taskData) => appClient.entities.Task.create(taskData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-tasks"] });
    },
  });

  const generateSuggestions = async () => {
    setIsGenerating(true);
    setErrorMessage("");
    setDismissedIds([]);
    try {
      const user = await appClient.auth.me();
      const location = user?.location || "current location";
      const crops = Array.isArray(user?.primary_crops) ? user.primary_crops : [];

      const [weatherLogsRes, predictionsRes, cropPlansRes, existingTasksRes, weatherContextRes] = await Promise.allSettled([
        appClient.entities.WeatherLog.list("-date", 7),
        appClient.entities.PestPrediction.filter({ is_active: true }),
        appClient.entities.CropPlan.filter({ status: "active" }),
        appClient.entities.Task.filter({ status: "pending" }),
        appClient.integrations.Core.InvokeLLM({
          prompt: `Get current and next 3 day weather context for ${location}.`,
          response_json_schema: {
            type: "object",
            properties: {
              current: {
                type: "object",
                properties: {
                  temperature: { type: "number" },
                  conditions: { type: "string" },
                  humidity: { type: "number" },
                },
              },
              forecast: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    date: { type: "string" },
                    conditions: { type: "string" },
                    high: { type: "number" },
                    low: { type: "number" },
                    precipitation_chance: { type: "number" },
                  },
                },
              },
            },
          },
        }),
      ]);

      const weatherLogs = weatherLogsRes.status === "fulfilled" ? weatherLogsRes.value : [];
      const predictions = predictionsRes.status === "fulfilled" ? predictionsRes.value : [];
      const cropPlans = cropPlansRes.status === "fulfilled" ? cropPlansRes.value : [];
      const existingTasks = existingTasksRes.status === "fulfilled" ? existingTasksRes.value : [];
      const weatherContext =
        weatherContextRes.status === "fulfilled"
          ? weatherContextRes.value
          : { current: {}, forecast: [] };

      const result = await appClient.integrations.Core.InvokeLLM({
        prompt: `You are an enterprise farm operations scheduler.

Create 5-8 specific tasks for the next 7 days.

Farm context:
- Location: ${location}
- Crops: ${crops.join(", ") || "mixed crops"}

Current weather context:
${JSON.stringify(weatherContext.current || {})}

3-day weather context:
${JSON.stringify(weatherContext.forecast || [])}

Recent weather logs:
${weatherLogs.map((item) => `${item.date}: ${item.temperature_high}F, ${item.humidity}% humidity, ${item.conditions}`).join("\n") || "none"}

Active pest predictions:
${predictions.map((item) => `${item.pest_or_disease} (${item.risk_level}) for ${item.affected_crops?.join(", ") || "unknown crop"}`).join("\n") || "none"}

Active crop plans:
${cropPlans.map((item) => `${item.crop_name} (${item.growth_stage}) planted ${item.planting_date}`).join("\n") || "none"}

Existing pending tasks:
${existingTasks.map((item) => `${item.title} due ${item.due_date}`).join("\n") || "none"}

Rules:
- Avoid duplicating existing pending tasks.
- Ensure due_date is in YYYY-MM-DD format.
- Keep tasks practical and specific to weather/crop risk.
- Include rationale in "reason".
`,
        response_json_schema: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  task_type: { type: "string" },
                  due_date: { type: "string" },
                  priority: { type: "string" },
                  description: { type: "string" },
                  weather_dependent: { type: "boolean" },
                  crop_name: { type: "string" },
                  reason: { type: "string" },
                },
              },
            },
          },
        },
      });

      const normalized = Array.isArray(result?.suggestions)
        ? result.suggestions.map(normalizeSuggestion).filter((entry) => entry.title)
        : [];

      const existingKeys = new Set(
        existingTasks.map((task) => `${String(task.title || "").trim().toLowerCase()}|${toDateOnly(task.due_date)}`)
      );
      const uniqueByKey = new Set();
      const deduped = [];

      for (const item of normalized) {
        const key = `${item.title.toLowerCase()}|${item.due_date}`;
        if (existingKeys.has(key) || uniqueByKey.has(key)) continue;
        uniqueByKey.add(key);
        deduped.push(item);
      }

      setSuggestions(deduped);
      if (deduped.length === 0) {
        setErrorMessage("No new unique suggestions were generated. Try refresh after adding weather/task data.");
      }
    } catch (error) {
      console.error("Failed to generate suggestions:", error);
      setSuggestions([]);
      setErrorMessage(error?.message || "Unable to generate AI task suggestions right now.");
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    generateSuggestions();
  }, []);

  const handleAccept = async (suggestion, index) => {
    try {
      await createTaskMutation.mutateAsync({
        title: suggestion.title,
        task_type: suggestion.task_type,
        due_date: suggestion.due_date,
        priority: suggestion.priority,
        description: suggestion.description,
        weather_dependent: suggestion.weather_dependent,
        crop_name: suggestion.crop_name,
        status: "pending",
        auto_generated: true,
        suggestion_reason: suggestion.reason,
      });
      setDismissedIds((prev) => [...prev, index]);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message || "Failed to add suggested task.");
    }
  };

  const handleDismiss = (index) => {
    setDismissedIds((prev) => [...prev, index]);
  };

  const getTaskIcon = (type) => {
    const normalized = String(type || "").toLowerCase();
    if (normalized.includes("water") || normalized.includes("irrigation")) return CloudRain;
    if (normalized.includes("pest")) return Bug;
    return Sprout;
  };

  const visibleSuggestions = suggestions.filter((_, index) => !dismissedIds.includes(index));

  if (isGenerating) {
    return (
      <Card className="border-none shadow-lg">
        <CardContent className="p-8 text-center">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-violet-600" />
          <p className="text-gray-600">Generating AI task suggestions from weather and crop conditions...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-none shadow-lg">
      <CardHeader className="border-b bg-purple-50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            AI Task Suggestions ({visibleSuggestions.length})
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={generateSuggestions} disabled={isGenerating} className="gap-1">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-6">
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {visibleSuggestions.length === 0 ? (
          <p className="text-sm text-gray-600">No suggestions available right now.</p>
        ) : null}

        {visibleSuggestions.map((suggestion, index) => {
          const Icon = getTaskIcon(suggestion.task_type);
          return (
            <div key={`${suggestion.title}-${index}`} className="rounded-lg border bg-gradient-to-r from-purple-50 to-white p-4">
              <div className="mb-2 flex items-start justify-between">
                <div className="flex flex-1 items-start gap-3">
                  <Icon className="mt-1 h-5 w-5 text-purple-600" />
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">{suggestion.title}</p>
                    <p className="mb-2 text-sm text-gray-600">{suggestion.description || "Suggested from current conditions."}</p>
                    <div className="mb-2 flex flex-wrap gap-2">
                      <Badge className="bg-blue-100 text-blue-800">{new Date(suggestion.due_date).toLocaleDateString()}</Badge>
                      <Badge
                        className={
                          suggestion.priority === "urgent"
                            ? "bg-red-100 text-red-800"
                            : suggestion.priority === "high"
                              ? "bg-orange-100 text-orange-800"
                              : "bg-green-100 text-green-800"
                        }
                      >
                        {suggestion.priority}
                      </Badge>
                      {suggestion.weather_dependent ? (
                        <Badge className="bg-sky-100 text-sky-800">Weather-dependent</Badge>
                      ) : null}
                    </div>
                    {suggestion.reason ? <p className="text-xs italic text-gray-500">Reason: {suggestion.reason}</p> : null}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleAccept(suggestion, index)}
                  disabled={createTaskMutation.isPending}
                  className="gap-1 bg-purple-600 hover:bg-purple-700"
                >
                  <Plus className="h-4 w-4" />
                  Add to Schedule
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDismiss(index)}>
                  <X className="h-4 w-4" />
                  Dismiss
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
