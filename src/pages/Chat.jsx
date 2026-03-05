import { useEffect, useMemo, useRef, useState } from "react";
import { appClient } from "@/api/appClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Camera, Loader2, RotateCcw, Send, Sparkles, Trash2, Leaf, AlertCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";

const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_CONTEXT_MESSAGES = 12;

const STARTER_PROMPTS = [
  "My tomato leaves have yellow spots. What should I check first?",
  "Create a weekly irrigation plan for cucumbers in hot weather.",
  "How do I control aphids using integrated pest management?",
  "What fertilizer schedule is safe for young chili plants?",
];

const INITIAL_ASSISTANT_MESSAGE = {
  id: "assistant-initial",
  role: "assistant",
  content:
    "I am your AI farming assistant. Ask about crop care, pests, disease symptoms, irrigation, fertilizer plans, and weather-based actions.",
  createdAt: new Date().toISOString(),
};

const createId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const buildConversationForApi = (messages) =>
  messages
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((entry) => ({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: String(entry.content || "").replace(/\s+/g, " ").trim().slice(0, 1200),
    }))
    .filter((entry) => entry.content);

const toAssistantText = (response) => {
  if (typeof response === "string") return response.trim();
  if (response && typeof response === "object") {
    return String(response.answer || response.message || "").trim();
  }
  return "";
};

