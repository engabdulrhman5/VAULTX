const fs = require("fs");
const path = require("path");

function loadData(filePath, fallback, { strict = false } = {}) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    if (strict && !raw.trim()) throw new Error(`Empty data file: ${filePath}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    if (strict) throw error;
    return fallback;
  }
}

function saveData(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(data), "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, filePath);
    const directory = fs.openSync(path.dirname(filePath), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw error;
  }
}

module.exports = {
  loadData,
  saveData,
};
