let records = [];
let editingId = null;
let searchTimer = null;
let gwaDescending = false;
let currentPage = 1;
const pageSize = 10;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
}[char]));

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initAdminBadge();
  refreshRecords();
  const importFile = $("importFile");
  const studentModal = $("studentModal");
  const transcriptModal = $("transcriptModal");
  if (importFile) importFile.addEventListener("change", importWorkbook);
  if (studentModal) studentModal.addEventListener("click", (event) => {
    if (event.target === studentModal) closeStudentModal();
  });
  if (transcriptModal) transcriptModal.addEventListener("click", (event) => {
    if (event.target === transcriptModal) closeTranscriptModal();
  });
});

function initAdminBadge() {
  const badge = $("adminBadge");
  const panel = $("adminCredentials");
  const hideButton = $("hideAdminCredentials");
  const changePasswordBtn = $("changePasswordBtn");
  const passwordModal = $("passwordModal");

  if (!badge || !panel) return;

  const setCredentialsOpen = async (isOpen) => {
    panel.classList.toggle("show", isOpen);
    badge.setAttribute("aria-expanded", String(isOpen));
    if (!isOpen) return;

    $("adminUsername").textContent = "Loading...";
    $("adminPassword").textContent = "Loading...";
    try {
      const response = await fetch("/api/admin/account");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load admin account.");
      $("adminUsername").textContent = data.username;
      $("adminPassword").textContent = data.password;
    } catch (error) {
      $("adminUsername").textContent = "Unavailable";
      $("adminPassword").textContent = "Unavailable";
      showToast(error.message || "Could not load admin account.", true);
    }
  };

  badge.addEventListener("click", () => setCredentialsOpen(!panel.classList.contains("show")));

  if (hideButton) hideButton.addEventListener("click", () => setCredentialsOpen(false));
  if (changePasswordBtn) changePasswordBtn.addEventListener("click", () => {
    if (passwordModal) {
      passwordModal.classList.add("open");
      $("currentPassword").focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (passwordModal && passwordModal.classList.contains("open") && event.target === passwordModal) {
      closePasswordModal();
    }
    if (panel && !panel.contains(event.target) && !badge.contains(event.target)) {
      setCredentialsOpen(false);
    }
  });
}

function closePasswordModal() {
  const modal = $("passwordModal");
  if (modal) {
    modal.classList.remove("open");
    $("passwordForm").reset();
  }
}

async function savePassword(event) {
  event.preventDefault();
  const currentPassword = $("currentPassword").value.trim();
  const newPassword = $("newPassword").value.trim();
  const confirmPassword = $("confirmPassword").value.trim();

  if (!currentPassword || !newPassword || !confirmPassword) {
    showToast("All password fields are required.", true);
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast("The new password and confirmation do not match.", true);
    return;
  }

  try {
    const response = await fetch("/api/admin/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not update password.");
    $("adminUsername").textContent = data.username;
    $("adminPassword").textContent = data.password;
    closePasswordModal();
    showToast(data.message || "Password updated successfully.");
  } catch (error) {
    showToast(error.message, true);
  }
}

/* Option 2: Dark Mode Functions */
function initTheme() {
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = saved === "dark" || (!saved && prefersDark);
  if (isDark) {
    document.body.classList.add("dark-theme");
  } else {
    document.body.classList.remove("dark-theme");
  }
  updateThemeIcon(isDark);
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark-theme");
  localStorage.setItem("theme", isDark ? "dark" : "light");
  updateThemeIcon(isDark);
}

function updateThemeIcon(isDark) {
  const icon = $("themeIcon");
  if (icon) {
    icon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
  }
}

function setImportLoading(isLoading) {
  const label = $("importLabel");
  const input = $("importFile");
  const text = label ? label.querySelector(".import-text") : null;

  if (!label || !input || !text) return;
  label.classList.toggle("is-loading", isLoading);
  input.disabled = isLoading;
  label.setAttribute("aria-busy", String(isLoading));
  text.textContent = isLoading ? "Importing..." : "Import Excel";
}

function queryString() {
  const params = new URLSearchParams();
  const search = $("search");
  if (search && search.value) params.set("search", search.value);
  return params;
}

function resetFilters() {
  const search = $("search");
  if (search) search.value = "";
  refreshRecords();
}

async function refreshRecords() {
  const panel = document.querySelector(".table-panel");
  if (panel) panel.classList.add("loading");
  try {
    const params = queryString();
    const response = await fetch(`/api/students?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load records.");
    records = data.students || [];
    renderRecords();
    refreshDashboard();
    const count = $("recordCount");
    if (count) count.textContent = `${records.length} record${records.length === 1 ? "" : "s"} shown`;
    const status = $("filterStatus");
    if (status) status.textContent = params.toString() ? "• Filters active" : "";
  } catch (error) {
    showToast(error.message, true);
  } finally {
    if (panel) panel.classList.remove("loading");
  }
}

async function refreshDashboard() {
  try {
    const response = await fetch(`/api/dashboard?${queryString()}`);
    const data = await response.json();
    if ($("statStudents")) $("statStudents").textContent = data.total_students ?? records.length ?? 0;
    if ($("statGwa")) $("statGwa").textContent = data.average_gwa == null ? "—" : Number(data.average_gwa).toFixed(4);
    if ($("statTerms")) $("statTerms").textContent = data.active_terms ?? 0;
    const eligibleCount = records.filter((record) => String(record.remarks || "").toLowerCase().includes("dean's list eligible")).length;
    if ($("statEligible")) $("statEligible").textContent = eligibleCount;
  } catch (_) { /* The directory remains useful if dashboard fails */ }
}

function scheduleRefresh() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentPage = 1;
    refreshRecords();
  }, 220);
}

function sortByGwa() {
  gwaDescending = !gwaDescending;
  const button = document.querySelector("[onclick=\"sortByGwa()\"]");
  if (button) button.innerHTML = `<i class="fa-solid fa-arrow-down-wide-short"></i> ${gwaDescending ? "Default order" : "Highest GWA"}`;
  renderRecords();
}

/* Option 1 & 3: Render Records with Pagination and Row Action Buttons */
function renderRecords() {
  let displayRecords = gwaDescending 
    ? [...records].sort((left, right) => (right.gwa == null) - (left.gwa == null) || (Number(right.gwa ?? Infinity) - Number(left.gwa ?? Infinity))) 
    : [...records];

  const totalFiltered = displayRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const maxSubjects = Math.max(1, ...displayRecords.map(record => (record.subjects || []).length));
  const fixed = [
    ["Student Name", "name-col"], ["Academic Year", ""], ["Semester", ""],
    ["Program", ""], ["Year Level", ""], ["Section", ""]
  ];
  let first = fixed.map(([label, className]) => `<th rowspan="2" class="${className}">${label}</th>`).join("");
  first += Array.from({ length: maxSubjects }, (_, index) =>
    `<th colspan="4" class="subject-group">Subject ${index + 1}</th>`).join("");
  first += `<th rowspan="2">Total Units</th><th rowspan="2">GWA</th><th rowspan="2">Remarks</th><th rowspan="2">Actions</th>`;
  const second = Array.from({ length: maxSubjects }, () =>
    `<th>Code</th><th>Description</th><th>Units</th><th>Grade</th>`).join("");
  $("recordsHead").innerHTML = `<tr>${first}</tr><tr>${second}</tr>`;

  if (!totalFiltered) {
    $("recordsTable").style.display = "none";
    $("emptyState").style.display = "block";
    renderPagination(0, 1);
    return;
  }

  $("recordsTable").style.display = "table";
  $("emptyState").style.display = "none";

  const startIndex = (currentPage - 1) * pageSize;
  const pageRecords = displayRecords.slice(startIndex, startIndex + pageSize);

  $("recordsBody").innerHTML = pageRecords.map(record => {
    const subjectCells = [];
    for (let index = 0; index < maxSubjects; index += 1) {
      const subject = (record.subjects || [])[index];
      subjectCells.push(subject
        ? `<td class="subject-code">${escapeHtml(subject.subject_code) || "—"}</td><td>${escapeHtml(subject.subject_description) || "—"}</td><td>${Number(subject.units || 0).toFixed(2)}</td><td>${subject.grade == null ? "NO GRADE" : Number(subject.grade).toFixed(4)}</td>`
        : "<td>—</td><td>—</td><td>—</td><td>—</td>");
    }
    return `<tr>
      <td class="name-col">${escapeHtml(record.student_name)}</td>
      <td>${escapeHtml(record.academic_year) || "—"}</td><td>${escapeHtml(record.semester) || "—"}</td>
      <td>${escapeHtml(record.program) || "—"}</td><td>${escapeHtml(record.year_level) || "—"}</td><td>${escapeHtml(record.section) || "—"}</td>
      ${subjectCells.join("")}<td>${Number(record.total_units || 0).toFixed(2)}</td>
      <td class="gwa">${record.gwa == null ? "—" : Number(record.gwa).toFixed(4)}</td>
      <td class="remark">${escapeHtml(record.remarks) || "—"}</td>
      <td class="action-cell">
        <button class="icon-btn view" title="View Transcript" aria-label="View Transcript for ${escapeHtml(record.student_name)}" onclick="viewTranscript(${record.id})">
          <i class="fa-solid fa-eye"></i>
        </button>
        <button class="icon-btn edit" title="Edit Student" aria-label="Edit Student ${escapeHtml(record.student_name)}" onclick="openStudentModal(${record.id})">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button class="icon-btn delete" title="Delete Student" aria-label="Delete Student ${escapeHtml(record.student_name)}" onclick="deleteStudent(${record.id})">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </td>
    </tr>`;
  }).join("");

  renderPagination(totalFiltered, totalPages);
}

/* Option 1: Pagination Control Logic */
function renderPagination(totalFiltered, totalPages) {
  const panel = $("paginationPanel");
  if (!panel) return;
  if (totalFiltered === 0) {
    $("paginationInfo").textContent = "Showing 0 of 0 records";
    $("prevPage").disabled = true;
    $("nextPage").disabled = true;
    $("pageNumbers").innerHTML = "";
    return;
  }
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalFiltered);
  $("paginationInfo").textContent = `Showing ${start} to ${end} of ${totalFiltered} record${totalFiltered === 1 ? "" : "s"}`;
  
  $("prevPage").disabled = currentPage <= 1;
  $("nextPage").disabled = currentPage >= totalPages;

  let pageBtns = "";
  for (let i = 1; i <= totalPages; i++) {
    pageBtns += `<button class="page-number ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }
  $("pageNumbers").innerHTML = pageBtns;
}

function prevPage() {
  if (currentPage > 1) {
    currentPage--;
    renderRecords();
  }
}

function nextPage() {
  const totalPages = Math.ceil(records.length / pageSize);
  if (currentPage < totalPages) {
    currentPage++;
    renderRecords();
  }
}

function goToPage(page) {
  currentPage = page;
  renderRecords();
}

/* Option 3: View Transcript Modal Logic */
function viewTranscript(studentId) {
  const record = records.find(item => item.id === studentId);
  if (!record) return;
  $("transcriptTitle").textContent = `Academic Transcript - ${record.student_name}`;
  $("tStudentName").textContent = record.student_name || "—";
  $("tProgram").textContent = record.program || "—";
  $("tYearSection").textContent = `${record.year_level || "—"} - Section ${record.section || "—"}`;
  $("tTerm").textContent = `${record.semester || "—"}, A.Y. ${record.academic_year || "—"}`;
  $("tGwa").textContent = record.gwa == null ? "—" : Number(record.gwa).toFixed(4);
  $("tRemarks").textContent = record.remarks || "—";
  $("tUnits").textContent = Number(record.total_units || 0).toFixed(2);
  
  const tbody = $("transcriptSubjects");
  if (tbody) {
    tbody.innerHTML = (record.subjects || []).map(s => `
      <tr>
        <td style="padding:8px 10px;font-family:monospace;font-weight:600;">${escapeHtml(s.subject_code) || "—"}</td>
        <td style="padding:8px 10px;">${escapeHtml(s.subject_description) || "—"}</td>
        <td style="padding:8px 10px;text-align:center;">${Number(s.units || 0).toFixed(2)}</td>
        <td style="padding:8px 10px;text-align:center;font-weight:700;color:var(--navy);">${s.grade == null ? "NO GRADE" : Number(s.grade).toFixed(4)}</td>
        <td style="padding:8px 10px;">${escapeHtml(s.remarks) || "—"}</td>
      </tr>
    `).join("") || '<tr><td colspan="5" style="text-align:center;padding:15px;color:var(--muted);">No subjects recorded.</td></tr>';
  }
  $("transcriptModal").classList.add("open");
}

function closeTranscriptModal() {
  $("transcriptModal").classList.remove("open");
}

function openStudentModal(studentId = null) {
  editingId = studentId;
  const record = records.find(item => item.id === studentId);
  $("modalTitle").textContent = record ? "Edit student record" : "Add student record";
  $("studentForm").reset();
  $("subjectRows").innerHTML = "";
  if (record) {
    $("student_name").value = record.student_name || "";
    $("form_program").value = record.program || "";
    $("form_academic_year").value = record.academic_year || "";
    $("form_semester").value = record.semester || "";
    $("form_year_level").value = record.year_level || "";
    $("form_section").value = record.section || "";
    $("form_remarks").value = record.remarks === "Dean's List eligible" || record.remarks === "For review" || record.remarks === "Grades pending" || record.remarks === "No subjects recorded" ? "" : record.remarks || "";
    (record.subjects || []).forEach(addSubjectRow);
  }
  if (!$("subjectRows").children.length) addSubjectRow();
  $("studentModal").classList.add("open");
  $("student_name").focus();
}

function closeStudentModal() {
  $("studentModal").classList.remove("open");
  editingId = null;
}

function addSubjectRow(subject = {}) {
  const row = document.createElement("div");
  row.className = "subject-editor";
  row.innerHTML = `<input class="input subject-code-input" placeholder="e.g. IT 101" value="${escapeHtml(subject.subject_code)}">
    <input class="input subject-description-input" placeholder="Subject description" value="${escapeHtml(subject.subject_description)}">
    <input class="input subject-units-input" type="number" min="0" step="0.25" placeholder="3" value="${subject.units ?? ""}">
    <input class="input subject-grade-input" type="number" min="0" max="5" step="0.0001" placeholder="1.25" value="${subject.grade ?? ""}">
    <input class="input subject-remarks-input" placeholder="Optional" value="${escapeHtml(subject.remarks)}">
    <button type="button" class="icon-btn delete" title="Remove subject" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>`;
  $("subjectRows").appendChild(row);
}

function formSubjects() {
  return [...document.querySelectorAll(".subject-editor")].map(row => ({
    subject_code: row.querySelector(".subject-code-input").value.trim(),
    subject_description: row.querySelector(".subject-description-input").value.trim(),
    units: row.querySelector(".subject-units-input").value || 0,
    grade: row.querySelector(".subject-grade-input").value === "" ? null : row.querySelector(".subject-grade-input").value,
    remarks: row.querySelector(".subject-remarks-input").value.trim()
  })).filter(subject => subject.subject_code || subject.subject_description);
}

async function saveStudent(event) {
  event.preventDefault();
  const payload = {
    student_name: $("student_name").value.trim(),
    academic_year: $("form_academic_year").value.trim(),
    semester: $("form_semester").value,
    program: $("form_program").value.trim(),
    year_level: $("form_year_level").value.trim(),
    section: $("form_section").value.trim(),
    remarks: $("form_remarks").value.trim(),
    subjects: formSubjects()
  };
  const endpoint = editingId ? `/api/students/${editingId}` : "/api/students";
  try {
    const response = await fetch(endpoint, { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save record.");
    closeStudentModal();
    await refreshRecords();
    showToast(editingId ? "Student record updated." : "Student record added.");
  } catch (error) { showToast(error.message, true); }
}

async function deleteStudent(studentId) {
  const record = records.find(item => item.id === studentId);
  if (!record || !confirm(`Delete the academic record for ${record.student_name}?`)) return;
  try {
    const response = await fetch(`/api/students/${studentId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not delete record.");
    await refreshRecords();
    showToast("Student record deleted.");
  } catch (error) { showToast(error.message, true); }
}

async function deleteAllStudents() {
  if (!records.length) {
    showToast("There is no student data to delete.");
    return;
  }
  const confirmed = confirm("Delete all student and subject data? This action cannot be undone.");
  if (!confirmed) return;
  try {
    const response = await fetch("/api/students", { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not delete all data.");
    await refreshRecords();
    showToast(data.message || "All student data deleted.");
  } catch (error) { showToast(error.message, true); }
}

function exportRecords(format) {
  window.location.href = `/api/export/${format}?${queryString()}`;
}

function printRecords() {
  window.print();
}

async function importWorkbook(event) {
  const file = event.target.files[0];
  if (!file) return;

  setImportLoading(true);

  const academicYearField = $("academic_year");
  const semesterField = $("semester");
  const body = new FormData();
  body.append("file", file);
  body.append("academic_year", academicYearField ? academicYearField.value : "");
  body.append("semester", semesterField ? semesterField.value : "");

  try {
    const response = await fetch("/api/import", { method: "POST", body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Import failed.");
    await refreshRecords();
    showToast(data.message || "Workbook imported.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setImportLoading(false);
    event.target.value = "";
  }
}

function showToast(message, error = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 3500);
}