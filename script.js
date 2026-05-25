/* ============================================================
   LYNN AI — script.js
   Shared JavaScript for login.html, signup.html, index.html
   Link in every page: <script src="script.js"></script>
   ============================================================ */

// ─────────────────────────────────────────────────────────────
// CONFIGURATION — update these before deploying
// ─────────────────────────────────────────────────────────────
const CONFIG = {
  supabaseUrl:  "https://YOUR_PROJECT_REF.supabase.co", // Supabase Project URL
  supabaseAnon: "YOUR_SUPABASE_ANON_KEY",               // anon/public key (safe for frontend)
  apiBase:      "/api",                                  // Lynn AI backend base path
  loginPage:    "login.html",                            // redirect here when logged out
  chatPage:     "index.html",                            // redirect here after login
};
// ─────────────────────────────────────────────────────────────

const { createClient } = supabase;
const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnon);

/* ============================================================
   STATE
   ============================================================ */
const State = {
  user:               null,   // current Supabase user object
  currentConvId:      null,   // active conversation UUID
  conversations:      [],     // cached list of conversations
  isGenerating:       false,  // true while waiting for AI response
};

/* ============================================================
   SUPABASE AUTH HELPERS
   ============================================================ */

/** Get the current JWT token (refreshes automatically) */
async function getToken() {
  const { data } = await sb.auth.getSession();
  return data?.session?.access_token ?? null;
}

/** Sign in with email + password */
async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** Sign up with email + password + optional display name */
async function signUp(email, password, fullName) {
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw error;
  return data;
}

/** Sign in via Google OAuth — redirects the browser */
async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/" + CONFIG.chatPage },
  });
  if (error) throw error;
}

/** Send a password reset email */
async function sendPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + "/" + CONFIG.chatPage,
  });
  if (error) throw error;
}

/** Sign out and redirect to login */
async function signOut() {
  await sb.auth.signOut();
  window.location.href = CONFIG.loginPage;
}

/* ============================================================
   API CLIENT
   Wraps fetch with auth headers + graceful error handling
   ============================================================ */

/**
 * Make an authenticated request to the Lynn AI backend.
 * @param {string} path    - e.g. "/chat" or "/conversations"
 * @param {object} options - standard fetch options (method, body, etc.)
 */
async function apiFetch(path, options = {}) {
  const token = await getToken();

  if (!token) {
    // Not logged in — bounce to login page
    window.location.href = CONFIG.loginPage;
    throw new Error("Not authenticated");
  }

  const res = await fetch(CONFIG.apiBase + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });

  // Parse JSON response (even on error, the API returns JSON)
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Throw with the server's human-readable message if available
    throw new Error(json.message || `Request failed (${res.status})`);
  }

  return json;
}

/* ============================================================
   CONVERSATION API
   ============================================================ */

/** Fetch all conversations for the current user */
async function fetchConversations() {
  const { conversations } = await apiFetch("/conversations");
  State.conversations = conversations;
  return conversations;
}

/** Create a new conversation (optionally with a title) */
async function createConversation(title = "New Conversation") {
  const { conversation } = await apiFetch("/conversations", {
    method: "POST",
    body:   JSON.stringify({ title }),
  });
  return conversation;
}

/** Load a single conversation + all its messages */
async function loadConversation(id) {
  const { conversation, messages } = await apiFetch(`/conversations/${id}`);
  return { conversation, messages };
}

/** Rename a conversation */
async function renameConversation(id, title) {
  const { conversation } = await apiFetch(`/conversations/${id}`, {
    method: "PATCH",
    body:   JSON.stringify({ title }),
  });
  return conversation;
}

/** Delete a conversation */
async function deleteConversation(id) {
  await apiFetch(`/conversations/${id}`, { method: "DELETE" });
}

/* ============================================================
   CHAT API
   ============================================================ */

/**
 * Send a message to Lynn and get a response.
 *
 * @param {string}  message        - The user's message text
 * @param {string}  conversationId - Optional: continue an existing conversation
 * @param {boolean} useSearch      - Optional: enable Tavily web search
 *
 * @returns {{ conversationId, message: { role, content, sources } }}
 */
