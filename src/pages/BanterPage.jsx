// src/pages/BanterPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";
import { supabase } from "../lib/supabaseClient";

function ensureArr(v) {
  return Array.isArray(v) ? v : [];
}

function humanErr(e) {
  return e?.message || String(e || "Something went wrong.");
}

function shortId(id) {
  const s = String(id || "");
  if (!s) return "unknown";
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function extFromFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const parts = name.split(".");
  const ext = parts.length > 1 ? parts.pop() : "";
  return ext || "jpg";
}

export default function BanterPage() {
  const { leagueId } = useParams();
  const navigate = useNavigate();

  const fileInputRef = useRef(null);

  const [authId, setAuthId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });

  const [posts, setPosts] = useState([]);
  const [profilesById, setProfilesById] = useState({});
  const [imageUrlsByPostId, setImageUrlsByPostId] = useState({});
  const [myRole, setMyRole] = useState(null);

  const [likesByPostId, setLikesByPostId] = useState({});
  const [commentsByPostId, setCommentsByPostId] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [busyPostId, setBusyPostId] = useState(null);
  const [busyCommentId, setBusyCommentId] = useState(null);

  const [content, setContent] = useState("");
  const [file, setFile] = useState(null);

  const isAdmin = useMemo(() => myRole === "host" || myRole === "admin", [myRole]);

  const StatusBanner = status?.message ? (
    <div
      className={[
        "rounded-2xl px-4 py-3 text-sm font-semibold ring-1",
        status.type === "success"
          ? "bg-emerald-50 text-emerald-900 ring-emerald-200"
          : status.type === "info"
          ? "bg-slate-50 text-slate-800 ring-slate-200"
          : "bg-rose-50 text-rose-900 ring-rose-200",
      ].join(" ")}
    >
      {status.message}
    </div>
  ) : null;

  async function load() {
    setLoading(true);
    setStatus({ type: "", message: "" });

    try {
      const sessionRes = await supabase.auth.getSession();
      const uid = sessionRes?.data?.session?.user?.id || null;
      setAuthId(uid);

      if (!uid) {
        setPosts([]);
        setProfilesById({});
        setImageUrlsByPostId({});
        setLikesByPostId({});
        setCommentsByPostId({});
        setMyRole(null);
        setStatus({ type: "error", message: "You’re not logged in." });
        return;
      }

      if (!leagueId) {
        setStatus({ type: "error", message: "Missing league id." });
        return;
      }

      const roleRes = await supabase
        .from("league_members")
        .select("role,status")
        .eq("league_id", leagueId)
        .eq("user_id", uid)
        .maybeSingle();

      if (!roleRes.error && roleRes.data?.status === "active") {
        setMyRole(roleRes.data.role || null);
      } else {
        setMyRole(null);
      }

      const { data, error } = await supabase
        .from("banter_posts")
        .select("id, league_id, user_id, content, image_path, created_at")
        .eq("league_id", leagueId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      const rows = ensureArr(data);
      setPosts(rows);

      const postIds = rows.map((p) => p.id).filter(Boolean);

      if (postIds.length) {
        const likesRes = await supabase
          .from("banter_post_likes")
          .select("post_id,user_id,created_at")
          .in("post_id", postIds);

        if (!likesRes.error) {
          const map = {};
          ensureArr(likesRes.data).forEach((like) => {
            const pid = like?.post_id;
            if (!pid) return;
            if (!map[pid]) map[pid] = { count: 0, likedByMe: false };
            map[pid].count += 1;
            if (like.user_id === uid) map[pid].likedByMe = true;
          });
          setLikesByPostId(map);
        } else {
          setLikesByPostId({});
        }

        const commentsRes = await supabase
          .from("banter_post_comments")
          .select("id,post_id,user_id,text,created_at")
          .in("post_id", postIds)
          .order("created_at", { ascending: true });

        if (!commentsRes.error) {
          const map = {};
          ensureArr(commentsRes.data).forEach((comment) => {
            const pid = comment?.post_id;
            if (!pid) return;
            if (!map[pid]) map[pid] = [];
            map[pid].push(comment);
          });
          setCommentsByPostId(map);
        } else {
          setCommentsByPostId({});
        }
      } else {
        setLikesByPostId({});
        setCommentsByPostId({});
      }

      const authorIds = Array.from(
        new Set([
          ...rows.map((p) => p.user_id).filter(Boolean),
          ...Object.values(commentsByPostId)
            .flat()
            .map((c) => c.user_id)
            .filter(Boolean),
        ])
      );

      const commentAuthorIds = [];
      if (postIds.length) {
        const commentsRes = await supabase
          .from("banter_post_comments")
          .select("user_id")
          .in("post_id", postIds);

        if (!commentsRes.error) {
          ensureArr(commentsRes.data).forEach((c) => {
            if (c?.user_id) commentAuthorIds.push(c.user_id);
          });
        }
      }

      const allProfileIds = Array.from(
        new Set([...rows.map((p) => p.user_id).filter(Boolean), ...commentAuthorIds])
      );

      if (allProfileIds.length) {
        const profRes = await supabase
          .from("profiles")
          .select("id, display_name, username")
          .in("id", allProfileIds);

        if (!profRes.error) {
          const map = {};
          ensureArr(profRes.data).forEach((p) => {
            if (!p?.id) return;
            map[p.id] = p;
          });
          setProfilesById(map);
        }
      } else {
        setProfilesById({});
      }

      const rowsWithImages = rows.filter((r) => !!r.image_path);
      if (!rowsWithImages.length) {
        setImageUrlsByPostId({});
        return;
      }

      const signedResults = await Promise.all(
        rowsWithImages.map(async (row) => {
          const { data: signed, error: signErr } = await supabase.storage
            .from("banter-images")
            .createSignedUrl(row.image_path, 60 * 60);

          if (signErr || !signed?.signedUrl) return [row.id, null];
          return [row.id, signed.signedUrl];
        })
      );

      const urlMap = {};
      for (const [postId, url] of signedResults) {
        if (url) urlMap[postId] = url;
      }
      setImageUrlsByPostId(urlMap);
    } catch (e) {
      setStatus({ type: "error", message: humanErr(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const canPost = useMemo(() => {
    return !posting && content.trim().length >= 1;
  }, [posting, content]);

  function authorLabel(userId) {
    const p = profilesById[userId];
    return p?.display_name || p?.username || `User ${shortId(userId)}`;
  }

  function canDeletePost(post) {
    if (!authId) return false;
    if (post?.user_id === authId) return true;
    return isAdmin;
  }

  function canDeleteComment(comment) {
    if (!authId) return false;
    if (comment?.user_id === authId) return true;
    return isAdmin;
  }

  async function createPost() {
    if (!authId || !leagueId) return;

    const text = content.trim();
    if (!text) {
      setStatus({ type: "error", message: "Write something first." });
      return;
    }

    setPosting(true);
    setStatus({ type: "", message: "" });

    try {
      const ins = await supabase
        .from("banter_posts")
        .insert({
          league_id: leagueId,
          user_id: authId,
          content: text,
          image_path: null,
        })
        .select("id")
        .maybeSingle();

      if (ins.error) throw ins.error;

      const postId = ins.data?.id;
      if (!postId) throw new Error("Failed to create post.");

      if (file) {
        const ext = extFromFile(file);
        const path = `${leagueId}/${postId}.${ext}`;

        const up = await supabase.storage.from("banter-images").upload(path, file, {
          upsert: true,
          contentType: file.type || undefined,
        });

        if (up.error) throw up.error;

        const upd = await supabase.from("banter_posts").update({ image_path: path }).eq("id", postId);
        if (upd.error) throw upd.error;
      }

      setContent("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setStatus({ type: "success", message: "Posted ✅" });
      await load();
    } catch (e) {
      setStatus({ type: "error", message: humanErr(e) });
    } finally {
      setPosting(false);
    }
  }

  async function deletePost(post) {
    if (!post?.id) return;

    if (!canDeletePost(post)) {
      setStatus({ type: "error", message: "You can’t delete this post." });
      return;
    }

    setPosting(true);
    setStatus({ type: "", message: "" });

    try {
      const del = await supabase.from("banter_posts").delete().eq("id", post.id);
      if (del.error) throw del.error;

      if (post.image_path) {
        await supabase.storage.from("banter-images").remove([post.image_path]);
      }

      setStatus({ type: "success", message: "Deleted." });
      await load();
    } catch (e) {
      setStatus({ type: "error", message: humanErr(e) });
    } finally {
      setPosting(false);
    }
  }

  async function toggleLike(postId) {
    if (!authId || !postId) return;

    const current = likesByPostId[postId] || { count: 0, likedByMe: false };
    setBusyPostId(postId);
    setStatus({ type: "", message: "" });

    try {
      if (current.likedByMe) {
        const { error } = await supabase
          .from("banter_post_likes")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", authId);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("banter_post_likes").insert({
          post_id: postId,
          user_id: authId,
        });

        if (error) throw error;
      }

      await load();
    } catch (e) {
      setStatus({ type: "error", message: humanErr(e) });
    } finally {
      setBusyPostId(null);
    }
  }

  function updateCommentDraft(postId, value) {
    setCommentDrafts((cur) => ({
      ...cur,
      [postId]: value,
    }));
  }

  async function createComment(postId) {
    if (!authId || !postId) return;

    const text = String(commentDrafts[postId] || "").trim();

    if (!text) {
      setStatus({ type: "error", message: "Write a comment first." });
      return;
    }

    setBusyPostId(postId);
    setStatus({ type: "", message: "" });

    try {
      const { error } = await supabase.from("banter_post_comments").insert({
        post_id: postId,
        user_id: authId,
        text,
      });

      if (error) throw error;

      setCommentDrafts((cur) => ({
        ...cur,
        [postId]: "",
      }));

      await load();
    } catch (e) {
      setStatus({ type: "error", message: humanErr(e) });
    } finally {
      setBusyPostId(null);
    }
  }

  async function deleteComment(comment) {
    if (!comment?.id) return;

    if (!canDeleteComment(comment)) {
      setStatus({ type: "error", message: "You can’t delete this comment." });
      return;
    }

    setBusyCommentId(comment.id);
    setStatus({ type: "", message: "" });

    try {
      const { error } = await supabase.from("banter_post_comments").delete().eq("id", comment.id);
      if (error) throw error;

      await load();
    } catch (e) {
      setStatus({ type: "error", message: humanErr(e) });
    } finally {
      setBusyCommentId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="League Banter"
        subtitle="League-only chat. Post banter, memes, and match-day chirps."
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(-1)}
              className="rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              Back
            </button>

            <button
              onClick={load}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
              disabled={posting}
            >
              Refresh
            </button>
          </div>
        }
      />

      <Card className="p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Post something</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Text is required. Image is optional.
            </div>
          </div>

          {myRole ? (
            <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
              Your role: {myRole}
            </span>
          ) : null}
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Talk your talk…"
          disabled={posting}
          rows={3}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 placeholder:text-slate-400 outline-none ring-emerald-200 focus:ring-4"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-200">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={posting}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {file ? `Image: ${file.name}` : "Add meme/image"}
          </label>

          <button
            onClick={createPost}
            disabled={!canPost}
            className={[
              "rounded-xl px-4 py-2 text-sm font-extrabold",
              !canPost
                ? "cursor-not-allowed bg-slate-200 text-slate-500"
                : "bg-emerald-600 text-white hover:bg-emerald-500",
            ].join(" ")}
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>

        {StatusBanner}
      </Card>

      <Card className="p-5 space-y-3">
        <div className="text-sm font-extrabold text-slate-900">Latest</div>

        {loading ? (
          <div className="text-sm font-semibold text-slate-600">Loading…</div>
        ) : posts.length === 0 ? (
          <EmptyState icon="💬" title="No banter yet" description="Be the first to post a meme or a chirp." />
        ) : (
          <div className="space-y-3">
            {posts.map((p) => {
              const likeInfo = likesByPostId[p.id] || { count: 0, likedByMe: false };
              const comments = commentsByPostId[p.id] || [];
              const draft = commentDrafts[p.id] || "";
              const postBusy = busyPostId === p.id;

              return (
                <div key={p.id} className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold text-slate-900">
                        {authorLabel(p.user_id)}
                      </div>
                      <div className="text-xs font-semibold text-slate-500">
                        {new Date(p.created_at).toLocaleString()}
                      </div>
                    </div>

                    {canDeletePost(p) ? (
                      <button
                        onClick={() => deletePost(p)}
                        disabled={posting}
                        className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-rose-500 disabled:opacity-60"
                        title="Delete"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>

                  <div className="whitespace-pre-wrap text-sm font-semibold text-slate-800">{p.content}</div>

                  {imageUrlsByPostId[p.id] ? (
                    <img
                      src={imageUrlsByPostId[p.id]}
                      alt="Banter"
                      className="max-h-[520px] w-full rounded-xl border border-slate-200 bg-slate-50 object-contain"
                      loading="lazy"
                    />
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={postBusy}
                      onClick={() => toggleLike(p.id)}
                      className={[
                        "rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                        likeInfo.likedByMe
                          ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-500"
                          : "bg-slate-100 text-slate-700 ring-slate-200 hover:bg-slate-200",
                        postBusy ? "opacity-60" : "",
                      ].join(" ")}
                    >
                      👍 {likeInfo.likedByMe ? "Liked" : "Like"} · {likeInfo.count}
                    </button>

                    <span className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
                      💬 {comments.length}
                    </span>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                    <div className="space-y-2">
                      {comments.length === 0 ? (
                        <div className="text-xs font-semibold text-slate-500">No comments yet.</div>
                      ) : (
                        comments.map((c) => {
                          const commentBusy = busyCommentId === c.id;

                          return (
                            <div key={c.id} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-extrabold text-slate-900">
                                    {authorLabel(c.user_id)}
                                  </div>
                                  <div className="text-[11px] font-semibold text-slate-500">
                                    {new Date(c.created_at).toLocaleString()}
                                  </div>
                                </div>

                                {canDeleteComment(c) ? (
                                  <button
                                    type="button"
                                    disabled={commentBusy}
                                    onClick={() => deleteComment(c)}
                                    className="rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-extrabold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100 disabled:opacity-60"
                                  >
                                    Delete
                                  </button>
                                ) : null}
                              </div>

                              <div className="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-800">
                                {c.text}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div className="mt-3 flex gap-2">
                      <input
                        value={draft}
                        onChange={(e) => updateCommentDraft(p.id, e.target.value)}
                        placeholder="Write a comment…"
                        disabled={postBusy}
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 placeholder:text-slate-400 outline-none ring-emerald-200 focus:ring-4"
                      />

                      <button
                        type="button"
                        disabled={postBusy || !draft.trim()}
                        onClick={() => createComment(p.id)}
                        className={[
                          "rounded-xl px-3 py-2 text-xs font-extrabold",
                          postBusy || !draft.trim()
                            ? "cursor-not-allowed bg-slate-200 text-slate-500"
                            : "bg-slate-900 text-white hover:bg-slate-800",
                        ].join(" ")}
                      >
                        Comment
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}