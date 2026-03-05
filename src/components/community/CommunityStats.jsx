import { Card, CardContent } from "@/components/ui/card";
import { Award, MessageCircle, TrendingUp, Users } from "lucide-react";

export default function CommunityStats({ posts = [], comments = [] }) {
  const postAuthors = posts.map((post) => String(post.author_name || "").trim()).filter(Boolean);
  const commentAuthors = comments.map((comment) => String(comment.author_name || "").trim()).filter(Boolean);
  const uniqueMembers = new Set([...postAuthors, ...commentAuthors]);

  const solvedPosts = posts.filter((post) => Boolean(post.is_solved)).length;
  const totalEngagement =
    comments.length +
    posts.reduce((sum, post) => sum + Number(post.likes_count || 0), 0);

  const stats = [
    {
      label: "Total Posts",
      value: posts.length,
      icon: MessageCircle,
      color: "bg-violet-500",
    },
    {
      label: "Active Members",
      value: uniqueMembers.size,
      icon: Users,
      color: "bg-fuchsia-500",
    },
    {
      label: "Solved Questions",
      value: solvedPosts,
      icon: Award,
      color: "bg-indigo-500",
    },
    {
      label: "Total Engagement",
      value: totalEngagement,
      icon: TrendingUp,
      color: "bg-violet-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label} className="border-none shadow-md">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className={`${stat.color} rounded-lg p-2`}>
                  <Icon className="h-5 w-5 text-white" />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
              <div className="text-xs text-slate-500">{stat.label}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
