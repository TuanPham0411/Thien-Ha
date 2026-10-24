export const statuses = [
  "New",
  "Acknowledged",
  "In progress",
  "Awaiting information",
  "Resolved",
  "Closed",
];
export const priorities = ["Low", "Medium", "High", "Critical"];
export const allowedTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
export function attachmentType(file) {
  const extension = file.name?.split(".").pop().toLowerCase();
  const types = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    pdf: "application/pdf",
    txt: "text/plain",
    csv: "text/csv",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  if (allowedTypes.includes(file.type)) return file.type;
  if (
    !file.type ||
    (extension === "csv" && file.type === "application/vnd.ms-excel")
  )
    return types[extension] || "";
  return "";
}
export function validateFiles(files) {
  if (files.length > 5) return "Attach no more than 5 files.";
  for (const file of files) {
    if (!file.name || file.name.length > 180) return "Use filenames of 1–180 characters.";
    if (!allowedTypes.includes(attachmentType(file)))
      return `${file.name}: unsupported file type. Use JPG, PNG, WEBP, MP4, WEBM, MOV, PDF, TXT, CSV or XLSX.`;
    if (file.size <= 0) return `${file.name}: empty files cannot be uploaded.`;
    if (file.size > (attachmentType(file).startsWith("video/") ? 200 : 10) * 1024 * 1024)
      return `${file.name}: maximum file size is ${attachmentType(file).startsWith("video/") ? 200 : 10} MB.`;
  }
  return "";
}
export function validateEvidence(files) {
  if (!Array.isArray(files) || files.some(file => !file || typeof file.name !== "string" || !Number.isSafeInteger(file.size))) return "Add at least one photo or video.";
  return validateFiles(files) || (files.some(file => /^(image|video)\//.test(attachmentType(file))) ? "" : "Add at least one photo or video.");
}
export function validateIssue(value) {
  if (!value.departmentId) return "Select a department.";
  if (!value.process?.trim() || value.process.trim().length > 120)
    return "Enter a process or station (up to 120 characters).";

  if (
    !value.description?.trim() ||
    value.description.trim().length < 1 ||
    value.description.trim().length > 5000
  )
    return "Enter feedback (1–5,000 characters).";
  return validateOccurrences(value.occurrences || []);
}
export function validateOccurrences(items) {
  if (!Array.isArray(items) || items.length > 20) return "Add no more than 20 incident times.";
  for (const item of items) {
    if (!["point", "range"].includes(item.kind) || typeof item.start !== "string" || !Number.isFinite(Date.parse(item.start)) || new Date(item.start).getUTCFullYear() < 2000 || new Date(item.start).getUTCFullYear() > 2100) return "Choose a valid incident time.";
    if (item.kind === "range" && (typeof item.end !== "string" || !Number.isFinite(Date.parse(item.end)) || Date.parse(item.end) < Date.parse(item.start) || new Date(item.end).getUTCFullYear() > 2100)) return "The end time must be on or after the start time.";
  }
  return "";
}
export function normalizeSearch(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
}
export function filterIssues(issues, { search = "", searchField = "all", status = "All", department = "All", priority = "All", issueType = "All" } = {}) {
  const terms = normalizeSearch(search).split(" ").filter(Boolean);
  return issues.filter(issue => {
    if ((status !== "All" && issue.status !== status) || (department !== "All" && issue.departmentId !== department) || (priority !== "All" && issue.priority !== priority) || (issueType !== "All" && (issue.issueTypeId || "__unclassified") !== issueType)) return false;
    const fields = {
      ticket: [issue.id, issue.ticketNumber],
      user: [issue.reporterName, issue.reporterUsername],
      title: [issue.subject],
      type: [issue.issueTypeName || "Unclassified Chưa phân loại"],
      department: [issue.departmentName],
      content: [issue.description, issue.assessment],
    };
    const values = searchField === "all" || !Object.hasOwn(fields, searchField) ? [...Object.values(fields).flat(), issue.process, issue.teamLeaderName] : fields[searchField];
    const text = normalizeSearch(values.filter(value => value != null).join(" "));
    return terms.every(term => text.includes(term));
  });
}
export function issueFilterOptions(issues, departments = []) {
  const collect = values => [...new Map(values.filter(item => item.id).map(item => [item.id, item])).values()].sort((a,b) => a.name.localeCompare(b.name, "vi"));
  return {
    departments: collect([...issues.map(issue => ({id:issue.departmentId,name:issue.departmentName || issue.departmentId})), ...departments.map(department => ({id:department.id,name:department.name || department.id}))]),
    types: collect(issues.map(issue => ({id:issue.issueTypeId || "__unclassified",name:issue.issueTypeName || "Unclassified"}))),
  };
}
export function stats(issues) {
  const open = issues.filter((i) => !["Resolved", "Closed"].includes(i.status));
  return {
    total: issues.length,
    open: open.length,
    progress: issues.filter((i) => i.status === "In progress").length,
    resolved: issues.filter((i) => ["Resolved", "Closed"].includes(i.status))
      .length,
    critical: open.filter((i) => i.priority === "Critical").length,
  };
}
export function safeUsername(value) {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) &&
    !value.includes("..")
  );
}
export function makeDemo() {
  const now = Date.now();
  const users = [
    {
      id: "demo-1",
      username: "demo.operator",
      displayName: "Demo Operator",
      active: true,
    },
  ];
  const leaders = [
    { id: "tl-a", name: "Sample Team A", active: true },
    { id: "tl-b", name: "Sample Team B", active: true },
  ];
  const departments = [
    { id: "dep-a", name: "Sample Assembly", active: true },
    { id: "dep-b", name: "Sample Testing", active: true },
    { id: "dep-c", name: "Sample Packaging", active: true },
  ];
  const seed = [
    ["MES response delayed at station", "In progress", "High", 0, 0],
    ["Production order not displayed", "Acknowledged", "Medium", 1, 1],
    ["Incorrect quantity in report", "Resolved", "Medium", 0, 2],
    ["Scanner connection interrupted", "New", "Critical", 1, 0],
    [
      "Request a clearer validation message",
      "Awaiting information",
      "Low",
      0,
      1,
    ],
    ["Report export improvement", "Closed", "Low", 1, 2],
  ];
  const issues = seed.map(([subject, status, priority, l, d], n) => ({
    id: `DEMO-${String(n + 1).padStart(3, "0")}`,
    subject,
    status,
    priority,
    teamLeaderId: leaders[l].id,
    teamLeaderName: leaders[l].name,
    departmentId: departments[d].id,
    departmentName: departments[d].name,
    reporterUid: "demo-1",
    reporterName: "Demo Operator",
    process: `Station ${n + 1}`,
    description:
      "Sample feedback for interface preview. This is not a real production incident.",
    resolvedAt: ["Resolved", "Closed"].includes(status)
      ? now - n * 3600000
      : null,
    createdAt: now - (n + 1) * 86400000,
    updatedAt: now - n * 3600000,
    attachments: [],
    timeline: [
      {
        id: "event-" + n,
        kind: "created",
        text: "Sample feedback created",
        author: "Demo Operator",
        createdAt: now - (n + 1) * 86400000,
      },
    ],
  }));
  return { users, leaders, departments, issues };
}

export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "\'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
