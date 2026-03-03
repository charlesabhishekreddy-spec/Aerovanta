import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { format, isBefore } from "date-fns";

const parseDateSafe = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateSafe = (value) => {
  const date = parseDateSafe(value);
  return date ? format(date, "MMM d, yyyy") : "No due date";
};

export default function TaskReports({ tasks }) {
  const today = new Date();

  // Status Distribution
  const statusData = [
    { name: "Pending", value: tasks.filter(t => t.status === 'pending').length, color: "#f59e0b" },
    { name: "In Progress", value: tasks.filter(t => t.status === 'in_progress').length, color: "#3b82f6" },
    { name: "Completed", value: tasks.filter(t => t.status === 'completed').length, color: "#10b981" },
    { name: "Blocked", value: tasks.filter(t => t.status === 'blocked').length, color: "#ef4444" },
    { name: "Skipped", value: tasks.filter(t => t.status === 'skipped').length, color: "#6b7280" }
  ].filter(item => item.value > 0);

  // Completion Rate by Task Type
  const taskTypeData = [
    'watering', 'fertilizing', 'pest_control', 'pruning', 
    'harvesting', 'planting', 'soil_prep', 'monitoring', 'other'
  ].map(type => {
    const typeTasks = tasks.filter(t => t.task_type === type);
    const completed = typeTasks.filter(t => t.status === 'completed').length;
    return {
      type: type.replace('_', ' '),
      total: typeTasks.length,
      completed: completed,
      rate: typeTasks.length > 0 ? Math.round((completed / typeTasks.length) * 100) : 0
    };
  }).filter(item => item.total > 0);

  // Overdue Tasks
  const overdueTasks = tasks.filter(t => 
    t.status !== 'completed' && 
    t.status !== 'skipped' && 
    parseDateSafe(t.due_date) &&
    isBefore(parseDateSafe(t.due_date), today)
  );

  // Completion Rate
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Priority Distribution
  const priorityData = [
    { name: "Low", value: tasks.filter(t => t.priority === 'low').length, color: "#3b82f6" },
    { name: "Medium", value: tasks.filter(t => t.priority === 'medium').length, color: "#f59e0b" },
    { name: "High", value: tasks.filter(t => t.priority === 'high').length, color: "#f97316" },
    { name: "Urgent", value: tasks.filter(t => t.priority === 'urgent').length, color: "#ef4444" }
  ].filter(item => item.value > 0);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-none shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
                <div className="bg-violet-600 p-2 rounded-lg">
                <CheckCircle className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{completionRate}%</div>
            <div className="text-xs text-gray-500">Completion Rate</div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
                <div className="bg-violet-500 p-2 rounded-lg">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{completedTasks}/{totalTasks}</div>
            <div className="text-xs text-gray-500">Tasks Completed</div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="bg-red-500 p-2 rounded-lg">
                <AlertCircle className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{overdueTasks.length}</div>
            <div className="text-xs text-gray-500">Overdue Tasks</div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
                <div className="bg-indigo-500 p-2 rounded-lg">
                <Clock className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {tasks.filter(t => t.status === 'in_progress').length}
            </div>
            <div className="text-xs text-gray-500">Active Tasks</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <Card className="border-none shadow-lg">
          <CardHeader>
            <CardTitle>Task Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Priority Distribution */}
        <Card className="border-none shadow-lg">
          <CardHeader>
            <CardTitle>Priority Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={priorityData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {priorityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Completion Rate by Task Type */}
      {taskTypeData.length > 0 && (
        <Card className="border-none shadow-lg">
          <CardHeader>
            <CardTitle>Completion Rate by Task Type</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={taskTypeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="type" angle={-45} textAnchor="end" height={100} />
                <YAxis label={{ value: 'Completion Rate (%)', angle: -90, position: 'insideLeft' }} />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-md">
                          <p className="font-semibold capitalize">{data.type}</p>
                          <p className="text-sm text-gray-600">Total: {data.total}</p>
                          <p className="text-sm text-gray-600">Completed: {data.completed}</p>
                          <p className="text-sm text-violet-600 font-semibold">Rate: {data.rate}%</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="rate" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Overdue Tasks List */}
      {overdueTasks.length > 0 && (
        <Card className="border-none shadow-lg border-l-4 border-l-red-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              Overdue Tasks ({overdueTasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {overdueTasks.map(task => (
                <div key={task.id} className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-200">
                  <div>
                    <p className="font-semibold text-gray-900">{task.title}</p>
                    <p className="text-sm text-gray-600">
                      Due: {formatDateSafe(task.due_date)} 
                      {task.assigned_to && ` • Assigned to: ${task.assigned_to}`}
                    </p>
                  </div>
                  <div className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                    {task.priority}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
