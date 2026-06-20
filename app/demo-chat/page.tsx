"use client";

import React, { useEffect, useMemo, useState } from "react";

type DemoMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: string[];
  createdAt: number;
};

type AgentOutboundMessage = {
  type?: string;
  image?: { link?: string; caption?: string };
  text?: { body?: string };
};

type AgentResult = {
  reply?: string;
  replyText?: string;
  outboundMessages?: AgentOutboundMessage[];
  intent?: string;
  action?: string;
};

const DEMO_CHAT_API_URL = process.env.NEXT_PUBLIC_DEMO_CHAT_API_URL || "";
const MENU_IMAGE_URLS = String(process.env.NEXT_PUBLIC_MENU_IMAGE_URLS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function extractAssistantContent(agentResult: AgentResult) {
  const outbound = Array.isArray(agentResult?.outboundMessages)
    ? agentResult.outboundMessages
    : [];

  let images = outbound
    .filter((item) => item?.type === "image" && item.image?.link)
    .map((item) => String(item.image?.link || ""));

  const textFromOutbound = outbound
    .filter((item) => item?.type === "text" && item.text?.body)
    .map((item) => String(item.text?.body || ""))
    .join("\n\n");

  const text =
    textFromOutbound ||
    agentResult?.reply ||
    agentResult?.replyText ||
    "Ji, kuch masla aa gaya. Meherbani karke dobara bhejein.";

  if (
    !images.length &&
    (agentResult?.intent === "MENU" ||
      agentResult?.action === "SHOW_MENU" ||
      text.toLowerCase().includes("hamara menu"))
  ) {
    images = MENU_IMAGE_URLS;
  }

  return { text, images };
}

export default function DemoChatPage() {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [started, setStarted] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const existing = window.localStorage.getItem("foodhub_demo_session_id");
    if (existing) {
      setSessionId(existing);
    } else {
      const next = makeId();
      window.localStorage.setItem("foodhub_demo_session_id", next);
      setSessionId(next);
    }
  }, []);

  const canStart = useMemo(() => {
    return customerName.trim().length >= 2 && customerPhone.trim().length >= 8;
  }, [customerName, customerPhone]);

  async function sendMessage(messageText: string, hideUserBubble = false) {
    if (!DEMO_CHAT_API_URL) {
      setError("NEXT_PUBLIC_DEMO_CHAT_API_URL missing in .env.local");
      return;
    }

    const trimmed = messageText.trim();
    if (!trimmed || loading) return;

    setError("");
    setLoading(true);

    const userMessage: DemoMessage = {
      id: makeId(),
      role: "user",
      text: trimmed,
      createdAt: Date.now(),
    };

    if (!hideUserBubble) {
      setMessages((prev) => [...prev, userMessage]);
    }

    try {
      const response = await fetch(DEMO_CHAT_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          customerName,
          customerPhone,
          message: trimmed,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to reach demo chat API");
      }

      const content = extractAssistantContent(data.agentResult as AgentResult);

      const assistantMessage: DemoMessage = {
        id: makeId(),
        role: "assistant",
        text: content.text,
        images: content.images,
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setInput("");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!canStart || !sessionId) return;
    setStarted(true);
    setMessages([]);
    await sendMessage("hi", true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await sendMessage(input);
  }

  return (
    <div className="min-h-screen bg-[#efeae2] p-4 md:p-8">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#075e54] px-5 py-4 text-white">
          <div>
            <div className="text-xl font-semibold">Food Hub Demo Chat</div>
            <div className="text-sm text-white/80">
              Same shared agent • orders land in dashboard
            </div>
          </div>
          <a
            href="/"
            className="rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
          >
            Dashboard
          </a>
        </div>

        {!started ? (
          <div className="grid min-h-[75vh] place-items-center bg-slate-100 p-6">
            <form
              onSubmit={handleStart}
              className="w-full max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
            >
              <h1 className="text-2xl font-bold text-slate-900">Start Demo Chat</h1>
              <p className="mt-2 text-sm text-slate-500">
                Name aur phone daalein, phir client live demo test kar sakta hai.
              </p>

              <div className="mt-5 space-y-4">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-600">Name</span>
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Asad Ahmad"
                    className="rounded-2xl border border-slate-200 px-4 py-3 outline-none"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-600">Phone</span>
                  <input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="923001234567"
                    className="rounded-2xl border border-slate-200 px-4 py-3 outline-none"
                  />
                </label>

                {error ? (
                  <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={!canStart || loading}
                  className="w-full rounded-2xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  {loading ? "Starting..." : "Start Chat"}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="flex min-h-[75vh] flex-col bg-[#efeae2]">
            <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                      message.role === "user"
                        ? "bg-[#dcf8c6] text-slate-900"
                        : "bg-white text-slate-900"
                    }`}
                  >
                    {message.images?.length ? (
                      <div className="mb-3 space-y-3">
                        {message.images.map((image, index) => (
                          <img
                            key={`${image}_${index}`}
                            src={image}
                            alt={`Menu ${index + 1}`}
                            className="max-h-[420px] w-full rounded-2xl object-contain ring-1 ring-slate-200"
                          />
                        ))}
                      </div>
                    ) : null}

                    <div className="whitespace-pre-wrap text-[15px] leading-7">
                      {message.text}
                    </div>
                  </div>
                </div>
              ))}

              {loading ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                    Typing...
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}
            </div>

            <form
              onSubmit={handleSubmit}
              className="border-t border-slate-200 bg-white p-3 md:p-4"
            >
              <div className="flex items-center gap-3">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder='Type message... e.g. "menu", "1 classic burger", "pickup", "confirm"'
                  className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 outline-none"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  className="rounded-2xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}