const formatMessageTime = (isoValue) => {
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export default function Chat() {
  const [messages, setMessages] = useState([INITIAL_ASSISTANT_MESSAGE]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");
  const [uploadedImageName, setUploadedImageName] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [lastRequestPayload, setLastRequestPayload] = useState(null);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const canSend = useMemo(
    () => !isLoading && !isUploadingImage && (draft.trim().length > 0 || uploadedImageUrl),
    [draft, isLoading, isUploadingImage, uploadedImageUrl]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const appendAssistantMessage = (content, isError = false) => {
    setMessages((prev) => [
      ...prev,
      {
        id: createId(),
        role: "assistant",
        content,
        isError,
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  const requestAssistant = async ({ questionText, imageUrl, conversation }) => {
    const response = await appClient.ai.getFarmAdvice({
      prompt: questionText || "Analyze the attached crop image and provide guidance.",
      file_urls: imageUrl ? [imageUrl] : [],
      conversation,
      locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
    });
    const answer = toAssistantText(response);
    if (!answer) {
      throw new Error("The assistant returned an empty response.");
    }
    return answer;
  };

  const runAssistantRequest = async (payload, appendErrorBubble = true) => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const answer = await requestAssistant(payload);
      appendAssistantMessage(answer, false);
    } catch (error) {
      const message = error?.message || "Unable to get an AI response right now.";
      setErrorMessage(message);
      if (appendErrorBubble) {
        appendAssistantMessage(
          "I could not complete that request. Please retry, or simplify your question with crop, symptom, and recent weather.",
          true
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!canSend) return;
    const questionText = draft.trim();
    const imageUrl = uploadedImageUrl;
    const imageName = uploadedImageName;

    const userMessage = {
      id: createId(),
      role: "user",
      content: questionText || "Please analyze this image.",
      image: imageUrl || "",
      imageName: imageName || "",
      createdAt: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMessage];
    const conversation = buildConversationForApi(nextMessages);
    const payload = { questionText, imageUrl, conversation };

    setMessages(nextMessages);
    setDraft("");
    setUploadedImageUrl("");
    setUploadedImageName("");
    setLastRequestPayload(payload);

    await runAssistantRequest(payload, true);
  };

  const retryLastRequest = async () => {
    if (!lastRequestPayload || isLoading) return;
    await runAssistantRequest(lastRequestPayload, false);
  };

  const clearChat = () => {
    if (isLoading) return;
    setMessages([INITIAL_ASSISTANT_MESSAGE]);
    setDraft("");
    setUploadedImageUrl("");
    setUploadedImageName("");
    setErrorMessage("");
    setLastRequestPayload(null);
  };

  const onSelectStarter = (text) => {
    setDraft(text);
  };

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setErrorMessage("Image is too large. Please upload an image smaller than 8MB.");
      return;
    }

    setIsUploadingImage(true);
    setErrorMessage("");
    try {
      const uploaded = await appClient.integrations.Core.UploadFile({ file });
      setUploadedImageUrl(String(uploaded?.file_url || ""));
      setUploadedImageName(file.name || "image");
    } catch (error) {
      setErrorMessage(error?.message || "Failed to upload image.");
    } finally {
      setIsUploadingImage(false);
    }
  };

  const onDraftKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) sendMessage();
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-170px)] max-w-5xl flex-col">
      <div className="rounded-t-3xl bg-gradient-to-r from-violet-600/90 via-purple-600/85 to-fuchsia-600/85 p-6 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-white/20 p-3 backdrop-blur-sm">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">AI Farming Assistant</h2>
              <p className="text-sm text-violet-100">
                Practical crop guidance with conversation and image context.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={clearChat}
            disabled={isLoading}
            className="gap-2 bg-white/20 text-white hover:bg-white/30"
          >
            <Trash2 className="h-4 w-4" />
            Clear Chat
          </Button>
        </div>
      </div>

      <Card className="flex flex-1 flex-col overflow-hidden rounded-t-none border-none shadow-lg">
        <CardContent className="flex-1 space-y-4 overflow-y-auto p-6">
          {messages.length <= 1 ? (
            <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
              <p className="mb-3 text-sm font-medium text-violet-800">Quick start</p>
              <div className="flex flex-wrap gap-2">
                {STARTER_PROMPTS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => onSelectStarter(item)}
                    className="rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs text-violet-700 transition hover:bg-violet-100"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] ${message.role === "user" ? "" : ""}`}>
                {message.role === "assistant" ? (
                  <div className="mb-1.5 flex items-center gap-2">
                    <div className={`rounded-lg p-1.5 ${message.isError ? "bg-rose-100" : "bg-violet-100"}`}>
                      <Leaf className={`h-4 w-4 ${message.isError ? "text-rose-600" : "text-violet-600"}`} />
                    </div>
                    <span className={`text-xs font-medium ${message.isError ? "text-rose-700" : "text-slate-600"}`}>
                      {message.isError ? "Assistant Error" : "AI Assistant"}
                    </span>
                    <span className="text-xs text-slate-400">{formatMessageTime(message.createdAt)}</span>
                  </div>
                ) : (
                  <div className="mb-1 text-right text-xs text-slate-400">{formatMessageTime(message.createdAt)}</div>
                )}

                <div
                  className={`rounded-2xl p-4 ${
                    message.role === "user"
                      ? "bg-violet-600 text-white"
                      : message.isError
                        ? "border border-rose-200 bg-rose-50 text-rose-800"
                        : "bg-slate-100 text-slate-900"
                  }`}
                >
                  {message.image ? (
                    <img src={message.image} alt={message.imageName || "Uploaded crop"} className="mb-3 max-h-56 w-full rounded-lg object-cover" />
                  ) : null}
                  {message.role === "assistant" ? (
                    <ReactMarkdown className="prose prose-sm max-w-none prose-p:my-2 prose-headings:my-2">
                      {message.content}
                    </ReactMarkdown>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                  )}
                </div>
              </div>
            </div>
          ))}

          {isLoading ? (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-slate-700">
                <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                Generating response...
              </div>
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </CardContent>

        <div className="space-y-3 border-t bg-white p-4">
          {errorMessage ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>{errorMessage}</span>
                {lastRequestPayload ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 border-rose-300 text-rose-700 hover:bg-rose-100"
                    onClick={retryLastRequest}
                    disabled={isLoading}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {uploadedImageUrl ? (
            <div className="relative inline-flex max-w-[220px] flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50 p-2">
              <img src={uploadedImageUrl} alt={uploadedImageName || "Uploaded crop"} className="h-24 w-full rounded-lg object-cover" />
              <p className="truncate text-xs text-slate-500">{uploadedImageName || "Uploaded image"}</p>
              <button
                type="button"
                onClick={() => {
                  setUploadedImageUrl("");
                  setUploadedImageName("");
                }}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-sm text-white"
                aria-label="Remove uploaded image"
              >
                x
              </button>
            </div>
          ) : null}

          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isUploadingImage}
              className="h-12 w-12 shrink-0"
              aria-label="Upload crop image"
            >
              {isUploadingImage ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
            </Button>

            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onDraftKeyDown}
              placeholder="Describe your crop issue or ask for a plan..."
              disabled={isLoading}
              className="min-h-[48px] flex-1 resize-none rounded-xl"
              rows={2}
            />

            <Button
              type="button"
              onClick={sendMessage}
              disabled={!canSend}
              className="h-12 w-12 shrink-0 rounded-xl bg-violet-600 hover:bg-violet-700"
              aria-label="Send message"
            >
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </div>

          <p className="text-xs text-slate-400">
            Press Enter to send, Shift+Enter for a new line. Upload crop photos for visual guidance.
          </p>
        </div>
      </Card>
    </div>
  );
}
