function emailDomain(email) {
  const parts = String(email || "").trim().toLowerCase().split("@");
  if (parts.length !== 2) return "";
  return parts[1];
}

function domainAllowed(domain, allowedDomains) {
  return allowedDomains.some((allowed) => {
    if (allowed.startsWith("*.")) {
      const root = allowed.slice(2);
      return domain.endsWith(`.${root}`);
    }
    return domain === allowed;
  });
}

class SheetsService {
  constructor(config) {
    this.config = config;
    const { google } = require("googleapis");
    this.auth = new google.auth.JWT({
      email: config.serviceAccountEmail,
      key: config.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });
    this.sheets = google.sheets({ version: "v4", auth: this.auth });
  }

  async getRows() {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.config.sheetId,
      range: this.config.range
    });

    const values = response.data.values || [];
    if (values.length === 0) {
      return { headers: [], rows: [] };
    }

    const headers = values[0].map((header) => String(header || "").trim());
    const rows = values.slice(1).map((cells, index) => {
      const row = {};
      headers.forEach((header, cellIndex) => {
        row[header] = cells[cellIndex] || "";
      });
      return {
        rowNumber: index + 2,
        row
      };
    });

    return { headers, rows };
  }

  async findSubmissionByCode(code, discordUserId, allowedDomains) {
    const { headers, rows } = await this.getRows();
    const missingHeaders = [this.config.codeHeader, this.config.emailHeader, this.config.discordIdHeader].filter(
      (header) => !headers.includes(header)
    );

    if (missingHeaders.length) {
      throw new Error(`Google Sheet is missing headers: ${missingHeaders.join(", ")}`);
    }

    const match = rows.find(({ row }) => {
      return String(row[this.config.codeHeader]).trim().toLowerCase() === String(code).toLowerCase();
    });
    if (!match) {
      return { found: false };
    }

    const email = String(match.row[this.config.emailHeader] || "").trim();
    const domain = emailDomain(email);
    const submittedDiscordUserId = String(match.row[this.config.discordIdHeader] || "").trim();
    const discordIdMatches = submittedDiscordUserId === String(discordUserId);

    return {
      found: true,
      rowNumber: match.rowNumber,
      domain,
      submittedDiscordUserId,
      discordIdMatches,
      allowed: domainAllowed(domain, allowedDomains)
    };
  }
}

module.exports = {
  SheetsService,
  domainAllowed,
  emailDomain
};
