import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '@fice/shared';
import { SubjectsService } from './subjects.service';
import { RequestUser } from '../../common/types/request-user';

type Row = Record<string, any>;

const G = String(new Types.ObjectId());
const head: RequestUser = { userId: String(new Types.ObjectId()), telegramId: 1, memberships: [{ groupId: G, role: Role.GroupHead }] };
const student: RequestUser = { ...head, memberships: [{ groupId: G, role: Role.Student }] };

/** Every key equal as a string, or for `{ $in }` one of the listed values. */
const matches = (row: Row, filter: Row) =>
  Object.entries(filter).every(([k, v]) =>
    v?.$in ? v.$in.some((x: unknown) => String(x) === String(row[k])) : String(row[k]) === String(v),
  );

/** The Model methods remove() uses, over an in-memory array. */
function model(rows: Row[]) {
  const deleteMany = async (filter: Row) => {
    const before = rows.length;
    rows.splice(0, rows.length, ...rows.filter((r) => !matches(r, filter)));
    return { deletedCount: before - rows.length };
  };
  return {
    rows,
    findById: (id: unknown) => ({ exec: async () => rows.find((r) => String(r._id) === String(id)) ?? null }),
    distinct: async (field: string, filter: Row) => rows.filter((r) => matches(r, filter)).map((r) => r[field]),
    deleteMany,
    deleteOne: deleteMany, // only called with an _id
    updateMany: async (filter: Row, update: { $unset: Row }) => {
      const hit = rows.filter((r) => matches(r, filter));
      for (const r of hit) for (const k of Object.keys(update.$unset)) delete r[k];
      return { modifiedCount: hit.length };
    },
  };
}

/** Subject A (deleted in the tests) and B, each with one row in every collection that points at it. */
function setup() {
  const oid = () => new Types.ObjectId();
  const [A, B, hwA, hwB, qA, qB] = [oid(), oid(), oid(), oid(), oid(), oid()];
  const db = {
    subjects: model([{ _id: A, groupId: new Types.ObjectId(G), tag: 'A' }, { _id: B, groupId: new Types.ObjectId(G), tag: 'B' }]),
    attendance: model([{ _id: oid(), subjectId: A, tag: 'A' }, { _id: oid(), subjectId: B, tag: 'B' }]),
    homework: model([{ _id: hwA, subjectId: A, tag: 'A' }, { _id: hwB, subjectId: B, tag: 'B' }]),
    completions: model([{ _id: oid(), homeworkId: hwA, tag: 'A' }, { _id: oid(), homeworkId: hwB, tag: 'B' }]),
    queues: model([{ _id: qA, subjectId: A, tag: 'A' }, { _id: qB, subjectId: B, tag: 'B' }]),
    swaps: model([{ _id: oid(), queueId: qA, tag: 'A' }, { _id: oid(), queueId: qB, tag: 'B' }]),
    applications: model([
      { _id: oid(), subjectId: A, status: 'pending', tag: 'A' },
      { _id: oid(), subjectId: A, status: 'approved', tag: 'A approved' },
      { _id: oid(), subjectId: B, status: 'pending', tag: 'B' },
    ]),
    lessons: model([{ _id: oid(), subjectId: A, tag: 'A' }, { _id: oid(), subjectId: B, tag: 'B' }, { _id: oid(), tag: 'none' }]),
  };
  const svc = new SubjectsService(
    db.subjects as never, db.attendance as never, {} as never, {} as never,
    db.homework as never, db.completions as never, db.queues as never, db.swaps as never,
    db.applications as never, db.lessons as never,
    {} as never, {} as never, {} as never,
  );
  const tags = () => Object.fromEntries(Object.entries(db).map(([k, m]) => [k, m.rows.map((r) => r.tag)]));
  const lessonLinks = () => db.lessons.rows.map((r) => r.subjectId && String(r.subjectId));
  return { svc, db, tags, lessonLinks, A: String(A), B: String(B) };
}

const AFTER_A = {
  subjects: ['B'],
  attendance: ['B'],
  homework: ['B'],
  completions: ['B'],
  queues: ['B'],
  swaps: ['B'],
  applications: ['A approved', 'B'],
  lessons: ['A', 'B', 'none'],
};

describe('SubjectsService.remove', () => {
  it("takes the subject's homework, completions, queue, swaps, journal and pending applications along; lessons only lose the link", async () => {
    const { svc, tags, lessonLinks, A, B } = setup();
    await svc.remove(head, A);
    expect(tags()).toEqual(AFTER_A);
    expect(lessonLinks()).toEqual([undefined, B, undefined]);
  });

  it('refuses a student and touches nothing', async () => {
    const { svc, tags, A } = setup();
    const before = tags();
    await expect(svc.remove(student, A)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tags()).toEqual(before);
  });

  it.each([
    'completions.deleteMany',
    'homework.deleteMany',
    'attendance.deleteMany',
    'applications.deleteMany',
    'lessons.updateMany',
    'swaps.deleteMany',
    'queues.deleteMany',
    'subjects.deleteOne',
  ])('a failing %s keeps the subject, and deleting it again finishes the job', async (step) => {
    const { svc, db, tags, lessonLinks, A, B } = setup();
    const [name, method] = step.split('.');
    const m = db[name as keyof typeof db] as Record<string, any>;
    m[method] = jest.fn().mockRejectedValueOnce(new Error('Atlas down')).mockImplementation(m[method]);
    await expect(svc.remove(head, A)).rejects.toThrow('Atlas down');
    expect(tags().subjects).toEqual(['A', 'B']);
    await svc.remove(head, A);
    expect(tags()).toEqual(AFTER_A);
    expect(lessonLinks()).toEqual([undefined, B, undefined]);
  });
});
