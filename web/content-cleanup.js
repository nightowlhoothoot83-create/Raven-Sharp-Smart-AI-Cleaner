/* Second-stage content review. Original files change only after explicit approval. */
(() => {
  const el = id => document.getElementById(id);
  const node = (tag, value, cls) => {
    const n = document.createElement(tag);
    if (value !== undefined) n.textContent = String(value ?? "");
    if (cls) n.className = cls;
    return n;
  };
  let files = new Map(), selected = new Set(), reviewed = new Set(), results = [];
  let controller = null, generation = 0;
  const checkboxes = new Map();
  function updateSelection() {
    el("review-count").textContent = selected.size + " files selected; up to 12 per content review.";
    el("content-review-btn").disabled = Boolean(controller) || selected.size < 1 || selected.size > 12 || !el("review-consent").checked;
  }
  function setFiles(records, groups) {
    const excluded = new Set(groups.filter(g => g.kind === "exact_duplicate").flatMap(g => g.files.filter(f => f.id !== g.keep_id).map(f => f.id)));
    const candidateIds = groups.flatMap(g => g.files.map(f => f.id));
    const ordered = [...new Set([...candidateIds, ...records.map(f => f.id)])];
    files = new Map(records.map(f => [f.id, f]));
    reviewed.clear(); results = []; checkboxes.clear(); el("content-results").replaceChildren();
    selected.clear();
    const list = el("content-candidates"); list.replaceChildren();
    for (const id of ordered) {
      if (excluded.has(id) || !files.has(id)) continue;
      const f = files.get(id);
      if (selected.size < 12 && !reviewed.has(id)) selected.add(id);
      const label = node("label", undefined, "review-choice");
      const check = node("input"); check.type = "checkbox"; check.checked = selected.has(id);
      checkboxes.set(id, check);
      check.addEventListener("change", () => { if (check.checked) selected.add(id); else selected.delete(id); updateSelection(); });
      label.append(check, node("span", f.name + " · " + (f.source === "internal" ? "device" : f.source) + (reviewed.has(id) ? " · reviewed" : "")));
      list.append(label);
    }
    updateSelection();
  }
  async function fileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("Could not read content preview"));
      reader.readAsDataURL(file);
    });
  }
  async function preview(id) {
    const file = Cleaner.getLocalFile(id);
    if (!file) return null;
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      if (file.size > 2 * 1024 * 1024) return null;
      return { file_id: id, media_type: "application/pdf", data: await fileBase64(file) };
    }
    if (/\.(txt|md|csv|json|log)$/i.test(file.name) || file.type.startsWith("text/")) {
      const excerpt = new File([(await file.slice(0, 16000).text()).slice(0, 4000)], "excerpt.txt", {type:"text/plain"});
      return {file_id:id, media_type:"text/plain", data:await fileBase64(excerpt)};
    }
    if (file.name.toLowerCase().endsWith(".docx") && file.size <= 2 * 1024 * 1024) {
      return {file_id:id, media_type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", data:await fileBase64(file)};
    }
    if (!file.type.startsWith("image/")) return null;
    const image = new Image();
    const url = URL.createObjectURL(file);
    try {
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("This image format cannot be previewed in your browser")); image.src = url; });
      const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      return { file_id: id, media_type: "image/jpeg", data: canvas.toDataURL("image/jpeg", .85).split(",")[1] };
    } finally { URL.revokeObjectURL(url); }
  }
  async function run() {
    if (Cleaner.isBusy() || !el("review-consent").checked || selected.size < 1 || selected.size > 12) return;
    const runGeneration = generation;
    const ids = [...selected];
    controller = new AbortController();
    const signal = controller.signal;
    Cleaner.setReviewBusy(true); updateSelection();
    el("content-review-status").textContent = "Preparing the selected content for Claude…";
    try {
      const previews = [];
      for (const id of ids) {
        if (signal.aborted) throw new DOMException("Stopped", "AbortError");
        try { const p = await preview(id); if (p) previews.push(p); }
        catch { /* The backend explicitly reports unavailable content. */ }
      }
      const result = await api("/scan/content-review", { method: "POST", signal, body: JSON.stringify({
        file_ids: ids, context: el("review-context").value.trim(), previews, approved_content_processing: true
      }) });
      if (signal.aborted || runGeneration !== generation) return;
      results.push(...result.recommendations);
      ids.forEach(id => reviewed.add(id));
      selected.clear();
      for (const [id, check] of checkboxes) {
        if (selected.size < 12 && !reviewed.has(id)) selected.add(id);
        check.checked = selected.has(id);
      }
      render(result.recommendations);
      Cleaner.renderRenames(result.recommendations.filter(r => r.suggested_name).map(r => ({...r.file,ai_suggested_name:r.suggested_name})));
      el("content-review-status").textContent = "Content review complete. Inspect the reasons, edit proposed names, then approve individual actions.";
    } catch (error) {
      if (runGeneration === generation) el("content-review-status").textContent = signal.aborted ? "Review stopped. No cleanup actions were applied." : "Review failed: " + error.message + ". No cleanup actions were applied.";
    } finally {
      if (runGeneration === generation) { controller = null; Cleaner.setReviewBusy(false); updateSelection(); }
    }
  }
  function editableRename(file, suggestion, localFile) {
    const wrap = node("div", undefined, "rename-editor");
    const label = node("label", "Filename suggestion — edit before approval");
    const input = node("input"); input.type = "text"; input.value = suggestion || ""; input.maxLength = 200;
    input.placeholder = "Enter a meaningful filename"; input.setAttribute("aria-label", "New name for " + file.name);
    const status = node("p", "", "scan-help"); status.setAttribute("role", "status");
    const canCloudRename = ["gdrive", "dropbox"].includes(file.source);
    const button = node("button", localFile ? "Approve & download renamed copy" : "Approve cloud rename", "ghost");
    button.type = "button"; button.disabled = !localFile && !canCloudRename;
    button.addEventListener("click", async () => {
      const name = input.value.trim();
      if (!name || name === "." || name === ".." || /[\\/:*?"<>|\x00-\x1f]/.test(name)) { status.textContent = "Enter a filename without paths or special characters."; return; }
      if (!confirm((localFile ? "Download a renamed copy" : "Rename the cloud original") + " from " + file.name + " to " + name + "?")) return;
      button.disabled = true;
      try {
        if (localFile) { Cleaner.download(localFile, name); status.textContent = "Renamed copy downloaded; your original is unchanged."; }
        else { await api("/files/" + encodeURIComponent(file.id) + "/rename", { method: "POST", body: JSON.stringify({new_name:name}) }); status.textContent = "Cloud provider confirmed rename."; file.name = name; }
      } catch (error) { status.textContent = "Rename was not confirmed: " + error.message; }
      finally { button.disabled = false; }
    });
    wrap.append(label, input, button, status);
    if (!localFile && !canCloudRename) wrap.append(node("p", "Use your device's file manager to rename the original, or reselect it to download a renamed copy.", "scan-help"));
    return wrap;
  }
  function render(items) {
    const list = el("content-results");
    for (const item of items) {
      const file = item.file;
      const card = node("article", undefined, "group-card");
      card.append(node("h3", file.name));
      card.append(node("p", item.action.replace(/_/g, " ") + " · " + (item.flags || []).join(", "), "kind"));
      card.append(node("p", item.reason, "reason"));
      const evidence = {claude_vision_image:"Claude Vision inspected an image preview",claude_vision_pdf:"Claude inspected PDF content and pages",claude_document_text:"Claude inspected a document excerpt (up to 4,000 characters)",unavailable:"Content unavailable — manual review"};
      card.append(node("p", evidence[item.evidence] || "Review inspection coverage", "scan-help"));
      if (item.keep_id) card.append(node("p", "Suggested related copy to keep: " + (files.get(item.keep_id)?.name || item.keep_id), "scan-help"));
      card.append(editableRename(file, item.suggested_name, Cleaner.getLocalFile(file.id)));
      if (item.action === "delete_candidate" || item.action === "archive_candidate") {
        if (item.action === "delete_candidate" && ["gdrive", "dropbox"].includes(file.source)) {
          const button = node("button", file.source === "gdrive" ? "Approve move to Drive trash" : "Approve Dropbox deletion", "danger");
          button.type = "button";
          button.addEventListener("click", async () => {
            if (!confirm("Approve " + (file.source === "gdrive" ? "moving to Drive trash" : "deleting from Dropbox") + ": " + file.name + "? Review recovery options in the provider before proceeding.")) return;
            button.disabled = true;
            try { await api("/files/" + encodeURIComponent(file.id), {method:"DELETE"}); button.textContent = "Provider confirmed cleanup"; await loadStats(); }
            catch (error) { button.disabled = false; toast("Cleanup was not confirmed: " + error.message); }
          });
          card.append(button);
        } else card.append(node("p", "Review or archive this candidate using your file manager or cloud account. No automatic archival or device deletion is performed.", "scan-help"));
      }
      list.append(card);
    }
  }
  function reset() {
    generation++; controller?.abort(); controller = null;
    files.clear(); selected.clear(); reviewed.clear(); results = [];
    el("content-candidates").replaceChildren(); el("content-results").replaceChildren();
    el("review-consent").checked = false; el("review-context").value = ""; el("content-review-status").textContent = "";
    updateSelection();
  }
  el("review-consent").addEventListener("change", updateSelection);
  el("content-review-btn").addEventListener("click", run);
  window.ContentCleanup = {setFiles, run, reset, editableRename, isBusy:()=>Boolean(controller), cancel:()=>controller?.abort(), report:()=>results};
  updateSelection();
})();
