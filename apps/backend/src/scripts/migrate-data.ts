/**
 * One-off data migration for the release that switched every id path from
 * Mixed to a real ObjectId schema type and added two unique indexes.
 * Data written while the paths were Mixed can hold string ids and duplicates
 * that typed queries / the new indexes choke on. Also moves attendance records
 * the old mark page filed one day early (step 6).
 *
 *   node dist/scripts/migrate-data.js           dry run: read-only report
 *   node dist/scripts/migrate-data.js --apply   write the fixes, build the indexes
 *
 * Standalone (no Nest bootstrap), idempotent, works on the RAW collections so no
 * Mongoose casting / validation / timestamps run. Every rewrite is a
 * compare-and-swap on the values it read: a concurrent app write wins and the
 * row is reported as an error — just rerun.
 */
import * as fs from 'fs';
import * as path from 'path';
import mongoose, { Schema, Types } from 'mongoose';
import { Role, ROLE_LEVEL } from '@fice/shared';
import { Queue, QueueSchema } from '../modules/queues/queue.schema';
import { QueueSwapRequest, QueueSwapRequestSchema } from '../modules/queues/swap-request.schema';

type Doc = Record<string, any>;

const APPLY = process.argv.includes('--apply');
const HEX24 = /^[0-9a-fA-F]{24}$/;
// What a Mixed id path may hold besides an ObjectId: hex strings get converted, the rest is reported.
const NOT_OID = ['string', 'number', 'bool', 'date', 'object', 'binData'];
const DONE = APPLY ? 'fixed' : 'would fix';
const summary: Doc[] = [];
let errors = 0;

const coll = (name: string) => mongoose.connection.db!.collection<Doc>(name);
const fail = (msg: string) => {
  errors++;
  console.error(`  ERROR ${msg}`);
};
const show = (label: string, ids: unknown[]) =>
  console.log(`  ${label}: ${ids.length}${ids.length ? ` (e.g. ${ids.slice(0, 3).join(', ')})` : ''}`);
const row = (step: string, found: number, done: number, left: number) =>
  summary.push({ step, found, [DONE]: done, left });

/** Every exported top-level schema under ../modules (the compiled *.schema.js next to this file). */
function loadSchemas(dir: string, out: Schema[] = []): Schema[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) loadSchemas(p, out);
    else if (e.name.endsWith('.schema.js')) {
      for (const v of Object.values(require(p))) {
        if (v instanceof Schema && v.get('collection')) out.push(v);
      }
    }
  }
  return out;
}

/** ObjectId paths of a schema as dot paths: top-level, arrays, inside subdocs / doc arrays. */
function objectIdPaths(schema: Schema, prefix = ''): string[] {
  const out: string[] = [];
  schema.eachPath((p, st: any) => {
    if (p === '_id') return;
    if (st.schema) out.push(...objectIdPaths(st.schema, `${prefix}${p}.`));
    else if (st.instance === 'ObjectId' || st.caster?.instance === 'ObjectId') out.push(prefix + p);
  });
  return out;
}

/** Copy of `v` with the 24-hex strings at `segs` turned into ObjectIds (arrays walked at every level). */
function fixIds(v: any, segs: string[], hit: { fixed: number; bad: number }): any {
  if (Array.isArray(v)) return v.map((x) => fixIds(x, segs, hit));
  if (!segs.length) {
    if (v == null || v._bsontype === 'ObjectId') return v;
    if (typeof v === 'string' && HEX24.test(v)) {
      hit.fixed++;
      return new Types.ObjectId(v);
    }
    hit.bad++; // non-hex string, number, object, ...: no safe guess
    return v;
  }
  if (v && typeof v === 'object' && segs[0] in v) {
    return { ...v, [segs[0]]: fixIds(v[segs[0]], segs.slice(1), hit) };
  }
  return v;
}

