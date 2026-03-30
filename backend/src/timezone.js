const TZ = 'Europe/Madrid';

function getFechaMadrid(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
}

function getMsDelDiaMadrid(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const h = parseInt(parts.find(p => p.type === 'hour').value);
  const m = parseInt(parts.find(p => p.type === 'minute').value);
  const s = parseInt(parts.find(p => p.type === 'second').value);
  return ((h * 60 + m) * 60 + s) * 1000;
}

function crearTimestampMadrid(fechaStr, horaStr) {
  const [h, m, s] = horaStr.split(':').map(Number);
  const targetMs = ((h * 60 + (m || 0)) * 60 + (s || 0)) * 1000;
  const approxUtcMs = Date.parse(fechaStr + 'T00:00:00Z') + targetMs - 3600000;
  let candidate = new Date(approxUtcMs);
  const actualMs = getMsDelDiaMadrid(candidate);
  const correction = targetMs - actualMs;
  if (Math.abs(correction) > 500) candidate = new Date(candidate.getTime() + correction);
  return candidate;
}

module.exports = { TZ, getFechaMadrid, getMsDelDiaMadrid, crearTimestampMadrid };
