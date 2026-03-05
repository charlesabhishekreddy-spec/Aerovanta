import { useMemo, useState } from "react";
import { appClient } from "@/api/appClient";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Activity, Download, FileText, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { format } from "date-fns";

const parseDateSafe = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatSafe = (value, pattern, fallback = "") => {
  const date = parseDateSafe(value);
  return date ? format(date, pattern) : fallback;
};

const severityClass = (severity) => {
  const key = String(severity || "").toLowerCase();
  if (key === "critical") return "bg-red-100 text-red-700";
  if (key === "high") return "bg-orange-100 text-orange-700";
  if (key === "medium") return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700";
};

const statusClass = (status) => {
  const key = String(status || "").toLowerCase();
  if (key === "review_required") return "bg-amber-100 text-amber-700";
  if (key === "diagnosed") return "bg-blue-100 text-blue-700";
  if (key === "monitoring") return "bg-slate-100 text-slate-700";
  if (key === "recovered") return "bg-emerald-100 text-emerald-700";
  return "bg-slate-100 text-slate-700";
};

export default function Dashboard() {
  const [exporting, setExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const diagnosesQuery = useQuery({
    queryKey: ["history-diagnoses"],
    queryFn: () => appClient.entities.PlantDiagnosis.list("-created_date", 1000),
  });

  const diagnoses = diagnosesQuery.data || [];

  const filteredDiagnoses = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    return diagnoses.filter((record) => {
      const severityMatch = severityFilter === "all" || String(record.severity || "").toLowerCase() === severityFilter;
      const statusMatch = statusFilter === "all" || String(record.status || "").toLowerCase() === statusFilter;
      if (!severityMatch || !statusMatch) return false;

      if (search) {
        const plant = String(record.plant_name || "").toLowerCase();
        const disease = String(record.disease_name || "").toLowerCase();
        if (!plant.includes(search) && !disease.includes(search)) return false;
      }

      const created = parseDateSafe(record.created_date);
      if (fromDate && created && created < new Date(`${fromDate}T00:00:00`)) return false;
      if (toDate && created && created > new Date(`${toDate}T23:59:59`)) return false;
      return true;
    });
  }, [diagnoses, searchQuery, severityFilter, statusFilter, fromDate, toDate]);

  const highRiskCount = filteredDiagnoses.filter((record) =>
    ["high", "critical"].includes(String(record.severity || "").toLowerCase())
  ).length;
  const avgConfidence = filteredDiagnoses.length
    ? Math.round(
        filteredDiagnoses.reduce((sum, record) => sum + Number(record.confidence_score || 0), 0) / filteredDiagnoses.length
      )
    : 0;
  const thisMonthCount = filteredDiagnoses.filter((record) => {
    const date = parseDateSafe(record.created_date);
    if (!date) return false;
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }).length;

  const clearFilters = () => {
    setSearchQuery("");
    setSeverityFilter("all");
    setStatusFilter("all");
    setFromDate("");
    setToDate("");
  };

  const exportToCSV = () => {
    setExporting(true);
    try {
      const headers = [
        "Date",
        "Plant Name",
        "Disease",
        "Severity",
        "Confidence",
        "Status",
        "Symptoms",
      ];

      const rows = filteredDiagnoses.map((record) => [
        formatSafe(record.created_date, "yyyy-MM-dd HH:mm", ""),
        record.plant_name || "",
        record.disease_name || "",
        record.severity || "",
        record.confidence_score || "",
        record.status || "",
        Array.isArray(record.symptoms) ? record.symptoms.join(" | ") : "",
      ]);

      const csv = [headers.join(","), ...rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `history-report-${Date.now()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  if (diagnosesQuery.isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="flex items-center gap-3 text-slate-700">
          <Loader2 className="h-5 w-5 animate-spin text-violet-600" />
          Loading history...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="glass-panel flex items-center justify-between p-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">History Center</h1>
          <p className="mt-1 text-slate-600">Track diagnosis history, review trends, and export records.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => diagnosesQuery.refetch()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            onClick={exportToCSV}
            disabled={exporting || filteredDiagnoses.length === 0}
            className="gap-2 bg-violet-600 hover:bg-violet-700"
          >
            <Download className="h-4 w-4" />
            {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
      </div>

      {diagnosesQuery.isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{diagnosesQuery.error?.message || "Failed to load history records."}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="glass-panel">
        <CardContent className="grid gap-3 p-5 md:grid-cols-5">
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search plant or disease..."
            className="md:col-span-2"
          />
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="diagnosed">Diagnosed</SelectItem>
              <SelectItem value="review_required">Review Required</SelectItem>
              <SelectItem value="monitoring">Monitoring</SelectItem>
              <SelectItem value="recovered">Recovered</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            <Button type="button" variant="outline" onClick={clearFilters}>
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass-panel">
          <CardContent className="p-5">
            <p className="text-sm text-slate-600">Visible Records</p>
            <p className="text-2xl font-bold text-slate-800">{filteredDiagnoses.length}</p>
          </CardContent>
        </Card>
        <Card className="glass-panel">
          <CardContent className="p-5">
            <p className="text-sm text-slate-600">High Risk</p>
            <p className="text-2xl font-bold text-rose-700">{highRiskCount}</p>
          </CardContent>
        </Card>
        <Card className="glass-panel">
          <CardContent className="p-5">
            <p className="text-sm text-slate-600">Avg Confidence</p>
            <p className="text-2xl font-bold text-violet-700">{avgConfidence}%</p>
          </CardContent>
        </Card>
        <Card className="glass-panel">
          <CardContent className="p-5">
            <p className="text-sm text-slate-600">This Month</p>
            <p className="text-2xl font-bold text-slate-800">{thisMonthCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-panel">
        <CardHeader className="border-b border-white/50">
          <CardTitle className="flex items-center gap-2 text-slate-800">
            <Activity className="h-5 w-5 text-violet-700" />
            Diagnosis History ({filteredDiagnoses.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          {filteredDiagnoses.length === 0 ? (
            <div className="py-10 text-center text-slate-600">
              <FileText className="mx-auto mb-3 h-10 w-10 text-slate-400" />
              No records match current filters.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredDiagnoses.slice(0, 100).map((record) => (
                <div key={record.id} className="flex items-start justify-between rounded-xl border border-white/60 bg-white/45 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800">{record.plant_name || "Unknown plant"}</p>
                    <p className="text-sm text-slate-600">{record.disease_name || "No disease data"}</p>
                    {Array.isArray(record.symptoms) && record.symptoms.length > 0 ? (
                      <p className="mt-1 text-xs text-slate-500">Symptoms: {record.symptoms.slice(0, 3).join(", ")}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityClass(record.severity)}`}>
                        {record.severity || "low"}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(record.status)}`}>
                        {String(record.status || "diagnosed").replace("_", " ")}
                      </span>
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                        {Number(record.confidence_score || 0)}% confidence
                      </span>
                    </div>
                  </div>
                  <div className="ml-4 shrink-0 text-right">
                    <p className="text-sm text-slate-700">{formatSafe(record.created_date, "MMM d, yyyy", "Unknown date")}</p>
                    <p className="text-xs text-slate-500">{formatSafe(record.created_date, "h:mm a", "")}</p>
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
