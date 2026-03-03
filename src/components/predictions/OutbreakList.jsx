import { appClient } from "@/api/appClient";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, CheckCircle, AlertTriangle, Clock } from "lucide-react";
import { format } from "date-fns";

const formatReportDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return format(date, "MMM d");
};

export default function OutbreakList({ reports }) {
  const queryClient = useQueryClient();

  const verifyMutation = useMutation({
    mutationFn: async (report) => {
      await appClient.entities.OutbreakReport.update(report.id, {
        verification_count: (report.verification_count || 0) + 1,
        verified: (report.verification_count || 0) + 1 >= 3
      });
    },
    onSuccess: () => queryClient.invalidateQueries(['outbreak-reports'])
  });

  const getSeverityStyle = (severity) => ({
    mild: "bg-green-100 text-green-800",
    moderate: "bg-yellow-100 text-yellow-800",
    severe: "bg-orange-100 text-orange-800",
    critical: "bg-red-100 text-red-800"
  }[severity] || "bg-gray-100 text-gray-800");

  if (!reports?.length) {
    return (
      <Card className="border-none shadow-md">
        <CardContent className="p-8 text-center text-gray-500">
          <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>No outbreak reports in your area yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {reports.map((report) => (
        <Card key={report.id} className={`border-l-4 border-white/70 bg-white/70 backdrop-blur-lg shadow-md ${
          report.verified ? 'border-l-red-500' : 'border-l-violet-400'
        }`}>
          <CardContent className="p-4">
            <div className="flex items-start gap-4">
              {report.image_url && (
                <img src={report.image_url} alt="" className="w-16 h-16 rounded-lg object-cover" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h4 className="font-bold text-gray-900">{report.pest_or_disease}</h4>
                  <Badge className={getSeverityStyle(report.severity)}>{report.severity}</Badge>
                  {report.verified && (
                    <Badge className="bg-red-500 text-white gap-1">
                      <CheckCircle className="w-3 h-3" /> Verified
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-600 mb-2">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {report.location_name}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatReportDate(report.created_date)}
                  </span>
                </div>
                {report.affected_crops?.length > 0 && (
                  <div className="flex gap-1 flex-wrap mb-2">
                    {report.affected_crops.map((crop, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{crop}</Badge>
                    ))}
                  </div>
                )}
                {report.description && (
                  <p className="text-sm text-gray-600 line-clamp-2">{report.description}</p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => verifyMutation.mutate(report)}
                className="shrink-0 gap-1"
              >
                <CheckCircle className="w-4 h-4" />
                Verify ({report.verification_count || 0})
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