async function sendChatMessage(message, conversationId, useSearch = false) {
  return apiFetch("/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      conversationId: conversationId || undefined,
      useSearch,
    }),
  });
}

/* ============================================================
   PASSWORD STRENGTH METER
   ============================================================ */

/**
 * Call this on every keystroke in a password field.
 * Expects elements with IDs: strength-fill, strength-label
 *
 * @param {string} password - The current password value
 */
function updatePasswordStrength(password) {
  const fill  = document.getElementById("strength-fill");
  const label = document.getElementById("strength-label");
  if (!fill || !label) return;

  if (!password) {
    fill.style.width = "0%";
    label.textContent = "";
    return;
  }

  let score = 0;
  if (password.length >= 8)          score++;
  if (password.length >= 12)         score++;
  if (/[A-Z]/.test(password))        score++;
  if (/[0-9]/.test(password))        score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const levels = [
    { pct: "20%",  color: "#ff7b7b", text: "Too weak" },
    { pct: "40%",  color: "#ffb77b", text: "Weak" },
    { pct: "60%",  color: "#ffd97b", text: "Fair" },
    { pct: "80%",  color: "#a8d8a8", text: "Good" },
    { pct: "100%", color: "#7bffb8", text: "Strong" },
  ];

  const level = levels[Math.min(score, 4)];
  fill.style.width      = level.pct;
  fill.style.background = level.color;
  label.textContent     = level.text;
  label.style.color     = level.color;
}

/* ============================================================
   FORM VALIDATION HELPERS
   ============================================================ */

/** Returns true if the email looks valid */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Map raw Supabase/server error messages to friendly human text.
 * @param {string} msg - The raw error message
 */
function friendlyError(msg = "") {
  if (msg.includes("Invalid login credentials"))
    return "Incorrect email or password. Please try again.";
  if (msg.includes("Email not confirmed"))
    return "Please confirm your email first — check your inbox.";
  if (msg.includes("User already registered"))
    return "An account with this email already exists. Try signing in.";
  if (msg.includes("Password should be") || msg.includes("at least"))
    return "Password must be at least 8 characters.";
  if (msg.includes("rate limit") || msg.includes("too many"))
    return "Too many attempts. Please wait a moment and try again.";
  if (msg.includes("invalid email") || msg.includes("Invalid email"))
    return "That email address doesn't look right.";
  if (msg.includes("Network") || msg.includes("fetch"))
    return "Connection error. Check your internet and try again.";
  return msg || "Something went wrong. Please try again.";
}

/* ============================================================
   NOTICE / ALERT BANNER
   ============================================================ */

/**
 * Show an error or success notice banner.
 * @param {string} msg   - Message to display
 * @param {"error"|"success"} type
 * @param {string} id    - Element ID (default "notice")
 */
function showNotice(msg, type = "error", id = "notice") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent  = msg;
  el.className    = `notice ${type}`;
  el.style.display = "block";
}

/** Hide the notice banner */
function clearNotice(id = "notice") {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = "none";
  el.textContent   = "";
}

/** Mark a form field as invalid (red border) */
function markInvalid(fieldId) {
  document.getElementById(fieldId)?.classList.add("invalid");
}

/** Clear all invalid states in the form */
function clearInvalid() {
  document.querySelectorAll(".invalid").forEach(el => el.classList.remove("invalid"));
}

/* ============================================================
   LOADING STATE FOR BUTTONS
   ============================================================ */

/**
 * Set a button into loading state with a spinner, or restore it.
 * @param {HTMLElement} btn
 * @param {boolean} loading
 * @param {string} loadingText - Text to show while loading
 * @param {string} defaultText - Text to restore when done
 */
