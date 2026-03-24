"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { AgentThinkingEvent, ChatMessage, ParticipantSummary, RoomAgentSummary, RoomSummary } from "@/lib/types/chat";

type User = {
  id: string;
  email: string;
  username: string;
};

type FriendUser = {
  friendshipId: string;
  userId: string;
  username: string;
};

type FriendsPayload = {
  friends: FriendUser[];
  incoming: FriendUser[];
  outgoing: FriendUser[];
};

type RoomDetails = {
  room: {
    id: string;
    name: string;
    createdById: string;
    createdByUsername: string;
    friendsCanView: boolean;
    canWrite: boolean;
    canManage: boolean;
    isFriendView: boolean;
  };
  participants: ParticipantSummary[];
  agents: RoomAgentSummary[];
  messages: ChatMessage[];
};

type AuthMode = "login" | "register";

type AgentTemplate = {
  label: string;
  name: string;
  systemPrompt: string;
  model: string;
  temperature: number;
};

const agentTemplates: AgentTemplate[] = [
  {
    label: "Debater AI",
    name: "Debater AI",
    systemPrompt:
      "You are Debater AI. Challenge weak assumptions, offer counterarguments, and keep discussion constructive.",
    model: "gpt-4o-mini",
    temperature: 0.75,
  },
  {
    label: "Summarizer AI",
    name: "Summarizer AI",
    systemPrompt:
      "You are Summarizer AI. Summarize long threads into concise bullets and identify unresolved questions.",
    model: "gpt-4o-mini",
    temperature: 0.35,
  },
  {
    label: "Chaos Agent",
    name: "Chaos Agent",
    systemPrompt:
      "You are Chaos Agent. Introduce creative twists, lateral ideas, and playful what-if scenarios without being unsafe.",
    model: "gpt-4o-mini",
    temperature: 1,
  },
];

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function avatarFromName(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isAgent = message.senderType === "agent";

  return (
    <div className="group rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 transition hover:border-cyan-300/30">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-300/15 font-semibold text-cyan-100">
            {avatarFromName(message.senderName)}
          </span>
          <span className="font-semibold text-white">{message.senderName}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              isAgent ? "bg-amber-300/20 text-amber-200" : "bg-emerald-300/20 text-emerald-200"
            }`}
          >
            {isAgent ? "Agent" : "Human"}
          </span>
        </div>
        <time className="text-slate-400">{new Date(message.timestamp).toLocaleTimeString()}</time>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{message.content}</p>
    </div>
  );
}

export function AgentLinkClient() {
  const socketRef = useRef<Socket | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);

  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [user, setUser] = useState<User | null>(null);
  const [authIdentity, setAuthIdentity] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [friendRooms, setFriendRooms] = useState<RoomSummary[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [roomDetails, setRoomDetails] = useState<RoomDetails | null>(null);

  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [incomingFriends, setIncomingFriends] = useState<FriendUser[]>([]);
  const [outgoingFriends, setOutgoingFriends] = useState<FriendUser[]>([]);
  const [friendUsernameInput, setFriendUsernameInput] = useState("");

  const [newRoomName, setNewRoomName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [newMessage, setNewMessage] = useState("");

  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentModel, setAgentModel] = useState("gpt-4o-mini");
  const [agentTemperature, setAgentTemperature] = useState(0.7);
  const [agentMemorySize, setAgentMemorySize] = useState(12);
  const [agentMentionOnly, setAgentMentionOnly] = useState(false);
  const [agentCooldown, setAgentCooldown] = useState(8);
  const [agentMaxPerMinute, setAgentMaxPerMinute] = useState(6);

  const [thinkingMap, setThinkingMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allVisibleRooms = useMemo(() => {
    const byId = new Map<string, RoomSummary>();
    for (const room of friendRooms) {
      byId.set(room.id, room);
    }
    for (const room of rooms) {
      byId.set(room.id, room);
    }
    return Array.from(byId.values());
  }, [rooms, friendRooms]);

  const activeRoom = useMemo(
    () => allVisibleRooms.find((room) => room.id === activeRoomId) ?? null,
    [allVisibleRooms, activeRoomId],
  );

  const thinkingCount = useMemo(() => Object.keys(thinkingMap).length, [thinkingMap]);

  const loadSession = useCallback(async () => {
    const data = await requestJson<{ user: User | null }>("/api/auth/me", { method: "GET" });
    setUser(data.user);
  }, []);

  const loadRooms = useCallback(async () => {
    const data = await requestJson<{ rooms: RoomSummary[] }>("/api/rooms", { method: "GET" });
    setRooms(data.rooms);
  }, []);

  const loadFriendRooms = useCallback(async () => {
    const data = await requestJson<{ rooms: RoomSummary[] }>("/api/friends/rooms", { method: "GET" });
    setFriendRooms(data.rooms);
  }, []);

  const loadFriends = useCallback(async () => {
    const data = await requestJson<FriendsPayload>("/api/friends", { method: "GET" });
    setFriends(data.friends);
    setIncomingFriends(data.incoming);
    setOutgoingFriends(data.outgoing);
  }, []);

  const loadRoom = useCallback(async (roomId: string) => {
    const data = await requestJson<RoomDetails>(`/api/rooms/${roomId}`, { method: "GET" });
    setRoomDetails(data);
    setThinkingMap({});
  }, []);

  const reloadSidebarData = useCallback(async () => {
    await Promise.all([loadRooms(), loadFriendRooms(), loadFriends()]);
  }, [loadRooms, loadFriendRooms, loadFriends]);

  useEffect(() => {
    loadSession().catch((loadError: unknown) => {
      const message = loadError instanceof Error ? loadError.message : "Failed loading session.";
      setError(message);
    });
  }, [loadSession]);

  useEffect(() => {
    if (!user) {
      return;
    }

    reloadSidebarData().catch((loadError: unknown) => {
      const message = loadError instanceof Error ? loadError.message : "Failed loading rooms and friends.";
      setError(message);
    });
  }, [user, reloadSidebarData]);

  useEffect(() => {
    if (allVisibleRooms.length === 0) {
      setActiveRoomId(null);
      setRoomDetails(null);
      return;
    }

    if (!activeRoomId || !allVisibleRooms.some((room) => room.id === activeRoomId)) {
      setActiveRoomId(allVisibleRooms[0].id);
    }
  }, [allVisibleRooms, activeRoomId]);

  useEffect(() => {
    if (!activeRoomId) {
      return;
    }

    loadRoom(activeRoomId).catch((loadError: unknown) => {
      const message = loadError instanceof Error ? loadError.message : "Failed loading room.";
      setError(message);
    });
  }, [activeRoomId, loadRoom]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const socket = io({
      path: "/socket.io",
    });

    const onMessage = (message: ChatMessage) => {
      setRoomDetails((current) => {
        if (!current || current.room.id !== message.roomId) {
          return current;
        }

        if (current.messages.some((existing) => existing.id === message.id)) {
          return current;
        }

        return {
          ...current,
          messages: [...current.messages, message],
        };
      });
    };

    const onThinking = (event: AgentThinkingEvent) => {
      setRoomDetails((current) => {
        if (!current || current.room.id !== event.roomId) {
          return current;
        }

        return current;
      });

      setThinkingMap((current) => {
        const next = { ...current };
        if (event.thinking) {
          next[event.agentId] = event.agentName;
        } else {
          delete next[event.agentId];
        }
        return next;
      });
    };

    socket.on("message:new", onMessage);
    socket.on("agent:thinking", onThinking);

    socketRef.current = socket;

    return () => {
      socket.off("message:new", onMessage);
      socket.off("agent:thinking", onThinking);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user]);

  useEffect(() => {
    if (!activeRoomId || !socketRef.current) {
      return;
    }

    socketRef.current.emit("join-room", activeRoomId);

    return () => {
      socketRef.current?.emit("leave-room", activeRoomId);
    };
  }, [activeRoomId]);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [roomDetails?.messages.length, thinkingCount]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      if (authMode === "register") {
        await requestJson<{ user: User }>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email: authEmail,
            username: authUsername,
            password: authPassword,
          }),
        });
      } else {
        await requestJson<{ user: User }>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            identity: authIdentity,
            password: authPassword,
          }),
        });
      }

      await loadSession();
      setAuthPassword("");
    } catch (authError: unknown) {
      const message = authError instanceof Error ? authError.message : "Authentication failed.";
      setError(message);
    }
  }

  async function logout() {
    setError(null);
    await requestJson<{ success: boolean }>("/api/auth/logout", {
      method: "POST",
    });

    setUser(null);
    setRooms([]);
    setFriendRooms([]);
    setFriends([]);
    setIncomingFriends([]);
    setOutgoingFriends([]);
    setActiveRoomId(null);
    setRoomDetails(null);
  }

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newRoomName.trim()) {
      return;
    }

    setError(null);
    setBusy(true);

    try {
      const data = await requestJson<{ room: RoomSummary }>("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ name: newRoomName }),
      });

      setNewRoomName("");
      await reloadSidebarData();
      setActiveRoomId(data.room.id);
    } catch (createError: unknown) {
      const message = createError instanceof Error ? createError.message : "Failed creating room.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!joinRoomId.trim()) {
      return;
    }

    setError(null);
    setBusy(true);

    try {
      const data = await requestJson<{ room: RoomSummary }>("/api/rooms/join", {
        method: "POST",
        body: JSON.stringify({ roomId: joinRoomId.trim() }),
      });

      setJoinRoomId("");
      await reloadSidebarData();
      setActiveRoomId(data.room.id);
    } catch (joinError: unknown) {
      const message = joinError instanceof Error ? joinError.message : "Failed joining room.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeRoomId || !newMessage.trim() || !roomDetails?.room.canWrite) {
      return;
    }

    const content = newMessage;
    setNewMessage("");

    try {
      const data = await requestJson<{ message: ChatMessage }>("/api/messages", {
        method: "POST",
        body: JSON.stringify({
          roomId: activeRoomId,
          content,
        }),
      });

      setRoomDetails((current) => {
        if (!current || current.room.id !== activeRoomId) {
          return current;
        }

        if (current.messages.some((message) => message.id === data.message.id)) {
          return current;
        }

        return {
          ...current,
          messages: [...current.messages, data.message],
        };
      });

      await loadRoom(activeRoomId);
    } catch (sendError: unknown) {
      const message = sendError instanceof Error ? sendError.message : "Failed sending message.";
      setError(message);
      setNewMessage(content);
    }
  }

  async function createAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeRoomId || !agentName.trim() || !agentPrompt.trim() || !roomDetails?.room.canWrite) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await requestJson<{ agent: RoomAgentSummary }>("/api/agents", {
        method: "POST",
        body: JSON.stringify({
          roomId: activeRoomId,
          name: agentName,
          systemPrompt: agentPrompt,
          model: agentModel,
          temperature: agentTemperature,
          memorySize: agentMemorySize,
          respondOnlyWhenMentioned: agentMentionOnly,
          cooldownSeconds: agentCooldown,
          maxResponsesPerMinute: agentMaxPerMinute,
        }),
      });

      setAgentName("");
      setAgentPrompt("");
      setAgentModel("gpt-4o-mini");
      setAgentTemperature(0.7);
      setAgentMemorySize(12);
      setAgentMentionOnly(false);
      setAgentCooldown(8);
      setAgentMaxPerMinute(6);
      setIsCreatingAgent(false);

      await loadRoom(activeRoomId);
      await reloadSidebarData();
    } catch (createError: unknown) {
      const message = createError instanceof Error ? createError.message : "Failed creating agent.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAgent(agent: RoomAgentSummary, enabled: boolean) {
    if (!activeRoomId || !roomDetails?.room.canWrite) {
      return;
    }

    setError(null);

    try {
      await requestJson<{ agent: RoomAgentSummary }>(
        `/api/rooms/${activeRoomId}/agents/${agent.agentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      );

      setRoomDetails((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          agents: current.agents.map((entry) =>
            entry.agentId === agent.agentId ? { ...entry, enabled } : entry,
          ),
        };
      });
    } catch (toggleError: unknown) {
      const message = toggleError instanceof Error ? toggleError.message : "Failed toggling agent.";
      setError(message);
    }
  }

  async function nudgeAgent(agentId: string) {
    if (!activeRoomId || !roomDetails?.room.canWrite) {
      return;
    }

    setError(null);

    try {
      await requestJson<{ queued: boolean }>(`/api/agents/${agentId}/respond`, {
        method: "POST",
        body: JSON.stringify({ roomId: activeRoomId }),
      });

      await loadRoom(activeRoomId);
    } catch (nudgeError: unknown) {
      const message = nudgeError instanceof Error ? nudgeError.message : "Failed nudging agent.";
      setError(message);
    }
  }

  async function copyRoomId() {
    if (!roomDetails) {
      return;
    }

    try {
      await navigator.clipboard.writeText(roomDetails.room.id);
    } catch {
      setError("Could not copy room ID.");
    }
  }

  async function updateRoomPrivacy(nextValue: boolean) {
    if (!activeRoomId || !roomDetails?.room.canManage) {
      return;
    }

    setError(null);

    try {
      await requestJson<{ room: { id: string; friendsCanView: boolean } }>(`/api/rooms/${activeRoomId}`, {
        method: "PATCH",
        body: JSON.stringify({
          friendsCanView: nextValue,
        }),
      });

      setRoomDetails((current) =>
        current
          ? {
              ...current,
              room: {
                ...current.room,
                friendsCanView: nextValue,
              },
            }
          : current,
      );
      await loadFriendRooms();
    } catch (privacyError: unknown) {
      const message = privacyError instanceof Error ? privacyError.message : "Failed updating room privacy.";
      setError(message);
    }
  }

  async function deleteActiveRoom() {
    if (!activeRoomId || !roomDetails?.room.canManage) {
      return;
    }

    const confirmed = window.confirm("Delete this chat room and all messages?");
    if (!confirmed) {
      return;
    }

    try {
      await requestJson<{ deleted: boolean }>(`/api/rooms/${activeRoomId}`, {
        method: "DELETE",
      });

      setRoomDetails(null);
      setActiveRoomId(null);
      await reloadSidebarData();
    } catch (deleteError: unknown) {
      const message = deleteError instanceof Error ? deleteError.message : "Failed deleting room.";
      setError(message);
    }
  }

  async function sendFriendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!friendUsernameInput.trim()) {
      return;
    }

    setError(null);

    try {
      await requestJson<{ status: string }>("/api/friends", {
        method: "POST",
        body: JSON.stringify({
          username: friendUsernameInput.trim(),
        }),
      });
      setFriendUsernameInput("");
      await loadFriends();
      await loadFriendRooms();
    } catch (friendError: unknown) {
      const message = friendError instanceof Error ? friendError.message : "Failed sending friend request.";
      setError(message);
    }
  }

  async function respondToFriendRequest(friendshipId: string, action: "accept" | "decline") {
    setError(null);

    try {
      await requestJson<{ status: string }>("/api/friends/respond", {
        method: "POST",
        body: JSON.stringify({
          friendshipId,
          action,
        }),
      });
      await loadFriends();
      await loadFriendRooms();
    } catch (friendError: unknown) {
      const message = friendError instanceof Error ? friendError.message : "Failed updating friend request.";
      setError(message);
    }
  }

  function applyTemplate(template: AgentTemplate) {
    setAgentName(template.name);
    setAgentPrompt(template.systemPrompt);
    setAgentModel(template.model);
    setAgentTemperature(template.temperature);
    setIsCreatingAgent(true);
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_#1e293b_0%,_#020617_65%)] px-4">
        <div className="w-full max-w-md rounded-2xl border border-cyan-200/20 bg-slate-950/70 p-6 shadow-2xl backdrop-blur">
          <h1 className="mb-1 text-2xl font-black tracking-tight text-cyan-100">AgentLink</h1>
          <p className="mb-6 text-sm text-slate-300">Human + agent group chats with AI-to-AI collaboration.</p>

          <div className="mb-4 flex rounded-lg border border-white/10 bg-slate-900 p-1 text-sm">
            <button
              type="button"
              className={`flex-1 rounded-md py-2 transition ${
                authMode === "register" ? "bg-cyan-400 text-slate-950" : "text-slate-300"
              }`}
              onClick={() => setAuthMode("register")}
            >
              Register
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md py-2 transition ${
                authMode === "login" ? "bg-cyan-400 text-slate-950" : "text-slate-300"
              }`}
              onClick={() => setAuthMode("login")}
            >
              Login
            </button>
          </div>

          <form className="space-y-3" onSubmit={submitAuth}>
            {authMode === "register" ? (
              <>
                <input
                  className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none ring-cyan-300/40 transition focus:ring"
                  placeholder="Email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  required
                />
                <input
                  className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none ring-cyan-300/40 transition focus:ring"
                  placeholder="Username"
                  value={authUsername}
                  onChange={(event) => setAuthUsername(event.target.value)}
                  required
                />
              </>
            ) : (
              <input
                className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none ring-cyan-300/40 transition focus:ring"
                placeholder="Email or username"
                value={authIdentity}
                onChange={(event) => setAuthIdentity(event.target.value)}
                required
              />
            )}
            <input
              type="password"
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none ring-cyan-300/40 transition focus:ring"
              placeholder="Password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              required
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
            >
              {authMode === "register" ? "Create Account" : "Sign In"}
            </button>
          </form>

          {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#0f172a_0%,_#020617_55%,_#000_100%)] text-white">
      <div className="mx-auto flex min-h-screen max-w-[1600px] gap-4 px-4 py-4 lg:px-6">
        <aside className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-950/70 p-4 backdrop-blur">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-cyan-300/80">AgentLink</p>
              <h2 className="text-lg font-bold">Rooms</h2>
            </div>
            <button
              type="button"
              className="rounded-md border border-white/20 px-2 py-1 text-xs text-slate-200 hover:border-cyan-200"
              onClick={logout}
            >
              Logout
            </button>
          </div>

          <p className="mb-4 text-xs text-slate-300">Signed in as {user.username}</p>

          <form className="mb-3 space-y-2" onSubmit={createRoom}>
            <input
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none ring-cyan-300/40 transition focus:ring"
              placeholder="Create room"
              value={newRoomName}
              onChange={(event) => setNewRoomName(event.target.value)}
              disabled={busy}
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-60"
              disabled={busy || !newRoomName.trim()}
            >
              Create Room
            </button>
          </form>

          <form className="mb-4 space-y-2" onSubmit={joinRoom}>
            <input
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none ring-cyan-300/40 transition focus:ring"
              placeholder="Join room by ID"
              value={joinRoomId}
              onChange={(event) => setJoinRoomId(event.target.value)}
              disabled={busy}
            />
            <button
              type="submit"
              className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm text-slate-200 hover:border-cyan-200 disabled:opacity-60"
              disabled={busy || !joinRoomId.trim()}
            >
              Join Room
            </button>
          </form>

          <div className="mb-4 space-y-2">
            {rooms.map((room) => (
              <button
                key={room.id}
                type="button"
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                  activeRoomId === room.id
                    ? "border-cyan-300 bg-cyan-300/15"
                    : "border-white/10 bg-slate-900/70 hover:border-white/25"
                }`}
                onClick={() => setActiveRoomId(room.id)}
              >
                <p className="font-semibold text-white">{room.name}</p>
                <p className="mt-1 text-xs text-slate-300">
                  Room ID: <span className="font-mono text-[11px]">{room.id}</span>
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {room.participantCount} humans | {room.agentCount} agents
                </p>
              </button>
            ))}
            {rooms.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/20 p-3 text-xs text-slate-300">
                No joined rooms yet.
              </p>
            ) : null}
          </div>

          <div className="mb-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-200">Friends&apos; Rooms</h3>
            <div className="space-y-2">
              {friendRooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                    activeRoomId === room.id
                      ? "border-cyan-300 bg-cyan-300/15"
                      : "border-white/10 bg-slate-900/70 hover:border-white/25"
                  }`}
                  onClick={() => setActiveRoomId(room.id)}
                >
                  <p className="font-semibold text-white">{room.name}</p>
                  <p className="mt-1 text-xs text-slate-300">
                    by {room.ownerUsername ?? "friend"} | read-only
                  </p>
                </button>
              ))}
              {friendRooms.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/20 p-3 text-xs text-slate-400">
                  No friend-shared chats available.
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-200">Friends</h3>
            <form className="mb-2 flex gap-2" onSubmit={sendFriendRequest}>
              <input
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-slate-950 px-2 py-1.5 text-xs outline-none ring-cyan-300/40 transition focus:ring"
                placeholder="Add by username"
                value={friendUsernameInput}
                onChange={(event) => setFriendUsernameInput(event.target.value)}
              />
              <button
                type="submit"
                className="rounded-md border border-cyan-300/40 px-2 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/10"
              >
                Add
              </button>
            </form>

            <div className="mb-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Connected</p>
              <div className="space-y-1 text-xs text-slate-200">
                {friends.map((friend) => (
                  <p key={friend.friendshipId}>• {friend.username}</p>
                ))}
                {friends.length === 0 ? <p className="text-slate-400">No friends connected yet.</p> : null}
              </div>
            </div>

            <div className="mb-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Incoming</p>
              <div className="space-y-1">
                {incomingFriends.map((friend) => (
                  <div key={friend.friendshipId} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-200">{friend.username}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="rounded bg-emerald-300/20 px-1.5 py-0.5 text-emerald-200"
                        onClick={() => respondToFriendRequest(friend.friendshipId, "accept")}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="rounded bg-rose-300/20 px-1.5 py-0.5 text-rose-200"
                        onClick={() => respondToFriendRequest(friend.friendshipId, "decline")}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
                {incomingFriends.length === 0 ? <p className="text-xs text-slate-400">No pending requests.</p> : null}
              </div>
            </div>

            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Outgoing</p>
              <div className="space-y-1 text-xs text-slate-300">
                {outgoingFriends.map((friend) => (
                  <p key={friend.friendshipId}>• {friend.username} (pending)</p>
                ))}
                {outgoingFriends.length === 0 ? <p className="text-slate-400">No outgoing requests.</p> : null}
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-h-[calc(100vh-2rem)] flex-1 flex-col rounded-2xl border border-white/10 bg-slate-950/60 backdrop-blur">
          <header className="border-b border-white/10 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-cyan-100">
                  {roomDetails?.room.name ?? activeRoom?.name ?? "Select a Room"}
                </h1>
                <p className="mt-1 text-xs text-slate-300">
                  Room ID: <span className="font-mono">{roomDetails?.room.id ?? activeRoom?.id ?? "-"}</span>
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  Mention agents with <span className="font-mono">@name</span> when mention-only mode is enabled.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-white/20 px-3 py-2 text-xs text-slate-200 hover:border-cyan-200 disabled:opacity-60"
                  onClick={copyRoomId}
                  disabled={!roomDetails}
                >
                  Copy Room ID
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-60"
                  onClick={() => setIsCreatingAgent((current) => !current)}
                  disabled={!activeRoomId || !roomDetails?.room.canWrite}
                >
                  Add Agent
                </button>
                {roomDetails?.room.canManage ? (
                  <button
                    type="button"
                    className="rounded-lg border border-rose-300/40 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-300/10"
                    onClick={deleteActiveRoom}
                  >
                    Delete Chat
                  </button>
                ) : null}
              </div>
            </div>

            {roomDetails?.room.isFriendView ? (
              <p className="mt-2 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-xs text-cyan-100">
                Viewing a friend&apos;s shared chat (read-only).
              </p>
            ) : null}

            {roomDetails?.room.canManage ? (
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={roomDetails.room.friendsCanView}
                  onChange={(event) => void updateRoomPrivacy(event.target.checked)}
                />
                Allow connected friends to view this chat
              </label>
            ) : null}

            {isCreatingAgent && activeRoomId ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/80 p-4">
                <p className="mb-2 text-xs uppercase tracking-wider text-cyan-200">Quick templates</p>
                <div className="mb-4 flex flex-wrap gap-2">
                  {agentTemplates.map((template) => (
                    <button
                      key={template.label}
                      type="button"
                      className="rounded-full border border-white/20 px-3 py-1 text-xs text-slate-200 hover:border-cyan-300"
                      onClick={() => applyTemplate(template)}
                    >
                      {template.label}
                    </button>
                  ))}
                </div>

                <form className="grid gap-3 md:grid-cols-2" onSubmit={createAgent}>
                  <input
                    className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none ring-cyan-300/40 transition focus:ring"
                    placeholder="Agent name"
                    value={agentName}
                    onChange={(event) => setAgentName(event.target.value)}
                    required
                  />
                  <input
                    className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none ring-cyan-300/40 transition focus:ring"
                    placeholder="Model"
                    value={agentModel}
                    onChange={(event) => setAgentModel(event.target.value)}
                    required
                  />
                  <textarea
                    className="min-h-24 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none ring-cyan-300/40 transition focus:ring md:col-span-2"
                    placeholder="System prompt / personality (safe content only)"
                    value={agentPrompt}
                    onChange={(event) => setAgentPrompt(event.target.value)}
                    required
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    Temp
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      className="w-24 rounded-md border border-white/10 bg-slate-950 px-2 py-1 text-sm"
                      value={agentTemperature}
                      onChange={(event) => setAgentTemperature(Number(event.target.value))}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    Memory
                    <input
                      type="number"
                      min={4}
                      max={60}
                      className="w-24 rounded-md border border-white/10 bg-slate-950 px-2 py-1 text-sm"
                      value={agentMemorySize}
                      onChange={(event) => setAgentMemorySize(Number(event.target.value))}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    Cooldown (s)
                    <input
                      type="number"
                      min={1}
                      max={120}
                      className="w-24 rounded-md border border-white/10 bg-slate-950 px-2 py-1 text-sm"
                      value={agentCooldown}
                      onChange={(event) => setAgentCooldown(Number(event.target.value))}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    Max/min
                    <input
                      type="number"
                      min={1}
                      max={30}
                      className="w-24 rounded-md border border-white/10 bg-slate-950 px-2 py-1 text-sm"
                      value={agentMaxPerMinute}
                      onChange={(event) => setAgentMaxPerMinute(Number(event.target.value))}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-300 md:col-span-2">
                    <input
                      type="checkbox"
                      checked={agentMentionOnly}
                      onChange={(event) => setAgentMentionOnly(event.target.checked)}
                    />
                    Only respond when mentioned (@agent-name)
                  </label>
                  <button
                    type="submit"
                    className="rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-70 md:col-span-2"
                    disabled={busy}
                  >
                    Add Agent
                  </button>
                </form>
              </div>
            ) : null}
          </header>

          <div className="grid flex-1 gap-0 lg:grid-cols-[1fr_320px]">
            <section className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {roomDetails?.messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}

                {Object.entries(thinkingMap).map(([agentId, agentName]) => (
                  <div
                    key={agentId}
                    className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-100"
                  >
                    {agentName} is thinking...
                  </div>
                ))}

                {!roomDetails ? (
                  <div className="rounded-xl border border-dashed border-white/20 px-4 py-8 text-center text-sm text-slate-300">
                    Pick a room to start messaging.
                  </div>
                ) : null}

                <div ref={endOfMessagesRef} />
              </div>

              <form className="border-t border-white/10 p-4" onSubmit={sendMessage}>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none ring-cyan-300/40 transition focus:ring"
                    placeholder={
                      !activeRoomId
                        ? "Select a room first"
                        : roomDetails?.room.canWrite
                          ? "Type a message..."
                          : "Read-only room"
                    }
                    value={newMessage}
                    onChange={(event) => setNewMessage(event.target.value)}
                    disabled={!activeRoomId || !roomDetails?.room.canWrite}
                    maxLength={2000}
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-60"
                    disabled={!activeRoomId || !newMessage.trim() || !roomDetails?.room.canWrite}
                  >
                    Send
                  </button>
                </div>
              </form>
            </section>

            <aside className="border-l border-white/10 px-4 py-4">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-cyan-200">Participants</h3>
              <div className="mb-5 space-y-1 text-sm text-slate-200">
                {roomDetails?.participants.map((participant) => (
                  <p key={participant.id}>• {participant.username}</p>
                ))}
                {roomDetails?.participants.length === 0 ? <p className="text-slate-400">No humans yet.</p> : null}
              </div>

              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-cyan-200">Agents</h3>
              <div className="space-y-2">
                {roomDetails?.agents.map((agent) => (
                  <div key={agent.agentId} className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white">{agent.name}</p>
                      <span className="rounded-full bg-amber-300/20 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-200">
                        agent
                      </span>
                    </div>
                    <p className="mb-3 text-xs text-slate-400">{agent.model}</p>
                    <div className="flex flex-wrap gap-2">
                      {roomDetails?.room.canWrite ? (
                        <>
                          <button
                            type="button"
                            className={`rounded-md px-2 py-1 text-xs font-semibold ${
                              agent.enabled
                                ? "bg-emerald-300/20 text-emerald-200"
                                : "bg-rose-300/20 text-rose-200"
                            }`}
                            onClick={() => toggleAgent(agent, !agent.enabled)}
                          >
                            {agent.enabled ? "ON" : "OFF"}
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-white/20 px-2 py-1 text-xs text-slate-200 hover:border-cyan-300"
                            onClick={() => nudgeAgent(agent.agentId)}
                          >
                            Respond
                          </button>
                        </>
                      ) : (
                        <span className="rounded-md border border-cyan-300/30 px-2 py-1 text-[10px] text-cyan-200">
                          read-only
                        </span>
                      )}
                      {agent.respondOnlyWhenMentioned ? (
                        <span className="rounded-md border border-cyan-300/40 px-2 py-1 text-[10px] text-cyan-200">
                          mention-only
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
                {roomDetails?.agents.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-white/20 p-3 text-xs text-slate-400">
                    No agents yet. Add Debater AI, Summarizer AI, or Chaos Agent.
                  </p>
                ) : null}
              </div>
            </aside>
          </div>

          {error ? <p className="border-t border-rose-300/20 px-4 py-2 text-sm text-rose-300">{error}</p> : null}
        </main>
      </div>
    </div>
  );
}
