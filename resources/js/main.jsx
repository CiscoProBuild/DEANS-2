import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../css/app.css";

const icon = (name) => <i className={`fa-solid ${name}`} aria-hidden="true" />;
const dash = (value) => value || "—";
const formatGwa = (value) => value == null ? "—" : Number(value).toFixed(4);

async function api(url, options = {}) {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(csrf ? { "X-CSRF-TOKEN": csrf } : {}),
      ...options.headers
    }
  });
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof body === "object" ? body.error || body.message : body;
    throw new Error(message || `Request failed (${response.status}).`);
  }
  return body;
}

function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    document.body.classList.toggle("dark-theme", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const navigate = (next) => {
    history.pushState({}, "", next);
    setPath(next);
  };
  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark");
  if (path === "/login") return <Login onLogin={() => navigate("/admin")} onPortal={() => navigate("/")} />;
  if (path === "/admin") return <Admin onLogout={() => navigate("/login")} onPortal={() => navigate("/")} theme={theme} toggleTheme={toggleTheme} />;
  return <Portal onLogin={() => navigate("/login")} theme={theme} toggleTheme={toggleTheme} />;
}

function Header({ theme, toggleTheme, children, brandAction }) {
  return <header className="topbar">
    {brandAction
      ? <button className="brand-mark" onClick={brandAction} aria-label="Admin portal" title="Admin portal">{icon("fa-building-columns")}</button>
      : <a className="brand-mark" href="/" aria-label="Dean's List home">{icon("fa-building-columns")}</a>}
    <div className="brand">COLLEGE OF COMPUTER STUDIES</div>
    <div className="brand-sub">DEAN LISTER</div>
    <div className="topbar-actions">
      {children}
      <button className="header-icon" onClick={toggleTheme} aria-label="Toggle dark mode" title="Toggle dark mode">
        {icon(theme === "dark" ? "fa-sun" : "fa-moon")}
      </button>
    </div>
  </header>;
}

function Login({ onLogin, onPortal }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      onLogin();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };
  return <main className="login-page">
    <section className="login-card">
      <div className="login-brand">{icon("fa-building-columns")} <span>ADMIN PORTAL</span></div>
      <p className="eyebrow center">COLLEGE OF COMPUTER STUDIES</p>
      <h1>Secure access</h1>
      <p className="muted center">Sign in to manage academic records and Dean's List eligibility.</p>
      {error && <div className="alert error">{error}</div>}
      <form className="stack-form" onSubmit={submit}>
        <label>Username<input autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required placeholder="Username" /></label>
        <label>Password<input type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required placeholder="Password" /></label>
        <button className="btn primary full" disabled={busy}>{busy ? "Signing in…" : "Enter dashboard"} {icon("fa-arrow-right")}</button>
      </form>
      <button className="text-button full" onClick={onPortal}>Return to student verification</button>
    </section>
  </main>;
}

