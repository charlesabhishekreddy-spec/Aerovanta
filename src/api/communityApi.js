import { appClient } from "@/api/appClient";

export async function fetchPosts() {
  return appClient.entities.ForumPost.list("-created_date");
}

export async function createPost(postData) {
  return appClient.entities.ForumPost.create(postData);
}
