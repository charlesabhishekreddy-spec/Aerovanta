import { useState } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Calendar as CalendarIcon, BarChart3, AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import TaskList from "../components/schedule/TaskList.jsx";
import TaskForm from "../components/schedule/TaskForm.jsx";
import TaskStats from "../components/schedule/TaskStats.jsx";
import TaskReports from "../components/schedule/TaskReports.jsx";
import AITaskSuggestions from "../components/schedule/AITaskSuggestions.jsx";

const toDateOnly = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const addRecurringInterval = (dateOnly, pattern) => {
  const baseDate = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(baseDate.getTime())) return "";
  const next = new Date(baseDate);
  if (pattern === "daily") next.setDate(next.getDate() + 1);
  else if (pattern === "weekly") next.setDate(next.getDate() + 7);
  else if (pattern === "biweekly") next.setDate(next.getDate() + 14);
  else next.setMonth(next.getMonth() + 1);
  return next.toISOString().slice(0, 10);
};

export default function Schedule() {
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [showReports, setShowReports] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionError, setActionError] = useState("");
  const queryClient = useQueryClient();

  const currentUserQuery = useQuery({
    queryKey: ["schedule-current-user"],
    queryFn: () => appClient.auth.me(),
  });

  const usersQuery = useQuery({
    queryKey: ["schedule-assignable-users"],
    queryFn: () => appClient.users.listUsers(300),
    enabled: currentUserQuery.data?.role === "admin",
  });

  const { data: tasks = [], isLoading: tasksLoading, isError: tasksError, error: tasksErrorData } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => appClient.entities.Task.list('-due_date'),
  });

  const createMutation = useMutation({
    mutationFn: (data) => appClient.entities.Task.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-tasks"] });
      setShowForm(false);
      setEditingTask(null);
      setActionError("");
    },
    onError: (error) => {
      setActionError(error?.message || "Failed to create task.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.entities.Task.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-tasks"] });
      setShowForm(false);
      setEditingTask(null);
      setActionError("");
    },
    onError: (error) => {
      setActionError(error?.message || "Failed to update task.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.entities.Task.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-tasks"] });
      setActionError("");
    },
    onError: (error) => {
      setActionError(error?.message || "Failed to delete task.");
    },
  });

  const handleSubmit = (data) => {
    if (editingTask) {
      updateMutation.mutate({ id: editingTask.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (task) => {
    setEditingTask(task);
    setShowForm(true);
  };

  const createNextRecurringTask = async (task) => {
    if (!task?.is_recurring || !task?.due_date) return;
    const currentDueDate = toDateOnly(task.due_date);
    const nextDueDate = addRecurringInterval(currentDueDate, task.recurrence_pattern || "weekly");
    if (!nextDueDate) return;

    if (task.recurrence_end_date) {
      const recurrenceEndDate = toDateOnly(task.recurrence_end_date);
      if (recurrenceEndDate && nextDueDate > recurrenceEndDate) {
        return;
      }
    }

    const recurrenceParentId = task.recurrence_parent_id || task.id;
    const duplicate = tasks.some(
      (existing) =>
        existing.id !== task.id &&
        (existing.recurrence_parent_id || existing.id) === recurrenceParentId &&
        toDateOnly(existing.due_date) === nextDueDate
    );
    if (duplicate) return;

    const nextInstance = {
      ...task,
      id: undefined,
      status: "pending",
      due_date: nextDueDate,
      completed_date: null,
      recurrence_parent_id: recurrenceParentId,
      recurrence_instance_index: Number(task.recurrence_instance_index || 0) + 1,
    };
    delete nextInstance.created_date;
    delete nextInstance.updated_date;
    delete nextInstance.created_by;
    delete nextInstance.created_by_email;

    await appClient.entities.Task.create(nextInstance);
  };

  const handleStatusChange = async (task, newStatus) => {
    setActionError("");
    try {
      await updateMutation.mutateAsync({
        id: task.id,
        data: {
          status: newStatus,
          completed_date: newStatus === "completed" ? new Date().toISOString() : null,
        }
      });

      if (newStatus === "completed") {
        await createNextRecurringTask(task);
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }
    } catch (error) {
      setActionError(error?.message || "Failed to update task status.");
    }
  };

  const handleDelete = (task) => {
    const confirmed = window.confirm(`Delete task "${task.title}"? This action cannot be undone.`);
    if (!confirmed) return;
    deleteMutation.mutate(task.id);
  };

  const assignableUsers = currentUserQuery.data?.role === "admin"
    ? (usersQuery.data || [])
    : currentUserQuery.data
      ? [currentUserQuery.data]
      : [];

  const filteredTasks = tasks
    .filter((task) => (filterStatus === "all" ? true : task.status === filterStatus))
    .filter((task) => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return true;
      const title = String(task.title || "").toLowerCase();
      const crop = String(task.crop_name || "").toLowerCase();
      const location = String(task.location || "").toLowerCase();
      return title.includes(query) || crop.includes(query) || location.includes(query);
    });

  if (tasksLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="flex items-center gap-3 text-gray-700">
          <Loader2 className="h-5 w-5 animate-spin text-violet-600" />
          Loading schedule...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Schedule</h2>
          <p className="text-gray-600">Manage your farming tasks and activities</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setShowReports(!showReports)}
            variant="outline"
            className="gap-2"
          >
            <BarChart3 className="w-5 h-5" />
            {showReports ? "Hide Reports" : "View Reports"}
          </Button>
          <Button
            onClick={() => {
              setEditingTask(null);
              setShowForm(true);
            }}
            className="bg-violet-600 hover:bg-violet-700 gap-2"
          >
            <Plus className="w-5 h-5" />
            Add Task
          </Button>
        </div>
      </div>

      {tasksError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{tasksErrorData?.message || "Failed to load tasks."}</AlertDescription>
        </Alert>
      ) : null}

      {actionError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <TaskStats tasks={tasks} />

      {showReports && <TaskReports tasks={tasks} />}

      <AITaskSuggestions />

      <Dialog
        open={showForm}
        onOpenChange={(open) => {
          setShowForm(open);
          if (!open) setEditingTask(null);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto border-none bg-transparent p-0 shadow-none [&>button]:hidden">
          <TaskForm
            task={editingTask}
            allTasks={tasks}
            users={assignableUsers}
            onSubmit={handleSubmit}
            onCancel={() => {
              setShowForm(false);
              setEditingTask(null);
            }}
            isLoading={createMutation.isPending || updateMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      <Card className="border-none shadow-lg">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-violet-600" />
              All Tasks
            </CardTitle>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by title, crop, or location..."
              className="sm:max-w-xs"
            />
            <div className="flex gap-2 flex-wrap">
              {['all', 'pending', 'in_progress', 'completed', 'blocked', 'skipped'].map(status => (
                <Button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  variant={filterStatus === status ? "default" : "outline"}
                  size="sm"
                  className={filterStatus === status ? "bg-violet-600 hover:bg-violet-700" : ""}
                >
                  {status.replace('_', ' ')}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <TaskList
            tasks={filteredTasks}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onStatusChange={handleStatusChange}
          />
        </CardContent>
      </Card>
    </div>
  );
}
