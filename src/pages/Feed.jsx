// src/pages/Feed.jsx
import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link, useLocation } from "react-router-dom";
import { KEYS, get, set, getLeague, getUsers } from "../utils/storage";

import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";

function ensureArr(v) {
  return Array.isArray(v) ? v : [];
}

function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function safeUUID(prefix = "post") {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return uid(prefix);
}

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / (1000 * 60));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function getUserById(users, userId) {
  return users.find((x) => (x?.id || x?._id) === userId) || null;
}

function getAuthorName(users, userId) {
  const u = getUserById(users, userId);
  return u?.name || "Golfer";
}

function Pill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full px-3 py-1.5 text-xs font-extrabold ring-1 transition",
        active
          ? "bg-emerald-600 text-white ring-emerald-600"
          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function AudienceChip({ children }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-extrabold text-slate-700 ring-1 ring-slate-200">
      {children}
    </span>
  );
}

function ScopeSwitch({ scope, setScope, leagueName }) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
            Feed
          </div>
          <div className="truncate text-base font-extrabold text-slate-900">
            {scope === "public"
              ? "Public Banter"
              : scope === "friends"
              ? "Friends Feed"
              : "League Banter"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Pill active={scope === "public"} onClick={() => setScope("public")}>
            Public
          </Pill>
          <Pill active={scope === "friends"} onClick={() => setScope("friends")}>
            Friends
          </Pill>
          <Pill active={scope === "league"} onClick={() => setScope("league")}>
            League
          </Pill>
        </div>
      </div>

      {scope === "league" ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-600">
            League:{" "}
            <span className="font-extrabold text-slate-900">
              {leagueName || "Your league"}
            </span>
          </div>
          <Link
            to="/leagues"
            className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-extrabold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-200"
          >
            View table →
          </Link>
        </div>
      ) : null}
    </Card>
  );
}

function ActionChip({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-200 active:scale-[0.99]"
    >
      {children}
    </button>
  );
}

function CommentRow({ c, users }) {
  const name = getAuthorName(users, c.userId);
  return (
    <div className="flex items-start gap-2">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-900 text-white ring-2 ring-white text-xs">
        🙂
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-xs font-extrabold text-slate-900">
            {name}
          </div>
          <div className="text-[11px] font-semibold text-slate-500">
            · {timeAgo(c.createdAt)}
          </div>
        </div>
        <div className="mt-0.5 whitespace-pre-wrap text-sm font-semibold text-slate-800">
          {c.text}
        </div>
      </div>
    </div>
  );
}

