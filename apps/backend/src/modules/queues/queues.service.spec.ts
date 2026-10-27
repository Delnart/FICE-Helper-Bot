import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { QueueStatus, Role } from '@fice/shared';
import { QueuesService } from './queues.service';
import { RequestUser } from '../../common/types/request-user';

const G = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const Q = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ids = Array.from({ length: 6 }, () => new Types.ObjectId());
const head: RequestUser = { userId: String(ids[5]), telegramId: 1, memberships: [{ groupId: G, role: Role.GroupHead }] };

function setup(entries: Array<[number, number, QueueStatus]>, autoCompact = false, pending: object[] = []) {
  const doc = {
    _id: new Types.ObjectId(),
    groupId: new Types.ObjectId(G),
    title: 'ОС',
    rules: { autoCompact },
    entries: entries.map(([slotIndex, u, status]) => ({ slotIndex, userId: ids[u], status, labNumber: 1 })),
    save: async () => undefined,
  };
  const updateOne = jest.fn(async () => ({}));
  const swaps = { find: () => ({ lean: () => ({ exec: async () => pending }) }), updateOne };
  const users = { findById: () => ({ lean: () => ({ exec: async () => null }) }) };
  const queues = { findById: () => ({ exec: async () => doc }) };
  const svc = new QueuesService(queues as never, swaps as never, {} as never, users as never, {} as never);
  const layout = () => doc.entries.map((e) => [e.slotIndex, ids.indexOf(e.userId), e.status]);
  return { svc, doc, layout, updateOne };
}

describe('QueuesService advance / compact', () => {
  it('advance: passing → passed, next waiting → passing, the one after → preparing', async () => {
    const { svc, layout } = setup([[1, 0, QueueStatus.Passing], [2, 1, QueueStatus.Default], [3, 2, QueueStatus.Default]]);
    await svc.advance(head, Q);
    expect(layout()).toEqual([[1, 0, 'passed'], [2, 1, 'passing'], [3, 2, 'preparing']]);
  });

  it('advance with nobody passing calls the first waiting; autoCompact removes the passed one', async () => {
    const { svc, layout } = setup([[1, 0, QueueStatus.Passed], [3, 1, QueueStatus.Default]], true);
    await svc.advance(head, Q);
    expect(layout()).toEqual([[1, 0, 'passed'], [3, 1, 'passing']]); // nobody finished → no compaction
    await svc.advance(head, Q);
    expect(layout()).toEqual([]); // 1 passed + 3 passed → both removed
  });

  it('compact keeps order and shared slots, remaps or expires pending swaps', async () => {
    const swap = (from: number, fs: number, to: number, ts: number) =>
      ({ _id: new Types.ObjectId(), fromUserId: ids[from], fromSlotIndex: fs, toUserId: ids[to], toSlotIndex: ts });
    const { svc, layout, updateOne } = setup(
      [[1, 0, QueueStatus.Passed], [2, 1, QueueStatus.Default], [2, 2, QueueStatus.Default], [4, 3, QueueStatus.Failed], [5, 4, QueueStatus.Default]],
      false,
      [swap(4, 5, 1, 2), swap(0, 1, 4, 5)],
    );
    await svc.compact(head, Q, [QueueStatus.Passed]);
    expect(layout()).toEqual([[1, 1, 'default'], [1, 2, 'default'], [2, 3, 'failed'], [3, 4, 'default']]);
    const sets = updateOne.mock.calls.map((c) => (c as unknown[])[1]);
    expect(sets).toEqual([{ $set: { fromSlotIndex: 3, toSlotIndex: 1 } }, { $set: { status: 'expired' } }]);
  });

  it('updateEntry acts on the named person in a shared slot and refuses one who moved away', async () => {
    const { svc, layout } = setup([[1, 0, QueueStatus.Default], [1, 1, QueueStatus.Default]]);
    await svc.updateEntry(head, Q, 1, { status: QueueStatus.Failed, userId: String(ids[1]) });
    expect(layout()).toEqual([[1, 0, 'default'], [1, 1, 'failed']]);
    await expect(
      svc.updateEntry(head, Q, 1, { status: QueueStatus.Failed, userId: String(ids[2]) }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('QueuesService queue-open DMs', () => {
  it("follow each member's choice for this queue's group, else their user-wide one", async () => {
    const other = new Types.ObjectId();
    const rows = [
      { userId: ids[0], dmQueueOpen: true, groups: [{ groupId: new Types.ObjectId(G), dmQueueOpen: false }] },
      { userId: ids[1], dmQueueOpen: false, groups: [{ groupId: new Types.ObjectId(G), dmQueueOpen: true }] },
      { userId: ids[2], dmQueueOpen: false, groups: [{ groupId: other, dmQueueOpen: true }] },
      // ids[3]: no prefs row → default (send)
    ];
    const members = ids.slice(0, 4).map((_id, i) => ({ _id, telegramId: 10 + i }));
    const db = {
      collection: (name: string) =>
        name === 'academic_groups'
          ? { findOne: async () => ({ _id: new Types.ObjectId(G) }) } // no chat → DMs only
          : { find: () => ({ toArray: async () => rows }) },
    };
    const sendMessage = jest.fn(async (_id: number, _text: string) => undefined);
    const users = { find: () => ({ lean: () => ({ exec: async () => members }) }) };
    const svc = new QueuesService({} as never, { db } as never, {} as never, users as never, { sendMessage } as never);
    await (svc as never as { dispatchQueueOpenNotifications: (q: object) => Promise<void> }).dispatchQueueOpenNotifications({
      groupId: new Types.ObjectId(G),
      title: 'ОС',
    });
    expect(sendMessage.mock.calls.map(([id]) => id)).toEqual([11, 13]);
  });
});
