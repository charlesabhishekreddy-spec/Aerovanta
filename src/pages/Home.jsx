import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Camera, MessageCircle, Calendar, Sprout, Activity, 
  TrendingUp, Clock
} from "lucide-react";
import { format } from "date-fns";
import WeatherDashboard from "../components/weather/WeatherDashboard";
import WeatherRecommendations from "../components/weather/WeatherRecommendations";

const formatDueDate = (value) => {
  if (!value) return "No due date";
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return "No due date";
  return format(parsedDate, "MMM d, yyyy");
};

export default function Home() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    appClient.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: diagnoses = [] } = useQuery({
    queryKey: ['recent-diagnoses'],
    queryFn: () => appClient.entities.PlantDiagnosis.list('-created_date', 5),
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['upcoming-tasks'],
    queryFn: () => appClient.entities.Task.filter({ status: 'pending' }, 'due_date', 5),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['active-plans'],
    queryFn: () => appClient.entities.CropPlan.filter({ status: 'active' }, '-created_date', 3),
  });

  const stats = [
    {
      title: "Total Diagnoses",
      value: diagnoses.length,
      icon: Activity,
      color: "bg-violet-500",
      change: "+12%"
    },
    {
      title: "Active Tasks",
      value: tasks.length,
      icon: Clock,
      color: "bg-fuchsia-500",
      change: "5 pending"
    },
    {
      title: "Crop Plans",
      value: plans.length,
      icon: Sprout,
      color: "bg-violet-400",
      change: "Growing"
    },
    {
      title: "Health Score",
      value: "92%",
      icon: TrendingUp,
      color: "bg-indigo-500",
      change: "+5%"
    }
  ];

  const quickActions = [
    {
      title: "Diagnose Plant",
      icon: Camera,
      color: "from-violet-500 to-fuchsia-600",
      path: "Diagnose"
    },
    {
      title: "Ask AI",
      icon: MessageCircle,
      color: "from-violet-600 to-indigo-600",
      path: "Chat"
    },
    {
      title: "Schedule Task",
      icon: Calendar,
      color: "from-purple-500 to-violet-600",
      path: "Schedule"
    },
    {
      title: "Crop Planner",
      icon: Sprout,
      color: "from-fuchsia-500 to-violet-600",
      path: "Planner"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="glass-panel bg-gradient-to-r from-violet-200/85 via-purple-200/75 to-fuchsia-200/75 p-6 text-slate-800">
        <h2 className="mb-2 text-2xl font-semibold">
          Welcome back, {user?.full_name?.split(' ')[0] || 'Farmer'}! 🌱
        </h2>
        <p className="text-slate-600">
          Your crops are looking healthy today. Keep up the great work!
        </p>
      </div>

      {/* Real-Time Weather & Recommendations */}
      <div className="glass-panel p-4 sm:p-5 lg:p-6">
        <div className="grid gap-4 lg:grid-cols-3 items-stretch">
          <div className="lg:col-span-2 lg:h-[760px]">
            <WeatherDashboard className="h-full" />
          </div>
          <div className="lg:h-[760px]">
            <WeatherRecommendations className="h-full" />
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title || stat.id || Math.random()} className="border-none shadow-md hover:shadow-lg transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className={`${stat.color} p-2 rounded-lg`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                </div>
                <div className="text-2xl font-semibold text-gray-900">{stat.value}</div>
                <div className="text-xs text-gray-500">{stat.title}</div>
                <div className="text-xs text-violet-600 font-medium mt-1">{stat.change}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.path || action.title} to={createPageUrl(action.path)}>
                <Card className="border-none hover:scale-105 transition-transform cursor-pointer overflow-hidden h-full">
                  <div className={`bg-gradient-to-br ${action.color} p-6 text-white h-full flex flex-col items-center justify-center gap-2`}>
                    <Icon className="w-8 h-8" />
                    <span className="text-center text-sm font-medium">{action.title}</span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Recent Diagnoses */}
      {diagnoses.length > 0 && (
        <Card className="border-none shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-violet-600" />
              Recent Diagnoses
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {diagnoses.slice(0, 3).map((diagnosis) => (
              <div key={diagnosis.id} className="flex items-center gap-3 rounded-lg border border-violet-100/70 bg-white/70 p-3">
                {diagnosis.image_url && (
                  <img 
                    src={diagnosis.image_url} 
                    alt={diagnosis.plant_name}
                    className="w-12 h-12 rounded-lg object-cover"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-gray-900">{diagnosis.plant_name}</p>
                  <p className="text-sm text-gray-600 truncate">{diagnosis.disease_name || 'Healthy'}</p>
                </div>
                <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                  diagnosis.severity === 'low' ? 'bg-green-100 text-green-700' :
                  diagnosis.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {diagnosis.severity}
                </div>
              </div>
            ))}
            <Link to={createPageUrl("Dashboard")}>
              <Button variant="outline" className="w-full mt-2">View All</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Upcoming Tasks */}
      {tasks.length > 0 && (
        <Card className="border-none shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-violet-600" />
              Upcoming Tasks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {tasks.slice(0, 3).map((task) => (
              <div key={task.id} className="flex items-center gap-3 rounded-lg border border-violet-200/70 bg-violet-50/60 p-3">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{task.title}</p>
                  <p className="text-sm text-gray-600">
                    {formatDueDate(task.due_date)}
                  </p>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                  task.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                  task.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                  'bg-blue-100 text-blue-700'
                }`}>
                  {task.priority}
                </div>
              </div>
            ))}
            <Link to={createPageUrl("Schedule")}>
              <Button variant="outline" className="w-full mt-2">View Schedule</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