function Portal({ onLogin, theme, toggleTheme }) {
  const [query, setQuery] = useState("");
  const [student, setStudent] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState([
    { role: "assistant", text: "Hi! I can guide you through student verification and explain what to do if you can’t find a record. What would you like help with?" }
  ]);
  const assistantLog = useRef(null);

  useEffect(() => {
    if (assistantLog.current) assistantLog.current.scrollTop = assistantLog.current.scrollHeight;
  }, [assistantMessages, assistantOpen]);

  const askAssistant = (question) => {
    const normalized = question.trim().toLowerCase();
    if (!normalized) return;
    let answer = "I can help with searching for a student, understanding verification results, or troubleshooting a missing record. Try asking one of those, or contact the registrar for record-specific support.";
    if (/(search|look up|find|verify|student id|name)/.test(normalized)) {
      answer = "Enter the student’s exact ID or full name in the verification field, then select “Verify student.” An exact ID is usually the most reliable search.";
    } else if (/(not found|no record|missing|can't find|cannot find|doesn't appear|does not appear)/.test(normalized)) {
      answer = "Check the student ID or spelling and try again. If the record still doesn’t appear, it may not be included for a recorded term yet—please contact the registrar to confirm.";
    } else if (/(gwa|grade|eligible|eligibility|dean.?s list|honor|honour|qualified)/.test(normalized)) {
      answer = "A verification result shows the recorded GWA and honor status for the matched student and term. Eligibility is based on the academic record on file; contact the registrar if you need the applicable criteria or a review.";
    } else if (/(privacy|private|data|secure|external|ai)/.test(normalized)) {
      answer = "This helper uses predefined guidance in your browser; it does not send your chat messages to an external AI service. Student verification itself still uses this system’s existing server.";
    } else if (/(hello|hi|hey)/.test(normalized)) {
      answer = "Hello! I can explain how to search, what verification results mean, and what to do if a student record is missing.";
    }
    setAssistantMessages((messages) => [...messages, { role: "user", text: question.trim() }, { role: "assistant", text: answer }]);
    setAssistantInput("");
  };

  const submit = async (event) => {
    event.preventDefault();
    setStudent(null);
    setError("");
    if (!query.trim()) return setError("Enter a student ID or full name.");
    setBusy(true);
    try {
      setStudent(await api(`/api/verify?search=${encodeURIComponent(query.trim())}`));
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };
  return <>
    <Header theme={theme} toggleTheme={toggleTheme} brandAction={onLogin} />
    <main className="portal-main">
      <div className="portal-card">
        <span className="pill">{icon("fa-award")} STUDENT VERIFICATION</span>
        <p className="eyebrow">COLLEGE OF COMPUTER STUDIES</p>
        <h1>Dean's List<br /><span>Verification Portal</span></h1>
        <p className="muted portal-copy">Check whether a student appears on the Dean's List for a recorded academic term.</p>
        <form className="search-form" onSubmit={submit}>
          <label className="search-input">{icon("fa-magnifying-glass")}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Enter student ID or full name" aria-label="Student ID or full name" /></label>
          <button className="btn primary" disabled={busy}>{busy ? "Searching…" : "Verify student"}</button>
        </form>
        {error && <div className="alert error">{error}</div>}
        {student && <section className="verified-card">
          <div className="verified-heading"><span className="verified-check">{icon("fa-check")}</span><div><strong>Verified Dean Lister</strong><small>Record confirmed in the academic database</small></div></div>
          <h2>{student.student_name}</h2>
          <div className="portal-facts">
            <Fact label="Program" value={student.program} />
            <Fact label="GWA" value={formatGwa(student.gwa)} />
            <Fact label="Honor status" value={student.remarks} />
            <Fact label="Academic term" value={[student.semester, student.academic_year].filter(Boolean).join(", ")} />
          </div>
        </section>}
        {!student && !error && <div className="portal-ready">{icon("fa-file-circle-check")} <span>Search by exact student ID or a student name.</span></div>}
      </div>
      <div className="assistant-widget">
        {assistantOpen && <section className="assistant-panel" aria-label="AI portal assistant">
          <div className="assistant-heading">
            <span className="assistant-avatar">{icon("fa-user-graduate")}</span>
            <div><strong>BSIT student assistant</strong><small>Guided help · no external AI</small></div>
            <button className="icon-button assistant-close" onClick={() => setAssistantOpen(false)} aria-label="Close assistant">{icon("fa-xmark")}</button>
          </div>
          <div className="assistant-messages" ref={assistantLog} role="log" aria-live="polite" aria-relevant="additions">
            {assistantMessages.map((message, index) => <p className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}>{message.text}</p>)}
          </div>
          <div className="assistant-suggestions" aria-label="Suggested questions">
            <button onClick={() => askAssistant("How do I search for a student?")}>How do I search?</button>
            <button onClick={() => askAssistant("What if no record is found?")}>No record found</button>
            <button onClick={() => askAssistant("What does the GWA and status mean?")}>Explain results</button>
          </div>
          <form className="assistant-form" onSubmit={(event) => { event.preventDefault(); askAssistant(assistantInput); }}>
            <input aria-label="Ask the portal assistant" value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Ask a question…" />
            <button className="btn primary" aria-label="Send question" disabled={!assistantInput.trim()}>{icon("fa-paper-plane")}</button>
          </form>
        </section>}
        <button className="assistant-toggle" aria-label={assistantOpen ? "Close BSIT student assistant" : "Open BSIT student assistant"} aria-expanded={assistantOpen} onClick={() => setAssistantOpen((open) => !open)}>
          <StudentMascot />
          <span className="assistant-character-label">BSIT Student</span>
          {assistantOpen && <span className="assistant-character-close" aria-hidden="true">{icon("fa-xmark")}</span>}
        </button>
      </div>
    </main>
  </>;
}

