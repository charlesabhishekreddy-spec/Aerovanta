import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, CheckCircle2, MessageCircle, Send, User } from "lucide-react";
import { format } from "date-fns";

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return format(date, "MMM d, yyyy h:mm a");
};

const categoryClass = (category) => {
  const colors = {
    pest_control: "bg-rose-100 text-rose-800",
    disease_management: "bg-orange-100 text-orange-800",
    organic_farming: "bg-emerald-100 text-emerald-800",
    irrigation: "bg-blue-100 text-blue-800",
    soil_health: "bg-amber-100 text-amber-800",
    fertilizers: "bg-fuchsia-100 text-fuchsia-800",
    crop_rotation: "bg-indigo-100 text-indigo-800",
    seeds: "bg-lime-100 text-lime-800",
    equipment: "bg-cyan-100 text-cyan-800",
    general: "bg-slate-100 text-slate-800",
  };
  return colors[category] || colors.general;
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

export default function PostList({
  posts = [],
  commentsByPostId = {},
  currentUser = null,
  onCreateComment,
  onToggleSolved,
  isCommentPendingPostId = "",
  isTogglePendingPostId = "",
}) {
  const [expandedPostIds, setExpandedPostIds] = useState({});
  const [commentDraftByPostId, setCommentDraftByPostId] = useState({});
  const [commentErrorByPostId, setCommentErrorByPostId] = useState({});

  const postCommentCounts = useMemo(() => {
    const counts = {};
    posts.forEach((post) => {
      counts[post.id] = Array.isArray(commentsByPostId[post.id]) ? commentsByPostId[post.id].length : 0;
    });
    return counts;
  }, [commentsByPostId, posts]);

  const isPostOwner = (post) => {
    if (!currentUser) return false;
    if (currentUser.role === "admin") return true;
    if (post?.created_by && post.created_by === currentUser.id) return true;
    return normalizeEmail(post?.created_by_email) === normalizeEmail(currentUser.email);
  };

  const toggleComments = (postId) => {
    setExpandedPostIds((previous) => ({
      ...previous,
      [postId]: !previous[postId],
    }));
  };

  const submitComment = async (postId) => {
    const draft = String(commentDraftByPostId[postId] || "").trim();
    if (draft.length < 2) {
      setCommentErrorByPostId((previous) => ({
        ...previous,
        [postId]: "Comment must be at least 2 characters.",
      }));
      return;
    }

    setCommentErrorByPostId((previous) => ({ ...previous, [postId]: "" }));
    try {
      await onCreateComment(postId, draft);
      setCommentDraftByPostId((previous) => ({ ...previous, [postId]: "" }));
    } catch (error) {
      setCommentErrorByPostId((previous) => ({
        ...previous,
        [postId]: error?.message || "Failed to post comment.",
      }));
    }
  };

  if (!posts.length) {
    return (
      <div className="py-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
          <MessageCircle className="h-8 w-8 text-slate-400" />
        </div>
        <p className="text-slate-600">No posts found. Start the conversation with your first post.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => {
        const comments = Array.isArray(commentsByPostId[post.id]) ? commentsByPostId[post.id] : [];
        const commentCount = postCommentCounts[post.id] ?? 0;
        const commentsExpanded = Boolean(expandedPostIds[post.id]);
        const canSolve = isPostOwner(post);
        const pendingComment = isCommentPendingPostId === post.id;
        const pendingToggle = isTogglePendingPostId === post.id;

        return (
          <div
            key={post.id}
            className="rounded-2xl border border-white/70 bg-white/70 p-5 shadow-sm backdrop-blur-lg transition-all hover:shadow-md"
          >
            <div className="mb-3 flex items-start gap-3">
              <div className="rounded-full bg-violet-100 p-2">
                <User className="h-5 w-5 text-violet-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-slate-900">{post.author_name || "Anonymous Farmer"}</h4>
                  <span className="text-xs text-slate-500">{formatDate(post.created_date)}</span>
                  {post.is_solved ? (
                    <Badge className="ml-auto bg-emerald-100 text-emerald-800">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Solved
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={categoryClass(post.category)}>
                    {String(post.category || "general").replace(/_/g, " ")}
                  </Badge>
                  {(Array.isArray(post.tags) ? post.tags : [])
                    .slice(0, 5)
                    .map((tag) => (
                      <span key={`${post.id}-${tag}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        #{tag}
                      </span>
                    ))}
                </div>
              </div>
            </div>

            <h3 className="mb-2 text-lg font-bold text-slate-900">{post.title}</h3>
            <p className="mb-3 whitespace-pre-wrap text-slate-700">{post.content}</p>

            {Array.isArray(post.images) && post.images.length > 0 ? (
              <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-3">
                {post.images.slice(0, 6).map((imageUrl, index) => (
                  <img
                    key={`${imageUrl}-${index}`}
                    src={imageUrl}
                    alt="Community post attachment"
                    className="h-24 w-full rounded-lg object-cover"
                  />
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => toggleComments(post.id)}
              >
                <MessageCircle className="h-4 w-4" />
                {commentCount} {commentCount === 1 ? "comment" : "comments"}
              </Button>

              {canSolve ? (
                <Button
                  type="button"
                  variant={post.is_solved ? "outline" : "default"}
                  size="sm"
                  disabled={pendingToggle}
                  onClick={() => onToggleSolved(post)}
                  className={post.is_solved ? "" : "bg-emerald-600 hover:bg-emerald-700"}
                >
                  {post.is_solved ? "Mark as Unsolved" : "Mark as Solved"}
                </Button>
              ) : null}
            </div>

            {commentsExpanded ? (
              <div className="mt-4 space-y-3 rounded-xl border bg-slate-50 p-3">
                <div className="space-y-2">
                  {comments.length === 0 ? (
                    <p className="text-sm text-slate-500">No comments yet. Add the first helpful reply.</p>
                  ) : (
                    comments
                      .slice()
                      .reverse()
                      .map((comment) => (
                        <div key={comment.id} className="rounded-lg border bg-white p-3">
                          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="font-medium text-slate-700">{comment.author_name || "Community member"}</span>
                            <span>{formatDate(comment.created_date)}</span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm text-slate-700">{comment.content}</p>
                        </div>
                      ))
                  )}
                </div>

                <div className="space-y-2 border-t pt-3">
                  <Input
                    value={commentDraftByPostId[post.id] || ""}
                    onChange={(event) =>
                      setCommentDraftByPostId((previous) => ({
                        ...previous,
                        [post.id]: event.target.value,
                      }))
                    }
                    placeholder="Add a comment..."
                    disabled={pendingComment}
                  />
                  {commentErrorByPostId[post.id] ? (
                    <div className="flex items-center gap-1 text-xs text-rose-600">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span>{commentErrorByPostId[post.id]}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1 bg-violet-600 hover:bg-violet-700"
                      onClick={() => submitComment(post.id)}
                      disabled={pendingComment}
                    >
                      <Send className="h-3.5 w-3.5" />
                      {pendingComment ? "Posting..." : "Post Comment"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
