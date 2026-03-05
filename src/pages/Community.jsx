import { useMemo, useState } from "react";
import { appClient } from "@/api/appClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Loader2, Plus, Search, Users } from "lucide-react";
import CommunityStats from "../components/community/CommunityStats.jsx";
import PostForm from "../components/community/PostForm.jsx";
import PostList from "../components/community/PostList.jsx";

const CATEGORIES = [
  { value: "all", label: "All Posts" },
  { value: "pest_control", label: "Pest Control" },
  { value: "disease_management", label: "Disease Management" },
  { value: "organic_farming", label: "Organic Farming" },
  { value: "irrigation", label: "Irrigation" },
  { value: "soil_health", label: "Soil Health" },
  { value: "crop_rotation", label: "Crop Rotation" },
  { value: "fertilizers", label: "Fertilizers" },
  { value: "seeds", label: "Seeds" },
  { value: "equipment", label: "Equipment" },
  { value: "general", label: "General" },
];

const normalize = (value) => String(value || "").trim().toLowerCase();

export default function Community() {
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("latest");
  const [actionError, setActionError] = useState("");

  const {
    data: currentUser = null,
  } = useQuery({
    queryKey: ["community-current-user"],
    queryFn: () => appClient.auth.me(),
  });

  const {
    data: posts = [],
    isLoading: postsLoading,
    isError: postsError,
    error: postsErrorData,
  } = useQuery({
    queryKey: ["forum-posts"],
    queryFn: () => appClient.entities.ForumPost.list("-created_date"),
  });

  const {
    data: comments = [],
    isLoading: commentsLoading,
    isError: commentsError,
    error: commentsErrorData,
  } = useQuery({
    queryKey: ["forum-comments"],
    queryFn: () => appClient.entities.ForumComment.list("-created_date"),
  });

  const createPostMutation = useMutation({
    mutationFn: (payload) => appClient.entities.ForumPost.create(payload),
    onSuccess: async () => {
      setShowForm(false);
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: ["forum-posts"] });
    },
    onError: (error) => {
      setActionError(error?.message || "Failed to create post.");
    },
  });

  const createCommentMutation = useMutation({
    mutationFn: (payload) => appClient.entities.ForumComment.create(payload),
    onSuccess: async () => {
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: ["forum-comments"] });
    },
    onError: (error) => {
      setActionError(error?.message || "Failed to create comment.");
    },
  });

  const toggleSolvedMutation = useMutation({
    mutationFn: ({ postId, nextValue }) =>
      appClient.entities.ForumPost.update(postId, {
        is_solved: nextValue,
        solved_date: nextValue ? new Date().toISOString() : null,
      }),
    onSuccess: async () => {
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: ["forum-posts"] });
    },
    onError: (error) => {
      setActionError(error?.message || "Failed to update post status.");
    },
  });

  const commentsByPostId = useMemo(() => {
    const byPostId = {};
    comments.forEach((comment) => {
      const postId = String(comment?.post_id || "");
      if (!postId) return;
      if (!Array.isArray(byPostId[postId])) byPostId[postId] = [];
      byPostId[postId].push(comment);
    });
    return byPostId;
  }, [comments]);

  const categoryCount = useMemo(() => {
    const countMap = {};
    posts.forEach((post) => {
      const key = String(post.category || "general");
      countMap[key] = (countMap[key] || 0) + 1;
    });
    return countMap;
  }, [posts]);

  const filteredPosts = useMemo(() => {
    const query = normalize(searchQuery);
    let next = [...posts];

    if (selectedCategory !== "all") {
      next = next.filter((post) => post.category === selectedCategory);
    }

    if (query) {
      next = next.filter((post) => {
        const searchable = [
          post.title,
          post.content,
          post.author_name,
          post.category,
          ...(Array.isArray(post.tags) ? post.tags : []),
        ]
          .map((value) => normalize(value))
          .join(" ");
        return searchable.includes(query);
      });
    }

    next.sort((a, b) => {
      if (sortBy === "oldest") {
        return new Date(a.created_date).getTime() - new Date(b.created_date).getTime();
      }
      if (sortBy === "most_discussed") {
        const commentsA = Array.isArray(commentsByPostId[a.id]) ? commentsByPostId[a.id].length : 0;
        const commentsB = Array.isArray(commentsByPostId[b.id]) ? commentsByPostId[b.id].length : 0;
        return commentsB - commentsA;
      }
      if (sortBy === "unsolved") {
        if (Boolean(a.is_solved) === Boolean(b.is_solved)) {
          return new Date(b.created_date).getTime() - new Date(a.created_date).getTime();
        }
        return a.is_solved ? 1 : -1;
      }
      return new Date(b.created_date).getTime() - new Date(a.created_date).getTime();
    });

    return next;
  }, [commentsByPostId, posts, searchQuery, selectedCategory, sortBy]);

  const handleCreatePost = async (payload) => {
    setActionError("");
    const userName =
      String(currentUser?.full_name || "").trim() ||
      String(currentUser?.email || "").split("@")[0] ||
      "Anonymous Farmer";

    await createPostMutation.mutateAsync({
      ...payload,
      author_name: userName,
      likes_count: 0,
      comments_count: 0,
      is_solved: false,
    });
  };

  const handleCreateComment = async (postId, content) => {
    setActionError("");
    const userName =
      String(currentUser?.full_name || "").trim() ||
      String(currentUser?.email || "").split("@")[0] ||
      "Community Member";

    await createCommentMutation.mutateAsync({
      post_id: postId,
      content,
      author_name: userName,
    });
  };

  const handleToggleSolved = async (post) => {
    setActionError("");
    await toggleSolvedMutation.mutateAsync({
      postId: post.id,
      nextValue: !Boolean(post.is_solved),
    });
  };

  const loading = postsLoading || commentsLoading;
  const hasLoadError = postsError || commentsError;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Users className="h-7 w-7 text-violet-600" />
            Community Forum
          </h2>
          <p className="text-slate-600">Share experiences, ask questions, and learn from fellow growers.</p>
        </div>
        <Button
          onClick={() => setShowForm((previous) => !previous)}
          className="gap-2 bg-violet-600 hover:bg-violet-700"
        >
          <Plus className="h-5 w-5" />
          {showForm ? "Close Form" : "New Post"}
        </Button>
      </div>

      {actionError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      {hasLoadError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {postsErrorData?.message || commentsErrorData?.message || "Failed to load community data."}
          </AlertDescription>
        </Alert>
      ) : null}

      <CommunityStats posts={posts} comments={comments} />

      {showForm ? (
        <PostForm
          onSubmit={handleCreatePost}
          onCancel={() => setShowForm(false)}
          isLoading={createPostMutation.isPending}
          errorMessage={createPostMutation.error?.message || ""}
        />
      ) : null}

      <Card className="border-none shadow-lg">
        <CardHeader className="border-b bg-violet-50/60">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((category) => (
                <Button
                  key={category.value}
                  onClick={() => setSelectedCategory(category.value)}
                  variant={selectedCategory === category.value ? "default" : "outline"}
                  size="sm"
                  className={selectedCategory === category.value ? "bg-violet-600 hover:bg-violet-700" : ""}
                >
                  {category.label}
                  {category.value === "all"
                    ? ` (${posts.length})`
                    : ` (${categoryCount[category.value] || 0})`}
                </Button>
              ))}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search title, content, author, or tags..."
                />
              </div>

              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">Latest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="most_discussed">Most discussed</SelectItem>
                  <SelectItem value="unsolved">Unsolved first</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          {loading ? (
            <div className="flex min-h-[220px] items-center justify-center text-slate-700">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-violet-600" />
              Loading community posts...
            </div>
          ) : (
            <PostList
              posts={filteredPosts}
              commentsByPostId={commentsByPostId}
              currentUser={currentUser}
              onCreateComment={handleCreateComment}
              onToggleSolved={handleToggleSolved}
              isCommentPendingPostId={createCommentMutation.isPending ? String(createCommentMutation.variables?.post_id || "") : ""}
              isTogglePendingPostId={toggleSolvedMutation.isPending ? String(toggleSolvedMutation.variables?.postId || "") : ""}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
