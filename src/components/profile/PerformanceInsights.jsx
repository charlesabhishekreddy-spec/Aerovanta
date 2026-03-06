import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Lock,
  MessageSquare,
  PartyPopper,
  Sparkles,
  Sprout,
  Star,
  Trophy,
  TrendingUp
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import confetti from "canvas-confetti";
import {
  endOfWeek,
  format,
  isWithinInterval,
  startOfWeek,
  subWeeks
} from "date-fns";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { toast } from "@/components/ui/use-toast";

const PROGRESS_STORAGE_KEY = "aerovanta_profile_progress_v1";
const LEGACY_PROGRESS_STORAGE_KEY = "verdent_vision_profile_progress_v1";

function launchLevelUpConfetti() {
  const duration = 1800;
  const end = Date.now() + duration;

  const frame = () => {
    const left = end - Date.now();
    if (left <= 0) return;

    const particleCount = Math.max(10, Math.round(70 * (left / duration)));
    confetti({
      particleCount,
      startVelocity: 32,
      spread: 70,
      ticks: 90,
      origin: { x: 0.2, y: 0.25 },
      scalar: 0.9,
      zIndex: 9999
    });
    confetti({
      particleCount,
      startVelocity: 32,
      spread: 70,
      ticks: 90,
      origin: { x: 0.8, y: 0.25 },
      scalar: 0.9,
      zIndex: 9999
    });

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export default function PerformanceInsights({
  diagnoses = [],
  tasks = [],
  posts = [],
  cropPlans = []
}) {
  const [unlockPopups, setUnlockPopups] = useState([]);
  const [levelUpState, setLevelUpState] = useState(null);
  const initializedRef = useRef(false);
  const previousLevelRef = useRef(1);
  const previousUnlockedRef = useRef([]);

  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const activeCrops = cropPlans.filter((plan) => plan.status === "active").length;

  const xp = diagnoses.length * 12 + completedTasks * 8 + posts.length * 10 + activeCrops * 6;
  const level = Math.max(1, Math.floor(xp / 120) + 1);
  const levelStartXp = (level - 1) * 120;
  const levelProgress = Math.min(100, Math.round(((xp - levelStartXp) / 120) * 100));

  const weeklyActivity = useMemo(() => {
    const now = new Date();

    return Array.from({ length: 6 }).map((_, index) => {
      const weekStart = startOfWeek(subWeeks(now, 5 - index), { weekStartsOn: 1 });
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

      const diagnosisCount = diagnoses.filter((entry) => {
        const date = toDate(entry.created_date);
        return date && isWithinInterval(date, { start: weekStart, end: weekEnd });
      }).length;

      const completedCount = tasks.filter((entry) => entry.status === "completed").filter((entry) => {
        const date = toDate(entry.updated_date || entry.created_date || entry.due_date);
        return date && isWithinInterval(date, { start: weekStart, end: weekEnd });
      }).length;

      return {
        week: `W${index + 1}`,
        Diagnoses: diagnosisCount,
        "Completed Tasks": completedCount
      };
    });
  }, [diagnoses, tasks]);

  const achievements = useMemo(
    () => [
      {
        id: "first-diagnosis",
        title: "First Diagnosis",
        description: "Complete your first scan",
        icon: Camera,
        value: diagnoses.length,
        target: 1
      },
      {
        id: "field-scientist",
        title: "Field Scientist",
        description: "Complete 50 diagnoses",
        icon: Activity,
        value: diagnoses.length,
        target: 50
      },
      {
        id: "task-master",
        title: "Task Master",
        description: "Finish 100 tasks",
        icon: ClipboardCheck,
        value: completedTasks,
        target: 100
      },
      {
        id: "community-helper",
        title: "Community Helper",
        description: "Create 10 community posts",
        icon: MessageSquare,
        value: posts.length,
        target: 10
      },
      {
        id: "crop-master",
        title: "Crop Master",
        description: "Manage 6 active crops",
        icon: Sprout,
        value: activeCrops,
        target: 6
      },
      {
        id: "rising-star",
        title: "Rising Star",
        description: "Reach level 8",
        icon: Star,
        value: level,
        target: 8
      }
    ],
    [activeCrops, completedTasks, diagnoses.length, level, posts.length]
  );

  const unlockedAchievementIds = useMemo(
    () => achievements.filter((achievement) => achievement.value >= achievement.target).map((achievement) => achievement.id),
    [achievements]
  );

  useEffect(() => {
    let snapshot = null;

    try {
      snapshot = JSON.parse(
        window.localStorage.getItem(PROGRESS_STORAGE_KEY)
          || window.localStorage.getItem(LEGACY_PROGRESS_STORAGE_KEY)
          || "null"
      );
    } catch {
      snapshot = null;
    }

    if (!initializedRef.current) {
      previousLevelRef.current = typeof snapshot?.level === "number" ? snapshot.level : level;
      previousUnlockedRef.current = Array.isArray(snapshot?.unlockedIds) ? snapshot.unlockedIds : unlockedAchievementIds;
      initializedRef.current = true;

      try {
        window.localStorage.setItem(
          PROGRESS_STORAGE_KEY,
          JSON.stringify({ level, unlockedIds: unlockedAchievementIds })
        );
        window.localStorage.removeItem(LEGACY_PROGRESS_STORAGE_KEY);
      } catch {
        // Ignore storage failures
      }
      return;
    }

    const previousLevel = previousLevelRef.current;
    const previousUnlocked = previousUnlockedRef.current;
    const achievementMap = new Map(achievements.map((achievement) => [achievement.id, achievement]));

    const newlyUnlocked = unlockedAchievementIds.filter((id) => !previousUnlocked.includes(id));

    if (newlyUnlocked.length > 0) {
      newlyUnlocked.forEach((id) => {
        const achievement = achievementMap.get(id);
        if (!achievement) return;

        const popupId = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setUnlockPopups((current) => [
          ...current,
          {
            id: popupId,
            title: achievement.title,
            description: achievement.description,
            icon: achievement.icon
          }
        ]);

        window.setTimeout(() => {
          setUnlockPopups((current) => current.filter((popup) => popup.id !== popupId));
        }, 4200);

        toast({
          title: "Badge Unlocked",
          description: `${achievement.title} earned`
        });
      });
    }

    if (level > previousLevel) {
      setLevelUpState({
        from: previousLevel,
        to: level
      });
      window.setTimeout(() => setLevelUpState(null), 7000);
      launchLevelUpConfetti();
      toast({
        title: "Level Up!",
        description: `You reached Level ${level}`
      });
    }

    previousLevelRef.current = level;
    previousUnlockedRef.current = unlockedAchievementIds;

    try {
      window.localStorage.setItem(
        PROGRESS_STORAGE_KEY,
        JSON.stringify({ level, unlockedIds: unlockedAchievementIds })
      );
      window.localStorage.removeItem(LEGACY_PROGRESS_STORAGE_KEY);
    } catch {
      // Ignore storage failures
    }
  }, [achievements, level, unlockedAchievementIds]);

  const recentActivity = useMemo(() => {
    const items = [];

    diagnoses.forEach((entry) => {
      const date = toDate(entry.created_date);
      if (!date) return;
      items.push({
        id: `diagnosis-${entry.id}`,
        icon: Camera,
        title: `Diagnosed ${entry.plant_name || "crop"} ${entry.disease_name ? `(${entry.disease_name})` : ""}`.trim(),
        date
      });
    });

    tasks
      .filter((entry) => entry.status === "completed")
      .forEach((entry) => {
        const date = toDate(entry.updated_date || entry.created_date || entry.due_date);
        if (!date) return;
        items.push({
          id: `task-${entry.id}`,
          icon: CheckCircle2,
          title: `Completed task: ${entry.title || "Task"}`,
          date
        });
      });

    posts.forEach((entry) => {
      const date = toDate(entry.created_date);
      if (!date) return;
      items.push({
        id: `post-${entry.id}`,
        icon: MessageSquare,
        title: `Posted in community: ${entry.title || "New post"}`,
        date
      });
    });

    return items
      .sort((a, b) => b.date - a.date)
      .slice(0, 6);
  }, [diagnoses, posts, tasks]);

  return (
    <div className="space-y-6">
      <div className="pointer-events-none fixed right-5 top-24 z-[80] space-y-3 sm:right-8">
        <AnimatePresence>
          {unlockPopups.map((popup) => {
            const Icon = popup.icon;
            return (
              <motion.div
                key={popup.id}
                initial={{ opacity: 0, y: -18, x: 14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
                exit={{ opacity: 0, y: -14, x: 20, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 360, damping: 30 }}
                className="w-[290px] rounded-2xl border border-violet-200/90 bg-white/92 p-4 shadow-[0_14px_36px_rgba(109,40,217,0.28)] backdrop-blur-xl"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-violet-100 p-2.5">
                    <Icon className="h-4 w-4 text-violet-700" />
                  </div>
                  <div>
                    <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-violet-700">
                      <Sparkles className="h-3.5 w-3.5" />
                      Badge Unlocked
                    </p>
                    <p className="text-sm font-semibold text-slate-900">{popup.title}</p>
                    <p className="text-xs text-slate-600">{popup.description}</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {levelUpState ? (
          <motion.div
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.35 }}
            className="relative overflow-hidden rounded-2xl border border-violet-200/80 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 p-5 text-white shadow-[0_15px_40px_rgba(124,58,237,0.34)]"
          >
            <div className="absolute right-4 top-4 opacity-30">
              <PartyPopper className="h-10 w-10" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-100">Level Up Celebration</p>
            <p className="mt-1 text-2xl font-semibold">Level {levelUpState.to} Unlocked</p>
            <p className="mt-1 text-sm text-violet-100">
              You advanced from Level {levelUpState.from} to Level {levelUpState.to}. Keep going.
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Card className="border-none shadow-lg">
        <CardHeader className="border-b bg-violet-50/70">
          <CardTitle className="flex items-center gap-2 text-violet-900">
            <Trophy className="h-5 w-5 text-violet-600" />
            Farmer Progress
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-slate-600">Level</p>
              <p className="text-3xl font-semibold text-slate-900">{level}</p>
            </div>
            <Badge className="bg-violet-100 text-violet-800">
              {xp} XP
            </Badge>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>Progress to Level {level + 1}</span>
              <span>{levelProgress}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-violet-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-500"
                style={{ width: `${levelProgress}%` }}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-violet-100 bg-white/70 p-3">
              <p className="text-xs text-slate-500">Diagnoses</p>
              <p className="text-lg font-semibold text-slate-900">{diagnoses.length}</p>
            </div>
            <div className="rounded-xl border border-violet-100 bg-white/70 p-3">
              <p className="text-xs text-slate-500">Completed Tasks</p>
              <p className="text-lg font-semibold text-slate-900">{completedTasks}</p>
            </div>
            <div className="rounded-xl border border-violet-100 bg-white/70 p-3">
              <p className="text-xs text-slate-500">Community Posts</p>
              <p className="text-lg font-semibold text-slate-900">{posts.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-lg">
        <CardHeader className="border-b bg-violet-50/70">
          <CardTitle className="flex items-center gap-2 text-violet-900">
            <TrendingUp className="h-5 w-5 text-violet-600" />
            Activity Summary (6 Weeks)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weeklyActivity}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ddd6fe" />
                <XAxis dataKey="week" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #ddd6fe",
                    backgroundColor: "rgba(255,255,255,0.96)"
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="Diagnoses" stroke="#8b5cf6" strokeWidth={3} />
                <Line type="monotone" dataKey="Completed Tasks" stroke="#14b8a6" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-lg">
        <CardHeader className="border-b bg-violet-50/70">
          <CardTitle className="text-violet-900">Achievements</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-6 sm:grid-cols-2">
          {achievements.map((achievement) => {
            const unlocked = achievement.value >= achievement.target;
            const progress = Math.min(100, Math.round((achievement.value / achievement.target) * 100));
            const Icon = achievement.icon;

            return (
              <div
                key={achievement.id}
                className={`rounded-xl border p-4 ${
                  unlocked ? "border-violet-200 bg-violet-50/75" : "border-slate-200 bg-slate-50/80"
                }`}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`rounded-lg p-2 ${unlocked ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{achievement.title}</p>
                      <p className="text-xs text-slate-600">{achievement.description}</p>
                    </div>
                  </div>
                  {unlocked ? (
                    <Badge className="bg-violet-600 text-white">Unlocked</Badge>
                  ) : (
                    <Lock className="h-4 w-4 text-slate-400" />
                  )}
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{achievement.value}/{achievement.target}</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full ${unlocked ? "bg-violet-500" : "bg-slate-400"}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-none shadow-lg">
        <CardHeader className="border-b bg-violet-50/70">
          <CardTitle className="text-violet-900">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-6">
          {recentActivity.length === 0 ? (
            <p className="text-sm text-slate-600">No recent activity yet.</p>
          ) : (
            recentActivity.map((activity) => {
              const Icon = activity.icon;
              return (
                <div key={activity.id} className="flex items-center gap-3 rounded-xl border border-violet-100/80 bg-white/70 p-3">
                  <div className="rounded-lg bg-violet-100 p-2">
                    <Icon className="h-4 w-4 text-violet-700" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900">{activity.title}</p>
                    <p className="text-xs text-slate-500">{format(activity.date, "MMM d, yyyy - h:mm a")}</p>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