function setButtonLoading(btn, loading, loadingText = "Loading…", defaultText = "") {
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<span class="spinner"></span>${loadingText}`
    : (defaultText || btn.dataset.defaultText || "Submit");

  // Save default text on first call so we can restore it
  if (!loading && !btn.dataset.defaultText) {
    btn.dataset.defaultText = defaultText;
  }
}

/* ============================================================
   CHAT UI — MESSAGES
   ============================================================ */

/**
 * Append a single message bubble to the messages container.
 * @param {"user"|"assistant"} role
 * @param {string} content
 * @param {Array}  sources - Optional Tavily web sources
 * @param {string} containerId - Element ID of the messages container
 */
function appendMessage(role, content, sources = [], containerId = "messages") {
  // Remove empty state placeholder if present
  document.getElementById("empty-state")?.remove();

  const container = document.getElementById(containerId);
  if (!container) return;

  const row    = document.createElement("div");
  row.className = `msg-row ${role}`;

  const bubble = document.createElement("div");
  bubble.className  = "msg-bubble";
  bubble.textContent = content;

  // Render Tavily source chips beneath the assistant message
  if (role === "assistant" && sources?.length) {
    const sourcesEl = document.createElement("div");
    sourcesEl.className = "msg-sources";

    sources.slice(0, 5).forEach(s => {
      const chip     = document.createElement("a");
      chip.className = "source-chip";
      chip.href      = s.url;
      chip.target    = "_blank";
      chip.rel       = "noopener noreferrer";
      chip.textContent = s.title || s.url;
      chip.title     = s.url;
      sourcesEl.appendChild(chip);
    });

    bubble.appendChild(sourcesEl);
  }

  row.appendChild(bubble);
  container.appendChild(row);

  // Scroll to the latest message
  container.scrollTop = container.scrollHeight;
}

/** Show the animated typing indicator (3 pulsing dots) */
function showTyping(containerId = "messages") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const el     = document.createElement("div");
  el.id        = "typing-indicator";
  el.className = "typing";
  el.innerHTML = "<span></span><span></span><span></span>";
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

/** Remove the typing indicator */
function hideTyping() {
  document.getElementById("typing-indicator")?.remove();
}

/** Clear all messages and restore the empty state placeholder */
function clearMessages(containerId = "messages") {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `
    <div id="empty-state" class="empty-state">
      <h2>Lynn</h2>
      <p>Ask me anything.</p>
    </div>`;
}

/**
 * Render an array of message objects from the database.
 * @param {Array} messages - [{ role, content, sources }]
 */
function renderMessages(messages, containerId = "messages") {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  if (!messages.length) {
    clearMessages(containerId);
    return;
  }

  messages.forEach(m => appendMessage(m.role, m.content, m.sources ?? []));
  container.scrollTop = container.scrollHeight;
}

/* ============================================================
   CHAT UI — CONVERSATION SIDEBAR
   ============================================================ */

/**
 * Render the conversation list in the sidebar.
 * @param {Array}    conversations
 * @param {Function} onSelect   - Called with (id, title) when a row is clicked
 * @param {Function} onDelete   - Called with (id) when delete is clicked
 * @param {string}   listId     - Element ID of the list container
 */
function renderConversationList(conversations, onSelect, onDelete, listId = "conversation-list") {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = "";

  if (!conversations.length) {
    list.innerHTML = `<p style="font-size:12px;color:var(--text-muted);padding:16px;text-align:center;">No conversations yet</p>`;
    return;
  }

  conversations.forEach(conv => {
    const el       = document.createElement("div");
    el.className   = "conv-item" + (conv.id === State.currentConvId ? " active" : "");
    el.dataset.id  = conv.id;
    el.innerHTML   = `
      <span class="conv-item-title">${escapeHtml(conv.title)}</span>
      <button class="conv-delete" title="Delete">✕</button>
    `;

    el.addEventListener("click", e => {
      if (!e.target.classList.contains("conv-delete")) {
        onSelect(conv.id, conv.title);
      }
    });

    el.querySelector(".conv-delete").addEventListener("click", e => {
      e.stopPropagation();
      onDelete(conv.id);
    });

    list.appendChild(el);
  });
}

/** Highlight the active conversation in the sidebar */
function setActiveConversation(id, listId = "conversation-list") {
  document.querySelectorAll(`#${listId} .conv-item`).forEach(el => {
    el.classList.toggle("active", el.dataset.id === id);
  });
}

/* ============================================================
   TEXTAREA AUTO-RESIZE
   ============================================================ */

/**
 * Attach auto-resize behaviour to a textarea so it grows with content.
 * @param {HTMLTextAreaElement} el
 * @param {number} maxHeight - Max height in px (default 160)
 */
