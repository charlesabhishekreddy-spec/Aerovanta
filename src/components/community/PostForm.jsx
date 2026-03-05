import { useRef, useState } from "react";
import { appClient } from "@/api/appClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Loader2, Upload, X } from "lucide-react";

const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_COUNT = 4;

const CATEGORIES = [
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

const parseTags = (value) => {
  if (!value) return [];
  return Array.from(
    new Set(
      String(value)
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, 8);
};

export default function PostForm({ onSubmit, onCancel, isLoading, errorMessage = "" }) {
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    category: "general",
    tagsText: "",
    images: [],
  });
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);

  const validate = () => {
    const title = String(formData.title || "").trim();
    const content = String(formData.content || "").trim();
    if (title.length < 6) return "Title must be at least 6 characters.";
    if (content.length < 20) return "Content must be at least 20 characters.";
    return "";
  };

  const handleImageUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;

    const remainingSlots = MAX_IMAGE_COUNT - formData.images.length;
    if (remainingSlots <= 0) {
      setUploadError(`You can upload up to ${MAX_IMAGE_COUNT} images.`);
      return;
    }

    const validFiles = files.slice(0, remainingSlots).filter((file) => {
      if (!String(file.type || "").startsWith("image/")) return false;
      return file.size <= MAX_IMAGE_SIZE_BYTES;
    });

    if (!validFiles.length) {
      setUploadError("Please upload valid images under 8MB each.");
      return;
    }

    setUploading(true);
    setUploadError("");
    try {
      const uploads = await Promise.all(
        validFiles.map((file) => appClient.integrations.Core.UploadFile({ file }))
      );
      const newUrls = uploads
        .map((entry) => String(entry?.file_url || ""))
        .filter(Boolean);

      setFormData((previous) => ({
        ...previous,
        images: [...previous.images, ...newUrls].slice(0, MAX_IMAGE_COUNT),
      }));
    } catch (error) {
      setUploadError(error?.message || "Failed to upload images.");
    } finally {
      setUploading(false);
    }
  };

  const submitForm = async (event) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError("");
    const payload = {
      title: formData.title.trim(),
      content: formData.content.trim(),
      category: formData.category || "general",
      images: formData.images,
      tags: parseTags(formData.tagsText),
      is_solved: false,
    };
    await onSubmit(payload);
  };

  return (
    <Card className="rounded-3xl border-none shadow-lg">
      <CardHeader className="border-b bg-violet-50/70">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Create New Post</CardTitle>
          <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Close form">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        <form onSubmit={submitForm} className="space-y-4">
          {formError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          {errorMessage ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="community-post-title">Title *</Label>
            <Input
              id="community-post-title"
              value={formData.title}
              onChange={(event) => setFormData((previous) => ({ ...previous, title: event.target.value }))}
              placeholder="What problem or topic do you want to discuss?"
              maxLength={180}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="community-post-content">Content *</Label>
            <Textarea
              id="community-post-content"
              value={formData.content}
              onChange={(event) => setFormData((previous) => ({ ...previous, content: event.target.value }))}
              placeholder="Share crop, symptoms, weather, and what you already tried..."
              rows={7}
              maxLength={5000}
              required
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="community-post-category">Category *</Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData((previous) => ({ ...previous, category: value }))}
              >
                <SelectTrigger id="community-post-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((category) => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="community-post-tags">Tags</Label>
              <Input
                id="community-post-tags"
                value={formData.tagsText}
                onChange={(event) => setFormData((previous) => ({ ...previous, tagsText: event.target.value }))}
                placeholder="leaf spot, tomato, rainy season"
              />
              <p className="text-xs text-slate-500">Comma-separated, up to 8 tags.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Images (optional)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || formData.images.length >= MAX_IMAGE_COUNT}
              className="w-full"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Images ({formData.images.length}/{MAX_IMAGE_COUNT})
                </>
              )}
            </Button>

            {uploadError ? <p className="text-sm text-rose-600">{uploadError}</p> : null}

            {formData.images.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {formData.images.map((url, index) => (
                  <div key={`${url}-${index}`} className="relative">
                    <img src={url} alt="Post upload" className="h-24 w-full rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((previous) => ({
                          ...previous,
                          images: previous.images.filter((_, imageIndex) => imageIndex !== index),
                        }))
                      }
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-sm text-white"
                      aria-label="Remove uploaded image"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || uploading} className="bg-violet-600 hover:bg-violet-700">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Posting...
                </>
              ) : (
                "Post to Community"
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
