import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Leaf, Bug, AlertCircle, X, Droplets, Sprout, Users, ShieldAlert, ShieldCheck } from "lucide-react";
import FeedbackForm from "./FeedbackForm.jsx";

export default function DiagnosisResult({ diagnosis, onStartOver }) {
  const [showFeedback, setShowFeedback] = useState(false);
  const infectionLevel = Math.max(
    0,
    Math.min(100, Number.parseInt(String(diagnosis.infection_level || diagnosis.confidence_score || 0), 10))
  );
  const isReliable = !diagnosis.requires_manual_review;

  const getInfectionColor = (level) => {
    if (level <= 30) return "bg-green-500";
    if (level <= 60) return "bg-yellow-500";
    if (level <= 80) return "bg-orange-500";
    return "bg-red-500";
  };

  return (
    <Card className="h-full overflow-hidden rounded-3xl border border-white/70 bg-white/75 shadow-xl backdrop-blur-sm">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b bg-gradient-to-r from-violet-50/90 to-white p-4">
          <h2 className="text-xl font-bold text-gray-900">Diagnosis Result</h2>
          {onStartOver && (
            <Button variant="ghost" size="sm" onClick={onStartOver} className="gap-1 text-gray-600">
              <X className="h-4 w-4" />
              Start Over
            </Button>
          )}
        </div>

        <div className="space-y-6 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <div
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                isReliable ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {isReliable ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
              {isReliable ? "Verified" : "Needs Review"}
            </div>
            <div className="inline-flex items-center rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
              Confidence {Number.parseInt(String(diagnosis.confidence_score || 0), 10)}%
            </div>
          </div>

          {!isReliable && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Confidence is below enterprise threshold. Capture a clearer plant image before applying treatment actions.
            </div>
          )}

          {diagnosis.image_url && (
            <div className="overflow-hidden rounded-xl border border-violet-100">
              <img src={diagnosis.image_url} alt={diagnosis.plant_name || "Diagnosed plant"} className="h-64 w-full object-cover" />
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-gray-600">
              <Leaf className="h-5 w-5 text-violet-600" />
              <span className="font-medium">Plant</span>
            </div>
            <p className="ml-7 text-xl font-bold text-gray-900">{diagnosis.plant_name || "Unknown plant"}</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-gray-600">
              <Bug className="h-5 w-5 text-red-600" />
              <span className="font-medium">Disease</span>
            </div>
            <p className="ml-7 text-xl font-bold text-gray-900">{diagnosis.disease_name || "No disease detected"}</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-gray-600">
              <AlertCircle className="h-5 w-5 text-orange-600" />
              <span className="font-medium">Infection Level</span>
            </div>
            <div className="ml-7">
              <div className="flex items-center gap-4">
                <div className="h-4 flex-1 overflow-hidden rounded-full bg-gray-200">
                  <div className={`h-full ${getInfectionColor(infectionLevel)} transition-all duration-500`} style={{ width: `${infectionLevel}%` }} />
                </div>
                <span className="w-14 text-right text-lg font-bold text-gray-900">{infectionLevel}%</span>
              </div>
            </div>
          </div>

          {diagnosis.symptoms && diagnosis.symptoms.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-gray-700">Detected Symptoms</h4>
              <ul className="ml-7 space-y-1">
                {diagnosis.symptoms.map((symptom, i) => (
                  <li key={i} className="text-gray-700">
                    - {symptom}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {diagnosis.careAdvice && (
            <div className="space-y-4 border-t pt-4">
              <h3 className="text-lg font-bold text-gray-900">Personalized Care Guide</h3>

              {diagnosis.careAdvice.watering && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Droplets className="h-4 w-4 text-violet-500" />
                    <span className="text-sm font-medium">Watering Schedule</span>
                  </div>
                  <p className="ml-6 text-sm text-gray-700">{diagnosis.careAdvice.watering}</p>
                </div>
              )}

              {diagnosis.careAdvice.fertilizer && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Sprout className="h-4 w-4 text-violet-500" />
                    <span className="text-sm font-medium">Fertilizer</span>
                  </div>
                  <p className="ml-6 text-sm text-gray-700">{diagnosis.careAdvice.fertilizer}</p>
                </div>
              )}

              {diagnosis.careAdvice.companions && diagnosis.careAdvice.companions.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Users className="h-4 w-4 text-violet-500" />
                    <span className="text-sm font-medium">Good Companions</span>
                  </div>
                  <p className="ml-6 text-sm text-gray-700">{diagnosis.careAdvice.companions.join(", ")}</p>
                </div>
              )}
            </div>
          )}

          <div className="border-t pt-4">
            {!showFeedback ? (
              <Button variant="outline" onClick={() => setShowFeedback(true)} className="w-full">
                Rate This Diagnosis
              </Button>
            ) : (
              <FeedbackForm diagnosis={diagnosis} onSubmitted={() => setShowFeedback(false)} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