function autoResize(el, maxHeight = 160) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
}

/* ============================================================
   ESCAPE HTML (XSS protection)
   ============================================================ */

/** Safely escape a string before inserting into innerHTML */
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ============================================================
   TRUNCATE TEXT
   ============================================================ */

/**
 * Truncate a string to a max length with an ellipsis.
 * @param {string} str
 * @param {number} max
 */
function truncate(str, max = 60) {
  return str.length > max ? str.slice(0, max - 3) + "…" : str;
}

/* ============================================================
   DEBOUNCE
   ============================================================ */

/**
 * Debounce a function — useful for search inputs.
 * @param {Function} fn
 * @param {number}   delay - ms to wait after last call
 */
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ============================================================
   KEYBOARD SHORTCUT HELPER
   ============================================================ */

/**
 * Register a keyboard shortcut.
 * @param {string}   combo - e.g. "Enter", "ctrl+k", "shift+Enter"
 * @param {Function} fn
 * @param {HTMLElement} target - Element to listen on (default document)
 */
function onKey(combo, fn, target = document) {
  const parts = combo.toLowerCase().split("+");
  const key   = parts[parts.length - 1];
  const ctrl  = parts.includes("ctrl")  || parts.includes("cmd");
  const shift = parts.includes("shift");
  const alt   = parts.includes("alt");

  target.addEventListener("keydown", e => {
    const matches =
      e.key.toLowerCase() === key &&
      !!e.ctrlKey  === ctrl  &&
      !!e.shiftKey === shift &&
      !!e.altKey   === alt;
    if (matches) fn(e);
  });
}

/* ============================================================
   PAGE DETECTION
   Detect which page we're on so shared code knows what to init
   ============================================================ */

function currentPage() {
  const path = window.location.pathname;
  if (path.endsWith("signup.html"))  return "signup";
  if (path.endsWith("login.html"))   return "login";
  return "chat"; // index.html or root
}

/* ============================================================
   AUTH GUARD
   Call this at the top of index.html — redirects to login if not authed
   ============================================================ */

/**
 * Ensure the user is logged in. Redirects to login if not.
 * Returns the user object if authenticated.
 */
async function requireAuth() {
  const { data } = await sb.auth.getSession();
  if (!data?.session?.user) {
    window.location.href = CONFIG.loginPage;
    return null;
  }
  State.user = data.session.user;
  return State.user;
}

/**
 * Redirect logged-in users away from auth pages (login/signup).
 * Call this at the top of login.html and signup.html.
 */
function redirectIfLoggedIn() {
  sb.auth.onAuthStateChange((event, session) => {
    if (session?.user) window.location.href = CONFIG.chatPage;
  });
}

/* ============================================================
   FULL CHAT PAGE CONTROLLER
   Self-contained init for index.html — wire this up with:
     document.addEventListener("DOMContentLoaded", initChatPage);
   ============================================================ */

async function initChatPage() {
  // Redirect if not authenticated
  const user = await requireAuth();
  if (!user) return;

  // Show user email in sidebar footer
  const emailEl = document.getElementById("user-email");
  if (emailEl) emailEl.textContent = user.email;

  // Load conversation history into sidebar
  await refreshConversationList();

  // Wire up new conversation button
  document.getElementById("new-conv-btn")?.addEventListener("click", startNewConversation);

  // Wire up sign out button
  document.getElementById("signout-btn")?.addEventListener("click", signOut);

  // Wire up send button
  document.getElementById("send-btn")?.addEventListener("click", handleSend);

  // Wire up textarea — Enter sends, Shift+Enter adds newline
  const textarea = document.getElementById("msg-input");
  if (textarea) {
    textarea.addEventListener("input", () => autoResize(textarea));
    onKey("Enter", e => {
      if (!e.shiftKey) { e.preventDefault(); handleSend(); }
    }, textarea);
  }
}

/** Reload conversations from the API and re-render the sidebar */
async function refreshConversationList() {
  try {
    const convs = await fetchConversations();
    renderConversationList(
      convs,
      openConversation,
      handleDeleteConversation,
    );
  } catch (err) {
    console.error("[Lynn] Failed to load conversations:", err);
  }
}