async function stringIds(schemas: Schema[]) {
  console.log('\n[1] string ids -> ObjectId');
  let found = 0, done = 0, left = 0;
  for (const schema of schemas) {
    const name = schema.get('collection') as string;
    const paths = objectIdPaths(schema);
    if (!paths.length) continue;
    const per = new Map(paths.map((p) => [p, { ids: [] as unknown[], done: 0, bad: [] as unknown[] }]));
    // batchSize: full docs, in a process sharing the live backend container's memory limit.
    const cursor = coll(name).find({ $or: paths.map((p) => ({ [p]: { $type: NOT_OID } })) }, { batchSize: 100 });
    for await (const doc of cursor) {
      // Rewrite whole top-level fields in JS; CAS on their old values.
      const set: Doc = {}, cas: Doc = { _id: doc._id }, fixedPaths: string[] = [];
      for (const p of paths) {
        const [root, ...rest] = p.split('.');
        const hit = { fixed: 0, bad: 0 };
        const next = fixIds(root in set ? set[root] : doc[root], rest, hit);
        if (!hit.fixed && !hit.bad) continue;
        per.get(p)!.ids.push(doc._id);
        if (hit.bad) per.get(p)!.bad.push(doc._id);
        if (hit.fixed) {
          set[root] = next;
          cas[root] = doc[root];
          fixedPaths.push(p);
        }
      }
      if (!fixedPaths.length) continue;
      if (APPLY) {
        try {
          const r = await coll(name).updateOne(cas, { $set: set });
          if (!r.matchedCount) {
            fail(`${name} ${doc._id} changed during migration — rerun`);
            continue;
          }
        } catch (e: any) {
          // A unique index (e.g. homework_completions {homeworkId,userId}) already
          // holds the ObjectId twin of this row: the app missed the string one and
          // created another. Which one to keep is a human call — unless it's a queue /
          // pending swap twin (the app may have built those indexes on startup), which
          // steps 3-4 dedupe so a rerun converts it.
          if (e?.code !== 11000) throw e;
          fail(`${name} ${doc._id}: converting would duplicate a unique key — rerun; if it stays, resolve by hand (${e.message})`);
          continue;
        }
      }
      for (const p of fixedPaths) per.get(p)!.done++;
    }
    for (const [p, s] of per) {
      if (!s.ids.length) continue;
      show(`${name}.${p} holds non-ObjectId values`, s.ids);
      if (s.bad.length) show(`  ${name}.${p} not a 24-hex string, left as is`, s.bad);
      found += s.ids.length;
      done += s.done;
      left += s.bad.length;
    }
  }
  if (!found) console.log('  none');
  // Mongoose can't cast these: reads see undefined and every save() of the doc fails validation.
  if (APPLY && left) fail(`${left} id value(s) that can't become an ObjectId left as is — fix by hand, then rerun`);
  row('1 string ids -> ObjectId', found, done, left);
}

async function dupMemberships() {
  console.log('\n[2] users.memberships: same group more than once');
  const level = (m: Doc) => ROLE_LEVEL[m.role as Role] ?? 0;
  const joined = (m: Doc) => (m.joinedAt ? +new Date(m.joinedAt) : Infinity);
  const ids: unknown[] = [];
  let done = 0;
  for await (const u of coll('users').find({ 'memberships.1': { $exists: true } }, { projection: { memberships: 1 } })) {
    const best = new Map<string, Doc>();
    for (const m of u.memberships) {
      const b = best.get(String(m.groupId));
      if (!b || level(m) > level(b) || (level(m) === level(b) && joined(m) < joined(b))) best.set(String(m.groupId), m);
    }
    if (best.size === u.memberships.length) continue;
    ids.push(u._id);
    // Winner takes the slot of the group's first occurrence: memberships[0] is the bot's default group.
    const seen = new Set<string>();
    const next = u.memberships.flatMap((m: Doc) => {
      const k = String(m.groupId);
      if (seen.has(k)) return [];
      seen.add(k);
      return [best.get(k)];
    });
    if (!APPLY) done++;
    else if ((await coll('users').updateOne({ _id: u._id, memberships: u.memberships }, { $set: { memberships: next } })).matchedCount) done++;
    else fail(`users ${u._id} changed during migration — rerun`);
  }
  show('users with duplicate memberships', ids);
  row('2 duplicate memberships', ids.length, done, ids.length - done);
}

