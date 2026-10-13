#!/usr/bin/env node
// Builds the public quiz data from the private quiz-content repo.
//
//   node build-quizzes.mjs <contentDir> <outDir>
//
// <contentDir>/days/*.json are Doc Studio documents (one per day, settings.day or "day-003.json").
// Only what is due right now is written to <outDir>: the quiz version from quizTime, the version
// with answers from answersTime. Set QUIZ_NOW (any date string) to pretend it is another time.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [contentDir = '_content', outDir = '_site/quizes'] = process.argv.slice(2);
const now = process.env.QUIZ_NOW ? new Date(process.env.QUIZ_NOW) : new Date();
if (isNaN(now)) throw new Error(`Bad QUIZ_NOW: ${process.env.QUIZ_NOW}`);

const DEFAULTS = {
  anchorDay: 3,              // this day number…
  anchorDate: '2026-10-14',  // …is on this date; other days follow on weekdays (Mon–Fri)
  quizTime: '07:00',
  answersTime: '08:00',
  utcOffset: '+05:30',
  questionsPerDay: 15,
};
const schedFile = path.join(contentDir, 'schedule.json');
const S = { ...DEFAULTS, ...(fs.existsSync(schedFile) ? JSON.parse(fs.readFileSync(schedFile, 'utf8')) : {}) };

/* ---------- calendar ---------- */
const isWeekday = d => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
function dayDate(n) {
  const d = new Date(S.anchorDate + 'T00:00:00Z');
  if (!isWeekday(d)) throw new Error(`anchorDate ${S.anchorDate} is a weekend`);
  let k = n - S.anchorDay;
  const step = Math.sign(k);
  while (k !== 0) {
    d.setUTCDate(d.getUTCDate() + step);
    if (isWeekday(d)) k -= step;
  }
  return d.toISOString().slice(0, 10);
}
const at = (date, time) => new Date(`${date}T${time}:00${S.utcOffset}`);
const quizAt = n => at(dayDate(n), S.quizTime);
const answersAt = n => at(dayDate(n), S.answersTime);

/* ---------- read documents ---------- */
const daysDir = path.join(contentDir, 'days');
const files = fs.existsSync(daysDir)
  ? fs.readdirSync(daysDir, { recursive: true }).filter(f => /\.json$/i.test(f)).sort()
  : [];
if (!fs.existsSync(contentDir)) console.warn(`No content folder (${contentDir}) — publishing an empty quiz list.`);

const docs = new Map();
for (const f of files) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(path.join(daysDir, f), 'utf8')); }
  catch (e) { console.warn(`skip ${f}: not valid JSON`); continue; }
  if (!doc || !Array.isArray(doc.blocks)) { console.warn(`skip ${f}: not a Doc Studio document`); continue; }
  const m = path.basename(f).match(/day[\s_-]*0*(\d+)/i);
  const day = parseInt(doc.settings?.day) || (m && +m[1]);
  if (!day) { console.warn(`skip ${f}: no day number (set "Day no." in Doc Studio or name it day-003.json)`); continue; }
  if (docs.has(day)) console.warn(`day ${day}: ${f} replaces ${docs.get(day).file}`);
  docs.set(day, { file: f, doc });
}

/* ---------- transform ---------- */
const plain = h => String(h || '').replace(/<(img|span class="math")[^>]*>/gi, 'x').replace(/<[^>]+>|&nbsp;|\s/g, '');
const clean = h => String(h || '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  .replace(/(href|src)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"')
  .replace(/\s+contenteditable="[^"]*"/gi, '');

const sha = (buf, n = 12) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, n);
const written = new Set();
function writeOnce(rel, buf) {
  if (written.has(rel)) return;
  const p = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  written.add(rel);
}
// embedded pictures become separate files, so each one downloads once and is cached
function extractImages(h) {
  return h.replace(/src="data:image\/(png|jpe?g|webp|gif);base64,([^"]+)"/gi, (_, ext, b64) => {
    const buf = Buffer.from(b64, 'base64');
    const rel = `img/${sha(buf)}.${ext.toLowerCase() === 'jpeg' ? 'jpg' : ext.toLowerCase()}`;
    writeOnce(rel, buf);
    return `src="${rel}"`;
  });
}
const fix = h => extractImages(clean(h));

