import { Badge } from "@/components/ui/badge";
import { MessageCircle, Heart, CheckCircle, User } from "lucide-react";
import { format } from "date-fns";

const formatPostDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return format(date, "MMM d, yyyy");
};

export default function PostList({ posts }) {
  const getCategoryColor = (category) => {
    const colors = {
      pest_control: "bg-red-100 text-red-800",
      disease_management: "bg-orange-100 text-orange-800",
      organic_farming: "bg-green-100 text-green-800",
      irrigation: "bg-blue-100 text-blue-800",
      soil_health: "bg-amber-100 text-amber-800",
      fertilizers: "bg-purple-100 text-purple-800",
      general: "bg-gray-100 text-gray-800"
    };
    return colors[category] || colors.general;
  };

  if (posts.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <MessageCircle className="w-8 h-8 text-gray-400" />
        </div>
        <p className="text-gray-600">No posts yet. Be the first to share!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <div
          key={post.id}
          className="cursor-pointer rounded-xl border border-white/70 bg-white/70 p-5 backdrop-blur-lg transition-all hover:shadow-md"
        >
          <div className="flex items-start gap-3 mb-3">
            <div className="bg-violet-100 p-2 rounded-full">
              <User className="w-5 h-5 text-violet-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-semibold text-gray-900">{post.author_name || 'Anonymous'}</h4>
                <span className="text-xs text-gray-500">
                  {formatPostDate(post.created_date)}
                </span>
                {post.is_solved && (
                  <Badge className="bg-green-100 text-green-800 ml-auto">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Solved
                  </Badge>
                )}
              </div>
              <Badge className={getCategoryColor(post.category)}>
                {post.category.replace(/_/g, ' ')}
              </Badge>
            </div>
          </div>

          <h3 className="text-lg font-bold text-gray-900 mb-2">{post.title}</h3>
          <p className="text-gray-700 mb-3 line-clamp-3">{post.content}</p>

          {post.images && post.images.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {post.images.slice(0, 3).map((img, index) => (
                <img
                  key={img || index}
                  src={img}
                  alt=""
                  className="w-full h-24 object-cover rounded-lg"
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 text-sm text-gray-500">
            <div className="flex items-center gap-1">
              <Heart className="w-4 h-4" />
              <span>{post.likes_count || 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <MessageCircle className="w-4 h-4" />
              <span>{post.comments_count || 0} comments</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
