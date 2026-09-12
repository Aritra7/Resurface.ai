/**
 * Resurface.AI extension popup.
 *
 * Pairing exchanges a short code for an opaque bearer token, kept in chrome.storage.local.
 * The token is the only credential; there is no Supabase session inside an extension.
 */

const API = "http://localhost:3000";

const $ = (id) => document.getElementById(id);
const status = $("status");

function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = kind;
}

async function getToken() {
  const { token } = await chrome.storage.local.get("token");
  return token || null;
}

async function render() {
  const token = await getToken();
  $("pair-view").hidden = Boolean(token);
  $("sync-view").hidden = !token;
}

/** Walks the bookmark tree, carrying the folder path down as the collection label. */
function flattenBookmarks(nodes, path = []) {
  const out = [];
  for (const node of nodes) {
    if (node.children) {
      // Chrome's roots ("Bookmarks bar", "Other bookmarks") are noise in a path.
      const next = node.title && node.parentId !== "0" ? [...path, node.title] : path;
      out.push(...flattenBookmarks(node.children, next));
    } else if (node.url && /^https?:/.test(node.url)) {
      out.push({
        url: node.url,
        title: node.title || undefined,
        externalId: node.id,
        folder: path.length ? path.join(" / ") : "Bookmarks",
        savedAt: node.dateAdded ? new Date(node.dateAdded).toISOString() : undefined,
        kind: "bookmark",
      });
    }
  }
  return out;
}

async function collectItems() {
  const items = [];

  if ($("inc-bookmarks").checked) {
    const tree = await chrome.bookmarks.getTree();
    items.push(...flattenBookmarks(tree));
  }

  if ($("inc-tabs").checked) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.url || !/^https?:/.test(tab.url)) continue;
      items.push({ url: tab.url, title: tab.title || undefined, kind: "tab" });
    }
  }

  return items;
}

$("pair-btn").addEventListener("click", async () => {
  const code = $("code").value.trim().toUpperCase();
  if (!code) return setStatus("Enter the code from Resurface.", "error");

  $("pair-btn").disabled = true;
  setStatus("Pairing…");

  try {
    const response = await fetch(`${API}/api/extension/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, label: "Chrome" }),
    });
    const body = await response.json();

    if (!response.ok) {
      setStatus(body.error || "Pairing failed.", "error");
    } else {
      await chrome.storage.local.set({ token: body.token });
      setStatus("Paired. You can send your bookmarks now.", "ok");
      await render();
    }
  } catch {
    setStatus("Could not reach Resurface. Is it running?", "error");
  }

  $("pair-btn").disabled = false;
});

$("sync-btn").addEventListener("click", async () => {
  const token = await getToken();
  if (!token) return render();

  $("sync-btn").disabled = true;
  setStatus("Collecting…");

  try {
    const items = await collectItems();
    if (items.length === 0) {
      setStatus("Nothing selected to send.", "error");
      $("sync-btn").disabled = false;
      return;
    }

    setStatus(`Sending ${items.length}…`);
    const response = await fetch(`${API}/api/extension/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items }),
    });
    const body = await response.json();

    if (response.status === 401) {
      // The token was revoked server-side; drop it and return to pairing.
      await chrome.storage.local.remove("token");
      setStatus(body.error || "This browser is no longer paired.", "error");
      await render();
    } else if (!response.ok) {
      setStatus(body.error || "Send failed.", "error");
    } else {
      setStatus(`Sent ${body.imported} of ${body.seen}.`, "ok");
    }
  } catch {
    setStatus("Could not reach Resurface. Is it running?", "error");
  }

  $("sync-btn").disabled = false;
});

$("unpair-btn").addEventListener("click", async () => {
  await chrome.storage.local.remove("token");
  setStatus("Unpaired.", "ok");
  await render();
});

render();
