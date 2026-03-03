import { useState } from "react";
import { appClient } from "@/api/appClient";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, Download, FileText } from "lucide-react";
import { format } from "date-fns";

const formatSafe = (value, pattern, fallback = "") => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return format(date, pattern);
};

export default function Dashboard() {
  const [exporting, setExporting] = useState(false);

  const { data: diagnoses = [] } = useQuery({
    queryKey: ['all-diagnoses'],
    queryFn: () => appClient.entities.PlantDiagnosis.list('-created_date'),
  });

  const exportToCSV = () => {
    setExporting(true);
    try {
      const headers = ['Date', 'Plant Name', 'Disease', 'Severity', 'Confidence', 'Status'];
      const rows = diagnoses.map((d) => [
        formatSafe(d.created_date, 'yyyy-MM-dd HH:mm', format(new Date(), 'yyyy-MM-dd HH:mm')),
        d.plant_name || '',
        d.disease_name || '',
        d.severity || '',
        d.confidence_score || '',
        d.status || '',
      ]);

      const csv = [headers.join(','), ...rows.map((r) => r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `diagnosis-report-${Date.now()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const highRiskCount = diagnoses.filter((d) => ['high', 'critical'].includes(d.severity)).length;

  return (
    <div className="space-y-6">
      <div className="glass-panel p-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Farm Intelligence Dashboard</h1>
          <p className="text-slate-600 mt-1">Track disease trends and export actionable reports.</p>
        </div>
        <Button onClick={exportToCSV} disabled={exporting || diagnoses.length === 0} className="gap-2 bg-violet-600 hover:bg-violet-700">
          <Download className="w-4 h-4" />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass-panel"><CardContent className="p-5"><p className="text-sm text-slate-600">Total Diagnoses</p><p className="text-2xl font-bold text-slate-800">{diagnoses.length}</p></CardContent></Card>
        <Card className="glass-panel"><CardContent className="p-5"><p className="text-sm text-slate-600">High Risk Cases</p><p className="text-2xl font-bold text-rose-700">{highRiskCount}</p></CardContent></Card>
        <Card className="glass-panel"><CardContent className="p-5"><p className="text-sm text-slate-600">Healthy Ratio</p><p className="text-2xl font-bold text-violet-700">{diagnoses.length ? Math.round(((diagnoses.length - highRiskCount) / diagnoses.length) * 100) : 0}%</p></CardContent></Card>
      </div>

      <Card className="glass-panel">
        <CardHeader className="border-b border-white/50">
          <CardTitle className="text-slate-800 flex items-center gap-2"><Activity className="w-5 h-5 text-violet-700" />Latest Diagnoses</CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          {diagnoses.length === 0 ? (
            <div className="text-center py-10 text-slate-600">
              <FileText className="w-10 h-10 mx-auto mb-3 text-slate-400" />
              No diagnosis data yet.
            </div>
          ) : (
            <div className="space-y-3">
              {diagnoses.slice(0, 12).map((d) => (
                <div key={d.id} className="rounded-xl border border-white/60 bg-white/45 p-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-800">{d.plant_name || 'Unknown plant'}</p>
                    <p className="text-sm text-slate-600">{d.disease_name || 'No disease data'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-700">{formatSafe(d.created_date, 'MMM d, yyyy', "Unknown date")}</p>
                    <p className="text-xs uppercase tracking-wide text-slate-500">{d.severity || 'low'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
