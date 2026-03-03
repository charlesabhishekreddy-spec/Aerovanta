import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Droplets, Sprout, Bug, Scissors, Package, Shovel, Eye, MoreHorizontal,
  Edit, Trash2, CheckCircle, Clock, Play, User, Link
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";

const formatDueDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return format(date, "MMM d, yyyy");
};

export default function TaskList({ tasks, onEdit, onDelete, onStatusChange }) {
  const getTaskIcon = (type) => {
    const icons = {
      watering: Droplets,
      fertilizing: Sprout,
      pest_control: Bug,
      pruning: Scissors,
      harvesting: Package,
      planting: Sprout,
      soil_prep: Shovel,
      monitoring: Eye,
      other: MoreHorizontal
    };
    return icons[type] || MoreHorizontal;
  };

  const getPriorityColor = (priority) => {
    const colors = {
      low: "bg-blue-100 text-blue-800 border-blue-200",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
      high: "bg-orange-100 text-orange-800 border-orange-200",
      urgent: "bg-red-100 text-red-800 border-red-200"
    };
    return colors[priority] || colors.medium;
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: "bg-gray-100 text-gray-800",
      in_progress: "bg-blue-100 text-blue-800",
      completed: "bg-green-100 text-green-800",
      blocked: "bg-red-100 text-red-800",
      skipped: "bg-orange-100 text-orange-800"
    };
    return colors[status] || colors.pending;
  };

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <Clock className="w-8 h-8 text-gray-400" />
        </div>
        <p className="text-gray-600">No tasks found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => {
        const Icon = getTaskIcon(task.task_type);
        return (
          <div
            key={task.id}
            className="flex items-center gap-4 rounded-xl border border-white/70 bg-white/70 p-4 backdrop-blur-lg transition-shadow hover:shadow-md"
          >
            <div className={`p-3 rounded-lg ${
              task.status === 'completed' ? 'bg-green-100' : 'bg-gray-100'
            }`}>
              <Icon className={`w-5 h-5 ${
                task.status === 'completed' ? 'text-green-600' : 'text-gray-600'
              }`} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2 mb-1">
                <h4 className={`font-semibold text-gray-900 ${
                  task.status === 'completed' ? 'line-through' : ''
                }`}>
                  {task.title}
                </h4>
                <Badge className={`${getPriorityColor(task.priority)} border text-xs`}>
                  {task.priority}
                </Badge>
              </div>
              {task.description && (
                <p className="text-sm text-gray-600 mb-2">{task.description}</p>
              )}
              <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                {task.crop_name && <span>🌱 {task.crop_name}</span>}
                {task.location && <span>📍 {task.location}</span>}
                <span>📅 {formatDueDate(task.due_date)}</span>
                {task.assigned_to && (
                  <span className="flex items-center gap-1 bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                    <User className="w-3 h-3" />
                    {task.assigned_to.split('@')[0]}
                  </span>
                )}
                {task.depends_on?.length > 0 && (
                  <span className="flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                    <Link className="w-3 h-3" />
                    {task.depends_on.length} dependencies
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge className={getStatusColor(task.status)}>
                {task.status.replace('_', ' ')}
              </Badge>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="w-5 h-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(task)}>
                    <Edit className="w-4 h-4 mr-2" />
                    Edit Task
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {task.status !== 'in_progress' && (
                    <DropdownMenuItem onClick={() => onStatusChange(task, 'in_progress')}>
                      <Play className="w-4 h-4 mr-2" />
                      Start Task
                    </DropdownMenuItem>
                  )}
                  {task.status !== 'completed' && (
                    <DropdownMenuItem onClick={() => onStatusChange(task, 'completed')}>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Complete Task
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => onDelete(task.id)}
                    className="text-red-600"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Task
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        );
      })}
    </div>
  );
}