function Fact({ label, value }) {
  return <div className="fact"><span>{label}</span><strong>{dash(value)}</strong></div>;
}

function StudentMascot() {
  return <svg className="student-mascot" viewBox="0 0 96 96" aria-hidden="true">
    <defs>
      <linearGradient id="mascot-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#1b4058" />
        <stop offset="1" stopColor="#0b1d2d" />
      </linearGradient>
      <linearGradient id="mascot-coat" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f4ce59" />
        <stop offset="1" stopColor="#c38a16" />
      </linearGradient>
    </defs>
    <circle cx="48" cy="48" r="44" fill="url(#mascot-bg)" stroke="#f0ca57" strokeWidth="2.5" />
    <circle cx="48" cy="48" r="40" fill="none" stroke="#ffffff" strokeOpacity=".12" />
    <path d="M14 84c2-13 13-21 34-21s32 8 34 21a39 39 0 0 1-68 0z" fill="url(#mascot-coat)" stroke="#ffe18a" strokeWidth="1.5" />
    <path d="m36 63 12 14 12-14-5-5H41z" fill="#fff8e5" />
    <path d="m44 75 4 3 4-3 4 11H40z" fill="#173650" />
    <path d="M43 54h10v12l-5 5-5-5z" fill="#d99b62" />
    <path d="M29 38c0-14 8-22 19-22s19 8 19 22v11c0 12-8 20-19 20s-19-8-19-20z" fill="#f4c18d" stroke="#a96d4c" strokeWidth="1" />
    <path d="M29 45c-5-17 2-30 18-31 13-1 22 8 20 25l-5-7-4-8c-6 7-16 10-29 9z" fill="#1c2b3d" />
    <path d="M31 37c1-10 7-17 17-17 9 0 15 6 17 15-5-2-8-6-10-10-7 6-14 9-24 9z" fill="#304a60" />
    <path d="M35 44c2-3 7-3 9 0m8 0c2-3 7-3 9 0" fill="none" stroke="#704631" strokeWidth="1.8" strokeLinecap="round" />
    <ellipse cx="40" cy="49" rx="4" ry="5" fill="#fff" />
    <ellipse cx="56" cy="49" rx="4" ry="5" fill="#fff" />
    <circle cx="41" cy="50" r="2.3" fill="#283b4d" />
    <circle cx="55" cy="50" r="2.3" fill="#283b4d" />
    <circle cx="41.7" cy="49.2" r=".8" fill="#fff" />
    <circle cx="55.7" cy="49.2" r=".8" fill="#fff" />
    <ellipse cx="34" cy="56" rx="3.5" ry="2" fill="#ee8f7b" opacity=".55" />
    <ellipse cx="62" cy="56" rx="3.5" ry="2" fill="#ee8f7b" opacity=".55" />
    <path d="M43 59c3 4 8 4 11 0" fill="none" stroke="#a64f48" strokeWidth="2" strokeLinecap="round" />
    <path d="m21 25 27-13 27 13-27 13z" fill="#f5d66f" stroke="#fff0b7" strokeWidth="1.5" />
    <path d="M33 31v6c8 7 22 7 30 0v-6l-15 7z" fill="#e6bb39" />
    <path d="M74 25v15" stroke="#f5d66f" strokeWidth="2" />
    <circle cx="74" cy="42" r="2.5" fill="#f5d66f" />
    <path d="m71 45h6l-3 7z" fill="#f5d66f" />
    <rect x="61" y="71" width="13" height="9" rx="2.5" fill="#173650" stroke="#ffe18a" strokeWidth="1" />
    <text x="67.5" y="77" textAnchor="middle" fontSize="5.5" fontWeight="800" fill="#ffe18a">IT</text>
  </svg>;
}

