import { useState } from "react";
import { appClient } from "@/api/appClient";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Leaf, X } from "lucide-react";
import { format } from "date-fns";

const formatDiagnosisDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return format(date, "MMM d, yyyy");
};

export default function DiagnosisHistory({ diagnoses }) {
  const [expandedId, setExpandedId] = useState(null);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.entities.PlantDiagnosis.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['user-diagnoses']);
    }
  });

  const getSeverityColor = (severity) => {
    const colors = {
      low: "bg-green-100 text-green-800",
      medium: "bg-yellow-100 text-yellow-800",
      high: "bg-orange-100 text-orange-800",
      critical: "bg-red-100 text-red-800"
    };
    return colors[severity] || "bg-gray-100 text-gray-800";
  };

  const getStatusColor = (status) => {
    const colors = {
      diagnosed: "bg-blue-100 text-blue-800",
      treating: "bg-purple-100 text-purple-800",
      recovered: "bg-green-100 text-green-800",
      monitoring: "bg-gray-100 text-gray-800"
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  if (diagnoses.length === 0) {
    return (
      <Card className="border-none shadow-lg">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Leaf className="w-5 h-5 text-violet-600" />
            Diagnosis History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-12 text-center">
          <div className="bg-violet-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Leaf className="w-8 h-8 text-violet-600" />
          </div>
          <p className="text-gray-600">No diagnoses yet. Start by scanning a plant!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-none shadow-lg">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Leaf className="w-5 h-5 text-violet-600" />
          Diagnosis History ({diagnoses.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <div className="space-y-3">
          {diagnoses.map((diagnosis) => (
            <div key={diagnosis.id} className="overflow-hidden rounded-lg border border-white/70 bg-white/60 backdrop-blur-lg">
              <div
                className="flex items-center justify-between p-4 hover:bg-gray-50 cursor-pointer"
                onClick={() => setExpandedId(expandedId === diagnosis.id ? null : diagnosis.id)}
              >
                <div className="flex items-center gap-3 flex-1">
                  {diagnosis.image_url && (
                    <img
                      src={diagnosis.image_url}
                      alt={diagnosis.plant_name}
                      className="w-12 h-12 rounded-lg object-cover"
                    />
                  )}
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">{diagnosis.plant_name}</p>
                    <p className="text-sm text-gray-600">{diagnosis.disease_name}</p>
                    <div className="flex gap-2 mt-1">
                      <Badge className={getSeverityColor(diagnosis.severity)}>
                        {diagnosis.severity}
                      </Badge>
                      <Badge className={getStatusColor(diagnosis.status)}>
                        {diagnosis.status}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right mr-4">
                    <p className="text-xs text-gray-500">
                      {formatDiagnosisDate(diagnosis.created_date)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {diagnosis.confidence_score}% confidence
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete this diagnosis?")) {
                        deleteMutation.mutate(diagnosis.id);
                      }
                    }}
                  >
                    <X className="w-4 h-4 text-gray-400" />
                  </Button>
                </div>
              </div>

              {expandedId === diagnosis.id && (
                <div className="border-t p-4 bg-gray-50 space-y-3">
                  {diagnosis.symptoms && diagnosis.symptoms.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Symptoms</h4>
                      <ul className="space-y-1">
                        {diagnosis.symptoms.map((symptom, idx) => (
                          <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                            <span className="text-violet-600">•</span>
                            {symptom}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {diagnosis.notes && (
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Notes</h4>
                      <p className="text-sm text-gray-700">{diagnosis.notes}</p>
                    </div>
                  )}
                  {diagnosis.location && (
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Location</h4>
                      <p className="text-sm text-gray-700">{diagnosis.location}</p>
                    </div>
                  )}
                  {diagnosis.treatment_applied && (
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Treatment Applied</h4>
                      <p className="text-sm text-gray-700">{diagnosis.treatment_applied}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