type QueueSet = { ids: Types.ObjectId[] };

/** Queue ids per {subjectId, groupId} that occur more than once, oldest first. */
function queueSets(): Promise<QueueSet[]> {
  // $toString so string and ObjectId spellings of one id group together.
  return coll('queues')
    .aggregate<QueueSet>([
      { $sort: { _id: 1 } },
      { $group: { _id: { s: { $toString: '$subjectId' }, g: { $toString: '$groupId' } }, ids: { $push: '$_id' } } },
      { $match: { 'ids.1': { $exists: true } } },
    ])
    .toArray();
}

async function dupQueues(sets: QueueSet[]) {
  console.log('\n[4] queues: duplicates per {subjectId, groupId}');
  const extra: unknown[] = [], leftIds: unknown[] = [], conflicts: string[] = [];
  let done = 0;
  for (const { ids } of sets) {
    const [kept, ...dups] = await coll('queues').find({ _id: { $in: ids } }).sort({ _id: 1 }).toArray();
    if (!dups.length) continue; // deleted meanwhile
    kept.entries ??= [];
    let merged = 0;
    const plan = dups.map((d) => {
      extra.push(d._id);
      const left: Doc[] = [];
      for (const e of d.entries ?? []) {
        const sameUser = (x: Doc) => String(x.userId) === String(e.userId);
        // Same slot + user already in the kept queue: merged by an earlier interrupted run.
        if (kept.entries.some((x: Doc) => x.slotIndex === e.slotIndex && sameUser(x))) continue;
        const why = !(e.slotIndex >= 1 && e.slotIndex <= kept.slotsCount)
          ? 'slot out of range'
          : !kept.rules?.allowGroupSubmission && kept.entries.some((x: Doc) => x.slotIndex === e.slotIndex)
            ? 'slot taken'
            : !kept.rules?.allowMultipleEntriesPerUser && kept.entries.some(sameUser)
              ? 'user already queued'
              : null;
        if (why) {
          left.push(e);
          conflicts.push(`queue ${d._id} slot ${e.slotIndex} user ${e.userId}: ${why} in kept queue ${kept._id}`);
        } else {
          kept.entries.push(e);
          merged++;
        }
      }
      return { d, left };
    });
    if (APPLY && merged) {
      // __v CAS + bump, same contract as QueuesService (optimisticConcurrency / pushEntry),
      // so writing the whole merged array can't drop a concurrent enroll.
      const r = await coll('queues').updateOne(
        { _id: kept._id, __v: kept.__v ?? null },
        { $set: { entries: kept.entries }, $inc: { __v: 1 } },
      );
      if (!r.matchedCount) {
        fail(`queue ${kept._id} changed during migration — rerun`);
        leftIds.push(...dups.map((d) => d._id));
        continue;
      }
    }
    for (const { d, left } of plan) {
      if (left.length) {
        leftIds.push(d._id);
        // Keep only the conflicting entries so a rerun doesn't re-merge the rest.
        if (APPLY && left.length < (d.entries?.length ?? 0)) {
          const r = await coll('queues').updateOne({ _id: d._id, __v: d.__v ?? null }, { $set: { entries: left }, $inc: { __v: 1 } });
          if (!r.matchedCount) fail(`queue ${d._id} changed during migration — rerun`);
        }
        continue;
      }
      if (!APPLY) {
        done++;
        continue;
      }
      try {
        // Both spellings: a queueId step 1 couldn't convert would otherwise dangle.
        await coll('queue_swap_requests').updateMany(
          { queueId: { $in: [d._id, String(d._id)] } },
          { $set: { queueId: kept._id } },
        );
      } catch (e: any) {
        // A pending swap landed on the kept queue after step 3; a rerun's step 3 expires one.
        if (e?.code !== 11000) throw e;
        leftIds.push(d._id);
        fail(`queue ${d._id}: re-pointing its swaps hit a pending twin — rerun`);
        continue;
      }
      if ((await coll('queues').deleteOne({ _id: d._id, __v: d.__v ?? null })).deletedCount) done++;
      else {
        leftIds.push(d._id);
        fail(`queue ${d._id} changed during migration — rerun`);
      }
    }
  }
  show('duplicate queues (oldest kept)', extra);
  conflicts.forEach((c) => console.log(`    conflict: ${c}`));
  if (leftIds.length) show('duplicates left (resolve conflicts by hand, then rerun)', leftIds);
  row('4 duplicate queues', extra.length, done, leftIds.length);
}