function variant(doc, withAnswers) {
  const st = doc.settings || {};
  let n = parseInt(st.startQ); if (isNaN(n)) n = 1;
  const pad = +st.qPad || 1;
  let from = null, to = null;
  const blocks = [];
  for (const b of doc.blocks) {
    if (b.type === 'pagebreak') { blocks.push({ type: 'pagebreak' }); continue; } // used when printing
    if (b.vis === (withAnswers ? 'student' : 'teacher')) continue;
    if (b.type === 'answer' && (!withAnswers || !plain(b.html))) continue;
    const o = { type: b.type };
    for (const k of ['style', 'color', 'cols', 'url', 'thick', 'cont']) if (b[k] != null && b[k] !== '') o[k] = b[k];
    if (b.type === 'sep' && b.style) o.lstyle = b.style;
    if (b.html != null) o.html = fix(b.html);
    if (b.type === 'question' && !b.cont) {
      if (b.num != null && b.num !== '') n = parseInt(b.num);
      o.n = String(n).padStart(pad, '0');
      from ??= n; to = n; n++;
    }
    if (b.type === 'mcq') {
      o.opts = (b.opts || []).map(fix);
      if (b.src) o.src = fix(b.src);
      if (withAnswers && b.correct != null && b.correct !== '') o.correct = +b.correct;
    }
    if (b.type === 'sim') { o.title = fix(b.title); o.desc = fix(b.desc); }
    blocks.push(o);
  }
  const settings = {};
  for (const k of ['title', 'headerLeft', 'headerRight', 'footerLeft', 'font', 'fontSize', 'accent', 'qBold', 'startPage']) if (st[k] != null) settings[k] = st[k];
  return { data: { settings, answers: withAnswers, blocks }, from, to };
}

function writeVariant(day, doc, withAnswers) {
  const v = variant(doc, withAnswers);
  const body = JSON.stringify(v.data);
  const rel = `data/day-${String(day).padStart(3, '0')}-${withAnswers ? 'answers' : 'quiz'}-${sha(body, 10)}.json`;
  writeOnce(rel, body);
  return { rel, from: v.from, to: v.to };
}

/* ---------- release what is due ---------- */
const days = [];
for (const [day, { file, doc }] of [...docs].sort((a, b) => b[0] - a[0])) {
  if (quizAt(day) > now) { console.log(`day ${day}: waiting until ${quizAt(day).toISOString()} (${file})`); continue; }
  const q = writeVariant(day, doc, false);
  const full = answersAt(day) <= now ? writeVariant(day, doc, true) : null;
  console.log(`day ${day}: quiz released${full ? ' + answers released' : ''} (${file})`);
  days.push({
    day,
    date: dayDate(day),
    title: doc.settings?.title || '',
    from: q.from, to: q.to,
    quizAt: quizAt(day).toISOString(),
    answersAt: answersAt(day).toISOString(),
    quiz: q.rel,
    answers: full ? full.rel : null,
  });
}

// the next scheduled release, so the page can count down to it
let next = 1;
while (quizAt(next) <= now) next++;

const fingerprint = sha(JSON.stringify(days.map(d => [d.day, d.quiz, d.answers, d.title, d.from, d.to])), 16);
const manifest = {
  fingerprint,
  generatedAt: now.toISOString(),
  questionsPerDay: S.questionsPerDay,
  next: { day: next, date: dayDate(next), quizAt: quizAt(next).toISOString(), answersAt: answersAt(next).toISOString() },
  days,
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`manifest: ${days.length} day(s) released, next is day ${next} at ${manifest.next.quizAt}, fingerprint ${fingerprint}`);
