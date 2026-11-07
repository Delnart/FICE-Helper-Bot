import { Types } from 'mongoose';
import { Role } from '@fice/shared';
import { UsersService } from './users.service';

type Row = { _id: Types.ObjectId; fullName: string; memberships: Array<{ groupId: Types.ObjectId; role: Role }> };

/** Users model stand-in: honors `memberships.$elemMatch` ({ groupId, role: { $ne } }) — one membership must match both. */
const usersModel = (rows: Row[]) => ({
  find: (f: { memberships: { $elemMatch: { groupId: Types.ObjectId; role: { $ne: Role } } } }) => {
    const { groupId, role } = f.memberships.$elemMatch;
    const found = rows.filter((u) => u.memberships.some((m) => m.groupId.equals(groupId) && m.role !== role.$ne));
    const q = { sort: () => q, exec: async () => found };
    return q;
  },
});

const row = (fullName: string, ...memberships: Array<[Types.ObjectId, Role]>): Row => ({
  _id: new Types.ObjectId(),
  fullName,
  memberships: memberships.map(([groupId, role]) => ({ groupId, role })),
});

describe('UsersService.listGroupStudents', () => {
  it("lists the group's students, head and deputies, but not its teachers", async () => {
    const G = new Types.ObjectId();
    const other = new Types.ObjectId();
    const svc = new UsersService(
      usersModel([
        row('Староста', [G, Role.GroupHead]),
        row('Заступник', [G, Role.DeputyHead]),
        row('Студент', [G, Role.Student]),
        row('Студентка, що викладає в іншій групі', [G, Role.Student], [other, Role.Teacher]),
        row('Викладач групи', [G, Role.Teacher]),
        row('Студент іншої групи', [other, Role.Student]),
      ]) as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect((await svc.listGroupStudents(String(G))).map((u) => u.fullName)).toEqual([
      'Староста',
      'Заступник',
      'Студент',
      'Студентка, що викладає в іншій групі',
    ]);
  });

  it('gives the journal and the member pickers the same list, with roles', async () => {
    const G = new Types.ObjectId();
    const svc = new UsersService(
      usersModel([row('Студент', [G, Role.Student]), row('Викладач групи', [G, Role.Teacher])]) as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(await svc.listGroupMembersForUi(String(G))).toEqual([
      expect.objectContaining({ fullName: 'Студент', role: Role.Student }),
    ]);
  });
});