async function dupSwaps(sets: QueueSet[]) {
  console.log('\n[3] queue_swap_requests: several pending per {queueId, fromUserId}');
  // Runs before step 4 and counts every queue of a duplicate set as its kept (oldest) one:
  // step 4 re-points swaps there, and the app may already have built the unique index on
  // startup, so two pending swaps of one user must not meet in the kept queue.
  const canon = new Map(sets.flatMap(({ ids }) => ids.map((id) => [String(id), String(ids[0])] as const)));
  const groups = new Map<string, Types.ObjectId[]>();
  const cursor = coll('queue_swap_requests')
    .find({ status: 'pending' }, { projection: { queueId: 1, fromUserId: 1 } })
    .sort({ createdAt: -1, _id: -1 });
  for await (const s of cursor) {
    const k = `${canon.get(String(s.queueId)) ?? String(s.queueId)}|${s.fromUserId}`;
    groups.set(k, [...(groups.get(k) ?? []), s._id]);
  }
  const stale = [...groups.values()].flatMap((ids) => ids.slice(1)); // newest stays pending
  let done = stale.length;
  if (APPLY && stale.length) {
    const r = await coll('queue_swap_requests').updateMany(
      { _id: { $in: stale }, status: 'pending' },
      { $set: { status: 'expired', updatedAt: new Date() } },
    );
    done = r.modifiedCount; // fewer = decided meanwhile, also fine
  }
  show('older pending swaps -> expired', stale);
  row('3 duplicate pending swaps', stale.length, done, 0);
}