/** Open an existing conversation and render its messages */
async function openConversation(id, title) {
  State.currentConvId = id;

  const titleEl = document.getElementById("chat-title");
  if (titleEl) titleEl.textContent = title;

  setActiveConversation(id);

  try {
    const { messages } = await loadConversation(id);
    renderMessages(messages);
  } catch (err) {
    console.error("[Lynn] Failed to load conversation:", err);
  }
}

/** Reset the chat area to start a new conversation */
function startNewConversation() {
  State.currentConvId = null;

  const titleEl = document.getElementById("chat-title");
  if (titleEl) titleEl.textContent = "New conversation";

  setActiveConversation(null);
  clearMessages();
}

/** Handle delete — confirm then delete and refresh */
async function handleDeleteConversation(id) {
  try {
    await deleteConversation(id);
    if (State.currentConvId === id) startNewConversation();
    await refreshConversationList();
  } catch (err) {
    console.error("[Lynn] Failed to delete conversation:", err);
    alert("Could not delete conversation. Please try again.");
  }
}

/** Handle the send button / Enter key in the chat textarea */
async function handleSend() {
  if (State.isGenerating) return;

  const textarea  = document.getElementById("msg-input");
  const sendBtn   = document.getElementById("send-btn");
  const useSearch = document.getElementById("use-search")?.checked ?? false;
  const message   = textarea?.value.trim();

  if (!message) return;

  // Lock UI
  State.isGenerating = true;
  if (textarea) { textarea.value = ""; autoResize(textarea); }
  if (sendBtn)    sendBtn.disabled = true;

  // Show user message + typing indicator
  appendMessage("user", message);
  showTyping();

  try {
    const data = await sendChatMessage(message, State.currentConvId, useSearch);

    hideTyping();

    // Track conversation ID (set on first message)
    if (!State.currentConvId) {
      State.currentConvId = data.conversationId;
      await refreshConversationList();
      setActiveConversation(State.currentConvId);

      // Update header title from first message
      const titleEl = document.getElementById("chat-title");
      if (titleEl) titleEl.textContent = truncate(message);
    }

    appendMessage("assistant", data.message.content, data.message.sources ?? []);

  } catch (err) {
    hideTyping();
    appendMessage("assistant", "Something went wrong — please try again in a moment.");
    console.error("[Lynn] Chat error:", err);
  } finally {
    State.isGenerating = false;
    if (sendBtn) sendBtn.disabled = false;
    textarea?.focus();
  }
}

/* ============================================================
   FULL AUTH PAGE CONTROLLERS
   ============================================================ */

