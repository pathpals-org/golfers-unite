// src/pages/Feed.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, Link, useLocation } from "react-router-dom";
import { KEYS, get, set, getLeague } from "../utils/storage";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/useAuth";

import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";

const FEED_POSTS = "feed_posts";
const FEED_LIKES = "feed_post_likes";
const FEED_COMMENTS = "feed_post_comments";
const PROFILES_TABLE = "profiles";

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
  return u?.display_name || u?.username || u?.name || "Golfer";
}

function formatSupabaseError(e) {
  const msg =
    e?.message ||
    e?.error_description ||
    (typeof e === "string" ? e : "") ||
    "Unknown error";
  const code = e?.code ? ` [${e.code}]` : "";
  const details = e?.details ? ` • ${e.details}` : "";
  const hint = e?.hint ? ` • ${e.hint}` : "";
  return `${msg}${code}${details}${hint}`.trim();
}

function isAbortError(e) {
  const name = String(e?.name || "");
  const msg = String(e?.message || "");
  return name === "AbortError" || msg.toLowerCase().includes("aborted");
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

function CommentRow({ c, users, meId, onDelete }) {
  const name = getAuthorName(users, c.userId);
  const isMine = !!meId && c.userId === meId;

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

          {isMine ? (
            <button
              type="button"
              onClick={() => onDelete(c)}
              className="ml-auto rounded-full bg-rose-50 px-2 py-1 text-[11px] font-extrabold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
              title="Delete comment"
            >
              Delete
            </button>
          ) : null}
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
  onDeleteComment,
  showComments,
  onToggleComments,
}) {
  const author = getAuthorName(users, post.userId);
  const authorUser = getUserById(users, post.userId);

  const handicap =
    authorUser?.handicap_index ??
    authorUser?.handicap ??
    authorUser?.hcp ??
    authorUser?.index ??
    authorUser?.handicapIndex ??
    null;

  const showHcp = handicap !== null && handicap !== undefined && handicap !== "";
  const liked = (post.likes || []).includes(meId);
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
              <span>👍</span>
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
                    <CommentRow
                      key={c.id}
                      c={c}
                      users={users}
                      meId={meId}
                      onDelete={(comment) => onDeleteComment(post.id, comment)}
                    />
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

function cacheKeyForUser(userId) {
  return `${KEYS.playPosts}::${userId || "anon"}`;
}

export default function Feed() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  const { user, profile } = useAuth();
  const meId = user?.id || "anon";

  const [league] = useState(() => getLeague(null));

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

  const [posts, setPosts] = useState(() =>
    ensureArr(get(cacheKeyForUser(meId), []))
  );
  const [users, setUsers] = useState(() => (profile ? [profile] : []));
  const [openComments, setOpenComments] = useState(() => ({}));

  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [debugErr, setDebugErr] = useState("");

  const lastFetchRef = useRef(0);

  function writeCache(nextPosts) {
    set(cacheKeyForUser(meId), ensureArr(nextPosts));
  }

  async function loadFeedSupabase() {
    setDebugErr("");

    if (!user?.id) {
      setNotice("");
      setPosts(ensureArr(get(cacheKeyForUser("anon"), [])));
      return;
    }

    const now = Date.now();
    if (now - lastFetchRef.current < 1000) return;
    lastFetchRef.current = now;

    setLoading(true);
    setNotice("");

    try {
      const { data: postRows, error: postErr } = await supabase
        .from(FEED_POSTS)
        .select("id, user_id, league_id, text, to_public, to_friends, to_league, created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (postErr) throw postErr;

      const rows = postRows || [];
      const postIds = rows.map((r) => r.id);
      const authorIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));

      let likesByPost = {};
      let commentsByPost = {};

      if (postIds.length) {
        const [{ data: likeRows, error: likeErr }, { data: commentRows, error: cErr }] =
          await Promise.all([
            supabase.from(FEED_LIKES).select("post_id, user_id").in("post_id", postIds),
            supabase
              .from(FEED_COMMENTS)
              .select("id, post_id, user_id, text, created_at")
              .in("post_id", postIds)
              .order("created_at", { ascending: true }),
          ]);

        if (likeErr) throw likeErr;
        if (cErr) throw cErr;

        likesByPost = (likeRows || []).reduce((acc, r) => {
          (acc[r.post_id] ||= []).push(r.user_id);
          return acc;
        }, {});

        commentsByPost = (commentRows || []).reduce((acc, r) => {
          (acc[r.post_id] ||= []).push({
            id: r.id,
            userId: r.user_id,
            text: r.text,
            createdAt: r.created_at,
          });
          return acc;
        }, {});
      }

      if (authorIds.length) {
        const { data: profs, error: pErr } = await supabase
          .from(PROFILES_TABLE)
          .select("id, username, display_name, handicap_index")
          .in("id", authorIds);

        if (!pErr && profs) setUsers(profs);
      } else {
        setUsers(profile ? [profile] : []);
      }

      const normalized = rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        leagueId: r.league_id ?? null,
        text: r.text ?? "",
        createdAt: r.created_at,
        toPublic: !!r.to_public,
        toFriends: !!r.to_friends,
        toLeague: !!r.to_league,
        likes: ensureArr(likesByPost[r.id]),
        comments: ensureArr(commentsByPost[r.id]),
      }));

      setPosts(normalized);
      writeCache(normalized);
    } catch (e) {
      if (isAbortError(e)) return;

      const cached = ensureArr(get(cacheKeyForUser(meId), []));
      setPosts(cached);

      const pretty = formatSupabaseError(e);
      console.error("Feed load failed:", e);

      setNotice(
        cached.length
          ? "You’re viewing cached feed (offline / temporarily unavailable)."
          : "Feed unavailable right now (offline / temporarily unavailable)."
      );
      setDebugErr(pretty);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFeedSupabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key, user?.id]);

  useEffect(() => {
    const onFocus = () => loadFeedSupabase();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    setPosts(ensureArr(get(cacheKeyForUser(meId), [])));
    setUsers(profile ? [profile] : []);
    setNotice("");
    setDebugErr("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);

  useEffect(() => {
    writeCache(posts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, meId]);

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

  async function toggleLike(postId) {
    if (!user?.id) {
      setNotice("Sign in to like posts.");
      return;
    }

    const had = (posts.find((p) => p.id === postId)?.likes || []).includes(meId);

    setPosts((prev) =>
      prev.map((p) =>
        p.id !== postId
          ? p
          : {
              ...p,
              likes: had
                ? (p.likes || []).filter((id) => id !== meId)
                : [...(p.likes || []), meId],
            }
      )
    );

    try {
      if (had) {
        const { error } = await supabase
          .from(FEED_LIKES)
          .delete()
          .eq("post_id", postId)
          .eq("user_id", meId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from(FEED_LIKES)
          .upsert([{ post_id: postId, user_id: meId }], {
            onConflict: "post_id,user_id",
          });
        if (error) throw error;
      }
    } catch (e) {
      console.error("Like save failed:", e);
      setNotice("Couldn’t save like (offline). Changes kept in cache.");
    }
  }

  async function addComment(postId) {
    if (!user?.id) {
      setNotice("Sign in to comment.");
      return;
    }

    const txt = window.prompt("Comment");
    if (!txt || !txt.trim()) return;

    const optimistic = {
      id: safeUUID("c"),
      userId: meId,
      text: txt.trim(),
      createdAt: new Date().toISOString(),
    };

    setPosts((prev) =>
      prev.map((p) =>
        p.id !== postId ? p : { ...p, comments: [...(p.comments || []), optimistic] }
      )
    );
    setOpenComments((prev) => ({ ...prev, [postId]: true }));

    try {
      const { data, error } = await supabase
        .from(FEED_COMMENTS)
        .insert([{ post_id: postId, user_id: meId, text: optimistic.text }])
        .select("id, post_id, user_id, text, created_at")
        .single();

      if (error) throw error;

      setPosts((prev) =>
        prev.map((p) => {
          if (p.id !== postId) return p;
          const next = (p.comments || []).map((c) =>
            c.id === optimistic.id
              ? { id: data.id, userId: data.user_id, text: data.text, createdAt: data.created_at }
              : c
          );
          return { ...p, comments: next };
        })
      );
    } catch (e) {
      console.error("Comment save failed:", e);
      setNotice("Couldn’t save comment (offline). Changes kept in cache.");
    }
  }

  async function deleteComment(postId, comment) {
    if (!user?.id) {
      setNotice("Sign in to manage comments.");
      return;
    }
    if (!comment?.id) return;
    if (comment.userId !== meId) {
      setNotice("You can only delete your own comments.");
      return;
    }

    const ok = window.confirm("Delete this comment?");
    if (!ok) return;

    // Optimistic remove (UI + cache)
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        return {
          ...p,
          comments: ensureArr(p.comments).filter((c) => c?.id !== comment.id),
        };
      })
    );

    try {
      const { error } = await supabase
        .from(FEED_COMMENTS)
        .delete()
        .eq("id", comment.id)
        .eq("user_id", meId);

      // If it was only ever a cached/offline comment, this will fail — and that’s fine.
      if (error) {
        // keep fail-soft (don’t re-add)
        console.warn("Comment delete failed (kept removed locally):", error);
      }
    } catch (e) {
      console.warn("Comment delete exception (kept removed locally):", e);
    }
  }

  async function submitPost() {
    if (!text.trim()) return;
    if (!toPublic && !toFriends && !toLeague) return;

    if (!user?.id) {
      setNotice("Sign in to post.");
      return;
    }

    setLoading(true);
    setNotice("");

    try {
      const payload = {
        user_id: meId,
        league_id: toLeague ? league?.id || null : null,
        text: text.trim(),
        to_public: toPublic,
        to_friends: toFriends,
        to_league: toLeague,
      };

      const { error } = await supabase.from(FEED_POSTS).insert(payload);
      if (error) throw error;

      setText("");
      await loadFeedSupabase();
    } catch (e) {
      console.error("Post insert failed:", e);

      const offline = {
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

      setPosts((prev) => [offline, ...prev]);
      setText("");
      setNotice("Couldn’t post right now (offline). Saved in your cache.");
    } finally {
      setLoading(false);
    }
  }

  function toggleComments(postId) {
    setOpenComments((prev) => ({ ...prev, [postId]: !prev[postId] }));
  }

  const emptyCopy =
    scope === "public"
      ? { icon: "🏌️", title: "No banter yet", description: "Start the public golf feed with something funny." }
      : scope === "friends"
      ? { icon: "👥", title: "No friends posts yet", description: "When friends start posting, you'll see it here." }
      : { icon: "🏆", title: "No league banter yet", description: "Post a league moment to get the chat going." };

  return (
    <div className="space-y-4">
      <ScopeSwitch scope={scope} setScope={setScope} leagueName={league?.name} />

      {notice ? (
        <Card className="p-3">
          <div className="text-sm font-semibold text-slate-700">{notice}</div>
          {debugErr ? (
            <div className="mt-2 text-xs font-mono font-semibold text-rose-700">
              {debugErr}
            </div>
          ) : null}
        </Card>
      ) : null}

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

          <Pill active={toPublic} onClick={() => setToPublic((v) => !v)}>Public</Pill>
          <Pill active={toFriends} onClick={() => setToFriends((v) => !v)}>Friends</Pill>
          <Pill active={toLeague} onClick={() => setToLeague((v) => !v)}>League</Pill>

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
              disabled={loading || text.trim().length === 0 || (!toPublic && !toFriends && !toLeague) || !user?.id}
              className={[
                "rounded-xl px-4 py-2 text-sm font-extrabold text-white transition active:scale-[0.99]",
                !loading && user?.id && text.trim().length > 0 && (toPublic || toFriends || toLeague)
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : "bg-slate-300 cursor-not-allowed",
              ].join(" ")}
              title={!user?.id ? "Sign in to post" : ""}
            >
              {loading ? "Posting…" : "Post"}
            </button>
          </div>
        </div>

        {!user?.id ? (
          <div className="mt-2 text-xs font-semibold text-slate-600">
            Sign in to post, like, and comment.
          </div>
        ) : !toPublic && !toFriends && !toLeague ? (
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
              onDeleteComment={deleteComment}
              showComments={!!openComments[p.id]}
              onToggleComments={toggleComments}
            />
          ))}
        </div>
      )}
    </div>
  );
}




