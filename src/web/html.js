function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(title, body, user = null) {
  const name = user ? escapeHtml(user.username) : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Discord Verify</p>
          <h1>${escapeHtml(title)}</h1>
        </div>
        <nav>${user ? `<span>${name}</span><a href="/logout">Logout</a>` : ""}</nav>
      </header>
      ${body}
    </main>
  </body>
</html>`;
}

function loginPage() {
  return page(
    "Moderator Login",
    `<section class="panel login">
      <h2>Sign in with Discord</h2>
      <p>Moderator access is checked against your server roles.</p>
      <a class="button primary" href="/auth/discord">Continue</a>
    </section>`
  );
}

function statusBadge(status) {
  return `<span class="status ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function recordRow(record) {
  return `<tr>
    <td><code>${escapeHtml(record.discordUserId)}</code></td>
    <td>${statusBadge(record.status)}</td>
    <td><code>${escapeHtml(record.code || "")}</code></td>
    <td>${escapeHtml(record.emailDomain || "")}</td>
    <td>${escapeHtml(record.sheetRow || "")}</td>
    <td>${escapeHtml(record.updatedAt || record.createdAt || "")}</td>
    <td class="actions">
      <form method="post" action="/actions/verify">
        <input type="hidden" name="discordUserId" value="${escapeHtml(record.discordUserId)}">
        <button type="submit">Verify</button>
      </form>
      <form method="post" action="/actions/reject">
        <input type="hidden" name="discordUserId" value="${escapeHtml(record.discordUserId)}">
        <button class="danger" type="submit">Reject</button>
      </form>
    </td>
  </tr>`;
}

function dashboardPage({ user, records, message }) {
  const rows = records.map(recordRow).join("");
  const pendingCount = records.filter((record) => record.status === "pending").length;
  const verifiedCount = records.filter((record) => record.status === "verified").length;
  const rejectedCount = records.filter((record) => record.status === "rejected").length;
  const reviewCount = records.filter((record) => record.status === "needs_review").length;

  return page(
    "Moderator Dashboard",
    `${message ? `<div class="notice">${escapeHtml(message)}</div>` : ""}
    <section class="metrics">
      <div><strong>${pendingCount}</strong><span>Pending</span></div>
      <div><strong>${verifiedCount}</strong><span>Verified</span></div>
      <div><strong>${rejectedCount}</strong><span>Rejected</span></div>
      <div><strong>${reviewCount}</strong><span>Needs Review</span></div>
    </section>
    <section class="grid">
      <form class="panel" method="post" action="/actions/verify">
        <h2>Manual Verify</h2>
        <label>Discord user ID<input name="discordUserId" required></label>
        <label>Reason<input name="reason" value="Manual dashboard approval"></label>
        <button class="primary" type="submit">Verify User</button>
      </form>
      <form class="panel" method="post" action="/actions/reject">
        <h2>Reject</h2>
        <label>Discord user ID<input name="discordUserId" required></label>
        <label>Reason<input name="reason" value="Manual dashboard rejection"></label>
        <button class="danger" type="submit">Reject User</button>
      </form>
      <form class="panel compact" method="post" action="/actions/recheck">
        <h2>Sheets Check</h2>
        <p>Run the Google Sheets check now for pending users.</p>
        <button type="submit">Re-check Pending</button>
      </form>
    </section>
    <section class="panel table-panel">
      <div class="table-head">
        <h2>Verification Records</h2>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User ID</th>
              <th>Status</th>
              <th>Code</th>
              <th>Domain</th>
              <th>Sheet Row</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="7" class="empty">No records yet.</td></tr>`}</tbody>
        </table>
      </div>
    </section>`,
    user
  );
}

module.exports = {
  dashboardPage,
  loginPage
};