/** Init logic for login.html */
async function initLoginPage() {
  redirectIfLoggedIn();

  let mode = "login";

  function switchTab(newMode) {
    mode = newMode;
    const isLogin = mode === "login";
    document.getElementById("tab-login")?.classList.toggle("active", isLogin);
    document.getElementById("tab-signup")?.classList.toggle("active", !isLogin);
    document.getElementById("forgot-wrap") && (
      document.getElementById("forgot-wrap").style.display = isLogin ? "block" : "none"
    );
    const btn = document.getElementById("submit-btn");
    if (btn) btn.textContent = isLogin ? "Sign in" : "Create account";
    const footer = document.getElementById("footer-text");
    if (footer) footer.innerHTML = isLogin
      ? `Don't have an account? <a href="signup.html">Create one</a>`
      : `Already have an account? <a href="#" onclick="switchTab('login')">Sign in</a>`;
    clearNotice();
    clearInvalid();
  }

  // Expose switchTab globally so onclick="" attributes work
  window.switchTab = switchTab;

  async function handleSubmit() {
    const email    = document.getElementById("email")?.value.trim();
    const password = document.getElementById("password")?.value;
    const btn      = document.getElementById("submit-btn");
    clearNotice(); clearInvalid();

    if (!email || !isValidEmail(email)) {
      showNotice("Please enter a valid email address.", "error");
      markInvalid("email"); return;
    }
    if (!password || password.length < 6) {
      showNotice("Password must be at least 6 characters.", "error");
      markInvalid("password"); return;
    }

    const label = mode === "login" ? "Signing in…" : "Creating account…";
    setButtonLoading(btn, true, label);

    try {
      if (mode === "login") {
        await signIn(email, password);
        // onAuthStateChange → redirect
      } else {
        const { session } = await signUp(email, password, "");
        if (session) {
          window.location.href = CONFIG.chatPage;
        } else {
          showNotice("Account created! Check your inbox to confirm, then sign in.", "success");
          switchTab("login");
        }
      }
    } catch (err) {
      showNotice(friendlyError(err.message), "error");
    } finally {
      setButtonLoading(btn, false, "", mode === "login" ? "Sign in" : "Create account");
    }
  }

  window.handleSubmit = handleSubmit;
  window.signInWithGoogle = signInWithGoogle;

  // Reset password flow
  window.showReset = () => {
    document.getElementById("main-view").style.display  = "none";
    document.getElementById("reset-view").style.display = "flex";
    clearNotice("reset-notice");
  };

  window.showMain = () => {
    document.getElementById("main-view").style.display  = "flex";
    document.getElementById("reset-view").style.display = "none";
  };

  window.handleReset = async () => {
    const email = document.getElementById("reset-email")?.value.trim();
    const btn   = document.getElementById("reset-btn");
    clearNotice("reset-notice");

    if (!email || !isValidEmail(email)) {
      showNotice("Please enter a valid email.", "error", "reset-notice"); return;
    }

    setButtonLoading(btn, true, "Sending…");
    try {
      await sendPasswordReset(email);
      showNotice("Reset link sent! Check your inbox.", "success", "reset-notice");
    } catch (err) {
      showNotice(friendlyError(err.message), "error", "reset-notice");
    } finally {
      setButtonLoading(btn, false, "", "Send reset link");
    }
  };

  // Enter key submits
  onKey("Enter", () => handleSubmit(), document.getElementById("password"));
}

/** Init logic for signup.html */
async function initSignupPage() {
  redirectIfLoggedIn();

  // Password strength meter
  document.getElementById("password")?.addEventListener("input", e => {
    updatePasswordStrength(e.target.value);
  });

  window.signUpWithGoogle = signInWithGoogle;

  window.handleSignUp = async () => {
    const fullname = document.getElementById("fullname")?.value.trim();
    const email    = document.getElementById("email")?.value.trim();
    const password = document.getElementById("password")?.value;
    const confirm  = document.getElementById("confirm")?.value;
    const agreed   = document.getElementById("terms-check")?.checked;
    const btn      = document.getElementById("submit-btn");

    clearNotice(); clearInvalid();

    if (!fullname) {
      showNotice("Please enter your full name.", "error");
      markInvalid("fullname"); return;
    }
    if (!email || !isValidEmail(email)) {
      showNotice("Please enter a valid email address.", "error");
      markInvalid("email"); return;
    }
    if (!password || password.length < 8) {
      showNotice("Password must be at least 8 characters.", "error");
      markInvalid("password"); return;
    }
    if (password !== confirm) {
      showNotice("Passwords don't match.", "error");
      markInvalid("confirm"); return;
    }
    if (!agreed) {
      showNotice("Please agree to the Terms of Service to continue.", "error"); return;
    }

    setButtonLoading(btn, true, "Creating account…");

    try {
      const { session } = await signUp(email, password, fullname);

      if (session) {
        window.location.href = CONFIG.chatPage;
      } else {
        // Show success screen — email confirmation required
        document.getElementById("form-view").style.display    = "none";
        const sc = document.getElementById("success-screen");
        if (sc) {
          sc.style.display = "flex";
          const msg = sc.querySelector("#success-msg");
          if (msg) msg.textContent =
            `We sent a confirmation link to ${email}. Click it to activate your account, then sign in.`;
        }
      }
    } catch (err) {
      showNotice(friendlyError(err.message), "error");
    } finally {
      setButtonLoading(btn, false, "", "Create account");
    }
  };

  // Enter on confirm field submits
  onKey("Enter", () => window.handleSignUp(), document.getElementById("confirm"));
}

/* ============================================================
   AUTO-INIT  — detect page and run the right controller
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  const page = currentPage();

  if (page === "chat")   initChatPage();
  if (page === "login")  initLoginPage();
  if (page === "signup") initSignupPage();
});
