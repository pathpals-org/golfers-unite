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
  const [myRole, setMyRole] = useState(null); // host/cohost/member

  const [content, setContent] = useState("");
  const [file, setFile] = useState(null);

  const StatusBanner = status?.message ? (
    <div
      className={[
        "rounded-2xl px-4 py-3 text-sm font-semibold ring-1",
        status.type === "success"
          ? "bg-emerald-500/15 text-emerald-100 ring-emerald-500/30"
          : status.type === "info"
          ? "bg-white/10 text-slate-100 ring-white/15"
          : "bg-rose-500/15 text-rose-100 ring-rose-500/30",
      ].join(" ")}
    >
      {status.message}
    </div>
  ) : null;

  const isAdmin = useMemo(() => myRole === "host" || myRole === "cohost", [myRole]);

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
        setMyRole(null);
        setStatus({ type: "error", message: "You’re not logged in." });
        return;
      }

      if (!leagueId) {
        setStatus({ type: "error", message: "Missing league id." });
        return;
      }

      // 1) Load my league role (for delete button UX)
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

      // 2) Load banter posts (RLS enforces league membership)
      const { data, error } = await supabase
        .from("banter_posts")
        .select("id, league_id, user_id, content, image_path, created_at")
        .eq("league_id", leagueId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      const rows = ensureArr(data);
      setPosts(rows);

      // 3) Load unique author profiles
      const authorIds = Array.from(new Set(rows.map((p) => p.user_id).filter(Boolean)));
      if (authorIds.length) {
        const profRes = await supabase
          .from("profiles")
          .select("id, display_name, username")
          .in("id", authorIds);

        // If profile RLS blocks, that's okay; we fallback to short id.
        if (!profRes.error) {
          const map = {};
          ensureArr(profRes.data).forEach((p) => {
            if (!p?.id) return;
            map[p.id] = p;
          });
          setProfilesById(map);
        }
      }

      // 4) Create signed URLs for images (private bucket) - do it in parallel
      const rowsWithImages = rows.filter((r) => !!r.image_path);
      if (!rowsWithImages.length) {
        setImageUrlsByPostId({});
        return;
      }

      const signedResults = await Promise.all(
        rowsWithImages.map(async (row) => {
          const { data: signed, error: signErr } = await supabase.storage
            .from("banter-images")
            .createSignedUrl(row.image_path, 60 * 60); // 1 hour
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
    // MVP: require text (keeps it clean + avoids "empty meme" spam)
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
      // 1) Insert post row first (no image yet)
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

      // 2) If file exists, upload to storage and update row with path
      if (file) {
        const ext = extFromFile(file);
        const path = `${leagueId}/${postId}.${ext}`;

        const up = await supabase.storage.from("banter-images").upload(path, file, {
          upsert: true,
          contentType: file.type || undefined,
        });

        if (up.error) throw up.error;

        const upd = await supabase
          .from("banter_posts")
          .update({ image_path: path })
          .eq("id", postId);

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
      // 1) Delete DB row (RLS enforces permissions)
      const del = await supabase.from("banter_posts").delete().eq("id", post.id);
      if (del.error) throw del.error;

      // 2) Try delete storage file (best-effort)
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="League Banter"
        subtitle="League-only posts. Memes welcome."
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(-1)}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm font-extrabold text-white hover:bg-white/15"
            >
              Back
            </button>
            <button
              onClick={load}
              className="rounded-xl bg-white/15 px-4 py-2 text-sm font-extrabold text-white hover:bg-white/20 disabled:opacity-60"
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
            <div className="text-base font-extrabold text-white">Post something</div>
            <div className="mt-1 text-xs font-semibold text-slate-100">
              Tip: keep it league banter. Text is required (image optional).
            </div>
          </div>

          {myRole ? (
            <span className="rounded-full bg-white/10 px-3 py-2 text-xs font-extrabold text-slate-100 ring-1 ring-white/15">
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
          className="w-full rounded-xl border border-white/15 bg-slate-950/40 px-3 py-2 text-sm font-bold text-white placeholder:text-slate-200 outline-none focus:ring-4 focus:ring-emerald-200"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-extrabold text-slate-100 ring-1 ring-white/15 hover:bg-white/15 cursor-pointer">
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
                ? "bg-white/10 text-slate-200 cursor-not-allowed"
                : "bg-emerald-600 text-white hover:bg-emerald-500",
            ].join(" ")}
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>

        {StatusBanner}
      </Card>

      <Card className="p-5 space-y-3">
        <div className="text-base font-extrabold text-white">Latest</div>

        {loading ? (
          <div className="text-sm font-semibold text-slate-100">Loading…</div>
        ) : posts.length === 0 ? (
          <EmptyState icon="💬" title="No banter yet" description="Be the first to post a meme or a chirp." />
        ) : (
          <div className="space-y-3">
            {posts.map((p) => (
              <div key={p.id} className="rounded-2xl border border-white/15 bg-white/10 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-white">{authorLabel(p.user_id)}</div>
                    <div className="text-xs font-semibold text-slate-100">
                      {new Date(p.created_at).toLocaleString()}
                    </div>
                  </div>

                  {canDeletePost(p) ? (
                    <button
                      onClick={() => deletePost(p)}
                      disabled={posting}
                      className="rounded-xl bg-white/10 px-3 py-2 text-xs font-extrabold text-white hover:bg-white/15 disabled:opacity-60"
                      title="Delete"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>

                <div className="text-sm font-semibold text-slate-100 whitespace-pre-wrap">{p.content}</div>

                {imageUrlsByPostId[p.id] ? (
                  <img
                    src={imageUrlsByPostId[p.id]}
                    alt="Banter"
                    className="w-full max-h-[520px] object-contain rounded-xl border border-white/10 bg-slate-950/30"
                    loading="lazy"
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}