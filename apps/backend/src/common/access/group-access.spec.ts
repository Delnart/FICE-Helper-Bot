import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '@fice/shared';
import { GroupAccessService } from './group-access';
import { RequestUser } from '../types/request-user';

const G = 'aaaaaaaaaaaaaaaaaaaaaaaa';

function make(teaches: boolean) {
  const exists = jest.fn(() => ({ exec: async () => (teaches ? { _id: G } : null) }));
  return { svc: new GroupAccessService({ exists } as never), exists };
}
const user = (role?: Role): RequestUser => ({
  userId: 'cccccccccccccccccccccccc',
  telegramId: 1,
  memberships: role ? [{ groupId: G, role }] : [],
});

describe('GroupAccessService', () => {
  it('members resolve from memberships without a query', async () => {
    const { svc, exists } = make(true);
    expect(await svc.roleIn(user(Role.Student), G)).toBe(Role.Student);
    expect(exists).not.toHaveBeenCalled();
  });

  it('a non-member who teaches a subject there is a Teacher; a stranger is null', async () => {
    expect(await make(true).svc.roleIn(user(), G)).toBe(Role.Teacher);
    expect(await make(false).svc.roleIn(user(), G)).toBeNull();
  });

  it('looks the teacher up by group + teacher ObjectIds', async () => {
    const { svc, exists } = make(true);
    await svc.roleIn(user(), G);
    const filter = (exists.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(filter.groupId).toBeInstanceOf(Types.ObjectId);
    expect(String(filter.groupId)).toBe(G);
    expect(filter['teachers.teacherUserId']).toBeInstanceOf(Types.ObjectId);
    expect(String(filter['teachers.teacherUserId'])).toBe('cccccccccccccccccccccccc');
  });

  it('memoizes the teacher lookup per request user', async () => {
    const { svc, exists } = make(true);
    const u = user();
    await svc.roleIn(u, G);
    await svc.assertAccess(u, G);
    expect(exists).toHaveBeenCalledTimes(1);
    await svc.roleIn(user(), G); // next request = new RequestUser object
    expect(exists).toHaveBeenCalledTimes(2);
  });

  it('malformed ids are null without touching the DB', async () => {
    const { svc, exists } = make(true);
    for (const id of ['x', '{"$ne":null}', 'aaaaaaaaaaaa', G.toUpperCase(), [G]]) {
      expect(await svc.roleIn(user(), id as string)).toBeNull();
    }
    expect(exists).not.toHaveBeenCalled();
  });

  it('assertAccess: 400 missing, 403 stranger / below minRole, else the id', async () => {
    await expect(make(true).svc.assertAccess(user(Role.GroupHead), undefined)).rejects.toThrow(BadRequestException);
    await expect(make(false).svc.assertAccess(user(), G)).rejects.toThrow(ForbiddenException);
    await expect(make(true).svc.assertAccess(user(), G, Role.DeputyHead)).rejects.toThrow(ForbiddenException);
    await expect(make(false).svc.assertAccess(user(Role.DeputyHead), G, Role.DeputyHead)).resolves.toBe(G);
  });
});