function PostCard({
  post,
  users,
  meId,
  onLike,
  onComment,
  showComments,
  onToggleComments,
}) {
  const author = getAuthorName(users, post.userId);
  const authorUser = getUserById(users, post.userId);

  const handicap =
    authorUser?.handicap ??
    authorUser?.hcp ??
    authorUser?.index ??
    authorUser?.handicapIndex ??
    null;

  const showHcp = handicap !== null && handicap !== undefined && handicap !== "";

  const liked = post.likes?.includes(meId);
  const likeCount = post.likes?.length || 0;
  const commentCount = post.comments?.length || 0;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-900 text-white ring-2 ring-white shadow-sm">
          🏌️
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <div className="truncate text-sm font-extrabold text-slate-900">
              {author}
            </div>

            {showHcp ? (
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-extrabold text-emerald-800 ring-1 ring-emerald-200">
                Hcp {handicap}
              </span>
            ) : null}

            <div className="text-xs font-semibold text-slate-500">
              · {timeAgo(post.createdAt)}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {post?.toPublic ? <AudienceChip>Public</AudienceChip> : null}
            {post?.toFriends ? <AudienceChip>Friends</AudienceChip> : null}
            {post?.toLeague ? <AudienceChip>League</AudienceChip> : null}
          </div>
        </div>
      </div>

      {post?.text ? (
        <div className="mt-3 whitespace-pre-wrap text-[15px] font-semibold leading-relaxed text-slate-900">
          {post.text}
        </div>
      ) : null}

      <div className="mt-4">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ActionChip onClick={() => onLike(post.id)}>
              <span className={liked ? "" : ""}>👍</span>
              <span>{likeCount}</span>
            </ActionChip>

            <ActionChip
              onClick={() => {
                onToggleComments(post.id);
                onComment(post.id);
              }}
            >
              💬 <span>{commentCount}</span>
            </ActionChip>

            <button
              type="button"
              onClick={() => onToggleComments(post.id)}
              className="rounded-full bg-white px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 active:scale-[0.99]"
            >
              {showComments ? "Hide" : "View"} comments
            </button>
          </div>
        </div>

        {showComments ? (
          <div className="mt-3 space-y-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
            {commentCount === 0 ? (
              <div className="text-xs font-semibold text-slate-500">
                No comments yet.
              </div>
            ) : (
              <div className="space-y-3">
                {(post.comments || [])
                  .slice()
                  .sort(
                    (a, b) =>
                      new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
                  )
                  .map((c) => (
                    <CommentRow key={c.id} c={c} users={users} />
                  ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => onComment(post.id)}
              className="w-full rounded-xl bg-white px-3 py-2 text-sm font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-100 active:scale-[0.99]"
            >
              Add a comment
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export default function Feed() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  const [users] = useState(() => getUsers([]));
  const [league] = useState(() => getLeague(null));

  const me = users?.[0];
  const meId = me?.id || me?._id || "demo-user";

  const initialScope = (() => {
    const s = (searchParams.get("scope") || "public").toLowerCase();
    if (s === "friends" || s === "league" || s === "public") return s;
    return "public";
  })();
  const [scope, setScopeState] = useState(initialScope);

  function setScope(next) {
    setScopeState(next);
    const sp = new URLSearchParams(searchParams);
    if (next === "public") sp.delete("scope");
    else sp.set("scope", next);
    setSearchParams(sp, { replace: true });
  }

  const [text, setText] = useState("");
  const [toPublic, setToPublic] = useState(true);
  const [toFriends, setToFriends] = useState(false);
  const [toLeague, setToLeague] = useState(false);

  const [posts, setPosts] = useState(() => ensureArr(get(KEYS.playPosts, [])));

  const [openComments, setOpenComments] = useState(() => ({}));

  function resyncPosts() {
    setPosts(ensureArr(get(KEYS.playPosts, [])));
  }

  useEffect(() => {
    resyncPosts();
  }, [location.key]);

  useEffect(() => {
    const onFocus = () => resyncPosts();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    set(KEYS.playPosts, posts);
  }, [posts]);

  const filteredSorted = useMemo(() => {
    return posts
      .filter((p) => {
        if (scope === "public") return !!p?.toPublic;
        if (scope === "friends") return !!p?.toFriends;
        if (scope === "league") {
          if (!p?.toLeague) return false;
          if (!league?.id) return true;
          return p?.leagueId === league.id;
        }
        return true;
      })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [posts, scope, league?.id]);

  function toggleLike(postId) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id !== postId
          ? p
          : {
              ...p,
              likes: (p.likes || []).includes(meId)
                ? (p.likes || []).filter((id) => id !== meId)
                : [...(p.likes || []), meId],
            }
      )
    );
  }

  function addComment(postId) {
    const txt = window.prompt("Comment");
    if (!txt || !txt.trim()) return;

    setPosts((prev) =>
      prev.map((p) =>
        p.id !== postId
          ? p
          : {
              ...p,
              comments: [
                ...(p.comments || []),
                {
                  id: safeUUID("c"),
                  userId: meId,
                  text: txt.trim(),
                  createdAt: new Date().toISOString(),
                },
              ],
            }
      )
    );

    setOpenComments((prev) => ({ ...prev, [postId]: true }));
  }

  function submitPost() {
    if (!text.trim()) return;

    const post = {
      id: safeUUID("post"),
      userId: meId,
      leagueId: toLeague ? league?.id || null : null,
      text: text.trim(),
      createdAt: new Date().toISOString(),
      toPublic,
      toFriends,
      toLeague,
      likes: [],
      comments: [],
    };

    setPosts((prev) => [post, ...prev]);
    setText("");
  }

  function toggleComments(postId) {
    setOpenComments((prev) => ({ ...prev, [postId]: !prev[postId] }));
  }

  const emptyCopy =
    scope === "public"
      ? {
          icon: "🏌️",
          title: "No banter yet",
          description: "Start the public golf feed with something funny.",
        }
      : scope === "friends"
      ? {
          icon: "👥",
          title: "No friends posts yet",
          description: "When friends start posting, you'll see it here.",
        }
      : {
          icon: "🏆",
          title: "No league banter yet",
          description: "Post a league moment to get the chat going.",
        };

  return (
    <div className="space-y-4">
      <ScopeSwitch scope={scope} setScope={setScope} leagueName={league?.name} />

      <Card className="p-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="What happened on the course?"
          className="w-full resize-none rounded-2xl bg-slate-50 p-3 text-[15px] font-semibold text-slate-900 placeholder:text-slate-400 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
            Post to:
          </div>

          <Pill active={toPublic} onClick={() => setToPublic((v) => !v)}>
            Public
          </Pill>
          <Pill active={toFriends} onClick={() => setToFriends((v) => !v)}>
            Friends
          </Pill>
          <Pill active={toLeague} onClick={() => setToLeague((v) => !v)}>
            League
          </Pill>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-200 active:scale-[0.99]"
              onClick={() => setText("")}
            >
              Clear
            </button>

            <button
              type="button"
              onClick={submitPost}
              disabled={text.trim().length === 0 || (!toPublic && !toFriends && !toLeague)}
              className={[
                "rounded-xl px-4 py-2 text-sm font-extrabold text-white transition active:scale-[0.99]",
                text.trim().length > 0 && (toPublic || toFriends || toLeague)
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : "bg-slate-300 cursor-not-allowed",
              ].join(" ")}
            >
              Post
            </button>
          </div>
        </div>

        {!toPublic && !toFriends && !toLeague ? (
          <div className="mt-2 text-xs font-semibold text-rose-600">
            Pick at least one destination (Public / Friends / League).
          </div>
        ) : null}
      </Card>

      {filteredSorted.length === 0 ? (
        <EmptyState
          icon={emptyCopy.icon}
          title={emptyCopy.title}
          description={emptyCopy.description}
          actions={
            <button
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-emerald-500 active:scale-[0.99]"
              onClick={() => {
                if (scope === "league") {
                  setText((t) => t || "League update: I’ve just had a meltdown on 17.");
                  setToLeague(true);
                } else if (scope === "friends") {
                  setText((t) => t || "Anyone playing this weekend?");
                  setToFriends(true);
                } else {
                  setText((t) => t || "Golf is a beautiful sport and I hate it.");
                  setToPublic(true);
                }
              }}
            >
              Start the banter
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredSorted.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              users={users}
              meId={meId}
              onLike={toggleLike}
              onComment={addComment}
              showComments={!!openComments[p.id]}
              onToggleComments={toggleComments}
            />
          ))}
        </div>
      )}
    </div>
  );
}