async function dupTeachers() {
  console.log('\n[5] subjects.teachers: same teacherUserId + role twice');
  const ids: unknown[] = [];
  let removed = 0, done = 0;
  for await (const s of coll('subjects').find({ 'teachers.1': { $exists: true } }, { projection: { teachers: 1 } })) {
    // Entries without a user id are different sheet-only people; different roles are legit.
    const seen = new Set<string>();
    const next = s.teachers.filter((t: Doc) => {
      if (!t.teacherUserId) return true;
      const k = `${t.teacherUserId}|${t.role}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (next.length === s.teachers.length) continue;
    ids.push(s._id);
    removed += s.teachers.length - next.length;
    if (!APPLY) done++;
    else if ((await coll('subjects').updateOne({ _id: s._id, teachers: s.teachers }, { $set: { teachers: next } })).matchedCount) done++;
    else fail(`subjects ${s._id} changed during migration — rerun`);
  }
  show(`subjects with duplicate teacher entries (${removed} entries)`, ids);
  row('5 duplicate subject teachers', ids.length, done, ids.length - done);
}

const DAY_MS = 86400000;

async function shiftedAttendance() {
  console.log('\n[6] attendance_records: filed one day before the lesson');
  // The old mark page sent Kyiv midnight as ISO (21:00/22:00Z of the previous day) and the
  // backend truncated it to UTC midnight. A lesson's dayOfWeek never changes (re-sync matches
  // on it), so "stored weekday + 1 = lesson weekday" singles out exactly those records.
  // attendance_sessions (no client sends them, date stored untruncated), lesson_reminder_marks
  // (server-local dedupe key) and homework.deadline (full instant) don't have this bug.
  const lessonDay = new Map<string, number>();
  for await (const l of coll('schedule_lessons').find({}, { projection: { dayOfWeek: 1 } })) {
    lessonDay.set(String(l._id), l.dayOfWeek);
  }
  const shifted: unknown[] = [], merged: unknown[] = [], orphans: unknown[] = [], odd: unknown[] = [];
  let ok = 0, done = 0;
  const records = coll('attendance_records');
  for await (const r of records.find({}, { batchSize: 100 })) {
    const day = lessonDay.get(String(r.scheduleLessonId));
    if (day === undefined) {
      orphans.push(r._id);
      continue;
    }
    const w = r.date instanceof Date ? ((r.date.getUTCDay() + 6) % 7) + 1 : NaN; // 1=Mon … 7=Sun
    if (day === w) {
      ok++;
      continue;
    }
    if (day !== (w % 7) + 1) {
      odd.push(r._id);
      continue;
    }
    shifted.push(r._id);
    const next = new Date(r.date.getTime() + DAY_MS);
    // The unique {groupId, scheduleLessonId, date} key: the journal grid may already have the right day.
    const twin = await records.findOne({ groupId: r.groupId, scheduleLessonId: r.scheduleLessonId, date: next });
    if (twin) merged.push(r._id);
    if (!APPLY) {
      done++;
      continue;
    }
    if (!twin) {
      try {
        if ((await records.updateOne({ _id: r._id, date: r.date }, { $set: { date: next } })).matchedCount) done++;
        else fail(`attendance_records ${r._id} changed during migration — rerun`);
      } catch (e: any) {
        if (e?.code !== 11000) throw e;
        fail(`attendance_records ${r._id}: the correct day was marked meanwhile — rerun to merge`);
      }
      continue;
    }
    // Twin wins on the same student (newer, correctly dated); only students it lacks are added.
    // Merge first, delete second: an interrupted run leaves a duplicate, never a lost mark.
    const kept: Doc[] = twin.entries ?? [];
    const have = new Set(kept.map((e) => String(e.userId)));
    const add = (r.entries ?? []).filter((e: Doc) => !have.has(String(e.userId)));
    if (add.length) {
      const m = await records.updateOne({ _id: twin._id, entries: twin.entries }, { $set: { entries: [...kept, ...add] } });
      if (!m.matchedCount) {
        fail(`attendance_records ${twin._id} changed during migration — rerun`);
        continue;
      }
    }
    if ((await records.deleteOne({ _id: r._id, date: r.date, entries: r.entries })).deletedCount) done++;
    else fail(`attendance_records ${r._id} changed during migration — rerun`);
  }
  show('records one day early -> moved to the lesson day', shifted);
  show('  of them merged into the correctly dated twin', merged);
  console.log(`  already on the lesson weekday: ${ok}`);
  show('lesson no longer exists, left as is', orphans);
  show('other weekday mismatch, left as is', odd);
  row('6 attendance one day early', shifted.length, done, shifted.length - done);
}

async function buildIndexes() {
  console.log('\n[7] unique indexes');
  let done = 0;
  for (const [name, schema] of [
    [Queue.name, QueueSchema],
    [QueueSwapRequest.name, QueueSwapRequestSchema],
  ] as const) {
    try {
      // createIndexes only adds; syncIndexes would also drop indexes it doesn't know.
      await mongoose.model(name, schema).createIndexes();
      console.log(`  ${name}: ok`);
      done++;
    } catch (e: any) {
      fail(`${name} indexes: ${e.message}`);
    }
  }
  row('7 build indexes', 2, done, 2 - done);
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set — refusing to run.');
    process.exit(2);
  }
  // Off so the dry run can't build indexes or create collections as a side effect.
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  console.log(APPLY ? 'APPLY: writing changes.' : 'DRY RUN: read-only, nothing is written. Add --apply to fix.');
  try {
    await stringIds(loadSchemas(path.join(__dirname, '..', 'modules')));
    await dupMemberships();
    const sets = await queueSets();
    await dupSwaps(sets);
    await dupQueues(sets);
    await dupTeachers();
    await shiftedAttendance(); // after step 1: the twin lookup matches ObjectId ids
    if (APPLY) await buildIndexes();
  } finally {
    await mongoose.disconnect();
  }
  console.log();
  console.table(summary);
  if (errors) {
    console.error(`${errors} error(s) — see above.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