function Admin({ onLogout, onPortal, theme, toggleTheme }) {
  const [authenticated, setAuthenticated] = useState(null);
  const [students, setStudents] = useState([]);
  const [stats, setStats] = useState({ total_students: 0, average_gwa: null, active_terms: 0 });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [descending, setDescending] = useState(false);
  const [editor, setEditor] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [account, setAccount] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const pageSize = 10;

  const notify = useCallback((message, isError = false) => {
    setToast({ message, isError });
    window.setTimeout(() => setToast(null), 3500);
  }, []);
  const refresh = useCallback(async () => {
    const [result, dashboard] = await Promise.all([
      api(`/api/students?search=${encodeURIComponent(search)}`),
      api(`/api/dashboard?search=${encodeURIComponent(search)}`)
    ]);
    setStudents(result.students);
    setStats(dashboard);
  }, [search, refreshKey]);

  useEffect(() => {
    api("/api/session").then((data) => setAuthenticated(data.authenticated)).catch(() => setAuthenticated(false));
  }, []);
  useEffect(() => {
    if (authenticated === false) onLogout();
  }, [authenticated, onLogout]);
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      refresh().catch((error) => { if (!cancelled) notify(error.message, true); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [authenticated, refresh, notify]);

  const displayStudents = useMemo(() => {
    const result = descending ? [...students].sort((a, b) => (a.gwa == null) - (b.gwa == null) || (a.gwa ?? Infinity) - (b.gwa ?? Infinity)) : students;
    return result;
  }, [students, descending]);
  const pageCount = Math.max(1, Math.ceil(displayStudents.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleStudents = displayStudents.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const eligibleCount = students.filter((student) => student.remarks.toLowerCase().includes("dean's list eligible")).length;

  const loadAccount = async () => {
    setAccountOpen((open) => !open);
    if (!account) {
      try { setAccount(await api("/api/admin/account")); }
      catch (error) { notify(error.message, true); }
    }
  };
  const deleteStudent = async (student) => {
    if (!window.confirm(`Delete the record for ${student.student_name}?`)) return;
    try {
      await api(`/api/students/${student.id}`, { method: "DELETE" });
      notify("Student record deleted.");
      setRefreshKey((key) => key + 1);
    } catch (error) { notify(error.message, true); }
  };
  const deleteAll = async () => {
    if (!window.confirm("Delete all students and subject records? This cannot be undone.")) return;
    try {
      const result = await api("/api/students", { method: "DELETE" });
      notify(result.message);
      setPage(1);
      setRefreshKey((key) => key + 1);
    } catch (error) { notify(error.message, true); }
  };
  const importFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api("/api/import", { method: "POST", body });
      notify(result.message);
      setPage(1);
      setRefreshKey((key) => key + 1);
    } catch (error) { notify(error.message, true); }
    finally { setBusy(false); event.target.value = ""; }
  };
  const exportRecords = (type) => {
    window.location.href = `/api/export/${type}?search=${encodeURIComponent(search)}`;
  };
  const logout = async () => {
    try { await api("/logout", { method: "POST" }); } finally { onLogout(); }
  };

  if (authenticated === null) return <div className="loading-screen"><span className="spinner" />Checking administrator session…</div>;

  return <>
    <Header theme={theme} toggleTheme={toggleTheme}>
      <div className="account-wrap">
        <button className="header-link" onClick={loadAccount} aria-expanded={accountOpen}>{icon("fa-shield-halved")} Administrator {icon("fa-chevron-down")}</button>
        {accountOpen && <div className="account-menu">
          <strong>Admin account</strong>
          <Fact label="Username" value={account?.username || "Loading…"} />
          <Fact label="Password" value="••••••••" />
          <button className="btn soft full" onClick={() => setPasswordOpen(true)}>Change password</button>
        </div>}
      </div>
      <button className="header-link signout-link" onClick={logout}>Sign out</button>
    </Header>
    <main className="dashboard">
      <section className="intro">
        <div><p className="eyebrow">DEAN LISTER · CALAPAN CITY CAMPUS</p><h1>Academic records</h1><p className="muted">Manage student records, review eligibility, and prepare official reports.</p></div>
        <div className="toolbar">
          <label className={`btn soft file-button ${busy ? "disabled" : ""}`}>{icon(busy ? "fa-spinner fa-spin" : "fa-file-import")} {busy ? "Importing…" : "Import Excel"}<input type="file" accept=".xlsx,.xls" onChange={importFile} disabled={busy} /></label>
          <a className="btn soft" href="/download-academic-template">{icon("fa-download")} Template</a>
          <button className="btn soft" onClick={() => window.print()}>{icon("fa-print")} Print</button>
          <button className="btn soft" onClick={() => exportRecords("pdf")}>{icon("fa-file-pdf")} PDF</button>
          <button className="btn gold" onClick={() => exportRecords("excel")}>{icon("fa-file-excel")} Excel</button>
          <button className="btn primary" onClick={() => setEditor({})}>{icon("fa-plus")} Add student</button>
        </div>
      </section>

      <section className="stats-grid">
        <Stat iconName="fa-users" label="Total students" value={stats.total_students} />
        <Stat iconName="fa-award" label="Dean's List" value={eligibleCount} />
        <Stat iconName="fa-chart-line" label="Average GWA" value={formatGwa(stats.average_gwa)} />
        <Stat iconName="fa-calendar-days" label="Active terms" value={stats.active_terms} />
      </section>

      <section className="panel filter-panel">
        <div className="section-heading"><div><span className="heading-icon">{icon("fa-sliders")}</span><h2>Find student records</h2></div><span className="muted">{students.length} result{students.length === 1 ? "" : "s"}</span></div>
        <div className="search-control">{icon("fa-magnifying-glass")}<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search by name, program, section, or subject" aria-label="Search student records" />{search && <button className="icon-button" onClick={() => setSearch("")} aria-label="Clear search">{icon("fa-xmark")}</button>}</div>
      </section>

      <section className="panel records-panel">
        <div className="records-heading">
          <div><p className="eyebrow">REGISTRAR DIRECTORY</p><h2>Student academic records</h2><span className="muted">Ordered by year level, section, and GWA</span></div>
          <div className="toolbar">
            <button className="btn soft small" onClick={() => setDescending((value) => !value)}>{icon("fa-arrow-down-wide-short")} {descending ? "Default order" : "Highest GWA"}</button>
            <button className="btn soft small" onClick={() => setRefreshKey((key) => key + 1)}>{icon("fa-arrows-rotate")} Refresh</button>
            <button className="btn danger small" onClick={deleteAll}>{icon("fa-trash-can")} Delete all data</button>
          </div>
        </div>
        {visibleStudents.length ? <div className="table-wrap">
          <table className="records-table">
            <thead><tr><th>Student</th><th>Academic term</th><th>Program / section</th><th>Subjects</th><th>Total units</th><th>GWA</th><th>Remarks</th><th>Actions</th></tr></thead>
            <tbody>{visibleStudents.map((student) => <tr key={student.id}>
              <td className="student-cell"><strong>{student.student_name}</strong><small>{student.year_level || "Year level unspecified"}</small></td>
              <td>{student.semester || "—"}<small>{student.academic_year || "—"}</small></td>
              <td>{student.program || "—"}<small>Section {student.section || "—"}</small></td>
              <td><span className="subject-count">{student.subjects.length} subject{student.subjects.length === 1 ? "" : "s"}</span>{student.subjects.slice(0, 2).map((subject) => <small key={subject.id}>{subject.subject_code || "—"} · {subject.grade == null ? "NO GRADE" : Number(subject.grade).toFixed(2)}</small>)}{student.subjects.length > 2 && <small>+{student.subjects.length - 2} more</small>}</td>
              <td>{Number(student.total_units || 0).toFixed(2)}</td>
              <td className="gwa-cell">{formatGwa(student.gwa)}</td>
              <td><span className={`status ${student.remarks === "Dean's List eligible" ? "eligible" : student.remarks.includes("GRADE") ? "pending" : "review"}`}>{student.remarks}</span></td>
              <td><div className="row-actions">
                <button className="icon-button" title="View transcript" aria-label={`View transcript for ${student.student_name}`} onClick={() => setTranscript(student)}>{icon("fa-eye")}</button>
                <button className="icon-button" title="Edit record" aria-label={`Edit ${student.student_name}`} onClick={() => setEditor(student)}>{icon("fa-pen-to-square")}</button>
                <button className="icon-button delete-icon" title="Delete record" aria-label={`Delete ${student.student_name}`} onClick={() => deleteStudent(student)}>{icon("fa-trash-can")}</button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </div> : <div className="empty-state">{icon("fa-folder-open")}<h3>No academic records found</h3><p>Add a student record or import an Excel workbook to begin.</p><button className="btn primary" onClick={() => setEditor({})}>{icon("fa-plus")} Add student</button></div>}
        <div className="pagination">
          <span>Showing {students.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, displayStudents.length)} of {displayStudents.length} records</span>
          <div className="pagination-controls">
            <button className="btn soft small" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
            <span className="page-label">Page {currentPage} of {pageCount}</span>
            <button className="btn soft small" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</button>
          </div>
        </div>
      </section>
    </main>
    {editor && <StudentEditor student={editor} onClose={() => setEditor(null)} onSaved={(message) => { setEditor(null); notify(message); setRefreshKey((key) => key + 1); }} onError={(message) => notify(message, true)} />}
    {transcript && <Transcript student={transcript} onClose={() => setTranscript(null)} />}
    {passwordOpen && <PasswordDialog onClose={() => setPasswordOpen(false)} onChanged={(result) => { setPasswordOpen(false); setAccount(result); notify(result.message); }} onError={(message) => notify(message, true)} />}
    {toast && <div className={`toast ${toast.isError ? "toast-error" : ""}`}>{icon(toast.isError ? "fa-circle-exclamation" : "fa-circle-check")} {toast.message}</div>}
  </>;
}

function Stat({ iconName, label, value }) {
  return <article className="stat-card"><span className="stat-icon">{icon(iconName)}</span><div><span className="stat-value">{value ?? "—"}</span><span className="stat-label">{label}</span></div></article>;
}

function StudentEditor({ student, onClose, onSaved, onError }) {
  const editing = Boolean(student.id);
  const [form, setForm] = useState({
    student_name: student.student_name || "",
    academic_year: student.academic_year || "",
    semester: student.semester || "",
    program: student.program || "",
    year_level: student.year_level || "",
    section: student.section || "",
    remarks: ["Dean's List eligible", "For review", "Grades pending", "No subjects recorded"].includes(student.remarks) ? "" : student.remarks || "",
    subjects: student.subjects?.map((subject) => ({ ...subject })) || []
  });
  const [busy, setBusy] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateSubject = (index, key, value) => update("subjects", form.subjects.map((subject, current) => current === index ? { ...subject, [key]: value } : subject));
  const addSubject = () => update("subjects", [...form.subjects, { subject_code: "", subject_description: "", units: 3, grade: "", remarks: "" }]);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    const payload = {
      ...form,
      subjects: form.subjects.map((subject) => ({
        ...subject,
        units: Number(subject.units) || 0,
        grade: subject.grade === "" || subject.grade == null ? null : Number(subject.grade)
      }))
    };
    try {
      await api(editing ? `/api/students/${student.id}` : "/api/students", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      onSaved(editing ? "Student record updated." : "Student record added.");
    } catch (error) { onError(error.message); }
    finally { setBusy(false); }
  };
  return <Modal title={editing ? "Edit student record" : "Add student record"} onClose={onClose} wide>
    <form onSubmit={submit}>
      <div className="modal-body">
        <div className="form-grid">
          <Field label="Student name *" wide><input required value={form.student_name} onChange={(event) => update("student_name", event.target.value)} placeholder="e.g. Juan Dela Cruz" /></Field>
          <Field label="Program"><input value={form.program} onChange={(event) => update("program", event.target.value)} /></Field>
          <Field label="Academic year"><input value={form.academic_year} onChange={(event) => update("academic_year", event.target.value)} placeholder="2025-2026" /></Field>
          <Field label="Semester"><input value={form.semester} onChange={(event) => update("semester", event.target.value)} placeholder="1st Semester" /></Field>
          <Field label="Year level"><input value={form.year_level} onChange={(event) => update("year_level", event.target.value)} /></Field>
          <Field label="Section"><input value={form.section} onChange={(event) => update("section", event.target.value)} /></Field>
          <Field label="Notes" wide><textarea value={form.remarks} onChange={(event) => update("remarks", event.target.value)} rows="2" placeholder="Optional registrar notes" /></Field>
        </div>
        <div className="subject-editor-head"><div><h3>Subjects and grades</h3><p className="muted">GWA is calculated automatically from graded subject units.</p></div><button type="button" className="btn soft small" onClick={addSubject}>{icon("fa-plus")} Add subject</button></div>
        <div className="subject-editor">
          <div className="subject-row subject-label"><span>Code</span><span>Description</span><span>Units</span><span>Grade</span><span>Notes</span><span /></div>
          {form.subjects.map((subject, index) => <div className="subject-row" key={index}>
            <input aria-label="Subject code" value={subject.subject_code || ""} onChange={(event) => updateSubject(index, "subject_code", event.target.value)} placeholder="ITC 121" />
            <input aria-label="Subject description" value={subject.subject_description || ""} onChange={(event) => updateSubject(index, "subject_description", event.target.value)} placeholder="Subject name" />
            <input aria-label="Units" type="number" min="0" step="0.25" value={subject.units ?? 0} onChange={(event) => updateSubject(index, "units", event.target.value)} />
            <input aria-label="Grade" type="number" min="0" step="0.01" value={subject.grade ?? ""} onChange={(event) => updateSubject(index, "grade", event.target.value)} placeholder="—" />
            <input aria-label="Subject notes" value={subject.remarks || ""} onChange={(event) => updateSubject(index, "remarks", event.target.value)} />
            <button type="button" className="icon-button delete-icon" aria-label="Remove subject" onClick={() => update("subjects", form.subjects.filter((_, current) => current !== index))}>{icon("fa-xmark")}</button>
          </div>)}
          {!form.subjects.length && <p className="empty-subjects">No subjects added to this record.</p>}
        </div>
      </div>
      <div className="modal-footer"><button className="btn soft" type="button" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save record"}</button></div>
    </form>
  </Modal>;
}

function Field({ label, wide, children }) {
  return <label className={`field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</label>;
}

function Transcript({ student, onClose }) {
  return <Modal title={`Academic transcript · ${student.student_name}`} onClose={onClose} wide>
    <div className="modal-body transcript-body">
      <div className="transcript-facts">
        <Fact label="Student name" value={student.student_name} /><Fact label="Program" value={student.program} />
        <Fact label="Year / section" value={`${student.year_level || "—"} · ${student.section || "—"}`} />
        <Fact label="Academic term" value={`${student.semester || "—"}, A.Y. ${student.academic_year || "—"}`} />
        <Fact label="Total units" value={Number(student.total_units || 0).toFixed(2)} /><Fact label="GWA" value={formatGwa(student.gwa)} />
        <Fact label="Remarks" value={student.remarks} />
      </div>
      <div className="table-wrap transcript-table-wrap"><table className="records-table"><thead><tr><th>Code</th><th>Subject</th><th>Units</th><th>Grade</th><th>Remarks</th></tr></thead>
        <tbody>{student.subjects.map((subject) => <tr key={subject.id}><td>{subject.subject_code || "—"}</td><td>{subject.subject_description || "—"}</td><td>{Number(subject.units || 0).toFixed(2)}</td><td>{subject.grade == null ? "NO GRADE" : Number(subject.grade).toFixed(4)}</td><td>{subject.remarks || "—"}</td></tr>)}
          {!student.subjects.length && <tr><td colSpan="5">No subjects recorded.</td></tr>}</tbody>
      </table></div>
    </div>
    <div className="modal-footer"><button className="btn soft" onClick={() => window.print()}>{icon("fa-print")} Print transcript</button><button className="btn primary" onClick={onClose}>Close</button></div>
  </Modal>;
}

function PasswordDialog({ onClose, onChanged, onError }) {
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const submit = async (event) => {
    event.preventDefault();
    try {
      onChanged(await api("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      }));
    } catch (error) { onError(error.message); }
  };
  return <Modal title="Change administrator password" onClose={onClose}>
    <form onSubmit={submit}>
      <div className="modal-body stack-form">
        <Field label="Current password"><input required type="password" value={form.current_password} onChange={(event) => setForm({ ...form, current_password: event.target.value })} /></Field>
        <Field label="New password"><input required type="password" value={form.new_password} onChange={(event) => setForm({ ...form, new_password: event.target.value })} /></Field>
        <Field label="Confirm new password"><input required type="password" value={form.confirm_password} onChange={(event) => setForm({ ...form, confirm_password: event.target.value })} /></Field>
      </div>
      <div className="modal-footer"><button className="btn soft" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="submit">Update password</button></div>
    </form>
  </Modal>;
}

function Modal({ title, onClose, wide, children }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-header"><div><p className="eyebrow">DEAN LISTER</p><h2>{title}</h2></div><button className="icon-button close-button" onClick={onClose} aria-label="Close dialog">{icon("fa-xmark")}</button></header>
      {children}
    </section>
  </div>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
